# tools/dsh-icons — DSH 内置图标全集与预览

一个工作区级工具：**从已安装的 DSH 里提取内置图标集**（名字、档位、画布尺寸、可直接复用的 SVG 源码、官方与工作区谁在用），
生成一份可 diff 的快照和一个能直接打开的预览页。目的很单纯：

- 开发新插件要选图标时，**不用再从压缩后的前端产物里现抠**；
- 不确定选哪个时，打开预览页按真实尺寸、真实配色挑；
- DSH 升级后，一条命令就能知道图标集变了没有、我们在用的图标还在不在。

> 只读已安装的 DSH（`node_modules/@deepseek-ai/dsh`），不写入、不修改 DSH 任何文件。

## 快速开始

```bash
cd ~/Documents/dsh-plugins

# 1) 重新提取并生成产物（DSH 升/降级后跑这个）
node tools/dsh-icons/build.js

# 2) 漂移检查：快照是否还对得上当前安装？工作区插件用的图标是否都还在？
node tools/dsh-icons/check.js        # 退出码 0 = 无漂移，1 = 有漂移

# 3) 打开预览页挑图标（点击卡片复制图标名，/ 聚焦搜索，Esc 清空）
open tools/dsh-icons/preview.html

# 4) 插件给设置页导航加了图标时，验证补丁的几何（不需要真实 GUI）
node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context
open /tmp/dsh-nav-icon-fixture/index.html
```

指定别的 DSH 安装（例如并行装的另一个版本）：`node tools/dsh-icons/build.js --dsh /path/to/@deepseek-ai/dsh`。

## 产物

| 文件 | 说明 |
|---|---|
| `icons.json` | 机器可读快照。`generatedBy / dsh.version / source.asset / source.sha1` 记录它是从哪个 DSH 构建提取的；`icons[]` 每项含 `name`、`tier`、`canvasSize`、`viewBox`、`keywords`、`usedBy`、`usedByPlugins`、`svg`；`nonIcons[]` 是同一模块导出的非图标成员；`workspace` 记录生成时工作区插件有无取到不存在的成员。 |
| `preview.html` | 自包含预览页（数据内嵌，无 fetch，可直接 `file://` 打开）。搜索（名字/中文关键词/使用方，多词=同时包含）、档位筛选、16/24/32/48px 真实尺寸切换、深浅背景、点击复制图标名。 |
| `build.js` | 提取 + 生成。详见文件头注释。 |
| `check.js` | 漂移检查，可当 CI 用。 |
| `verify-nav-icon.js` | 导航图标补丁的**几何验证固定场景**：真实壳层导航 CSS + 真实插件 bundle + 迷你 React 垫片挂到真 DOM，量出"补丁后"与"壳层原生"是否占同一位置/同一尺寸，并检查样式表是否由插件**自己**注入。产物 `/tmp/dsh-nav-icon-fixture/index.html`。 |

`icons.json` 与 `preview.html` **是生成物、要提交**：它们是"当时那份 DSH 构建"的证据，diff 就是升级影响面。
改完 `build.js`（例如补 `keywords`）要重新生成，别手工改这两个文件。

## 什么时候要跑

| 时机 | 跑什么 | 看什么 |
|---|---|---|
| 给插件加了/改了设置页导航图标 | `verify-nav-icon.js --plugin <插件>` | `checks` 全为 true：位置一致、原 svg 被盖住、mask 生效、方块尺寸一致 |
| DSH 升级/降级后 | `check.js` | 有漂移就 `build.js` 重新生成，review `icons.json` 的 diff：**我们在用的图标有没有消失或变形** |
| 给插件选/换图标前 | `open preview.html` | 按真实尺寸与深浅背景确认观感；确认它属于哪一档 |
| 新增插件后 | `check.js` | 「插件 require 了不存在的图标」会直接失败——这类错在浏览器里只表现为图标空白，最难查 |
| 只是改文档 | 不用跑 | — |

## 选图标时的三条硬事实

1. **能 require 到的就是全部。** 图标来自浏览器侧 `__ModuleLoader__` seed 里的
   `@deepseek-ai/dsh-client-ui-primitives` 冻结导出对象（在 `dsh-web-frontend/dist/assets/index-*.js` 里）。
   没被打进这个对象的图标，`require` 回来是 `undefined`，组件会静默渲染成空白——所以选图标必须先在本工具里查到名字。
2. **档位看名字后缀**（`IconXxx14` / `IconXxx16` / `IconXxx20`）：同一行里的图标必须同档，否则视觉大小不一致
   （实测过 12×12 vs 5×8 的搭配）。注意**名字不等于画布**：`IconInspectOutline12` 的 viewBox 是 16×16，
   `IconRightUpOutline14` 是 8×14，`IconWarningOutline16` 是 14×14。预览页对这类图标会多标一个「画布 N」徽章。
3. **`usedBy` 只是语义线索**，说明官方在什么场景用过它（例如 `IconContextInjectionOutline16` 被 `chat` 用于
   「上下文注入」折叠行）。它不是契约，别指望它稳定。

## 给设置页分区配自己的图标

壳层**不支持**这件事，插件侧唯一的办法是可逆的 DOM 补丁——两个插件已各有一份实现：

