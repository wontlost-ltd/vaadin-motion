/**
 * Built-in presets. Deliberately restrained: short durations, small distances,
 * standard easings. Enterprise UIs want "smooth", not "showy".
 *
 * Keys must match MotionPreset.key() on the Java side.
 */
import { createSpring, stagger } from 'animejs';
import type { AnimationParams } from 'animejs';

export type Params = AnimationParams;

/** Fallback tint when highlight finds no theme token: a neutral translucent grey. */
const HIGHLIGHT_FALLBACK = 'rgba(0, 0, 0, 0.06)';

/**
 * Resolves the highlight tint, returning a **literal** colour rather than `var(...)`.
 *
 * Tries several Lumo tokens in turn, since different Vaadin versions expose different ones
 * (Vaadin 25's Lumo does not define `--lumo-primary-color-10pct`; reading it returns an empty
 * string). Falls back to a neutral grey when none resolve. The result is always something
 * anime.js's colour parser can handle.
 */
function highlightTint(el: HTMLElement): string {
    const style = getComputedStyle(el);
    for (const token of ['--lumo-primary-color-10pct', '--lumo-primary-color-50pct', '--lumo-contrast-5pct']) {
        const value = style.getPropertyValue(token).trim();
        if (value) return value;
    }
    return HIGHLIGHT_FALLBACK;
}

/** Options the server may send on top of a preset. */
export interface Options {
    duration?: number;
    delay?: number;
    ease?: string;
    /**
     * Spring parameters: when present, a physical spring replaces the easing curve. Its
     * duration is derived from the physics, so any duration passed in is ignored. Good for
     * drag release or modal entrances where the motion should feel like it has weight.
     */
    spring?: { stiffness?: number; damping?: number; mass?: number; bounce?: number };
    each?: number;
    from?: 'first' | 'last' | 'center';
    raw?: Record<string, unknown>;
}

export interface Spec {
    preset: string;
    options?: Options;
}

const DIST = 8;          // px — travel distance for slides
const ENTER_MS = 200;
const EXIT_MS = 150;
const ENTER_EASE = 'outQuad';
const EXIT_EASE = 'inQuad';

type Factory = (el: HTMLElement) => Params;

