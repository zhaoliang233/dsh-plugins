#!/usr/bin/env node
'use strict'

/**
 * 从**已安装的 DSH** 里提取内置图标集，生成两份产物：
 *
 *   - `icons.json`   机器可读快照：名字、档位、viewBox、可复用的 SVG 源码、官方与工作区谁在用
 *   - `preview.html` 自包含预览页（内嵌同一份数据，无 fetch、可直接 file:// 打开）
 *
 * 用法:
 *   node tools/dsh-icons/build.js                  # 自动定位（realpath `which dsh`）
 *   node tools/dsh-icons/build.js --dsh /path/to/@deepseek-ai/dsh
 *   node tools/dsh-icons/build.js --check          # 只做漂移检查，见 README
 *
 * 数据来源（全部只读，不改 DSH 安装）：
 *   1. 前端产物 `dsh-web-frontend/dist/assets/index-*.js`：浏览器侧 `__ModuleLoader__`
 *      seed 里 `@deepseek-ai/dsh-client-ui-primitives` 指向的那个冻结导出对象。**它才是
 *      插件能 require 到的全集**——没被打进这个对象的图标，插件里 require 回来就是 undefined。
 *   2. 各官方 `@deepseek-ai/dsh-client-ui-…` 包的 `lib/client.js`：谁在用什么图标（选型时的语义线索）。
 *   3. 工作区内各插件的 `client.js`：本工作区谁在用什么图标。
 *
 * 为什么在 node 里求值图标定义：图标是编译后的 JSX 组件（`u.jsx("path",{d:"…"})`），
 * 用桩 jsx-runtime 求值再序列化成 `<svg>` 字符串，比正则抠 `d=` 稳得多（mask/clipPath/
 * 多个 path 的情况都能原样保留）。
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const TOOL_DIR = __dirname
const TOOL_NAME = 'tools/dsh-icons'
const WORKSPACE_ROOT = path.resolve(TOOL_DIR, '..', '..')
const CATALOG_PATH = path.join(TOOL_DIR, 'icons.json')
const PREVIEW_PATH = path.join(TOOL_DIR, 'preview.html')

/**
 * 中文关键词：只为「我该用哪个图标」这个问题服务，搜索框和卡片都会显示。
 * 名字本身（英文）永远可搜，这里补的是语义别名。新增图标时顺手补一行即可。
 */
const KEYWORDS = {
  IconContextInjectionOutline16: ['上下文', '注入', '额外上下文', 'prompt 附加'],
  IconListPenOutline16: ['文本', '批注', '规则', '说明'],
  IconEditOutline16: ['编辑', '修改', '重命名'],
  IconEnhanceOutline16: ['增强', '优化', '提升'],
  IconCompactOutline16: ['压缩', '紧凑', '精简'],
  IconWrapLinesOutline16: ['换行', '折行'],
  IconCodeOutline16: ['代码', '源码'],
  IconSkeleton16: ['骨架'],
  IconDataOutline16: ['数据', '模型', '指标'],
  IconDatabaseOutline16: ['数据库', '存储'],
  IconPlusOutline16: ['添加', '新增', '加号'],
  IconLinkOutline16: ['链接', '附加', '引用'],
  IconProjectAddOutline16: ['新建项目', '添加工作区'],
  IconShareOutline16: ['分享', '导出'],
  IconCopyOutline16: ['复制'],
  IconDownloadOutline16: ['下载'],
  IconTrashOutline16: ['删除', '清空'],
  IconRefreshOutline16: ['刷新', '重载'],
  IconRefreshOutline14: ['刷新', '重试'],
  IconSearchOutline16: ['搜索', '查找'],
  IconInspectOutline12: ['查看', '详情', '检查'],
  IconBrowseOutline16: ['浏览', '选择目录'],
  IconSparkle16: ['AI', '生成', '魔法', '助手'],
  IconThinkOutline16: ['思考', '推理'],
  IconThinkOutline14: ['思考', '推理'],
  IconSkillOutline16: ['技能'],
  IconGoalOutline16: ['目标'],
  IconPlanOutline14: ['计划'],
  IconQueueOutline14: ['队列', '排队'],
  IconGaugeOutline16: ['用量', '配额', '速度'],
  IconCordisPluginOutline14: ['插件'],
  IconApiOutline14: ['API', '接口'],
  IconPersonalizationOutline16: ['个性化', '插件设置'],
  IconSettingsOutline16: ['设置', '偏好'],
  IconSettingsOutline14: ['设置', '偏好'],
  IconCheckOutline16: ['勾选', '完成', '成功'],
  IconCheckOutline14: ['勾选', '完成'],
  IconChecklistOutline14: ['清单', '多选'],
  IconWarningOutline16: ['警告', '注意'],
  IconQuestionOutline14: ['帮助', '疑问'],
  IconShieldOutline16: ['权限', '安全', '沙箱'],
  IconPauseOutline16: ['暂停'],
  IconPlayOutline16: ['运行', '播放', '继续'],
  IconStopFill16: ['停止', '中断'],
  IconLoadingOutline16: ['加载中'],
  IconClockOutline16: ['时间', '历史'],
  IconAlarmClockOutline16: ['定时', '提醒', '计划任务'],
  IconLikeOutline16: ['赞', '好评'],
  IconLikeFill16: ['赞', '好评'],
  IconDislikeOutline16: ['差评'],
  IconDislikeFill16: ['差评'],
  IconEllipsisOutline16: ['更多', '菜单'],
  IconRightUpOutline16: ['外链', '打开'],
  IconRightUpOutline14: ['外链', '打开'],
  IconChevronUpOutline14: ['向上', '收起'],
  IconChevronDownOutline14: ['向下', '展开'],
  IconChevronLeftOutline14: ['向左', '返回'],
  IconChevronRightOutline14: ['向右', '下一级'],
  IconTriangleRightFill14: ['展开', '折叠箭头'],
  IconCloseOutline16: ['关闭', '取消'],
  IconCloseFill14: ['关闭', '移除'],
  IconPanelLeftOutline16: ['侧栏', '面板'],
  IconFullscreenOutline16: ['全屏', '放大'],
  IconBranchOutline16: ['分支', '会话分叉'],
  IconTreeCorner8x10: ['树形连接线'],
  IconFollowsystemOutline16: ['跟随系统', '主题'],
  IconLightOutline16: ['浅色主题'],
  IconDarkOutline16: ['深色主题'],
  IconFolderClose16: ['文件夹', '收起目录'],
  IconFolderOpen16: ['文件夹', '展开目录'],
  IconFolderOpenOutline16: ['文件夹', '打开目录'],
  IconArchiveOutline20: ['归档', '存档'],
  IconPaperclipOutline16: ['附件', '上传'],
  IconPaperPlaneOutline14: ['发送'],
  IconSendOutline14: ['发送'],
  IconGlobeOutline14: ['网络', '联网'],
  IconUserOutline16: ['用户', '账号'],
  IconNewChatOutline16: ['新对话', '新建会话'],
  IconAgentPresetOutline16: ['预设', '角色'],
  IconCompactOutline16: ['压缩']
}