| 插件 | 实现位置 | 手法 | 样式表注入点 |
|---|---|---|---|
| `dsh-chat-archive-manager` | `client.js` 的 `ArchiveNavIconMarker` | `settings.action` 挂载点 + `MutationObserver` + 原 svg 透明 + `::before` 绝对定位 mask | `apply()` 里（插件级，页面启动即在） |
| `dsh-extra-context` | `client.js` 的「设置页导航图标」分区 | 同上，但 `::before` **参与 flex 布局**而非绝对定位（不写死 `padding-left`，壳层改内边距也不会错位） | `apply()` 里（`installStyles`，插件级 + 引用计数） |

> **踩过的坑（一定要看这一行）**：补丁的可见效果取决于**导航渲染那一刻** CSS 在不在，而导航属 `settings.action`／面板的生命周期，比分区组件（`only: active`，点开才渲染）更早更广。
> extra-context 最初把样式注入只放在分区组件里，于是"打开设置页仍显示壳层齿轮、点一下那一行才变对"；归档插件因为样式在 `apply()` 里注入，一直没这个问题。
> **结论：样式归插件（`apply()`）所有，不要交给某个组件**——组件挂在比样式更早/更广的生命周期上（导航补丁、overlay、状态栏…）时，组件级注入必然覆盖不到。注入时按宿主标识认领元素、按引用计数自清理，并在元素存活但文本过期时重写文本。

关键事实（都核对过 `dsh-client-ui-settings-general/lib/client.js`）：

- `settings.section` 的注册选项只有 `id/order/label`，**没有 `icon`**；
- 壳层 `navIcon(id)` 只白名单 4 个官方 id（`models`/`agent-presets`/`plugins`/`archived-sessions`），其余 id 回落 `IconSettingsOutline16`（齿轮）；
- `settings.action` 与 `settings.section` 同属 `sidebar.settings` 的 children 表，随设置面板挂载/卸载——拿它当补丁挂载点，补丁的生命周期就与面板一致；
- data: URI 里的 SVG **必须带 `xmlns`**，否则按 HTML 解析、mask 静默失效（图标整块空白）。

补丁的**几何正确性**可以用 `verify-nav-icon.js` 离线验证（真实壳层 CSS + 真实 bundle + 真 DOM，量 label 偏移/隐藏方式/mask/样式注入），
该脚本**不替插件注入样式**——"标记打好了但 CSS 还没进文档"正是踩过的坑，代注入会把它掩盖掉；
凡是补丁 + 自己样式表的组合，都要确认样式注入时机是否覆盖"只打开面板、没进分区"的那一刻。
但它只证明"布局等价"，真实设置页的观感仍需用户刷新后目视确认。该脚本会按插件自己的样式表探测补丁契约
（`[data-…]` 标记属性、`var(--…)` mask 变量、用 `display:none` 还是 `opacity:0` 隐藏原 svg），
三者与代码不同源时会直接报错——这类不同源的表现正是"图标没换、也不报错"。

**为什么不做成共享库**：工作区内每个插件都是可独立发布、可单独安装的包（`package.json` + `install.sh` + 发布物清单）。
抽一个共享运行时会让"装单个插件"变成"装整个工作区"，所以这里只共享**知识**（本文档 + 快照），不共享代码。
新插件照抄其中一份实现即可，并把它当成权宜：壳层哪天支持在 slot 选项里声明图标，就该删掉。

## 实现上的坑（已踩过，改脚本前先读）

- **序列化必须保留驼峰 SVG 属性**：`viewBox`、`maskUnits`、`maskContentUnits` 等在 SVG 里就是驼峰，
  一律连字符化会变成无效属性被浏览器忽略；`viewBox` 一丢，图标就失去缩放基准（看起来"偏到左上角"）。
  见 `build.js` 的 `CAMEL_CASE_SVG_ATTRIBUTES`。
- **图标要真求值，不要正则抠 `d=`**：图标是编译后的 JSX 组件，用桩 jsx-runtime 求值再序列化，
  才能正确保留 `mask`/`clipPath`/多 path 的结构；视图里的 mask id 还要按图标加前缀，避免同页撞 id。
- **常量导出会影响图标渲染**：`IconShieldOutline16` 引用同模块的 `SHIELD_OUTLINE_PATH`，
  所以先把非函数的导出求值挂到 `globalThis` 再渲染图标（字符串常量也算，别只匹配标识符开头）。
- **新鲜度检查别写成"字符串是否出现"**：预览页内嵌了整份快照，找某个字符串永远找得到（踩过）。
  `check.js` 现在真的解析内嵌数据再与 `icons.json` 比对。
- **导航补丁的伪装前缀不能写死**：设置面板的类名是构建期哈希（`VOzbGW_`），`verify-nav-icon.js`
  从 CSS 里第一个类名推出前缀再整体替换；取错了会静默丢样式，量出来就变成"图标错位"（踩过）。
- **探测图标名别在组件体里乱匹配 `Icon…`**：`installNavIconPatch` / `navIconReferences` 这类标识符
  都会被误判；只在从 primitives 解构进来的名单里找。

## 与工作区其它校验的关系

本工具只关心"DSH 里有什么图标、我们在用什么"。插件自身的契约/兼容线检查仍在各插件的
`npm run check|test|pack:check` 里；DSH 升级后的完整流程见根 `AGENTS.md`「工作区工具」一节。
