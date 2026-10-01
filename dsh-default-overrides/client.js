window.__ModuleLoader__.load({
  id: 'dsh-default-overrides',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    /**
     * 取官方图标/控件，按**能力**而不是按版本号：图标名在发布线之间改过命名法
     * （0.1.6 是数字档位、0.1.7 换成档位词），所以按顺序取第一个真实存在的导出；
     * 全都缺失时退化成原生标签或空组件，绝不让整个 bundle 因为一个名字消失而挂掉。
     * @param names - 候选导出名，从最新命名往后排。
     */
    function exportOf(...names) {
      for (const name of names) {
        const candidate = primitives?.[name]
        if (typeof candidate === 'function' || (candidate !== null && typeof candidate === 'object')) return candidate
      }
      return undefined
    }
    /** 折叠指示三角：与 DSH 自带折叠行同一个图标。 */
    const DisclosureIcon = exportOf('IconTriangleRightFillMedium', 'IconTriangleRightFillRegular', 'IconTriangleRightFill')
    /** 官方控件；缺失时退化成原生元素，页面仍可用。 */
    const Button = exportOf('Button') ?? 'button'
    const Input = exportOf('Input') ?? 'input'
    const OfficialTag = exportOf('Tag')

    const STATUS_PATH = '/dsh-default-overrides/status'
    const ACTION_PATH = '/dsh-default-overrides/action'
    const CLIENT_HEADER = 'x-dsh-default-overrides-client'
    const CSRF_HEADER = 'x-dsh-default-overrides-csrf'
    /** 设置导航里的分区名。 */
    const SECTION_LABEL = '默认设置覆盖'
    /** 插件分区一律排在 DSH 自带项之后（用户规则），同仓库其它插件用 100，这里 110 避免同档撞车。 */
    const SECTION_ORDER = 110
    const PLUGIN_ID = 'dsh-default-overrides'

    /**
     * 自己注入的 `<style>` 必须打 `data-plugin` 标记：`dsh-client-modules` 会把
     * 未打标记的样式认领给"下一个 materialize 的 bundle"，热更新时就会删错人。
     */
    function installStyles(ctx) {
      const css = `
.ddo-root { display: flex; flex-direction: column; gap: 12px; font-size: 13px; color: inherit; }
.ddo-title { font-size: 15px; font-weight: 600; }
.ddo-intro { opacity: .72; line-height: 1.6; }
.ddo-meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; opacity: .55; word-break: break-all; }
.ddo-notice { border-radius: 8px; padding: 8px 10px; line-height: 1.6; font-size: 12px; }
.ddo-notice-warn { background: rgba(219, 154, 4, .14); border: 1px solid rgba(219, 154, 4, .35); }
.ddo-notice-error { background: rgba(219, 68, 55, .14); border: 1px solid rgba(219, 68, 55, .35); }
.ddo-notice-ok { background: rgba(46, 160, 67, .14); border: 1px solid rgba(46, 160, 67, .35); }
.ddo-module { border: 1px solid rgba(128, 128, 128, .28); border-radius: 10px; overflow: hidden; }
.ddo-module > summary { display: flex; align-items: center; padding: 10px 12px; cursor: pointer; user-select: none; list-style: none; }
/* 关掉浏览器自带的 marker：箭头改用 DSH 自带图标（IconTriangleRightFill…）。 */
.ddo-module > summary::-webkit-details-marker { display: none; }
.ddo-module > summary::marker { content: ''; }
.ddo-module > summary:hover { background: rgba(128, 128, 128, .1); }
.ddo-chevron { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; transition: transform .15s var(--ds-ease-in-out, ease); }
.ddo-module[open] > summary .ddo-chevron { transform: rotate(90deg); }
.ddo-summary-inner { display: inline-flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; }
.ddo-card-title { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ddo-card-tags { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.ddo-card-body { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.ddo-card-desc { opacity: .7; line-height: 1.55; font-size: 12px; }
.ddo-tag-wrap { flex: none; display: inline-flex; align-items: center; }
/* 下面几条只在官方 Tag 缺失时兜底生效（官方组件自带自己的类名，不会命中这里）。 */
.ddo-tag { display: inline-flex; align-items: center; flex: none; white-space: nowrap; padding: 1px 7px; border-radius: 999px; font-size: 11px; line-height: 16px; border: 1px solid transparent; }
.ddo-tag-accent { background: rgba(64, 128, 255, .16); border-color: rgba(64, 128, 255, .38); color: rgb(88, 145, 255); }
.ddo-tag-muted { background: rgba(128, 128, 128, .14); border-color: rgba(128, 128, 128, .28); opacity: .8; }
.ddo-tag-warn { background: rgba(219, 154, 4, .16); border-color: rgba(219, 154, 4, .38); }
.ddo-tag-error { background: rgba(219, 68, 55, .16); border-color: rgba(219, 68, 55, .38); }
.ddo-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px dashed rgba(128, 128, 128, .22); }
.ddo-row:first-of-type { border-top: 0; }
.ddo-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ddo-row-label { flex: none; font-weight: 500; }
.ddo-row-unit { flex: none; opacity: .55; font-size: 11px; }
.ddo-row-values { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; opacity: .6; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.ddo-row-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 只约束布局与宽度；外观（边框、焦点环、禁用态）交给官方 Input / Button。 */
.ddo-input { width: 150px; }
.ddo-button { flex: none; white-space: nowrap; }
.ddo-hint { opacity: .6; font-size: 11px; line-height: 1.5; }
.ddo-details-body { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 12px; }
.ddo-item-row { display: flex; align-items: center; gap: 10px; }
.ddo-item-text { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; opacity: .75; word-break: break-all; line-height: 1.5; }
.ddo-empty { opacity: .6; font-size: 12px; }
`
      const existing = document.querySelector(`style[data-plugin="${PLUGIN_ID}"]`)
      if (existing !== null) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin', PLUGIN_ID)
      style.textContent = css
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() })
    }

    function keyOf(entryId, path) {
      return `${entryId}.${path}`
    }

    /** 默认值可能因为条目缺失而拿不到，显示成"未知"而不是 undefined。 */
    function displayValue(value) {
      return value === undefined || value === null ? '未知' : String(value)
    }
    /** 列表里显示的工作区名：宿主给了 cwdName 就用它，旧宿主下自己从路径截。 */
    function workspaceLabel(row) {
      if (typeof row.cwdName === 'string' && row.cwdName !== '') return row.cwdName
      if (typeof row.cwd !== 'string' || row.cwd === '') return ''
      const parts = row.cwd.split('/').filter((part) => part !== '')
      return parts.length === 0 ? row.cwd : parts[parts.length - 1]
    }

    /** 字节数口语化：4697 → 4.6 KB。 */
    function formatBytes(value) {
      if (typeof value !== 'number') return '未知'
      if (value < 1024) return `${String(value)} B`
      return `${(value / 1024).toFixed(1)} KB`
    }

    /** 本地语义色 → 官方 Tag tone。 */
    const TAG_TONES = { accent: 'info', muted: 'neutral', warn: 'warning', error: 'danger' }

    /**
     * 状态类文案统一用 Tag 呈现：优先用官方 `Tag` 组件（色调交由它决定），
     * 组件缺失时退化成自绘标签。`title`（悬停说明）挂在外面那层，因为官方 Tag 只接收 tone/className/children。
     */
    function Tag({ kind = 'muted', title, children }) {
      if (OfficialTag !== undefined) {
        return React.createElement('span', { className: 'ddo-tag-wrap', title }, React.createElement(OfficialTag, { tone: TAG_TONES[kind] ?? 'neutral' }, children))
      }
      return React.createElement('span', { className: `ddo-tag ddo-tag-${kind}`, title }, children)
    }

    /**
     * 可折叠模块：收起时只有标题与状态标签，默认收起。
     *
     * 用**原生 `<details>`**而不是自绘按钮：早先版本用 `▸` 字符 + CSS 旋转，
     * 与高级模式的原生三角并排时一眼就能看出不是一套（用户 2026-09-28 反馈
     * "前三个的箭头看起来很奇怪，最后一个没问题"）。统一交给浏览器画。
     * 不用受控 open：让浏览器持有展开状态，React 重渲染时不会被重置。
     */
    function Module({ id, title, tags, children }) {
      return React.createElement('details', { className: 'ddo-module', id: `ddo-module-${id}` }, [
        React.createElement('summary', { key: 'summary', title }, [
          React.createElement('span', { className: 'ddo-chevron', key: 'chevron' },
            DisclosureIcon === undefined ? null : React.createElement(DisclosureIcon, null)),
          React.createElement('span', { className: 'ddo-summary-inner', key: 'inner' }, [
            React.createElement('span', { className: 'ddo-card-title', key: 'title' }, title),
            React.createElement('span', { className: 'ddo-card-tags', key: 'tags' }, tags)
          ])
        ]),
        React.createElement('div', { className: 'ddo-card-body', key: 'body' }, children)
      ])
    }

    /** 渲染一个字段行：状态标签、默认/生效值、输入框、应用与恢复默认。 */
    function FieldRow({ entry, field, draft, busy, onDraft, onApply, onReset }) {
      const key = keyOf(entry.id, field.path)
      const overridden = field.override !== undefined
      const frozen = field.frozenSameAsDefault === true
      const draftValue = Object.hasOwn(draft, key) ? draft[key] : overridden ? String(field.override) : ''
      const trimmed = draftValue.trim()
      const dirty = trimmed !== '' && trimmed !== String(overridden ? field.override : '')
      const disabled = !entry.availability.writable || busy

      const flag = overridden
        ? React.createElement(Tag, {
          key: 'flag',
          kind: frozen ? 'muted' : 'accent',
          title: frozen ? '值仍是官方默认值，只是因为补丁整块替换而一并写了进去' : ''
        }, frozen ? '随整块写入' : '已覆盖')
        : null

      return React.createElement('div', { className: 'ddo-row' }, [
        React.createElement('div', { className: 'ddo-row-head', key: 'head' }, [
          React.createElement('span', { className: 'ddo-row-label', key: 'label' }, field.label),
          React.createElement('span', { className: 'ddo-row-unit', key: 'unit' }, field.unit),
          flag
        ].filter(Boolean)),
        React.createElement('div', { className: 'ddo-row-values', key: 'values' }, [
          React.createElement('span', { key: 'def' }, `默认 ${displayValue(field.default)}`),
          React.createElement('span', { key: 'cur' }, `实际生效 ${displayValue(field.effective)}`)
        ]),
        React.createElement('div', { className: 'ddo-row-controls', key: 'controls' }, [
          React.createElement(Input, {
            key: 'input',
            className: 'ddo-input',
            type: 'number',
            inputMode: 'numeric',
            min: field.min,
            value: draftValue,
            placeholder: field.default === undefined ? '' : String(field.default),
            disabled,
            onChange: (event) => onDraft(key, event.target.value)
          }),
          React.createElement(Button, {
            key: 'apply',
            className: 'ddo-button',
            variant: 'primary',
            size: 'sm',
            type: 'button',
            disabled: disabled || !dirty,
            onClick: () => onApply(entry.id, field.path, trimmed)
          }, '应用'),
          React.createElement(Button, {
            key: 'reset',
            className: 'ddo-button',
            variant: 'outline',
            size: 'sm',
            type: 'button',
            disabled: disabled || !overridden,
            title: overridden ? '' : '当前没有覆盖',
            onClick: () => onReset(entry.id, field.path)
          }, '恢复默认')
        ]),
        React.createElement('div', { className: 'ddo-hint', key: 'hint' }, field.hint)
      ])
    }

    /** 整个设置分区。 */
    function DefaultOverridesSection() {
      const [state, setState] = React.useState({ phase: 'loading' })
      const [draft, setDraft] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(STATUS_PATH, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { [CLIENT_HEADER]: '1' }
          })
          // 宿主半体没注册路由时这里是空 body 的 404，`json()` 会抛 SyntaxError，
          // 页面上只剩「读取状态失败：Unexpected end of JSON input」看不出所以然。
          // 最常见的原因是 DSH 版本不在兼容发布线内、宿主按版本门保持 inert。
          if (response.status === 404) {
            setState({
              phase: 'error',
              error: '宿主半体没有注册路由（HTTP 404）：本插件可能因当前运行的 DSH 版本不在兼容发布线内而未启用，也可能是条目未加载。请查看 Host 日志里 dsh-default-overrides 前缀的告警。'
            })
            return
          }
          let payload
          try {
            payload = await response.json()
          } catch {
            setState({ phase: 'error', error: `读取状态失败（HTTP ${String(response.status)}，响应不是 JSON）` })
            return
          }
          if (!response.ok || payload.ok !== true) {
            setState({ phase: 'error', error: payload.error ?? `读取状态失败（HTTP ${String(response.status)}）` })
            return
          }
          setState({ phase: 'ready', ...payload })
        } catch (error) {
          setState({ phase: 'error', error: `读取状态失败：${String(error)}` })
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const act = React.useCallback(async (body, successText) => {
        if (state.csrfToken === undefined) {
          setNotice({ kind: 'error', text: '缺少 CSRF 令牌，请重新打开设置面板。' })
          return
        }
        setBusy(true)
        try {
          const response = await fetch(ACTION_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              [CLIENT_HEADER]: '1',
              [CSRF_HEADER]: state.csrfToken
            },
            body: JSON.stringify(body)
          })
          const payload = await response.json()
          if (!response.ok || payload.ok !== true) {
            const suggestedLimit = payload.detail?.suggestedLimit
            setNotice({
              kind: 'error',
              text: payload.error ?? `写入失败（HTTP ${String(response.status)}）`,
              // 标题输入超限时宿主会带上建议上限，这里直接给一键修复。
              fix: body.action === 'retitle' && typeof suggestedLimit === 'number'
                ? { sessionId: String(body.sessionId ?? ''), suggestedLimit }
                : undefined
            })
            return
          }
          setState((previous) => ({
            ...previous,
            entries: payload.entries,
            advanced: payload.advanced,
            sessions: payload.sessions ?? previous.sessions,
            sessionsTotal: payload.sessionsTotal ?? previous.sessionsTotal,
            sessionsNeedRetitle: payload.sessionsNeedRetitle ?? previous.sessionsNeedRetitle,
            sessionsOverLimit: payload.sessionsOverLimit ?? previous.sessionsOverLimit
          }))
          setDraft((previous) => {
            const next = { ...previous }
            if (body.path !== undefined) delete next[keyOf(body.entryId, body.path)]
            return next
          })
          setNotice({ kind: 'ok', text: successText })
        } catch (error) {
          setNotice({ kind: 'error', text: `写入失败：${String(error)}` })
        } finally {
          setBusy(false)
        }
      }, [state.csrfToken])

      if (state.phase === 'loading') {
        return React.createElement('div', { className: 'ddo-root' }, '正在读取当前 profile 的默认值…')
      }
      if (state.phase === 'error') {
        return React.createElement('div', { className: 'ddo-root' }, [
          React.createElement('div', { className: 'ddo-notice ddo-notice-error', key: 'e' }, state.error),
          React.createElement(Button, { className: 'ddo-button', variant: 'outline', size: 'sm', key: 'retry', type: 'button', onClick: () => { setState({ phase: 'loading' }); load() } }, '重试')
        ])
      }

      const children = [
        React.createElement('div', { className: 'ddo-title', key: 'title' }, SECTION_LABEL)
      ]

      if (state.available !== true) {
        children.push(React.createElement('div', { className: 'ddo-notice ddo-notice-warn', key: 'warn' },
          state.error ?? '当前 profile 不支持覆盖默认设置。'))
      } else {
        children.push(React.createElement('div', { className: 'ddo-intro', key: 'intro' },
          '这里覆盖的是官方插件自带的默认值；写入会直接落进当前 profile 的补丁文件（保留注释），并立即生效。'))
        children.push(React.createElement('div', { className: 'ddo-meta', key: 'path' }, `当前 profile 补丁：${String(state.documentPath)}`))
      }
      if (notice !== null) {
        children.push(React.createElement('div', {
          key: 'notice',
          className: `ddo-notice ${notice.kind === 'error' ? 'ddo-notice-error' : 'ddo-notice-ok'}`
        }, [
          React.createElement('span', { key: 'text' }, notice.text),
          notice.fix === undefined
            ? null
            : React.createElement(Button, {
              key: 'fix',
              className: 'ddo-button ddo-notice-action',
              variant: 'primary',
              size: 'sm',
              type: 'button',
              disabled: busy,
              onClick: () => act(
                { action: 'retitle', sessionId: notice.fix.sessionId, raiseLimit: true },
                `已把标题输入上限调到 ${String(notice.fix.suggestedLimit)} 并重新生成标题。`
              )
            }, `把上限调到 ${String(notice.fix.suggestedLimit)} 并重试`)
        ].filter(Boolean)))
      }

      // 每个白名单条目 = 一个可折叠模块。
      for (const entry of state.entries ?? []) {
        const changed = entry.fields.filter((field) => field.override !== undefined && field.frozenSameAsDefault !== true).length
        const frozen = entry.fields.filter((field) => field.frozenSameAsDefault === true).length
        const tags = []
        if (!entry.availability.writable) {
          tags.push(React.createElement(Tag, {
            key: 'avail',
            kind: entry.availability.reason === 'missing' ? 'warn' : 'error',
            title: entry.availability.message
          }, entry.availability.reason === 'missing' ? '条目不存在' : '暂时不可写'))
        } else if (changed > 0) {
          tags.push(React.createElement(Tag, { key: 'changed', kind: 'accent' }, `已覆盖 ${String(changed)} 项`))
        } else if (frozen > 0) {
          tags.push(React.createElement(Tag, { key: 'frozen', kind: 'muted' }, '均为默认值'))
        } else {
          tags.push(React.createElement(Tag, { key: 'default', kind: 'muted' }, '默认值'))
        }

        const body = []
        if (typeof entry.description === 'string' && entry.description !== '') {
          body.push(React.createElement('div', { className: 'ddo-card-desc', key: 'desc' }, entry.description))
        }
        if (!entry.availability.writable) {
          body.push(React.createElement('div', {
            className: `ddo-notice ${entry.availability.reason === 'missing' ? 'ddo-notice-warn' : 'ddo-notice-error'}`,
            key: 'avail'
          }, entry.availability.message))
        }
        if (frozen > 0) {
          body.push(React.createElement('div', { className: 'ddo-hint', key: 'frozen-hint' },
            '补丁是整块替换：应用一项时该条目的全部字段会一起写进补丁，与默认值相同的那些标为「随整块写入」（点它们旁边的「恢复默认」可以清掉）。'))
        }
        for (const field of entry.fields) {
          body.push(React.createElement(FieldRow, {
            key: field.path,
            entry,
            field,
            draft,
            busy,
            onDraft: (key, value) => setDraft((previous) => ({ ...previous, [key]: value })),
            onApply: (entryId, path, value) => act({ action: 'apply', entryId, path, value }, `已写入 ${entryId}.${path} = ${value}。`),
            onReset: (entryId, path) => act({ action: 'reset', entryId, path }, `已把 ${entryId}.${path} 恢复为默认值。`)
          }))
        }

        children.push(React.createElement(Module, {
          key: `entry-${entry.id}`,
          id: entry.id,
          title: entry.title,
          tags
        }, body))
      }

      // 会话标题重算：同样是一个可折叠模块。
      const allSessionRows = state.sessions ?? []
      // 兜底过滤：宿主侧已经只返回"需要重算"的会话，但宿主可能是旧版（改完代码还没重载），
      // 那时它返回的是全部活跃会话——这里再筛一遍，列表口径才不会随宿主版本漂移。
      const sessionRows = allSessionRows.filter((row) => row.sourceKind === 'fallback')
      const sessionsTotal = state.sessionsTotal ?? allSessionRows.length
      const sessionsNeedRetitle = state.sessionsNeedRetitle ?? sessionRows.length
      const retitleBody = []
      if (state.sessionsAvailable === false) {
        retitleBody.push(React.createElement('div', { className: 'ddo-card-desc', key: 'unavailable' },
          String(state.sessionsReason ?? '当前 profile 不支持重算标题。')))
      } else {
        retitleBody.push(React.createElement('div', { className: 'ddo-card-desc', key: 'desc' },
          `只列出标题仍是兜底截断的活跃会话（当前 ${String(sessionsTotal)} 个活跃会话，其中 ${String(sessionsNeedRetitle)} 个需要重算${state.sessionsOverLimit > 0 ? `，含 ${String(state.sessionsOverLimit)} 个首条消息超限` : ''}）。模型已成功命名或你手动命名过的会话不会进这个列表，重算成功后也会自动消失。`))
        if (sessionRows.length === 0) {
          retitleBody.push(React.createElement('div', { className: 'ddo-empty', key: 'empty' },
            '没有需要重算的会话：活跃会话都已经成功命名，或被手动命名过。'))
        }
        const overLimitRows = sessionRows.filter((row) => row.overLimit === true)
        if (overLimitRows.length > 0) {
          const limitText = overLimitRows[0].inputLimit === undefined ? '标题输入上限' : `标题输入上限 ${formatBytes(overLimitRows[0].inputLimit)}`
          retitleBody.push(React.createElement('div', { className: 'ddo-hint', key: 'over-limit-hint' },
            `下面 ${String(overLimitRows.length)} 条会话的首条消息本身就超过了${limitText}，直接重算必然报错；点「调大上限并重算」会把上限抬到够用（写进当前 profile 补丁，对所有会话生效）。`))
        }
        // 超限的排在后面（可读性）：两类共用同一套行渲染，行内按 overLimit 分支。
        for (const row of [...sessionRows.filter((item) => item.overLimit !== true), ...overLimitRows]) {
          retitleBody.push(React.createElement('div', { className: 'ddo-item-row', key: row.id }, [
            React.createElement('div', {
              className: 'ddo-item-text',
              key: 'text',
              title: row.cwd === '' ? undefined : row.cwd
            }, [
              row.title === '' ? '（还没有标题）' : row.title,
              React.createElement('br', { key: 'br' }),
              // 只显示工作区名（完整路径放在 title 提示里），避免长路径把行撑爆。
              `${row.shortId}${workspaceLabel(row) === '' ? '' : ` · ${workspaceLabel(row)}`}`,
              row.inputBytes === undefined
                ? ''
                : React.createElement('span', { key: 'bytes' }, ` · 首条消息 ${formatBytes(row.inputBytes)}`)
            ]),
            React.createElement(Tag, {
              key: 'src',
              kind: row.overLimit === true ? 'warn' : 'muted',
              title: row.overLimit === true
                ? '首条消息超过标题输入上限，直接重算会失败'
                : row.sourceLabel
            }, row.overLimit === true ? '输入超限' : '兜底截断'),
            React.createElement(Button, {
              key: 'button',
              className: 'ddo-button',
              variant: 'primary',
              size: 'sm',
              type: 'button',
              disabled: busy,
              onClick: () => {
                if (row.overwritesManual && !window.confirm(`「${row.title}」是你手动命名的，重新生成会覆盖它。继续？`)) return
                act(
                  { action: 'retitle', sessionId: row.id, raiseLimit: row.overLimit === true },
                  row.overLimit === true
                    ? `已把标题输入上限调到 ${String(row.suggestedLimit)} 并重新生成标题。`
                    : `已请求重算标题（原：${row.title === '' ? '无' : row.title}）。`
                )
              }
            }, row.overLimit === true ? '调大上限并重算' : '重新生成')
          ].filter(Boolean)))
        }
      }
      children.push(React.createElement(Module, {
        key: 'retitle',
        id: 'retitle',
        title: '会话标题重算',
        tags: [React.createElement(Tag, {
          key: 'count',
          kind: sessionsNeedRetitle > 0 ? 'accent' : 'muted'
        }, sessionsNeedRetitle > 0 ? `${String(sessionsNeedRetitle)} 条待重算` : '无需重算')]
      }, retitleBody))

      // 高级模式同样走 Module：手写 details 会漏掉官方折叠图标（2026-09-28 踩过一次）。
      const advancedRows = state.advanced ?? []
      children.push(React.createElement(Module, {
        key: 'advanced',
        id: 'advanced',
        title: `高级模式：当前 profile 共 ${String(state.totalEntries ?? 0)} 个条目，其中 ${String(advancedRows.length)} 个带有配置覆盖`,
        tags: []
      }, [
        React.createElement('div', { className: 'ddo-details-body', key: 'body' }, [
          React.createElement('div', { className: 'ddo-hint', key: 'hint' },
            '这个清单是只读的：完整配置的任意编辑请直接改 profile 补丁文件。这里只能"清除某个条目的整块覆盖"，清除后该条目回到继承层默认值。'),
          React.createElement('div', { className: 'ddo-hint', key: 'legend' },
            '带「可在上方调整」的是上面那几项对应的条目——它们的覆盖也能在模块里逐字段改；标「只能整块清除」的条目不在可覆盖白名单里，设置页不提供逐字段编辑。'),
          advancedRows.length === 0
            ? React.createElement('div', { className: 'ddo-empty', key: 'empty' }, '当前没有条目带配置覆盖。')
            : null,
          ...advancedRows.map((row) => React.createElement('div', { className: 'ddo-item-row', key: row.id }, [
            React.createElement('div', { className: 'ddo-item-text', key: 'text' }, [
              row.id,
              React.createElement('br', { key: 'br' }),
              `覆盖字段：${row.paths.join(', ')}`
            ]),
            row.managed
              ? React.createElement(Tag, {
                key: 'managed',
                kind: 'muted',
                title: '这个条目有对应的设置模块，覆盖可以在模块里逐字段改'
              }, '可在上方调整')
              : React.createElement(Tag, {
                key: 'managed',
                kind: 'muted',
                title: '这个条目不在可覆盖白名单里，设置页不提供逐字段编辑'
              }, '只能整块清除'),
            React.createElement(Button, {
              key: 'reset',
              className: 'ddo-button',
              variant: 'outline',
              size: 'sm',
              type: 'button',
              disabled: busy || !row.availability.writable,
              title: row.availability.writable ? '这条会删掉该条目在补丁里的整块 config' : row.availability.message,
              onClick: () => {
                if (!window.confirm(`确定清除 ${row.id} 在 profile 补丁里的整块配置覆盖？`)) return
                act({ action: 'reset-entry', entryId: row.id }, `已清除 ${row.id} 的配置覆盖。`)
              }
            }, '清除覆盖')
          ].filter(Boolean)))
        ].filter(Boolean))
      ]))

      return React.createElement('div', { className: 'ddo-root' }, children.filter(Boolean))
    }

    /** 错误边界：任何渲染异常都不该让整个设置面板白屏。 */
    class SectionErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error !== null) {
          return React.createElement('div', { className: 'ddo-root' }, [
            React.createElement('div', { className: 'ddo-notice ddo-notice-error', key: 'e' },
              `默认设置覆盖面板渲染失败：${String(this.state.error)}`)
          ])
        }
        return this.props.children
      }
    }

    /**
     * 客户端插件入口：注册设置分区。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      installStyles(ctx)
      const Section = () => React.createElement(SectionErrorBoundary, null, React.createElement(DefaultOverridesSection, null))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'default-overrides',
        order: SECTION_ORDER,
        label: SECTION_LABEL
      }, Section))
    }

    exports.inject = ['slots']
    exports.apply = apply
    exports.__internals = Object.freeze({ keyOf, Tag, Module, SectionErrorBoundary, DefaultOverridesSection })

    return module.exports
  }
})
