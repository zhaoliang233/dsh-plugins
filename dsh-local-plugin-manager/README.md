# dsh-local-plugin-manager

给 **DSH 插件开发者**用的设置面板：在「设置 > 插件开发」里管理当前 `web` profile 中以 `link:` 挂载的本地源码插件——看源码路径与 loader 行，快速启停或把它从 profile 里摘掉。

它服务的是开发循环：用 `link:` 挂着源码调试插件时，临时停掉一个把界面搞坏的插件、把跑完实验的插件移出 profile、确认某个包贡献了哪几条 loader 行，都在一个面板里完成。

## 功能

- 列出当前 profile 里所有 `link:` 挂载的本地源码插件：名称、插件自己的 `package.json#description`（最多两行，悬停看全文；缺失时显示灰色「未提供说明」）、版本与源码路径。
- 行 id 与包名不同、或一个包贡献了多条 loader 行时，额外显示它在 loader 树里的行 id，方便直接对照 profile 的 `cordis.patch.yml`。
- 持久化启用 / 禁用状态，切换后由 Host 通过 profile 的 live patch reload 热生效。
- 从 profile 移除本地 link 插件：移除前先检查用户 patch 是否仍通过 `insert` 引用目标包，存在引用时拒绝操作；成功后重新读取 manifest，确认依赖与 bundle 层都已移除。
- 管理器自身只读保护，避免从自己的面板里关掉或卸载恢复入口。
- 只管理 bundle patch 完全由带稳定 id 的 `insert` 条目组成的插件；会改写既有条目的复杂 bundle 显示为不可管理，避免出现「只关掉一半」的假状态。

本插件只管理**已经装进 profile** 的 `link:` 插件：不扫描未安装目录，也不提供安装、更新、市场或版本切换。装插件仍然用 DSH 官方命令，例如 `dsh plugin --profile web add <包名或路径>`。

## 与 DSH 自带插件管理的关系

通用插件管理在 DSH 自带的「设置 > 插件」分区：安装与更新、查看全部插件、看运行时状态都在那里。本插件是设置菜单里的**另一个独立分区**，只列出 `link:` 本地源码插件，两个入口操作的是同一批 loader 行覆盖项：

- 你在任一侧禁用或启用，另一侧刷新后读到的就是同一个状态；
- 在任一侧启用时会**就地改写**那条（最后一条 id 与模块名都匹配的）覆盖项，不会追加第二条，因此两边不会互相回滚；
- 写入前后整个 profile 取一把跨进程写锁（锚点是 profile 的 `package.json`，与 DSH 自带的插件管理器和 `dsh plugin` CLI 共用），所以与官方插件页、命令行同时操作也不会丢更新。

## 要求

- DeepSeek Harness Web `>=0.1.7-alpha.1 <0.1.8`；`0.1.7-alpha.1` 与 `0.1.7-alpha.2` 已逐版本验证。同一 `0.1.7` 发布线内的其他 alpha/beta/rc/正式版允许启动，未列入逐版本验证清单时给出警告，并继续由 profile 结构、bundle patch、Loader 方法与 Settings Slot 等运行时能力检查 fail closed；跨到 `0.1.8` 或其他发布线前必须先重新核对契约。
- `web` profile。
- Node.js 20 或更高版本。

## 安装与卸载

```bash
dsh plugin --profile web add dsh-local-plugin-manager        # 安装
dsh plugin --profile web add dsh-local-plugin-manager@0.2.0  # 升级到指定版本
dsh plugin --profile web remove dsh-local-plugin-manager     # 卸载
```

已发布为 [`dsh-local-plugin-manager`](https://www.npmjs.com/package/dsh-local-plugin-manager)。profile 依赖是 caret 范围，升级需要显式写版本号。安装会向 profile 增加 bundle，而 bundle 列表只在启动时读取，因此**需要重启 `dsh web` 并刷新页面**，之后打开「设置 > 插件开发」。

从源码运行：`./install.sh` 会先安装本包的运行时依赖、运行语法与行为测试，再通过官方 profile manager 安装 `link:<源码目录>`；`./uninstall.sh` 移除。源码 checkout、凭据、Workspace、会话与各插件自己的数据都不会被删除。

## 启停语义

禁用状态写进 profile 的 `cordis.patch.yml`：每个 loader 行一条**顶层覆盖项**

```yaml
- id: <行 id>
  disabled: true      # 启用时写显式的 disabled: false，不删除条目
```

管理器只改这一批覆盖项，patch 里的其他内容（例如 Figma / Jira MCP 的 `insert` 区块、注释、`!!js` 表达式）按字节保留。

`web` profile 的 `patchReload: live` 会让配置变化热生效，页面无需重载；带浏览器半体的插件可能仍需要刷新页面同步 UI。若这次变化没有热生效，管理器会提示重启，状态也会在下次 `dsh web` 启动时生效。

home 级 patch（`~/.dsh/cordis.patch.yml`）优先级高于 profile patch，因此它若控制同一个 loader 行，管理器会显示冲突并拒绝写入一个无效开关。

## 移除语义

移除流程固定为：

1. 写入禁用覆盖项并等待 loader 行停下。
2. 异步调用官方 `dsh plugin --profile web remove <包名>`。
3. 重新读取 profile，确认 dependency 和 bundle layer 都已移除。
4. 记一条只属于当前进程的墓碑，下一次 Host 启动时清掉该插件遗留的覆盖项（避免将来重装后被继续禁用）。

浏览器会提示重启。源码 checkout、凭据、Workspace、会话和各插件自己的数据都不会删除。

管理器不能从自己的面板卸载自己，移除它请用上面的官方 `remove`（源码 checkout 用 `./uninstall.sh`）。

## 安全边界

- Client 只能提交服务端列表中已有的包名，不能传路径、pnpm 参数或任意命令。
- status 与 mutation 都先复用 DSH 的 trusted-host 与签名浏览器 cookie 认证，再要求 loopback、同源请求和自定义 Client header；mutation 另外要求当前进程随机 CSRF token 和有限大小的 JSON body。固定 header 本身不是认证凭据。
- 所有写操作单飞执行；profile 写锁、原子提交与状态文件写入都复用 DSH 自己的文件事务实现。

## License

MIT
