package com.wontlost.motion;

/**
 * Built-in, deliberately restrained presets. Every preset is defined once on the
 * client (see {@code presets.ts}); the Java side only carries the key.
 *
 * <p>Presets are grouped by intent so the API guides usage:</p>
 * <ul>
 *   <li>{@link Kind#ENTER} — for {@link Motion#enter} and {@link Motion#stagger}</li>
 *   <li>{@link Kind#EXIT} — for {@link Motion#exit} / {@link Motion#remove}</li>
 *   <li>{@link Kind#ATTENTION} — one-off feedback on an already visible component</li>
 * </ul>
 */
public enum MotionPreset {

    FADE_IN("fadeIn", Kind.ENTER),
    SLIDE_UP("slideUp", Kind.ENTER),
    SLIDE_DOWN("slideDown", Kind.ENTER),
    SLIDE_IN_LEFT("slideInLeft", Kind.ENTER),
    SLIDE_IN_RIGHT("slideInRight", Kind.ENTER),
    SCALE_IN("scaleIn", Kind.ENTER),
    EXPAND("expand", Kind.ENTER),

    FADE_OUT("fadeOut", Kind.EXIT),
    SLIDE_OUT_UP("slideOutUp", Kind.EXIT),
    SLIDE_OUT_DOWN("slideOutDown", Kind.EXIT),
    SLIDE_OUT_LEFT("slideOutLeft", Kind.EXIT),
    SLIDE_OUT_RIGHT("slideOutRight", Kind.EXIT),
    SCALE_OUT("scaleOut", Kind.EXIT),
    COLLAPSE("collapse", Kind.EXIT),

    SHAKE("shake", Kind.ATTENTION),
    PULSE("pulse", Kind.ATTENTION),
    HIGHLIGHT("highlight", Kind.ATTENTION),

    /**
     * Horizontal fill (scaleX 0 to 1), intended for {@link Motion.ScrollMode#SYNC} progress bars.
     *
     * <p>Callers must set {@code transform-origin: left center} themselves, otherwise the bar
     * grows outwards from its centre. It is classified as ENTER only to satisfy the kind check
     * in {@code onScroll} — this is not a regular entrance animation, and playing it on its own
     * simply fills from 0 to 1 once.
     */
    PROGRESS("progress", Kind.ENTER);

    /** Intent of a preset. */
    public enum Kind { ENTER, EXIT, ATTENTION }

    private final String key;
    private final Kind kind;

    MotionPreset(String key, Kind kind) {
        this.key = key;
        this.kind = kind;
    }

    /** Client-side preset key. */
    public String key() {
        return key;
    }

    public Kind kind() {
        return kind;
    }

    /** Preset used when none is registered for {@link Motion#remove}. */
    public static MotionPreset defaultExit() {
        return FADE_OUT;
    }

    /** Preset used by {@link Motion#enter} / {@link Motion#stagger} when none is given. */
    public static MotionPreset defaultEnter() {
        return SLIDE_UP;
    }
}
