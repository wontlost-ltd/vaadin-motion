package com.example.demo;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.notification.NotificationVariant;
import com.vaadin.flow.component.orderedlayout.FlexComponent;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionOptions;
import com.wontlost.motion.MotionPreset;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * The live incident queue — the surface an on-call engineer actually works in.
 *
 * <p>Motion here answers questions the engineer would otherwise have to reconstruct:
 *
 * <ul>
 *   <li>A new page arriving <b>slides in</b> rather than appearing, so a row that was not there
 *       a second ago is distinguishable from one that was.</li>
 *   <li>Acknowledging or resolving <b>slides the row out in the matching direction</b> before it
 *       leaves, so the engineer can confirm which incident they just actioned. Direction carries
 *       the meaning: acknowledged moves right into the active column, resolved leaves left.</li>
 *   <li>Reordering by hand <b>tweens the other rows out of the way</b>, so the queue reads as
 *       one list being rearranged rather than redrawn.</li>
 *   <li>Attempting to acknowledge a SEV1 <b>shakes the row</b>. A SEV1 pages a human; it cannot
 *       be silently acknowledged, and a shake is noticed faster than text alone. The text is
 *       still shown — the animation supplements the message, it is never the only carrier.</li>
 * </ul>
 *
 * <p>Sorting and filtering are deliberately <i>not</i> animated beyond the FLIP reorder, and
 * typing is never animated: those are high-frequency actions where motion only adds latency.
 */
final class QueuePanel extends VerticalLayout {

    /**
     * Column tracks shared by the header and every row.
     *
     * <p>Defined once and applied to both: a row built from an auto-sized HorizontalLayout takes
     * its widths from its own text, so no two rows agree on where a column starts and the table
     * reads as a staircase. A grid template makes the columns a property of the table rather
     * than of each row's content.
     */
    private static final String COLUMNS =
            "24px 56px 92px 150px minmax(0, 1fr) 58px 210px";

    /** Live incidents in display order. The engineer may reorder this by dragging. */
    private final List<Incident> queue = new ArrayList<>(seed());
    /** Rows cached by incident id so FLIP sees the same elements change places. */
    private final Map<String, Component> rowCache = new LinkedHashMap<>();

    private final VerticalLayout list = new VerticalLayout();
    private final Span emptyHint = new Span("Queue clear — no open incidents.");
    private final Consumer<QueueStats> onChange;

    private int pageCounter = 4;
    private int acknowledged;
    private int resolved;

    /** Snapshot handed to the metrics strip after every mutation. */
    record QueueStats(int open, int sev1, int acknowledged, int resolved, int affectedUsers) { }

    QueuePanel(Consumer<QueueStats> onChange) {
        this.onChange = onChange;
        setPadding(false);
        setSpacing(false);
        setWidthFull();

        list.setId("incident-queue");
        list.setPadding(false);
        list.setSpacing(false);
        list.setWidthFull();
        // Stretch rows to the full list width. Without this the layout's default
        // align-items:flex-start sizes every row to its own content, so the grid tracks start
        // at a different x in each row and the columns never line up.
        list.setAlignItems(FlexComponent.Alignment.STRETCH);

        emptyHint.setId("queue-empty");
        emptyHint.getStyle().set("display", "block")
                .set("padding", "var(--lumo-space-l)")
                .set("text-align", "center")
                .set("color", "var(--lumo-secondary-text-color)")
                .set("border", "1px dashed var(--lumo-contrast-20pct)")
                .set("border-radius", "var(--lumo-border-radius-m)");

        add(header(),
                new CodePeek("QueuePanel.java", "queue", "queue code"),
                new CodePeek("MetricsStrip.java", "metrics", "metrics code"),
                columnHeader(), list, emptyHint);
        rebuild();

        // Bind FLIP once. From here on the panel simply reorders data and the client tweens.
        // Dragging to reorder is a real triage action: the engineer decides what to work next.
        list.addAttachListener(e -> {
            // <motion:queue>
            Motion.layout(list, 320);              // FLIP: tween rows to their new places
            Motion.sortable(list, 200, (from, to) -> {
            // </motion:queue>
                Incident moved = queue.remove((int) from);
                queue.add(to, moved);
                rebuild();
                notifyChange();
            });
        });
    }

