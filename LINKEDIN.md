# LinkedIn 发布文案

草稿，发布前可自行删改。建议配 Sentinel Ops 控制台的截图或 10–15 秒录屏
（boot 动画 → 队列拖拽重排 → 拓扑 trace）。

---

## 正文

Vaadin Flow has no concept of motion. `add()` pops a component in, `remove()` yanks it out.

The reason isn't laziness — it's ordering. `parent.remove(child)` detaches the DOM node in the
same server round trip, so an exit animation never gets a single frame to play. Add-ons have
stalled on exactly this since 2019.

vaadin-motion inverts the order: the client plays the exit, resolves a promise (raced against a
timeout, so it always resolves even if the tab is throttled), and only *then* does the server
detach the component and run your callback.

```java
Motion.removeThen(row, MotionPreset.SLIDE_OUT_LEFT, MotionOptions.duration(220), () -> {
    incidents.remove(incident);   // runs once the row is genuinely gone
    refreshMetrics();
});
```

No JavaScript. No CSS classes to coordinate. The server stays the single source of truth for the
component tree.

🔹 30 methods: FLIP list reordering, drag-to-sort, scroll-linked progress, SVG draw & morph,
count-up, split-text
🔹 18 deliberately quiet presets — 150–200 ms, 8 px travel. Enterprise users want smooth, not showy
🔹 `prefers-reduced-motion` honoured by default, with callback ordering unchanged — no second code
path to maintain
🔹 106 end-to-end tests across Chromium and Firefox

**Live demo — an incident response console:** https://sentinel-ops.wontlost.com
Every panel has a "Show code" toggle. The snippets are extracted from the source files at runtime,
so what you read is what's running.

**Maven Central:** `com.wontlost:motion-vaadin:0.1.0`
**Source (Apache 2.0):** https://github.com/wontlost-ltd/vaadin-motion

———

Vaadin Flow 里没有「动效」这个概念。`add()` 让组件突然出现，`remove()` 把它直接拽走。

这不是没人做，而是时序问题：`parent.remove(child)` 在同一个服务端往返里就把 DOM 节点摘掉了，
退场动画连一帧都轮不上。从 2019 年起，做这件事的 add-on 都卡在这里。

vaadin-motion 把顺序倒过来：客户端先播完退场动画，resolve 一个 promise（并与超时竞速，
所以哪怕标签页被浏览器限流也一定会 resolve），**然后**服务端才摘除组件并执行你的回调。

不用写 JavaScript，不用协调 CSS class。组件树的唯一事实来源仍然在服务端。

🔹 30 个 API：FLIP 列表重排、拖拽排序、滚动联动进度、SVG 描边与形变、数字滚动、文字拆分入场
🔹 18 个克制的预设 —— 150–200ms、8px 位移。企业用户要的是顺滑，不是炫技
🔹 默认尊重 `prefers-reduced-motion`，且回调时序完全一致 —— 不需要维护第二套代码路径
🔹 106 个端到端测试，覆盖 Chromium 与 Firefox

**在线 demo —— 一个事故响应控制台：** https://sentinel-ops.wontlost.com
每个面板都有「Show code」开关，代码片段在运行期从源文件抽取，所见即所跑。

**Maven Central：** `com.wontlost:motion-vaadin:0.1.0`
**源码（Apache 2.0）：** https://github.com/wontlost-ltd/vaadin-motion

#Vaadin #Java #OpenSource #WebDevelopment #UX

---

## 备选开头（若想更短、更钩子化）

> 为什么 Vaadin 组件的退场动画从来播不出来？
>
> 因为 `parent.remove(child)` 在同一个往返里就把 DOM 节点摘了。动画连一帧都没有。
>
> 解法是把顺序倒过来 👇

---

## 说明

- 首句到「2019」之间是 LinkedIn 折叠前可见的部分，钩子集中在这里。
- 代码块在 LinkedIn 上不会等宽渲染，若排版难看可整段删掉，只留文字描述。
- 中英之间用「———」分隔，读者可自行跳到对应语言。