const COMPONENT_EXPORTS_WITHOUT_ICON_PREFIX = ['FileTypeIcon', 'LinkIcon', 'ReferenceIcon']

/**
 * 当前构建导出的**非图标**成员（Button/Modal/Tooltip/…），由 buildCatalog 填充。
 * 工作区插件 `require` 回来的成员要按这个清单区分「图标不存在」与「普通成员不存在」。
 */
const NON_ICON_MEMBERS = new Set()

// #region 定位 DSH 安装

/** 从 `which dsh` 的真实路径向上找 `package.json#name === @deepseek-ai/dsh` 的包根。 */
function locateDshRoot(explicit) {
  if (typeof explicit === 'string' && explicit !== '') {
    const root = path.resolve(explicit)
    if (!fs.existsSync(path.join(root, 'package.json'))) throw new Error(`--dsh 指向的目录里没有 package.json：${root}`)
    return root
  }
  let shim
  try {
    shim = execFileSync('bash', ['-lc', 'realpath "$(command -v dsh)"'], { encoding: 'utf8' }).trim()
  } catch (error) {
    throw new Error(`无法定位 dsh 可执行文件（${error.message}）；可显式传 --dsh <DSH 包根>`)
  }
  let dir = path.dirname(shim)
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = path.join(dir, 'package.json')
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        if (manifest.name === '@deepseek-ai/dsh') return dir
      } catch {
        // 读到坏 package.json 就继续往上找
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`从 ${shim} 向上没找到 @deepseek-ai/dsh 包根`)
}

function dshVersion(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
}

/** 前端产物里带 primitives seed 映射的那份 chunk（文件名带内容哈希，不能写死）。 */
function shellBundle(root) {
  const assetsDir = path.join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  if (!fs.existsSync(assetsDir)) throw new Error(`没有前端产物目录：${assetsDir}`)
  const candidates = fs.readdirSync(assetsDir).filter((name) => name.endsWith('.js'))
  for (const name of candidates) {
    const full = path.join(assetsDir, name)
    const source = fs.readFileSync(full, 'utf8')
    if (source.includes('"@deepseek-ai/dsh-client-ui-primitives"')) {
      return { name, path: full, source }
    }
  }
  throw new Error(`在 ${assetsDir} 里没找到含 primitives seed 映射的 chunk`)
}

// #endregion

// #region 源码解析

/** 平衡扫描：从 openAt 处的 `{`/`(`/`[` 扫到与之配对的收尾字符。 */
function balancedRange(text, openAt) {
  let depth = 0
  for (let index = openAt; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      index += 1
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\') index += 1
        index += 1
      }
      continue
    }
    if (char === '{' || char === '(' || char === '[') depth += 1
    else if (char === '}' || char === ')' || char === ']') {
      depth -= 1
      if (depth === 0) return { start: openAt, end: index + 1 }
    }
  }
  throw new Error('源码括号不平衡，提取失败')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 定位 `@deepseek-ai/dsh-client-ui-primitives` 在浏览器 seed 里指向的变量与其冻结导出对象。 */
