package com.example.demo;

import com.vaadin.flow.component.Html;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionOptions;
import com.wontlost.motion.MotionPreset;

import java.util.List;

/**
 * Service topology for the incident under investigation.
 *
 * <p>The dependency graph <b>draws itself</b> rather than appearing complete. During an outage
 * the engineer is reading this diagram for the first time, and watching the edges trace out
 * establishes the direction of the call chain — which service depends on which — far better
 * than a finished picture does.
 *
 * <p>A request probe then <b>travels the failing path</b>, showing where traffic actually goes
 * before it fails. That is the one place path motion earns its keep here: it is not decoration,
 * it answers "where does the request die?".
 *
 * <p>The panel's collapse control <b>morphs between chevron and cross</b>, and the panel body
 * itself expands and collapses to its natural height — the diagram is large, and an engineer
 * mid-incident needs to get it out of the way without losing their place.
 */
final class TopologyPanel extends VerticalLayout {

    /** Chevron pointing down; three strokes so it stays isomorphic with the cross below. */
    private static final String ICON_CHEVRON = "M6 10 L12 16 M12 16 L18 10 M12 16 L12 16";
    /** Cross with a degenerate third stroke, matching the chevron's command sequence exactly. */
    private static final String ICON_CROSS = "M7 7 L17 17 M7 17 L17 7 M12 12 L12 12";

    private static final String GRAPH_SVG = """
            <svg id="topology-graph" width="640" height="200" viewBox="0 0 640 200" fill="none"
                 xmlns="http://www.w3.org/2000/svg">
              <path d="M60 100 L150 100" stroke="var(--lumo-contrast-40pct)" stroke-width="2"/>
              <path d="M270 100 L370 62" stroke="var(--lumo-contrast-40pct)" stroke-width="2"/>
              <path d="M270 100 L370 140" stroke="var(--lumo-error-color)" stroke-width="2.5"/>
              <path d="M490 62 L560 62" stroke="var(--lumo-contrast-40pct)" stroke-width="2"/>
              <rect x="150" y="76" width="120" height="48" rx="6"
                    stroke="var(--lumo-primary-color)" stroke-width="2"/>
              <rect x="370" y="38" width="120" height="48" rx="6"
                    stroke="var(--lumo-primary-color)" stroke-width="2"/>
              <rect x="370" y="116" width="120" height="48" rx="6"
                    stroke="var(--lumo-error-color)" stroke-width="2.5"/>
              <text x="210" y="105" text-anchor="middle" font-size="13" font-weight="600"
                    fill="currentColor">checkout-api</text>
              <text x="430" y="67" text-anchor="middle" font-size="13" font-weight="600"
                    fill="currentColor">ledger-svc</text>
              <text x="430" y="145" text-anchor="middle" font-size="13" font-weight="600"
                    fill="currentColor">fraud-check</text>
              <text x="30" y="105" text-anchor="middle" font-size="12"
                    fill="var(--lumo-secondary-text-color)">edge</text>
              <text x="595" y="67" text-anchor="middle" font-size="12"
                    fill="var(--lumo-secondary-text-color)">postgres</text>
            </svg>
            """;

    /**
     * Stages of the traced request, shown one at a time as the probe travels.
     *
     * <p>Watching a dot move is not a diagnosis. Each leg is named and given a verdict, so the
     * animation and the text answer the same question together: where does the request die?
     */
    private static final List<String[]> TRACE_STEPS = List.of(
            new String[]{"1/3", "edge → checkout-api", "18 ms · 200 OK"},
            new String[]{"2/3", "checkout-api → fraud-check", "handshake started"},
            new String[]{"3/3", "fraud-check", "TLS failure — certificate expired"});

    private final Div body = new Div();
    private final Html icon = new Html("""
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                 xmlns="http://www.w3.org/2000/svg">
              <path id="topology-toggle-path" d="%s" stroke="var(--lumo-primary-color)"
                    stroke-width="2" stroke-linecap="round"/>
            </svg>
            """.formatted(ICON_CHEVRON));

    private final Span traceStep = new Span("Trace a request to see where it fails.");
    private boolean open = true;