const PRESETS: Record<string, Factory> = {
    // enter
    fadeIn: () => ({ opacity: [0, 1], duration: ENTER_MS, ease: ENTER_EASE }),
    slideUp: () => ({ opacity: [0, 1], y: [DIST, 0], duration: ENTER_MS, ease: ENTER_EASE }),
    slideDown: () => ({ opacity: [0, 1], y: [-DIST, 0], duration: ENTER_MS, ease: ENTER_EASE }),
    slideInLeft: () => ({ opacity: [0, 1], x: [-DIST, 0], duration: ENTER_MS, ease: ENTER_EASE }),
    slideInRight: () => ({ opacity: [0, 1], x: [DIST, 0], duration: ENTER_MS, ease: ENTER_EASE }),
    scaleIn: () => ({ opacity: [0, 1], scale: [0.96, 1], duration: ENTER_MS, ease: ENTER_EASE }),
    expand: (el) => ({
        height: [0, el.scrollHeight + 'px'],
        opacity: [0, 1],
        duration: ENTER_MS + 50,
        ease: 'outCubic',
        onBegin: () => { el.style.overflow = 'hidden'; },
        onComplete: () => { el.style.overflow = ''; el.style.height = ''; },
    }),

    // exit
    fadeOut: () => ({ opacity: 0, duration: EXIT_MS, ease: EXIT_EASE }),
    slideOutUp: () => ({ opacity: 0, y: -DIST, duration: EXIT_MS, ease: EXIT_EASE }),
    slideOutDown: () => ({ opacity: 0, y: DIST, duration: EXIT_MS, ease: EXIT_EASE }),
    slideOutLeft: () => ({ opacity: 0, x: -DIST, duration: EXIT_MS, ease: EXIT_EASE }),
    slideOutRight: () => ({ opacity: 0, x: DIST, duration: EXIT_MS, ease: EXIT_EASE }),
    scaleOut: () => ({ opacity: 0, scale: 0.96, duration: EXIT_MS, ease: EXIT_EASE }),
    collapse: (el) => ({
        height: [el.offsetHeight + 'px', '0px'],
        opacity: 0,
        marginTop: 0,
        marginBottom: 0,
        paddingTop: 0,
        paddingBottom: 0,
        duration: EXIT_MS + 50,
        ease: 'inCubic',
        onBegin: () => { el.style.overflow = 'hidden'; },
    }),

    // attention
    shake: () => ({
        x: [{ to: -4 }, { to: 4 }, { to: -3 }, { to: 3 }, { to: 0 }],
        duration: 300,
        ease: 'inOutSine',
    }),
    pulse: () => ({ scale: [1, 1.03, 1], duration: 350, ease: 'inOutSine' }),
    /**
     * Horizontal fill, intended for SYNC scroll progress bars.
     *
     * Uses scaleX rather than width: scaleX runs on the compositor, so per-frame updates
     * while scrolling do not trigger layout. Callers must set
     * `transform-origin: left center` themselves, otherwise the bar grows from its centre.
     * Note this is not an entrance animation — playing it alone just fills from 0 to 1 once.
     */
    progress: () => ({ scaleX: [0, 1], duration: 300, ease: 'linear' }),
    highlight: (el) => {
        const original = el.style.backgroundColor;
        return {
            // Must pass a resolved literal colour, never var().
            // anime.js's resolveCssVar extracts the fallback with
            // /var\(\s*(--[\w-]+)(?:\s*,\s*([^)]+))?\s*\)/, and `[^)]+` stops at the first
            // `)` — a nested rgba(...) is truncated to "rgba(0,0,0,0.06" (missing the closing
            // paren). rgbToRgba's regex then fails and returns null, and reading null[4]
            // throws TypeError: Cannot read properties of null (reading '4').
            // So resolve the token here and hand anime.js the final colour.
            backgroundColor: [highlightTint(el), original || 'rgba(0, 0, 0, 0)'],
            duration: 900,
            ease: 'outQuad',
            onComplete: () => { el.style.backgroundColor = original; },
        };
    },
};

export function presetKeys(): string[] {
    return Object.keys(PRESETS);
}

/** Resolve a spec into anime.js parameters for one element. */
export function resolve(el: HTMLElement, spec: Spec, reduced: boolean): Params {
    const factory = PRESETS[spec.preset];
    if (!factory) {
        throw new Error(`[VaadinMotion] unknown preset "${spec.preset}"`);
    }
    const params: Params = { ...factory(el) };
    const o = spec.options ?? {};
    if (o.duration !== undefined) params.duration = o.duration;
    if (o.delay !== undefined) params.delay = o.delay;
    if (o.ease !== undefined) params.ease = o.ease;
    // Spring wins over ease: createSpring carries its own duration, and setting one as well
    // would conflict with the physics.
    if (o.spring) {
        params.ease = createSpring(o.spring);
        delete params.duration;
    }
    if (o.raw) Object.assign(params, o.raw as Params);
    if (reduced) {
        params.duration = 0;
        params.delay = 0;
    }
    return params;
}

/** Same as resolve() but with a stagger() delay for a group of siblings. */
export function resolveStagger(first: HTMLElement, spec: Spec, reduced: boolean): Params {
    const params = resolve(first, spec, reduced);
    const o = spec.options ?? {};
    const each = reduced ? 0 : (o.each ?? 40);
    params.delay = stagger(each, { from: o.from ?? 'first', start: o.delay ?? 0 });
    return params;
}

/** Upper bound of a resolved animation's wall-clock time, for the exit timeout guard. */
export function estimateMs(params: Params): number {
    const d = typeof params.duration === 'number' ? params.duration : 300;
    const delay = typeof params.delay === 'number' ? params.delay : 0;
    return d + delay + 250;
}
