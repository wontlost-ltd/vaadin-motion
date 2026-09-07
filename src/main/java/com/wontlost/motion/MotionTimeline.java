package com.wontlost.motion;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.dom.Element;
import com.vaadin.flow.function.SerializableRunnable;

import java.io.Serializable;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Fluent timeline across any number of components. Built on the server, sent to
 * the client in one round trip, and reported back once via {@link #onComplete}.
 *
 * <p>Position syntax follows anime.js v4 timeline positions:</p>
 * <ul>
 *   <li>{@code null} — after the previous step (default)</li>
 *   <li>{@code "-=100"} / {@code "+=100"} — relative to the previous step's end</li>
 *   <li>{@code "<"} — aligned with the previous step's start</li>
 *   <li>{@code "<<"} — aligned with the timeline start</li>
 *   <li>a number of milliseconds as string, e.g. {@code "300"} — absolute</li>
 * </ul>
 */
public final class MotionTimeline implements Serializable {

    private record Step(Component component, MotionPreset preset, MotionOptions options, String position)
            implements Serializable { }

    private final List<Step> steps = new ArrayList<>();
    private final List<SerializableRunnable> completeListeners = new ArrayList<>();
    private MotionOptions defaults = MotionOptions.none();
    private boolean played;

    MotionTimeline() { }

    public MotionTimeline add(Component component, MotionPreset preset) {
        return add(component, preset, MotionOptions.none(), null);
    }

    public MotionTimeline add(Component component, MotionPreset preset, String position) {
        return add(component, preset, MotionOptions.none(), position);
    }

    public MotionTimeline add(Component component, MotionPreset preset, MotionOptions options) {
        return add(component, preset, options, null);
    }

    public MotionTimeline add(Component component, MotionPreset preset, MotionOptions options, String position) {
        Objects.requireNonNull(component, "component");
        Objects.requireNonNull(preset, "preset");
        steps.add(new Step(component, preset, options == null ? MotionOptions.none() : options, position));
        return this;
    }

    /** Defaults (duration / ease) applied to every step unless the step overrides them. */
    public MotionTimeline defaults(MotionOptions defaults) {
        this.defaults = defaults == null ? MotionOptions.none() : defaults;
        return this;
    }

    public MotionTimeline onComplete(SerializableRunnable listener) {
        completeListeners.add(Objects.requireNonNull(listener, "listener"));
        return this;
    }

    public int size() {
        return steps.size();
    }

    /**
     * Sends the timeline to the client and plays it. Steps whose component is not
     * attached are skipped. May be called once.
     */
    public void play() {
        if (played) {
            throw new IllegalStateException("A MotionTimeline can only be played once; build a new one");
        }
        played = true;
        List<Step> live = steps.stream().filter(s -> s.component().isAttached()).toList();
        if (live.isEmpty()) {
            completeListeners.forEach(SerializableRunnable::run);
            return;
        }
        MotionHost host = Motion.host(live.get(0).component());
        Serializable[] params = new Serializable[live.size() + 1];
        params[0] = toJson(live);
        for (int i = 0; i < live.size(); i++) {
            params[i + 1] = live.get(i).component().getElement();
        }
        host.getElement().executeJs(jsExpression(live.size()), params)
                .then(String.class,
                        ignored -> completeListeners.forEach(SerializableRunnable::run),
                        error -> completeListeners.forEach(SerializableRunnable::run));
    }

    /** {@code return this.timeline($0, $1, ..., $n)} */
    static String jsExpression(int elementCount) {
        StringBuilder sb = new StringBuilder("return this.timeline($0");
        for (int i = 1; i <= elementCount; i++) {
            sb.append(", $").append(i);
        }
        return sb.append(')').toString();
    }

    private String toJson(List<Step> live) {
        Map<String, Object> root = new LinkedHashMap<>();
        if (!defaults.isEmpty()) {
            root.put("defaults", defaults.values());
        }
        List<Map<String, Object>> stepJson = new ArrayList<>();
        for (int i = 0; i < live.size(); i++) {
            Step s = live.get(i);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("target", i);
            m.put("preset", s.preset().key());
            if (!s.options().isEmpty()) {
                m.put("options", s.options().values());
            }
            if (s.position() != null) {
                m.put("position", s.position());
            }
            stepJson.add(m);
        }
        root.put("steps", stepJson);
        return Json.object(root);
    }

    /** Visible for tests. */
    String toJsonForTest() {
        return toJson(steps);
    }

    /** Visible for tests. */
    List<Element> elementsForTest() {
        return steps.stream().map(s -> s.component().getElement()).toList();
    }
}
