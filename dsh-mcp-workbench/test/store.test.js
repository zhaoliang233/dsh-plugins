import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_STARTUP_TIMEOUT_MS,
  credentialRefsIn,
  describeEntry,
  entryRecord,
  legacyToManagedEntry,
  normalizeEntry,
  normalizeReconnect,
  normalizeServers,
  toServerName,
  validateEntry
} from '../lib/store.js'

test('normalizeEntry：官方字段默认值与 reconnect 策略', () => {
  const entry = normalizeEntry({}, 'demo')
  assert.equal(entry.serverName, 'demo')
  assert.equal(entry.transport, 'stdio')
  assert.deepEqual(entry.args, [])
  assert.deepEqual(entry.env, {})
  assert.deepEqual(entry.headers, {})
  assert.equal(entry.enabled, true)
  assert.equal(entry.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS)
  assert.deepEqual(entry.reconnect, { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 })
  assert.equal(entry.toolCallTimeoutMs, undefined, '调用超时可省略（官方 schema 可选）')
  assert.equal(entry.closeTimeoutMs, undefined)
})

test('normalizeEntry：保留显式超时与 reconnect 覆盖', () => {
  const entry = normalizeEntry(
    {
      transport: 'streamable-http',
      url: 'https://h/mcp',
      toolCallTimeoutMs: 120000,
      startupTimeoutMs: 15000,
      closeTimeoutMs: 5000,
      reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 3 }
    },
    'remote'
  )
  assert.equal(entry.transport, 'streamable-http')
  assert.equal(entry.toolCallTimeoutMs, 120000)
  assert.equal(entry.startupTimeoutMs, 15000)
  assert.equal(entry.closeTimeoutMs, 5000)
  assert.deepEqual(entry.reconnect, { enabled: false, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 3 })
})

test('normalizeReconnect：非法值回落默认', () => {
  assert.deepEqual(normalizeReconnect(undefined), { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 })
  assert.deepEqual(normalizeReconnect({ initialDelayMs: -1, maxAttempts: 0 }), {
    enabled: true,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    maxAttempts: 10
  })
})

test('normalizeServers：dict → 按名字排序的数组', () => {
  const rows = normalizeServers({
    zeta: { transport: 'stdio', command: 'node' },
    alpha: { transport: 'streamable-http', url: 'https://a/mcp' }
  })
  assert.deepEqual(
    rows.map((row) => row.serverName),
    ['alpha', 'zeta']
  )
  assert.equal(rows[0].transport, 'streamable-http')
})

test('entryRecord：写回时去掉界面专用的 serverName', () => {
  const record = entryRecord({ transport: 'stdio', command: 'node', serverName: 'demo' }, 'demo')
  assert.equal('serverName' in record, false)
  assert.equal(record.command, 'node')
  assert.equal(record.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS)
})

test('validateEntry：名字、传输必填项、URL 与重名', () => {
  assert.deepEqual(validateEntry({ transport: 'stdio', command: 'node', startupTimeoutMs: 30000 }, { name: 'ok' }), [])
  assert.match(validateEntry({ transport: 'stdio', command: '', startupTimeoutMs: 30000 }, { name: 'ok' }).join(' '), /必须填写可执行命令/u)
  assert.match(validateEntry({ transport: 'stdio', command: 'node', startupTimeoutMs: 30000 }, { name: 'bad name' }).join(' '), /服务器名/u)
  assert.match(validateEntry({ transport: 'streamable-http', url: '', startupTimeoutMs: 30000 }, { name: 'x' }).join(' '), /必须填写 URL/u)
  assert.match(validateEntry({ transport: 'streamable-http', url: 'ftp://x', startupTimeoutMs: 30000 }, { name: 'x' }).join(' '), /http/u)
  assert.match(validateEntry({ transport: 'stdio', command: 'node', startupTimeoutMs: 30000 }, { name: 'x', takenNames: ['x'] }).join(' '), /已被另一个条目占用/u)
  // 自己那个名字不算冲突
  assert.deepEqual(
    validateEntry({ transport: 'stdio', command: 'node', startupTimeoutMs: 30000 }, { name: 'x', takenNames: ['x'], takenNameIsSelf: true }),
    []
  )
})

test('validateEntry：URL 里带凭据模板时不做 URL 解析', () => {
  assert.deepEqual(
    validateEntry(
      { transport: 'streamable-http', url: 'https://h/mcp?token=${credential:TOKEN}', startupTimeoutMs: 30000 },
      { name: 'remote' }
    ),
    []
  )
})

test('credentialRefsIn：只认官方 ${credential:KEY} 模板', () => {
  assert.deepEqual(credentialRefsIn('Bearer ${credential:A}'), ['A'])
  assert.deepEqual(credentialRefsIn('${credential:A}${credential:B}${credential:A}'), ['A', 'B'])
  assert.deepEqual(credentialRefsIn('credential:A'), [], '旧语法不算官方模板')
  assert.deepEqual(credentialRefsIn(''), [])
})

test('describeEntry：投影含六处凭据引用、不含明文', () => {
  const described = describeEntry('jira', {
    transport: 'streamable-http',
    url: 'https://h/mcp?token=${credential:URL_TOKEN}',
    headers: { Authorization: 'Bearer ${credential:JIRA_TOKEN}' },
    env: { SESSION: '${credential:SESSION_TOKEN}' },
    command: '${credential:CMD}',
    args: ['--key=${credential:ARG}'],
    cwd: '/tmp/${credential:CWD}',
    startupTimeoutMs: 30000
  })
  assert.deepEqual(
    [...described.credentialRefs].sort(),
    ['ARG', 'CMD', 'CWD', 'JIRA_TOKEN', 'SESSION_TOKEN', 'URL_TOKEN']
  )
  assert.equal(described.headerKeys.join(','), 'Authorization')
  assert.equal(described.envKeys.join(','), 'SESSION')
  assert.equal(JSON.stringify(described).includes('Bearer '), false, '只给键名，绝不回显值')
})

test('legacyToManagedEntry：旧语法转官方模板，丢弃 label 与 failOnStartupError', () => {
  const { entry, notes } = legacyToManagedEntry(
    {
      id: 'srv-1',
      label: 'GitHub',
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      env: { GITHUB_TOKEN: 'credential:GH_TOKEN' },
      url: '',
      headers: {},
      cwd: '',
      toolCallTimeoutMs: 30000,
      failOnStartupError: true
    },
    'fallback'
  )
  assert.equal(entry.serverName, 'github')
  assert.equal(entry.command, 'npx')
  assert.deepEqual(entry.args, ['-y', 'server'])
  assert.equal(entry.env.GITHUB_TOKEN, '${credential:GH_TOKEN}')
  assert.equal(entry.toolCallTimeoutMs, 30000)
  assert.equal('label' in entry, false)
  assert.equal('failOnStartupError' in entry, false)
  assert.match(notes.join('；'), /展示名/u)
  assert.match(notes.join('；'), /首次连接失败即拒绝/u)
})

test('legacyToManagedEntry：名字缺失时用 label 或兜底名', () => {
  assert.equal(legacyToManagedEntry({ label: 'My Server' }, 'x').entry.serverName, 'My-Server')
  assert.equal(legacyToManagedEntry({}, 'fallback').entry.serverName, 'fallback')
})

test('toServerName：清洗为合法形式', () => {
  assert.equal(toServerName('my server!'), 'my-server')
  assert.equal(toServerName('---x---'), 'x')
  assert.equal(toServerName('a'.repeat(40)).length, 32)
})