    private Component header() {
        H3 title = new H3("Live queue");
        title.getStyle().set("margin", "0");

        Button page = new Button("Simulate page", e -> receivePage());
        page.setId("btn-simulate-page");
        page.addThemeVariants(ButtonVariant.LUMO_SMALL);

        Button sort = new Button("Sort by severity", e -> {
            queue.sort(Comparator.comparing(Incident::severity)
                    .thenComparing(Incident::raised));
            rebuild();
        });
        sort.setId("btn-sort-severity");
        sort.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

        HorizontalLayout bar = new HorizontalLayout(title, page, sort);
        bar.setWidthFull();
        bar.setAlignItems(FlexComponent.Alignment.CENTER);
        bar.expand(title);
        bar.getStyle().set("margin-bottom", "var(--lumo-space-s)");
        return bar;
    }

    /** Column captions, so the table says what each column is rather than relying on inference. */
    private Component columnHeader() {
        Div head = new Div();
        head.getStyle().set("display", "grid")
                .set("grid-template-columns", COLUMNS)
                .set("gap", "var(--lumo-space-m)")
                .set("align-items", "center")
                // Match the rows' horizontal padding plus their 1px border, so each caption
                // sits directly above its column rather than one border-width to the left.
                .set("padding", "0 calc(var(--lumo-space-m) + 1px) var(--lumo-space-xs)")
                .set("width", "100%")
                .set("box-sizing", "border-box")
                .set("border-bottom", "1px solid var(--lumo-contrast-20pct)")
                .set("margin-bottom", "var(--lumo-space-xs)");

        head.add(caption(""), caption("SEV"), caption("ID"), caption("SERVICE"),
                caption("SUMMARY"), caption("RAISED"), caption("ACTIONS"));
        return head;
    }

    private static Span caption(String text) {
        Span s = new Span(text);
        s.getStyle().set("font-size", "var(--lumo-font-size-xxs)")
                .set("font-weight", "600")
                .set("letter-spacing", "0.08em")
                .set("color", "var(--lumo-tertiary-text-color)");
        return s;
    }

    // ------------------------------------------------------------------ mutations

    /**
     * A new incident arrives from monitoring.
     *
     * <p>Inserted at the head because a fresh page is what the engineer should look at next,
     * and the entrance animation marks it as new without needing an "unread" badge.
     */
    private void receivePage() {
        Incident incident = new Incident(
                "INC-" + (1000 + pageCounter++),
                pageCounter % 3 == 0 ? Incident.Severity.SEV1 : Incident.Severity.SEV2,
                pageCounter % 2 == 0 ? "checkout-api" : "payments-worker",
                pageCounter % 2 == 0 ? "Elevated 5xx on /charge" : "Consumer lag above threshold",
                LocalTime.now().withNano(0),
                120 * pageCounter % 900 + 40);
        queue.add(0, incident);
        rebuild();
        notifyChange();
        Notification.show("New page: " + incident.id(), 2200, Notification.Position.BOTTOM_START);
    }

    /**
     * Settles an incident out of the queue.
     *
     * <p>The model is updated in {@code afterDetach} rather than on click so the row's departure
     * and the metric change land together. Updating immediately would make the numbers jump
     * before the row left, reading as two unrelated events.
     */
    private void settle(Incident incident, Component row, MotionPreset direction, String verb) {
        // <motion:queue>
        // Slides the row out, then updates the model in the detach callback so the row's
        // departure and the metric change land together.
        Motion.removeThen(row, direction, MotionOptions.duration(220), () -> {
        // </motion:queue>
            queue.remove(incident);
            rowCache.remove(incident.id());
            if (verb.equals("Acknowledged")) {
                acknowledged++;
            } else {
                resolved++;
            }
            refreshEmptyState();
            notifyChange();
            Notification.show(verb + " " + incident.id(), 2000, Notification.Position.BOTTOM_START)
                    .addThemeVariants(NotificationVariant.LUMO_SUCCESS);
        });
    }

    private void rebuild() {
        list.removeAll();
        queue.forEach(i -> list.add(rowCache.computeIfAbsent(i.id(), k -> row(i))));
        refreshEmptyState();
    }

    private void refreshEmptyState() {
        emptyHint.setVisible(queue.isEmpty());
    }

    private void notifyChange() {
        onChange.accept(new QueueStats(
                queue.size(),
                (int) queue.stream().filter(Incident::requiresEscalation).count(),
                acknowledged,
                resolved,
                queue.stream().mapToInt(Incident::affectedUsers).sum()));
    }

