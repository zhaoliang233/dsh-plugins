import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { createHarness } from './harness.js'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** bundle 在 vm 沙箱里执行，跨 realm 对象比较前先过一遍 JSON。 */
const plain = (value) => JSON.parse(JSON.stringify(value))

function createPrimitivesStub() {
  const icon = (name) => {
    const Component = () => null
    Component.displayName = name
    return Component
  }
  return {
    IconChevronDownOutlineMedium: icon('IconChevronDownOutlineMedium'),
    IconCodeOutlineMedium: icon('IconCodeOutlineMedium'),
    IconEditOutlineMedium: icon('IconEditOutlineMedium'),
    IconLinkOutlineMedium: icon('IconLinkOutlineMedium'),
    IconLoadingOutlineMedium: icon('IconLoadingOutlineMedium'),
    IconPlusOutlineMedium: icon('IconPlusOutlineMedium'),
    IconRefreshOutlineMedium: icon('IconRefreshOutlineMedium'),
    IconTrashOutlineMedium: icon('IconTrashOutlineMedium'),
    Modal: undefined,
    Tooltip: undefined
  }
}

/** 用最小 React 桩 + stub primitives 加载 bundle，返回它的导出。 */
function loadBundle(overrides = {}) {
  const registered = []
  const react = overrides.react
  const primitives = overrides.primitives ?? createPrimitivesStub()
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => registered.push(spec) } },
    console,
    document: overrides.document,
    setTimeout,
    clearTimeout,
    URL,
    Promise,
    Math,
    Date,
    JSON,
    Object,
    Array,
    String,
    Number,
    Set,
    Map,
    Error,
    AbortController,
    fetch: overrides.fetch
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.equal(registered.length, 1, 'bundle 必须只注册一次')
  const spec = registered[0]
  assert.equal(spec.id, 'dsh-mcp-workbench')
  return {
    spec,
    exports: spec.factory((name) => {
      if (name === 'react') return react
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
      return undefined
    })
  }
}

const { React } = createHarness()
const { exports: api } = loadBundle({ react: React })
const inn = api.__internals

test('bundle 注册 id 与注入的服务名', () => {
  assert.equal(api.inject.includes('slots'), true)
  assert.equal(api.inject.includes('configForms'), true)
  assert.equal(api.inject.includes('remote.mcpManager'), true, '带点号命名空间必须单独注入')
  assert.equal(api.inject.includes('remote.credentials'), true)
})

test('decodeServers：官方 dict → 按名字排序的数组', () => {
  const rows = plain(
    inn.decodeServers({
      servers: {
        zeta: { transport: 'stdio', command: 'node' },
        alpha: { transport: 'streamable-http', url: 'https://a/mcp', enabled: false }
      }
    })
  )
  assert.deepEqual(
    rows.map((row) => row.serverName),
    ['alpha', 'zeta']
  )
  assert.equal(rows[0].transport, 'streamable-http')
  assert.equal(rows[0].enabled, false)
  assert.equal(rows[1].startupTimeoutMs, 30000)
  assert.deepEqual(rows[1].reconnect, { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 })
})

test('decodeServers：非对象/数组的 servers 一律返回空', () => {
  assert.deepEqual(plain(inn.decodeServers(undefined)), [])
  assert.deepEqual(plain(inn.decodeServers({ servers: [] })), [])
  assert.deepEqual(plain(inn.decodeServers({ servers: null })), [])
})

