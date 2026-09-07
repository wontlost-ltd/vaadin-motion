# vaadin-motion E2E

Playwright end-to-end suite driving `examples/motion-starter`.

## Coverage

| Spec | What it locks down |
|---|---|
| `boot-sequence.spec.ts` | Scramble text, split-text entrance with its screen-reader copy, progress bar filling, and the handover to the console |
| `console-shell.spec.ts` | Tab switching (instant, one panel at a time, state retained, no leaks across repeated switches) and reduced-motion behaviour |
| `incident-queue.spec.ts` | FLIP reordering (tween present, vertical only, non-compounding), drag to reorder (single-slot precision, DOM/server agreement, no residual transform, buttons still clickable), exit direction, the SEV1 guard and the empty state |
| `metrics-strip.spec.ts` | Count-up through intermediate values, thousands grouping, no animation on first render, selective highlighting, and the `var()` colour-parsing regression |
| `topology-panel.spec.ts` | SVG stroke drawing, path motion along the failing edge, expand/collapse handing height back to `auto`, and exact icon morphing (subpaths preserved, no float noise) |
| `postmortem-panel.spec.ts` | Scroll-linked reading progress in SYNC mode, rebinding across tab switches, viewport reveal in PLAY mode, and skeleton handover |
| `war-room.spec.ts` | Free dragging, grid snapping, lock/unlock (binding released and restored), board layout, and the pointer-following focus marker |
| `code-peek.spec.ts` | Per-panel Motion snippets: extracted from the real `.java` sources rather than copied, collapsed until asked for, `aria-expanded` tracking, and balanced braces |
| `remove-lifecycle.spec.ts` | Rapid repeated `remove` clicks (`afterDetach` runs once thanks to in-flight dedup, the single-click path is unaffected, and a re-added component can be removed again); parent `removeAll()` mid-animation (every element leaves the DOM, the main thread stays responsive, nothing accumulates across rounds); both edges combined |

Console specs boot through the start-up screen via the `bootIntoConsole` helper, which waits for
the handover rather than sleeping — the boot duration varies with machine speed, and under
`prefers-reduced-motion` the screen is gone almost immediately.

The `MotionStressView` fixture (route `/stress`) stretches the exit duration to **1500ms** so
that "mid-animation" actions really land mid-flight rather than winning a race by luck.

## Running

> **⚠️ Clear the caches before building after switching between dev and production.** Vaadin
> caches frontend output in `src/main/bundles/{dev,prod}.bundle` and reuses it across modes.
> Measured: running `mvn spring-boot:run` and then `-Pproduction` leaves `stats.json` holding
> the dev-time manifest, so newly added routes never get their own chunk and components are
> not upgraded (surfacing as `this.enter is not a function` with animations silently doing
> nothing). `mvn clean` does **not** remove `src/main/bundles/`, so delete it by hand:
>
> ```bash
> rm -rf src/main/bundles src/main/frontend/generated node_modules package.json package-lock.json
> ```

Build the production jar first:

```bash
mvn -f ../pom.xml install -DskipTests          # install the add-on into the local repository
mvn -f ../examples/motion-starter/pom.xml package -Pproduction -DskipTests
```

Then run the tests (`playwright.config.ts` starts the jar for you):

```bash
npm install
npx playwright install --with-deps    # first run only
npm test                              # chromium + firefox
npm run test:headed                   # when you want to watch the animations
```

The port defaults to 8090 and can be overridden with `E2E_PORT`.

## Looking around by hand

```bash
java -jar ../examples/motion-starter/target/motion-starter-1.0.0-SNAPSHOT.jar --server.port=8090
```

- `/` — `ConsoleView`, the Sentinel Ops incident response console and the application's only
  product route. Opens on a boot screen, then a metrics strip over three tabs (queue, topology,
  postmortem) with a war-room board alongside.
- `/stress` — `MotionStressView`, a **test fixture rather than a product surface**. It stretches
  the exit duration to 1500ms so that "mid-animation" actions genuinely land mid-flight, and
  projects server state onto `<span>` probes. The console cannot cover the removal lifecycle:
  those tests need a deliberately slow exit and direct visibility of server-side counters.
