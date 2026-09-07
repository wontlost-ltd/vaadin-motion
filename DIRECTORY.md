# MotionVaadin

**Restrained, server-driven motion for Vaadin Flow, powered by [anime.js v4](https://animejs.com/).**

Flow has no concept of motion. `add()` pops a component in, `remove()` yanks it out, and a sorted
grid redraws with no hint that anything moved. MotionVaadin gives the Java side an
intent-revealing API for the cases where movement carries meaning — which row you just actioned,
what changed while you were looking elsewhere, where a request fails — and stays out of the way
everywhere else.

Everything is driven from Java. There is no JavaScript to write, no CSS classes to coordinate,
and no client-side state to keep in step with the server.

```java
Motion.enter(card, MotionPreset.SLIDE_UP);
Motion.play(amountField, MotionPreset.SHAKE);      // validation failed
Motion.remove(card);                               // plays the exit, THEN detaches
```

## The problem it solves

`parent.remove(child)` detaches the DOM node in the same round trip, so an exit animation never
gets a frame to play. This is why component removal in Flow has always been abrupt, and why
earlier attempts at Flow animation add-ons stalled.

`Motion.remove` inverts the order:

1. The server asks the client to play the exit and hands back a `PendingJavaScriptResult`.
2. The client animates, then resolves a promise — raced against a timeout, so it **always**
   resolves even if the animation throws or the browser tab is throttled.
3. Only then does the server detach the component and run your callback.

The component is never leaked, and the server remains the single source of truth for the
component tree. Repeat calls during an in-flight removal are de-duplicated, so a callback that
decrements a counter or writes to a database runs exactly once per removal — even under a burst
of double-clicks.

```java
Motion.removeThen(row, MotionPreset.SLIDE_OUT_LEFT, MotionOptions.duration(220), () -> {
    incidents.remove(incident);     // runs once the row is genuinely gone
    refreshMetrics();
});
```

## What it does

**Lifecycle** — entrance and exit animations bound to attach/detach, staggered entrances for a
layout's children, and cross-component timelines that report completion back to the server so
business logic can be sequenced against them.

**Lists that rearrange visibly** — FLIP reordering tweens rows to their new positions when a list
is sorted or filtered, so the list reads as *rearranged* rather than redrawn. Drag-to-sort is
built in, with the reordered index reported to the server.

**Pointer interaction** — free dragging with axis locking, container bounds and grid snapping;
plus a high-frequency `animatable` binding for values that update continuously, such as a marker
following the cursor.

**Scroll** — reveal content as it enters the viewport, or tie a reading-progress bar to scroll
position through a long document.

**SVG** — draw a stroke into existence, move an element along a path, or morph one path into
another. Morphing interpolates exactly rather than resampling, so icons keep their subpaths and
gain no floating-point noise.

**Data display** — number count-up with formatting, split-text entrances, scramble text, and
skeleton-to-content handover.

## Presets

Presets are deliberately quiet: 150–200 ms, 8 px of travel, standard easings. Enterprise users
want *smooth*, not *showy*.

| Kind | Presets |
|---|---|
| Enter | `FADE_IN` `SLIDE_UP` `SLIDE_DOWN` `SLIDE_IN_LEFT` `SLIDE_IN_RIGHT` `SCALE_IN` `EXPAND` `PROGRESS` |
| Exit | `FADE_OUT` `SLIDE_OUT_UP` `SLIDE_OUT_DOWN` `SLIDE_OUT_LEFT` `SLIDE_OUT_RIGHT` `SCALE_OUT` `COLLAPSE` |
| Attention | `SHAKE` `PULSE` `HIGHLIGHT` |

The API enforces intent rather than trusting the caller: passing an exit preset to `Motion.enter`
throws immediately instead of misbehaving at runtime. `MotionOptions` overrides duration, delay,
easing, spring physics and stagger; `raw(json)` is an escape hatch for arbitrary anime.js
parameters.

## Accessibility

`prefers-reduced-motion` is honoured by default. Durations collapse to zero while **business
logic and callback ordering stay identical**, so there is no second code path to maintain and no
risk that a reduced-motion user hits a different bug. Opt out per UI if you need to.

Where motion carries meaning, it is never the only carrier. The example application shakes a row
that cannot be acknowledged *and* explains why in text.

## Example application

The bundled example is a complete incident-response console rather than a gallery of effects: a
live queue with FLIP reordering and drag-to-sort, a service topology that draws itself and traces
a failing request to the dependency that breaks it, a postmortem with reading progress, and a
war-room board with draggable notes.

Each panel has a **Show code** toggle displaying the Motion calls behind it — extracted from the
source files at runtime, so the snippets cannot drift from the implementation.

```bash
cd examples/motion-starter && mvn spring-boot:run
```

## Installation

```xml
<dependency>
    <groupId>com.wontlost</groupId>
    <artifactId>motion-vaadin</artifactId>
    <version>0.1.0</version>
</dependency>
```

| Requirement | Version |
|---|---|
| Vaadin | 25.x |
| Java | 21+ |
| anime.js / Lit | pulled in automatically via `@NpmPackage` |

## Design notes

- **Nothing outlives the UI.** One hidden host element per `UI` owns a single anime.js scope,
  reverted on disconnect.
- **Idempotent.** Re-triggering an animation on a component that is mid-flight replaces it rather
  than stacking tweens.
- **Persistent bindings are explicit.** Dragging, sorting, FLIP, scroll and animatable bindings
  register listeners that outlive a single animation; each has a matching release call, and
  rebinding reverts the previous instance rather than accumulating listeners.
- **No Jackson coupling.** Payloads are a few dozen bytes, written by a small internal
  serialiser, so the add-on is independent of the Jackson version a given Vaadin release ships.
- **Not in scope:** chart animation — charting libraries animate their own data transitions.

## Quality

- 106 end-to-end tests across Chromium and Firefox, plus JUnit coverage of the Java API.
- The end-to-end assertions check that transitions *actually happen*, not merely that the end
  state is correct — a correct end state reached by an instant jump is precisely the failure
  these features exist to prevent.
- Releases are gated on a green CI run for the exact commit being published.

Apache 2.0 · [Source](https://github.com/wontlost-ltd/vaadin-motion) ·
[Issues](https://github.com/wontlost-ltd/vaadin-motion/issues)
