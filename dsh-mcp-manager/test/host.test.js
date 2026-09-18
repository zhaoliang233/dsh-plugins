import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import {
  CLIENT_HEADER,
  importFromProfileEntry,
  statusPayload,
  CSRF_HEADER,
  MAX_BODY_BYTES,
  clientRequestRejection,
  classifyDshVersion,
  createSettingsSchema,
  readJsonBody,
  sameOriginRequest
} from '../lib/index.js'
import { unwrapModule } from '../lib/dsh.js'

test('版本门：线内通过、线外拒绝，且只把 0.1.6-alpha.1 当逐版本验证版本', () => {
  assert.deepEqual(classifyDshVersion('0.1.6-alpha.1'), { supported: true, verified: true, normalized: '0.1.6-alpha.1' })
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.6-rc.3').supported, true)
  assert.equal(classifyDshVersion('0.1.6').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.0').supported, false, 'alpha.0 早于已核对契约')
  assert.equal(classifyDshVersion('0.1.5').supported, false)
  assert.equal(classifyDshVersion('0.1.7-alpha.1').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)
  assert.equal(classifyDshVersion('0.1.6+build9').supported, true, '构建元数据不影响判定')
})

test('同源判定：loopback + sec-fetch-site + origin/host 三者一致', () => {
  const request = (headers, address = '127.0.0.1') => ({ headers, socket: { remoteAddress: address } })
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' })), true)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' })), true)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.test' })), false)
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080', origin: 'not-a-url' })), false)
  // 与 dsh-local-plugin-manager 同款姿态：没有 Origin 也没有 Sec-Fetch-Site 时**放行**
  // （老浏览器与同源 GET 都可能不带），真正的门槛是 loopback + 固定客户端头，
  // 而自定义头会逼出 CORS 预检，跨站表单伪造不了。
  assert.equal(sameOriginRequest(request({ host: '127.0.0.1:3080' })), true)
  assert.equal(sameOriginRequest(request({ host: 'h', origin: 'http://h' }, '10.0.0.5')), false, '非 loopback 一律拒绝')
})

test('客户端请求必须同时满足 DSH 鉴权、同源与固定客户端头', () => {
  const request = (headers, address = '127.0.0.1') => ({ headers, socket: { remoteAddress: address } })
  const ok = request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', [CLIENT_HEADER]: '1' })
  assert.equal(clientRequestRejection(ok, undefined), undefined)
  assert.equal(clientRequestRejection(request({ host: 'h', origin: 'http://h' }), undefined), 403)
  assert.equal(clientRequestRejection({ ...ok, headers: { ...ok.headers, [CLIENT_HEADER]: '0' } }, undefined), 403)
  assert.equal(
    clientRequestRejection(ok, { requestRejection: () => 401 }),
    401,
    'DSH 自身的鉴权结论优先返回'
  )
  assert.equal(clientRequestRejection(ok, { requestRejection: () => undefined }), undefined)
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
  assert.deepEqual(await readJsonBody(fakeRequest('{"action":"reconcile"}')), { action: 'reconcile' })
  assert.deepEqual(await readJsonBody(fakeRequest(undefined)), {})
  await assert.rejects(() => readJsonBody(fakeRequest('{}', { 'content-type': 'text/plain' })), /application\/json/u)
  await assert.rejects(() => readJsonBody(fakeRequest('[1,2]')), /有效 JSON/u)
  await assert.rejects(() => readJsonBody(fakeRequest('x'.repeat(MAX_BODY_BYTES + 1))), /过大/u)
})

test('unwrapModule：ESM 命名空间直接用，CommonJS 取 default', () => {
  const apply = () => {}
  assert.equal(unwrapModule({ apply, Config: {} }).apply, apply)
  assert.equal(unwrapModule({ default: { apply } }).apply, apply)
  assert.equal(unwrapModule({}), undefined)
  assert.equal(unwrapModule(undefined), undefined)
})

