# 贡献指南 / Contributing

欢迎 issue 与 PR。以下是让改动更容易被合并的一些说明。

## 构建与测试

```bash
# 库本体（含 4 个 JUnit 套件）
mvn clean verify

# 连接器类型检查
cd src/main/resources/META-INF/frontend/vaadin-motion && npm ci && npm run typecheck

# 端到端测试（106 个，Chromium + Firefox）
mvn -f examples/motion-starter/pom.xml package -Pproduction -DskipTests
cd e2e && npm ci && npm test
```

需要 Java 21、Node 24（仓库根目录有 `.nvmrc`）。

## 关于测试的一点说明

这个项目的 E2E 断言有一条原则：**验证过渡确实发生了，而不只是终态正确**。

一个动画即便完全没播、直接跳到终点，终态也是对的——而那正是这些功能要防止的
失败。所以测试会去采样动画中途的 transform、检查 dasharray 是否在推进、确认
数字是否真的在跳动。新增测试时请沿用这个思路。

例：不要只断言排序后的顺序，要同时断言排序过程中有元素带着 transform。

## 代码风格

- 沿用现有风格。Java 侧四空格缩进，TypeScript 侧遵循仓库的 tsconfig。
- 注释写「为什么」，不写「做了什么」。代码本身能说明后者。
- 若某处实现绕开了显而易见的写法，请在注释里说明原因——通常是踩过坑，
  下一个人应该知道。

## 提交 PR 前

- [ ] `mvn clean verify` 通过
- [ ] 连接器 `npm run typecheck` 通过
- [ ] 若改动影响运行时行为，E2E 也通过
- [ ] 新增或修改的公开 API 有 Javadoc

CI 会跑全部四项：build job 跑单元测试与类型检查，e2e job 单独跑
端到端测试（先构建示例应用，因此较慢，与 build 并行）。

## 提交信息

用 [Conventional Commits](https://www.conventionalcommits.org/)：
`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`

正文里说明动机，尤其是修 bug 时——「为什么之前是错的」比「改成了什么」更有价值。

## 报告安全问题

请勿通过公开 issue 提交，见 [SECURITY.md](SECURITY.md)。
