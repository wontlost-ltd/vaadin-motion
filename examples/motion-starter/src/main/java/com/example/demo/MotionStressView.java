package com.example.demo;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.router.Route;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionOptions;
import com.wontlost.motion.MotionPreset;

/**
 * Stress fixture for the vaadin-motion animation lifecycle, route /stress.
 *
 * <p>Covers two edges MotionDemoView never reaches:
 * <ul>
 *   <li><b>Rapid repeated remove clicks</b>: several exit animations started concurrently on
 *       the same component. {@code removeThen} only checks {@code isAttached()} on entry, and
 *       that check happens <b>before</b> the {@code executeJs} round trip — while the first
 *       click has not detached the element, a second click still passes, stacking a second
 *       exit animation and registering a second detach callback.</li>
 *   <li><b>Parent removeAll() mid-animation</b>: the container is cleared while the exit
 *       animation is still running, so the element leaves the document. The client's
 *       {@code el.isConnected} guard in {@code exit()} is evaluated <b>once on entry</b> and
 *       cannot catch a disconnect mid-flight; the safety net is {@code withTimeout} plus the
 *       {@code element.getParent() != null} check in the detach callback.</li>
 * </ul>
 *
 * <p>The {@code <span>} probes project server state into the DOM for Playwright to assert
 * against, without touching internals. Counters are held in arrays to avoid capturing
 * non-final locals in lambdas.
 */
@Route("stress")
public class MotionStressView extends VerticalLayout {

    /** Slow duration in ms, wide enough that "mid-animation" actions really land mid-flight. */
    private static final int SLOW_MS = 1500;

    public MotionStressView() {
        add(new H3("Motion stress test"));

        // Server-side probes
        Span removeClicks = new Span("0");
        removeClicks.setId("remove-clicks");
        Span detachCount = new Span("0");
        detachCount.setId("detach-count");
        Span cardChildren = new Span("-");
        cardChildren.setId("card-children");
        Span status = new Span("idle");
        status.setId("status");

        final int[] clicks = {0};
        final int[] detaches = {0};

        // ---------- Scenario 1: rapid repeated remove clicks ----------
        Div target = card("Rapid-click target", "click remove fast");
        target.setId("rapid-target");
        Motion.exit(target, MotionPreset.COLLAPSE, MotionOptions.duration(SLOW_MS));

        // Hold the current target in a one-element array: reset swaps in a new instance and
        // the button lambda must follow it, otherwise remove is called on the detached old
        // component and removeThen's isAttached guard simply returns.
        final Div[] current = { target };

        VerticalLayout rapidHost = new VerticalLayout(target);
        rapidHost.setId("rapid-host");
        rapidHost.setPadding(false);

        Button rapidRemove = new Button("Remove (click repeatedly)", e -> {
            clicks[0]++;
            removeClicks.setText(String.valueOf(clicks[0]));
            // removeThen's afterDetach fires once per settled exit; if several exits stacked
            // on the same element this counter would exceed 1, exposing the duplicate.
            Motion.removeThen(current[0], MotionPreset.COLLAPSE,
                    MotionOptions.duration(SLOW_MS),
                    () -> {
                        detaches[0]++;
                        detachCount.setText(String.valueOf(detaches[0]));
                        cardChildren.setText(String.valueOf(rapidHost.getComponentCount()));
                    });
        });
        rapidRemove.setId("btn-rapid-remove");

        Button resetRapid = new Button("Reset", e -> {
            rapidHost.removeAll();
            clicks[0] = 0;
            detaches[0] = 0;
            removeClicks.setText("0");
            detachCount.setText("0");
            Div fresh = card("Rapid-click target", "click remove fast");
            fresh.setId("rapid-target");
            Motion.exit(fresh, MotionPreset.COLLAPSE, MotionOptions.duration(SLOW_MS));
            rapidHost.add(fresh);
            current[0] = fresh;
            cardChildren.setText(String.valueOf(rapidHost.getComponentCount()));
        });
        resetRapid.setId("btn-reset-rapid");

        // ---------- Scenario 2: parent removeAll() mid-animation ----------
        VerticalLayout victimHost = new VerticalLayout();
        victimHost.setId("victim-host");
        victimHost.setPadding(false);
        for (int i = 1; i <= 3; i++) {
            Div v = card("Victim " + i, "in flight");
            v.setId("victim-" + i);
            Motion.exit(v, MotionPreset.COLLAPSE, MotionOptions.duration(SLOW_MS));
            victimHost.add(v);
        }

        // Start the exit animations, then clear the container while they are still running.
        Button startThenClear = new Button("Start, then removeAll immediately", e -> {
            status.setText("animating");
            victimHost.getChildren().forEach(c ->
                    Motion.remove(c, MotionPreset.COLLAPSE, MotionOptions.duration(SLOW_MS)));
            // Clear without waiting: the elements leave the document mid-animation.
            victimHost.removeAll();
            status.setText("cleared:" + victimHost.getComponentCount());
        });
        startThenClear.setId("btn-clear-mid-flight");

        Button refillVictims = new Button("Refill", e -> {
            victimHost.removeAll();
            for (int i = 1; i <= 3; i++) {
                Div v = card("Victim " + i, "in flight");
                v.setId("victim-" + i);
                Motion.exit(v, MotionPreset.COLLAPSE, MotionOptions.duration(SLOW_MS));
                victimHost.add(v);
            }
            status.setText("refilled:" + victimHost.getComponentCount());
        });
        refillVictims.setId("btn-refill");

        add(new HorizontalLayout(rapidRemove, resetRapid), rapidHost,
                new HorizontalLayout(startThenClear, refillVictims), victimHost,
                new HorizontalLayout(new Span("clicks:"), removeClicks,
                        new Span("detaches:"), detachCount,
                        new Span("children:"), cardChildren,
                        new Span("status:"), status));
    }

    private static Div card(String label, String value) {
        Div d = new Div(new Div(label), new Div(value));
        d.getStyle().set("padding", "var(--lumo-space-m)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-contrast-5pct)")
                .set("min-width", "140px");
        return d;
    }
}
