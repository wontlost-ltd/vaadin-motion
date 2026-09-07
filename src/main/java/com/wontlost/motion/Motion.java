package com.wontlost.motion;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.ComponentUtil;
import com.vaadin.flow.component.HasComponents;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.dom.Element;
import com.vaadin.flow.function.SerializableBiConsumer;
import com.vaadin.flow.function.SerializableRunnable;
import com.vaadin.flow.shared.Registration;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Locale;
import java.util.Objects;

/**
 * Server-side entry point. Three abstractions, nothing else:
 *
 * <pre>
 * // 1. enter / exit bound to the component lifecycle
 * Motion.enter(card, MotionPreset.SLIDE_UP);
 * Motion.exit(card, MotionPreset.COLLAPSE);
 * Motion.remove(card);                 // plays the exit, THEN detaches
 *
 * // 2. staggered entrance for a layout's children
 * Motion.stagger(kpiRow, MotionPreset.SLIDE_UP, MotionOptions.none().staggerEach(40));
 *
 * // 3. a timeline across components
 * Motion.timeline()
 *       .add(header, MotionPreset.FADE_IN)
 *       .add(kpiRow, MotionPreset.SLIDE_UP, "-=100")
 *       .add(chart, MotionPreset.SCALE_IN)
 *       .onComplete(() -> Notification.show("ready"))
 *       .play();
 * </pre>
 *
 * <p>Why {@link #remove(Component)} exists: Flow detaches the DOM node the moment
 * {@code parent.remove(child)} runs, so an exit animation can never play. This
 * add-on inverts the order — the client plays the exit, resolves a promise, and
 * only then does the server detach. A client-side timeout guarantees the promise
 * always resolves, so the server never leaks a component.</p>
 */
public final class Motion {

    private static final String EXIT_KEY = Motion.class.getName() + ".exit";
    private static final String EXIT_OPTS_KEY = Motion.class.getName() + ".exitOptions";

    /**
     * Marks that a removal animation is already in flight for this component.
     *
     * <p>The {@code isAttached()} check in {@link #removeThen} happens <b>before</b> the
     * {@code executeJs} round trip: while the first call has not detached the element yet,
     * later calls still pass that check, stacking several exit animations on the same element
     * and registering several detach callbacks — so {@code afterDetach} would run N times.
     * The element state itself stays correct ({@code removeFromParent()} is null-guarded, so
     * repeats are no-ops), but callers that count, notify or write to a database in the
     * callback would see it executed repeatedly.
     *
     * <p>The client sets {@code pointerEvents: none} during the exit, so a real user cannot
     * click twice; only programmatic bursts reach this path. Even so, the callback contract
     * should remain "once per removal".
     */
    private static final String REMOVING_KEY = Motion.class.getName() + ".removing";

    private Motion() { }

    // ------------------------------------------------------------------ enter

    /** Enter with {@link MotionPreset#defaultEnter()}. */
    public static Registration enter(Component component) {
        return enter(component, MotionPreset.defaultEnter(), MotionOptions.none());
    }

    public static Registration enter(Component component, MotionPreset preset) {
        return enter(component, preset, MotionOptions.none());
    }

    /**
     * Plays {@code preset} now if the component is attached, and again on every
     * future attach until the returned registration is removed.
     */
    public static Registration enter(Component component, MotionPreset preset, MotionOptions options) {
        Objects.requireNonNull(component, "component");
        requireKind(preset, MotionPreset.Kind.ENTER, MotionPreset.Kind.ATTENTION);
        String json = spec(preset, options);
        if (component.isAttached()) {
            playEnter(component, json);
        }
        return component.addAttachListener(e -> playEnter(component, json));
    }

    private static void playEnter(Component component, String json) {
        host(component).getElement().executeJs("this.enter($0, $1)", component.getElement(), json);
    }

    /**
     * One-off feedback on a visible component (shake on validation error,
     * pulse on update). Does not bind to attach.
     */
    public static void play(Component component, MotionPreset preset) {
        play(component, preset, MotionOptions.none());
    }

