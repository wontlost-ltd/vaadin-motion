# Vaadin Motion

Restrained, server-driven motion for Vaadin Flow, powered by [anime.js v4](https://animejs.com/).

Flow has no concept of motion: `add()` pops a component in, `remove()` yanks it out. This add-on
gives the Java side a small, intent-revealing API for the cases where movement carries meaning —
which row you just actioned, what changed while you were looking elsewhere, where a request fails
— and stays out of the way everywhere else.

## Features

- **Enter / exit tied to the component lifecycle** — `Motion.remove()` plays the exit animation
  *before* Flow detaches the component, which a plain `parent.remove(child)` cannot do.
- **Server-side completion callbacks** — timelines and removals report back to Java when the
  animation finishes, so business logic can be sequenced against it.
- **18 quiet presets** — 150–200 ms, 8 px travel, standard easings. Enterprise users want
  *smooth*, not *showy*. The Java API enforces intent: an exit preset passed to `Motion.enter`
  throws rather than misbehaving at runtime.
- **FLIP reordering** — rows tween to their new positions when a list is sorted or filtered, so
  the list reads as rearranged rather than redrawn.
- **Drag to reorder and free dragging** — with axis locking, container bounds and grid snapping.
- **Scroll-driven animation** — reveal content as it enters the viewport, or tie a reading
  progress bar to scroll position.
- **SVG stroke drawing and path morphing** — draws a diagram into existence; morphs exactly,
  without the float noise arc-length resampling introduces.
- **Number count-up, split-text entrances, scramble text, skeleton handover.**
- **`prefers-reduced-motion` honoured by default** — durations collapse to zero while business
  logic and callback ordering stay identical, so there is no second code path to maintain.
- **Nothing outlives the UI** — one hidden host element per `UI` owns a single anime.js scope,
  reverted on disconnect.

## Installation

### Maven

```xml
<dependency>
    <groupId>com.wontlost</groupId>
    <artifactId>motion-vaadin</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```kotlin
implementation("com.wontlost:motion-vaadin:0.1.0")
```

### Compatibility

| Dependency | Version | Notes |
|---|---|---|
| Vaadin Platform | 25.2.6+ | 25.x series |
| Java | 21+ | Vaadin 25 baseline |
| anime.js | `^4.5.0` | pulled in via `@NpmPackage` |
| Lit | `^3.3.3` | pulled in via `@NpmPackage` |
| Node | 24+ | frontend build only |

No Jackson coupling: payloads are a few dozen bytes, written by a small internal serialiser, so
the add-on is independent of the Jackson major version a given Vaadin release ships.

## Quick start

```java
// Enter / exit bound to the component lifecycle
Motion.enter(card, MotionPreset.SLIDE_UP);
Motion.exit(card, MotionPreset.COLLAPSE);
Motion.remove(card);                        // plays the exit, THEN detaches

// Staggered entrance for a layout's children
Motion.stagger(kpiRow, MotionPreset.SLIDE_UP, MotionOptions.none().staggerEach(40));

// A timeline across components, completion reported back to the server
Motion.timeline()
      .add(header, MotionPreset.FADE_IN)
      .add(kpiRow, MotionPreset.SLIDE_UP, "-=100")
      .add(chart,  MotionPreset.SCALE_IN)
      .onComplete(() -> Notification.show("ready"))
      .play();

// One-off feedback on a visible component
Motion.play(amountField, MotionPreset.SHAKE);   // validation failed
Motion.play(row, MotionPreset.HIGHLIGHT);       // row updated by push

// Remove with a callback that runs once the component is really gone
Motion.removeThen(row, MotionPreset.SLIDE_OUT_LEFT, MotionOptions.duration(220), () -> {
    model.remove(incident);
    refreshMetrics();
});
```

## API overview

| Area | Methods |
|---|---|
| Lifecycle | `enter` `exit` `remove` `removeThen` `play` `stagger` `timeline` |
| Layout | `layout` / `clearLayout` (FLIP), `sortable` / `clearSortable`, `toggle` `expand` `collapse` |
| Pointer | `draggable` / `undraggable`, `animatable` / `animatableTo` / `clearAnimatable` |
| Scroll | `onScroll` / `clearScroll` |
| SVG | `draw` `drawThen` `morph` `followPath` |
| Data | `count` `progressTo` `reveal` `splitIn` `scramble` |

`MotionOptions` overrides `duration`, `delay`, `ease`, `spring`, `staggerEach` and `staggerFrom`.
`raw(json)` is the escape hatch for arbitrary anime.js parameters; use it sparingly.

### Presets

| Kind | Presets |
|---|---|
| Enter | `FADE_IN` `SLIDE_UP` `SLIDE_DOWN` `SLIDE_IN_LEFT` `SLIDE_IN_RIGHT` `SCALE_IN` `EXPAND` `PROGRESS` |
| Exit | `FADE_OUT` `SLIDE_OUT_UP` `SLIDE_OUT_DOWN` `SLIDE_OUT_LEFT` `SLIDE_OUT_RIGHT` `SCALE_OUT` `COLLAPSE` |
| Attention | `SHAKE` `PULSE` `HIGHLIGHT` |

Presets live once, on the client; Java carries only the key.

## Why `Motion.remove` exists

`parent.remove(child)` detaches the DOM node in the same round trip, so an exit animation never
gets a frame to play. Earlier add-ons (CompAni, 2019) stalled on exactly this.

`Motion.remove` inverts the order:

1. The server calls `host.exit(element, spec)` via `executeJs` and gets a
   `PendingJavaScriptResult`.
2. The client plays the exit and resolves a promise, raced against a timeout
   (`duration + delay + 250 ms`), so it **always** resolves even if anime.js throws or the tab is
   throttled.
3. `then()` fires on the server, which calls `element.removeFromParent()` and the optional
   `afterDetach` callback.

The component is never leaked and the server stays the single source of truth for the component
tree. Repeat calls while a removal is in flight are de-duplicated, so `afterDetach` runs exactly
once per removal even under a burst of clicks.

## Example application

`examples/motion-starter` is a complete incident-response console — a live queue with FLIP
reordering and drag-to-sort, a service topology that draws itself and traces a failing request, a
postmortem with reading progress, and a war-room board with draggable notes. Each panel has a
**Show code** toggle that displays the Motion calls behind it, extracted from the source files at
runtime so the snippets cannot drift from the implementation.

```bash
cd examples/motion-starter
mvn spring-boot:run          # http://localhost:8080
```

## Design notes

- **One host per UI.** `MotionHost` is a hidden `<vaadin-motion>` element attached lazily to the
  `UI`. It owns a single anime.js `createScope()`, and `scope.revert()` runs on disconnect.
- **Idempotent targets.** Every call runs `utils.remove(el)` first, so re-triggering an animation
  on a component that is mid-flight does not stack tweens.
- **Persistent bindings are explicit.** `draggable`, `sortable`, `layout`, `onScroll` and
  `animatable` register listeners that outlive a single animation; each has a matching `clear*`
  or `un*` call, and rebinding reverts the previous instance rather than stacking listeners.
- **Not in scope:** chart animation — use [SO Charts](https://vaadin.com/directory/component/so-charts)
  or ECharts, which animate their own data transitions.

## Building

```bash
mvn clean verify
cd src/main/resources/META-INF/frontend/vaadin-motion && npm ci && npm run typecheck
```

End-to-end tests (Playwright, Chromium and Firefox) run against the example application:

```bash
mvn -f examples/motion-starter/pom.xml package -Pproduction -DskipTests
cd e2e && npm ci && npm test
```

## License

Apache 2.0 — © WontLost Ltd