function primitivesModule(source) {
  const seed = /"@deepseek-ai\/dsh-client-ui-primitives":\s*([A-Za-z0-9_$]+)/u.exec(source)
  if (seed === null) throw new Error('seed 映射里没有 client-ui-primitives')
  const variable = seed[1]
  // 定义可能带 `const/let/var`，也可能只是逗号声明表里的尾项（`…,zj=Object.freeze(…)`，
  // 0.1.7 起就是这样），所以只要求左侧不是标识符字符，不再要求声明关键字。
  const definition = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(variable)}\\s*=\\s*Object\\.freeze\\(Object\\.defineProperty\\(`, 'u').exec(source)
  if (definition === null) throw new Error(`没找到 ${variable} 的冻结导出对象定义`)
  const objectOpen = source.indexOf('{', definition.index + definition[0].length - 1)
  const range = balancedRange(source, objectOpen)
  const body = source.slice(range.start + 1, range.end - 1)
  const exports = new Map()
  for (const match of body.matchAll(/([A-Za-z0-9_$]+):([A-Za-z0-9_$]+)/gu)) exports.set(match[1], match[2])
  exports.delete('__proto__')
  return { variable, exports }
}

/** 取某个模块级变量的定义表达式（`foo=…` 到同一表达式结束）。 */
function definitionOf(source, variable) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(variable)}\\s*=(?!=)`, 'gu')
  let match
  while ((match = pattern.exec(source)) !== null) {
    const start = pattern.lastIndex
    // 表达式的首字符：函数/箭头是 `(` 或标识符，常量还可能是字符串/数组/数字（`A6="M0 0…"`）。
    // 只排除 `==`/`===` 这类比较运算符。
    if ((source[start] ?? '') === '=') continue
    let depth = 0
    let index = start
    for (; index < source.length; index += 1) {
      const char = source[index]
      if (char === '"' || char === "'" || char === '`') {
        const quote = char
        index += 1
        while (index < source.length && source[index] !== quote) {
          if (source[index] === '\\') index += 1
          index += 1
        }
        continue
      }
      if (char === '{' || char === '(' || char === '[') depth += 1
      else if (char === '}' || char === ')' || char === ']') depth -= 1
      else if (depth === 0 && (char === ',' || char === ';' || char === '\n')) break
    }
    return source.slice(start, index).trim()
  }
  return null
}

// #endregion

// #region 图标求值：桩 jsx-runtime → 静态 SVG

const jsxRuntime = {
  Fragment: Symbol('Fragment'),
  jsx: (type, props) => ({ type, props: props ?? {}, children: props && props.children !== undefined ? [props.children] : [] }),
  jsxs: (type, props) => ({ type, props: props ?? {}, children: props && props.children !== undefined ? (Array.isArray(props.children) ? props.children : [props.children]) : [] }),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children })
}

/**
 * 求值一个图标定义。
 *
 * 打包产物里的 JSX 运行时别名由压缩器决定（0.1.6 是 `u`／`react_jsx_runtime`，0.1.7 换成了 `l`），
 * 写死别名会让升级 DSH 后**所有**图标都变成 `render: l is not defined`。所以别名从定义本身
 * 探测出来再绑定；同一个桩对象同时提供 `jsx`/`jsxs`/`Fragment`/`createElement`，无论压缩器
 * 把哪一层别名留下来都能求值。
 *
 * @param definition - 图标组件的定义表达式源码。
 * @returns 组件函数。
 */
function evaluateIconDefinition(definition) {
  const aliases = new Set()
  for (const match of definition.matchAll(/\b([A-Za-z0-9_$]+)\s*\.\s*(?:jsxs?|createElement)\s*\(/gu)) aliases.add(match[1])
  aliases.add('u')
  aliases.add('react_jsx_runtime')
  aliases.add('React')
  const names = [...aliases]
  const factory = new Function(...names, `return (${definition})`)
  return factory(...names.map(() => jsxRuntime))
}

const SVG_VOID_TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use', 'stop', 'image'])

/** 语言关键字与求值器参数：出现这些标识符时不去模块里找定义。 */
const RESERVED_IDENTIFIERS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'return', 'new', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'function', 'class', 'const', 'let', 'var',
  'try', 'catch', 'finally', 'throw', 'await', 'async', 'yield', 'default', 'export', 'import', 'extends', 'super',
  'u', 'l', 'React', 'react_jsx_runtime', 'props', 'children', 'Math', 'Number', 'String', 'Object', 'Array', 'JSON'
])

/**
 * JSX 里的驼峰属性名 → 真实 SVG 属性名。
 *
 * 默认按连字符转换（`fillRule` → `fill-rule`、`strokeWidth` → `stroke-width`），
 * 但**这些属性在 SVG 里本身就是驼峰**，转成连字符会变成无效属性并被浏览器忽略：
 * `viewBox` 一旦丢掉，图标就失去缩放基准（在小尺寸下看起来"偏到左上角"）。
 * 这个坑在一次性预览页里踩过，所以这里显式白名单。
 */
const CAMEL_CASE_SVG_ATTRIBUTES = new Set([
  'viewBox', 'maskUnits', 'maskContentUnits', 'gradientUnits', 'patternUnits', 'patternContentUnits', 'primitiveUnits',
  'preserveAspectRatio', 'baseFrequency', 'numOctaves', 'stdDeviation', 'lengthAdjust', 'textLength',
  'refX', 'refY', 'markerWidth', 'markerHeight', 'startOffset', 'spreadMethod', 'targetX', 'targetY',
  'surfaceScale', 'diffuseConstant', 'specularConstant', 'specularExponent', 'kernelMatrix', 'edgeMode'
])

