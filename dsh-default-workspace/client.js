window.__ModuleLoader__.load({
  id: 'dsh-default-workspace',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const {
      IconLoadingOutline16,
      IconNewChatOutline16,
      IconWarningOutline16,
      Tooltip
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const PLUGIN_NAME = 'dsh-default-workspace'
    const STATUS_PATH = '/dsh-default-workspace/status'
    const ACTION_ID = 'dsh-default-workspace.new-session'
    const ACTION_LABEL = '新建通用会话'
    const ACTION_BUSY_LABEL = '正在新建通用会话'
    const ACTION_ERROR_LABEL = '新建失败，点击重试'
    const DEFAULT_WORKSPACE_TITLE = '通用会话'
    const PROTECTED_MESSAGE = '“通用会话”是 DSH 管理的默认工作区，不能执行此操作'
    const STYLE_OWNER = 'dsh-default-workspace-v1'
    const STYLE_ID = 'dsh-default-workspace-style'
    const inject = ['uiWorkspace', 'workspaces', 'slots']
    const INTERCEPTOR_REGISTRY = Symbol.for('dsh.workspace-method-interceptors.v1')
    const CORDIS_ORIGINAL = Symbol.for('cordis.original')

    const styleText = `
.dgw-action{flex:none;align-items:center;width:100%;height:42px;margin:8px 0 0;display:flex;position:relative}
.dgw-action-rail{width:36px;height:36px;margin:0}
.dgw-button{box-sizing:border-box;width:calc(100% + 4px);height:42px;margin:0 -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;overflow:hidden}
.dgw-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dgw-button:disabled{opacity:.55;cursor:wait}
.dgw-button[data-error]{color:var(--dsw-alias-state-error-primary)}
.dgw-button[data-error]:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.dgw-action-rail .dgw-button{width:36px;height:36px;margin:0;padding:0;border-radius:50%;justify-content:center;gap:0}
.dgw-button-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgw-spin{animation:dgw-spin .9s linear infinite}
@keyframes dgw-spin{to{transform:rotate(360deg)}}
`

    function interceptorTarget(target) {
      const original = target?.[CORDIS_ORIGINAL]
      return original !== null && (typeof original === 'object' || typeof original === 'function')
        ? original
        : target
    }

    function interceptorRoot() {
      let root = globalThis[INTERCEPTOR_REGISTRY]
      if (root === undefined) {
        root = new WeakMap()
        Object.defineProperty(globalThis, INTERCEPTOR_REGISTRY, { value: root })
      }
      if (!(root instanceof WeakMap)) throw new Error('incompatible DSH Workspace interceptor registry')
      return root
    }

    function restoreOwnDescriptor(target, name, descriptor) {
      const restored = descriptor === undefined
        ? Reflect.deleteProperty(target, name)
        : Reflect.defineProperty(target, name, descriptor)
      if (!restored) throw new Error(`cannot restore DSH Workspace method ${name}() descriptor`)
    }

    function interceptMethod(target, name, key, order, handler) {
      target = interceptorTarget(target)
      const root = interceptorRoot()
      let methods = root.get(target)
      if (methods === undefined) {
        methods = new Map()
        root.set(target, methods)
      }
      let state = methods.get(name)
      if (state === undefined) {
        const original = target[name]
        const originalDescriptor = Object.getOwnPropertyDescriptor(target, name)
        const entries = new Map()
        state = { original, originalDescriptor, entries, wrapper: undefined }
        state.wrapper = function (...args) {
          const chain = [...entries.values()].sort((left, right) => left.order - right.order)
          const receiver = this
          const dispatch = (index, currentArgs) => {
            const entry = chain[index]
            if (entry === undefined) return Reflect.apply(original, receiver, currentArgs)
            return entry.handler(
              (...nextArgs) => dispatch(index + 1, nextArgs.length === 0 ? currentArgs : nextArgs),
              ...currentArgs
            )
          }
          return dispatch(0, args)
        }
        methods.set(name, state)
        try {
          target[name] = state.wrapper
          if (target[name] !== state.wrapper) throw new Error('method replacement was ignored')
        } catch (error) {
          let failure = error
          try {
            restoreOwnDescriptor(target, name, originalDescriptor)
          } catch (restoreError) {
            failure = new AggregateError([error, restoreError], 'method replacement and rollback both failed')
          }
          methods.delete(name)
          if (methods.size === 0) root.delete(target)
          throw new Error(`cannot intercept DSH Workspace method ${name}()`, { cause: failure })
        }
      }
      state.entries.set(key, { order, handler })
      return () => {
        state.entries.delete(key)
        if (state.entries.size !== 0) return
        if (target[name] === state.wrapper) restoreOwnDescriptor(target, name, state.originalDescriptor)
        methods.delete(name)
        if (methods.size === 0) root.delete(target)
      }
    }

    function installStyles() {
      if (typeof document === 'undefined') return () => {}

      let style = document.querySelector(`style[data-dgw-owner="${STYLE_OWNER}"]`)
      if (style === null) {
        style = document.createElement('style')
        style.id = STYLE_ID
        style.dataset.dgwOwner = STYLE_OWNER
        style.dataset.dgwReferences = '0'
        document.head.appendChild(style)
      }
      // DSH claims untagged <style> tags for whichever bundle materializes next and HMR
      // removes style[data-plugin=<id>]: tag our own sheet so it is never mis-attributed
      // to another plugin and never removed together with that plugin.
      style.dataset.plugin = PLUGIN_NAME
      style.textContent = styleText

      const parsedReferences = Number(style.dataset.dgwReferences)
      const references = Number.isSafeInteger(parsedReferences) && parsedReferences >= 0
        ? parsedReferences
        : 0
      style.dataset.dgwReferences = String(references + 1)

      return () => {
        const current = Number(style.dataset.dgwReferences)
        const remaining = Number.isSafeInteger(current) && current > 0 ? current - 1 : 0
        style.dataset.dgwReferences = String(remaining)
        if (remaining === 0 && style.parentNode !== null) style.parentNode.removeChild(style)
      }
    }

    function GeneralWorkspaceAction({ wide, onStart }) {
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const handleClick = () => {
        if (busy || typeof onStart !== 'function') return
        setBusy(true)
        setFailed(false)
        Promise.resolve()
          .then(() => onStart())
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }
      const label = busy ? ACTION_BUSY_LABEL : failed ? ACTION_ERROR_LABEL : ACTION_LABEL
      const Icon = busy
        ? IconLoadingOutline16
        : failed
          ? IconWarningOutline16
          : IconNewChatOutline16
      const button = React.createElement(
        'button',
        {
          type: 'button',
          className: 'dgw-button',
          'aria-label': label,
          'aria-busy': busy,
          'data-dsh-default-workspace-action': true,
          'data-error': failed || undefined,
          disabled: busy,
          onClick: handleClick
        },
        React.createElement(Icon, {
          className: busy ? 'dgw-spin' : undefined,
          size: wide ? 14 : 18
        }),
        wide && React.createElement('span', { className: 'dgw-button-label' }, label)
      )

      return React.createElement(
        'div',
        { className: wide ? 'dgw-action' : 'dgw-action dgw-action-rail' },
        React.createElement(Tooltip, {
          label,
          delayMs: 500,
          disabled: wide,
          children: button
        })
      )
    }

    function apply(ctx) {
      const uiWorkspace = ctx.uiWorkspace
      const workspaces = ctx.workspaces
      if (typeof uiWorkspace?.startSession !== 'function') {
        throw new Error('incompatible DSH uiWorkspace service: missing startSession()')
      }
      if (!workspaces?.list || typeof workspaces.list.getSnapshot !== 'function') {
        throw new Error('incompatible DSH workspaces service: missing list.getSnapshot()')
      }
      for (const method of ['rename', 'delete', 'insertBefore']) {
        if (typeof workspaces[method] !== 'function') {
          throw new Error(`incompatible DSH workspaces service: missing ${method}()`)
        }
      }
      const statusControllers = new Set()
      let statusPromise
      let startPromise
      let disposed = false

      function loadStatus(force = false) {
        if (force) statusPromise = undefined
        if (statusPromise !== undefined) return statusPromise

        const controller = new AbortController()
        statusControllers.add(controller)
        const request = fetch(STATUS_PATH, { method: 'GET', credentials: 'same-origin', signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status)
            const body = await response.json()
            if (!body || body.ok !== true || typeof body.workspaceId !== 'string'
              || typeof body.path !== 'string' || body.title !== DEFAULT_WORKSPACE_TITLE) {
              throw new Error('invalid managed Workspace response')
            }
            return body
          })
          .catch((error) => {
            if (statusPromise === request) statusPromise = undefined
            throw error
          })
          .finally(() => {
            statusControllers.delete(controller)
          })
        statusPromise = request
        return request
      }

      function findManagedWorkspace(status) {
        return workspaces.list.getSnapshot().items.find((item) =>
          item.workspaceId === status.workspaceId || item.path === status.path)
      }

      async function refreshWorkspaces() {
        if (typeof workspaces.refresh === 'function') await workspaces.refresh()
      }

      async function resolveManagedWorkspaceId() {
        let status = await loadStatus()
        let workspace = findManagedWorkspace(status)
        if (workspace !== undefined) return workspace.workspaceId

        await refreshWorkspaces()
        workspace = findManagedWorkspace(status)
        if (workspace !== undefined) return workspace.workspaceId

        status = await loadStatus(true)
        await refreshWorkspaces()
        workspace = findManagedWorkspace(status)
        if (workspace === undefined) throw new Error('managed Workspace is not in the client baseline')
        return workspace.workspaceId
      }

      async function startManagedSession() {
        if (startPromise !== undefined) return startPromise
        let operation
        operation = (async () => {
          try {
            const workspaceId = await resolveManagedWorkspaceId()
            if (!disposed) uiWorkspace.startSession(workspaceId)
          } catch (error) {
            if (!disposed) console.warn(`${PLUGIN_NAME} new session failed:`, error)
            throw error
          } finally {
            if (startPromise === operation) startPromise = undefined
          }
        })()
        startPromise = operation
        return operation
      }

      async function managedAction(workspaceId) {
        const status = await loadStatus()
        if (workspaceId === status.workspaceId) return true
        const item = workspaces.list.getSnapshot().items.find((candidate) =>
          candidate.workspaceId === workspaceId)
        return item?.path === status.path
      }

      async function interceptRename(next, workspaceId, title) {
        if (await managedAction(workspaceId)) throw new Error(PROTECTED_MESSAGE)
        return await next(workspaceId, title)
      }

      async function interceptDelete(next, workspaceId) {
        if (await managedAction(workspaceId)) throw new Error(PROTECTED_MESSAGE)
        return await next(workspaceId)
      }

      async function interceptInsertBefore(next, workspaceId, beforeWorkspaceId) {
        const sourceManaged = await managedAction(workspaceId)
        const anchorManaged = beforeWorkspaceId === undefined
          ? false
          : await managedAction(beforeWorkspaceId)
        if (sourceManaged || anchorManaged) {
          await refreshWorkspaces()
          throw new Error(PROTECTED_MESSAGE)
        }
        return await next(workspaceId, beforeWorkspaceId)
      }

      const interceptorKey = Symbol(PLUGIN_NAME)
      ctx.effect(() => {
        const interceptorCleanups = []
        try {
          interceptorCleanups.push(interceptMethod(workspaces, 'rename', interceptorKey, 10, interceptRename))
          interceptorCleanups.push(interceptMethod(workspaces, 'delete', interceptorKey, 10, interceptDelete))
          interceptorCleanups.push(interceptMethod(workspaces, 'insertBefore', interceptorKey, 10, interceptInsertBefore))
        } catch (error) {
          for (const cleanup of interceptorCleanups.reverse()) cleanup()
          throw new Error('cannot install the managed Workspace client policy', { cause: error })
        }
        return () => {
          disposed = true
          for (const controller of statusControllers) controller.abort()
          statusControllers.clear()
          statusPromise = undefined
          startPromise = undefined
          for (const cleanup of interceptorCleanups.reverse()) cleanup()
        }
      }, `${PLUGIN_NAME}: client Workspace policy`)

      ctx.effect(
        () => installStyles(),
        `${PLUGIN_NAME}: styles`
      )

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: ACTION_ID,
        order: 100,
        label: ACTION_LABEL,
        inject: () => ({ onStart: startManagedSession })
      }, GeneralWorkspaceAction))

      void loadStatus().catch((error) => {
        if (!disposed) console.warn(`${PLUGIN_NAME} status unavailable:`, error)
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
