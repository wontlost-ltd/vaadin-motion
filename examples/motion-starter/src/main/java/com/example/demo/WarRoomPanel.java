package com.example.demo;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H3;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.wontlost.motion.Motion;

/**
 * War-room board: free-form notes an engineer arranges while working an incident.
 *
 * <p>Unlike the queue, position here is <b>meaningful to the person, not the system</b> — the
 * engineer clusters hypotheses spatially the way they would on a whiteboard. That makes free
 * dragging the right tool rather than list reordering.
 *
 * <p>Notes snap to a grid so the board stays legible when several people share a screen, and
 * the current-focus marker <b>follows the pointer</b> so a presenter can direct attention
 * without a laser pointer. The follow marker is the one case here needing high-frequency
 * updates: creating a fresh animation on every pointer move would visibly stutter.
 */
final class WarRoomPanel extends VerticalLayout {

    private static final int GRID = 20;

    private final Div board = new Div();
    private final Div focus = new Div();
    private final Div[] notes = new Div[3];
    private boolean dragEnabled = true;

    WarRoomPanel() {
        setPadding(false);
        setSpacing(false);
        setWidthFull();

        H3 title = new H3("War room");
        title.getStyle().set("margin", "0 0 var(--lumo-space-xs) 0");
        Span hint = new Span("Drag notes to cluster them. The marker follows your pointer "
                + "so you can direct attention on a shared screen.");
        hint.getStyle().set("color", "var(--lumo-secondary-text-color)")
                .set("display", "block")
                .set("margin-bottom", "var(--lumo-space-m)");

        board.setId("war-room-board");
        board.getStyle().set("position", "relative")
                // Width must be explicit: the board holds only absolutely-positioned children,
                // so it has no intrinsic width and collapsed to 2px inside the flex column.
                .set("width", "100%")
                .set("height", "420px")
                .set("border", "1px dashed var(--lumo-contrast-20pct)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-contrast-5pct)")
                .set("overflow", "hidden");

        focus.setId("focus-marker");
        focus.getStyle().set("position", "absolute")
                .set("width", "26px").set("height", "26px")
                .set("border-radius", "50%")
                .set("border", "2px solid var(--lumo-primary-color)")
                .set("pointer-events", "none")
                .set("top", "0").set("left", "0");

        notes[0] = note("Hypothesis", "Cert expiry on fraud-check edge", "40px", "60px");
        notes[0].setId("note-hypothesis");
        notes[1] = note("Evidence", "TLS handshake failures in edge logs", "40px", "360px");
        notes[1].setId("note-evidence");
        notes[2] = note("Action", "Rotate cert, remove bypass", "220px", "200px");
        notes[2].setId("note-action");

        board.add(focus, notes[0], notes[1], notes[2]);

        Button lock = new Button("Lock board", e -> toggleDrag());
        lock.setId("btn-lock-board");
        lock.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

        add(title, hint, new HorizontalLayout(lock),
                new CodePeek("WarRoomPanel.java", "warroom"), board);

        board.addAttachListener(e -> {
            // Grid snapping keeps the board legible when it is projected in a review.
            // <motion:warroom>
            for (Div n : notes) {
                Motion.draggable(n, Motion.DragAxis.BOTH, "#war-room-board", GRID);
            }
            Motion.animatable(focus, 260);
            // </motion:warroom>
        });

        // Debounced so the server sees a manageable event rate; animatable smooths the rest.
        board.getElement().addEventListener("mousemove", e -> {
            double x = e.getEventData().get("event.offsetX").asDouble() - 13;
            double y = e.getEventData().get("event.offsetY").asDouble() - 13;
            // <motion:warroom>
            Motion.animatableTo(focus, x, y);
            // </motion:warroom>
        }).addEventData("event.offsetX").addEventData("event.offsetY").debounce(25);
    }

    /**
     * Locks or unlocks the board.
     *
     * <p>Once the team agrees on a layout it should stop moving — an accidental drag during a
     * review loses the arrangement everyone is looking at.
     */
    private void toggleDrag() {
        dragEnabled = !dragEnabled;
        for (Div n : notes) {
            // <motion:warroom>
            if (dragEnabled) {
                Motion.draggable(n, Motion.DragAxis.BOTH, "#war-room-board", GRID);
            } else {
                Motion.undraggable(n);
            }
            // </motion:warroom>
        }
    }

    private static Div note(String kind, String text, String top, String left) {
        Span k = new Span(kind);
        k.getStyle().set("font-size", "var(--lumo-font-size-s)")
                .set("color", "var(--lumo-primary-color)")
                .set("font-weight", "600")
                .set("display", "block");
        Span t = new Span(text);
        t.getStyle().set("font-size", "var(--lumo-font-size-s)");

        Div n = new Div(k, t);
        n.getStyle().set("position", "absolute")
                .set("top", top).set("left", left)
                .set("width", "220px")
                .set("padding", "var(--lumo-space-s) var(--lumo-space-m)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-base-color)")
                .set("box-shadow", "var(--lumo-box-shadow-xs)")
                .set("cursor", "grab")
                .set("user-select", "none");
        return n;
    }
}
