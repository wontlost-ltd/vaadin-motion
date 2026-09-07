package com.wontlost.motion;

import java.util.Collection;
import java.util.Map;

/**
 * Minimal JSON writer. Kept internal on purpose: the payloads are tiny and this
 * avoids coupling the add-on to a specific Jackson major version across Vaadin releases.
 */
final class Json {

    /** Pre-serialised JSON that must be embedded verbatim. */
    record Raw(String json) { }

    private Json() { }

    static String object(Map<String, ?> map) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, ?> e : map.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            sb.append(string(e.getKey())).append(':').append(value(e.getValue()));
        }
        return sb.append('}').toString();
    }

    static String value(Object v) {
        if (v == null) {
            return "null";
        }
        if (v instanceof Raw raw) {
            return raw.json();
        }
        if (v instanceof Number || v instanceof Boolean) {
            return v.toString();
        }
        if (v instanceof Map<?, ?> m) {
            @SuppressWarnings("unchecked")
            Map<String, ?> typed = (Map<String, ?>) m;
            return object(typed);
        }
        if (v instanceof Collection<?> c) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object o : c) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                sb.append(value(o));
            }
            return sb.append(']').toString();
        }
        return string(v.toString());
    }

    static String string(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }
}
