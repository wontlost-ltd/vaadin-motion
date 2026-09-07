package com.wontlost.motion;

import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Optional overrides applied on top of a {@link MotionPreset}. Immutable; every
 * {@code withX} returns a copy.
 *
 * <pre>
 * Motion.enter(card, MotionPreset.SLIDE_UP, MotionOptions.duration(250).ease("outCubic"));
 * </pre>
 */
public final class MotionOptions implements Serializable {

    /** Stagger origin, see anime.js {@code stagger(each, { from })}. */
    public enum From { FIRST, LAST, CENTER }

    private static final MotionOptions NONE = new MotionOptions(new LinkedHashMap<>());

    private final Map<String, Object> values;

    private MotionOptions(Map<String, Object> values) {
        this.values = values;
    }

    public static MotionOptions none() {
        return NONE;
    }

    public static MotionOptions duration(int millis) {
        return NONE.withDuration(millis);
    }

    public MotionOptions withDuration(int millis) {
        return with("duration", requireNonNegative(millis, "duration"));
    }

    public MotionOptions withDelay(int millis) {
        return with("delay", requireNonNegative(millis, "delay"));
    }

    /** anime.js v4 easing name, e.g. {@code outQuad}, {@code inOutCubic}, {@code outBack}. */
    public MotionOptions ease(String ease) {
        if (ease == null || ease.isBlank()) {
            throw new IllegalArgumentException("ease must not be blank");
        }
        return with("ease", ease);
    }

    /**
     * Replaces the easing curve with a physical spring.
     *
     * <p>A spring derives its own duration from stiffness/damping/mass, so it <b>overrides</b>
     * any duration set on these options. Good for drag release or modal entrances where the
     * motion should feel like it has weight; regular entrances stay more restrained with easing.
     *
     * @param stiffness higher is faster (default 100)
     * @param damping   higher means less bounce (default 10)
     */
    public MotionOptions spring(double stiffness, double damping) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("stiffness", stiffness);
        s.put("damping", damping);
        return with("spring", s);
    }

    /** Preset spring with a slight bounce, suitable for most interaction feedback. */
    public MotionOptions spring() {
        return spring(120, 14);
    }

    /** Gap between siblings in {@link Motion#stagger}. */
    public MotionOptions staggerEach(int millis) {
        return with("each", requireNonNegative(millis, "each"));
    }

    public MotionOptions staggerFrom(From from) {
        return with("from", from.name().toLowerCase());
    }

    /**
     * Escape hatch: a JSON object of raw anime.js parameters merged last.
     * Use sparingly — it bypasses the preset's restraint.
     */
    public MotionOptions raw(String json) {
        if (json == null || json.isBlank()) {
            throw new IllegalArgumentException("raw json must not be blank");
        }
        return with("raw", new Json.Raw(json));
    }

    private MotionOptions with(String key, Object value) {
        Map<String, Object> copy = new LinkedHashMap<>(values);
        copy.put(key, value);
        return new MotionOptions(copy);
    }

    private static int requireNonNegative(int v, String name) {
        if (v < 0) {
            throw new IllegalArgumentException(name + " must be >= 0");
        }
        return v;
    }

    boolean isEmpty() {
        return values.isEmpty();
    }

    Map<String, Object> values() {
        return values;
    }

    /** JSON object as sent to the client. Package-private, used by {@link Motion}. */
    String toJson() {
        return Json.object(values);
    }

    @Override
    public String toString() {
        return "MotionOptions" + toJson();
    }
}
