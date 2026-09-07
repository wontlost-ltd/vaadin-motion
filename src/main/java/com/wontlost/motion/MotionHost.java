package com.wontlost.motion;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.ComponentUtil;
import com.vaadin.flow.component.Tag;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.dependency.JsModule;
import com.vaadin.flow.component.dependency.NpmPackage;
import com.vaadin.flow.dom.Element;

import java.util.Objects;

/**
 * Hidden client-side host, one per {@link UI}. It owns the anime.js
 * {@code createScope()} so that every animation started through this add-on is
 * reverted when the UI is torn down, and it exposes the {@code enter / exit /
 * stagger / timeline} entry points that {@link Motion} calls.
 *
 * <p>You normally never touch this class; {@link Motion} lazily attaches it to
 * the current UI. It is public only so the Vaadin frontend scanner picks up the
 * annotations and so applications can tweak {@link #setRespectReducedMotion}.</p>
 */
@Tag("vaadin-motion")
@JsModule("./vaadin-motion/vaadin-motion.ts")
@NpmPackage(value = "animejs", version = "^4.5.0")
@NpmPackage(value = "lit", version = "^3.3.3")
public class MotionHost extends Component {

    /** Keep in sync with the version field in vaadin-motion.ts */
    static final String VERSION = "1.0.0";

    private static final String UI_DATA_KEY = MotionHost.class.getName();

    private boolean respectReducedMotion = true;

    /** Use {@link #of(UI)}. */
    MotionHost() {
        getElement().setAttribute("hidden", true);
        getElement().setAttribute("aria-hidden", "true");
        syncReducedMotion();
    }

    /**
     * Returns the host attached to the given UI, creating and attaching it on
     * first use.
     */
    public static MotionHost of(UI ui) {
        Objects.requireNonNull(ui, "ui");
        Object existing = ComponentUtil.getData(ui, UI_DATA_KEY);
        if (existing instanceof MotionHost host && host.getUI().isPresent()) {
            return host;
        }
        MotionHost host = new MotionHost();
        ComponentUtil.setData(ui, UI_DATA_KEY, host);
        ui.getElement().appendChild(host.getElement());
        return host;
    }

    /** Shortcut for {@code of(UI.getCurrent())}. */
    public static MotionHost current() {
        UI ui = UI.getCurrent();
        if (ui == null) {
            throw new IllegalStateException(
                    "No current UI. Call Motion from a request thread or inside ui.access()");
        }
        return of(ui);
    }

    /**
     * When {@code true} (default) and the browser reports
     * {@code prefers-reduced-motion: reduce}, every animation completes instantly
     * while still applying its final state.
     */
    public void setRespectReducedMotion(boolean respect) {
        this.respectReducedMotion = respect;
        syncReducedMotion();
    }

    public boolean isRespectReducedMotion() {
        return respectReducedMotion;
    }

    private void syncReducedMotion() {
        getElement().setProperty("respectReducedMotion", respectReducedMotion);
    }

    Element target(Component c) {
        return c.getElement();
    }
}
