# AGENTS.md — dsh-workspace-running-indicator

> 面向后续 agent / 维护者。用户文档见 [`README.md`](README.md)。

## 这是什么

纯客户端插件：工作区在侧边栏收起时，在标题行尾显示该工作区最值得注意的会话状态（等待处理 / 进行中 / 已完成待查看）。Host 半体（`lib/index.js`）只做版本门，功能全部在 `client.js`。

## 为什么只能做 DOM 补丁

DSH `0.2.2-alpha.3` 的 `sidebar.workspaces` slot 只声明了 5 个子 slot，**全部作用于会话行**：

| 子 slot | 作用对象 |
|---|---|
| `sidebar.session.row.leading` | 会话行 |
| `sidebar.session.row.trailing` | 会话行 |
| `sidebar.session.row.hover` | 会话行 |
| `sidebar.workspaces.session.row.action` | 会话行 |
| `sidebar.workspaces.directoryFlow` | 目录选择流 |

工作区标题行由 `@deepseek-ai/dsh-client-ui-workspace` 的 `ProjectRow` 直接渲染，内部没有 slot 可插。替换整个 `sidebar.workspaces`（`replaceRisk: shadows-shipped-ui`）等于重写整个工作区浏览器，不可行。

## 实现决策

**追加一个独立的指示器节点，排在行尾。** 最初试过「行属性 + CSS 伪元素」，但原生转圈是两层圆（25% 不透明的轨道 + 虚线伸缩的弧），伪元素画不出来，只能换成真实节点复刻 `StateDot` 结构。风险控制靠三点：

1. 节点**永远 append 在行尾**，不改宿主任何既有子节点的顺序，React 用它自己记录的 stateNode 做 `insertBefore`，不会被我们的末尾节点干扰；
2. 只追加/移除自己那一个节点，行被 React 重建时 `MutationObserver` 的 `childList` 会触发重新同步；
3. 卸载时 `clearIndicators` 移除全部节点。

**视觉规格照抄原生 `StateDot`**（`dsh-client-ui-primitives`，源码在 `dsh-web-frontend` 的打包产物里），三种状态各用原生的一套：

| 状态 | 形态 | 规格 |
|---|---|---|
| `ongoing` | SVG 转圈 | 14×14、`viewBox="0 0 24 24"`、r=9.5、`stroke-width: 2`；`--dsw-alias-label-tertiary`；旋转 1.5s linear、弧长伸缩 1.5s ease-in-out（`12 150 → 24 150 → 12 150`，offset `0 → -6 → 0`） |
| `warning` | 实心点 | 10×10；`--dsw-alias-state-warn-primary`；`::after` `inset: 20%` 圆形 |
| `done` | 实心点 | 10×10；`--dsw-alias-state-success-primary`；`::after` `inset: 20%` 圆形 |

减少动效时与原生一致：停转并固定成 `18 150` / `-3` 的静态弧。改这些数值前先回读前端产物，别凭印象调。

**行定位只用稳定契约，不用 CSS Modules 类名。** `ProjectRow` 的 class 是构建期哈希（本次核对时是 `YDXeBa_projectRow`，会随构建变化），所以选择器只用：

- `[role="treeitem"][data-row-key^="workspace:"]` — 工作区行
- 行上的 `aria-expanded="false"` — 收起状态
- 同一棵树的会话行是 `session:<id>`、空态行是 `empty`、溢出按钮是 `overflow:<key>`，前缀过滤足够精确

**节点标记** `data-dsh-workspace-state`，其值即状态（`ongoing` / `warning` / `done`）；样式元素必须带 `data-plugin="dsh-workspace-running-indicator"`、样式表里的选择器也必须带 `data-plugin` 标记——`dsh-client-modules` 会把未打标签的 style 认领给下一个 materialize 的 bundle，热更新会删错样式。

**不影响 hover 的约束**：

1. 鼠标移入时 `display: none`，且规则限定在 `@media (hover: hover)`（与 DSH 自己的 hover 规则同条件），行内 flex 布局完全回到原生状态；
2. 不改宿主任何 class 与样式，只追加/移除自己的节点；
3. 节点 `aria-hidden="true"`，不进入无障碍树。

## 数据来源

| 事实 | 来源 |
|---|---|
| 会话状态（`running` / `pendingInteraction` / `completionUnread`） | `ctx.uiSession.sessionStatus`（`ObservableSnapshot<Map>`，**可选增强**） |
| 子代理运行数 | `ctx.sessions.list` 的 `projectionsBySession[parentId].values.subagentCatalog` |
| 哪些会话归属哪个工作区 | `ctx.workspaces.list` 的 `items[].sessionIds` |
| 归档集合 | `ctx.workspaces.list` 的 `archivedSessionIds` |
| 未分组会话 | `sessions.list.ids` 中不属于任何 `sessionIds` 的那些 |

