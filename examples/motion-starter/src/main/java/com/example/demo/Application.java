package com.example.demo;

import com.vaadin.flow.component.page.AppShellConfigurator;
import com.vaadin.flow.server.AppShellSettings;
import com.vaadin.flow.theme.Theme;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** Vaadin 25 starter entry point, used to exercise the vaadin-motion animation lifecycle. */
// Vaadin 25 no longer applies Lumo implicitly: without @Theme you get the unstyled baseline —
// serif type, no spacing, components with only the barest borders — which looks like the CSS
// failed to load.
@Theme("motion-starter")
@SpringBootApplication
public class Application implements AppShellConfigurator {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }

    @Override
    public void configurePage(AppShellSettings settings) {
        // 站点图标：SVG 优先（明暗都清晰），ICO 与 apple-touch-icon 兜底；文件在 META-INF/resources/icons
        settings.addLink("icons/favicon.svg", java.util.Map.of("rel", "icon", "type", "image/svg+xml"));
        settings.addFavIcon("icon", "icons/favicon.ico", "48x48");
        settings.addFavIcon("apple-touch-icon", "icons/apple-touch-icon.png", "180x180");
    }
}
