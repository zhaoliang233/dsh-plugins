/**
 * 额外上下文的纯逻辑层：规则分段、渲染与预算计算。
 *
 * 本模块只依赖 Node 内置能力，不 import 任何 @deepseek-ai/* 包，
 * 也不触碰 Cordis 服务，因此可以在 `node --test` 下独立验证。
 * 宿主入口 (lib/index.js) 负责把它接到 systemPrompt / settings / tools / commands 上。
 *
 * @module dsh-extra-context/rules
 */

/** 插件名。与 package.json 的 name 一致，也是 profile 里的行 id。 */
export const PLUGIN_NAME = 'dsh-extra-context'
/** settings 命名空间；写入 $DSH_HOME/settings.yaml 的 `extra-context:` 段。 */
export const SETTINGS_NAMESPACE = 'extra-context'
/** 全局 system prompt section 名。同名 scoped section 可覆盖它（本插件不注册 scoped 版本）。 */
export const SECTION_NAME = 'deployment:extra-context'
/**
 * section 排序位：人格段是 0，第一个官方工具段是 1000。
 * 取 204 落在两者之间的空档，既不与官方 SECTION_ORDERS 冲突，
 * 也保证位置稳定（人格之后、工具说明之前）。
 */
export const SECTION_ORDER = 204
/** 默认软预算（字节，按 UTF-8 计）。超过只告警，不阻止保存。 */
export const DEFAULT_MAX_BYTES = 8192
/** 设置默认值。宿主用它作为 settings 命名空间的 base 层与 fallback。 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  // 刻意留空：新安装不该凭空出现一条无法删除的"长期偏好"。
  segments: [],
  maxBytes: DEFAULT_MAX_BYTES
})

/** 一段文本的 UTF-8 字节数。 */
export function byteLength(text) {
  return Buffer.byteLength(typeof text === 'string' ? text : '', 'utf8')
}

/**
 * 粗略的中英混排 token 估算：CJK 字符约 1 token/字，其余按 4 字符 1 token。
 * 只用于设置页展示量级，不参与任何硬性判断。
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const value = typeof text === 'string' ? text : ''
  if (value === '') return 0
  const cjk = (value.match(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/gu) ?? []).length
  const rest = value.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/**
 * 生成一把未被占用的分段 id。
 *
 * id 只是一把稳定的键：分段没有名称之后（`label` 字段已从设置 schema 与界面移除），
 * 它不再从任何文本派生，固定基名 `segment`，冲突时依次退让到 `segment-2`、`segment-3`…
 * @param {Iterable<string>} takenIds 已被占用的 id
 * @returns {string}
 */