**`uiSession` 不是公开 catalog 里的服务**，所以不写进 `inject`，用 `ctx.get('uiSession')` 探测：拿不到时降级为只用 `sessions.list.byId[id].running`（只显示「进行中」），其余状态静默缺席。

**`0.2.2-rc.1`（2026-11-05，同线例行）**：`dsh-client-ui-workspace` 的改动集中在工作区菜单（`Menu` → `data-context-menu-trigger`）与新增对话框；行结构契约未变——`[role="treeitem"][data-row-key^="workspace:"]`、`aria-expanded`、`session:`/`empty`/`overflow:` 前缀、`sessionStatuses()` 的 pending→warning / running→ongoing / completionUnread→done 顺序、`subagentCatalog` 投影、`uiSession.sessionStatus` 服务全部仍在（符号计数与 alpha.3 相同）。隔离宿主实测启动图含本包、页面 0 控制台报错；没有运行中会话时指示器不出现属预期（idle 不显示）。未覆盖：真实运行态下的显示与让位。

## 状态映射与优先级

`sessionState()` 把一个会话映射成三种显示状态，顺序**照抄原生 `sessionStatuses()`**（`dsh-client-ui-workspace`）：

```
pendingInteraction(approval|plan-review|question) → warning
running → ongoing
runningSubagentCount > 0 → ongoing
completionUnread → done
其余 → 不显示（idle）
```

原生把 pending 设计成压过 running（阻塞态优先）；三种 pending 在本插件合并成同一个 warning 视觉。工作区级聚合取所有可见会话里 rank 最高的一个：`warning(3) > ongoing(2) > done(1)`。

归档会话不计入：默认视图不显示它们，计入会出现「收起有状态、展开看不到」。

## 生命周期

- `apply(ctx)` 先做能力检查（`document`、`ctx.effect`、`sessions.list`/`workspaces.list` 的 `getSnapshot`+`subscribe`），任一缺失直接 return；这是跨版本失败闭合的主门。文档不支持 `createElementNS` 时 `createIndicator` 对 ongoing 返回 null（该状态不出现），其余逻辑不受影响。
- 副作用全部包在 `ctx.effect(fn, label)` 里：样式注入、两条快照订阅、`MutationObserver`、初始同步。
- 同步用 `requestAnimationFrame`（无 rAF 时退化为 `setTimeout(16)`）合并，避免侧边栏频繁变动时重复扫描。
- disposer 逆序清理：取消订阅 → 断开 observer → 取消排队回调 → 移除所有指示器节点 → 移除样式表。

## 测试

`test/client.test.js` 用假 DOM 驱动 `__internals` 里的纯函数（`sessionState` / `workspaceStates` / `syncIndicators` / `clearIndicators` / `createIndicator` / `ensureStyle`）与 `apply` 的完整生命周期（含 `uiSession` 订阅触发重算）。几何断言（14px / 10px / viewBox 24 / r=9.5 / inset 20%）和样式断言（三个颜色 token、dasharray、hover 隐藏、reduced-motion）是防漂移的守卫，改视觉时必须同步。客户端 bundle 不 `require` 任何平台模块；测试里的 `require` 会直接抛错，防止将来悄悄引入依赖却没更新 `package.json#dsh.client.inject`。

`test/manifest.test.js` 是四处同源守卫（`package.json` / `lib/index.js` / `install.sh` / 文档）。

## 开发迭代

改 `client.js` 不用重启也不用刷新；改 `lib/index.js`、`package.json` 或 `cordis.patch.yml` 要重启。

## 版本门

宿主实际版本用 `dsh --version` 取。本插件当前在 `0.2.2` 线、下界 `alpha.3`、verified `0.2.2-alpha.3`。跨线只改五个常量（`DSH_COMPATIBILITY_RANGE`、`DSH_RELEASE_LINE`、`DSH_RELEASE_FLOOR`、`PRERELEASE_CHANNELS`、`VERIFIED_DSH_VERSIONS`）与 `install.sh` 的五个同名常量，判定逻辑不动。

**纯客户端插件的版本门只关 Host 半体**：client bundle 由 `dsh-client-modules` 按 `package.json#dsh.client` 直接进启动图，范围外照样在浏览器里跑。所以真正兜底的是 `client.js` 里的能力检查，改版时别以为 Host 门会顺手关掉 UI。

## 已知边界

- 找不到行、`aria-expanded` 缺失、快照形状变化 → 不显示（fail closed），不会报错也不会留下空样式/空属性。
- 多会话同时有状态时只显示一个指示器（按优先级取最高的那个）。
- 纯视觉提示，收起状态不提供屏幕阅读器文案。
- 未分组桶用空 key（`workspace:`）寻址；若 DSH 改了未分组的 key 规则，这一路会失效，但工作区行不受影响。
