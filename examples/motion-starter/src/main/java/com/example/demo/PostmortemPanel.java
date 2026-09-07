package com.example.demo;

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
 * Postmortem timeline for the resolved incident.
 *
 * <p>A postmortem is read top to bottom, once, by someone reconstructing what happened. Two
 * pieces of motion serve that:
 *
 * <ul>
 *   <li>A <b>reading progress bar</b> tied to scroll position. Postmortems are long and are
 *       often read during a review meeting; knowing how much is left is genuinely useful.</li>
 *   <li>Each entry <b>surfaces as it enters the viewport</b>, which paces the reading and stops
 *       the wall of text landing all at once.</li>
 * </ul>
 *
 * <p>While the record is still being assembled the panel shows a <b>skeleton</b>, then hands over
 * to real content. Swapping the DOM outright reads as a flash the reader cannot account for;
 * the handover makes it clear that data arrived.
 */
final class PostmortemPanel extends VerticalLayout {

    private final Div skeleton = new Div();
    private final VerticalLayout content = new VerticalLayout();

    PostmortemPanel() {
        setPadding(false);
        setSpacing(false);
        setWidthFull();

        H3 title = new H3("Postmortem — INC-1001");
        title.getStyle().set("margin", "0 0 var(--lumo-space-xs) 0");

        Span note = new Span("Draft record. Scroll to read; the bar above tracks your position.");
        note.getStyle().set("color", "var(--lumo-secondary-text-color)")
                .set("display", "block")
                .set("margin-bottom", "var(--lumo-space-m)");

        Div bar = new Div();
        bar.setId("reading-progress");
        bar.getStyle().set("height", "4px")
                .set("border-radius", "2px")
                .set("background", "var(--lumo-primary-color)")
                // PROGRESS scales along X, so the origin must be the left edge or the bar
                // would grow outwards from its centre.
                .set("transform-origin", "left center")
                .set("width", "100%");
        Div track = new Div(bar);
        // The track needs an explicit width: as a plain Div inside a VerticalLayout it has no
        // intrinsic width, and the bar inside it measured zero — making the progress
        // unreadable even though the animation itself was running.
        track.setWidthFull();
        track.getStyle().set("background", "var(--lumo-contrast-10pct)")
                .set("border-radius", "2px")
                .set("margin-bottom", "var(--lumo-space-m)");

        buildSkeleton();
        buildContent();

        Button reload = new Button("Reload record", e -> {
            skeleton.getStyle().set("display", "block");
            content.getStyle().set("opacity", "0");
            Motion.reveal(skeleton, content, 340, 10);
        });
        reload.setId("btn-reload-postmortem");
        reload.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

        add(title, note, track, new HorizontalLayout(reload),
                new CodePeek("PostmortemPanel.java", "postmortem"), skeleton, content);

        // Track the record, not the bar. The bar is pinned near the top of the panel, so
        // tracking itself made it read ~49% before the reader had scrolled anywhere and only
        // ~87% at the end of the text. Measured against the content it spans empty to full.
        // Tracks the record rather than the bar: the bar is pinned near the top of the panel,
        // so tracking itself made it read part-full before the reader had scrolled anywhere.
        // <motion:postmortem>
        bar.addAttachListener(e -> Motion.onScroll(bar, MotionPreset.PROGRESS,
                MotionOptions.none(), Motion.ScrollMode.SYNC, content, true));
        // </motion:postmortem>
        // Show the handover on first view too, so the panel demonstrates its own loading state.
        // <motion:postmortem>
        content.addAttachListener(e -> Motion.reveal(skeleton, content, 340, 10));
        // </motion:postmortem>
    }

    private void buildSkeleton() {
        skeleton.setId("postmortem-skeleton");
        for (int i = 0; i < 4; i++) {
            Div line = new Div();
            line.getStyle().set("height", "14px")
                    .set("width", (100 - i * 12) + "%")
                    .set("margin-bottom", "var(--lumo-space-s)")
                    .set("border-radius", "7px")
                    .set("background", "var(--lumo-contrast-10pct)");
            skeleton.add(line);
        }
    }

