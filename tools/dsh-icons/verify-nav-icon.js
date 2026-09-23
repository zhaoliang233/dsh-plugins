#!/usr/bin/env node
'use strict'

/**
 * 导航图标补丁的**几何验证固定场景**：在没有（或不想动）真实 GUI 的情况下，量出
 * 「插件补丁画出来的图标」与「壳层原生图标」是否占同一个位置、同一尺寸。
 *
 * 背景：设置页导航图标没有官方通道（`settings.section` 无 `icon` 选项，壳层 `navIcon(id)`
 * 只白名单 4 个官方 id），插件只能做可逆 DOM 补丁。补丁一旦错位/盖不住原 svg，
 * 在真实页面上就是"两个图标叠着"或"图标跑到别处"——这类问题只有**真实布局**能发现，
 * 单测里的假 DOM 量不出来。所以这里把真实布局搬进一个可离线的页面：
 *
 *   1. 壳层设置面板的导航 CSS：从 `dsh-client-ui-settings-general` 的产物里**原样抽取**
 *      （只把混淆前缀换成可读前缀）；
 *   2. 插件 bundle：**原样加载**插件自己的 `client.js`，跑它真实的 `apply()` 与补丁组件——
 *      **包括让它自己注入样式表**（fixture 不代劳）：曾经的缺陷正是"标记打好了、CSS 却还没进文档"，
 *      代注入会把这类问题掩盖掉；
 *   3. 迷你 React 垫片：把组件挂到**真 DOM**，于是 `ref`、`outerHTML`、`getComputedStyle`
 *      都是真的（这正是补丁依赖的东西）；
 *   4. 量测：补丁行与壳层原生行的 label 偏移必须一致，原 svg 必须 `display:none`，
 *      `::before` 必须是同一档位的方块且带 data URI mask。
 *
 * 用法:
 *   node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context --measure
 *   node tools/dsh-icons/verify-nav-icon.js --plugin dsh-chat-archive-manager
 *   node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context --label '额外上下文' --icon IconContextInjectionOutlineMedium
 *
 * `--measure` 会自己拉起无头 Chrome 把场景量完，打印六项 checks，任何一项不通过就非零退出
 * （所以能当断言用）；不加时只生成页面，由你打开目视对照。图标名与菜单名默认从 bundle 里探测，
 * 探测不到（或想覆盖）再用 `--icon` / `--label` 给。Chrome 路径用 `--chrome` 覆盖。
 *
 * 产物：`/tmp/dsh-nav-icon-fixture/index.html`（用浏览器打开可目视对照，页面底部打印量测 JSON）。
 * 只读 DSH 安装与插件源码；只会收掉自己按 `--user-data-dir` 拉起的那个 Chrome。
 *
 * 注意：这是**固定场景**，量的是布局等价性，不等于真实设置页的观感
 * （真实页面还需要用户在 Warp 里刷新后目视确认）。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const { locateDshRoot, shellBundle, primitivesModule, extractIcons, WORKSPACE_ROOT, TOOL_NAME } = require('./build.js')

const OUT_DIR = '/tmp/dsh-nav-icon-fixture'

function argValue(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} 缺少值`)
  return value
}

/**
 * 从插件 bundle 里找导航图标组件用的图标名。
 *
 * 只在**真去 primitives 取图标的地方**找，而不是随便匹配 `Icon…`：组件体里还可能
 * 出现 `navIconReferences`、`installNavIconPatch` 这类标识符，直接正则会把
 * `IconReferences` 当成图标名（踩过）。两种取用写法都认：
 *
 * 1. 解构：`const { IconLinkOutline16 } = require('…primitives')`；
 * 2. 能力取用：`iconOf('IconLinkOutlineMedium', 'IconLinkOutlineRegular', 'IconLinkOutline16')`
 *    —— 整条链都算候选，返回的 `icon` 取链上**第一个真实存在**的名字，找不到就交给 --icon。
 *
 * @param pluginSource - 插件 bundle 源码。
 * @returns `{ component, icon, candidates }`；`icon` 可能是 undefined（判不出来，需 --icon）。
 */
