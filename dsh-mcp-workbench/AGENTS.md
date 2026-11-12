# dsh-mcp-workbench — 技术说明（AGENTS.md）

> 面向在本工作区继续开发/排查的 agent；用户文档见 `README.md`。
> 目标 DSH `0.2.2`，兼容线 `>=0.2.2-alpha.2 <0.2.3`；已逐版本核对 `0.2.2-alpha.2`、`0.2.2-rc.1`、`0.2.2-rc.2`。上一线 `0.2.1` 的用户留在上一线的插件版本。

## 一句话

本插件**不自建 MCP 管理**：服务器清单存放在官方 `@deepseek-ai/dsh-mcp-manager` 条目的 `config.servers` 里，由官方管理器挂载、重连、探测、重启；本包只提供**设置页 UI**（读写该条目、展示官方状态流、管理凭据、迁移/导入旧清单）与一个带鉴权的宿主状态路由（版本门 + 官方条目定位）。

**为什么在 0.2.2-rc.2 换掉自建实现**：官方 `mcp-manager` 默认挂载在 web profile（`dsh-web-app` 的 `mcp-manager` 行），具备同一组能力且没有浏览器 UI。两边同时挂载 `mcp-client` 会共享 `serverName` 命名空间，两套清单必然互相踩；把挂载/对账/探测交还官方、本包只留 UI，是唯一不会长期分叉的方向。

## 已核对的契约（0.2.2-rc.2，不是猜测）

| 事实 | 来源 |
|---|---|
| 官方管理器包名 `@deepseek-ai/dsh-mcp-manager`，web profile 默认行 id `mcp-manager`；`Config.servers` 是 `Record<serverName, Entry>` 且声明 **volatile** | `dsh-web-app/cordis.patch.yml`；`dsh-mcp-manager/src/index.ts` |
| 条目字段：`transport`/`command`/`args`/`env`/`cwd`/`url`/`headers`/`enabled`/`toolCallTimeoutMs?`/`startupTimeoutMs`(默认 30000)/`closeTimeoutMs?`/`reconnect`(默认 500ms 起、30s 上限、10 次) | 同上 `ServerEntrySchema`/`RECONNECT_DEFAULTS` |
| **设置命名空间是 `entry.options.id`，不是 loader 行 id**：include 展开后 `entry.id` 是 `include:mcp-manager`，而 `settings.describe()` 的 `ns` 用 `options.id` | `dsh-settings/lib/index.js` 的 `describe()`（`ns: entry.options.id`）；本轮隔离宿主实测修正过 |
| 客户端读设置：`ctx.configForms.get(ns)` → `{getSnapshot, subscribe, mutate, set, unset}`；`mutate` 的 op 是 `{op:'set', path:string[], value}` / `{op:'unset', path}` | `dsh-client-ui-settings/lib/types/client/config-form-types.d.ts`；`dsh-settings/lib/types/types.d.ts` |
| 官方 Remote 面：`ctx.remote.mcpManager.watch(signal)`（完整列表流）、`.restart(name)`、`.probe(name, signal)`，客户端必须 inject `'remote.mcpManager'` | `dsh-mcp-manager/lib/typert.remote-client.d.ts`；`dsh-api-remotes/lib/client.js` |
| `watch` 的每项是 `{name, configured, status}`；`status` = mcp-client 的 `McpConnectionStatus`（`closed`/`waiting-credentials`/`connecting`/`connected{toolCount}`/`reconnecting{attempt,maxAttempts,nextRetryAtMs}`/`failed{reason,lastError}`）+ 管理器的 `disabled` / `failed{reason:'load'|'cleanup'}` | `dsh-mcp-manager/lib/types/types.d.ts`；`dsh-mcp-client/lib/types/types.d.ts` |
| `probe` 返回 `McpProbeResult`：`{ok:true, serverInfo?, toolNames, truncated, durationMs, closeConfirmed, cleanupError?}` 或 `{ok:false, stage:'connect'|'list', message, durationMs}`——**失败不抛错**；禁用的条目也能探测 | `dsh-mcp-client/lib/types/probe.d.ts` |
| 凭据模板语法是 `${credential:REF}`（六个位置：command/args/env/cwd/url/headers）；缺失值让实例进入 `waiting-credentials` | `dsh-mcp-client/lib/types/templates.d.ts`；`dsh-mcp-manager` README |
| `settings.configure({auto:false}, fiber)` 用来声明「本实例自带设置页」，否则官方会为条目再自动生成一页 | `dsh-settings/lib/index.js` 的 `configure()` |
| `settings.section.icon` 是 list/root/inline 槽（0.2.2-alpha.3 起），壳层 `renderSlot(..., {only: row.id, fallback: navIcon(id)})` | `dsh-client-ui-settings-general/lib/client.js` |
| 状态路由鉴权：`connection` 必须作为**注入依赖**等待就绪；`clientRequestRejection` 在连接层缺失时 fail closed 401 | `dsh-client-connection/lib/index.js`；本轮沿用 |
| 组合层只读/导入读 `entry.fiber.config`（已求值），不是 `entry.options.config`（未求值的 `!!js` 对象） | 旧版本实测踩坑；`lib/index.js` 的 `findMcpEntryConfig` |

