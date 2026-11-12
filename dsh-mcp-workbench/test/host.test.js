import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import {
  ACTIONS,
  ACTION_PATH,
  CLIENT_HEADER,
  CSRF_HEADER,
  MAX_BODY_BYTES,
  PLUGIN_NAME,
  SETTINGS_ENTRY,
  STATUS_PATH,
  classifyDshVersion,
  clientRequestRejection,
  createLegacyConfigSchema,
  readJsonBody,
  sameOriginRequest,
  statusPayload
} from '../lib/index.js'

test('版本门：线内通过、线外拒绝，rc.2 起列入逐版本验证清单', () => {
  assert.deepEqual(classifyDshVersion('0.2.2-alpha.2'), { supported: true, verified: true, normalized: '0.2.2-alpha.2' })
  assert.deepEqual(classifyDshVersion('0.2.2-rc.2'), { supported: true, verified: true, normalized: '0.2.2-rc.2' })
  assert.equal(classifyDshVersion('0.2.2-alpha.3').supported, true)
  assert.equal(classifyDshVersion('0.2.2-alpha.3').verified, false, '同线内未逐条核对的版本只带警告运行')
  assert.equal(classifyDshVersion('0.2.2-alpha.1').supported, false, '下界是 alpha.2')
  assert.equal(classifyDshVersion('0.2.2-rc.1').supported, true)
  assert.equal(classifyDshVersion('0.2.2').supported, true)
  assert.equal(classifyDshVersion('0.2.1').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)
})

test('设置条目 id 与包名同源（客户端 bundle 里的字面量必须一致）', () => {
  assert.equal(SETTINGS_ENTRY, 'dsh-mcp-workbench')
  assert.equal(SETTINGS_ENTRY, PLUGIN_NAME)
})

test('Config 必须是模块导出，且旧 servers 字段保留（迁移源）', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
  assert.match(source, /^export const Config = /mu)
  const schema = source.slice(source.indexOf('export function createLegacyConfigSchema'))
  assert.match(schema, /servers: z\.array\(server\)\.default\(\[\]\)/u)
  assert.match(schema, /failOnStartupError: z\.boolean\(\)\.default\(false\)/u, '旧字段保留，旧数据才能被读到')
})

test('路由与动作常量保持稳定（客户端 bundle 依赖字面量）', () => {
  assert.equal(STATUS_PATH, '/dsh-mcp-workbench/status')
  assert.equal(ACTION_PATH, '/dsh-mcp-workbench/action')
  assert.equal(CLIENT_HEADER, 'x-dsh-mcp-workbench-client')
  assert.equal(CSRF_HEADER, 'x-dsh-mcp-workbench-csrf')
  assert.deepEqual([...ACTIONS], ['import'])
})

test('同源判定：loopback + sec-fetch-site + origin/host 三者一致', () => {
  const request = (headers, address = '127.0.0.1') => ({ headers, socket: { remoteAddress: address } })
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })), true)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.test' })), false)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'not-a-url' })), false)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080' })), true)
  assert.equal(sameOriginRequest(request({ host: 'h', origin: 'http://h' }, '10.0.0.5')), false, '非 loopback 一律拒绝')
})

test('客户端请求必须同时满足 DSH 鉴权、同源与固定客户端头', () => {
  const request = (headers, address = '127.0.0.1') => ({ headers, socket: { remoteAddress: address } })
  const ok = request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', [CLIENT_HEADER]: '1' })
  assert.equal(clientRequestRejection(ok, undefined), 401, '连接层不可用时必须 fail closed')
  const passing = { requestRejection: () => undefined }
  assert.equal(clientRequestRejection(request({ host: 'h', origin: 'http://h' }), passing), 403)
  assert.equal(clientRequestRejection({ ...ok, headers: { ...ok.headers, [CLIENT_HEADER]: '0' } }, passing), 403)
  assert.equal(clientRequestRejection(ok, { requestRejection: () => 401 }), 401)
  assert.equal(clientRequestRejection(ok, passing), undefined)
})

/** 造一个够用的请求对象（可 async iterate + headers）。 */
function fakeRequest(body, headers = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(body)]
  return {
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  }
}

