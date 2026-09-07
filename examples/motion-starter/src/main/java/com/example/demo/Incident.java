package com.example.demo;

import java.time.LocalTime;

/**
 * One incident in the response queue.
 *
 * <p>A record rather than a mutable entity: the console reorders and replaces incidents
 * constantly, and immutable values make it obvious that a row moving is a reordering of the
 * same data rather than an in-place edit.
 */
public record Incident(
        String id,
        Severity severity,
        String service,
        String summary,
        LocalTime raised,
        int affectedUsers) {

    /** Incident severity, ordered most urgent first. */
    public enum Severity {
        SEV1("SEV1", "error"),
        SEV2("SEV2", "warning"),
        SEV3("SEV3", "contrast");

        private final String label;
        /** Lumo badge theme variant used to colour the chip. */
        private final String badgeTheme;

        Severity(String label, String badgeTheme) {
            this.label = label;
            this.badgeTheme = badgeTheme;
        }

        public String label() {
            return label;
        }

        public String badgeTheme() {
            return badgeTheme;
        }
    }

    /** Incidents at this level page the on-call engineer and cannot simply be acknowledged. */
    public boolean requiresEscalation() {
        return severity == Severity.SEV1;
    }
}
