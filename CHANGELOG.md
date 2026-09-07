# Changelog

## 0.1.0 (unreleased)

- `Motion.enter` / `Motion.exit` / `Motion.remove` — exit animations that actually play before Flow detaches the element.
- `Motion.stagger` — one-line staggered entrance for a layout's children.
- `Motion.timeline` — fluent cross-component sequencing with a server-side completion callback.
- `Motion.play` — one-off attention presets (shake, pulse, highlight).
- 17 restrained presets, `prefers-reduced-motion` honoured by default, anime.js scope tied to the UI lifecycle.
- `Motion.removeThen` now deduplicates removal animations: a repeat call while one is in flight
  returns immediately, so `afterDetach` runs exactly once per removal. Previously the
  `isAttached()` check happened before the `executeJs` round trip, so a programmatic burst of
  clicks stacked several exit animations on the same element and registered several callbacks.
  The element state itself stayed correct — `removeFromParent()` is null-guarded — but callers
  counting, notifying or writing to a database in the callback saw it run repeatedly. The flag
  is cleared when the detach settles, and cleared *before* `afterDetach`, so a throwing callback
  cannot lock the component forever; "remove, re-add, remove again" is unaffected.
- Fixed the `lit` npm version declaration: `^3.6.0` → `^3.3.3`. That version **does not exist**
  (3.3.3 is the latest lit), so consumers hit
  `ETARGET / No matching version found for lit@^3.6.0` on `npm install` and dev mode could not
  start at all. The bad declaration also overrode the `@vaadin/common-frontend` peer constraint
  (`peer overridden lit@"^3.6.0" (was "^3.0.0")`). Corrected in both places — the `@NpmPackage`
  annotation on `MotionHost` and the frontend `package.json` — the former being what ships to
  consumers inside the jar.
- **`Motion.onScroll` can track another component, and drive a reading-progress bar.** Two
  additions for the same use case. A progress bar sits pinned near the top of its panel, so
  tracking its own position made it read part-full before the reader had scrolled at all; it can
  now be pointed at the content being read. Beyond that, anime.js measures an element travelling
  *through* the viewport, which cannot reach 100% for content taller than the window — the
  element's bottom would have to rise past the viewport top, and when the content is the last
  thing on the page the document runs out of scroll first, leaving the bar stalled around half.
  The new `readingProgress` flag instead measures how much of the content has been seen (the
  viewport's bottom edge advancing from the content's top to its bottom), which reaches exactly
  100% at the end of the record at every window height.
- **Added `Motion.progressTo`** — advances a progress bar to an arbitrary fraction of its track,
  animating from wherever it currently sits. The `PROGRESS` preset always runs 0 to 1, which
  suits a bar tied to a single known-length animation; real work arrives in uneven stages, and
  each stage needs to move the bar on from where the last one stopped. Clamped to 0..1, and
  jumps straight to the target under reduced motion.
- Fixed `Motion.sortable` leaving the dragged element permanently lifted. Cleanup ran from the
  settle animation's `onComplete`, but when the drop reordered the list a FLIP binding on the
  same root rebuilt the rows and called `utils.remove()` on that element, cancelling the settle
  animation and its callback with it. The row kept its lift `scale(1.0171)` and `zIndex: 10`
  indefinitely — visibly enlarged and stacked over its neighbours after every reordering drag.
  Cleanup is now also guaranteed by a timer, so it happens whether or not the animation
  completes.
- Fixed a crash caused by the `highlight` preset passing `var()` to anime.js. Its
  `resolveCssVar` extracts the fallback with `([^)]+)`, which stops at the first `)`, so a
  nested `rgba(...)` was truncated to `"rgba(0,0,0,0.06"`. That value failed both `rgbToRgba`
  regexes, returned `null`, and reading `null[4]` threw
  `TypeError: Cannot read properties of null (reading '4')`. Vaadin 25's Lumo does not define
  `--lumo-primary-color-10pct`, so this path always triggered. The preset now resolves the token
  itself and passes a literal colour.
- **Added `Motion.draggable` / `undraggable`** — built on anime.js `createDraggable`. Supports
  axis locking, container bounds, grid snapping and release settling. Idempotent: a repeat call
  reverts the previous instance rather than stacking pointer listeners. Dragging **still works**
  under reduced-motion (it is a capability, not decoration); only the settling is dropped.
- **Added `Motion.draw` / `drawThen`** — built on `createDrawable`; draws an SVG stroke into
  existence and can erase in reverse. `drawThen` returns to the server once drawing finishes.
  Passing an `<svg>` container draws every geometry child inside it. Under reduced-motion the
  final state is shown immediately.
- **Added `Motion.onScroll` / `clearScroll`** — built on the `onScroll` observer. `PLAY` fires
  once on entering the viewport; `SYNC` ties progress to scroll position (reading progress bars,
  parallax). Also idempotent and unbindable.
- All three of the above are **persistent bindings** that register global listeners, unlike
  one-shot animations: `disconnectedCallback` reverts them together so no listeners survive the
  UI being destroyed.
- **Added `MotionPreset.PROGRESS`** — a horizontal scaleX 0→1 fill intended for SYNC scroll
  progress bars. Using SLIDE_IN_LEFT as a progress bar was wrong: it is an entrance animation
  that only changes opacity and a few pixels of translateX, so the bar stayed full width and
  appeared to span the whole row without following the scroll at all.
