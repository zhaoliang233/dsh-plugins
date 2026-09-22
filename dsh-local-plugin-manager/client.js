window.__ModuleLoader__.load({
  id: 'dsh-local-plugin-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    /**
     * 取一个官方图标，按**能力**而不是按 DSH 版本号：图标名在发布线之间改过名
     * （0.1.6 是数字档位 `IconSearchOutline16`，0.1.7 换成档位词
     * `IconSearchOutlineMedium`；图形身份同名，命名法与画法整体改过），所以按顺序取第一个
     * 真实存在的导出。同一基础名的 `…Medium` 与 `…Regular` 路径完全相同、只有笔重
     * 不同，工作区统一取 `…Medium`。全都缺失时退化成不渲染任何东西的空组件，绝不让整个
     * bundle 因为一个图标名消失而挂掉。
     * @param names - 候选导出名，从最新命名往后排。
     */
    function iconOf(...names) {
      for (const name of names) {
        const candidate = primitives?.[name]
        if (typeof candidate === 'function' || (candidate !== null && typeof candidate === 'object')) return candidate
      }
      return () => null
    }
    // 局部名保持不变：组件里的用法与测试断言都不必跟着改名，改的只是"从哪里来"。
    const IconLoadingOutline16 = iconOf('IconLoadingOutlineMedium', 'IconLoadingOutlineRegular', 'IconLoadingOutline16')
    const IconRefreshOutline16 = iconOf('IconRefreshOutlineMedium', 'IconRefreshOutlineRegular', 'IconRefreshOutline16')
    const IconTrashOutline16 = iconOf('IconTrashOutlineMedium', 'IconTrashOutlineRegular', 'IconTrashOutline16')
    const IconWarningOutline16 = iconOf('IconWarningOutlineMedium', 'IconWarningOutlineRegular', 'IconWarningOutline16')
    // 非图标成员照旧直接取自 primitives：它们的名字没有跨发布线改名的问题。
    const { Button, Modal, Switch, Tag } = primitives

    const STATUS_PATH = '/dsh-local-plugin-manager/status'
    const ACTION_PATH = '/dsh-local-plugin-manager/action'
    const CLIENT_HEADER = 'X-DSH-Local-Plugin-Manager-Client'
    const CSRF_HEADER = 'X-DSH-Local-Plugin-Manager-CSRF'
    const PLUGIN_ID = 'dsh-local-plugin-manager'
    const STYLE_ID = `${PLUGIN_ID}-style`

    const styleText = `
.dlpm-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}
.dlpm-heading{display:flex;align-items:center;gap:8px;min-height:32px}
.dlpm-title{min-width:0;margin:0;font-size:16px;font-weight:500;line-height:24px;letter-spacing:0}
.dlpm-count{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dlpm-heading-spacer{flex:1}
.dlpm-icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dlpm-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dlpm-icon-button.danger{color:var(--dsw-alias-state-error-primary)}
.dlpm-icon-button.danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.dlpm-icon-button:disabled{opacity:.42;cursor:not-allowed;background:transparent}
.dlpm-notice,.dlpm-error{margin:0;padding:9px 11px;border-radius:6px;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.dlpm-notice{display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dlpm-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dlpm-notice-copy{min-width:0;flex:1}
.dlpm-list{display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dlpm-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;min-height:78px;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dlpm-copy{display:flex;flex-direction:column;gap:6px;min-width:0}
.dlpm-name-line{display:flex;align-items:center;gap:7px;min-width:0}
.dlpm-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:22px}
.dlpm-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;padding:4px 9px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.dlpm-description.missing{background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dlpm-tag{flex:none}
.dlpm-meta{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dlpm-version{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.dlpm-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dlpm-reason{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.dlpm-actions{display:flex;align-items:center;gap:7px;min-width:75px;justify-content:flex-end}
.dlpm-empty,.dlpm-loading{padding:34px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dlpm-loading{display:flex;align-items:center;justify-content:center;gap:8px}
.dlpm-dialog{width:min(480px,calc(100vw - 32px))}
.dlpm-confirm{display:flex;flex-direction:column;gap:8px;min-width:0}
.dlpm-confirm-name{font-size:14px;font-weight:500;line-height:22px;overflow-wrap:anywhere}
.dlpm-confirm-path{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dlpm-danger-button{--dsw-alias-button-primary-fill:var(--dsw-alias-state-error-primary);--dsw-alias-button-primary-hover:var(--dsw-alias-state-error-primary)}
@media(max-width:600px){.dlpm-row{grid-template-columns:minmax(0,1fr);gap:8px}.dlpm-actions{justify-content:flex-start}.dlpm-path{max-width:100%}}
`

    function countLabel(count) {
      return `${count} 个`
    }

    function statusLabel(plugin) {
      if (plugin.status === 'partial') return '部分启用'
      return plugin.enabled ? '已启用' : '已禁用'
    }

    // 徽标只挑官方 Tag 的语义档位：身份描边，已启用 success、已禁用 quiet（无底色、更弱）、
    // 部分启用 warning，四者一眼可分。档位名写错时官方样式不会命中，徽标会静默失去配色。
    function statusTone(plugin) {
      if (plugin.status === 'partial') return 'warning'
      return plugin.enabled ? 'success' : 'quiet'
    }

    function controlReason(plugin, enable) {
      if (plugin.self) return '当前管理器由命令行维护'
      if (!plugin.manageable) return plugin.reason || '该插件不能安全管理'
      if (enable && !plugin.canEnable) return 'home 级用户 patch 强制禁用了该插件'
      if (!enable && !plugin.canDisable) return 'home 级用户 patch 强制启用了该插件'
      return enable ? '启用插件' : '禁用插件'
    }

    async function decodeResponse(response) {
      let body
      try { body = await response.json() } catch { body = {} }
      if (!response.ok || body.ok !== true) {
        throw new Error(typeof body.error === 'string' ? body.error : `请求失败 (HTTP ${response.status})`)
      }
      return body
    }

    function LocalPluginsTab() {
      const [view, setView] = React.useState({ kind: 'loading' })
      const [csrfToken, setCsrfToken] = React.useState('')
      const [busyName, setBusyName] = React.useState(null)
      const [confirmTarget, setConfirmTarget] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [error, setError] = React.useState(null)
      const requestRef = React.useRef(null)
      const requestEpochRef = React.useRef(0)
      const actionRef = React.useRef(null)

      const loadPlugins = React.useCallback(async (allowDuringAction = false) => {
        if (!allowDuringAction && actionRef.current !== null) return
        if (requestRef.current !== null) requestRef.current.abort()
        const controller = new AbortController()
        const requestEpoch = ++requestEpochRef.current
        requestRef.current = controller
        setView((current) => current.kind === 'ready' ? current : { kind: 'loading' })
        setError(null)
        try {
          const response = await fetch(STATUS_PATH, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { [CLIENT_HEADER]: '1' },
            signal: controller.signal
          })
          const body = await decodeResponse(response)
          if (controller.signal.aborted || requestEpoch !== requestEpochRef.current
            || (!allowDuringAction && actionRef.current !== null)) return
          if (body.available !== true) {
            setView({ kind: 'unavailable', error: body.error || '本地插件管理器当前不可用。' })
            return
          }
          setCsrfToken(typeof body.csrfToken === 'string' ? body.csrfToken : '')
          setView({
            kind: 'ready',
            profile: body.profile,
            plugins: Array.isArray(body.plugins) ? body.plugins : []
          })
        } catch (reason) {
          if (!controller.signal.aborted && requestEpoch === requestEpochRef.current
            && (allowDuringAction || actionRef.current === null) && reason?.name !== 'AbortError') {
            setView({ kind: 'failed', error: reason instanceof Error ? reason.message : String(reason) })
          }
        } finally {
          if (requestRef.current === controller) requestRef.current = null
        }
      }, [])

      React.useEffect(() => {
        void loadPlugins()
        return () => {
          if (requestRef.current !== null) requestRef.current.abort()
          if (actionRef.current !== null) actionRef.current.abort()
        }
      }, [loadPlugins])

      const perform = async (action, plugin) => {
        if (busyName !== null || csrfToken === '' || actionRef.current !== null) return
        requestEpochRef.current += 1
        if (requestRef.current !== null) {
          requestRef.current.abort()
          requestRef.current = null
        }
        const controller = new AbortController()
        actionRef.current = controller
        setBusyName(plugin.name)
        setError(null)
        setNotice(null)
        try {
          const response = await fetch(ACTION_PATH, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              [CLIENT_HEADER]: '1',
              [CSRF_HEADER]: csrfToken
            },
            body: JSON.stringify({ action, name: plugin.name }),
            signal: controller.signal
          })
          const body = await decodeResponse(response)
          if (controller.signal.aborted) return
          if (body.snapshot && Array.isArray(body.snapshot.plugins)) {
            setView((current) => ({
              kind: 'ready',
              profile: body.snapshot.profile || current.profile,
              plugins: body.snapshot.plugins
            }))
          } else {
            await loadPlugins(true)
          }
          const actionLabel = action === 'uninstall' ? '已卸载' : action === 'enable' ? '已启用' : '已禁用'
          const suffix = body.restart
            ? '；重启 dsh web 后完成组成切换。'
            : body.refresh
              ? '；刷新页面后同步浏览器插件。'
              : '。'
          setNotice({ text: `${plugin.name} ${actionLabel}${suffix}`, refresh: body.refresh === true })
          if (action === 'uninstall') setConfirmTarget(null)
        } catch (reason) {
          if (!controller.signal.aborted && reason?.name !== 'AbortError') {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        } finally {
          if (actionRef.current === controller) {
            actionRef.current = null
            if (!controller.signal.aborted) setBusyName(null)
          }
        }
      }

      const plugins = view.kind === 'ready' ? view.plugins : []
      const confirmBusy = confirmTarget !== null && busyName === confirmTarget.name
      // Modal renders `footer` itself, so the buttons only need the official variants:
      // outline for cancel, primary plus the danger token override for uninstall.
      const confirmFooter = confirmTarget === null ? undefined : React.createElement(
        React.Fragment,
        null,
        React.createElement(Button, {
          variant: 'outline',
          disabled: confirmBusy,
          onClick: () => setConfirmTarget(null)
        }, '取消'),
        React.createElement(Button, {
          variant: 'primary',
          className: 'dlpm-danger-button',
          disabled: confirmBusy,
          onClick: () => { void perform('uninstall', confirmTarget) }
        }, confirmBusy ? '正在卸载…' : '卸载')
      )

      let content
      if (view.kind === 'loading') {
        content = React.createElement('div', { className: 'dlpm-loading' },
          React.createElement(IconLoadingOutline16, { size: 16 }),
          '正在读取本地插件…')
      } else if (view.kind === 'failed' || view.kind === 'unavailable') {
        content = React.createElement(React.Fragment, null,
          React.createElement('p', { className: 'dlpm-error' }, view.error),
          React.createElement(Button, {
            variant: 'outline',
            size: 'sm',
            icon: React.createElement(IconRefreshOutline16, { size: 16 }),
            onClick: () => { void loadPlugins() }
          }, '重试'))
      } else if (plugins.length === 0) {
        content = React.createElement('div', { className: 'dlpm-empty' }, '当前 profile 没有已安装的本地链接插件')
      } else {
        content = React.createElement('div', { className: 'dlpm-list' }, plugins.map((plugin) => {
          const rowBusy = busyName === plugin.name
          const switchWillEnable = !plugin.enabled
          const switchDisabled = busyName !== null || plugin.self || !plugin.manageable || (switchWillEnable ? !plugin.canEnable : !plugin.canDisable)
          const uninstallDisabled = busyName !== null || !plugin.canUninstall
          const reason = plugin.reason || (plugin.uninstallBlockedBy?.length
            ? `用户 patch 仍引用：${plugin.uninstallBlockedBy.join('、')}`
            : plugin.externalControl
              ? '启动状态还受其他用户 patch 控制'
              : '')
          return React.createElement(
            'div',
            { className: 'dlpm-row', key: plugin.name },
            React.createElement('div', { className: 'dlpm-copy' },
              React.createElement('div', { className: 'dlpm-name-line' },
                React.createElement('span', { className: 'dlpm-name', title: plugin.name }, plugin.name),
                plugin.self && React.createElement(Tag, { tone: 'outline', className: 'dlpm-tag' }, '当前管理器'),
                React.createElement(Tag, {
                  tone: statusTone(plugin),
                  className: 'dlpm-tag'
                }, statusLabel(plugin))
              ),
              React.createElement('div', {
                className: plugin.description ? 'dlpm-description' : 'dlpm-description missing',
                title: plugin.description || undefined
              }, plugin.description || '未提供说明'),
              React.createElement('div', { className: 'dlpm-meta' },
                plugin.version && React.createElement('span', { className: 'dlpm-version' }, `v${plugin.version}`),
                React.createElement('span', { className: 'dlpm-path', title: plugin.path }, plugin.path)
              ),
              reason && React.createElement('span', { className: 'dlpm-reason', title: reason }, reason)
            ),
            React.createElement('div', { className: 'dlpm-actions' },
              React.createElement(Switch, {
                checked: plugin.enabled,
                label: `${plugin.enabled ? '禁用' : '启用'} ${plugin.name}`,
                disabled: switchDisabled,
                title: controlReason(plugin, switchWillEnable),
                onChange: (next) => { void perform(next ? 'enable' : 'disable', plugin) }
              }),
              React.createElement('button', {
                type: 'button',
                className: 'dlpm-icon-button danger',
                'aria-label': `卸载 ${plugin.name}`,
                title: plugin.self
                  ? '当前管理器请通过 uninstall.sh 卸载'
                  : plugin.uninstallBlockedBy?.length
                    ? '用户 patch 仍引用该包'
                    : plugin.manageable
                      ? '卸载本地链接'
                      : (plugin.reason || '该插件不能安全卸载'),
                disabled: uninstallDisabled,
                onClick: () => { setConfirmTarget(plugin); setError(null) }
              }, rowBusy
                ? React.createElement(IconLoadingOutline16, { size: 16 })
                : React.createElement(IconTrashOutline16, { size: 16 }))
            )
          )
        }))
      }

      return React.createElement(
        React.Fragment,
        null,
        React.createElement('section', { className: 'dlpm-section', 'aria-label': '本地插件' },
          React.createElement('div', { className: 'dlpm-heading' },
            React.createElement('h2', { className: 'dlpm-title' }, '本地插件'),
            view.kind === 'ready' && React.createElement('span', { className: 'dlpm-count' }, countLabel(plugins.length)),
            React.createElement('span', { className: 'dlpm-heading-spacer' }),
            React.createElement('button', {
              type: 'button',
              className: 'dlpm-icon-button',
              title: '刷新本地插件列表',
              'aria-label': '刷新本地插件列表',
              disabled: busyName !== null,
              onClick: () => { void loadPlugins() }
            }, React.createElement(IconRefreshOutline16, { size: 16 }))
          ),
          notice && React.createElement('div', { className: 'dlpm-notice', role: 'status' },
            React.createElement(IconWarningOutline16, { size: 16 }),
            React.createElement('span', { className: 'dlpm-notice-copy' }, notice.text),
            notice.refresh && React.createElement(Button, {
              variant: 'outline',
              size: 'sm',
              icon: React.createElement(IconRefreshOutline16, { size: 16 }),
              onClick: () => window.location.reload()
            }, '刷新页面')
          ),
          error && React.createElement('p', { className: 'dlpm-error', role: 'alert' }, error),
          content
        ),
        React.createElement(Modal, {
          open: confirmTarget !== null,
          onClose: () => { if (!confirmBusy) setConfirmTarget(null) },
          title: confirmTarget === null ? '卸载本地插件？' : `卸载 ${confirmTarget.name}？`,
          closeLabel: '关闭',
          description: '将从当前 web profile 移除本地链接；源码目录和插件创建的数据不会删除。',
          className: 'dlpm-dialog',
          footer: confirmFooter
        }, confirmTarget === null ? null : React.createElement('div', { className: 'dlpm-confirm' },
          React.createElement('div', { className: 'dlpm-confirm-name' }, confirmTarget.name),
          React.createElement('p', { className: 'dlpm-confirm-path' }, confirmTarget.path),
          error && React.createElement('p', { className: 'dlpm-error' }, error)
        ))
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      let style = document.getElementById(STYLE_ID)
      if (style === null) {
        style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = styleText
        style.dataset.references = '0'
        document.head.appendChild(style)
      } else if (style.textContent !== styleText) {
        // The client HMR reload replaces the fiber without disposing it, so a
        // surviving element keeps the previous bundle's rules: rewrite them.
        style.textContent = styleText
      }
      // DSH's module loader claims untagged <style> tags for whichever bundle materializes
      // next, and HMR removes style[data-plugin=<id>]: tag our own sheet so it is never
      // mis-attributed to another plugin and never removed together with that plugin.
      style.dataset.plugin = PLUGIN_ID
      style.dataset.references = String(Number(style.dataset.references || '0') + 1)
      ctx.effect(() => () => {
        const current = document.getElementById(STYLE_ID)
        if (current === null) return
        const remaining = Math.max(0, Number(current.dataset.references || '1') - 1)
        current.dataset.references = String(remaining)
        if (remaining === 0) current.remove()
      }, 'dsh-local-plugin-manager: styles')

      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: 'local-plugins',
        // 插件贡献的设置入口一律排到 DSH 自带项之后：内置 tab 只有 all（order 10），
        // 插件 tab 从 100 起。并列只能靠注册顺序决胜，所以不要复用内置的档位。
        order: 100,
        label: '本地插件'
      }, LocalPluginsTab))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
