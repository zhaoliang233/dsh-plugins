/**
 * 默认设置覆盖：可覆盖项的白名单与纯计算逻辑。
 *
 * 契约（由 2026-09-28 的隔离探针实测得出，详见 AGENTS.md）：
 * - profile patch 里的条目 config 是**整块替换**，不是深合并；插件的 Config
 *   schema 又多以 `.required()` 声明字段，所以任何"只写一个字段"的覆盖都会让
 *   目标插件加载失败（fiber.state = 3），且此时 configEditor 拒绝服务、修不回来。
 *   → 本插件写覆盖时**永远写完整配置块**。
 * - 恢复默认 = 把候选值还原成继承层；当候选值与继承层完全相等时，configEditor
 *   会自动删掉 patch 里的整个 config（只剩 id/name 时连行一起删）。
 *   → 恢复单个字段时不能整块退回继承层，否则会顺手抹掉用户手写的其它字段；
 *   必须"只把该字段设回继承值，其余字段保持现状"。
 */

export const PLUGIN_NAME = 'dsh-default-tuner'

/** 状态接口路径。 */
export const STATUS_PATH = '/dsh-default-tuner/status'
/** 写入接口路径。 */
export const ACTION_PATH = '/dsh-default-tuner/action'
/** 浏览器侧标记头：与同源校验一起挡住非页面来源的请求。 */
export const CLIENT_HEADER = 'x-dsh-default-tuner-client'
/** CSRF 头：值来自 status 响应下发的令牌。 */
export const CSRF_HEADER = 'x-dsh-default-tuner-csrf'

/**
 * 可覆盖项白名单：每一项就是设置页上的一个模块。新增默认值只需往这里加条目，
 * 客户端页面与两端校验都由这份表驱动。
 */
/** 白名单条目：entry 是 profile 条目 id，fields 是该插件允许覆盖的字段。 */
export const ENTRIES = [
  {
    id: 'session-title-llm',
    name: '@deepseek-ai/dsh-session-title-first-prompt-llm',
    title: '模型命名（session-title-llm）',
    description: '模型命名用的路由与长度策略。输入上限是"静默失败"的主要来源：超过上限时不会调用模型，只有兜底标题。',
    fields: [
      {
        path: 'maxInputBytes',
        label: '输入上限',
        unit: '字节',
        min: 1,
        hint: '首条消息（含 JSON 框架）超过这个字节数就不调用模型，直接留兜底标题。默认 4096。'
      },
      {
        path: 'maxOutputTokens',
        label: '输出上限',
        unit: 'token',
        min: 1,
        hint: '标题很短，通常不必调大。默认 64。'
      },
      {
        path: 'timeoutMs',
        label: '生成超时',
        unit: '毫秒',
        min: 1,
        hint: '超过这个时间就放弃模型命名。默认 60000。'
      },
      {
        path: 'targetWords',
        label: '目标词数',
        unit: '词',
        min: 1,
        hint: '非中文标题的目标长度。默认 5。'
      },
      {
        path: 'targetCjkCharacters',
        label: '目标字数',
        unit: '字',
        min: 1,
        hint: '中文标题的目标长度。默认 10。'
      }
    ]
  },
  {
    id: 'session-title',
    name: '@deepseek-ai/dsh-session-title',
    title: '标题长度与兜底（session-title）',
    description: '标题字节上限决定最终存储的标题有多长；兜底参数决定模型命名失败后显示什么。',
    fields: [
      {
        path: 'maxTitleBytes',
        label: '标题最大字节',
        unit: '字节',
        min: 1,
        hint: '任何来源的标题都会被截到这个字节数以内。默认 80。'
      },
      {
        path: 'fallbackMaxWords',
        label: '兜底词数',
        unit: '词',
        min: 1,
        hint: '模型命名失败时取首条消息的前若干个词。默认 5。'
      },
      {
        path: 'fallbackMaxBytes',
        label: '兜底字节',
        unit: '字节',
        min: 1,
        hint: '兜底标题的字节上限，不能超过标题最大字节。默认 40。'
      }
    ]
  }
]