    public static void play(Component component, MotionPreset preset, MotionOptions options) {
        Objects.requireNonNull(component, "component");
        Objects.requireNonNull(preset, "preset");
        if (!component.isAttached()) {
            return;
        }
        host(component).getElement().executeJs("this.enter($0, $1)", component.getElement(),
                spec(preset, options));
    }

    // ------------------------------------------------------------------- exit

    /** Registers the exit preset that {@link #remove(Component)} will use. */
    public static void exit(Component component, MotionPreset preset) {
        exit(component, preset, MotionOptions.none());
    }

    public static void exit(Component component, MotionPreset preset, MotionOptions options) {
        Objects.requireNonNull(component, "component");
        requireKind(preset, MotionPreset.Kind.EXIT);
        ComponentUtil.setData(component, EXIT_KEY, preset);
        ComponentUtil.setData(component, EXIT_OPTS_KEY, options == null ? MotionOptions.none() : options);
    }

    /**
     * Plays the exit preset registered via {@link #exit} (or
     * {@link MotionPreset#defaultExit()}), then detaches the component from its
     * parent. Safe to call on a detached component (no-op).
     */
    public static void remove(Component component) {
        Object preset = ComponentUtil.getData(component, EXIT_KEY);
        Object opts = ComponentUtil.getData(component, EXIT_OPTS_KEY);
        remove(component,
                preset instanceof MotionPreset p ? p : MotionPreset.defaultExit(),
                opts instanceof MotionOptions o ? o : MotionOptions.none());
    }

    public static void remove(Component component, MotionPreset preset) {
        remove(component, preset, MotionOptions.none());
    }

    public static void remove(Component component, MotionPreset preset, MotionOptions options) {
        removeThen(component, preset, options, null);
    }

    /**
     * Like {@link #remove(Component, MotionPreset, MotionOptions)} and additionally
     * runs {@code afterDetach} on the server once the component is gone.
     */
    public static void removeThen(Component component, MotionPreset preset, MotionOptions options,
                                  SerializableRunnable afterDetach) {
        Objects.requireNonNull(component, "component");
        requireKind(preset, MotionPreset.Kind.EXIT);
        if (!component.isAttached()) {
            return;
        }
        // Deduplicate: bail out while a removal is in flight so we never stack a second exit
        // animation or a second detach callback. The flag is cleared when the detach settles,
        // so "remove -> re-add -> remove again" still works.
        if (Boolean.TRUE.equals(ComponentUtil.getData(component, REMOVING_KEY))) {
            return;
        }
        ComponentUtil.setData(component, REMOVING_KEY, Boolean.TRUE);

        Element element = component.getElement();
        String json = spec(preset, options);
        SerializableRunnable detach = () -> {
            // Clear the flag first: even if afterDetach throws, the component must not stay
            // locked in the "removing" state, otherwise it could never be removed again.
            ComponentUtil.setData(component, REMOVING_KEY, null);
            if (element.getParent() != null) {
                element.removeFromParent();
            }
            if (afterDetach != null) {
                afterDetach.run();
            }
        };
        host(component).getElement()
                .executeJs("return this.exit($0, $1)", element, json)
                .then(String.class, ignored -> detach.run(), error -> detach.run());
    }

    // ---------------------------------------------------------------- stagger

    /** Staggers the layout's children with {@link MotionPreset#defaultEnter()}. */
    public static <T extends Component & HasComponents> Registration stagger(T layout) {
        return stagger(layout, MotionPreset.defaultEnter(), MotionOptions.none());
    }

    public static <T extends Component & HasComponents> Registration stagger(T layout, MotionPreset preset) {
        return stagger(layout, preset, MotionOptions.none());
    }