test('validateDraft：名字、必填项、URL 与凭据键名', () => {
  const ok = { transport: 'stdio', command: 'node', argsText: '', cwd: '', url: '', envRows: [], headerRows: [] }
  assert.deepEqual(plain(inn.validateDraft(ok, 'demo', [], undefined)), [])
  assert.match(inn.validateDraft(ok, 'bad name', [], undefined).join('；'), /服务器名/u)
  assert.match(inn.validateDraft({ ...ok, command: '' }, 'demo', [], undefined).join('；'), /必须填写可执行命令/u)
  assert.match(
    inn.validateDraft({ ...ok, transport: 'streamable-http', url: '' }, 'demo', [], undefined).join('；'),
    /必须填写 URL/u
  )
  assert.match(
    inn.validateDraft({ ...ok, transport: 'streamable-http', url: 'ftp://x' }, 'demo', [], undefined).join('；'),
    /http/u
  )
  assert.deepEqual(
    plain(inn.validateDraft({ ...ok, transport: 'streamable-http', url: 'https://h/mcp?t=${credential:X}' }, 'demo', [], undefined)),
    []
  )
  assert.match(
    inn.validateDraft({ ...ok, envRows: [{ name: 'TOKEN', value: '${credential:}' }] }, 'demo', [], undefined).join('；'),
    /凭据键名/u
  )
})

test('legacyToManaged：旧 credential:KEY → 官方模板，丢弃展示名', () => {
  const { entry } = plain(
    inn.legacyToManaged({
      label: 'GitHub',
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['--token', 'credential:GH_TOKEN'],
      env: { TOKEN: 'credential:GH_TOKEN' },
      toolCallTimeoutMs: 30000
    })
  )
  assert.equal(entry.serverName, 'github')
  assert.equal(entry.env.TOKEN, '${credential:GH_TOKEN}')
  assert.equal(entry.args[1], '${credential:GH_TOKEN}')
  assert.equal('label' in entry, false)
  assert.equal(entry.startupTimeoutMs, 30000)
})

test('splitCredential / joinCredential：官方模板往返', () => {
  const parts = plain(inn.splitCredential('Bearer ${credential:TOKEN}'))
  assert.deepEqual(parts, { prefix: 'Bearer ', key: 'TOKEN', suffix: '' })
  assert.equal(inn.joinCredential(parts), 'Bearer ${credential:TOKEN}')
  assert.deepEqual(plain(inn.splitCredential('https://h/mcp?t=${credential:K}x')), { prefix: 'https://h/mcp?t=', key: 'K', suffix: 'x' })
  assert.equal(inn.splitCredential('plain value'), null)
  assert.equal(inn.joinCredential({ prefix: '', key: 'K', suffix: '' }), '${credential:K}')
})

test('credentialRefsOf：扫描官方模板允许的全部位置', () => {
  assert.deepEqual(
    plain(inn.credentialRefsOf({
      command: '${credential:CMD}',
      args: ['--k=${credential:ARG}'],
      cwd: '/tmp/${credential:CWD}',
      url: 'https://h?t=${credential:URL}',
      env: { TOKEN: '${credential:ENV}' },
      headers: { Authorization: 'Bearer ${credential:HEADER}' }
    })),
    ['CMD', 'ARG', 'CWD', 'URL', 'ENV', 'HEADER']
  )
})

test('rowState：官方连接状态 union 的展示', () => {
  const server = { serverName: 'x', enabled: true }
  assert.equal(inn.rowState(server, null, 'ready', '').tone, 'idle')
  assert.equal(inn.rowState({ ...server, enabled: false }, null, 'ready', '').short, '已停用')
  assert.equal(inn.rowState(server, { status: { state: 'connected', toolCount: 3 } }, 'ready', '').short, '已连接 · 3 个工具')
  assert.equal(inn.rowState(server, { status: { state: 'connected', toolCount: 0 } }, 'ready', '').tone, 'warn')
  assert.equal(inn.rowState(server, { status: { state: 'connecting', attempt: 0 } }, 'ready', '').short, '连接中')
  assert.equal(inn.rowState(server, { status: { state: 'reconnecting', attempt: 2, maxAttempts: 10, lastError: 'boom' } }, 'ready', '').short, '重连 2/10')
  assert.equal(inn.rowState(server, { status: { state: 'waiting-credentials', lastError: 'missing' } }, 'ready', '').short, '缺凭据')
  assert.equal(inn.rowState(server, { status: { state: 'failed', reason: 'gave-up' } }, 'ready', '').tone, 'error')
  assert.equal(inn.rowState(server, { status: { state: 'disabled' } }, 'ready', '').short, '已停用')
  assert.match(inn.rowState(server, null, 'manager-missing', '').text, /官方 MCP 管理器/u)
  assert.match(inn.rowState(server, null, 'ready', '与启动配置重名').short, /重名/u)
})

