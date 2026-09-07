package com.example.demo;

import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionOptions;
import com.wontlost.motion.MotionPreset;

/**
 * Live incident metrics across the top of the console.
 *
 * <p>These numbers move because the queue moved, not on a timer. Two decisions matter:
 *
 * <ul>
 *   <li>Values <b>count</b> to their new figure instead of snapping. During an outage the
 *       engineer is watching the queue, not the metrics; a number that jumps while their eyes
 *       are elsewhere reads as though it was always that value. Counting leaves a trace.</li>
 *   <li>The first render does <b>not</b> animate. Everything counting up on arrival is noise —
 *       nothing has changed yet, so nothing should draw attention.</li>
 * </ul>
 */
final class MetricsStrip extends HorizontalLayout {

    private final Span open = value("0");
    private final Span sev1 = value("0");
    private final Span users = value("0");
    private final Span closed = value("0");

    private QueuePanel.QueueStats previous;

    MetricsStrip() {
        setWidthFull();
        setSpacing(true);
        open.setId("metric-open");
        sev1.setId("metric-sev1");
        users.setId("metric-users");
        closed.setId("metric-closed");

        add(card("Open incidents", open),
                card("SEV1 active", sev1),
                card("Users affected", users),
                card("Closed this shift", closed));

        // The cards enter as one group, which reads as "these four belong together and are
        // meant to be compared" rather than four unrelated figures.
        // <motion:metrics>
        addAttachListener(e ->
                Motion.stagger(this, MotionPreset.SLIDE_UP, MotionOptions.none().staggerEach(55)));
        // </motion:metrics>
    }

    /**
     * Applies a new snapshot.
     *
     * <p>Only the figures that actually moved are highlighted. Flashing all four on every change
     * would train the engineer to ignore the highlight entirely.
     */
    void apply(QueuePanel.QueueStats stats) {
        boolean first = previous == null;
        count(open, first ? 0 : previous.open(), stats.open(), first);
        count(sev1, first ? 0 : previous.sev1(), stats.sev1(), first);
        count(users, first ? 0 : previous.affectedUsers(), stats.affectedUsers(), first);
        count(closed,
                first ? 0 : previous.acknowledged() + previous.resolved(),
                stats.acknowledged() + stats.resolved(), first);
        previous = stats;
    }

    private void count(Span target, int from, int to, boolean first) {
        if (first) {
            // Group on the first render too. Motion.count applies separators while counting, so
            // formatting the seed differently would make the figure appear to gain a comma the
            // first time it happened to change.
            target.setText(format(to));
            return;
        }
        if (from == to) {
            return;   // Unchanged: no count, no highlight.
        }
        // <motion:metrics>
        Motion.count(target, from, to, 520, 0, null, null, to >= 1000);
        Motion.play(target, MotionPreset.HIGHLIGHT);
        // </motion:metrics>
    }

    /** Formats a figure the way Motion.count does, so seeded and counted values agree. */
    private static String format(int value) {
        return value >= 1000 ? String.format("%,d", value) : String.valueOf(value);
    }

    private static Span value(String initial) {
        Span s = new Span(initial);
        s.getStyle().set("font-size", "var(--lumo-font-size-xxl)")
                .set("font-weight", "600")
                // Without tabular figures the width jitters while counting.
                .set("font-variant-numeric", "tabular-nums")
                .set("display", "block")
                .set("border-radius", "var(--lumo-border-radius-s)");
        return s;
    }

    private static Div card(String label, Span value) {
        Span caption = new Span(label);
        caption.getStyle().set("color", "var(--lumo-secondary-text-color)")
                .set("font-size", "var(--lumo-font-size-s)");
        Div card = new Div(caption, value);
        card.getStyle().set("flex", "1")
                .set("padding", "var(--lumo-space-m)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-contrast-5pct)");
        return card;
    }
}