    /**
     * Plays {@code preset} on each direct child of {@code layout}, offset by
     * {@link MotionOptions#staggerEach} (default 40 ms). Runs now if attached and
     * again on every future attach of the layout.
     */
    public static <T extends Component & HasComponents> Registration stagger(T layout, MotionPreset preset,
                                                                             MotionOptions options) {
        Objects.requireNonNull(layout, "layout");
        requireKind(preset, MotionPreset.Kind.ENTER);
        String json = spec(preset, options);
        if (layout.isAttached()) {
            playStagger(layout, json);
        }
        return layout.addAttachListener(e -> playStagger(layout, json));
    }

    private static void playStagger(Component layout, String json) {
        host(layout).getElement().executeJs("this.stagger($0, $1)", layout.getElement(), json);
    }

    // --------------------------------------------------------------- timeline

    /** Starts a fluent timeline. Call {@link MotionTimeline#play()} to run it. */
    public static MotionTimeline timeline() {
        return new MotionTimeline();
    }

    // -------------------------------------------------------------- draggable

    /** Axis constraint for dragging. */
    public enum DragAxis { X, Y, BOTH }

    /** Makes a component draggable on both axes, with inertial settling on release. */
    public static void draggable(Component component) {
        draggable(component, DragAxis.BOTH, null, 0);
    }