test('writeConfig：宿主拒绝与传输错误都要变成可见错误', async () => {
  const errors = []
  const refused = { mutate: async () => false }
  assert.equal(await inn.writeConfig({}, refused, [{ op: 'set', path: ['servers'], value: {} }], (message) => errors.push(message)), false)
  assert.match(errors.join('|'), /被宿主拒绝/u)
  const missing = await inn.writeConfig({}, null, [], (message) => errors.push(message))
  assert.equal(missing, false)
  assert.match(errors.join('|'), /设置接口不可用/u)
})

/** @param {any} body */
function fakeResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

/** 一个能渲染分区的最小客户端 ctx。 */
function createClientCtx({ servers = {}, legacyServers = [], views = [], mutate = async () => true, probe = async () => ({ ok: true, value: { ok: true, toolNames: ['t'] } }) } = {}) {
  const calls = []
  const registered = []
  const forms = {
    'mcp-manager': {
      getSnapshot: () => ({ status: 'ready', value: { servers }, writable: true, revision: 1 }),
      subscribe: () => () => {},
      mutate: async (ops) => {
        calls.push(ops)
        return mutate(ops)
      }
    },
    'dsh-mcp-workbench': {
      getSnapshot: () => ({ status: 'ready', value: { enabled: true, servers: legacyServers }, writable: true, revision: 1 }),
      subscribe: () => () => {},
      mutate: async (ops) => {
        calls.push(ops)
        return true
      }
    }
  }
  const ctx = {
    configForms: { get: (id) => forms[id] ?? null },
    remote: {
      mcpManager: {
        watch: async function* () {
          yield views
          await new Promise(() => {})
        },
        probe,
        restart: async () => ({ ok: true })
      }
    },
    slots: {
      inject: (_name, callback) => {
        callback()
      },
      register: (options, Component) => {
        registered.push({ options, Component })
        return () => {}
      }
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    }
  }
  return { ctx, calls, registered }
}