function detectNavIcon(pluginSource) {
  // `const IconCodeOutline16 = iconOf('IconCodeOutlineMedium', 'IconCodeOutlineRegular')`
  // ——工作区推荐的取法。组件体里出现的只是**本地别名**，光扫字符串字面量认不出来，
  // 所以先把"别名 → 候选链"记下来（踩过：插件不再把旧的数字档位名写进链里之后，
  // 这里就永远判不出图标，只能靠 --icon）。
  const aliases = new Map()
  for (const call of pluginSource.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*iconOf\(\s*([^)]*)\)/gu)) {
    const chain = [...call[2].matchAll(/'([A-Za-z0-9_$]+)'/gu)].map((match) => match[1]).filter((name) => name.startsWith('Icon'))
    if (chain.length > 0) aliases.set(call[1], chain)
  }
  const names = []
  const imports = /const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u.exec(pluginSource)
  if (imports !== null) names.push(...imports[1].split(',').map((piece) => piece.trim().split(':').pop().trim()))
  for (const call of pluginSource.matchAll(/\biconOf\(\s*([^)]*)\)/gu)) {
    names.push(...[...call[1].matchAll(/'([A-Za-z0-9_$]+)'/gu)].map((match) => match[1]))
  }
  const candidates = [...new Set(names.filter((name) => name.startsWith('Icon')))]
  // 组件名必须是首字母大写（`ExtraContextNavIcon`），否则会匹配到 `navIconReferences` 这类工具函数
  const component = /function\s+([A-Z]\w*NavIcon\w*)\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/u.exec(pluginSource)
  if (component === null) return { component: undefined, icon: undefined, candidates }
  const body = component[2]
  const used = candidates.filter((name) => body.includes(name))
  for (const [local, chain] of aliases) {
    if (body.includes(local)) used.push(...chain)
  }
  const ordered = [...new Set(used)]
  return {
    component: component[1],
    // 判出来的只是**首选**名字（链上第一个），真实存在性由调用方按当前构建核对。
    icon: ordered[0],
    candidates: ordered.length === 0 ? candidates : ordered
  }
}

/**
 * 从插件 bundle 里找导航行的菜单名。
 *
 * 以 `settings.section` 注册里的 `label:` 为入口（那是壳层真正拿去渲染的文字），
 * 它可能直接是字符串，也可能指向一个常量——两种都取得到，不依赖常量怎么命名。
 */
function detectLabel(pluginSource) {
  const registration = /name: 'settings\.section',[\s\S]{0,240}?label:\s*([A-Za-z0-9_$]+|'[^']+')/u.exec(pluginSource)
  if (registration === null) return undefined
  const value = registration[1]
  if (value.startsWith("'")) return value.slice(1, -1)
  const constant = new RegExp(`const\\s+${value}\\s*=\\s*'([^']+)'`, 'u').exec(pluginSource)
  if (constant === null) throw new Error(`label 指向的常量 ${value} 没找到字符串赋值，请用 --label 指定`)
  return constant[1]
}

/** 抽插件的样式表源码（`const styleText = \`…\``）。 */
function pluginStyleText(pluginSource) {
  const start = pluginSource.indexOf('const styleText = `')
  if (start === -1) throw new Error('插件 bundle 里找不到 styleText（补丁的 CSS 就在这里）')
  const from = start + 'const styleText = `'.length
  const to = pluginSource.indexOf('\n`', from)
  if (to === -1) throw new Error('styleText 的结束反引号没找到')
  return pluginSource.slice(from, to)
}

/**
 * 图标源码的来源：**复用 build.js 的提取路径**（`primitivesModule` + `extractIcons`），
 * 本文件不再自己把模块里的定义串成一个闭包。
 *
 * 为什么必须复用（0.1.7-alpha.2 上真的炸过）：0.1.7 起每个图标被拆成
 * 「导出包装器 + 基础组件 + 路径常量」（`Sx=e=>l.jsx(F5,{...e,strokeWidth:Z})`），
 * 要拿到能渲染的图形就得把这几段一起求值。老做法是"扫到哪个 `名字=` 就内联成闭包里的
 * `const`"，可压缩产物里 `e=`、`n=`、`t=` 这类局部名遍地都是：既会把 React 内部的同名
 * 赋值当依赖抓进来（`const e = ([...this.map.values()])`），又会与真正的局部名撞声明，
 * 结果整段源码直接 SyntaxError/ReferenceError，报出来的却是"当前 DSH 构建里没有这些
 * 候选图标"这种误导性结论。build.js 里那套（每个模块级定义**单独**求值、互不共享作用域）
 * 已经跑通、且被 `icons.json` 长期验证，这里只要一次提取。
 */
let catalogCache = null