function svgAttributeName(key) {
  if (key === 'className') return 'class'
  if (CAMEL_CASE_SVG_ATTRIBUTES.has(key)) return key
  return key.replace(/[A-Z]/gu, (char) => `-${char.toLowerCase()}`)
}

/**
 * 把桩 jsx 树序列化成静态 SVG 字符串。
 * `idPrefix` 给 mask/clipPath 的内部 id 加前缀，避免同一页面里多个图标撞 id。
 */
function serializeSvg(node, idPrefix, depth = 0) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map((child) => serializeSvg(child, idPrefix)).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  const { type, props } = node
  if (type === jsxRuntime.Fragment) return serializeSvg(props.children, idPrefix)
  // 0.1.7 起导出图标常是包装器（`e=>l.jsx(F5,{...e})`），所以要继续展开函数组件，
  // 而不是把非字符串的 type 直接丢掉（那会渲染出空 SVG）。
  if (typeof type === 'function') {
    if (depth > 8) return ''
    return serializeSvg(type(props), idPrefix, depth + 1)
  }
  if (type !== null && typeof type === 'object' && typeof type.type === 'function') {
    if (depth > 8) return ''
    return serializeSvg(type.type(props), idPrefix, depth + 1)
  }
  if (typeof type !== 'string') return ''
  const attributes = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value === undefined || value === null || typeof value === 'function') continue
    let text = String(value)
    if (key === 'id') text = `${idPrefix}_${text}`
    if (key === 'fill' || key === 'stroke' || key === 'clipPath' || key === 'mask') {
      text = text.replace(/url\(#([^)]+)\)/gu, (_, ref) => `url(#${idPrefix}_${ref})`)
    }
    attributes.push(`${svgAttributeName(key)}="${text.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;')}"`)
  }
  const open = `<${type}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}`
  if (SVG_VOID_TAGS.has(type)) return `${open}/>`
  return `${open}>${serializeSvg(props.children, idPrefix)}</${type}>`
}

/**
 * 提取全部图标并渲染成 SVG。
 *
 * 图标定义会引用同模块的其它标识符，压缩器的版本决定它们的形状：
 * 0.1.6 是内联的 `d=` 字符串，0.1.7 把路径抽成独立常量（`F5="M0 0…"`）再在组件里引用。
 * 所以这里**两遍**求值：先把图标定义里引用到的、本模块内有定义的纯数据标识符挂到
 * globalThis，再求值组件本身；失败只影响对应图标（记为 unrenderable）。
 */
function extractIcons(source, exports) {
  const icons = []
  const unrenderable = []
  const constantExports = []

  const referenced = new Set()
  const iconDefinitions = new Map()
  for (const [name, variable] of exports) {
    if (!name.startsWith('Icon')) continue
    const definition = definitionOf(source, variable)
    if (definition === null) continue
    iconDefinitions.set(name, definition)
    for (const token of definition.matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)/gu)) referenced.add(token[1])
  }

  const constants = new Set(constantExports)
  for (const [name, variable] of exports) {
    if (name.startsWith('Icon') || COMPONENT_EXPORTS_WITHOUT_ICON_PREFIX.includes(name)) continue
    constants.add(variable)
  }

  // 图标定义里引用到的模块内符号：0.1.7 把每个图标拆成「导出包装器 + 基础组件」
  // （`Sx=e=>l.jsx(F5,{...e,strokeWidth:Z})`），引用到的可能是函数而不是数据，
  // 所以这里按工作队列收敛求值（含函数），并继续展开它们自己引用到的符号。
  const seen = new Set()
  const queue = [...referenced]
  while (queue.length > 0 && seen.size < 500) {
    const token = queue.shift()
    if (seen.has(token) || RESERVED_IDENTIFIERS.has(token)) continue
    seen.add(token)
    const definition = definitionOf(source, token)
    if (definition === null || definition.length > 20_000) continue
    if (constants.has(token) && globalThis[token] === undefined) {
      try {
        globalThis[token] = new Function(`return (${definition})`)()
      } catch {
        // 常量求值失败不影响图标本身
      }
    } else if (!constants.has(token) && globalThis[token] === undefined) {
      try {
        globalThis[token] = evaluateIconDefinition(definition)
      } catch {
        // 组件求值失败只影响引用它的图标（记为 unrenderable）
      }
    }
    for (const match of definition.matchAll(/(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)/gu)) {
      if (!seen.has(match[1])) queue.push(match[1])
    }
  }

  for (const [name, variable] of exports) {
    if (!name.startsWith('Icon')) continue
    const definition = iconDefinitions.get(name)
    if (definition === undefined) {
      unrenderable.push({ name, reason: 'definition-not-found' })
      continue
    }
    let component
    try {
      component = evaluateIconDefinition(definition)
    } catch (error) {
      unrenderable.push({ name, reason: `eval: ${error.message}` })
      continue
    }
    if (typeof component !== 'function') {
      unrenderable.push({ name, reason: 'not-a-component' })
      continue
    }
    let tree
    try {
      tree = component({ size: 16 })
    } catch (error) {
      unrenderable.push({ name, reason: `render: ${error.message}` })
      continue
    }
    const idPrefix = `dshIcon${icons.length}`
    let svg = serializeSvg(tree, idPrefix)
    if (svg === '') {
      unrenderable.push({ name, reason: 'empty-svg' })
      continue
    }
    // 预览页自己控制显示尺寸：统一换成 100% 宽高，交给容器缩放
    svg = svg.replace(/width="\d+"/u, 'width="100%"').replace(/height="\d+"/u, 'height="100%"')
    const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1] ?? ''
    const viewBoxNumbers = viewBox.split(/\s+/u).map(Number)
    const canvasSize = viewBoxNumbers.length === 4 && viewBoxNumbers.every((value) => Number.isFinite(value))
      ? { width: viewBoxNumbers[2], height: viewBoxNumbers[3] }
      : null
    // 两条尺寸信息都记下来，它们会不一致（实测数据，别当成等价）：
    // - `tier` 取名字末尾的数字（14/16/20…），就是官方图标集的分档，
    //   「同一行图标必须同档」按它判断；`IconTreeCorner8x10` 是「8x10 连接线」，
    //   末尾的 10 不是档位，按复合尺寸处理（null）；
    // - `canvasSize` 是 viewBox 的宽高，也就是**画布真相**：
    //   `IconInspectOutline12` 名字写 12、viewBox 却是 16×16；
    //   `IconRightUpOutline14` 名字 14、viewBox 是 8×14（窄字形）。
    //   换图标前用预览页按真实尺寸看一眼，别只信名字。
    // 档位后缀有两种命名法：0.1.6 的数字（14/16/20）与 0.1.7 的档位词（Medium/Regular）。
    const tierWord = /(Medium|Regular|Small|Large)$/u.exec(name)
    const tierMatch = /(\d+)x(\d+)$/u.test(name) ? null : /(\d+)$/u.exec(name)
    const tier = tierMatch !== null ? Number(tierMatch[1]) : (tierWord === null ? null : tierWord[1])
    icons.push({
      name,
      tier,
      canvasSize,
      sizeMismatch: typeof tier === 'number' && canvasSize !== null && canvasSize.width === canvasSize.height && canvasSize.width !== tier,
      viewBox,
      keywords: KEYWORDS[name] ?? [],
      usedBy: [],
      usedByPlugins: [],
      svg
    })
  }

  icons.sort((left, right) => left.name.localeCompare(right.name))
  return { icons, unrenderable, constantExports }
}