test('readJsonBody：内容类型、大小与 JSON 形状都要过关', async () => {
  assert.deepEqual(await readJsonBody(fakeRequest('{"action":"import"}')), { action: 'import' })
  assert.deepEqual(await readJsonBody(fakeRequest(undefined)), {})
  await assert.rejects(() => readJsonBody(fakeRequest('{}', { 'content-type': 'text/plain' })), /application\/json/u)
  await assert.rejects(() => readJsonBody(fakeRequest('[1,2]')), /有效 JSON/u)
  await assert.rejects(() => readJsonBody(fakeRequest('x'.repeat(MAX_BODY_BYTES + 1))), /过大/u)
})

function fakeState(overrides = {}) {
  return {
    csrfToken: 'tok',
    version: '0.2.2-rc.2',
    versionSupported: true,
    versionVerified: true,
    runtime: 'ready',
    credentials: null,
    lastError: '',
    ...overrides
  }
}

test('statusPayload：定位到官方管理器条目时给出真实 id 与可用性', () => {
  const payload = statusPayload(fakeState(), {
    managerEntry: () => ({ available: true, entryId: 'mcp-manager', moduleName: '@deepseek-ai/dsh-mcp-manager', phase: 'active', reason: 'found' }),
    profileTargets: () => [{ entryId: 'mcp-static', serverName: 'jira', transport: 'streamable-http', enabled: true }]
  })
  assert.equal(payload.ok, true)
  assert.equal(payload.runtime, 'ready')
  assert.equal(payload.manager.available, true)
  assert.equal(payload.manager.entryId, 'mcp-manager')
  assert.equal(payload.profileTargets.length, 1)
  assert.deepEqual([...payload.actions], ['import'])
  assert.equal(payload.csrf, 'tok')
})

test('statusPayload：没有官方管理器时 available=false 且带原因', () => {
  const missing = statusPayload(fakeState({ runtime: 'manager-missing' }), {
    managerEntry: () => ({ available: false, entryId: 'mcp-manager', moduleName: '@deepseek-ai/dsh-mcp-manager', phase: null, reason: 'missing' }),
    profileTargets: () => []
  })
  assert.equal(missing.manager.available, false)
  assert.equal(missing.manager.reason, 'missing')
  assert.equal(missing.runtime, 'manager-missing')
})

test('statusPayload：管理器被禁用时 unavailable 且原因是 disabled', () => {
  const disabled = statusPayload(fakeState(), {
    managerEntry: () => ({ available: false, entryId: 'mcp-manager', moduleName: '@deepseek-ai/dsh-mcp-manager', phase: 'active', reason: 'disabled' }),
    profileTargets: () => []
  })
  assert.equal(disabled.manager.available, false)
  assert.equal(disabled.manager.reason, 'disabled')
})

test('旧条目 schema 能解析旧数据并补默认值（迁移源可读）', async (t) => {
  const root = await findDshRoot()
  if (root === undefined) {
    t.skip('本机没有 DSH 安装，跳过需要 schemastery 的用例')
    return
  }
  const require = createRequire(join(root, 'package.json'))
  const z = (await import(require.resolve('@deepseek-ai/schemastery'))).default
  const schema = createLegacyConfigSchema(z)
  const value = schema({ servers: [{ serverName: 'alpha', command: 'node', label: 'Alpha' }] })
  assert.equal(value.servers[0].transport, 'stdio')
  assert.equal(value.servers[0].toolCallTimeoutMs, 60000)
  assert.equal(value.servers[0].label, 'Alpha')
  assert.deepEqual(value.servers[0].env, {})
})

/**
 * 从 PATH 上的 dsh 可执行文件反查 DSH 安装目录（与宿主半体的定位策略同源）。
 * @returns {Promise<string | undefined>}
 */
async function findDshRoot() {
  const { readFile, realpath, access } = await import('node:fs/promises')
  for (const entry of (process.env.PATH ?? '').split(':')) {
    if (entry === '') continue
    const candidate = join(entry, 'dsh')
    try {
      await access(candidate)
    } catch {
      continue
    }
    let directory = dirname(await realpath(candidate).catch(() => candidate))
    for (let depth = 0; depth < 8; depth += 1) {
      try {
        const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
        if (manifest?.name === '@deepseek-ai/dsh') return directory
      } catch {
        /* 继续上溯 */
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return undefined
}