/** 按条目 id 取白名单定义。 */
export function entryDefinition(entryId) {
  return ENTRIES.find((entry) => entry.id === entryId)
}

/** 按条目 id + 字段名取字段定义。 */
export function fieldDefinition(entryId, path) {
  return entryDefinition(entryId)?.fields.find((field) => field.path === path)
}

/** 是不是纯对象（配置块判定用）。 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 计算"覆盖一个字段"的候选完整配置。
 * @param current - 目标条目当前的生效配置（来自 Loader）。
 * @param path - 白名单字段名。
 * @param value - 已校验的新值。
 * @returns 传给 configEditor.edit 的候选配置（浅拷贝，不改动入参）。
 */
export function planFieldWrite(current, path, value) {
  if (!isPlainObject(current)) throw new TypeError('当前配置不是对象，无法覆盖')
  return { ...current, [path]: value }
}

/**
 * 计算"恢复一个字段"的候选完整配置：只把该字段退回继承层的值，其余字段保持现状，
 * 这样用户手写的其它覆盖不会被顺手抹掉。整块恰好等于继承层时由 configEditor 自动删块。
 * @param current - 目标条目当前的生效配置。
 * @param inherited - 该条目剔除 profile 覆盖后的值。
 * @param path - 白名单字段名。
 * @returns 候选完整配置。
 */
export function planFieldReset(current, inherited, path) {
  if (!isPlainObject(current)) throw new TypeError('当前配置不是对象，无法恢复默认')
  if (!isPlainObject(inherited)) throw new TypeError('继承层不是对象，无法恢复默认')
  if (!Object.hasOwn(inherited, path)) throw new Error(`字段 "${path}" 没有可回退的默认值`)
  return { ...current, [path]: inherited[path] }
}

/**
 * 校验一个白名单字段的新值。
 * @param entryId - 白名单条目 id。
 * @param path - 字段名。
 * @param raw - 客户端提交的原始值。
 * @returns 归一化后的值。
 * @throws 当值不是整数、小于最小值、或该字段不在白名单时。
 */
export function normalizeFieldValue(entryId, path, raw) {
  const field = fieldDefinition(entryId, path)
  if (field === undefined) throw new Error(`字段 "${entryId}.${path}" 不在可覆盖白名单里`)
  const value = typeof raw === 'string' ? Number(raw.trim()) : raw
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`字段 "${path}" 需要整数`)
  if (value < field.min) throw new Error(`字段 "${path}" 不能小于 ${String(field.min)}`)
  return value
}

/** 条目的可用状态：能不能写、为什么不能写。 */
export function entryAvailability(entry) {
  if (entry === undefined) return { writable: false, reason: 'missing', message: '当前 profile 里没有这个条目' }
  if (entry.fiber === undefined || entry.fiber.runtime === null || entry.fiber.runtime === undefined) {
    return { writable: false, reason: 'inactive', message: '条目没有活动的 fiber，暂时不能写入' }
  }
  if (entry.fiber.state !== 2) {
    return {
      writable: false,
      reason: 'failed',
      message: '条目加载失败或正在重载：常见原因是 profile patch 里手写了不完整的 config（字段缺 required 项），需要先在 patch 里补全或删掉该覆盖'
    }
  }
  return { writable: true, reason: 'active', message: '' }
}