// #endregion

// #region 使用情况扫描（选型时的语义线索）

/** 官方客户侧包里谁用了哪个图标。 */
function officialUsage(root, iconNames, log) {
  const scopeDir = path.join(root, 'node_modules/@deepseek-ai')
  const usage = new Map(iconNames.map((name) => [name, []]))
  const packages = fs.readdirSync(scopeDir).filter((name) => name.startsWith('dsh-client-ui-') || name.startsWith('dsh-client-'))
  let scanned = 0
  for (const pkg of packages) {
    const clientPath = path.join(scopeDir, pkg, 'lib/client.js')
    if (!fs.existsSync(clientPath)) continue
    const source = fs.readFileSync(clientPath, 'utf8')
    scanned += 1
    for (const name of iconNames) {
      if (source.includes(name)) usage.get(name).push(pkg.replace(/^dsh-client-ui-/u, '').replace(/^dsh-client-/u, ''))
    }
  }
  log(`扫描 ${scanned} 个官方 client 包`)
  return usage
}

/**
 * 一个插件里「会去 primitives 取哪些名字」，按**取用组**分组。
 *
 * 两种写法都要认，缺一种就会漏检：
 * 1. 解构：`const { IconX, Switch } = require('…primitives')` —— 每个名字自成一组；
 * 2. 能力取用：`iconOf('IconXMedium', 'IconXRegular', 'IconX16')` —— 整条链是一组，
 *    只要**有一个**名字在当前构建里存在就算通过（旧发布线的名字本来就该缺失）。
 *
 * @param source - 插件 bundle 源码。
 * @returns `{ groups, members }`；groups 里每项是 `{ names, kind }`。
 */
function primitiveUsageGroups(source) {
  const groups = []
  const members = new Set()
  const imports = /const \{([^}]+)\} = require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u.exec(source)
  if (imports !== null) {
    for (const piece of imports[1].split(',')) {
      const name = piece.trim().split(':').pop().trim()
      if (name !== '') groups.push({ names: [name], kind: 'destructured' })
    }
  }
  for (const call of source.matchAll(/\biconOf\(\s*([^)]*)\)/gu)) {
    const names = [...call[1].matchAll(/'([A-Za-z0-9_$]+)'/gu)].map((match) => match[1])
    if (names.length > 0) groups.push({ names, kind: 'capability-chain' })
  }
  for (const access of source.matchAll(/\bprimitives\s*\.\s*([A-Za-z0-9_$]+)/gu)) groups.push({ names: [access[1]], kind: 'member-access' })
  for (const group of groups) for (const name of group.names) members.add(name)
  return { groups, members }
}