const STATUS = {
  ok: true,
  csrf: 'tok',
  actions: ['import'],
  runtime: 'ready',
  dshVersion: '0.2.2-rc.2',
  versionSupported: true,
  versionVerified: true,
  manager: { available: true, entryId: 'mcp-manager', moduleName: '@deepseek-ai/dsh-mcp-manager', phase: 'active', reason: 'found' },
  settingsEntry: 'dsh-mcp-workbench',
  profileTargets: [],
  lastError: ''
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('apply：注册设置分区、官方图标槽与 DOM 补丁兜底', () => {
  const { ctx, registered } = createClientCtx()
  api.apply(ctx)
  const names = registered.map((row) => row.options.name)
  assert.deepEqual(names, ['settings.section', 'settings.section.icon', 'settings.action'])
  const section = registered.find((row) => row.options.name === 'settings.section')
  assert.equal(section.options.id, 'mcp-console')
  assert.equal(section.options.order, 130)
})

test('分区渲染：官方清单行、状态 tag 与开关写入官方条目', async () => {
  const servers = {
    github: { transport: 'stdio', command: 'npx', args: ['-y', 'x'], enabled: true, startupTimeoutMs: 30000 },
    remote: { transport: 'streamable-http', url: 'https://h/mcp', enabled: false, startupTimeoutMs: 30000 }
  }
  const views = [
    { name: 'github', configured: true, status: { state: 'connected', toolCount: 2 } },
    { name: 'remote', configured: true, status: { state: 'disabled' } }
  ]
  const harness = createHarness()
  const sandboxApi = loadBundle({ react: harness.React, fetch: async () => fakeResponse(STATUS) }).exports
  // 用同一份 bundle 重新注册（沙箱里的 apply 才有 SectionContext）
  const fresh = createClientCtx({ servers, views })
  sandboxApi.apply(fresh.ctx)
  const FreshSection = fresh.registered.find((row) => row.options.name === 'settings.section').Component
  harness.render(harness.React.createElement(FreshSection))
  await tick()
  harness.render(harness.React.createElement(FreshSection))
  await tick()
  harness.render(harness.React.createElement(FreshSection))
  const text = harness.text()
  assert.match(text, /MCP 服务器/u)
  assert.match(text, /github/u)
  assert.match(text, /已连接 · 2 个工具/u)
  assert.match(text, /remote/u)
  assert.match(text, /已停用/u)
  // 点开关：写入官方条目的 servers.remote.enabled = true
  const toggle = harness.findAll((node) => node.tag === 'button' && String(node.props['aria-label'] ?? '').startsWith('启用 remote'))[0]
  assert.notEqual(toggle, undefined)
  harness.click(toggle)
  await tick()
  assert.deepEqual(plain(fresh.calls).at(-1), [{ op: 'set', path: ['servers', 'remote', 'enabled'], value: true }])
})

test('分区渲染：旧清单出现迁移横幅，迁移写入官方条目并清空旧条目', async () => {
  const legacyServers = [
    { serverName: 'old-one', transport: 'stdio', command: 'node', args: [], env: { TOKEN: 'credential:OLD' }, url: '', headers: {} }
  ]
  const harness = createHarness()
  const sandboxApi = loadBundle({ react: harness.React, fetch: async () => fakeResponse(STATUS) }).exports
  const fresh = createClientCtx({ legacyServers })
  sandboxApi.apply(fresh.ctx)
  const Section = fresh.registered.find((row) => row.options.name === 'settings.section').Component
  harness.render(harness.React.createElement(Section))
  await tick()
  harness.render(harness.React.createElement(Section))
  assert.match(harness.text(), /检测到旧版本托管的 1 个服务器/u)
  const migrate = harness.buttonByLabel('迁移到官方清单')
  assert.notEqual(migrate, undefined)
  harness.click(migrate)
  await tick()
  const writes = plain(fresh.calls)
  const official = writes.find((ops) => ops.some((op) => op.path?.[0] === 'servers' && op.path?.[1] === 'old-one'))
  assert.notEqual(official, undefined)
  assert.equal(official[0].value.env.TOKEN, '${credential:OLD}')
  assert.equal(official[0].value.enabled, true)
  const clear = writes.find((ops) => ops.some((op) => op.path?.length === 1 && op.path[0] === 'servers' && Array.isArray(op.value)))
  assert.notEqual(clear, undefined, '迁移成功后必须清空旧清单')
})

test('保存流程：先写停用态、probe 通过后再启用', async () => {
  const harness = createHarness()
  const sandboxApi = loadBundle({ react: harness.React, fetch: async () => fakeResponse(STATUS) }).exports
  const fresh = createClientCtx()
  sandboxApi.apply(fresh.ctx)
  const Section = fresh.registered.find((row) => row.options.name === 'settings.section').Component
  harness.render(harness.React.createElement(Section))
  await tick()
  harness.render(harness.React.createElement(Section))
  harness.click(harness.buttonByLabel('新增服务器'))
  harness.change(harness.inputByLabel('服务器名'), 'demo')
  harness.change(harness.inputByLabel('命令'), 'node')
  harness.click(harness.buttonByLabel('保存'))
  await tick()
  await tick()
  const writes = plain(fresh.calls)
  const first = writes.find((ops) => ops.some((op) => op.path?.[0] === 'servers' && op.path?.[1] === 'demo'))
  assert.notEqual(first, undefined)
  assert.equal(first[0].value.enabled, false, '先以停用态写入')
  const enable = writes.find((ops) => ops.some((op) => op.path?.length === 3 && op.path[2] === 'enabled' && op.value === true))
  assert.notEqual(enable, undefined, 'probe 通过后启用')
})