/** 从 configEditor.configuration() 的一行里抽出客户端要的字段状态。 */
export function describeEntryFields(row) {
  const definition = entryDefinition(row.entry.options.id)
  if (definition === undefined) return undefined
  const inherited = isPlainObject(row.inherited) ? row.inherited : {}
  const override = isPlainObject(row.override) ? row.override : {}
  const current = isPlainObject(row.entry.options.config) ? row.entry.options.config : {}
  return {
    id: definition.id,
    name: definition.name,
    title: definition.title,
    description: definition.description,
    availability: entryAvailability(row.entry),
    fields: definition.fields.map((field) => {
      const overrideValue = Object.hasOwn(override, field.path) ? override[field.path] : undefined
      return {
        path: field.path,
        label: field.label,
        unit: field.unit,
        hint: field.hint,
        min: field.min,
        default: inherited[field.path],
        override: overrideValue,
        // 补丁是整块替换：保存一个字段会把整个 config 写进补丁，其余字段的值与默认值相同。
        // 它们同样是"覆盖项"，但对用户来说不是"我改过的东西"，展示上必须分开。
        frozenSameAsDefault: overrideValue !== undefined && overrideValue === inherited[field.path],
        effective: current[field.path]
      }
    })
  }
}

/**
 * 汇总 status 响应里的白名单部分。
 * @param rows - configEditor.configuration() 的结果。
 */
export function describeWhitelist(rows) {
  return ENTRIES.map((definition) => {
    const row = rows.find((item) => item.entry.options.id === definition.id)
    if (row === undefined) {
      return {
        id: definition.id,
        name: definition.name,
            title: definition.title,
        description: definition.description,
        availability: entryAvailability(undefined),
        fields: definition.fields.map((field) => ({
          path: field.path,
          label: field.label,
          unit: field.unit,
          hint: field.hint,
          min: field.min,
          default: undefined,
          override: undefined,
          frozenSameAsDefault: false,
          effective: undefined
        }))
      }
    }
    return describeEntryFields(row)
  })
}

/** 高级模式：所有条目的覆盖概览（只读 + 整块重置用）。 */
export function describeAdvanced(rows) {
  return rows
    .map((row) => {
      const override = isPlainObject(row.override) ? row.override : {}
      const paths = Object.keys(override)
      if (paths.length === 0) return undefined
      const availability = entryAvailability(row.entry)
      return {
        id: row.entry.options.id,
        name: row.entry.options.name ?? '',
        managed: entryDefinition(row.entry.options.id) !== undefined,
        paths,
        availability
      }
    })
    .filter((item) => item !== undefined)
    .sort((left, right) => (left.id < right.id ? -1 : 1))
}

/**
 * 官方 `dsh-session-title-llm` 给标题模型的实际输入前缀。
 * 逐字对齐它的 `frameMessages()`：预检算出的字节数必须和 provider 的检查口径一致，
 * 否则会出现"列表说能重算、点了却报 input is N bytes"的假阳性。
 */
export const TITLE_INPUT_PREFIX = 'Generate the session title from this JSON array of human messages:\n'

/**
 * 按官方口径算"标题模型输入"的字节数（框架前缀 + JSON 包装后的完整输入）。
 * @param seq - 首条用户消息在会话里的 seq。
 * @param text - 该消息的纯文本。
 * @returns UTF-8 字节数。
 */
export function titleInputBytes(seq, text) {
  return Buffer.byteLength(TITLE_INPUT_PREFIX + JSON.stringify([{ seq, text }]), 'utf8')
}

/**
 * 给"输入超限"的会话建议一个够用的上限：向上取整到 1024 的倍数。
 * @param bytes - 该会话首条消息的框架后字节数。
 * @returns 建议的 maxInputBytes。
 */
export function suggestedMaxInputBytes(bytes) {
  return Math.max(1024, Math.ceil(bytes / 1024) * 1024)
}

/** 取路径的最后一段作为展示名：/Users/…/dsh-plugins → dsh-plugins。 */
export function baseName(path) {
  if (typeof path !== 'string' || path === '') return ''
  const parts = path.split('/').filter((part) => part !== '')
  return parts.length === 0 ? path : parts[parts.length - 1]
}

/** 标题来源的中文标签：会话列表用它说明"这个标题是怎么来的"。 */
export function describeTitleSource(source) {
  switch (source?.kind) {
    case 'provider':
      return { kind: 'provider', label: '模型命名' }
    case 'fallback':
      return { kind: 'fallback', label: '兜底截断（模型命名未成功）' }
    case 'user':
      return { kind: 'user', label: '手动命名' }
    default:
      return { kind: 'none', label: '还没有标题' }
  }
}