function iconCatalog(root) {
  if (catalogCache !== null && catalogCache.root === root) return catalogCache
  const { source } = shellBundle(root)
  const { exports } = primitivesModule(source)
  const { icons, unrenderable } = extractIcons(source, exports)
  catalogCache = {
    root,
    icons: new Map(icons.map((icon) => [icon.name, icon.svg])),
    unrenderable: new Map(unrenderable.map((item) => [item.name, item.reason]))
  }
  return catalogCache
}

/**
 * 取一个图标的 SVG 源码。
 *
 * 名字不存在时**直接报错、不回落到齿轮**：本工具要量的就是"这一行图标对不对"，
 * 而名字写错在真实页面里只表现为图标空白（`require` 回来是 `undefined`），
 * 正是这里最该拦下的那类问题。
 *
 * 注意产物里的 `width/height` 已被 build.js 换成 100%（预览页要缩放），固定场景在挂到
 * DOM 之后按 `size` 写回显式像素——真实壳层就是这么渲染的（`{ size: 16 }`）。
 */
function iconSvg(root, exportName) {
  const catalog = iconCatalog(root)
  const svg = catalog.icons.get(exportName)
  if (svg !== undefined) return svg
  const reason = catalog.unrenderable.get(exportName)
  if (reason !== undefined) throw new Error(`${exportName} 在提取阶段就坏了（${reason}）`)
  const tier = /^(Icon.+)Outline(Medium|Regular)$/u.exec(exportName)
  const hint = tier === null
    ? ''
    : `；同一图形的另一档是 ${tier[1]}Outline${tier[2] === 'Medium' ? 'Regular' : 'Medium'}`
  throw new Error(`当前 DSH 构建里没有图标 ${exportName}（0.1.7 起档位改名成 …OutlineMedium/…OutlineRegular，旧的数字档位名一律不存在）${hint}`)
}

/**
 * 抽设置面板的导航 CSS：它在 `dsh-client-ui-settings-general` 的产物里是一段带混淆前缀的字符串。
 * 这里按"内容里出现 navCell"来定位那一份（不写死 `const css$3` 这种压缩后的变量名），
 * 再把前缀换成可读的 `sn-`。
 */
function settingsNavCss(root) {
  const clientPath = path.join(root, 'node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js')
  if (!fs.existsSync(clientPath)) throw new Error(`找不到设置页通用插件的产物：${clientPath}`)
  const source = fs.readFileSync(clientPath, 'utf8')
  for (const match of source.matchAll(/const (css\$\d+) = "([^"]+)"/gu)) {
    if (!match[2].includes('navCell')) continue
    // 混淆前缀（例如 `VOzbGW_`）由构建生成，不能写死：从 CSS 里第一个类名取出来，
    // 全串替换成 fixture 用的 `sn-`。取错了会静默丢样式——量出来就是"图标错位"（踩过）。
    const prefix = /\.[A-Za-z0-9]+_/u.exec(match[2])?.[0].slice(1)
    if (prefix === undefined) throw new Error('设置页样式里取不到类名前缀（壳层结构可能变了）')
    const stripped = match[2].split(prefix).join('sn-')
    if (!stripped.includes('.sn-navCell{')) throw new Error('设置页样式里没有 .sn-navCell 规则（壳层结构可能变了）')
    return stripped
  }
  throw new Error('在设置页产物里找不到含 navCell 的样式表（壳层结构可能变了，需人工核对）')
}

/**
 * 探测补丁的"契约"：它在导航按钮上打的 dataset 属性名、承载 mask 的 CSS 变量、以及
 * 隐藏原 svg 的方式（`display:none` 或 `opacity:0`——两个插件各用一种）。
 *
 * 全部从插件自己的样式表里读出来，不写死任何插件名；顺带校验 dataset 键与 CSS 选择器同源
 * （两者不一致时补丁照打标记但 CSS 匹配不到，页面上就是"图标没换、也没报错"）。
 */
