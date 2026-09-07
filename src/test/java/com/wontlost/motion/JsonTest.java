package com.wontlost.motion;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class JsonTest {

    @Test
    void escapesStrings() {
        assertThat(Json.string("a\"b\\c\nd")).isEqualTo("\"a\\\"b\\\\c\\nd\"");
    }

    @Test
    void writesNestedStructures() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("n", 1);
        m.put("b", true);
        m.put("l", List.of("x", 2));
        m.put("r", new Json.Raw("{\"k\":1}"));
        assertThat(Json.object(m)).isEqualTo("{\"n\":1,\"b\":true,\"l\":[\"x\",2],\"r\":{\"k\":1}}");
    }
}