/**
 * 把 live 会话与它的标题快照整理成客户端行数据。
 * @param session - SessionStore 里的会话对象（只用 id 与 header）。
 * @param title - `sessionTitle.get(session)` 的返回值，可能是 undefined。
 * @param input - 首条用户消息的框架后字节数与该条目的生效上限，拿不到时传 null。
 */
export function describeSessionEntry(session, title, input = null) {
  const source = describeTitleSource(title?.source)
  const header = isPlainObject(session?.header) ? session.header : {}
  const id = typeof session?.id === 'string' ? session.id : ''
  const inputBytes = typeof input?.bytes === 'number' ? input.bytes : undefined
  const inputLimit = typeof input?.limit === 'number' ? input.limit : undefined
  // 上限拿不到时不做判定：宁可不提示，也不要把能重算的会话错标成超限。
  const overLimit = inputBytes !== undefined && inputLimit !== undefined && inputBytes > inputLimit
  return {
    id,
    shortId: id.slice(-12),
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    /** 只给列表显示用的工作区名（完整路径留在 cwd 里，供悬停提示）。 */
    cwdName: baseName(typeof header.cwd === 'string' ? header.cwd : ''),
    title: typeof title?.title === 'string' ? title.title : '',
    sourceKind: source.kind,
    sourceLabel: source.label,
    // 手动命名会被重算覆盖，客户端需要先确认。
    overwritesManual: source.kind === 'user',
    updatedAt: typeof title?.updatedAt === 'number'
      ? title.updatedAt
      : typeof header.createdAt === 'number' ? header.createdAt : 0,
    /** 首条用户消息（框架后）的字节数；空会话或拿不到投影时为 undefined。 */
    inputBytes,
    /** 该条目当前生效的 maxInputBytes；拿不到时为 undefined。 */
    inputLimit,
    /** 首条消息已经超过上限：这种会话重算必然失败，界面要提前说清楚。 */
    overLimit,
    /** overLimit 时建议写进配置的上限值。 */
    suggestedLimit: overLimit ? suggestedMaxInputBytes(inputBytes) : undefined
  }
}

/**
 * 按最近活动排序并截断，避免把大量活跃会话全塞进一次响应。
 * @param entries - describeSessionEntry 的结果。
 * @param limit - 最多返回多少行。
 */
export function sortAndLimitSessions(entries, limit = 20) {
  return entries
    .slice()
    .sort((left, right) => (right.updatedAt - left.updatedAt) || (left.id < right.id ? -1 : 1))
    .slice(0, limit)
}

/**
 * 挑出真正需要重算标题的会话：只有"兜底截断"那一类。
 *
 * 规则（用户 2026-09-28 定）：
 * - 模型成功命名（provider）或用户手动命名（user）→ 不进列表；
 * - 兜底截断（fallback：模型命名失败 / 输入超限 / 无凭证留下的截断标题）→ 进列表，允许重算；
 * - 重算成功后标题来源变成 provider，于是自然从列表消失，之后也不再出现；
 * - 还没有标题的会话同样不进列表：没有首条消息时重算无事可做。
 * @param entries - describeSessionEntry 的结果。
 */
export function selectRetitleCandidates(entries) {
  return entries.filter((entry) => entry.sourceKind === 'fallback')
}

/**
 * 会话列表的统计口径，供页面说明"为什么只看到这些"。
 * @param entries - 全部活跃会话的 describeSessionEntry 结果。
 */
export function summarizeSessions(entries) {
  const candidates = selectRetitleCandidates(entries)
  return {
    total: entries.length,
    needRetitle: candidates.length,
    // 其中"首条消息本身就超限"的那些：不是模型的问题，是上限比消息还小。
    overLimit: candidates.filter((entry) => entry.overLimit === true).length
  }
}