function detectPatchContract(pluginSource) {
  const styleText = pluginStyleText(pluginSource)
  const attribute = /\[data-([a-z0-9-]+)\]/u.exec(styleText)?.[1]
  if (attribute === undefined) throw new Error('插件样式表里找不到 [data-…] 选择器（补丁的标记属性），请确认补丁还在')
  // mask 变量必须从**补丁自己那条 ::before 规则**里取：整张样式表里第一个 `var(...)`
  // 往往是别的规则的颜色（例如 `var(--dsw-alias-label-primary)`），取错了会把量测输出带偏。
  const beforeRule = new RegExp(`\\[data-${attribute}\\]::before\\{([^}]*)\\}`, 'u').exec(styleText)
  if (beforeRule === null) throw new Error(`样式表里没有 [data-${attribute}]::before 规则（图标就是由它画出来的），请确认补丁还在`)
  const maskVariable = /var\((--[a-z0-9-]+)\)/u.exec(beforeRule[1])?.[1]
  if (maskVariable === undefined) throw new Error(`补丁的 ::before 规则里没有 var(--…)（mask 变量）：${beforeRule[1]}`)
  const datasetKey = attribute.replace(/-([a-z0-9])/gu, (_, char) => char.toUpperCase())
  // 两种写法都接受：`dataset.fooBar = ''`，或 `dataset[FOO_BAR_FLAG] = ''` 配 `const FOO_BAR_FLAG = 'fooBar'`。
  const direct = pluginSource.includes(`dataset.${datasetKey}`) || pluginSource.includes(`.${datasetKey} =`)
  const viaConstant = pluginSource.includes('dataset[')
    && (pluginSource.includes(`'${datasetKey}'`) || pluginSource.includes(`"${datasetKey}"`))
  if (!direct && !viaConstant) {
    throw new Error(`CSS 选择器 [data-${attribute}] 与代码里的 dataset 键 ${datasetKey} 不同源——补丁会打标记但样式匹配不到`)
  }
  const hideRule = new RegExp(`\\[data-${attribute}\\]>svg:first-child\\{([^}]*)\\}`, 'u').exec(styleText)
  if (hideRule === null) throw new Error(`样式表里没有 [data-${attribute}]>svg:first-child 规则（隐含：原 svg 没被盖住，会叠两个图标）`)
  const hideBy = hideRule[1].includes('display:none') ? 'display' : hideRule[1].includes('opacity') ? 'opacity' : 'unknown'
  if (hideBy === 'unknown') throw new Error(`认不出隐藏原 svg 的方式：${hideRule[1]}`)
  return { attribute, maskVariable, datasetKey, hideBy }
}

function fixtureHtml({ navCss, iconMarkup, iconName, label, bundleFile, shellIcons, patch }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>导航图标补丁固定场景 · ${label}</title>
<style>
${navCss}
body{margin:0;padding:24px;background:#f6f7f9;font:14px/1.5 -apple-system,"PingFang SC",sans-serif}
.board{display:flex;gap:24px;align-items:flex-start}
.holder{background:#fff;border-radius:16px;padding:8px 12px 20px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.caption{font-size:12px;color:#636366;padding:8px 12px 0}
pre#result{margin-top:24px;padding:12px;background:#111;color:#9f9;font:12px/1.6 ui-monospace,Menlo,monospace;border-radius:8px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="board">
  <div class="holder">
    <p class="caption">壳层原生（补丁不匹配这一行，保持壳层图标）</p>
    <nav class="sn-nav" id="navA"><div class="sn-navList"></div></nav>
  </div>
  <div class="holder">
    <p class="caption">补丁后（${iconName}）</p>
    <nav class="sn-nav" id="navB"><div class="sn-navList"></div></nav>
  </div>
</div>
<pre id="result">running…</pre>
<script>
const NS = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set(['svg','path','circle','rect','g','mask','line','polyline','polygon','ellipse','use','defs','clipPath'])
const PROVIDER = Symbol('context-provider')
let hooks = null
const React = {
  Component: class Component { constructor(p){ this.props = p || {} } },
  createElement(type, props, ...children) { return { type, props: props || {}, children } },
  /**
   * 上下文垫片：Provider 用标记对象表示，由 build() 负责在渲染子树时切换 current。
   * 插件用 createContext 往下传 ctx/scope 是常见写法，缺了它整个 bundle 在 factory
   * 阶段就抛错，固定场景就量不到任何东西。
   */
  createContext(defaultValue) {
    const context = { defaultValue, current: defaultValue }
    context.Provider = { [PROVIDER]: context }
    context.Consumer = { [PROVIDER]: context }
    return context
  },
  useContext(context) {
    if (context === null || context === undefined) return undefined
    return context.current !== undefined ? context.current : context.defaultValue
  },
  useRef(initial) { const ref = { current: initial }; if (hooks !== null) hooks.refs.push(ref); return ref },
  useLayoutEffect(fn) { if (hooks !== null) hooks.layouts.push(fn) },
  useEffect() {},
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
  useCallback(fn) { return fn },
  useSyncExternalStore(_s, snapshot) { return snapshot() }
}

function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || typeof child === 'boolean') continue
    node.appendChild(typeof child === 'object' && child !== null && child.nodeType === undefined ? build(child) : document.createTextNode(String(child)))
  }
}

