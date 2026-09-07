package com.wontlost.motion;

import com.vaadin.flow.component.html.Div;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MotionTimelineTest {

    @Test
    void buildsJsExpressionWithOneDollarPerElement() {
        assertThat(MotionTimeline.jsExpression(0)).isEqualTo("return this.timeline($0)");
        assertThat(MotionTimeline.jsExpression(3)).isEqualTo("return this.timeline($0, $1, $2, $3)");
    }

    @Test
    void serialisesStepsInOrderWithTargetIndex() {
        Div a = new Div();
        Div b = new Div();
        MotionTimeline tl = Motion.timeline()
                .defaults(MotionOptions.duration(180))
                .add(a, MotionPreset.FADE_IN)
                .add(b, MotionPreset.SLIDE_UP, MotionOptions.none().ease("outBack"), "-=60");

        assertThat(tl.size()).isEqualTo(2);
        assertThat(tl.elementsForTest()).containsExactly(a.getElement(), b.getElement());
        assertThat(tl.toJsonForTest()).isEqualTo(
                "{\"defaults\":{\"duration\":180},\"steps\":["
                        + "{\"target\":0,\"preset\":\"fadeIn\"},"
                        + "{\"target\":1,\"preset\":\"slideUp\",\"options\":{\"ease\":\"outBack\"},\"position\":\"-=60\"}]}");
    }

    @Test
    void specOmitsEmptyOptions() {
        assertThat(Motion.spec(MotionPreset.SHAKE, MotionOptions.none())).isEqualTo("{\"preset\":\"shake\"}");
        assertThat(Motion.spec(MotionPreset.SHAKE, MotionOptions.duration(400)))
                .isEqualTo("{\"preset\":\"shake\",\"options\":{\"duration\":400}}");
    }
}
