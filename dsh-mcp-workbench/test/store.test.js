import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  credentialRefsIn,
  describeServer,
  mountConfigFor,
  newServerId,
  normalizeServer,
  normalizeSettings,
  sameMountConfig,
  substituteCredentials,
  toServerName,
  validateServer
} from '../lib/store.js'

test('normalizeSettings 防住脏数据并补齐默认值', () => {
  const settings = normalizeSettings({
    enabled: 'yes',
    servers: [
      { id: 'a', serverName: 'alpha', transport: 'stdio', command: 'node', args: ['x', 42], env: { A: '1', B: 7 } },
      { serverName: 'beta', transport: 'nope' },
      'not-an-object'
    ]
  })
  assert.equal(settings.enabled, true, '非 false 的总开关视为开启')
  assert.equal(settings.servers.length, 3)
  assert.deepEqual(settings.servers[0].args, ['x'], '参数里的非字符串被丢掉')
  assert.deepEqual(settings.servers[0].env, { A: '1' }, 'env 只保留字符串值')
  assert.equal(settings.servers[1].transport, 'stdio', '未知传输方式回落 stdio')
  assert.equal(settings.servers[2].serverName, 'server-3', '非对象条目被归一成带序号的空条目')
  assert.equal(settings.servers[0].toolCallTimeoutMs, DEFAULT_TOOL_CALL_TIMEOUT_MS)
})

test('normalizeSettings 关掉总开关时 enabled=false 被保留', () => {
  assert.equal(normalizeSettings({ enabled: false }).enabled, false)
})

test('normalizeSettings 消除重复 id（否则对账会互相覆盖）', () => {
  const settings = normalizeSettings({
    servers: [
      { id: 'same', serverName: 'a' },
      { id: 'same', serverName: 'b' }
    ]
  })
  assert.notEqual(settings.servers[0].id, settings.servers[1].id)
})

test('toServerName 收敛非法字符并截断到 32 位', () => {
  assert.equal(toServerName('my server!'), 'my-server')
  assert.equal(toServerName('--x--'), 'x')
  assert.equal(toServerName('a'.repeat(40)).length, 32)
  assert.equal(toServerName(undefined), '')
})

test('newServerId 避开已占用的 id', () => {
  const first = newServerId()
  assert.match(first, /^srv-[0-9a-f]{1,8}$/u)
  assert.notEqual(newServerId([first, 'srv-0']), undefined)
})

