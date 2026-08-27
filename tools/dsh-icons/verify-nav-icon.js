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
 *   node tools/dsh-icons/verify-nav-icon.js
 *   node tools/dsh-icons/verify-nav-icon.js --plugin dsh-chat-archive-manager
 *   node tools/dsh-icons/verify-nav-icon.js --plugin dsh-extra-context --label '额外上下文' --icon IconContextInjectionOutline16
 *
 * 产物：`/tmp/dsh-nav-icon-fixture/index.html`（用浏览器打开可目视对照，页面底部打印量测 JSON）。
 * 只读：不改 DSH 安装，也不改插件源码。
 *
 * 注意：这是**固定场景**，量的是布局等价性，不等于真实设置页的观感
 * （真实页面还需要用户在 Warp 里刷新后目视确认）。
 */

const fs = require('node:fs')
const path = require('node:path')

const { locateDshRoot, shellBundle, definitionOf, serializeSvg, WORKSPACE_ROOT, TOOL_NAME } = require('./build.js')

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
 * 只在**从 primitives 解构进来的图标名**里找，而不是随便匹配 `Icon…`：
 * 组件体里还可能出现 `navIconReferences`、`installNavIconPatch` 这类标识符，
 * 直接正则会把 `IconReferences` 当成图标名（踩过）。
 */
function detectNavIcon(pluginSource) {
  const imports = /const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u.exec(pluginSource)
  const candidates = imports === null
    ? []
    : imports[1].split(',').map((piece) => piece.trim().split(':').pop().trim()).filter((name) => name.startsWith('Icon'))
  // 组件名必须是首字母大写（`ExtraContextNavIcon`），否则会匹配到 `navIconReferences` 这类工具函数
  const component = /function\s+([A-Z]\w*NavIcon\w*)\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/u.exec(pluginSource)
  if (component === null) throw new Error('在插件 bundle 里找不到名字含 NavIcon 的组件，请用 --icon 指定图标')
  const used = candidates.filter((name) => component[2].includes(name))
  if (used.length === 1) return { component: component[1], icon: used[0] }
  if (used.length === 0) throw new Error(`组件 ${component[1]} 里没有引用导入的图标（导入的是 ${candidates.join(', ')}），请用 --icon 指定`)
  throw new Error(`组件 ${component[1]} 引用了多个图标（${used.join(', ')}），请用 --icon 指定`)
}

/**
 * 从插件 bundle 里找导航行的菜单名。
 *
 * 以 `settings.section` 注册里的 `label:` 为入口（那是壳层真正拿去渲染的文字），
 * 它可能直接是字符串，也可能指向一个常量——两种都取得到，不依赖常量怎么命名。
 */
function detectLabel(pluginSource) {
  const registration = /name: 'settings\.section',[\s\S]{0,240}?label:\s*([A-Za-z0-9_$]+|'[^']+')/u.exec(pluginSource)
  if (registration === null) throw new Error('在插件 bundle 里找不到 settings.section 的 label，请用 --label 指定')
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

/** 把壳层图标定义求值成可用的组件（桩 jsx-runtime，复用 build.js 的序列化能力做自检）。 */
function compileIcon(root, exportName) {
  const { source } = shellBundle(root)
  const mapping = new RegExp(`${exportName}:([A-Za-z0-9_$]+)`).exec(source)
  if (mapping === null) throw new Error(`当前 DSH 构建里没有 ${exportName}`)
  const definition = definitionOf(source, mapping[1])
  if (definition === null) throw new Error(`找不到 ${exportName} 的定义`)
  const jsxRuntime = { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props: props ?? {}, children: [] }), jsxs: (type, props) => ({ type, props: props ?? {}, children: [] }) }
  const component = new Function('u', 'react_jsx_runtime', `return (${definition})`)(jsxRuntime, jsxRuntime)
  // 用 build.js 的序列化顺手自检：拿不到 viewBox 说明定义形态变了，早点报错
  const probe = serializeSvg(component({ size: 16 }), 'probe')
  if (!probe.includes('viewBox=')) throw new Error(`${exportName} 渲染出来没有 viewBox，图标定义形态可能变了`)
  return definition
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