/** 工作区内各插件谁用了哪个图标（含「引用了但当前构建里没有」的情况，那是真 bug）。 */
function workspaceUsage(root, iconNames) {
  const usage = new Map(iconNames.map((name) => [name, []]))
  const missing = []
  const unknownMembers = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-')) continue
    const clientPath = path.join(root, entry.name, 'client.js')
    if (!fs.existsSync(clientPath)) continue
    const source = fs.readFileSync(clientPath, 'utf8')
    const { groups } = primitiveUsageGroups(source)
    if (groups.length === 0) continue
    for (const group of groups) {
      const icons = group.names.filter((name) => name.startsWith('Icon'))
      for (const name of group.names) {
        if (name.startsWith('Icon')) continue
        // 非图标成员（Button/Modal/Tooltip/…）另算：它们不在 icons 列表里，但确实存在
        if (!NON_ICON_MEMBERS.has(name)) unknownMembers.push({ plugin: entry.name, icon: name })
      }
      if (icons.length === 0) continue
      if (group.kind === 'capability-chain') {
        const present = icons.filter((name) => usage.has(name))
        if (present.length === 0) missing.push({ plugin: entry.name, icon: icons.join(' → ') })
        for (const name of present) usage.get(name).push(entry.name)
        continue
      }
      for (const name of icons) {
        if (!usage.has(name)) {
          missing.push({ plugin: entry.name, icon: name })
          continue
        }
        usage.get(name).push(entry.name)
      }
    }
  }
  return { usage, missing, unknownMembers }
}

// #endregion

// #region 产物