## 结构

| 文件 | 职责 |
|---|---|
| `lib/index.js` | Cordis 入口：版本门、官方 `mcp-manager` 条目探测（返回 `options.id`）、`/status` 与 `/action`（仅 `import`）、组合层只读投影与导入（敏感值 → 凭据库 + 模板） |
| `lib/dsh.js` | DSH 安装定位与版本门（发布线 + 下界常量、`classifyDshVersion`） |
| `lib/store.js` | 纯逻辑：官方条目规范化/校验、凭据模板识别、旧条目 → 官方条目转换 |
| `lib/targets.js` | 纯逻辑：组合层 MCP 行只读投影（脱敏）与导入转换（`${credential:...}` + 默认停用） |
| `client.js` | 单文件 CJS bundle：设置分区（`settings.section` id `mcp-console` order 130）、`configForms` 读写官方 `servers`、`remote.mcpManager.watch` 状态、探测/保存/启停/删除、迁移横幅、凭据区、导航图标（官方槽优先 + DOM 补丁兜底） |
| `test/harness.js` | 测试用小 React 运行时（含 `useMemo` 桩） |

## 关键实现事实

1. **清单真相 = 官方条目的 `config.servers`**：客户端只经 `configForms.get(<manager ns>)` 读写；宿主不持有清单、不做对账。
2. **条目 id 必须取 `options.id`**：`entry.id` 是 `include:mcp-manager`，拿它去 `configForms.get()` 会得到 `unavailable`。本轮隔离宿主实测踩到并修正。
3. **保存 = 先写停用态 → `probe` → 通过才启用**：一次 `mutate` 写入 `{...entry, enabled:false}`（改名时同批 `unset` 旧 key），探测成功后再写 `servers.<name>.enabled=true`；失败保留停用配置并显示原因，不丢数据。两次写入是刻意的两阶段，不是原子性缺陷。
4. **改名 = 删旧 key + 写新 key**：官方 dict 的 key 就是身份，没有可变的 `id` 字段。
5. **旧清单迁移**：读 `configForms.get('dsh-mcp-workbench').value.servers`（旧版数组），逐条 `legacyToManaged`（`credential:KEY` → `${credential:KEY}`、丢弃展示名与 `failOnStartupError`），同名冲突跳过并报告；写完后清空旧条目的 `servers`。迁移是显式按钮，不自动执行。
6. **组合层导入**：宿主读 `entry.fiber.config`（已求值），敏感字段（键名 `/KEY|PASSWORD|SECRET|TOKEN|AUTH/`、`Bearer|Basic` 值、URL 查询串 token/userinfo）转模板并 `credentials.set`，返回给浏览器的只有键名与模板；导入条目 `enabled:false`，用户保存时才探测。
7. **状态流**：优先 `ctx.remote.$stream({name, open: signal => mcpManager.watch(signal), ended, carrierFailed})`（断线由 gateway 重开），拿不到 `$stream` 时退回裸 `watch(signal)`；`for await` 的项可能是 `{value, accept}` 帧或值本身，两种都认。
8. **`probe` 失败不抛错**：按 `result.ok === false` 与 `result.value.ok === false` 两层判断；`RemoteResult` 的 `ok:false` 是传输层拒绝，`value.ok:false` 是连接/列工具失败。
9. **导航图标双路径**：`settings.section.icon` 槽可用时注册 `McpSectionIcon`；同时 `settings.action` 的 `McpNavIcon` 保留 DOM 补丁兜底。补丁在 `useLayoutEffect` 里先查 `[data-slot="settings.section.icon"]`，已渲染就跳过（否则出现两个图标）。
10. **样式必须打 `data-plugin`**：`dsh-client-modules` 的 `claimStyles` 按标签认领，`data-plugin` 缺失会被别的 bundle 抢走、HMR 时误删。
11. **客户端与宿主可能短暂新旧并存**：`lib/*.js` 改动要重启宿主，`client.js` 刷新页面即可。状态载荷带 `manager.entryId`；拿不到时客户端用兜底 `mcp-manager` 并显示「没有找到官方管理器」，不猜测。
12. **动作路由整体兜底**：任何异常都返回可读 JSON，否则 node:http 会回空 body 400，页面无法排查。
13. **状态路由鉴权**：`ctx.inject(['webServer','connection'])` 等两者就绪；`connection` 不可用时 401，不放行。固定头 `x-dsh-mcp-workbench-client: 1` + CSRF 用于写动作。
14. **旧实现已移除**：`lib/mount-manager.js`、`lib/plan.js` 与对应测试删除（备份在 `/tmp/dsh-mcp-workbench-legacy-20261112-145223/`）；`store.js` 不再导出挂载相关函数。不要再把「自己 `ctx.plugin(mcp-client)`」加回来——那会与官方管理器抢 `serverName`。

