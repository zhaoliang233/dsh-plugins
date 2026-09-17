# dsh-local-plugin-manager

给 DeepSeek Harness Web 用的插件：在「设置 > 插件」里增加一个 `本地插件` tab，用来查看、启停和卸载当前 `web` profile 中通过 `link:` 安装的本地插件。

## 功能

- 列出当前 profile 里的本地 link 插件：名称、插件自己的 `package.json#description` 说明（最多两行，悬停看全文；没有说明时显示灰色「未提供说明」）、版本与源码路径。
- 持久化启用 / 禁用状态，切换后由 Host 通过 profile 的 live patch reload 热生效。
- 从 profile 卸载本地 link 插件：卸载前先检查用户 patch 是否仍通过 `insert` 引用目标包，存在引用时拒绝操作；成功后重新读取 manifest，确认依赖与 bundle 层都已移除。
- 管理器自身只读保护，避免从自己的页面关掉或卸载恢复入口。
- 只管理 bundle patch 完全由带稳定 id 的 `insert` 条目组成的插件；会改写既有条目的复杂 bundle 显示为不可管理，避免出现“只关掉一半”的假状态。

本插件只管理已经装进 profile 的 `link:` 插件：不扫描未安装目录，也不提供安装、更新、市场或版本切换。装插件仍然用 DSH 官方命令，例如 `dsh plugin --profile web add <包名或路径>`。

## 要求

- DeepSeek Harness Web `>=0.1.6-alpha.1 <0.1.7`；`0.1.6-alpha.1` 已逐版本验证。同一 `0.1.6` 发布线内 alpha.1 之后的 alpha/beta/rc/正式版允许启动，未列入逐版本验证清单时给出警告，并继续由 profile 结构、bundle patch、Loader 方法与 Settings Slot 等运行时能力检查 fail closed；跨到 `0.1.7` 或其他发布线前必须先重新核对契约。
- `web` profile。
- Node.js 20 或更高版本。

## 安装与卸载

```bash
dsh plugin --profile web add dsh-local-plugin-manager        # 安装
dsh plugin --profile web add dsh-local-plugin-manager@0.1.4  # 升级到指定版本
dsh plugin --profile web remove dsh-local-plugin-manager     # 卸载
```

已发布为 [`dsh-local-plugin-manager`](https://www.npmjs.com/package/dsh-local-plugin-manager)。profile 依赖是 caret 范围，升级需要显式写版本号。安装会向 profile 增加 bundle，而 bundle 列表只在启动时读取，因此**需要重启 `dsh web` 并刷新页面**，之后打开「设置 > 插件 > 本地插件」。

从源码运行：`./install.sh` 会先安装本包唯一的依赖（`js-yaml`）、运行语法与行为测试，再通过官方 profile manager 安装 `link:<源码目录>`；`./uninstall.sh` 移除。源码 checkout、凭据、Workspace、会话与各插件自己的数据都不会被删除。

## 启停语义

开关状态同时记录在两个地方：

- `~/.dsh/profiles/web/.dsh-local-plugin-manager/state.json`
- profile 的 `cordis.patch.yml` 中带明确 begin/end 标记的受管区块

管理器只替换自己的受管区块，其他用户 patch（例如 Figma MCP）保持原样。`web` profile 的 `patchReload: live` 会让 Host loader 行热启停；带浏览器半体的插件还需要刷新页面才能同步 UI。若私有 Loader 热切换没有达到预期，启动状态仍会在下次 `dsh web` 启动时生效。

其他 profile 或 home 级 patch 若继续控制同一个 loader 行，管理器会显示冲突并拒绝覆盖。

## 卸载语义

卸载流程固定为：

1. 写入持久禁用状态并尝试热卸载目标 loader 行。
2. 异步调用官方 `dsh plugin --profile web remove <包名>`。
3. 重新读取 profile，确认 dependency 和 bundle layer 都已移除。
4. 保留一条只覆盖当前进程的禁用 tombstone，下一次 Host 启动后自动清理。

浏览器会提示重启。源码 checkout、凭据、Workspace、会话和各插件自己的数据都不会删除。

管理器不能从自己的 tab 卸载自己，移除它请用上面的官方 `remove`（源码 checkout 用 `./uninstall.sh`）。

## 安全边界

- Client 只能提交服务端列表中已有的包名，不能传路径、pnpm 参数或任意命令。
- status 与 mutation 都先复用 DSH 的 trusted-host 与签名浏览器 cookie 认证，再要求 loopback、同源请求和自定义 Client header；mutation 另外要求当前进程随机 CSRF token 和有限大小的 JSON body。固定 header 本身不是认证凭据。
- 所有写操作单飞执行；profile patch、状态文件和必要的 manifest 修复都使用同目录临时文件后原子 rename。

## License

MIT