test('validateServer：stdio/http 各自的必填项与 serverName 语法', () => {
  assert.deepEqual(validateServer(normalizeServer({ serverName: 'ok', command: 'node' })), [])
  assert.match(validateServer(normalizeServer({ serverName: 'bad name', command: 'node' })).join(), /服务器名/u)
  assert.match(validateServer(normalizeServer({ serverName: 'ok' })).join(), /可执行命令/u)
  const http = normalizeServer({ serverName: 'ok', transport: 'streamable-http' })
  assert.match(validateServer(http).join(), /必须填写 URL/u)
  assert.deepEqual(validateServer(normalizeServer({ serverName: 'ok', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp' })), [])
  assert.match(
    validateServer(normalizeServer({ serverName: 'ok', transport: 'streamable-http', url: 'ftp://x/y' })).join(),
    /http\/https/u
  )
  assert.match(
    validateServer(normalizeServer({ serverName: 'ok', transport: 'streamable-http', url: '不是URL' })).join(),
    /无法解析/u
  )
})

test('validateServer：同作用域内的 serverName 必须唯一，但不能把自己当冲突', () => {
  const a = normalizeServer({ id: 'a', serverName: 'dup', command: 'node' })
  const b = normalizeServer({ id: 'b', serverName: 'dup', command: 'node' })
  const options = { takenNames: ['dup', 'dup'], idToName: new Map([['dup', 'a']]) }
  assert.deepEqual(validateServer(a, options), [], '自己占用自己的名字不算冲突')
  assert.match(validateServer(b, options).join(), /已被另一个条目占用/u)
})

test('credentialRefsIn 只认合法凭据键且去重', () => {
  assert.deepEqual(credentialRefsIn('Bearer credential:TOKEN_A'), ['TOKEN_A'])
  assert.deepEqual(credentialRefsIn('credential:A credential:A credential:B'), ['A', 'B'])
  assert.deepEqual(credentialRefsIn('credential:1bad'), [], '数字开头的键不合法')
  assert.deepEqual(credentialRefsIn(undefined), [])
})

test('substituteCredentials：未配置时保留占位符并报告缺失', () => {
  const values = new Map([['TOKEN_A', 'secret-value']])
  const withValue = substituteCredentials('Basic credential:TOKEN_A', (key) => values.get(key))
  assert.equal(withValue.value, 'Basic secret-value')
  assert.deepEqual(withValue.missing, [])

  const missing = substituteCredentials('Basic credential:TOKEN_B', (key) => values.get(key))
  assert.equal(missing.value, 'Basic credential:TOKEN_B')
  assert.deepEqual(missing.missing, ['TOKEN_B'])
})

test('mountConfigFor：stdio 与 http 各自只带自己的字段，并报告缺失凭据', () => {
  const stdio = normalizeServer({
    serverName: 's',
    command: 'node',
    args: ['a'],
    cwd: '/tmp',
    env: { PLAIN: 'v', TOKEN: 'credential:MISSING' },
    url: 'http://should-be-ignored'
  })
  const stdioResult = mountConfigFor(stdio, (value) => substituteCredentials(value, () => undefined))
  assert.equal(stdioResult.config.transport, 'stdio')
  assert.equal(stdioResult.config.command, 'node')
  assert.deepEqual(stdioResult.config.args, ['a'])
  assert.equal('url' in stdioResult.config, false, 'stdio 不应带 http 字段')
  assert.deepEqual(stdioResult.missing, ['MISSING'])

  const http = normalizeServer({
    serverName: 'h',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:1/mcp',
    headers: { Authorization: 'Bearer credential:TOK' }
  })
  const httpResult = mountConfigFor(http, (value) => substituteCredentials(value, () => 'X'))
  assert.equal(httpResult.config.transport, 'streamable-http')
  assert.equal(httpResult.config.headers.Authorization, 'Bearer X')
  assert.equal('command' in httpResult.config, false, 'http 不应带 stdio 字段')
  assert.equal(httpResult.config.failOnStartupError, false)
})

test('sameMountConfig 与字段顺序无关，但能识别真实变化', () => {
  assert.equal(sameMountConfig({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true)
  assert.equal(sameMountConfig({ a: 1 }, { a: 2 }), false)
  assert.equal(sameMountConfig({ args: ['x'] }, { args: ['y'] }), false)
})

test('describeServer 只回显键名，不回显 env/header 的值', () => {
  const described = describeServer(
    normalizeServer({
      id: 'x',
      label: '备注',
      serverName: 's',
      command: 'node',
      env: { PLAIN: 'raw-secret-typed-by-user', TOKEN: 'credential:TOK' },
      headers: { Authorization: 'Basic credential:TOK' }
    })
  )
  const serialized = JSON.stringify(described)
  assert.equal(serialized.includes('raw-secret-typed-by-user'), false, '状态接口不得回显 env 值')
  assert.deepEqual(described.envKeys, ['PLAIN', 'TOKEN'])
  assert.deepEqual(described.credentialRefs, ['TOK'])
  assert.deepEqual(described.issues, [])
})

test('状态投影把 URL 里的凭据键也算进来（挂载时它同样被替换）', () => {
  const described = describeServer(
    normalizeServer({
      transport: 'streamable-http',
      serverName: 's',
      url: 'https://example.test/mcp?token=credential:URL_TOK',
      headers: { Authorization: 'Bearer credential:HEADER_TOK' }
    })
  )
  assert.deepEqual(described.credentialRefs, ['URL_TOK', 'HEADER_TOK'])
  // 占位符本身要留在载荷里（设置页要能编辑），但明文永远不出现
  assert.match(described.url, /credential:URL_TOK/u)
  assert.equal(JSON.stringify(described).includes('secret-value'), false, '状态载荷不得回显明文')
})
