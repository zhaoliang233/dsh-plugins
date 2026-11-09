import assert from 'node:assert/strict'
import test from 'node:test'

import { createMountManager } from '../lib/mount-manager.js'
import { normalizeSettings } from '../lib/store.js'

/**
 * 造一个够用的假 Cordis ctx：plugin() 返回可 await、可 dispose 的 fiber，
 * 并把注册的工具名写进 tools.view() 的 knownNames（模拟 host 全局层）。
 * @param {object} [options]
 */
function fakeHost(options = {}) {
  const registered = new Set(options.initialTools ?? [])
  const mounts = []
  let exporters = []
  const ctx = {
    tools: { view: () => ({ knownNames: new Set(registered) }) },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      exporter: (exporter) => {
        exporters.push(exporter)
        return () => {
          exporters = exporters.filter((item) => item !== exporter)
        }
      }
    },
    plugin: (module, config) => {
      const record = { module, config, disposed: false }
      mounts.push(record)
      if (options.failModules === true) throw new Error('boom')
      const emit = options.emitTools === false ? [] : [`mcp__${config.serverName}__tool_a`]
      for (const name of emit) registered.add(name)
      record.tools = emit
      const fiber = {
        // 可 await：解析成 undefined（解析成 thenable 自身会无限递归）。
        then: (resolve, reject) =>
          options.hangApply === true && config.serverName.startsWith('probe') === false
            ? new Promise(() => {})
            : Promise.resolve().then(() => (options.failApply === true ? reject(new Error('connect failed')) : resolve())),
        dispose: async () => {
          record.disposed = true
          for (const name of record.tools) registered.delete(name)
        }
      }
      return fiber
    }
  }
  return {
    ctx,
    mounts,
    registered,
    emitLog: (message) => {
      for (const exporter of exporters) exporter.export(message)
    }
  }
}

const settingsOf = (servers, enabled = true) => normalizeSettings({ enabled, servers })

test('挂载后工具出现在全局层，卸载后消失', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node' }]))
  assert.deepEqual(
    manager.status().map((item) => [item.serverName, item.state, item.tools]),
    [['alpha', 'mounted', ['mcp__alpha__tool_a']]]
  )
  await manager.disposeAll()
  assert.deepEqual(manager.status(), [])
  assert.equal(host.registered.size, 0)
  assert.equal(host.mounts[0].disposed, true)
})

test('配置变化时先卸后挂，且第二次对账幂等', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node' }]))
  const summary = await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node', args: ['--x'] }]))
  assert.deepEqual(summary.mounted, ['alpha'])
  assert.equal(host.mounts.length, 2, '改配置会重新挂载')
  assert.equal(host.mounts[0].disposed, true)

  const idempotent = await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node', args: ['--x'] }]))
  assert.deepEqual(idempotent.unchanged, ['a'])
  assert.equal(host.mounts.length, 2, '配置没变就不再挂载')
})

test('apply 失败被记成 failed，而不是让插件整体崩掉', async () => {
  const host = fakeHost({ failApply: true })
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node' }]))
  const [record] = manager.status()
  assert.equal(record.state, 'failed')
  assert.match(record.error, /connect failed/u)
})

test('缺失凭据的条目被拦下，且不产生挂载', async () => {
  const host = fakeHost()
  const manager = createMountManager({
    ctx: host.ctx,
    mcpModule: { apply() {} },
    resolveCredential: async () => undefined
  })
  const summary = await manager.reconcile(
    settingsOf([
      { id: 'a', serverName: 'alpha', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'credential:TOK' } }
    ])
  )
  assert.equal(host.mounts.length, 0)
  assert.match(summary.blocked[0].reason, /TOK/u)
})

test('凭据解析成功时替换成明文交给挂载配置', async () => {
  const host = fakeHost()
  const manager = createMountManager({
    ctx: host.ctx,
    mcpModule: { apply() {} },
    resolveCredential: async (ref) => (ref === 'TOK' ? { value: 'resolved-secret' } : undefined)
  })
  await manager.reconcile(
    settingsOf([
      {
        id: 'a',
        serverName: 'alpha',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:1/mcp',
        headers: { Authorization: 'Bearer credential:TOK' }
      }
    ])
  )
  assert.equal(host.mounts[0].config.headers.Authorization, 'Bearer resolved-secret')
  assert.equal(JSON.stringify(manager.status()).includes('resolved-secret'), false, '状态接口不得回显明文')
})

