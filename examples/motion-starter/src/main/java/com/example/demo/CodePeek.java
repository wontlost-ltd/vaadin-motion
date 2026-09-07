package com.example.demo;

import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Pre;
import com.wontlost.motion.Motion;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Shows the Motion calls that drive a panel, read from the panel's own source file.
 *
 * <p>The snippet is <b>extracted from the real {@code .java} file at runtime</b> rather than
 * copied into a string constant. A hand-written copy silently goes stale the moment the code
 * changes, and a demo whose displayed code does not match its behaviour is worse than one that
 * shows no code at all. Here the snippet cannot drift, because it is the implementation.
 *
 * <p>Regions are delimited in the source with comment markers:
 *
 * <pre>
 * // &lt;motion:flip&gt;
 * Motion.layout(list, 320);
 * // &lt;/motion:flip&gt;
 * </pre>
 *
 * <p>The panel stays clean by default: the code is collapsed until asked for, using the same
 * expand animation as the rest of the console rather than a different mechanism.
 */
final class CodePeek extends Div {

    /** Where the sources are copied to by the build; see the {@code <resources>} block in pom.xml. */
    private static final String SOURCE_ROOT = "/demo-sources/com/example/demo/";

    private final Div body = new Div();
    private final Button toggleButton;
    private final String label;
    private boolean open;

    /**
     * Builds a collapsible view of one marked region.
     *
     * @param sourceFile simple file name, e.g. {@code "QueuePanel.java"}
     * @param region     marker name, e.g. {@code "flip"} for {@code // <motion:flip>}
     */
    CodePeek(String sourceFile, String region) {
        this(sourceFile, region, "code");
    }

    /**
     * Builds a collapsible view of one marked region, under a specific label.
     *
     * <p>A panel showing more than one snippet needs to say which is which; two toggles both
     * reading "Show code" tell the reader nothing.
     *
     * @param label what this snippet covers, e.g. {@code "queue code"}
     */
    CodePeek(String sourceFile, String region, String label) {
        String code = extract(sourceFile, region);

        Pre pre = new Pre(code);
        pre.getStyle().set("margin", "0")
                .set("padding", "var(--lumo-space-m)")
                .set("font-size", "var(--lumo-font-size-xs)")
                .set("line-height", "1.55")
                .set("overflow-x", "auto")
                .set("color", "var(--lumo-body-text-color)");

        body.setId("code-" + region);
        body.add(pre);
        body.getStyle().set("overflow", "hidden")
                .set("border", "1px solid var(--lumo-contrast-10pct)")
                .set("border-radius", "var(--lumo-border-radius-m)")
                .set("background", "var(--lumo-contrast-5pct)")
                .set("margin-top", "var(--lumo-space-s)")
                // Collapsed to start: Motion.toggle animates from whatever height is current,
                // so the initial state has to be set here rather than by an opening call.
                .set("height", "0")
                .set("display", "none");

        this.label = label;
        Button toggle = new Button("</> Show " + label, e -> toggle());
        toggle.setId("btn-code-" + region);
        toggle.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);
        toggle.getElement().setAttribute("aria-expanded", "false");
        toggle.getElement().setAttribute("aria-controls", "code-" + region);
        this.toggleButton = toggle;

        setWidthFull();
        add(toggle, body);
    }

    private void toggle() {
        open = !open;
        if (open) {
            // display:none would make the measured height zero, so restore it before animating.
            body.getStyle().set("display", "block");
        }
        Motion.toggle(body, open, 240);
        toggleButton.setText((open ? "</> Hide " : "</> Show ") + label);
        toggleButton.getElement().setAttribute("aria-expanded", String.valueOf(open));
    }

    /**
     * Pulls a marked region out of a bundled source file.
     *
     * <p>Returns an explanatory message rather than throwing if the region cannot be found: a
     * missing snippet should not take down the panel it documents.
     */
    private static String extract(String sourceFile, String region) {
        String open = "<motion:" + region + ">";
        String close = "</motion:" + region + ">";

        try (InputStream in = CodePeek.class.getResourceAsStream(SOURCE_ROOT + sourceFile)) {
            if (in == null) {
                return "// source not bundled: " + sourceFile;
            }
            String source = new String(in.readAllBytes(), StandardCharsets.UTF_8);

            // Each marked region is de-indented on its own and kept as a separate block. A
            // single pass over the concatenation would strip the shallowest region's indent
            // from all of them, leaving deeper ones floating mid-air.
            List<String> blocks = new ArrayList<>();
            List<String> current = new ArrayList<>();
            boolean inside = false;
            for (String line : source.split("\n", -1)) {
                String trimmed = line.trim();
                if (trimmed.endsWith(close)) {
                    inside = false;
                    if (!current.isEmpty()) {
                        blocks.add(closeDangling(stripCommonIndent(current)));
                        current = new ArrayList<>();
                    }
                    continue;
                }
                if (trimmed.endsWith(open)) {
                    inside = true;
                    continue;
                }
                if (inside) {
                    // An "// ..." marker inside a region stands in for elided application
                    // logic, so a snippet can show a call that takes a lambda without dragging
                    // in the whole callback body.
                    current.add(line);
                }
            }
            if (blocks.isEmpty()) {
                return "// no region '" + region + "' in " + sourceFile;
            }
            // A blank line between blocks: they are separate call sites, not one sequence.
            return String.join("\n\n", blocks);
        } catch (IOException e) {
            return "// could not read " + sourceFile + ": " + e.getMessage();
        }
    }

    /**
     * Closes a snippet that ends part-way into a lambda or block.
     *
     * <p>Regions are cut at the point the Motion call stops being interesting, which often
     * leaves an open brace behind. Showing unbalanced code invites the reader to wonder what
     * they are missing, so the remainder is elided explicitly instead.
     */
    private static String closeDangling(String snippet) {
        int depth = 0;
        boolean inString = false;
        for (int i = 0; i < snippet.length(); i++) {
            char c = snippet.charAt(i);
            if (c == '"' && (i == 0 || snippet.charAt(i - 1) != '\\')) {
                inString = !inString;
            } else if (!inString && (c == '{' || c == '(')) {
                depth++;
            } else if (!inString && (c == '}' || c == ')')) {
                depth--;
            }
        }
        if (depth <= 0) {
            return snippet;
        }
        StringBuilder out = new StringBuilder(snippet);
        out.append("\n    // ...");
        // Close what was opened, innermost first, so the snippet reads as valid Java.
        out.append("\n});");
        return out.toString();
    }

    /** Removes the shared leading indentation so a nested snippet reads flush left. */
    private static String stripCommonIndent(List<String> lines) {
        int indent = Integer.MAX_VALUE;
        for (String line : lines) {
            if (line.isBlank()) {
                continue;   // Blank lines would otherwise force the margin to zero.
            }
            int i = 0;
            while (i < line.length() && line.charAt(i) == ' ') {
                i++;
            }
            indent = Math.min(indent, i);
        }
        int strip = indent == Integer.MAX_VALUE ? 0 : indent;

        StringBuilder out = new StringBuilder();
        for (String line : lines) {
            out.append(line.length() >= strip ? line.substring(strip) : line.trim()).append('\n');
        }
        // Trim leading and trailing blank lines, which the markers tend to leave behind.
        return out.toString().strip();
    }
}
