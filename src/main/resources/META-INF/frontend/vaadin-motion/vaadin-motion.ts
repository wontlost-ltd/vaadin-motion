/**
 * Vaadin Motion — client host.
 *
 * One <vaadin-motion> is attached per UI by the Java side. It owns a single
 * anime.js Scope so every animation started here is reverted when the UI goes
 * away, and it exposes four entry points called via Element.executeJs():
 *
 *   enter(el, specJson)               -> void
 *   exit(el, specJson)                -> Promise<'done'>   (always resolves)
 *   stagger(root, specJson)           -> void
 *   timeline(json, ...els)            -> Promise<'done'>   (always resolves)
 */
import { LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { animate, createAnimatable, createDraggable, createDrawable, createMotionPath, createScope,
    createTimeline, morphTo, onScroll, scrambleText, splitText, stagger, utils } from 'animejs';
import type { AnimatableObject, DefaultsParams, Draggable, Scope, ScrollObserver } from 'animejs';
import { estimateMs, resolve, resolveStagger, type Options, type Params, type Spec } from './presets';
import { prefersReducedMotion } from './reduced-motion';

interface TimelineStep {
    target: number;
    preset: string;
    options?: Options;
    position?: string | number;
}

interface TimelineJson {
    defaults?: Options;
    steps: TimelineStep[];
}

/** Subset of createDraggable parameters sent from the server. */
interface DragJson {
    axis?: 'x' | 'y' | 'both';
    /** CSS selector; empty means no container bounds. */
    container?: string;
    /** Grid snap step in px; 0 disables snapping. */
    snap?: number;
    /** CSS selector for the drag handle; empty makes the whole element draggable. */
    trigger?: string;
    releaseStiffness?: number;
    releaseDamping?: number;
}

/** Subset of createDrawable + animate parameters sent from the server. */
interface DrawJson {
    duration?: number;
    delay?: number;
    ease?: string;
    /** true erases in reverse (1 -> 0). */
    reverse?: boolean;
}

/** Subset of FLIP reorder parameters sent from the server. */
interface LayoutJson {
    duration?: number;
    ease?: string;
    /** Child selector; empty means direct children. */
    children?: string;
}

/** Count-up parameters sent from the server. */
interface CountJson {
    from: number;
    to: number;
    duration?: number;
    ease?: string;
    /** Number of decimal places. */
    decimals?: number;
    prefix?: string;
    suffix?: string;
    /** Thousands separators. */
    grouping?: boolean;
}

/** Skeleton handover parameters sent from the server. */
interface RevealJson {
    duration?: number;
    /** How far the content lifts, in px. */
    lift?: number;
}

/** Split-text entrance parameters sent from the server. */
interface SplitJson {
    /** Split granularity. */
    by?: 'chars' | 'words' | 'lines';
    duration?: number;
    /** Gap between segments, in ms. */
    each?: number;
    ease?: string;
}

/** Drag-to-sort parameters sent from the server. */
interface SortJson {
    /** Scale applied while lifted; 1 means no scaling. */
    lift?: number;
    /** Tween duration for the other items making room. */
    duration?: number;
}

/** Collapsible panel parameters sent from the server. */
interface ToggleJson {
    /** true expands, false collapses. */
    open: boolean;
    duration?: number;
    ease?: string;
}

/** Motion-path parameters sent from the server. */
interface PathJson {
    /** SVG path d describing the trajectory. */
    d: string;
    duration?: number;
    ease?: string;
    /** Whether the element should face along the tangent. */
    rotate?: boolean;
}

/** Scramble-text parameters sent from the server. */
interface ScrambleJson {
    /** Final text; empty keeps the element's current text. */
    text?: string;
    duration?: number;
    /** Character set used while scrambling. */
    chars?: string;
}

/** SVG path morph parameters sent from the server. */
interface MorphJson {
    /** The d attribute of the target path. */
    to: string;
    duration?: number;
    ease?: string;
    /**
     * Sampling precision. 0 means **no resampling**: interpolate numerically between the two
     * d strings. That requires both paths to share the same command sequence, but reproduces
     * the target shape exactly.
     */
    precision?: number;
}

/** Subset of onScroll parameters sent from the server. */
interface ScrollJson {
    preset: string;
    options?: Options;
    /** 'play': fire once on entering the viewport; 'sync': follow scroll progress. */
    mode?: 'play' | 'sync';
    /** Enter/leave trigger points, e.g. 'bottom top' or 'center center'. */
    enter?: string;
    leave?: string;
    /** Only for mode='play': whether to replay on every entry. */
    repeat?: boolean;
    /**
     * CSS selector for the element whose scroll progress drives the animation.
     *
     * <p>Defaults to the animated element itself, which is right for a reveal — the thing
     * animates as it comes into view.
     */
    track?: string;
    /**
     * Drives the animation from how far the page has been scrolled through the tracked element,
     * rather than from that element's position in the viewport.
     *
     * <p>anime.js measures an element travelling <b>through</b> the viewport, which cannot reach
     * 100% for content taller than the window: the element's bottom would have to rise past the
     * viewport top, and if the content is the last thing on the page the document runs out of
     * scroll first. A reading bar over a long article is exactly that case, and it stalls
     * part-full at the end of the text.
     *
     * <p>This mode instead maps the document's own scroll range onto the tracked element, so the
     * bar reads empty when its top edge is first reached and full when its bottom edge has been
     * scrolled to. Only meaningful with {@code mode: 'sync'}.
     */
    readingProgress?: boolean;
}

const DEBUG = typeof window !== 'undefined'
    && (window as Window & { VAADIN_MOTION_DEBUG?: boolean }).VAADIN_MOTION_DEBUG === true;

const log = {
    debug: (...a: unknown[]) => { if (DEBUG) console.debug('[VaadinMotion]', ...a); },
    warn: (...a: unknown[]) => console.warn('[VaadinMotion]', ...a),
};

@customElement('vaadin-motion')
export class VaadinMotion extends LitElement {

    /** Keep in sync with MotionHost.VERSION */
    static readonly version = '0.1.0';

    @property({ type: Boolean }) respectReducedMotion = true;

    private scope?: Scope;

    /**
     * Draggable and ScrollObserver are **long-lived** objects: they register global
     * listeners and do not disappear with Scope.revert() the way one-shot animations do.
     * They are tracked per element so that re-initialising the same element through the same
     * API reverts the previous instance instead of stacking listeners, and everything is
     * reverted in disconnectedCallback.
     */
    private draggables = new Map<HTMLElement, Draggable>();
    private scrollers = new Map<HTMLElement, ScrollObserver>();
    private layoutObservers = new Map<HTMLElement, MutationObserver>();
    private animatables = new Map<HTMLElement, AnimatableObject>();
    /** One teardown function per container (hand-rolled pointer listeners, no Draggable). */
    private sortables = new Map<HTMLElement, () => void>();
    /** FLIP "First": child positions from each container's last resting state. */
    private layoutPositions = new Map<HTMLElement, Map<HTMLElement, DOMRect>>();

    /** Light DOM, nothing rendered — this element is a controller, not UI. */
    protected override createRenderRoot(): HTMLElement | DocumentFragment {
        return this;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.style.display = 'none';
        this.scope = createScope({ root: document.body });
        log.debug('scope created');
    }

    override disconnectedCallback(): void {
        this.draggables.forEach((d) => { try { d.revert(); } catch { /* ignore */ } });
        this.draggables.clear();
        this.scrollers.forEach((s) => { try { s.revert(); } catch { /* ignore */ } });
        this.scrollers.clear();
        this.layoutObservers.forEach((o) => o.disconnect());
        this.layoutObservers.clear();
        this.layoutPositions.clear();
        this.animatables.forEach((a) => { try { a.revert(); } catch { /* ignore */ } });
        this.animatables.clear();
        this.sortables.forEach((dispose) => { try { dispose(); } catch { /* ignore */ } });
        this.sortables.clear();
        this.scope?.revert();
        this.scope = undefined;
        log.debug('scope reverted');
        super.disconnectedCallback();
    }

    // ---------------------------------------------------------------- public

    enter(el: HTMLElement, specJson: string): void {
        const spec = this.parse(specJson);
        if (!spec || !el) return;
        const params = resolve(el, spec, this.reduced());
        utils.remove(el);
        this.inScope(() => animate(el, params));
    }

    exit(el: HTMLElement, specJson: string): Promise<string> {
        const spec = this.parse(specJson);
        if (!spec || !el || !el.isConnected) return Promise.resolve('done');
        const reduced = this.reduced();
        const params = resolve(el, spec, reduced);
        if (reduced) {
            return Promise.resolve('done');
        }
        utils.remove(el);
        // Prevent user interaction while leaving.
        el.style.pointerEvents = 'none';
        const finished = this.inScope(() => animate(el, params)).then(() => 'done');
        return this.withTimeout(finished, estimateMs(params));
    }

    stagger(root: HTMLElement, specJson: string): void {
        const spec = this.parse(specJson);
        if (!spec || !root) return;
        const children = Array.from(root.children).filter(
            (c): c is HTMLElement => c instanceof HTMLElement && !c.hidden,
        );
        if (children.length === 0) return;
        const params = resolveStagger(children[0], spec, this.reduced());
        utils.remove(children);
        this.inScope(() => animate(children, params));
    }

    timeline(json: string, ...els: HTMLElement[]): Promise<string> {
        const def = this.parse<TimelineJson>(json);
        if (!def || def.steps.length === 0) return Promise.resolve('done');
        const reduced = this.reduced();
        const defaults: DefaultsParams = {};
        if (def.defaults?.duration !== undefined) defaults.duration = def.defaults.duration;
        if (def.defaults?.ease !== undefined) defaults.ease = def.defaults.ease;

        let total = 0;
        const tl = this.inScope(() => createTimeline({ defaults }));
        for (const step of def.steps) {
            const el = els[step.target];
            if (!el || !el.isConnected) {
                log.warn('timeline step skipped, element missing', step);
                continue;
            }
            const spec: Spec = { preset: step.preset, options: step.options };
            const params = resolve(el, spec, reduced);
            // step-level values override timeline defaults only when explicitly set
            if (step.options?.duration === undefined && defaults.duration !== undefined) delete params.duration;
            if (step.options?.ease === undefined && defaults.ease !== undefined) delete params.ease;
            utils.remove(el);
            total += estimateMs({ ...(defaults as Params), ...params });
            tl.add(el, params, step.position as never);
        }
        const finished = tl.then(() => 'done');
        return this.withTimeout(finished, total + 250);
    }

    /**
     * Makes an element draggable. Idempotent: a repeat call reverts the previous instance.
     *
     * <p>The method is not named {@code draggable} because HTMLElement already has a boolean
     * property of that name, and shadowing it breaks Lit's CustomElementClass constraint
     * (TS1238 / TS2416). For the same reason {@code onScrollBind} is not called
     * {@code scroll} — that is a built-in HTMLElement method.
     *
     * <p>Dragging still works under reduced-motion: dragging is a capability rather than
     * decoration, and disabling it would remove functionality. Only the inertial settling on
     * release is dropped, since that part is the animation.
     */
    makeDraggable(el: HTMLElement, json: string): void {
        const cfg = this.parse<DragJson>(json);
        if (!cfg || !el) return;
        this.draggables.get(el)?.revert();

        const params: Record<string, unknown> = {};
        if (cfg.axis === 'x') params.y = false;
        else if (cfg.axis === 'y') params.x = false;
        if (cfg.container) {
            const c = document.querySelector(cfg.container);
            if (c) params.container = c;
            else log.warn('drag container not found', cfg.container);
        }
        if (cfg.trigger) {
            const trig = el.querySelector(cfg.trigger);
            if (trig) params.trigger = trig;
            else log.warn('drag trigger not found', cfg.trigger);
        }
        if (cfg.snap && cfg.snap > 0) {
            params.x = params.x === false ? false : { snap: cfg.snap };
            params.y = params.y === false ? false : { snap: cfg.snap };
        }
        if (this.reduced()) {
            // No settling: land immediately
            params.releaseStiffness = 1000;
            params.releaseDamping = 100;
        } else {
            if (cfg.releaseStiffness !== undefined) params.releaseStiffness = cfg.releaseStiffness;
            if (cfg.releaseDamping !== undefined) params.releaseDamping = cfg.releaseDamping;
        }

        const instance = this.inScope(() => createDraggable(el, params));
        this.draggables.set(el, instance);
        log.debug('draggable created', cfg);
    }

    /** Reverts makeDraggable(), making the element non-draggable again. */
    clearDraggable(el: HTMLElement): void {
        const d = this.draggables.get(el);
        if (!d) return;
        try { d.revert(); } catch { /* ignore */ }
        this.draggables.delete(el);
    }

    /**
     * SVG stroke animation: draws the stroke into existence.
     *
     * <p>The target must be an SVG geometry element with a measurable length (path, line,
     * polyline, circle and so on). Passing an &lt;svg&gt; container draws every geometry
     * child inside it.
     */
    draw(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<DrawJson>(json);
        if (!cfg || !el || !el.isConnected) return Promise.resolve('done');

        const shapes = el.tagName.toLowerCase() === 'svg'
            ? Array.from(el.querySelectorAll<SVGGeometryElement>('path, line, polyline, polygon, circle, ellipse, rect'))
            : [el as unknown as SVGGeometryElement];
        if (shapes.length === 0) {
            log.warn('draw: no drawable shape found', el);
            return Promise.resolve('done');
        }
        if (this.reduced()) {
            // Show the final state immediately, no progressive drawing
            shapes.forEach((s) => { s.style.strokeDasharray = 'none'; s.style.strokeDashoffset = '0'; });
            return Promise.resolve('done');
        }

        const duration = cfg.duration ?? 800;
        const drawFrom = cfg.reverse ? '0 1' : '0 0';
        const drawTo = cfg.reverse ? '0 0' : '0 1';
        const drawables = shapes.map((s) => createDrawable(s)).flat();
        const params: Params = {
            draw: [drawFrom, drawTo],
            duration,
            ease: cfg.ease ?? 'inOutQuad',
        } as unknown as Params;
        if (cfg.delay !== undefined) (params as Record<string, unknown>).delay = cfg.delay;

        const finished = this.inScope(() => animate(drawables, params)).then(() => 'done');
        return this.withTimeout(finished, duration + (cfg.delay ?? 0) + 500);
    }

    /**
     * Binds a scroll-driven animation. Idempotent: a repeat call reverts the previous observer.
     *
     * <p>{@code mode='play'} fires once when the element enters the viewport (optionally
     * replaying on every entry); {@code mode='sync'} ties animation progress to scroll
     * position, which is what progress bars and parallax need.
     */
    onScrollBind(el: HTMLElement, json: string): void {
        const cfg = this.parse<ScrollJson>(json);
        if (!cfg || !el) return;
        this.scrollers.get(el)?.revert();

        const spec: Spec = { preset: cfg.preset, options: cfg.options };
        const params = resolve(el, spec, this.reduced());
        const sync = cfg.mode === 'sync';

        // Track a different element when asked, falling back to the animated element itself.
        const tracked = cfg.track ? document.querySelector<HTMLElement>(cfg.track) : null;
        if (cfg.track && !tracked) {
            log.warn('onScroll: track selector matched nothing, using the target itself', cfg.track);
        }
        const observerParams: Record<string, unknown> = {
            target: tracked ?? el,
            sync: sync || undefined,
        };
        if (cfg.enter) observerParams.enter = cfg.enter;
        if (cfg.leave) observerParams.leave = cfg.leave;
        if (!sync && cfg.repeat === false) observerParams.repeat = false;

        // In sync mode the animation does not self-play; the observer drives its progress.
        // In play mode it fires as soon as the element enters the viewport.
        if (sync) (params as Record<string, unknown>).autoplay = onScroll(observerParams);

        utils.remove(el);
        if (sync && cfg.readingProgress) {
            const subject = tracked ?? el;
            // Progress is a pure function of scroll position, so it is written directly rather
            // than handed to an animation: there is no tween to run, only a value to track.
            const update = (): void => {
                const rect = subject.getBoundingClientRect();
                const top = rect.top + window.scrollY;
                // How much of the content the reader has actually seen: measured by the bottom
                // edge of the viewport advancing from the top of the content to its bottom.
                // Using the content's own height as the span (the "scrolls through the viewport"
                // model) is wrong here — it collapses to nothing when the content is shorter
                // than the window, and never completes when it is the last thing on the page.
                const seen = window.scrollY + window.innerHeight - top;
                const progress = seen / Math.max(1, rect.height);
                el.style.transform = `scaleX(${Math.max(0, Math.min(1, progress))})`;
            };
            update();
            window.addEventListener('scroll', update, { passive: true });
            window.addEventListener('resize', update, { passive: true });
            // Reuse the scrollers map so clearScroll() and UI teardown release this too.
            this.scrollers.set(el, {
                revert: () => {
                    window.removeEventListener('scroll', update);
                    window.removeEventListener('resize', update);
                },
            } as unknown as ScrollObserver);
            log.debug('scroll reading-progress bound');
            return;
        }
        if (sync) {
            this.inScope(() => animate(el, params));
            log.debug('scroll sync bound', cfg.preset);
            return;
        }
        const observer = this.inScope(() => onScroll({
            ...observerParams,
            onEnter: () => { this.inScope(() => animate(el, params)); },
        }));
        this.scrollers.set(el, observer);
        log.debug('scroll play bound', cfg.preset);
    }

    /** Releases the onScrollBind() binding. */
    clearScroll(el: HTMLElement): void {
        const s = this.scrollers.get(el);
        if (!s) return;
        try { s.revert(); } catch { /* ignore */ }
        this.scrollers.delete(el);
    }

    /**
     * FLIP list reordering: when children change position they slide from the old position
     * to the new one.
     *
     * <p>Sorting, filtering and adding/removing rows are everywhere in enterprise apps, and
     * an instant jump is the worst case for perception — users cannot tell whether a row
     * moved or was replaced. Once bound, a MutationObserver watches for DOM changes and
     * tweens automatically, so reordering data on the server requires nothing extra.
     *
     * <p>Persistent binding; repeat calls revert the previous instance.
     */
    layout(root: HTMLElement, json: string): void {
        const cfg = this.parse<LayoutJson>(json);
        if (!cfg || !root) return;
        this.layoutObservers.get(root)?.disconnect();
        this.layoutObservers.delete(root);
        this.layoutPositions.delete(root);
        if (this.reduced()) return;   // Jump straight to the new position, no tweening

        const duration = cfg.duration ?? 350;
        const ease = cfg.ease ?? 'outQuad';
        const kids = (): HTMLElement[] =>
            Array.from(root.children).filter((c): c is HTMLElement => c instanceof HTMLElement);

        /** Records each child's current viewport position (the FLIP "First"). */
        const record = (): void => {
            const map = new Map<HTMLElement, DOMRect>();
            // getBoundingClientRect() includes the current transform. Measuring while a tween
            // has not settled bakes the leftover offset into the baseline as if it were the
            // real position, and the next round adds to it again — measured offsets kept
            // growing (-124 -> -129 -> -130 -> -131), so the animation got wider every time.
            // Clear the transform before measuring and restore it straight after.
            const kk = kids();
            const saved = kk.map((c) => c.style.transform);
            kk.forEach((c) => { c.style.transform = 'none'; });
            kk.forEach((c) => map.set(c, c.getBoundingClientRect()));
            kk.forEach((c, i) => { c.style.transform = saved[i]; });
            this.layoutPositions.set(root, map);
        };

        /** Diff old against new, apply the inverse offset, then play back to zero. */
        const play = (): void => {
            const old = this.layoutPositions.get(root);
            if (!old) { record(); return; }
            const moved: { el: HTMLElement; dx: number; dy: number }[] = [];
            // Same reasoning: exclude in-flight tween transforms when reading the new
            // position, otherwise an interrupted animation is treated as having landed.
            const kk = kids();
            const saved = kk.map((c) => c.style.transform);
            kk.forEach((c) => { c.style.transform = 'none'; });
            const rects = new Map<HTMLElement, DOMRect>();
            kk.forEach((c) => rects.set(c, c.getBoundingClientRect()));
            kk.forEach((c, i) => { c.style.transform = saved[i]; });
            kk.forEach((c) => {
                const prev = old.get(c);
                if (!prev) return;               // Newly added elements are not tweened
                const now = rects.get(c)!;
                const dx = prev.left - now.left;
                const dy = prev.top - now.top;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.push({ el: c, dx, dy });
            });
            if (moved.length > 0) {
                moved.forEach(({ el, dx, dy }) => {
                    utils.remove(el);
                    this.inScope(() => animate(el, { x: [dx, 0], y: [dy, 0], duration, ease }));
                });
                log.debug('flip animated', moved.length);
            }
            record();
        };

        // Defer the first record by one frame: layout() is called by the server on attach,
        // when Vaadin may not have finished its first render. Measured that way the first
        // sort produced a bogus -24.7px horizontal offset even though every row shares the
        // same left. Waiting a frame lets the layout settle before taking the baseline.
        requestAnimationFrame(() => { if (this.layoutObservers.has(root)) record(); });
        // The MutationObserver callback runs in the microtask after DOM changes land but
        // before paint — exactly the moment to read the new positions and invert them.
        const observer = new MutationObserver(play);
        observer.observe(root, { childList: true });
        this.layoutObservers.set(root, observer);
        log.debug('layout bound', cfg);
    }

    /** Releases the layout() binding. */
    clearLayout(root: HTMLElement): void {
        this.layoutObservers.get(root)?.disconnect();
        this.layoutObservers.delete(root);
        this.layoutPositions.delete(root);
    }

    /**
     * Number count-up: smoothly counts the element text from `from` to `to`.
     *
     * <p>When a KPI jumps instantly users often miss that it changed at all, leaving a
     * highlight as the only remedy; the count itself carries both "this is changing" and
     * "by how much".
     *
     * <p>Set tabular-nums on the target to stop the width jittering while counting; that is
     * the caller's CSS to apply.
     */
    count(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<CountJson>(json);
        if (!cfg || !el) return Promise.resolve('done');

        const decimals = cfg.decimals ?? 0;
        const render = (v: number): string => {
            const fixed = v.toFixed(decimals);
            const grouped = cfg.grouping
                ? Number(fixed).toLocaleString('en-US', {
                    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
                })
                : fixed;
            return (cfg.prefix ?? '') + grouped + (cfg.suffix ?? '');
        };

        if (this.reduced()) {
            el.textContent = render(cfg.to);
            return Promise.resolve('done');
        }

        const duration = cfg.duration ?? 600;
        // Tween an intermediate object and write the value into textContent —
        // anime.js does not animate text directly.
        const holder = { v: cfg.from };
        const finished = this.inScope(() => animate(holder, {
            v: cfg.to,
            duration,
            ease: cfg.ease ?? 'outQuad',
            onUpdate: () => { el.textContent = render(holder.v); },
        })).then(() => {
            el.textContent = render(cfg.to);   // Guarantee the exact final value
            return 'done';
        });
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Skeleton to content handover: the skeleton fades out while the content fades in and
     * lifts slightly.
     *
     * <p>Far more natural than swapping the DOM outright, which reads as a flash the user
     * cannot account for. The two animations overlap, so the total is roughly one duration.
     */
    reveal(skeleton: HTMLElement, content: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<RevealJson>(json);
        if (!cfg) return Promise.resolve('done');
        const duration = cfg.duration ?? 300;
        const lift = cfg.lift ?? 8;

        const finish = (): string => {
            if (skeleton) skeleton.style.display = 'none';
            return 'done';
        };
        if (this.reduced()) {
            if (content) { content.style.opacity = '1'; content.style.transform = 'none'; }
            return Promise.resolve(finish());
        }

        if (content) utils.remove(content);
        // animate() returns a JSAnimation: thenable, but not a Promise. Passing it straight
        // to Promise.all fails to type-check because catch/finally are missing, so convert
        // it with .then() first.
        const outs: Promise<unknown>[] = [];
        if (skeleton) {
            outs.push(this.inScope(() => animate(skeleton, {
                opacity: [1, 0], duration, ease: 'inQuad',
            })).then(() => undefined));
        }
        if (content) {
            outs.push(this.inScope(() => animate(content, {
                opacity: [0, 1], y: [lift, 0], duration, delay: duration * 0.4, ease: 'outQuad',
            })).then(() => undefined));
        }
        const finished = Promise.all(outs).then(finish);
        return this.withTimeout(finished, duration * 2 + 500);
    }

    /**
     * Split text entrance: reveals by character, word or line in sequence.
     *
     * <p>anime.js splitText preserves accessibility by default (the original text stays
     * exposed to screen readers), so a heading is not reduced to a pile of meaningless
     * single-character nodes.
     */
    splitIn(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<SplitJson>(json);
        if (!cfg || !el) return Promise.resolve('done');
        const duration = cfg.duration ?? 400;
        const each = cfg.each ?? 30;

        if (this.reduced()) {
            el.style.opacity = '1';
            return Promise.resolve('done');
        }

        const by = cfg.by ?? 'words';
        const splitParams: Record<string, unknown> = { accessible: true };
        splitParams[by] = true;

        let targets: HTMLElement[];
        try {
            const split = splitText(el, splitParams) as unknown as Record<string, HTMLElement[]>;
            targets = split[by] ?? [];
        } catch (e) {
            log.warn('splitText failed', e);
            return Promise.resolve('error');
        }
        if (targets.length === 0) return Promise.resolve('done');

        const finished = this.inScope(() => animate(targets, {
            opacity: [0, 1],
            y: [6, 0],
            duration,
            delay: stagger(each),
            ease: 'outQuad',
        })).then(() => 'done');
        return this.withTimeout(finished, duration + each * targets.length + 500);
    }

    /**
     * SVG path morphing: smoothly reshapes a path's d into the target shape.
     *
     * <p>Typically used for icon state changes (hamburger to close, play to pause).
     */
    morph(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<MorphJson>(json);
        if (!cfg || !el || !cfg.to) return Promise.resolve('done');
        const duration = cfg.duration ?? 400;

        // Accept a wrapper element: Vaadin's Html component mounts the <svg> as a child of
        // the host, so the server cannot address the inner <path>. Look for the first path
        // below it and fall back to the element itself.
        const path = el.tagName.toLowerCase() === 'path'
            ? el
            : el.querySelector('path');
        if (!path) {
            log.warn('morph: no <path> found', el);
            return Promise.resolve('done');
        }

        // morphTo needs a target path element, so build a throwaway one holding the target d.
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('d', cfg.to);

        if (this.reduced()) {
            path.setAttribute('d', cfg.to);
            return Promise.resolve('done');
        }

        // precision defaults to 0: with a truthy precision morphTo **resamples both paths
        // into N L points** by arc length, which drops the subpath separator M (two strokes
        // collapse into one) and introduces floating point noise such as 7.600000381469727
        // (upstream rounds x but not y). Icon pairs whose command sequences are isomorphic
        // (M-L-M-L to M-L-M-L) reproduce the target exactly with 0.
        const precision = cfg.precision ?? 0;
        const finished = this.inScope(() => animate(path, {
            d: morphTo(tmp, precision),
            duration,
            ease: cfg.ease ?? 'inOutQuad',
        } as unknown as Params)).then(() => {
            // Write the exact target d at the end to wipe any floating point tail left by
            // interpolation.
            path.setAttribute('d', cfg.to);
            return 'done';
        });
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Expand / collapse a panel: transitions between 0 and the content's natural height.
     *
     * <p>`height: auto` cannot be transitioned in CSS, which is exactly where JS has to step
     * in. Unlike the EXPAND/COLLAPSE presets, this serves repeated opening and closing of the
     * same element (accordions, detail rows, filter panels) and plays no part in the remove
     * flow.
     */
    toggle(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<ToggleJson>(json);
        if (!cfg || !el) return Promise.resolve('done');
        const duration = cfg.duration ?? 250;

        if (this.reduced()) {
            el.style.height = cfg.open ? 'auto' : '0px';
            el.style.overflow = cfg.open ? '' : 'hidden';
            el.style.opacity = cfg.open ? '1' : '0';
            return Promise.resolve('done');
        }

        el.style.overflow = 'hidden';
        // Measure the target height first: scrollHeight is unaffected by the current height.
        const target = cfg.open ? el.scrollHeight : 0;
        const from = el.getBoundingClientRect().height;

        utils.remove(el);
        const finished = this.inScope(() => animate(el, {
            height: [from + 'px', target + 'px'],
            opacity: cfg.open ? [Math.min(from > 0 ? 1 : 0, 1), 1] : [1, 0],
            duration,
            ease: cfg.ease ?? 'outQuad',
            onComplete: () => {
                // Hand height back to auto so the panel adapts as its content changes
                if (cfg.open) { el.style.height = 'auto'; el.style.overflow = ''; }
            },
        })).then(() => 'done');
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Advances a progress bar to a fraction of its track.
     *
     * <p>Unlike the {@code progress} preset, which always runs 0 to 1, this animates from
     * wherever the bar currently sits to an arbitrary target. That is what a real progress
     * indicator needs: work completes in uneven stages, and each stage moves the bar on from
     * where the last one left it.
     *
     * <p>The element is expected to carry {@code transform-origin: left center}, otherwise the
     * bar grows from its centre.
     */
    progressTo(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<{ to?: number; duration?: number; ease?: string }>(json);
        if (!cfg || !el) return Promise.resolve('done');
        // Clamp: a fraction outside 0..1 would overflow or invert the bar.
        const to = Math.max(0, Math.min(1, cfg.to ?? 1));
        const duration = cfg.duration ?? 300;

        // Read the current scale from the inline transform rather than getComputedStyle: the
        // latter returns a matrix, and parsing that back is more fragile than the value we wrote.
        const current = /scaleX\(([\d.]+)\)/.exec(el.style.transform);
        const from = current ? parseFloat(current[1]) : 0;

        if (this.reduced()) {
            el.style.transform = `scaleX(${to})`;
            return Promise.resolve('done');
        }

        utils.remove(el);
        const finished = this.inScope(() => animate(el, {
            scaleX: [from, to],
            duration,
            ease: cfg.ease ?? 'inOutQuad',
        })).then(() => 'done');
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Motion along an SVG path: the element travels the given trajectory, optionally facing
     * along the tangent.
     *
     * <p>In enterprise back offices this mostly illustrates a flow ("data moves from A to B")
     * and is closer to a demonstration than a workhorse.
     */
    followPath(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<PathJson>(json);
        if (!cfg || !el || !cfg.d) return Promise.resolve('done');
        const duration = cfg.duration ?? 1200;
        if (this.reduced()) return Promise.resolve('done');

        // createMotionPath samples a real <path> element, so build a throwaway one.
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', cfg.d);
        svg.appendChild(path);
        document.body.appendChild(svg);

        const motion = createMotionPath(path);
        if (!motion) { svg.remove(); return Promise.resolve('done'); }

        const params: Record<string, unknown> = {
            translateX: motion.translateX,
            translateY: motion.translateY,
            duration,
            ease: cfg.ease ?? 'inOutQuad',
        };
        if (cfg.rotate) params.rotate = motion.rotate;

        utils.remove(el);
        const finished = this.inScope(() => animate(el, params as unknown as Params))
            .then(() => { svg.remove(); return 'done'; });
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Scramble text: characters flicker randomly, then settle one by one into the target.
     *
     * <p>Purely decorative and not recommended for enterprise back offices — it slows reading
     * down and reads as frivolous. It exists for gamified interfaces and splash screens.
     */
    scramble(el: HTMLElement, json: string): Promise<string> {
        const cfg = this.parse<ScrambleJson>(json);
        if (!cfg || !el) return Promise.resolve('done');
        const text = cfg.text ?? el.textContent ?? '';
        const duration = cfg.duration ?? 1000;

        if (this.reduced()) {
            el.textContent = text;
            return Promise.resolve('done');
        }

        // scrambleText(params) returns a **tween value**, not a standalone animator: it is
        // passed to animate() as the target value for textContent, which drives it.
        const scrambleParams: Record<string, unknown> = { text };
        if (cfg.chars) scrambleParams.chars = cfg.chars;

        const finished = this.inScope(() => animate(el, {
            textContent: scrambleText(scrambleParams as never),
            duration,
            ease: 'linear',
        } as unknown as Params)).then(() => { el.textContent = text; return 'done'; });
        return this.withTimeout(finished, duration + 500);
    }

    /**
     * Creates a reactive animation target (createAnimatable) for high-frequency updates.
     *
     * <p>Unlike one-shot animate, this keeps an object you can write to repeatedly and every
     * write eases towards the new value. Suited to cursor following or live data needles —
     * anything with <b>frequent updates</b>, where calling animate over and over keeps
     * creating new animation instances, hurting both performance and how it looks.
     *
     * <p>Persistent binding; repeat calls revert the previous instance.
     */
    animatable(el: HTMLElement, json: string): void {
        const cfg = this.parse<{ duration?: number; ease?: string }>(json);
        if (!cfg || !el) return;
        this.animatables.get(el)?.revert();
        const instance = this.inScope(() => createAnimatable(el, {
            x: { duration: cfg.duration ?? 300, ease: cfg.ease ?? 'outQuad' },
            y: { duration: cfg.duration ?? 300, ease: cfg.ease ?? 'outQuad' },
        } as never));
        this.animatables.set(el, instance);
    }

    /** Updates an animatable target's position; safe to call at high frequency. */
    animatableTo(el: HTMLElement, x: number, y: number): void {
        const a = this.animatables.get(el) as unknown as
            { x: (v: number) => void; y: (v: number) => void } | undefined;
        if (!a) { log.warn('animatableTo: no animatable bound', el); return; }
        a.x(x);
        a.y(y);
    }

    /** Releases the animatable binding. */
    clearAnimatable(el: HTMLElement): void {
        const a = this.animatables.get(el);
        if (!a) return;
        try { a.revert(); } catch { /* ignore */ }
        this.animatables.delete(el);
    }

    /**
     * Drag to sort: pick up an item to change its position while the others make room.
     *
     * <p><b>Handles pointer events itself rather than reusing createDraggable.</b> That helper
     * keeps its own internal offset and rewrites the transform every frame, which conflicts
     * with reordering the DOM: after a swap the dragged item's resting position jumps by one
     * slot, external compensation is overwritten on the next frame, and a single drag
     * cascades into several swaps that carry the item to the end. Here the offset stays under
     * our own control — right after a swap the reference point shifts by the same distance,
     * so the on-screen position remains continuous and the hit test is not re-triggered by
     * its own side effect.
     *
     * <p>On release the new order is reported through a `sort-changed` event so the server can
     * update its data model. Persistent binding; repeat calls revert the previous instance.
     */
    sortable(root: HTMLElement, json: string): void {
        const cfg = this.parse<SortJson>(json);
        if (!cfg || !root) return;
        this.clearSortable(root);

        const settle = cfg.duration ?? 220;
        const lift = cfg.lift ?? 1.02;
        const kids = (): HTMLElement[] =>
            Array.from(root.children).filter((c): c is HTMLElement => c instanceof HTMLElement);

        let dragging: HTMLElement | null = null;
        let pointerId = -1;
        let startY = 0;          // Pointer Y at press time
        let originIndex = 0;     // Index at press time
        let baseY = 0;           // Reference point; shifts on swap to keep the screen position continuous

        /** Reads an element's resting rect with its own drag offset excluded. */
        const restRect = (el: HTMLElement): DOMRect => {
            const saved = el.style.transform;
            el.style.transform = 'none';
            const r = el.getBoundingClientRect();
            el.style.transform = saved;
            return r;
        };

        const onPointerDown = (e: PointerEvent): void => {
            // Never start a drag from an interactive control. Rows routinely carry buttons, and
            // calling preventDefault() on their pointerdown suppresses the subsequent click
            // entirely — measured: the row's buttons stopped responding altogether while the
            // list-level pointerdown still fired.
            const origin = e.target as HTMLElement | null;
            if (origin?.closest('button, a, input, select, textarea, [role="button"], vaadin-button')) {
                return;
            }
            const target = origin?.closest<HTMLElement>(':scope > *');
            const item = kids().find((c) => c === target || c.contains(e.target as Node));
            if (!item) return;

            dragging = item;
            pointerId = e.pointerId;
            startY = e.clientY;
            baseY = e.clientY;
            originIndex = kids().indexOf(item);
            item.setPointerCapture(pointerId);
            item.style.zIndex = '10';
            item.style.cursor = 'grabbing';
            if (!this.reduced() && lift !== 1) {
                item.style.transition = 'none';
                this.inScope(() => animate(item, { scale: lift, duration: 120 }));
            }
            e.preventDefault();
        };

        const onPointerMove = (e: PointerEvent): void => {
            if (!dragging || e.pointerId !== pointerId) return;
            const item = dragging;
            const dy = e.clientY - baseY;
            item.style.transform = `translateY(${dy}px)`;

            // Hit test: which item's resting range contains the dragged item's visual centre
            const list = kids();
            const from = list.indexOf(item);
            const r = item.getBoundingClientRect();
            const mid = r.top + r.height / 2;

            let to = from;
            for (const other of list) {
                if (other === item) continue;
                const o = restRect(other);
                if (mid > o.top && mid < o.bottom) { to = list.indexOf(other); break; }
            }
            if (to === from) return;

            // Make room: record the other items' resting positions first
            const others = list.filter((c) => c !== item);
            const before = new Map<HTMLElement, number>();
            others.forEach((c) => before.set(c, restRect(c).top));

            const beforeTop = restRect(item).top;
            root.insertBefore(item, to > from ? list[to].nextSibling : list[to]);
            const afterTop = restRect(item).top;

            // Key point: shift the reference by however far the resting position jumped.
            // The next frame's dy subtracts the same amount, so the element does not budge
            // on screen and cannot fall into the next slot because of its own swap.
            baseY += afterTop - beforeTop;
            item.style.transform = `translateY(${e.clientY - baseY}px)`;

            if (!this.reduced()) {
                others.forEach((c) => {
                    const prev = before.get(c);
                    if (prev === undefined) return;
                    const shift = prev - restRect(c).top;
                    if (Math.abs(shift) < 0.5) return;
                    utils.remove(c);
                    this.inScope(() => animate(c, {
                        y: [shift, 0], duration: settle, ease: 'outQuad',
                        // Clear the inline transform once back at zero: leaving
                        // translateY(0px) is visually harmless but adds noise to later
                        // resting measurements and "is this animating" checks.
                        onComplete: () => { c.style.transform = ''; },
                    }));
                });
            }
        };

        const onPointerUp = (e: PointerEvent): void => {
            if (!dragging || e.pointerId !== pointerId) return;
            const item = dragging;
            dragging = null;
            try { item.releasePointerCapture(pointerId); } catch { /* ignore */ }

            const endIndex = kids().indexOf(item);
            const finish = (): void => {
                item.style.transform = '';
                item.style.zIndex = '';
                item.style.cursor = '';
                item.style.transition = '';
            };
            if (this.reduced()) {
                finish();
            } else {
                // Settle: slide back to 0 from the current offset and undo the lift scale
                const cur = /translateY\((-?[\d.]+)px\)/.exec(item.style.transform);
                const dy = cur ? parseFloat(cur[1]) : 0;
                utils.remove(item);
                this.inScope(() => animate(item, {
                    y: [dy, 0], scale: 1, duration: settle, ease: 'outQuad',
                    onComplete: finish,
                }));
                // Cleanup must not depend on onComplete alone. When the drop reorders the list,
                // a FLIP binding on the same root rebuilds the rows and calls utils.remove() on
                // this element, cancelling the settle animation — and with it its onComplete.
                // The row would then stay lifted (scale + zIndex) for good. A timer guarantees
                // the reset; running finish() twice is harmless.
                setTimeout(finish, settle + 60);
            }

            if (endIndex !== originIndex) {
                root.dispatchEvent(new CustomEvent('sort-changed', {
                    detail: { from: originIndex, to: endIndex },
                    bubbles: true,
                }));
            }
        };

        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointermove', onPointerMove);
        root.addEventListener('pointerup', onPointerUp);
        root.addEventListener('pointercancel', onPointerUp);
        kids().forEach((c) => { c.style.touchAction = 'none'; });

        this.sortables.set(root, () => {
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', onPointerUp);
            root.removeEventListener('pointercancel', onPointerUp);
            kids().forEach((c) => {
                c.style.touchAction = '';
                c.style.transform = '';
                c.style.zIndex = '';
                c.style.cursor = '';
            });
        });
        log.debug('sortable bound (pointer events)');
    }

    /** Releases the sortable() binding. */
    clearSortable(root: HTMLElement): void {
        const dispose = this.sortables.get(root);
        if (!dispose) return;
        dispose();
        this.sortables.delete(root);
    }

    // --------------------------------------------------------------- private

    private reduced(): boolean {
        return this.respectReducedMotion && prefersReducedMotion();
    }

    private inScope<T>(fn: () => T): T {
        let result!: T;
        if (this.scope) {
            this.scope.addOnce(() => { result = fn(); });
        } else {
            result = fn();
        }
        return result;
    }

    private parse<T = Spec>(json: string): T | undefined {
        try {
            return JSON.parse(json) as T;
        } catch (e) {
            log.warn('invalid spec json', json, e);
            return undefined;
        }
    }

    /**
     * The server detaches the element only after this promise resolves, so it
     * must never hang: race the animation against a generous timeout.
     */
    private withTimeout(p: Promise<string>, ms: number): Promise<string> {
        return Promise.race([
            p,
            new Promise<string>((res) => setTimeout(() => res('timeout'), ms)),
        ]).catch((e) => {
            log.warn('animation failed, resolving anyway', e);
            return 'error';
        });
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'vaadin-motion': VaadinMotion;
    }
}