test('URL 里的凭据占位符同样被解析（不能只认 env/headers）', async () => {
  const host = fakeHost()
  const manager = createMountManager({
    ctx: host.ctx,
    mcpModule: { apply() {} },
    resolveCredential: async (ref) => (ref === 'URL_TOK' ? { value: 'url-secret' } : undefined)
  })
  const summary = await manager.reconcile(
    settingsOf([
      {
        id: 'a',
        serverName: 'alpha',
        transport: 'streamable-http',
        url: 'http://127.0.0.1:1/mcp?token=credential:URL_TOK'
      }
    ])
  )
  assert.deepEqual(summary.blocked, [], 'URL 里的键解析得到，就不该被拦')
  assert.equal(host.mounts[0].config.url, 'http://127.0.0.1:1/mcp?token=url-secret')
  assert.equal(JSON.stringify(manager.status()).includes('url-secret'), false, '状态接口不得回显明文')
})

test('mcp-client 的日志按服务器名归集，供状态页诊断', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  await manager.reconcile(settingsOf([{ id: 'a', serverName: 'alpha', command: 'node' }]))
  host.emitLog({ name: 'x', args: ['mcp-client(alpha): reconnecting in 500ms (attempt 1)'] })
  host.emitLog({ name: 'x', args: ['unrelated log line'] })
  const [record] = manager.status()
  assert.deepEqual(record.logs, ['mcp-client(alpha): reconnecting in 500ms (attempt 1)'])
})

test('与 profile 组合重名的条目不会被挂载', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  const summary = await manager.reconcile(
    settingsOf([{ id: 'a', serverName: 'figma', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' }]),
    new Map([['figma', '配置文件中的 MCP 条目']])
  )
  assert.equal(host.mounts.length, 0)
  assert.match(summary.blocked[0].reason, /配置文件/u)
})

test('验证探针：临时挂载拿到工具后立刻卸载，且不进入托管清单', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  const result = await manager.probe({ id: 'srv-a', serverName: 'alpha', transport: 'stdio', command: 'node', args: [], env: {}, headers: {}, cwd: '', url: '', toolCallTimeoutMs: 60000, failOnStartupError: false })

  assert.equal(result.ok, true)
  assert.deepEqual(result.tools, ['tool_a'], '工具名要去掉探针前缀')
  assert.equal(typeof result.elapsedMs, 'number')
  assert.equal(host.mounts.length, 1)
  assert.match(host.mounts[0].config.serverName, /^probe/u, '探针用独立临时名字，避免与已挂载实例抢 serverName 预留')
  assert.equal(host.mounts[0].config.failOnStartupError, true, '验证要确定答案：连不上必须是失败')
  assert.equal(host.mounts[0].disposed, true, '验证完必须卸载')
  assert.deepEqual(manager.status(), [], '验证不写托管清单')
  assert.equal(host.registered.size, 0, '探针注册的工具要回收干净')
})

test('验证探针：连不上时返回可读原因，并回收失败的实例', async () => {
  const host = fakeHost({ failApply: true })
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  const result = await manager.probe({ id: 'srv-a', serverName: 'alpha', transport: 'stdio', command: 'node', args: [], env: {}, headers: {}, cwd: '', url: '', toolCallTimeoutMs: 60000, failOnStartupError: false })
  assert.equal(result.ok, false)
  assert.match(result.error, /connect failed|连接/u)
  assert.equal(host.mounts[0].disposed, true, '失败的探针也要收掉（它带着失败的连接与可能的子进程）')
})

test('验证探针：超时会中止等待并给出超时原因', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} } })
  // 让 apply 永远不 settle：改造 plugin() 返回一个永不 resolve 的 fiber
  const original = host.ctx.plugin
  host.ctx.plugin = (module, config) => {
    const record = { module, config, disposed: false }
    host.mounts.push(record)
    return {
      then: () => new Promise(() => {}),
      dispose: async () => {
        record.disposed = true
      }
    }
  }
  void original
  const result = await manager.probe({ id: 'srv-a', serverName: 'alpha', transport: 'stdio', command: 'node', args: [], env: {}, headers: {}, cwd: '', url: '', toolCallTimeoutMs: 60000, failOnStartupError: false }, { timeoutMs: 60 })
  assert.equal(result.ok, false)
  assert.match(result.error, /超时/u)
  assert.equal(host.mounts[0].disposed, true)
})

test('验证探针：缺凭据直接返回原因，连尝试都不尝试', async () => {
  const host = fakeHost()
  const manager = createMountManager({ ctx: host.ctx, mcpModule: { apply() {} }, resolveCredential: async () => undefined })
  const result = await manager.probe({
    id: 'srv-a',
    serverName: 'alpha',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:1/mcp',
    headers: { Authorization: 'Bearer credential:TOK' },
    command: '',
    args: [],
    env: {},
    cwd: '',
    toolCallTimeoutMs: 60000,
    failOnStartupError: false
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /TOK/u)
  assert.equal(host.mounts.length, 0)
})