function build(element) {
  if (element === null || typeof element !== 'object') return document.createTextNode(String(element))
  // 已经是真 DOM 节点（本场景的图标组件直接返回 svg 元素，见 iconMarkupSvg）：原样接上。
  if (element.nodeType !== undefined) return element
  const { type, props, children } = element
  // 上下文 Provider：渲染子树期间切换 current，渲染完还原（真实 React 的行为语义）。
  if (type !== null && typeof type === 'object' && type[PROVIDER] !== undefined) {
    const context = type[PROVIDER]
    const previous = context.current
    if (props.value !== undefined) context.current = props.value
    const fragment = document.createDocumentFragment()
    try {
      appendChildren(fragment, children)
    } finally {
      context.current = previous
    }
    return fragment
  }
  if (typeof type === 'function') {
    const previous = hooks
    const own = { refs: [], layouts: [] }
    hooks = own
    let output
    try {
      output = type({ ...props, children })
    } finally {
      hooks = previous
    }
    const node = build(output)
    for (const layout of own.layouts) layout()
    return node
  }
  const node = SVG_TAGS.has(type) ? document.createElementNS(NS, type) : document.createElement(type)
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'ref' || value === null || value === undefined) continue
    if (key === 'className') node.setAttribute('class', value)
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value)
    else if (typeof value !== 'function') node.setAttribute(key, value)
  }
  appendChildren(node, children)
  if (props.ref !== undefined && typeof props.ref === 'object' && props.ref !== null) props.ref.current = node
  return node
}

// ---- 壳层真实图标 ----
// 图标由宿主侧（build.js 的提取路径）序列化成 SVG 源码，这里只把源码变成真 DOM 节点。
// 不在页面里求值模块源码：图标定义引用模块内其它符号，页面里没有那些作用域，
// 硬求值只会把压缩产物的局部名撞在一起（老做法在 0.1.7-alpha.2 上就是这么炸的）。
// 序列化产物是 build.js 给预览页用的形态（width/height=100%），挂到 DOM 后按 size
// 写回显式像素，与真实壳层按 size:16 渲染的结果一致。
const iconMarkupSvg = (markup, size) => {
  const template = document.createElement('template')
  template.innerHTML = markup
  const node = template.content.firstElementChild ?? template.content.firstChild
  if (node === null || node === undefined) throw new Error('图标源码没有解析出根元素：' + markup.slice(0, 60))
  node.setAttribute('width', String(size))
  node.setAttribute('height', String(size))
  return node
}
const icon = (markup) => (props) => iconMarkupSvg(markup, props && props.size !== undefined ? props.size : 16)
const icons = { ${iconName}: icon(${JSON.stringify(iconMarkup)}), ${shellIcons} }