function tierCounts(icons) {
  const counts = {}
  for (const icon of icons) {
    const key = icon.tier === null ? 'unknown' : String(icon.tier)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function buildCatalog(root, log = () => {}) {
  const bundle = shellBundle(root)
  const { exports } = primitivesModule(bundle.source)
  const { icons, unrenderable, constantExports } = extractIcons(bundle.source, exports)
  log(`前端 chunk: ${bundle.name}`)
  log(`primitives 导出键: ${exports.size}，其中图标 ${icons.length}，常量导出 ${constantExports.length}`)
  if (unrenderable.length > 0) log(`未能渲染: ${unrenderable.map((item) => `${item.name}(${item.reason})`).join(', ')}`)

  const iconNames = icons.map((icon) => icon.name)
  const nonIcons = [...exports.keys()].filter((name) => !name.startsWith('Icon')).sort()
  NON_ICON_MEMBERS.clear()
  for (const name of nonIcons) NON_ICON_MEMBERS.add(name)

  const official = officialUsage(root, iconNames, log)
  const workspace = workspaceUsage(WORKSPACE_ROOT, iconNames)
  if (workspace.missing.length > 0) {
    log(`⚠️ 工作区插件引用了当前构建里不存在的图标：${workspace.missing.map((item) => `${item.plugin} → ${item.icon}`).join(', ')}`)
  }
  if (workspace.unknownMembers.length > 0) {
    log(`⚠️ 工作区插件引用了当前构建里不存在的模块成员：${workspace.unknownMembers.map((item) => `${item.plugin} → ${item.icon}`).join(', ')}`)
  }
  for (const icon of icons) {
    icon.usedBy = (official.get(icon.name) ?? []).sort()
    icon.usedByPlugins = (workspace.usage.get(icon.name) ?? []).sort()
  }

  return {
    generatedBy: `${TOOL_NAME}/build.js`,
    dsh: { package: '@deepseek-ai/dsh', version: dshVersion(root) },
    source: {
      module: '@deepseek-ai/dsh-client-ui-primitives',
      asset: `dist/assets/${bundle.name}`,
      sha1: crypto.createHash('sha1').update(bundle.source).digest('hex')
    },
    counts: { icons: icons.length, tiers: tierCounts(icons), nonIcons: nonIcons.length },
    // 提取脚本的自检结果。**生成时三项都必须为空**，非空说明提取本身出了问题
    // （曾经踩过：驼峰属性被连字符化，viewBox 变成无效的 view-box，图标丢掉缩放基准，
    //   预览里看着"图标偏到左上角"）。不在这里硬失败是因为未来 DSH 可能出现别的
    // 合法形态，交给 check.js 报出来由人判断。
    sanity: {
      iconsWithoutViewBox: icons.filter((icon) => icon.viewBox === '').map((icon) => icon.name),
      kebabCaseViewBox: icons.filter((icon) => icon.svg.includes('view-box=')).map((icon) => icon.name),
      iconKeysUnaccounted: [...exports.keys()]
        .filter((name) => name.startsWith('Icon'))
        .filter((name) => !icons.some((icon) => icon.name === name))
        .filter((name) => !unrenderable.some((item) => item.name === name))
        .sort()
    },
    // 工作区插件从 primitives 里取、但当前构建没有的成员。**生成时必须为空**：
    // 插件 require 到 undefined 的图标会静默渲染成空白，是最难查的一类回归。
    workspace: {
      missingIconImports: workspace.missing,
      unknownMemberImports: workspace.unknownMembers
    },
    note: '本文件由 tools/dsh-icons/build.js 生成，勿手工编辑；重新生成后请 review 差异再提交。',
    icons,
    nonIcons,
    unrenderable
  }
}

function previewHtml(catalog) {
  const data = JSON.stringify(catalog).replace(/</gu, '\\u003c')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>DSH 内置图标 · ${catalog.icons.length} 个（dsh ${catalog.dsh.version}）</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --card: #fff; --line: #e2e3e7; --text: #1c1c1e; --muted: #636366;
    --accent: #2b7fff; --accent-soft: #e6f0ff; --used: #eaf7ec; --used-text: #1d7a34;
    --warn: #fff0db; --warn-text: #b25a00;
  }
  body.dark { --bg: #16181c; --card: #202329; --line: #34383f; --text: #ededf0; --muted: #a1a1a6; --accent-soft: #1b2c47; --used: #1d3323; --used-text: #7ed492; --warn: #3a2a12; --warn-text: #ffb95e; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 24px 60px; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, "SF Pro Text", "PingFang SC", sans-serif; }
  h1 { font-size: 19px; margin: 0 0 6px; }
  .meta { color: var(--muted); font-size: 12px; margin: 0 0 16px; }
  .meta code { background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0 12px; background: linear-gradient(var(--bg) 70%, transparent); }
  input[type=search] { flex: 1 1 260px; min-width: 220px; height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); font: inherit; }
  input[type=search]:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  .group { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 9px; background: var(--card); }
  .group button { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
  .group button.on { background: var(--accent); color: #fff; }
  .count { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 12px; }
  .card { position: relative; margin: 0; padding: 14px 12px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; cursor: pointer; }
  .card:hover { border-color: var(--accent); }
  .card.copied { border-color: var(--used-text); }
  .glyph { width: var(--glyph, 32px); height: var(--glyph, 32px); display: flex; align-items: center; justify-content: center; color: var(--text); }
  .glyph svg { width: 100%; height: 100%; }
  .name { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; color: var(--text); }
  .badges { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; min-height: 16px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  body.dark .badge { color: #9ec5ff; }
  .badge.used { background: var(--used); color: var(--used-text); }
  .badge.tier { background: var(--warn); color: var(--warn-text); }
  .kw { font-size: 11px; color: var(--muted); min-height: 14px; }
  .used { font-size: 11px; color: var(--muted); }
  .warn { margin: 18px 0; padding: 10px 12px; border-radius: 8px; background: var(--warn); color: var(--warn-text); font-size: 12px; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%) translateY(12px); padding: 8px 14px; border-radius: 999px; background: #111; color: #fff; font-size: 13px; opacity: 0; transition: opacity .16s ease, transform .16s ease; pointer-events: none; }
  #toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  h2 { font-size: 15px; margin: 28px 0 10px; }
  ul.plain { columns: 3; margin: 0; padding-left: 18px; color: var(--muted); font: 12px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<h1>DSH 内置图标</h1>
<p class="meta">
  来源：已安装的 <code>@deepseek-ai/dsh@${catalog.dsh.version}</code> →
  <code>${catalog.source.asset}</code> 里 <code>__ModuleLoader__</code> seed 提供的
  <code>@deepseek-ai/dsh-client-ui-primitives</code> 冻结导出对象（sha1 <code>${catalog.source.sha1.slice(0, 12)}</code>）。
  <strong>它就是插件能 require 到的全集</strong>：没打进这个对象的图标，插件里 require 回来是 <code>undefined</code>（渲染成空白）。
  点击卡片复制图标名；<kbd>/</kbd> 聚焦搜索，<kbd>Esc</kbd> 清空。
  档位取名字后缀（官方图标集的分档，「同一行图标必须同档」按它判断）；若该图标的
  <code>viewBox</code> 与名字档位不一致，卡片上会多一个「画布 N」徽章——换图标前按真实尺寸看一眼。
</p>
<div class="bar">
  <input id="q" type="search" placeholder="搜索名字 / 中文关键词 / 使用方；多个词=同时包含（如「归档」「上下文」「tier-16」）" autocomplete="off">
  <span class="group" id="tierFilter"></span>
  <span class="group" id="sizeFilter"></span>
  <span class="group"><button id="themeToggle" type="button">深色背景</button></span>
  <span class="count" id="count"></span>
</div>
<div class="grid" id="grid"></div>
${catalog.unrenderable.length > 0 ? `<div class="warn">以下导出未能渲染（提取脚本的限制，不是 DSH 的问题）：${catalog.unrenderable.map((item) => `${item.name} — ${item.reason}`).join('；')}</div>` : ''}
<h2>同一模块导出的非图标成员（供参考）</h2>
<ul class="plain">${catalog.nonIcons.map((name) => `<li>${name}</li>`).join('')}</ul>
<div id="toast"></div>
<script>
const catalog = ${data}
const state = { query: '', tier: 'all', size: 32, dark: false }
const grid = document.getElementById('grid')
const count = document.getElementById('count')
const toast = document.getElementById('toast')
let toastTimer = null

function notify(text) {
  toast.textContent = text
  toast.classList.add('on')
  if (toastTimer !== null) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('on'), 1400)
}

function matches(icon) {
  if (state.tier !== 'all' && String(icon.tier) !== state.tier) return false
  const query = state.query.trim().toLowerCase()
  if (query === '') return true
  const haystack = [icon.name, icon.keywords.join(' '), icon.usedBy.join(' '), icon.usedByPlugins.join(' '), icon.tier === null ? '' : 'tier-' + icon.tier]
    .join(' ')
    .toLowerCase()
  return query.split(/\\s+/u).every((token) => haystack.includes(token))
}

function render() {
  const shown = catalog.icons.filter(matches)
  grid.innerHTML = ''
  document.documentElement.style.setProperty('--glyph', state.size + 'px')
  for (const icon of shown) {
    const card = document.createElement('figure')
    card.className = 'card'
    card.title = icon.name + '（点击复制）'
    const glyph = document.createElement('div')
    glyph.className = 'glyph'
    glyph.innerHTML = icon.svg
    const name = document.createElement('figcaption')
    name.className = 'name'
    name.textContent = icon.name
    const badges = document.createElement('div')
    badges.className = 'badges'
    if (icon.tier !== null) {
      const tier = document.createElement('em')
      tier.className = 'badge tier'
      tier.textContent = icon.tier + ' 档'
      badges.appendChild(tier)
    }
    // 名字档位与真实画布不一致时标出来（实测确有这种图标）
    if (icon.sizeMismatch === true && icon.canvasSize !== null) {
      const mismatch = document.createElement('em')
      mismatch.className = 'badge'
      mismatch.textContent = '画布 ' + icon.canvasSize.width
      mismatch.title = '名字写 ' + icon.tier + ' 档，viewBox 却是 ' + icon.canvasSize.width + '×' + icon.canvasSize.height
      badges.appendChild(mismatch)
    }
    if (icon.usedBy.length > 0) {
      const used = document.createElement('em')
      used.className = 'badge used'
      used.textContent = '官方在用'
      badges.appendChild(used)
    }
    const keywords = document.createElement('div')
    keywords.className = 'kw'
    keywords.textContent = icon.keywords.join(' / ')
    const usedBy = document.createElement('div')
    usedBy.className = 'used'
    const parts = []
    if (icon.usedBy.length > 0) parts.push('官方：' + icon.usedBy.join(', '))
    if (icon.usedByPlugins.length > 0) parts.push('本工作区：' + icon.usedByPlugins.join(', '))
    usedBy.textContent = parts.join(' · ')
    card.append(glyph, name, badges, keywords, usedBy)
    card.addEventListener('click', async () => {
      const text = icon.name
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        const range = document.createRange()
        range.selectNodeContents(name)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      }
      card.classList.add('copied')
      setTimeout(() => card.classList.remove('copied'), 800)
      notify('已复制 ' + text)
    })
    grid.appendChild(card)
  }
  const total = catalog.icons.length
  count.textContent = shown.length === total ? '共 ' + total + ' 个' : '筛出 ' + shown.length + ' / ' + total + ' 个'
}

function buildFilters() {
  const tiers = ['all', ...Object.keys(catalog.counts.tiers).filter((key) => key !== 'unknown').sort((a, b) => Number(a) - Number(b))]
  const tierHost = document.getElementById('tierFilter')
  for (const tier of tiers) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = tier === 'all' ? '全部档位' : tier + ' 档'
    button.className = tier === state.tier ? 'on' : ''
    button.addEventListener('click', () => {
      state.tier = tier
      for (const sibling of tierHost.children) sibling.className = ''
      button.className = 'on'
      render()
    })
    tierHost.appendChild(button)
  }
  const sizeHost = document.getElementById('sizeFilter')
  for (const size of [16, 24, 32, 48]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = size + 'px'
    button.className = size === state.size ? 'on' : ''
    button.addEventListener('click', () => {
      state.size = size
      for (const sibling of sizeHost.children) sibling.className = ''
      button.className = 'on'
      render()
    })
    sizeHost.appendChild(button)
  }
  const theme = document.getElementById('themeToggle')
  theme.addEventListener('click', () => {
    state.dark = !state.dark
    document.body.classList.toggle('dark', state.dark)
    theme.className = state.dark ? 'on' : ''
    theme.textContent = state.dark ? '浅色背景' : '深色背景'
  })
}

document.getElementById('q').addEventListener('input', (event) => {
  state.query = event.target.value
  render()
})
document.addEventListener('keydown', (event) => {
  if (event.key === '/') {
    event.preventDefault()
    document.getElementById('q').focus()
  }
  if (event.key === 'Escape') {
    const input = document.getElementById('q')
    input.value = ''
    state.query = ''
    input.blur()
    render()
  }
})
buildFilters()
render()
</script>
</body>
</html>
`
}

// #endregion

function main(argv) {
  const explicitIndex = argv.indexOf('--dsh')
  const root = locateDshRoot(explicitIndex === -1 ? undefined : argv[explicitIndex + 1])
  const log = (line) => console.log(`${TOOL_NAME}: ${line}`)
  log(`DSH ${dshVersion(root)} @ ${root}`)

  const catalog = buildCatalog(root, log)
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`)
  fs.writeFileSync(PREVIEW_PATH, previewHtml(catalog))
  log(`写出 ${path.relative(WORKSPACE_ROOT, CATALOG_PATH)}（${catalog.counts.icons} 个图标，${Object.entries(catalog.counts.tiers).map(([tier, amount]) => `${tier} 档 ${amount}`).join('、')}）`)
  log(`写出 ${path.relative(WORKSPACE_ROOT, PREVIEW_PATH)}`)
  log(`打开预览：open ${path.relative(WORKSPACE_ROOT, PREVIEW_PATH)}`)
}

module.exports = { locateDshRoot, dshVersion, shellBundle, primitivesModule, definitionOf, extractIcons, serializeSvg, buildCatalog, previewHtml, WORKSPACE_ROOT, CATALOG_PATH, PREVIEW_PATH, TOOL_NAME }

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`${TOOL_NAME}: ${error.message}`)
    process.exitCode = 1
  }
}
