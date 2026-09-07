# LinkedIn 发布文案

LinkedIn 不支持 Markdown：反引号、`**粗体**`、三反引号代码块都会原样显示。
下面的正文已按纯文本写就，可直接整段复制粘贴。

强调用大写和留白代替粗体；代码用缩进而非代码块；列表用「•」而非「-」。

建议配 10–15 秒录屏（boot 动画 → 队列拖拽重排 → 拓扑 trace），比截图更能体现动效主题。

---

## 正文（直接复制以下内容）

Vaadin Flow has no concept of motion. add() pops a component in, remove() yanks it out.

The reason isn't laziness — it's ordering. parent.remove(child) detaches the DOM node in the same server round trip, so an exit animation never gets a single frame to play. Add-ons have stalled on exactly this since 2019.

vaadin-motion inverts the order: the client plays the exit, resolves a promise (raced against a timeout, so it always resolves even if the browser tab is throttled), and only then does the server detach the component and run your callback.

    Motion.removeThen(row, SLIDE_OUT_LEFT, duration(220), () -> {
        incidents.remove(incident);   // runs once the row is really gone
        refreshMetrics();
    });

No JavaScript. No CSS classes to coordinate. The server stays the single source of truth for the component tree.

What's in it:

• 30 methods — FLIP list reordering, drag-to-sort, scroll-linked progress, SVG draw and morph, count-up, split-text
• 18 deliberately quiet presets — 150–200 ms, 8 px travel. Enterprise users want smooth, not showy
• prefers-reduced-motion honoured by default, with callback ordering unchanged — no second code path to maintain
• 106 end-to-end tests across Chromium and Firefox

LIVE DEMO — an incident response console:
https://sentinel-ops.wontlost.com

Every panel has a "Show code" toggle. The snippets are pulled from the source files at runtime, so what you read is what's running.

Maven Central: com.wontlost:motion-vaadin:0.1.0
Source, Apache 2.0: https://github.com/wontlost-ltd/vaadin-motion

———

Vaadin Flow 里没有「动效」这个概念。add() 让组件突然出现，remove() 把它直接拽走。

这不是没人做，而是时序问题：parent.remove(child) 在同一个服务端往返里就把 DOM 节点摘掉了，退场动画连一帧都轮不上。从 2019 年起，做这件事的 add-on 都卡在这里。

vaadin-motion 把顺序倒过来：客户端先播完退场动画，resolve 一个 promise（并与超时竞速，所以哪怕标签页被浏览器限流也一定会 resolve），然后服务端才摘除组件并执行你的回调。

不用写 JavaScript，不用协调 CSS class。组件树的唯一事实来源仍然在服务端。

具体内容：

• 30 个 API —— FLIP 列表重排、拖拽排序、滚动联动进度、SVG 描边与形变、数字滚动、文字拆分入场
• 18 个克制的预设 —— 150–200ms、8px 位移。企业用户要的是顺滑，不是炫技
• 默认尊重 prefers-reduced-motion，且回调时序完全一致 —— 不需要维护第二套代码路径
• 106 个端到端测试，覆盖 Chromium 与 Firefox

在线 DEMO —— 一个事故响应控制台：
https://sentinel-ops.wontlost.com

每个面板都有「Show code」开关，代码片段在运行期从源文件抽取，所见即所跑。

Maven Central：com.wontlost:motion-vaadin:0.1.0
源码，Apache 2.0：https://github.com/wontlost-ltd/vaadin-motion

#Vaadin #Java #OpenSource #WebDevelopment #UX

---

## 更短的版本（若嫌上面太长）

Vaadin Flow 组件的退场动画从来播不出来，原因不是没人做，而是时序：parent.remove(child) 在同一个服务端往返里就把 DOM 节点摘了，动画连一帧都没有。

vaadin-motion 把顺序倒过来 —— 客户端先播完，再由服务端摘除组件并执行回调。不用写一行 JavaScript。

在线 demo（事故响应控制台，每个面板都能看到驱动它的 Java 代码）：
https://sentinel-ops.wontlost.com

Maven Central：com.wontlost:motion-vaadin:0.1.0
源码：https://github.com/wontlost-ltd/vaadin-motion

#Vaadin #Java #OpenSource

---

## 排版说明

- LinkedIn 折叠在约前 3 行，钩子集中在开头两句。
- 代码用 4 空格缩进。LinkedIn 不等宽渲染，但缩进仍能让它在视觉上与正文分离；
  为此已把示例简化（省去 MotionPreset. / MotionOptions. 前缀）以缩短行宽，避免换行错位。
- 「•」符号在各平台显示稳定，比「-」更像列表。
- 段落之间留空行 —— LinkedIn 会保留，这是纯文本里唯一可靠的分隔手段。
- 中英之间用「———」分隔，读者可自行跳到对应语言。