test('settings schema 与 store 的字段同构，并给出默认值', async (t) => {
  const root = await findDshRoot()
  if (root === undefined) {
    t.skip('本机没有 DSH 安装，跳过需要 schemastery 的用例')
    return
  }
  const require = createRequire(join(root, 'package.json'))
  const z = (await import(require.resolve('@deepseek-ai/schemastery'))).default
  const schema = createSettingsSchema(z)
  const value = schema({ servers: [{ serverName: 'alpha', command: 'node' }] })
  assert.equal(value.enabled, true)
  assert.equal(value.servers[0].transport, 'stdio')
  assert.equal(value.servers[0].toolCallTimeoutMs, 60_000)
  assert.deepEqual(value.servers[0].args, [])
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

test('CSRF 头名与客户端头名保持稳定（客户端 bundle 依赖字面量）', () => {
  assert.equal(CLIENT_HEADER, 'x-dsh-mcp-manager-client')
  assert.equal(CSRF_HEADER, 'x-dsh-mcp-manager-csrf')
})

test('statusPayload：与配置文件同名的托管条目要给出即时提示，且不回显任何值', () => {
  const state = {
    csrfToken: 'tok',
    runtime: 'ready',
    version: '0.1.6-alpha.1',
    versionSupported: true,
    module: {},
    moduleStrategy: 'loader-import',
    loadErrors: [],
    lastError: '',
    lastReconcile: null,
    settingsScope: {},
    mountManager: { status: () => [] }
  }
  const payload = statusPayload(state, {
    settingsView: () => ({
      enabled: true,
      servers: [
        { id: 'a', serverName: 'figma', enabled: true, transport: 'streamable-http', url: 'https://x.test/mcp', env: { TOKEN: 'credential:T' }, headers: {}, args: [], command: '', cwd: '', label: '', toolCallTimeoutMs: 60000, failOnStartupError: false }
      ]
    }),
    profileTargets: () => [{ entryId: 'include:mcp-figma', serverName: 'figma', transport: 'streamable-http', enabled: true, phase: 'active', endpoint: 'https://x.test/mcp', envKeys: [], headerKeys: [], hasSensitiveValues: false }],
    reconcile: async () => {}
  })
  assert.equal(payload.ok, true)
  assert.equal(payload.servers[0].conflictNote.includes('include:mcp-figma'), true)
  assert.equal(payload.servers[0].blockedReason, '')
  assert.deepEqual(payload.servers[0].credentialRefs, ['T'])
  assert.equal(payload.servers[0].envKeys.length, 1)
})

test('statusPayload：没有同名时不产生提示', () => {
  const state = {
    csrfToken: 'tok',
    runtime: 'ready',
    versionSupported: true,
    module: {},
    loadErrors: [],
    lastError: '',
    lastReconcile: null,
    settingsScope: {},
    mountManager: { status: () => [] }
  }
  const payload = statusPayload(state, {
    settingsView: () => ({ enabled: false, servers: [{ id: 'a', serverName: 'solo', enabled: true, transport: 'stdio', command: 'node', args: [], env: {}, headers: {}, cwd: '', url: '', label: '', toolCallTimeoutMs: 60000, failOnStartupError: false }] }),
    profileTargets: () => [],
    reconcile: async () => {}
  })
  assert.equal(payload.servers[0].conflictNote, '')
  assert.equal(payload.totalEnabled, false)
})

test('导入钩子：完整带上非敏感配置，敏感值写进凭据库且不回传浏览器', async () => {
  const written = []
  const result = await importFromProfileEntry({
    entryConfig: {
      serverName: 'jira',
      transport: 'streamable-http',
      url: 'https://mcp.atlassian.com/v2/mcp',
      toolCallTimeoutMs: 120000,
      headers: { Authorization: 'Basic SECRET-VALUE' }
    },
    takenIds: ['srv-a'],
    credentials: { set: async (ref, value) => written.push([ref, value]) }
  })
  assert.equal(result.ok, true)
  assert.equal(result.draft.url, 'https://mcp.atlassian.com/v2/mcp')
  assert.equal(result.draft.toolCallTimeoutMs, 120000)
  assert.equal(result.draft.headers.Authorization, 'credential:MCP_JIRA_HEADERS_AUTHORIZATION')
  assert.notEqual(result.draft.id, 'srv-a', '新 id 要避开现有条目')
  assert.deepEqual(written, [['MCP_JIRA_HEADERS_AUTHORIZATION', 'Basic SECRET-VALUE']])
  assert.equal(JSON.stringify(result).includes('SECRET-VALUE'), false, '返回值里不得有明文')
})

test('导入钩子：没有凭据服务时保留占位符并提示手动填写', async () => {
  const result = await importFromProfileEntry({
    entryConfig: { serverName: 'x', transport: 'streamable-http', url: 'https://h/mcp', headers: { 'X-Key': 'v' } },
    takenIds: [],
    credentials: null
  })
  assert.equal(result.draft.headers['X-Key'], 'credential:MCP_X_HEADERS_X_KEY')
  assert.match(result.notes.join('|'), /手动填写/u)
})

test('导入钩子：没有可导入内容时明确失败', async () => {
  const result = await importFromProfileEntry({ entryConfig: null, takenIds: [], credentials: null })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有可导入/u)
})