    TopologyPanel() {
        setPadding(false);
        setSpacing(false);
        setWidthFull();

        Html graph = new Html(GRAPH_SVG);

        Div probe = new Div();
        probe.setId("topology-probe");
        probe.getStyle().set("width", "12px").set("height", "12px")
                .set("border-radius", "50%")
                .set("background", "var(--lumo-primary-color)")
                .set("position", "absolute")
                .set("top", "94px").set("left", "54px");

        Div stage = new Div(graph, probe);
        stage.getStyle().set("position", "relative");

        Button redraw = new Button("Redraw graph", e -> Motion.draw(graph, 1100, false));
        redraw.setId("btn-redraw");
        redraw.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

        Button trace = new Button("Trace failing request", e -> runTrace(probe));
        trace.setId("btn-trace");
        trace.addThemeVariants(ButtonVariant.LUMO_SMALL);

        Span legend = new Span("Red edge and node: the dependency currently failing.");
        legend.getStyle().set("color", "var(--lumo-secondary-text-color)")
                .set("font-size", "var(--lumo-font-size-s)");

        traceStep.setId("trace-step");
        traceStep.getStyle().set("display", "block")
                .set("font-family", "monospace")
                .set("font-size", "var(--lumo-font-size-s)")
                .set("padding", "var(--lumo-space-s) var(--lumo-space-m)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-contrast-5pct)")
                .set("color", "var(--lumo-secondary-text-color)");

        body.setId("topology-body");
        body.add(stage, new HorizontalLayout(redraw, trace), traceStep, legend);
        body.getStyle().set("overflow", "hidden");

        add(header(), new CodePeek("TopologyPanel.java", "topology"), body);

        // Draw once on entry so the engineer sees the call chain build up rather than
        // arriving as a finished picture.
        // <motion:topology>
        graph.addAttachListener(e -> Motion.draw(graph, 1200, false));
        // </motion:topology>
    }

    /**
     * Runs the probe along the failing path, narrating each leg as it goes.
     *
     * <p>The legs are timed to the animation so the caption always describes where the probe
     * currently is. The final leg is left on screen: it is the answer the engineer came for.
     */
    private void runTrace(Div probe) {
        // Reset to the edge before each run, otherwise a second trace starts from the failure.
        probe.getStyle().set("transform", "none");
        announce(0);

        // Leg 1: edge → checkout-api (x 60→150). Leg 2: through the service (→270).
        // Leg 3: down the failing edge into fraud-check (→370, y +40).
        // <motion:topology>
        Motion.followPath(probe, "M0 0 L90 0 L210 0 L310 40", 2400, false);
        // </motion:topology>

        for (int i = 1; i < TRACE_STEPS.size(); i++) {
            int step = i;
            // A zero-width timeline on the probe would cancel the path animation, so the legs
            // are timed off the caption element instead.
            Motion.timeline()
                    .add(traceStep, MotionPreset.FADE_IN,
                            MotionOptions.duration(step * 900))
                    .onComplete(() -> announce(step))
                    .play();
        }
    }

    private void announce(int step) {
        String[] s = TRACE_STEPS.get(step);
        traceStep.setText(s[0] + "  " + s[1] + "  ·  " + s[2]);
        boolean failure = step == TRACE_STEPS.size() - 1;
        traceStep.getStyle()
                .set("color", failure ? "var(--lumo-error-text-color)" : "var(--lumo-secondary-text-color)")
                .set("background", failure ? "var(--lumo-error-color-10pct)" : "var(--lumo-contrast-5pct)");
    }

    private HorizontalLayout header() {
        H3 title = new H3("Service topology");
        title.getStyle().set("margin", "0");

        Div toggle = new Div(icon);
        toggle.setId("topology-toggle");
        toggle.getElement().setAttribute("role", "button");
        toggle.getElement().setAttribute("tabindex", "0");
        toggle.getElement().setAttribute("aria-label", "Collapse topology");
        toggle.getStyle().set("display", "inline-flex")
                .set("cursor", "pointer")
                .set("padding", "var(--lumo-space-xs)")
                .set("border-radius", "var(--lumo-border-radius-m)");

        toggle.getElement().addEventListener("click", e -> toggle(toggle));
        toggle.getElement().addEventListener("keydown", e -> toggle(toggle))
                .setFilter("event.key === 'Enter' || event.key === ' '");

        HorizontalLayout bar = new HorizontalLayout(title, toggle);
        bar.setWidthFull();
        bar.setAlignItems(com.vaadin.flow.component.orderedlayout.FlexComponent.Alignment.CENTER);
        bar.expand(title);
        return bar;
    }

    private void toggle(Div toggleButton) {
        open = !open;
        // <motion:topology>
        Motion.toggle(body, open, 260);
        // The icon shape carries the state, so the accessible label must track it too.
        Motion.morph(icon, open ? ICON_CHEVRON : ICON_CROSS, 300);
        // </motion:topology>
        toggleButton.getElement().setAttribute("aria-label",
                open ? "Collapse topology" : "Expand topology");
    }
}