- **Added `Motion.layout` / `clearLayout`** — FLIP list reordering, so rows slide from their old
  position to the new one on sort or filter. **Does not use anime.js `createLayout`**: measured,
  the `this.layout` property of its `AutoLayout` instance is never assigned in the constructor,
  so `record()` reads undefined and silently does nothing (reproduced on a clean flat list too)
  — an upstream defect. FLIP is implemented here instead: a MutationObserver reads the new
  positions after DOM changes land but before paint, applies the inverse offset, then animates
  back to zero. Two measurement defects were fixed along the way:
  (a) `record()` measured with `getBoundingClientRect()`, whose result **includes the current
      transform**. Recording while a tween had not settled baked the leftover into the baseline
      as if it were the real position, compounding each round (measured offsets grew
      -124 → -129 → -130 → -131, widening the animation every time). It now clears the transform
      before measuring and restores it after; reading the new positions does the same.
  (b) The first `record()` is deferred by one frame: `layout()` is called on attach, when Vaadin
      has not finished its first render, which produced a bogus -24.7px horizontal offset even
      though every row shares the same left.
- **Added `Motion.count`** — number count-up with decimals, prefix/suffix and thousands
  separators. Set `font-variant-numeric: tabular-nums` on the target to stop the width jittering
  while counting.
- **Added `Motion.reveal`** — skeleton to content handover, with the two animations overlapping.
- **Added `Motion.splitIn`** — split text entrance by character, word or line. The underlying
  `splitText` inserts an extra visually hidden copy of the full text for screen readers and
  marks the visible segments aria-hidden, so `innerText` reports the text twice — that is
  correct accessibility behaviour, not duplication.
- **Added `Motion.morph`** — SVG path morphing (hamburger to close). Passing a wrapper element
  makes it look for the first `<path>` below it. **Defaults to `precision = 0` (no resampling)**:
  with a truthy precision, `morphTo` resamples both paths into N `L` points by arc length, which
  drops the subpath separator `M` (several strokes collapse into one) and produces floating
  point noise such as `7.600000381469727` (upstream rounds x but not y). Measured on
  non-isomorphic paths, `precision=0.33` turned 4 points across 2 strokes into 16 points across
  1. precision=0 requires both paths to share a command sequence but reproduces the target shape
  exactly; structurally different paths can opt into resampling with a positive value.
  The example icon keeps a standard three-bar hamburger: the cross gains a **degenerate middle
  segment** (start and end coincident at the centre) to match the structure. Its length is zero
  and, with `stroke-linecap="round"`, it renders nothing visible — preserving both the correct
  three-bar hamburger and exact interpolation.
- **Added `MotionOptions.spring(stiffness, damping)`** — replaces the easing curve with a
  physical spring whose duration is derived from the physics (overriding duration). Suits drag
  release and modal entrances, where the motion should feel like it has weight.
- **Added `Motion.toggle` / `expand` / `collapse`** — expand and collapse panels. `height:auto`
  cannot be transitioned in CSS, so the target height has to be measured; height is handed back
  to `auto` afterwards so the panel adapts as its content changes. Unlike the EXPAND/COLLAPSE
  presets, these serve repeated opening and closing of the same element.
- **Added `Motion.animatable` / `animatableTo` / `clearAnimatable`** — a reactive target for
  high-frequency updates. It keeps one writable object, which is smoother than creating a
  one-shot animation per update (cursor following, live needles).
- **Added `Motion.followPath`** — motion along an SVG path (flow illustration, demonstrative).
- **Added `Motion.scramble`** — scramble text. Decorative only, aimed at gamified interfaces and
  splash screens; not recommended for enterprise back offices. Note that `scrambleText(params)`
  returns a **tween value** rather than a standalone animator, so it is passed to `animate()` as
  the target value for `textContent`.
- **Added `Motion.sortable` / `clearSortable`** — drag to sort: pick up an item to change its
  position while the others make room. **Handles pointer events itself rather than reusing
  anime.js `createDraggable`**: that helper keeps its own internal offset and rewrites the
  transform every frame, which conflicts with reordering the DOM — after a swap the dragged
  item's resting position jumps by one slot, external compensation is overwritten on the next
  frame, and a single drag cascades into several swaps that carry the item to the end (measured:
  a 48px drag fired 3 reorders). Compensating inside the measurement and correcting
  `draggable.y` after the swap were both tried and neither worked; the hand-rolled
  implementation keeps the offset under its own control, shifting the reference point by the
  same distance right after a swap so the on-screen position stays continuous and the hit test
  is not re-triggered by its own side effect. Measured: a one-slot drag triggers exactly one
  swap, multi-slot drags land precisely, and no inline transform lingers afterwards.
- Added `InteractionMotionView` (route `/interaction`) demonstrating the above, with 8 E2E tests.
- Added `DataMotionView` (route `/data`) demonstrating the five data-state features, with 6 E2E tests.
- Added `AdvancedMotionView` (route `/advanced`) demonstrating draggable, SVG stroke drawing and
  scroll, with 16 E2E tests covering axis locking, grid snap alignment, unbinding, stroke
  progression, server-side callbacks, scroll sync and screen-by-screen reveal.
- Added `examples/motion-starter` (Vaadin 25 + Spring Boot starter) and the `e2e/` Playwright
  suite, covering rapid repeated `remove` clicks and parent `removeAll()` mid-animation.
