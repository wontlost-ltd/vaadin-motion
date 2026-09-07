# 安全策略 / Security Policy

## 支持的版本 / Supported versions

| 版本 | 状态 |
|---|---|
| 0.1.x | ✅ 接受安全修复 |
| < 0.1 | ❌ 不支持（0.1.0 是首个发布版本） |

## 报告漏洞 / Reporting a vulnerability

**请不要通过公开 issue 报告安全问题。**

Please do not report security issues through public issues.

请使用 GitHub 的私密报告通道：
[Security → Report a vulnerability](https://github.com/wontlost-ltd/vaadin-motion/security/advisories/new)

或发送邮件至 service@wontlost.com。

报告中请尽量包含：受影响版本、复现步骤、以及你认为的影响范围。有可运行的复现
示例会显著加快确认速度。

我们会在收到后尽快确认。这是一个小型开源项目，没有专职安全团队，因此不承诺
具体的响应时限——但会如实告知处理进度，包括「暂时无法处理」这种情况。

## 本项目的安全边界 / Threat model

明确一下这个 add-on 做什么、不做什么，以便判断什么算漏洞：

- **它做的事**：把动画参数从服务端传到客户端，由 anime.js 执行。参数是一个
  几十字节的 JSON，内容为预设名与数值（时长、位移、缓动函数名）。
- **它不做的事**：不处理用户输入、不做认证鉴权、不访问文件系统或网络、
  不持久化任何数据。

因此最值得关注的攻击面是：
1. `MotionOptions.raw(json)` —— 唯一允许传入任意内容的入口。若应用把用户可控
   的字符串传进去，等于让用户控制 anime.js 参数。**请勿将未经校验的用户输入
   传给 `raw()`。**
2. 随 jar 分发的前端依赖（anime.js、Lit）—— 这些会在下游用户的浏览器里执行，
   其漏洞会传递给使用本 add-on 的应用。我们通过 Dependabot 跟踪。

## 依赖 / Dependencies

前端依赖通过 `@NpmPackage` 声明，随 jar 传递给下游：

- `animejs` — 动画引擎
- `lit` — 宿主元素的基类

Java 侧除 Vaadin 本身外无运行时依赖（序列化用的是内部实现，刻意不引入 Jackson，
以避免与下游的 Jackson 版本冲突）。