// ---- 加载真实插件 bundle ----
let definition = null
window.__ModuleLoader__ = { load(value) { definition = value } }
</script>
<script src="${bundleFile}"></script>
<script>
try {
  const plugin = definition.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return icons
    throw new Error('unexpected require: ' + id)
  })

  const PATCH = ${JSON.stringify(patch)}
  const SECTION_LABEL = ${JSON.stringify(label)}
  // 左边那列换个字：补丁按菜单名精确匹配，于是它保持壳层原生图标，
  // 同屏就能看到"壳层原生 vs 补丁"的对照；labelOffset 只由 padding/图标尺寸/gap 决定，
  // 与文字长度无关，所以几何仍然可比。
  const SHELL_LABEL = SECTION_LABEL + '（原始）'
  const rows = {
    navA: [['通用', 'IconSettingsOutline16'], ['模型', 'IconDataOutline16'], [SHELL_LABEL, 'IconSettingsOutline16'], ['归档', 'IconSettingsOutline16']],
    navB: [['通用', 'IconSettingsOutline16'], ['模型', 'IconDataOutline16'], [SECTION_LABEL, ${JSON.stringify(iconName)}], ['归档', 'IconSettingsOutline16']]
  }

  for (const navId of ['navA', 'navB']) {
    const list = document.querySelector('#' + navId + ' .sn-navList')
    for (const [rowLabel, iconName] of rows[navId]) {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('class', 'sn-navCell' + (rowLabel.startsWith(SECTION_LABEL) ? ' sn-active' : ''))
      button.appendChild(build(React.createElement(icons[iconName] ?? icons['IconSettingsOutline16'], { size: 16 })))
      const text = document.createElement('span')
      text.setAttribute('class', 'sn-navLabel')
      text.textContent = rowLabel
      button.appendChild(text)
      list.appendChild(button)
    }
  }

  const applied = []
  // 只需要 slots；其余服务一律给"万能桩"，这样换成任何插件都能跑起来
  // （有的插件 apply 里就直接用 ctx.workspaces.list / ctx.sessions.subscribe …）。
  const everything = new Proxy(function () { return everything }, {
    get(_target, key) {
      if (key === 'then') return undefined
      if (key === 'list') return () => []
      if (key === 'subscribe') return () => () => {}
      if (key === 'describe') return () => ({ namespaces: [], writable: true })
      return everything
    },
    apply() { return everything },
    set() { return true }
  })
  const known = {
    settingsScope: { bind: () => ({ mutate: async () => {}, getSnapshot: () => ({ value: null }), subscribe: () => () => {} }) },
    slots: { inject: (_name, callback) => callback(), register: (options, Component) => { applied.push({ options, Component }); return () => {} } },
    timer: { timeout: () => () => {} },
    // 真实 Cordis 的 ctx.effect(fn) 会**立即**执行 fn 并登记它返回的清理函数。
    // 少了这一条，把副作用写在 effect 回调里的插件在固定场景里就什么都不做
    // （样式注不进去、补丁挂不上），量出来的失败是场景的错、不是插件的错。
    effect: (fn) => {
      const disposer = fn()
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    }
  }
  const ctx = new Proxy(known, { get: (target, key) => (key in target ? target[key] : everything) })
  plugin.apply(ctx, {})
  const marker = applied.find((entry) => entry.options.name === 'settings.action')
  if (marker === undefined) throw new Error('插件没有注册 settings.action（补丁的挂载点），先看它是不是改了插槽')
  document.body.appendChild(build(React.createElement(marker.Component, {})))

  const measure = (navId, rowLabel) => {
    const button = [...document.querySelectorAll('#' + navId + ' button')].find((node) => node.textContent.trim() === rowLabel)
    if (button === undefined) throw new Error('在 ' + navId + ' 里找不到行 ' + rowLabel)
    const text = button.querySelector('.sn-navLabel')
    const svg = button.querySelector('svg')
    const buttonRect = button.getBoundingClientRect()
    const textRect = text.getBoundingClientRect()
    const pseudo = getComputedStyle(button, '::before')
    const svgStyle = svg === null ? null : getComputedStyle(svg)
    return {
      labelOffsetLeft: +(textRect.left - buttonRect.left).toFixed(2),
      labelOffsetTop: +(textRect.top - buttonRect.top).toFixed(2),
      originalIconDisplay: svgStyle === null ? 'absent' : svgStyle.display,
      originalIconOpacity: svgStyle === null ? 'absent' : svgStyle.opacity,
      marked: button.hasAttribute('data-' + PATCH.attribute) ? 'yes' : 'no',
      maskVariableInline: button.style.getPropertyValue(PATCH.maskVariable).slice(0, 24),
      maskImage: String(pseudo.maskImage || pseudo.webkitMaskImage || '').slice(0, 40),
      pseudoWidth: pseudo.width,
      pseudoHeight: pseudo.height
    }
  }

  const result = {
    plugin: ${JSON.stringify(bundleFile)},
    icon: ${JSON.stringify(iconName)},
    patch: PATCH,
    // 按 bundle id 找"这个插件自己的样式表"：官方约定是 style[data-plugin=<包名>]，
    // 不能写死某个插件的 style id（写死过一次：换成归档插件就会误报 false）。
    stylesInjected: [...document.querySelectorAll('style')].some((element) => element.dataset.plugin === definition.id),
    shellRow: measure('navA', SHELL_LABEL),
    patchedRow: measure('navB', SECTION_LABEL)
  }
  result.checks = {
    stylesInjected: result.stylesInjected,
    geometryMatches: result.shellRow.labelOffsetLeft === result.patchedRow.labelOffsetLeft && result.shellRow.labelOffsetTop === result.patchedRow.labelOffsetTop,
    originalIconHidden: PATCH.hideBy === 'display' ? result.patchedRow.originalIconDisplay === 'none' : result.patchedRow.originalIconOpacity === '0',
    maskApplied: result.patchedRow.marked === 'yes' && result.patchedRow.maskImage.startsWith('url("data:image/svg+xml,'),
    squareIconBox: result.patchedRow.pseudoWidth === result.patchedRow.pseudoHeight && result.patchedRow.pseudoWidth !== 'auto',
    shellRowUntouched: result.shellRow.marked === 'no'
  }
  document.getElementById('result').textContent = JSON.stringify(result, null, 2)
} catch (error) {
  document.getElementById('result').textContent = 'ERROR: ' + error.message + '\\n' + String(error.stack)
}
</script>
</body>
</html>
`
}

/** 官方图标改名过，按能力取第一个在当前构建里真实存在的名字。 */
function existingIconName(root, candidates) {
  const name = firstExistingIconName(root, candidates)
  if (name === undefined) throw new Error(`当前 DSH 构建里没有这些候选图标：${candidates.join('、')}`)
  return name
}

/** 同上，但找不到就返回 undefined（用于"插件自己的候选链"：链上一个都不存在时再报错）。 */
function firstExistingIconName(root, candidates) {
  const catalog = iconCatalog(root)
  for (const name of candidates) {
    if (catalog.icons.has(name)) return name
  }
  return undefined
}

function main(argv) {
  const pluginName = argValue(argv, 'plugin', 'dsh-extra-context')
  const pluginDir = path.isAbsolute(pluginName) ? pluginName : path.join(WORKSPACE_ROOT, pluginName)
  const bundlePath = path.join(pluginDir, 'client.js')
  if (!fs.existsSync(bundlePath)) throw new Error(`找不到插件 bundle：${bundlePath}`)

  const root = locateDshRoot(argValue(argv, 'dsh'))
  const pluginSource = fs.readFileSync(bundlePath, 'utf8')
  const detected = detectNavIcon(pluginSource)
  // --icon 优先；否则按插件的候选链取第一个**当前构建里真实存在**的名字——这正是
  // 插件运行时 iconOf() 的行为，判出来的名字与页面里真正会画的图标才是同一个。
  const requested = argValue(argv, 'icon', undefined)
  const iconName = requested ?? firstExistingIconName(root, detected.candidates)
  if (iconName === undefined) {
    throw new Error(`无法从组件 ${detected.component ?? '(找不到 NavIcon 组件)'} 里确定图标（候选：${detected.candidates.join(', ') || '无'}，列出的是名字，不是存在性），请用 --icon 指定`)
  }
  const label = argValue(argv, 'label', detectLabel(pluginSource))
  if (label === undefined) throw new Error('在插件 bundle 里找不到 settings.section 的 label，请用 --label 指定')
  const patch = detectPatchContract(pluginSource)

  const { name: assetName } = shellBundle(root)
  const navCss = settingsNavCss(root)

  // 官方图标改过名（0.1.6 数字档位 → 0.1.7 档位词）：假装"壳层的齿轮/数据图标"时
  // 也按能力取第一个真实存在的名字，否则升级后这个离线验证器自己就先炸了。
  const shellIconName = existingIconName(root, ['IconSettingsOutlineMedium', 'IconSettingsOutlineRegular', 'IconSettingsOutline16'])
  const dataIconName = existingIconName(root, ['IconDataOutlineMedium', 'IconDataOutlineRegular', 'IconDataOutline16'])
  const extraIcons = [shellIconName, dataIconName]
    .map((name) => `${name}: icon(${JSON.stringify(iconSvg(root, name))})`)
    .join(', ')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.copyFileSync(bundlePath, path.join(OUT_DIR, 'client.js'))
  const html = fixtureHtml({
    navCss,
    iconMarkup: iconSvg(root, iconName),
    iconName,
    label,
    bundleFile: 'client.js',
    shellIcons: extraIcons,
    patch
  })
  const htmlPath = path.join(OUT_DIR, 'index.html')
  fs.writeFileSync(htmlPath, html
    .replaceAll('IconSettingsOutline16', shellIconName)
    .replaceAll('IconDataOutline16', dataIconName))

  console.log(`${TOOL_NAME}: 插件 ${path.relative(WORKSPACE_ROOT, pluginDir)}（组件 ${detected.component}）`)
  console.log(`${TOOL_NAME}: 菜单名「${label}」，图标 ${iconName}，壳层导航 CSS 取自 ${assetName}`)
  console.log(`${TOOL_NAME}: 补丁契约 data-${patch.attribute} / var(${patch.maskVariable}) / 用 ${patch.hideBy} 隐藏原 svg`)
  console.log(`${TOOL_NAME}: 场景页 ${htmlPath}（浏览器打开可目视对照，页面底部是量测 JSON）`)

  // `--measure` 顺手把它量完：只在真浏览器里才有真实布局，量不出来的话这个工具就只是"生成了一个页面"。
  if (argv.includes('--measure')) return measureFixture(htmlPath, { chrome: argValue(argv, 'chrome', undefined) })

  console.log(`${TOOL_NAME}: 无头量测请加 --measure（会驱动无头 Chrome 读回 checks），或手工打开上面的页面`)
}

/** 默认的 Chrome 路径（macOS 安装位置）；找不到就用 --chrome 指定。 */
function defaultChromePath() {
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 连 CDP（`--remote-debugging-port=0` 时 Chrome 会把 ws 地址打到 stderr）。 */
async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP 连接失败')), { once: true })
  })
  let next = 1
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(next, { resolve, reject })
    socket.send(JSON.stringify({ id: next, method, params }))
    next += 1
  })
  return {
    send,
    close: () => socket.close(),
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true })
      if (result.exceptionDetails !== undefined) throw new Error(`页内求值失败：${JSON.stringify(result.exceptionDetails).slice(0, 300)}`)
      return result.result?.value
    }
  }
}

/**
 * 用无头 Chrome 量一遍固定场景，并把 `checks` 全为 true 当作通过（否则非零退出）。
 *
 * 为什么不用 `--dump-dom`：这条 Chrome（153）dump 完不会自己退出，脚本里得靠超时兜底；
 * 走 CDP 既能拿到结构化结果，也能在量完之后立刻收工（Chrome 只由本进程拉起、按自己的
 * `--user-data-dir` 归属收掉，不会碰用户正在用的浏览器）。
 */
async function measureFixture(htmlPath, options = {}) {
  const chrome = options.chrome ?? defaultChromePath()
  if (!fs.existsSync(chrome)) throw new Error(`找不到 Chrome：${chrome}（用 --chrome 指定）`)
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-nav-icon-chrome-'))
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let browserWs
  const seen = []
  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    seen.push(text)
    browserWs ??= /DevTools listening on (ws:\/\/\S+)/u.exec(text)?.[1]
  })

  const stop = () => {
    if (!child.killed) child.kill('SIGTERM')
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }

  try {
    for (let attempt = 0; attempt < 80 && browserWs === undefined; attempt += 1) await sleep(100)
    if (browserWs === undefined) throw new Error(`Chrome 没有公布调试地址：${seen.join('').slice(-300)}`)

    const browser = await connectCdp(browserWs)
    // 不挂在 browser endpoint 上用 flat session：直接开一个 page target，再用它自己的
    // ws 地址连过去（与手工 `--remote-debugging-port=<port>` 时走的路径完全一致）。
    const port = new URL(browserWs).port
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    let pageWs
    for (let attempt = 0; attempt < 80 && pageWs === undefined; attempt += 1) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      pageWs = list.find((item) => item.id === targetId && item.webSocketDebuggerUrl !== undefined)?.webSocketDebuggerUrl
      if (pageWs === undefined) await sleep(100)
    }
    if (pageWs === undefined) throw new Error('Chrome 没有公布页面调试地址')
    const page = await connectCdp(pageWs)
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Page.navigate', { url: `file://${htmlPath}` })
    const evaluate = (expression) => page.evaluate(expression)

    let report
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const text = await evaluate(`document.getElementById('result')?.textContent ?? ''`)
      if (text.startsWith('ERROR')) throw new Error(`固定场景执行失败：${text.slice(0, 400)}`)
      if (text !== 'running…' && text.trim() !== '') {
        report = JSON.parse(text)
        break
      }
      await sleep(100)
    }
    if (report === undefined) throw new Error('固定场景超时：页面没有输出量测结果')

    console.log(`${TOOL_NAME}: 量测结果`)
    for (const [name, ok] of Object.entries(report.checks)) console.log(`  ${ok ? '✓' : '✗'} ${name}`)
    console.log(`  shellRow  ${JSON.stringify(report.shellRow)}`)
    console.log(`  patched  ${JSON.stringify(report.patchedRow)}`)
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true).map(([name]) => name)
    if (failed.length > 0) {
      throw new Error(`几何验证未通过：${failed.join('、')}`)
    }
    console.log(`${TOOL_NAME}: 六项检查全部通过（位置一致、原 svg 被盖住、mask 生效、方块尺寸一致、壳层行未被动过）`)
  } finally {
    stop()
  }
}

module.exports = { main, detectNavIcon, detectLabel, pluginStyleText, settingsNavCss, detectPatchContract, iconCatalog, iconSvg, measureFixture, OUT_DIR }

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`${TOOL_NAME}: ${error.message}`)
    process.exitCode = 1
  }
}