    /**
     * Makes a component draggable.
     *
     * <p>Idempotent: calling it again on the same component reverts the previous instance
     * instead of stacking listeners. This binding is <b>persistent</b> — unlike a one-shot
     * animation it registers global pointer listeners that live until {@link #undraggable}
     * or until the host UI is destroyed.
     *
     * <p>Dragging still works under {@code prefers-reduced-motion} (dragging is a capability,
     * not decoration); only the inertial settling on release is disabled.
     *
     * @param axis      restricts movement to a single axis
     * @param container CSS selector bounding the drag area, or null for no bounds
     * @param snapPx    grid snap step in px, 0 to disable snapping
     */
    public static void draggable(Component component, DragAxis axis, String container, int snapPx) {
        Objects.requireNonNull(component, "component");
        if (!component.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("axis", (axis == null ? DragAxis.BOTH : axis).name().toLowerCase(Locale.ROOT));
        if (container != null && !container.isBlank()) {
            m.put("container", container);
        }
        if (snapPx > 0) {
            m.put("snap", snapPx);
        }
        host(component).getElement()
                .executeJs("this.makeDraggable($0, $1)", component.getElement(), Json.object(m));
    }

    /** Reverts {@link #draggable}, making the component non-draggable again. */
    public static void undraggable(Component component) {
        Objects.requireNonNull(component, "component");
        if (!component.isAttached()) {
            return;
        }
        host(component).getElement().executeJs("this.clearDraggable($0)", component.getElement());
    }

    // ------------------------------------------------------------------- draw

    /** SVG stroke drawing: 800ms forward draw by default. */
    public static void draw(Component svgOrShape) {
        draw(svgOrShape, 800, false);
    }

    /**
     * SVG stroke animation — draws the stroke into existence. Common for icons, signatures
     * and flow diagrams on entrance.
     *
     * <p>The target must be an SVG geometry element
     * ({@code path/line/polyline/polygon/circle/ellipse/rect}); passing an {@code <svg>}
     * container draws every geometry child inside it. The element must have a {@code stroke},
     * otherwise there is nothing to see.
     *
     * <p>Under {@code prefers-reduced-motion} the final state is shown immediately without
     * progressive drawing.
     *
     * @param reverse true to erase in reverse
     */
    public static void draw(Component svgOrShape, int durationMs, boolean reverse) {
        drawThen(svgOrShape, durationMs, reverse, null);
    }

    /** Like {@link #draw}, and runs {@code afterDraw} on the server once drawing finishes. */
    public static void drawThen(Component svgOrShape, int durationMs, boolean reverse,
                                SerializableRunnable afterDraw) {
        Objects.requireNonNull(svgOrShape, "svgOrShape");
        if (!svgOrShape.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("duration", Math.max(0, durationMs));
        if (reverse) {
            m.put("reverse", true);
        }
        host(svgOrShape).getElement()
                .executeJs("return this.draw($0, $1)", svgOrShape.getElement(), Json.object(m))
                .then(String.class,
                        ignored -> { if (afterDraw != null) afterDraw.run(); },
                        error -> { if (afterDraw != null) afterDraw.run(); });
    }

    // ----------------------------------------------------------------- scroll

    /** Scroll trigger mode. */
    public enum ScrollMode {
        /** Plays once when the element enters the viewport. */
        PLAY,
        /** Animation progress follows scroll position (progress bars, parallax). */
        SYNC
    }

    /** Plays an entrance animation once when the element scrolls into view. */
    public static void onScroll(Component component, MotionPreset preset) {
        onScroll(component, preset, MotionOptions.none(), ScrollMode.PLAY);
    }

    /**
     * Binds a scroll-driven animation.
     *
     * <p>Idempotent and <b>persistent</b>: repeat calls revert the previous observer, which
     * otherwise lives until {@link #clearScroll} or until the host UI is destroyed.
     *
     * <p>{@code PLAY} suits content that surfaces screen by screen on a long page;
     * {@code SYNC} ties progress to scroll position, which suits reading progress bars
     * and parallax backgrounds.
     */
    public static void onScroll(Component component, MotionPreset preset, MotionOptions options,
                                ScrollMode mode) {
        onScroll(component, preset, options, mode, null);
    }

    /**
     * Binds a scroll-driven animation whose progress is measured against another component.
     *
     * <p>By default the animation tracks its own element passing through the viewport, which is
     * what a reveal wants. A <b>progress bar</b> is the opposite case: it sits pinned near the
     * top of the page, so tracking itself makes it read part-full before the reader has
     * scrolled at all, and full well before the end of the text. Point it at the content being
     * read and the bar spans empty to full across exactly that content.
     *
     * @param tracked the component whose scroll progress drives the animation; {@code null}
     *                falls back to the animated component itself
     */
    public static void onScroll(Component component, MotionPreset preset, MotionOptions options,
                                ScrollMode mode, Component tracked) {
        onScroll(component, preset, options, mode, tracked, false);
    }

    /**
     * Binds a scroll-driven animation, optionally as a <b>reading progress</b> bar.
     *
     * <p>The default sync mode measures the tracked element travelling through the viewport,
     * which <b>cannot reach 100% for content taller than the window</b>: the element's bottom
     * would have to rise past the top of the viewport, and when the content is the last thing on
     * the page the document runs out of scroll first. A reading bar over a long record therefore
     * stalls part-full at the end of the text.
     *
     * <p>Setting {@code readingProgress} maps the document's scroll range onto the tracked
     * element instead, so the bar is empty at the start of the content and full once its bottom
     * has been scrolled to.
     */
    public static void onScroll(Component component, MotionPreset preset, MotionOptions options,
                                ScrollMode mode, Component tracked, boolean readingProgress) {
        Objects.requireNonNull(component, "component");
        requireKind(preset, MotionPreset.Kind.ENTER, MotionPreset.Kind.ATTENTION);
        if (!component.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("preset", preset.key());
        if (options != null && !options.isEmpty()) {
            m.put("options", options.values());
        }
        m.put("mode", (mode == null ? ScrollMode.PLAY : mode).name().toLowerCase(Locale.ROOT));
        if (tracked != null) {
            // Passed as a selector rather than an element reference: onScrollBind resolves it
            // in the browser, and an id is stable across the server round trip.
            String id = tracked.getElement().getAttribute("id");
            if (id == null || id.isEmpty()) {
                throw new IllegalArgumentException(
                        "the tracked component needs an id so the client can resolve it");
            }
            m.put("track", "#" + id);
        }
        if (readingProgress) {
            m.put("readingProgress", true);
        }
        host(component).getElement()
                .executeJs("this.onScrollBind($0, $1)", component.getElement(), Json.object(m));
    }

    /** Releases the {@link #onScroll} binding. */
    public static void clearScroll(Component component) {
        Objects.requireNonNull(component, "component");
        if (!component.isAttached()) {
            return;
        }
        host(component).getElement().executeJs("this.clearScroll($0)", component.getElement());
    }

    // ----------------------------------------------------------------- layout

    /** Binds FLIP reordering, 350ms by default. */
    public static <T extends Component & HasComponents> void layout(T container) {
        layout(container, 350);
    }

    /**
     * Binds FLIP list reordering: when children change position, they slide from their old
     * position to the new one instead of jumping.
     *
     * <p>Sorting, filtering and adding/removing rows are high-frequency operations in
     * enterprise apps, and an instant jump leaves users unable to tell whether a row moved
     * or was replaced. Bind once, then reorder data on the server as usual — nothing else
     * is required.
     *
     * <p>Persistent binding (observes DOM changes); repeat calls revert the previous instance.
     * Under {@code prefers-reduced-motion} positions change instantly without tweening.
     */
    public static <T extends Component & HasComponents> void layout(T container, int durationMs) {
        Objects.requireNonNull(container, "container");
        if (!container.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("duration", Math.max(0, durationMs));
        host(container).getElement()
                .executeJs("this.layout($0, $1)", container.getElement(), Json.object(m));
    }

    /** Releases the {@link #layout} binding. */
    public static <T extends Component & HasComponents> void clearLayout(T container) {
        Objects.requireNonNull(container, "container");
        if (!container.isAttached()) {
            return;
        }
        host(container).getElement().executeJs("this.clearLayout($0)", container.getElement());
    }

    // ------------------------------------------------------------------ count

    /** Integer count-up over 600ms. */
    public static void count(Component target, double from, double to) {
        count(target, from, to, 600, 0, null, null, false);
    }

    /**
     * Number count-up: smoothly counts the element text from {@code from} to {@code to}.
     *
     * <p>When a KPI jumps instantly users often fail to notice that it changed at all; the
     * count itself conveys both "this is changing" and "by how much". Set
     * {@code font-variant-numeric: tabular-nums} on the target, otherwise the width jitters
     * while counting.
     *
     * <p>Under {@code prefers-reduced-motion} the final value is shown immediately.
     *
     * @param decimals number of decimal places
     * @param prefix   prefix such as {@code "$"}
     * @param suffix   suffix such as {@code "%"}
     * @param grouping whether to add thousands separators
     */
    public static void count(Component target, double from, double to, int durationMs,
                             int decimals, String prefix, String suffix, boolean grouping) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", from);
        m.put("to", to);
        m.put("duration", Math.max(0, durationMs));
        m.put("decimals", Math.max(0, decimals));
        if (prefix != null && !prefix.isEmpty()) {
            m.put("prefix", prefix);
        }
        if (suffix != null && !suffix.isEmpty()) {
            m.put("suffix", suffix);
        }
        if (grouping) {
            m.put("grouping", true);
        }
        host(target).getElement()
                .executeJs("return this.count($0, $1)", target.getElement(), Json.object(m));
    }

    // ----------------------------------------------------------------- reveal

    /** Skeleton handover, 300ms by default. */
    public static void reveal(Component skeleton, Component content) {
        reveal(skeleton, content, 300, 8);
    }

    /**
     * Skeleton to content handover: the skeleton fades out while the content fades in and
     * lifts slightly.
     *
     * <p>Feels far more natural than swapping the DOM outright, which reads as a flash the
     * user cannot account for. The two animations overlap, so the total is roughly the
     * duration of one. The skeleton ends up {@code display:none}, after which the server can
     * safely remove it.
     *
     * @param liftPx how far the content lifts
     */
    public static void reveal(Component skeleton, Component content, int durationMs, int liftPx) {
        Objects.requireNonNull(content, "content");
        if (!content.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("duration", Math.max(0, durationMs));
        m.put("lift", liftPx);
        host(content).getElement().executeJs("return this.reveal($0, $1, $2)",
                skeleton == null ? null : skeleton.getElement(), content.getElement(), Json.object(m));
    }

    // ------------------------------------------------------------------ split

    /** Text split granularity. */
    public enum SplitBy { CHARS, WORDS, LINES }

    /** Reveals word by word with a 30ms gap between segments. */
    public static void splitIn(Component target) {
        splitIn(target, SplitBy.WORDS, 400, 30);
    }

    /**
     * Split text entrance: reveals by character, word or line in sequence.
     *
     * <p>The underlying {@code splitText} preserves accessibility by default — the original
     * text stays fully exposed to screen readers rather than degrading into a pile of
     * meaningless single-character nodes.
     *
     * <p>Note that this rewrites the internal structure of the target, so do not use it on
     * containers holding interactive child components.
     *
     * @param eachMs gap between segments
     */
    public static void splitIn(Component target, SplitBy by, int durationMs, int eachMs) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("by", (by == null ? SplitBy.WORDS : by).name().toLowerCase(Locale.ROOT));
        m.put("duration", Math.max(0, durationMs));
        m.put("each", Math.max(0, eachMs));
        host(target).getElement()
                .executeJs("return this.splitIn($0, $1)", target.getElement(), Json.object(m));
    }

    // ------------------------------------------------------------------ morph

    /**
     * SVG path morphing: smoothly reshapes a {@code <path>} {@code d} into a target shape.
     *
     * <p>Typically used for icon state changes (hamburger to close, play to pause). The
     * target must be a {@code <path>} element, or a wrapper containing one.
     *
     * @param targetPathD the {@code d} attribute of the target path
     */
    public static void morph(Component path, String targetPathD) {
        morph(path, targetPathD, 400);
    }

    /** As above, with an explicit duration. */
    public static void morph(Component path, String targetPathD, int durationMs) {
        morph(path, targetPathD, durationMs, 0);
    }

    /**
     * As above, with an explicit sampling precision.
     *
     * <p>{@code precision = 0} (the default) does not resample: it interpolates numerically
     * between the two {@code d} strings. That <b>requires both paths to share the same
     * command sequence</b> (for example {@code M-L-M-L} to {@code M-L-M-L}), but reproduces
     * the target shape exactly — no lost subpaths and no floating point noise.
     *
     * <p>If the two paths differ structurally (different point or command counts), pass a
     * positive value such as {@code 0.33} to enable arc-length resampling. The cost is that
     * subpath separators {@code M} are lost (several strokes collapse into one) and
     * intermediate frames carry long floating point tails. Icon toggles should almost always
     * stay isomorphic and use 0.
     */
    public static void morph(Component path, String targetPathD, int durationMs, double precision) {
        Objects.requireNonNull(path, "path");
        Objects.requireNonNull(targetPathD, "targetPathD");
        if (!path.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("to", targetPathD);
        m.put("duration", Math.max(0, durationMs));
        m.put("precision", Math.max(0, precision));
        host(path).getElement()
                .executeJs("return this.morph($0, $1)", path.getElement(), Json.object(m));
    }

    // --------------------------------------------------------------- sortable

    /** Binds drag-to-sort with a 220ms settle by default. */
    public static <T extends Component & HasComponents> void sortable(T container) {
        sortable(container, 220, null);
    }

    /**
     * Drag to sort: pick up an item to change its position while the others make room.
     *
     * <p>The client <b>handles pointer events itself</b> rather than reusing anime.js
     * {@code createDraggable}. That helper keeps its own internal offset and rewrites the
     * transform every frame, which conflicts with reordering the DOM: after a swap the
     * dragged item's resting position jumps by one slot, any external compensation is
     * overwritten on the next frame, and a single drag cascades into several swaps.
     * The hand-rolled implementation keeps the offset under its own control — right after a
     * swap it shifts the reference point by the same distance, so the on-screen position
     * stays continuous and the hit test is not re-triggered by its own side effect.
     *
     * <p>This orchestrates {@link #draggable} together with FLIP — neither alone can do
     * "drag to reorder": the former only follows the pointer, the latter only tweens, and
     * something still has to decide which slot the item was dragged into. Typical uses are
     * kanban boards, priority ordering and field configuration.
     *
     * <p><b>Always supply {@code onReorder}</b>: the client only changes DOM order, never the
     * server-side data model. Without it the new order is lost on the next page load. The
     * callback receives (originalIndex, newIndex).
     *
     * <p>Persistent binding; repeat calls revert the previous instance.
     */
    public static <T extends Component & HasComponents> void sortable(
            T container, int settleMs, SerializableBiConsumer<Integer, Integer> onReorder) {
        Objects.requireNonNull(container, "container");
        if (!container.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("duration", Math.max(0, settleMs));
        Element el = container.getElement();
        if (onReorder != null) {
            // In Vaadin 25 event data is a Jackson JsonNode (no longer elemental.json)
            el.addEventListener("sort-changed", e -> {
                JsonNode d = e.getEventData();
                onReorder.accept(
                        d.get("event.detail.from").asInt(),
                        d.get("event.detail.to").asInt());
            }).addEventData("event.detail.from").addEventData("event.detail.to");
        }
        host(container).getElement().executeJs("this.sortable($0, $1)", el, Json.object(m));
    }

    /** Releases the {@link #sortable} binding. */
    public static <T extends Component & HasComponents> void clearSortable(T container) {
        Objects.requireNonNull(container, "container");
        if (!container.isAttached()) {
            return;
        }
        host(container).getElement().executeJs("this.clearSortable($0)", container.getElement());
    }

    // ----------------------------------------------------------------- toggle

    /** Expands a panel over 250ms. */
    public static void expand(Component panel) {
        toggle(panel, true, 250);
    }

    /** Collapses a panel over 250ms. */
    public static void collapse(Component panel) {
        toggle(panel, false, 250);
    }

    /**
     * Expand / collapse a panel: transitions between 0 and the content's natural height.
     *
     * <p>{@code height: auto} cannot be transitioned in CSS, which is exactly where a library
     * has to step in. Unlike {@link MotionPreset#EXPAND} / {@link MotionPreset#COLLAPSE},
     * this method serves repeated opening and closing of the same element (accordions, detail
     * rows, filter panels) and plays no part in the remove flow. Once expanded the height is
     * handed back to {@code auto} so the panel adapts as its content changes.
     */
    public static void toggle(Component panel, boolean open, int durationMs) {
        Objects.requireNonNull(panel, "panel");
        if (!panel.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("open", open);
        m.put("duration", Math.max(0, durationMs));
        host(panel).getElement()
                .executeJs("return this.toggle($0, $1)", panel.getElement(), Json.object(m));
    }

    // ------------------------------------------------------------- motion path

    /** Follows a path over 1200ms without rotating. */
    public static void followPath(Component target, String pathD) {
        followPath(target, pathD, 1200, false);
    }

    /**
     * Motion along an SVG path: the element travels the given trajectory.
     *
     * <p>In enterprise back offices this is mostly used to illustrate a flow ("data moves
     * from A to B") and is closer to a demonstration than a workhorse.
     *
     * @param pathD  the SVG {@code d} of the trajectory, relative to the element's start
     * @param rotate whether the element should face along the tangent
     */
    public static void followPath(Component target, String pathD, int durationMs, boolean rotate) {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(pathD, "pathD");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("d", pathD);
        m.put("duration", Math.max(0, durationMs));
        if (rotate) {
            m.put("rotate", true);
        }
        host(target).getElement()
                .executeJs("return this.followPath($0, $1)", target.getElement(), Json.object(m));
    }

    // --------------------------------------------------------------- scramble

    /** Scrambles and resolves the current text over 1000ms. */
    public static void scramble(Component target) {
        scramble(target, null, 1000);
    }

    /**
     * Scramble text: characters flicker randomly, then settle one by one into the target.
     *
     * <p><b>Purely decorative; not recommended for enterprise back offices</b> — it slows
     * reading down and reads as frivolous. It exists for gamified interfaces and splash
     * screens, which is to say consumer-facing surfaces.
     *
     * @param text the final text; pass null to keep the element's current text
     */
    public static void scramble(Component target, String text, int durationMs) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        if (text != null) {
            m.put("text", text);
        }
        m.put("duration", Math.max(0, durationMs));
        host(target).getElement()
                .executeJs("return this.scramble($0, $1)", target.getElement(), Json.object(m));
    }

    // ------------------------------------------------------------- animatable

    /**
     * Creates a reactive animation target for high-frequency updates.
     *
     * <p>Unlike a one-shot animation this keeps an object you can write to repeatedly; every
     * {@link #animatableTo} call eases towards the new value. Suited to cursor following or
     * live data needles — anything with <b>frequent updates</b>, where calling a regular
     * animation over and over would keep creating new instances, hurting both performance
     * and the way it looks.
     *
     * <p>Persistent binding; repeat calls revert the previous instance.
     */
    public static void animatable(Component target, int durationMs) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("duration", Math.max(0, durationMs));
        host(target).getElement()
                .executeJs("this.animatable($0, $1)", target.getElement(), Json.object(m));
    }

    /**
     * Advances a progress bar to a fraction of its track.
     *
     * <p>The {@link MotionPreset#PROGRESS} preset always fills from empty to full, which suits a
     * bar tied to a known-length animation. Real work arrives in <b>uneven stages</b> — a
     * catalogue loads, a log replays — and each stage should move the bar on from wherever the
     * previous one stopped. That is what this does.
     *
     * <p>The target must carry {@code transform-origin: left center}, otherwise the bar grows
     * outwards from its centre rather than filling left to right.
     *
     * <p>Under {@code prefers-reduced-motion} the bar jumps straight to the new fraction.
     *
     * @param target     the bar element, not its track
     * @param fraction   how full the bar should end up, clamped to 0..1
     * @param durationMs how long to take getting there
     */
    public static void progressTo(Component target, double fraction, int durationMs) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("to", Math.max(0d, Math.min(1d, fraction)));
        m.put("duration", Math.max(0, durationMs));
        host(target).getElement()
                .executeJs("this.progressTo($0, $1)", target.getElement(), Json.object(m));
    }

    /** Updates the position of an {@link #animatable} target; safe to call at high frequency. */
    public static void animatableTo(Component target, double x, double y) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        host(target).getElement()
                .executeJs("this.animatableTo($0, $1, $2)", target.getElement(), x, y);
    }

    /** Releases the {@link #animatable} binding. */
    public static void clearAnimatable(Component target) {
        Objects.requireNonNull(target, "target");
        if (!target.isAttached()) {
            return;
        }
        host(target).getElement().executeJs("this.clearAnimatable($0)", target.getElement());
    }

    // ---------------------------------------------------------------- helpers

    static String spec(MotionPreset preset, MotionOptions options) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("preset", preset.key());
        if (options != null && !options.isEmpty()) {
            m.put("options", options.values());
        }
        return Json.object(m);
    }

    static MotionHost host(Component anchor) {
        UI ui = anchor.getUI().orElseGet(UI::getCurrent);
        if (ui == null) {
            throw new IllegalStateException("Component is not attached and there is no current UI");
        }
        return MotionHost.of(ui);
    }


    private static void requireKind(MotionPreset preset, MotionPreset.Kind... allowed) {
        Objects.requireNonNull(preset, "preset");
        for (MotionPreset.Kind k : allowed) {
            if (preset.kind() == k) {
                return;
            }
        }
        throw new IllegalArgumentException(preset + " is a " + preset.kind()
                + " preset and cannot be used here");
    }
}