export function createSegmentId(takenIds = []) {
  const taken = takenIds instanceof Set ? takenIds : new Set(takenIds)
  const base = 'segment'
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${String(Date.now())}`
}

/**
 * 规范化一个分段：只保留已知字段并修正类型，避免外部编辑进来的脏数据
 * 在渲染时把整次 prompt 组装弄崩。
 *
 * 分段只有 id / enabled / text；老数据里残留的 `label`（已移除的分段名称）
 * 在这里被丢弃，不再进入状态接口与渲染路径。
 * @param {unknown} value
 * @param {number} index
 * @returns {{id: string, enabled: boolean, text: string}}
 */
export function normalizeSegment(value, index = 0) {
  const record = value !== null && typeof value === 'object' ? value : {}
  const id = typeof record.id === 'string' && record.id.trim() !== '' ? record.id.trim() : `segment-${String(index + 1)}`
  return {
    id,
    enabled: record.enabled !== false,
    text: typeof record.text === 'string' ? record.text : ''
  }
}

/**
 * 规范化整个设置值并补默认值。渲染与状态查询都先过这里，
 * 保证任一入口拿到的都是同一形状。
 * @param {unknown} value
 * @returns {{enabled: boolean, segments: ReadonlyArray<ReturnType<typeof normalizeSegment>>, maxBytes: number}}
 */
export function normalizeSettings(value) {
  const record = value !== null && typeof value === 'object' ? value : {}
  const rawSegments = Array.isArray(record.segments) ? record.segments : DEFAULT_SETTINGS.segments
  const segments = rawSegments.map((segment, index) => normalizeSegment(segment, index))
  const seen = new Set()
  const deduped = segments.map((segment) => {
    if (!seen.has(segment.id)) {
      seen.add(segment.id)
      return segment
    }
    const id = createSegmentId(seen)
    seen.add(id)
    return { ...segment, id }
  })
  const maxBytes = Number.isFinite(record.maxBytes) && Number(record.maxBytes) > 0 ? Math.trunc(Number(record.maxBytes)) : DEFAULT_MAX_BYTES
  return {
    enabled: record.enabled !== false,
    segments: deduped,
    maxBytes
  }
}

/**
 * 参与渲染的分段：启用且文本非空，按它们在设置里的先后顺序。
 *
 * 顺序即数组顺序——界面不再提供排序，order 字段已随排序功能一并移除。
 * @param {unknown} value 规范化前的设置值
 * @returns {ReadonlyArray<ReturnType<typeof normalizeSegment>>}
 */
export function effectiveSegments(value) {
  const settings = normalizeSettings(value)
  return settings.segments.filter((segment) => segment.enabled && segment.text.trim() !== '')
}

const SECTION_HEADING = `以下内容由用户在 ${PLUGIN_NAME} 中配置，对本会话与全部子代理持续有效。`

/**
 * 渲染最终进入 system prompt 的文本。
 *
 * 注意：本函数在每次 prompt 组装时被调用，任何异常都会让模型请求失败，
 * 所以它只做防御性读取，绝不抛错——脏数据退化为空串而不是崩溃。
 *
 * 用户文本里的 `{{...}}` **原样保留**：注册 section 时声明了官方
 * `interpolate: false`（见 `lib/index.js`），`renderPrompt()` 对该段不做变量插值，
 * 因此不需要再中和。**别再退回"把 `{{` 拆成 `{`+零宽空格+`{`"的老做法**——
 * 那会让模型看到零宽字符，而且一旦插值行为变化就会静默失效。
 * 改动这里时务必保留 `interpolate: false`，`test/host.test.js` 有守卫。
 * @param {unknown} value 设置值
 * @returns {string} 空串表示本次不贡献任何 prompt 文本
 */
export function renderExtraContext(value) {
  const settings = normalizeSettings(value)
  if (!settings.enabled) return ''
  const segments = effectiveSegments(settings)
  if (segments.length === 0) return ''
  const parts = [SECTION_HEADING, '--- 额外上下文开始 ---']
  // 只渲染正文：分段名称是界面上的编辑概念，不该出现在给模型看的上下文里
  // （用户也无法管理名称，模型看到一个凭空出现的标题只会增加噪声）。
  for (const segment of segments) parts.push(segment.text.trim())
  parts.push('--- 额外上下文结束 ---')
  return parts.join('\n\n')
}

/**
 * 组装设置页需要的状态视图：生效文本、分段明细、预算用量。
 * @param {unknown} value 设置值
 * @param {{ sectionOrder?: number }} [options]
 * @returns {object} 可直接 JSON 序列化的状态对象
 */
export function buildStatus(value, options = {}) {
  const settings = normalizeSettings(value)
  const rendered = renderExtraContext(settings)
  const segments = settings.segments
    .map((segment) => ({
      id: segment.id,
      enabled: segment.enabled,
      text: segment.text,
      bytes: byteLength(segment.text),
      effective: segment.enabled && segment.text.trim() !== ''
    }))
  const bytes = byteLength(rendered)
  const maxBytes = settings.maxBytes
  return {
    enabled: settings.enabled,
    sectionName: SECTION_NAME,
    sectionOrder: Number.isFinite(options.sectionOrder) ? options.sectionOrder : SECTION_ORDER,
    bytes,
    estimatedTokens: estimateTokens(rendered),
    maxBytes,
    overBudget: bytes > maxBytes,
    source: rendered === '' ? 'none' : 'segments',
    segments,
    rendered
  }
}


