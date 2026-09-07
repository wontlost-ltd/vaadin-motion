package com.example.demo;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.tabs.Tab;
import com.vaadin.flow.component.tabs.Tabs;
import com.vaadin.flow.router.Route;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionPreset;

/**
 * Sentinel Ops — an incident response console, and the application's only route.
 *
 * <p>The console opens on a boot screen, then hands over to the working surface: metrics across
 * the top, and three tabs beneath — the live queue, the service topology for the incident under
 * investigation, and the postmortem record. A war-room board sits alongside for free-form
 * triage notes.
 *
 * <p><b>On motion in this application.</b> Every animation here answers a question the engineer
 * would otherwise have to reconstruct — which row did I just action, what changed while I was
 * looking away, which service does this one call. Nothing animates because it can:
 *
 * <ul>
 *   <li>Tab switching is instant. It happens constantly and any delay would be felt.</li>
 *   <li>Sorting and filtering only tween positions (FLIP); no fades, no scaling.</li>
 *   <li>Typing is never animated.</li>
 *   <li>Metrics only animate the figures that actually moved.</li>
 * </ul>
 *
 * <p>Under {@code prefers-reduced-motion} every duration collapses to zero while the business
 * logic and callback ordering stay identical, so no separate code path is needed.
 */
@Route("")
public class ConsoleView extends VerticalLayout {

    private final MetricsStrip metrics = new MetricsStrip();
    private final Div panelHost = new Div();
    private final Div console = new Div();
    private final BootScreen bootScreen = new BootScreen(v -> revealConsole());

    private Component queueTabContent;
    private Component topologyTabContent;
    private Component postmortemTabContent;
    private Component warRoomTabContent;

    public ConsoleView() {
        // Width only, deliberately not setSizeFull(). A full-height root is pinned to exactly
        // 100% of the viewport, so a panel taller than the window (the postmortem record) gets
        // compressed to fit instead of extending the document — and with the document never
        // taller than the window, the page has nothing to scroll.
        setWidthFull();
        setPadding(false);
        setSpacing(false);
        // A wider gutter than the default Lumo padding: the console is a dense, full-width
        // surface, and text running to the window edge is tiring to scan. Capped so the tables
        // do not stretch to absurd line lengths on very wide monitors, and centred within
        // whatever space is left.
        getStyle().set("padding", "var(--lumo-space-l) clamp(var(--lumo-space-m), 4vw, 96px)")
                .set("box-sizing", "border-box")
                .set("max-width", "1800px")
                .set("margin", "0 auto");

        console.setId("console-root");
        console.setVisible(false);
        console.getStyle().set("width", "100%");

        add(bootScreen, console);
    }

    /** Swaps the boot screen for the working console once the boot sequence finishes. */
    private void revealConsole() {
        bootScreen.dismiss(() -> {
            buildConsole();
            console.setVisible(true);
            // The console arrives as a unit rather than piece by piece: the engineer is here to
            // work, not to watch it assemble.
            Motion.play(console, MotionPreset.FADE_IN);
        });
    }

    private void buildConsole() {
        H2 title = new H2("Sentinel Ops");
        title.getStyle().set("margin", "0");
        Span shift = new Span("On call: platform · shift 09:00–17:00");
        shift.getStyle().set("color", "var(--lumo-secondary-text-color)");

        Div header = new Div(title, shift);
        header.getStyle().set("margin-bottom", "var(--lumo-space-m)");

        // Rebuild the queue with a live callback into the metrics strip.
        QueuePanel liveQueue = new QueuePanel(metrics::apply);
        queueTabContent = liveQueue;
        topologyTabContent = new TopologyPanel();
        postmortemTabContent = new PostmortemPanel();
        warRoomTabContent = new WarRoomPanel();

        Tab queueTab = new Tab("Queue");
        queueTab.setId("tab-queue");
        Tab topologyTab = new Tab("Topology");
        topologyTab.setId("tab-topology");
        Tab postmortemTab = new Tab("Postmortem");
        postmortemTab.setId("tab-postmortem");
        Tab warRoomTab = new Tab("War room");
        warRoomTab.setId("tab-warroom");

        Tabs tabs = new Tabs(queueTab, topologyTab, postmortemTab, warRoomTab);
        tabs.setId("console-tabs");
        tabs.setWidthFull();

        panelHost.setId("panel-host");
        panelHost.getStyle().set("width", "100%")
                .set("padding-top", "var(--lumo-space-m)");

        // Switching tabs is instant. Persistent bindings (FLIP, sortable, scroll, draggable,
        // animatable) rebind on attach, so tearing a panel down and rebuilding it is safe.
        tabs.addSelectedChangeListener(e -> {
            panelHost.removeAll();
            Tab selected = e.getSelectedTab();
            if (selected == topologyTab) {
                panelHost.add(topologyTabContent);
            } else if (selected == postmortemTab) {
                panelHost.add(postmortemTabContent);
            } else if (selected == warRoomTab) {
                panelHost.add(warRoomTabContent);
            } else {
                panelHost.add(queueTabContent);
            }
        });
        panelHost.add(queueTabContent);

        // Each panel gets the full page width. Previously the war room occupied a fixed right
        // column on every tab, which both squeezed the tables into ~60% of the window and left
        // a large empty area under it on the tabs that needed less vertical space.
        Div content = new Div(tabs, panelHost);
        content.getStyle().set("width", "100%");

        console.add(header, metrics, BootScreen.spacer(), content);

        liveQueue.publishInitialStats();
    }

}