function fixtureHtml({ navCss, iconDefinition, iconName, label, bundleFile, shellIconDefinitions, patch }) {
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
let hooks = null
const React = {
  Component: class Component { constructor(p){ this.props = p || {} } },
  createElement(type, props, ...children) { return { type, props: props || {}, children } },
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
  const { type, props, children } = element
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

// ---- 壳层真实图标（从安装包里原样求值） ----
const jsxRuntime = {
  Fragment: Symbol('Fragment'),
  jsx: (type, props) => ({ type, props: props || {}, children: props && props.children !== undefined ? [props.children] : [] }),
  jsxs: (type, props) => ({ type, props: props || {}, children: props && props.children !== undefined ? (Array.isArray(props.children) ? props.children : [props.children]) : [] })
}
const icon = (source) => new Function('u', 'react_jsx_runtime', 'return (' + source + ')')(jsxRuntime, jsxRuntime)
const icons = { ${iconName}: icon(${JSON.stringify(iconDefinition)}), ${shellIconDefinitions} }

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
    timer: { timeout: () => () => {} }
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

function main(argv) {
  const pluginName = argValue(argv, 'plugin', 'dsh-extra-context')
  const pluginDir = path.isAbsolute(pluginName) ? pluginName : path.join(WORKSPACE_ROOT, pluginName)
  const bundlePath = path.join(pluginDir, 'client.js')
  if (!fs.existsSync(bundlePath)) throw new Error(`找不到插件 bundle：${bundlePath}`)

  const pluginSource = fs.readFileSync(bundlePath, 'utf8')
  const detected = detectNavIcon(pluginSource)
  const iconName = argValue(argv, 'icon', detected.icon)
  const label = argValue(argv, 'label', detectLabel(pluginSource))
  const patch = detectPatchContract(pluginSource)
  const root = locateDshRoot(argValue(argv, 'dsh'))

  const { name: assetName } = shellBundle(root)
  const navCss = settingsNavCss(root)

  const extraIcons = ['IconSettingsOutline16', 'IconDataOutline16']
    .map((name) => `${name}: icon(${JSON.stringify(compileIcon(root, name))})`)
    .join(', ')

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.copyFileSync(bundlePath, path.join(OUT_DIR, 'client.js'))
  const html = fixtureHtml({
    navCss,
    iconDefinition: compileIcon(root, iconName),
    iconName,
    label,
    bundleFile: 'client.js',
    shellIconDefinitions: extraIcons,
    patch
  })
  const htmlPath = path.join(OUT_DIR, 'index.html')
  fs.writeFileSync(htmlPath, html)

  console.log(`${TOOL_NAME}: 插件 ${path.relative(WORKSPACE_ROOT, pluginDir)}（组件 ${detected.component}）`)
  console.log(`${TOOL_NAME}: 菜单名「${label}」，图标 ${iconName}，壳层导航 CSS 取自 ${assetName}`)
  console.log(`${TOOL_NAME}: 补丁契约 data-${patch.attribute} / var(${patch.maskVariable}) / 用 ${patch.hideBy} 隐藏原 svg`)
  console.log(`${TOOL_NAME}: 场景页 ${htmlPath}（浏览器打开可目视对照，页面底部是量测 JSON）`)
  console.log(`${TOOL_NAME}: 无头量测示例：`)
  console.log(`  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --virtual-time-budget=3000 --dump-dom "file://${htmlPath}"`)
}

module.exports = { main, detectNavIcon, detectLabel, pluginStyleText, settingsNavCss, detectPatchContract, OUT_DIR }

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`${TOOL_NAME}: ${error.message}`)
    process.exitCode = 1
  }
}
