# dsh-extra-context

给当前 DeepSeek Harness 的**所有对话**（主会话、子代理、workflow 子步骤）统一附加一段额外说明和上下文。文本在**设置页**分段维护、实时预览、热生效。

## 它解决什么问题

有些东西需要在**每一次对话**里都成立：回答语言与风格、跨项目的约定、你的身份与偏好、必须一直遵守的边界。把这些写进 `AGENTS.md` 会混进项目级指令；在每个会话里重复粘贴又容易漏。这个插件把一段文本放进 system prompt 的固定位置，对所有会话自动生效。

## 功能

- **全局生效**：注册为进程级 system prompt section（`deployment:extra-context`，order 204），位于人格段之后、官方工具说明之前。主会话、子代理、workflow 子步骤都会带上，不依赖具体 agent preset。
- **多条规则**：每条规则可单独启停；停用或内容为空的不出现在提示词里。列表默认收起，点某一条展开编辑。
- **无需保存**：输入时不受打扰，离开输入框即写入；勾选框、增删规则点了即生效。
- **设置页实时编辑**：设置 → **额外上下文**。文本写入 `$DSH_HOME/settings.yaml` 的 `extra-context:` 段，热生效，不需要重启。左侧菜单这一行有自己的图标（`IconContextInjectionOutline16`），不会和「设置」本身的齿轮撞脸。
- **常显预览与消耗**：直接显示最终会附加到对话里的完整文本，以及它的体积与大致 token 量；内容偏长时给出一句精简建议。
- **降级可用**：部署里没有 settings 服务时，插件仍按组合层配置生效（仅当前进程），并在设置页给出提示。

## 什么时候生效（重要）

system prompt 在**会话启动时组装并固化**，之后的改动不会追进已开始的会话：

| 场景 | 行为 |
|---|---|
| 修改规则后新建的会话 | 立即使用新版本 |
| 修改规则前已经开始的会话 | 继续使用启动时的旧文本，直到该会话结束 |
| 想用上最新规则 | **新开一个对话** |

设置页顶部有同样的说明，不会让你以为「改完了但没生效」。

## 和其它机制的分工

| 机制 | 适合放什么 |
|---|---|
| 本插件 | 跨工作区的长期偏好、全局约束、希望一直遵守的约定 |
| `$DSH_HOME/AGENTS.md` | 你所有工作区的通用工作指导（DSH 原生能力） |
| 项目内 `AGENTS.md` | 某个项目/目录的构建命令、代码规范 |

同一段话不要在两处维护：重复内容既占上下文，也会在你的两个来源冲突时让模型无所适从。

## 安装与卸载

```bash
dsh plugin --profile web add dsh-extra-context        # 安装
dsh plugin --profile web add dsh-extra-context@0.1.2  # 升级到指定版本
dsh plugin --profile web remove dsh-extra-context     # 卸载
```

已发布为 [`dsh-extra-context`](https://www.npmjs.com/package/dsh-extra-context)。profile 依赖是 caret 范围，升级需要显式写版本号。

> **首次安装必须重启 `dsh web`**：新增插件会改变 profile 的 bundle 列表，而 bundle 列表只在启动时读取（`patchReload` 只热重载 patch 文件）。在 Warp 里 `Ctrl+C` 后重新执行 `dsh web --no-open`，然后刷新页面。

从源码运行：`./install.sh` 会先做兼容性与打包检查，再通过官方 profile manager 挂载 `link:<源码目录>`；`./uninstall.sh` 移除（同样需要重启 `dsh web` 才彻底生效）。卸载只移除 profile 依赖与 bundle 层；`settings.yaml` 里的 `extra-context:` 段是你自己的数据，不会被删除。

## 使用

1. 打开 设置 → **额外上下文**，确认开关为「已开启」。
2. 点 **+ 添加规则**，在展开的文本框里写入内容（没有保存按钮：输入时不受打扰，离开输入框即写入）。
3. 点勾选框、增删规则都是点了即生效。
4. 设置页的预览区始终显示最终会附加进去的文本。改动对**新开的对话**生效；已经开始的对话继续用启动时的文本。

## 限制与注意事项

- 这段文本出现在每一次模型请求里，会持续占用上下文：请精简，并留意预览里的消耗提示与偏长提醒。
- 如果某个 agent preset 注册了同名 section（`deployment:extra-context`），会按 DSH 的遮蔽规则覆盖本插件的文本；本插件自身不注册任何 agent 级 section。
- 插件不会写入或修改 DSH 源码、不会改动 profile 的用户 patch 层，全部副作用都是可逆的。

技术细节（契约、机制、排查）见 [`AGENTS.md`](./AGENTS.md)。

## License

MIT
