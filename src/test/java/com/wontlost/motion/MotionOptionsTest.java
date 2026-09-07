package com.wontlost.motion;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MotionOptionsTest {

    @Test
    void isImmutable() {
        MotionOptions a = MotionOptions.none();
        MotionOptions b = a.withDuration(300);
        assertThat(a.isEmpty()).isTrue();
        assertThat(b.toJson()).isEqualTo("{\"duration\":300}");
    }

    @Test
    void serialisesEveryField() {
        String json = MotionOptions.duration(250)
                .withDelay(20)
                .ease("outCubic")
                .staggerEach(60)
                .staggerFrom(MotionOptions.From.CENTER)
                .raw("{\"rotate\":\"1turn\"}")
                .toJson();
        assertThat(json).isEqualTo(
                "{\"duration\":250,\"delay\":20,\"ease\":\"outCubic\",\"each\":60,\"from\":\"center\",\"raw\":{\"rotate\":\"1turn\"}}");
    }

    @Test
    void rejectsInvalidValues() {
        assertThatThrownBy(() -> MotionOptions.duration(-1)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MotionOptions.none().ease(" ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> MotionOptions.none().raw("")).isInstanceOf(IllegalArgumentException.class);
    }
}