    /** Pushes the initial stats once the surrounding console is ready to receive them. */
    void publishInitialStats() {
        notifyChange();
    }

    // ------------------------------------------------------------------ row

    private Component row(Incident incident) {
        Span handle = new Span("⠿");
        handle.getStyle().set("color", "var(--lumo-contrast-30pct)")
                .set("cursor", "grab");

        Span sev = new Span(incident.severity().label());
        sev.getElement().getThemeList().add("badge " + incident.severity().badgeTheme() + " small");

        Span id = new Span(incident.id());
        id.getStyle().set("font-family", "monospace")
                .set("font-size", "var(--lumo-font-size-s)")
                .set("color", "var(--lumo-secondary-text-color)");

        Span service = new Span(incident.service());
        service.getStyle().set("font-weight", "600")
                .set("white-space", "nowrap")
                .set("overflow", "hidden")
                .set("text-overflow", "ellipsis");

        Span summary = new Span(incident.summary());
        summary.getStyle().set("color", "var(--lumo-secondary-text-color)")
                // Truncate rather than wrap: a wrapping summary makes rows different heights,
                // which breaks the scan down the ID and severity columns.
                .set("white-space", "nowrap")
                .set("overflow", "hidden")
                .set("text-overflow", "ellipsis");
        summary.getElement().setAttribute("title", incident.summary());

        Span raised = new Span(incident.raised().toString());
        raised.getStyle().set("font-variant-numeric", "tabular-nums")
                .set("color", "var(--lumo-tertiary-text-color)")
                .set("font-size", "var(--lumo-font-size-s)");

        Div rowEl = new Div();
        rowEl.getStyle().set("display", "grid")
                .set("grid-template-columns", COLUMNS)
                .set("box-sizing", "border-box")
                .set("gap", "var(--lumo-space-m)")
                .set("align-items", "center")
                .set("padding", "var(--lumo-space-s) var(--lumo-space-m)")
                .set("margin-bottom", "var(--lumo-space-xs)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-base-color)")
                .set("border", "1px solid var(--lumo-contrast-10pct)")
                .set("user-select", "none");

        Button ack = new Button("Acknowledge", e -> {
            // A SEV1 pages a human and cannot be quietly acknowledged. The shake is immediate
            // feedback; the notification carries the actual reason.
            if (incident.requiresEscalation()) {
                // <motion:queue>
                Motion.play(rowEl, MotionPreset.SHAKE);
                // </motion:queue>
                Notification.show(incident.id() + " is SEV1 — escalate, it cannot be acknowledged",
                                3000, Notification.Position.BOTTOM_START)
                        .addThemeVariants(NotificationVariant.LUMO_ERROR);
                return;
            }
            settle(incident, rowEl, MotionPreset.SLIDE_OUT_RIGHT, "Acknowledged");
        });
        ack.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

        Button resolve = new Button("Resolve", e ->
                settle(incident, rowEl, MotionPreset.SLIDE_OUT_LEFT, "Resolved"));
        resolve.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_PRIMARY);

        HorizontalLayout actions = new HorizontalLayout(ack, resolve);
        actions.setPadding(false);
        actions.setSpacing(false);
        actions.getStyle().set("gap", "var(--lumo-space-xs)")
                .set("justify-content", "flex-end");
        actions.setWidthFull();
        actions.setAlignItems(FlexComponent.Alignment.CENTER);

        rowEl.add(handle, sev, id, service, summary, raised, actions);

        // Default exit direction; settle() overrides it per action so the direction stays
        // meaningful (right = acknowledged and still active, left = closed out).
        // <motion:queue>
        Motion.exit(rowEl, MotionPreset.SLIDE_OUT_RIGHT);
        // New pages slide down from above, matching where they are inserted.
        Motion.enter(rowEl, MotionPreset.SLIDE_DOWN);
        // </motion:queue>
        return rowEl;
    }

    private static List<Incident> seed() {
        return List.of(
                new Incident("INC-1001", Incident.Severity.SEV1, "checkout-api",
                        "Payment authorisation failing for 12% of requests",
                        LocalTime.of(9, 42), 820),
                new Incident("INC-1002", Incident.Severity.SEV2, "search-indexer",
                        "Index lag exceeding 15 minutes", LocalTime.of(9, 51), 210),
                new Incident("INC-1003", Incident.Severity.SEV3, "notification-svc",
                        "Digest emails delayed", LocalTime.of(10, 4), 60));
    }
}
