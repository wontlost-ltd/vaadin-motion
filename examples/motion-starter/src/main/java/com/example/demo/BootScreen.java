package com.example.demo;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.wontlost.motion.Motion;
import com.wontlost.motion.MotionOptions;
import com.wontlost.motion.MotionPreset;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Consumer;

/**
 * The console's boot screen: the system identifier resolves out of noise, the strapline
 * surfaces word by word, and a progress bar fills while the connection is established.
 *
 * <p>This is the one place in the application where decorative motion belongs. Scramble text
 * and split-text entrances slow reading down, which is unacceptable on a working surface an
 * engineer stares at during an outage — but a boot screen is seen once per session and its
 * whole job is to say "the system is coming up". Everything past this screen is restrained.
 *
 * <p><b>On the deliberately uneven pacing.</b> A real console is waiting on real work — probing
 * links, loading a service catalogue, replaying an event log — and those stages do not take the
 * same time twice. A fixed, uniform sequence reads as a progress bar pretending to be busy, so
 * each stage is given a randomised duration and the bar advances in uneven steps. The total is
 * bounded so the screen never outstays its welcome.
 */
final class BootScreen extends Div {

    private static final String CODENAME = "SENTINEL OPS";

    /** Stage labels, shown in turn beneath the bar. Each one is a plausible unit of start-up work. */
    private static final List<String> STAGES = List.of(
            "Establishing telemetry link",
            "Loading service catalogue",
            "Replaying incident log",
            "Synchronising on-call roster");

    private final Span codename = new Span("............");
    private final Div headline = new Div(new Span("Incident response, without the guesswork"));
    private final Div bar = new Div();
    private final Span status = new Span(STAGES.get(0));
    /**
     * Invisible element used purely as a clock for stage transitions.
     *
     * <p>Kept separate from the bar because starting a second animation on a target cancels the
     * first, which would stall the progress animation.
     */
    private final Div timer = new Div();
    private final Consumer<Void> onDone;

    BootScreen(Consumer<Void> onDone) {
        this.onDone = onDone;
        setId("boot-screen");
        getStyle().set("display", "flex")
                .set("flex-direction", "column")
                .set("align-items", "center")
                .set("justify-content", "center")
                .set("gap", "var(--lumo-space-m)")
                // Centring needs a box to centre within. As a plain Div this spans only its own
                // content, so "align-items: center" centred the text inside a narrow column
                // pinned to the left. Filling the viewport in both axes — and discounting the
                // parent's padding — puts the sequence in the middle of the page.
                .set("width", "100%")
                .set("min-height", "calc(100vh - 2 * var(--lumo-space-l))")
                .set("box-sizing", "border-box");

        codename.setId("boot-codename");
        codename.getStyle().set("font-family", "monospace")
                .set("font-size", "var(--lumo-font-size-xxxl)")
                .set("font-weight", "700")
                .set("letter-spacing", "0.18em")
                .set("color", "var(--lumo-primary-color)");

        headline.setId("boot-headline");
        headline.getStyle().set("font-size", "var(--lumo-font-size-l)")
                .set("color", "var(--lumo-secondary-text-color)");

        bar.setId("boot-bar");
        bar.getStyle().set("height", "4px")
                .set("width", "100%")
                .set("border-radius", "2px")
                .set("background", "var(--lumo-primary-color)")
                .set("transform", "scaleX(0)")
                .set("transform-origin", "left center");

        Div track = new Div(bar);
        track.getStyle().set("background", "var(--lumo-contrast-10pct)")
                .set("border-radius", "2px")
                .set("width", "260px");

        status.setId("boot-status");
        status.getStyle().set("font-size", "var(--lumo-font-size-s)")
                .set("color", "var(--lumo-tertiary-text-color)")
                .set("font-family", "monospace")
                // Stage labels vary in length. Centred but content-sized, the text would shift
                // sideways at every stage change; a fixed block keeps it steady.
                .set("width", "280px")
                .set("text-align", "center");

        timer.getStyle().set("position", "absolute")
                .set("width", "1px").set("height", "1px")
                .set("opacity", "0").set("pointer-events", "none");

        add(codename, headline, track, status, timer);
        addAttachListener(e -> start());
    }

    /**
     * Runs the boot sequence.
     *
     * <p>The codename resolves first because it is the identity, the strapline follows, and the
     * bar then advances one stage at a time. The handover is driven by the last stage completing
     * rather than a fixed delay, so a slow machine is never cut short.
     */
    private void start() {
        // A slower scramble: the codename is the first thing on screen and reading it resolve
        // out of noise is the point, so it is given time to be watched.
        Motion.scramble(codename, CODENAME, rand(1400, 2100));
        Motion.splitIn(headline, Motion.SplitBy.WORDS, rand(520, 760), rand(60, 110));

        // Let the identity land before the bar starts moving, otherwise everything competes.
        runStage(0, rand(500, 800));
    }

    /**
     * Advances the bar to the end of stage {@code index}, then schedules the next.
     *
     * <p>Each stage moves the bar to its own fraction over its own duration, so progress
     * proceeds in uneven steps the way real start-up work does. Recursing through the timeline
     * callback rather than pre-computing a schedule means every stage genuinely waits for the
     * previous one instead of racing a shared clock.
     */
    private void runStage(int index, int delayMs) {
        if (index >= STAGES.size()) {
            onDone.accept(null);
            return;
        }

        int duration = rand(650, 1250);
        // Fraction of the bar this stage ends at; the last stage always lands exactly at 1.
        double to = index == STAGES.size() - 1
                ? 1.0
                : (index + 1) / (double) STAGES.size();

        Motion.timeline()
                .add(timer, MotionPreset.FADE_IN, MotionOptions.duration(delayMs))
                .onComplete(() -> {
                    status.setText(STAGES.get(index));
                    Motion.progressTo(bar, to, duration);
                    Motion.timeline()
                            .add(timer, MotionPreset.FADE_IN, MotionOptions.duration(duration))
                            // A short, variable pause between stages: work does not hand over
                            // the instant the previous step finishes.
                            .onComplete(() -> runStage(index + 1, rand(120, 380)))
                            .play();
                })
                .play();
    }

    /** Inclusive random duration in milliseconds. */
    private static int rand(int minMs, int maxMs) {
        return ThreadLocalRandom.current().nextInt(minMs, maxMs + 1);
    }

    /** Plays the exit and reports when the screen is gone, so the caller can swap content in. */
    void dismiss(Runnable afterGone) {
        Motion.removeThen(this, MotionPreset.FADE_OUT,
                MotionOptions.duration(320), afterGone::run);
    }

    static Component spacer() {
        Div d = new Div();
        d.getStyle().set("height", "var(--lumo-space-l)");
        return d;
    }
}