## 验证现状

```bash
npm run check        # 语法（lib/client/scripts + bash -n）
npm test             # 47 项：store/targets/host/client/manifest
npm run pack:check   # 打包白名单（10 个文件）
npm run publish:check
```

隔离宿主（`DSH_HOME=/tmp/dsh-mcp-ui-check/home`，`--port 4399`）实测：`/status` 带会话 cookie 200、`manager.entryId='mcp-manager'`、`runtime:ready`；boot graph 含 `dsh-mcp-workbench` 4 处（id/url/rev/inject）；combo bundle 200；无头 Chrome 打开页面 **0 控制台错误**。**未做**：真机设置面板交互（隔离 HOME 停在首启引导，`scripts/gui-flow.mjs` 仍是旧 UI 断言，需要按新界面重写后才能跑）。

## 已知边界

- **官方管理器缺失（<0.2.2-rc.2）时只显示说明**：`runtime: manager-missing`，客户端禁用新增/迁移，不提供任何降级实现。
- **`watch` 不提供工具名**：行上只有 `toolCount`；完整工具名要 `probe`，当前 UI 不在行上展示清单。
- **`probe` 只能探测已写入清单的名字**：新草稿没有临时 name 可探，所以保存流程是「写入停用态 → probe → 启用」。
- **迁移不自动执行、不删除旧数据**：迁移成功后清空旧 `servers`（那是迁移源的职责），不删除凭据。
- **凭据来源为进程环境时只读**：官方 `credentials.describe` 返回 `writable:false` 时界面禁用输入。
- **没有 OAuth**：官方管理器当前不支持交互式授权，需要授权的服务器表现为普通连接失败。

## 排查顺序

1. 页面提示「没有找到官方 MCP 管理器」→ 看 `/status` 的 `manager.reason`：`missing`（DSH 版本太早或 `mcp-manager` 行被删）、`disabled`、`inactive`（条目加载失败）。
2. 设置分区在、但列表永远空 → 看 `configForms.get('mcp-manager')` 的 `status`：`unavailable` 说明宿主 `settings.describe()` 里没有该 ns（条目未 active 或 schema 不可用）。
3. 保存后没有连接状态 → 看 `remote.mcpManager.watch` 是否在跑、`status` 的 `state`；`waiting-credentials` 去凭据区补值；`failed:gave-up` 点保存重试（会重建实例并重置重连预算）。
4. 与启动配置重名 → 行上即时提示，删掉一边。
5. 客户端刷新了、宿主没重启 → 宿主半体是启动时加载的，`lib/*.js` 改动必须重启 `dsh web`。
6. 动作接口 403 → 检查 CSRF 头与同源；401 → 连接层鉴权（会话 cookie）。

## 发布与安装路线

- 用户路线：`dsh plugin --profile web add dsh-mcp-workbench`（升级显式写 `@<版本>`）；`./install.sh` 只服务源码 `link:` 开发路线（先跑 `npm run publish:check`）。
- 发布：`npm run publish:check` 是唯一闸门；tag `<包名>-v<版本>` 由 `release.yml` 经 OIDC 发布（本包无运行时依赖）。
- 兼容线四处同源：`package.json#dshCompatibility`、`engines.dsh`、`install.sh` 的 `DSH_COMPATIBILITY_RANGE`/`DSH_VERIFIED_VERSIONS`、`lib/dsh.js` 的常量；`test/manifest.test.js` 是守卫。
- 版本语义：0.2.0 是行为形态变更（自建管理 → 官方管理器 UI + 旧数据迁移），同线内按 minor 发布；后续纯修复用 patch。
