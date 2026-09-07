package com.wontlost.motion;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

class MotionPresetTest {

    @Test
    @DisplayName("Preset keys are unique and camelCase (must match presets.ts)")
    void keysAreUnique() {
        Set<String> keys = Arrays.stream(MotionPreset.values()).map(MotionPreset::key).collect(Collectors.toSet());
        assertThat(keys).hasSize(MotionPreset.values().length);
        assertThat(keys).allMatch(k -> k.matches("[a-z][A-Za-z]*"));
    }

    @Test
    void defaultsHaveTheRightKind() {
        assertThat(MotionPreset.defaultEnter().kind()).isEqualTo(MotionPreset.Kind.ENTER);
        assertThat(MotionPreset.defaultExit().kind()).isEqualTo(MotionPreset.Kind.EXIT);
    }
}