    private void buildContent() {
        content.setId("postmortem-content");
        content.setPadding(false);
        content.setSpacing(false);
        content.setWidthFull();
        content.getStyle().set("opacity", "0");   // reveal() takes over from here

        List<String[]> entries = List.of(
                new String[]{"09:42", "Alert fired",
                        "Error rate on /charge crossed 5% over 2 minutes. Paging policy matched "
                        + "the payments rotation and the SEV1 runbook was attached automatically."},
                new String[]{"09:44", "Paged on-call",
                        "SEV1 declared; payments on-call acknowledged within 90 seconds and opened "
                        + "the incident channel."},
                new String[]{"09:47", "Customer impact confirmed",
                        "Support reported card declines from three enterprise accounts. Status page "
                        + "moved to 'partial outage' for checkout."},
                new String[]{"09:51", "Scope established",
                        "Failures isolated to the fraud-check dependency. The ledger path and the "
                        + "search indexer were unaffected throughout."},
                new String[]{"09:55", "First hypothesis discarded",
                        "A recent deploy to checkout-api was suspected and rolled back; the error "
                        + "rate did not move, ruling out the release."},
                new String[]{"09:58", "Mitigation applied",
                        "Fraud check bypassed with a static allow rule, accepting the documented "
                        + "risk for low-value transactions while the cause was found."},
                new String[]{"10:05", "Error rate recovered",
                        "Charge success returned to baseline. Status page updated; the incident "
                        + "stayed open pending root cause."},
                new String[]{"10:20", "Root cause found",
                        "Expired client certificate on the fraud-check edge. The certificate had "
                        + "been renewed but never redeployed to the edge fleet."},
                new String[]{"10:31", "Renewal gap understood",
                        "The rotation job wrote the new certificate to the vault but had no step to "
                        + "restart the edge listeners, so the old one stayed loaded in memory."},
                new String[]{"10:44", "Certificate rotated",
                        "New certificate deployed and the edge listeners restarted; the bypass rule "
                        + "was removed and full fraud checking resumed."},
                new String[]{"10:52", "Verification",
                        "Synthetic charges through all three regions succeeded. Fraud-check latency "
                        + "and error rate matched the pre-incident baseline."},
                new String[]{"11:02", "Incident closed",
                        "Monitoring stable for 30 minutes. Follow-up actions filed: alert on "
                        + "certificate age, and a restart step added to the rotation job."});

        int index = 0;
        for (String[] e : entries) {
            Div entry = entry(e[0], e[1], e[2]);
            entry.setId("pm-entry-" + (++index));
            // Each entry surfaces on entering the viewport, pacing the read.
            // <motion:postmortem>
            entry.addAttachListener(ev -> Motion.onScroll(entry, MotionPreset.SLIDE_UP,
                    MotionOptions.none(), Motion.ScrollMode.PLAY));
            // </motion:postmortem>
            content.add(entry);
        }
    }

    private static Div entry(String time, String headline, String detail) {
        Span t = new Span(time);
        t.getStyle().set("font-family", "monospace")
                .set("font-variant-numeric", "tabular-nums")
                .set("color", "var(--lumo-primary-color)");

        Span h = new Span(headline);
        h.getStyle().set("font-weight", "600");

        Span d = new Span(detail);
        d.getStyle().set("color", "var(--lumo-secondary-text-color)");

        // A grid rather than a HorizontalLayout of min-width hints: the layout sized itself to
        // its own text, so every entry ended at a different right edge and the timeline read as
        // a staircase. Fixed tracks make time and headline line up down the column, and the
        // entry fills the available width.
        Div box = new Div(t, h, d);
        box.getStyle().set("display", "grid")
                .set("grid-template-columns", "60px 190px minmax(0, 1fr)")
                .set("gap", "var(--lumo-space-m)")
                .set("align-items", "baseline")
                .set("width", "100%")
                .set("box-sizing", "border-box")
                .set("padding", "var(--lumo-space-m)")
                .set("margin-bottom", "var(--lumo-space-s)")
                .set("border-left", "2px solid var(--lumo-contrast-20pct)")
                .set("background", "var(--lumo-contrast-5pct)")
                .set("border-radius", "0 var(--lumo-border-radius-m) var(--lumo-border-radius-m) 0");
        return box;
    }
}
