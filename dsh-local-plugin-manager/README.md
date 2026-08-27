# dsh-local-plugin-manager

面向当前本机 DeepSeek Harness Web 的本地插件管理器。它在“设置 > 插件”中增加第三个 `本地插件` tab，用于管理已经通过 `link:` 安装到 `web` profile 的本地 bundle。

## 功能

- 列出当前 `web` profile 中已安装的本地链接插件、版本、源码路径和每个插件自己的说明。
- 持久化启用或禁用状态；Host 端通过当前 profile 的 live patch reload 热切换。
- 从 profile 卸载本地链接，保留源码目录和插件创建的数据。
- 卸载前检查用户 patch 是否仍通过 `insert` 引用目标包；存在引用时拒绝操作。
- 管理器自身只读保护，避免从自己的页面关闭或卸载恢复入口。

插件说明直接取自各插件 `package.json` 的 `description`，不需要在这里维护第二份文案：Host 折叠为单行并限制长度，客户端最多显示两行，鼠标悬停可看全文；没有写 `description` 的插件显示灰色“未提供说明”。列表里说明是名称之后的第二重点（13px + 极淡底板，最多两行），版本和源码路径作为元信息弱化显示。

本插件不扫描未安装目录，也不提供安装、更新、市场或版本切换功能。安装仍由每个本地插件自己的 `install.sh` 完成。

## DSH 兼容范围

- DeepSeek Harness `>=0.1.6-alpha.1 <0.1.7`
- 已逐版本验证：`0.1.6-alpha.1`
- `web` profile
- Node.js 20 或更新版本

同一 `0.1.6` 发布线内从 alpha.1 开始的后续 alpha/beta/rc/正式版允许启动；未列入逐版本验证清单时，安装脚本会给出警告，并继续由 profile 结构、bundle patch、Loader 方法和 Settings Slot 等运行时能力检查 fail closed。跨到 `0.1.7` 或其他发布线时先停止安装，重新核对契约后再扩大范围。

## 安装

```bash
cd ~/Documents/dsh-plugins/dsh-local-plugin-manager
./install.sh
```

安装脚本会安装本包唯一的 YAML 解析依赖，运行语法与行为测试，再通过官方 profile manager 执行：

```bash
dsh plugin --profile web add link:<当前目录> --config.minimumReleaseAge=0
```

随后需要在用户自己的 Warp 中重启 Host：

```bash
Ctrl+C
dsh web --no-open
```

重连并刷新 `http://127.0.0.1:3080` 后，打开“设置 > 插件 > 本地插件”。

## 启停语义

开关状态同时记录在：

- `~/.dsh/profiles/web/.dsh-local-plugin-manager/state.json`
- `~/.dsh/profiles/web/cordis.patch.yml` 中带明确 begin/end 标记的受管区块

管理器只替换自己的受管区块，现有 Figma 或其他用户 patch 保持原样。`web` profile 的 `patchReload: live` 会让 Host loader 行热启停；带浏览器半体的插件仍需刷新页面才能同步 UI。若私有 Loader 热切换没有达到预期，启动状态仍会在下次 `dsh web` 启动时生效。

其他 profile 或 home 级 patch 若继续控制同一个 loader 行，管理器会显示冲突并拒绝覆盖。

## 卸载语义

卸载流程固定为：

1. 写入持久禁用状态并尝试热卸载目标 loader 行。
2. 异步调用官方 `dsh plugin --profile web remove <包名>`。
3. 重新读取 profile，确认 dependency 和 bundle layer 都已移除。
4. 保留一条只覆盖当前进程的禁用 tombstone，下一次 Host 启动后自动清理。

浏览器会提示重启。源码 checkout、凭据、Workspace、会话和各插件自己的数据不会删除。

管理器不能从自己的 tab 卸载。移除它时使用：

```bash
./uninstall.sh
```

## 安全边界

- Client 只能提交服务端列表中已有的包名，不能传路径、pnpm 参数或任意命令。
- status 和 mutation 都先通过 DSH trusted-host 与签名浏览器 cookie 认证，再要求 loopback、同源请求和自定义 Client header；mutation 另要求当前进程随机 CSRF token 和有限大小的 JSON body。固定 header 本身不是认证凭据。
- 所有写操作单飞执行；profile patch、状态文件和必要的 manifest 修复使用同目录临时文件后原子 rename。
- 只管理 bundle patch 完全由带稳定 id 的 `insert` 条目组成的插件。会改写既有条目的复杂 bundle 会显示为不可管理，避免“关闭了一部分”的假状态。

## 验证

```bash
npm run verify
```

测试覆盖受管 patch 保留、空 patch、损坏标记拒绝、link bundle 枚举、说明归一化与缺失占位、启停、外部 patch 冲突、卸载引用保护、卸载失败回滚、卸载 tombstone 清理、HTTP 同源约束，以及兼容发布线的接受与相邻发布线拒绝。
