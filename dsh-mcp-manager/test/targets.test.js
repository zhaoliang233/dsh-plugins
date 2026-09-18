import assert from 'node:assert/strict'
import test from 'node:test'

import { credentialKeyFor, describeProfileTargets, importDraftFromConfig, isSelfEntry } from '../lib/targets.js'

const mcpEntry = (id, config, extra = {}) => ({
  entryId: id,
  moduleName: '@deepseek-ai/dsh-mcp-client',
  config,
  disabled: false,
  phase: 'active',
  ...extra
})

test('只挑出 mcp-client 行，忽略其它插件行', () => {
  const rows = describeProfileTargets([
    mcpEntry('mcp-figma', { serverName: 'figma', transport: 'streamable-http', url: 'http://127.0.0.1:3845/mcp' }),
    { entryId: 'other', moduleName: 'dsh-extra-context', config: {}, disabled: false, phase: 'active' },
    { entryId: 'group', moduleName: '@deepseek-ai/dsh-mcp-client', config: {}, disabled: false, phase: 'active', group: true }
  ])
  assert.equal(rows.length, 2, 'group 标记的行由调用方过滤，这里按 moduleName 判定')
})

test('HTTP 端点只留 origin + path：查询串里常有临时 token', () => {
  const [row] = describeProfileTargets([
    mcpEntry('mcp-x', { serverName: 'x', transport: 'streamable-http', url: 'https://example.test/v2/mcp?token=SUPERSECRET#frag' })
  ])
  assert.equal(row.endpoint, 'https://example.test/v2/mcp')
  assert.equal(JSON.stringify(row).includes('SUPERSECRET'), false)
})

test('stdio 只留可执行文件名与参数个数：参数里可能有密钥', () => {
  const [row] = describeProfileTargets([
    mcpEntry('mcp-y', { serverName: 'y', transport: 'stdio', command: '/usr/local/bin/npx', args: ['-y', '@scope/server', '--token', 'SUPERSECRET'] })
  ])
  assert.equal(row.endpoint, 'npx（4 个参数）')
  assert.equal(JSON.stringify(row).includes('SUPERSECRET'), false)
})

test('env/header 只回显键名，并标出是否含敏感名', () => {
  const rows = describeProfileTargets([
    mcpEntry('a', { serverName: 'a', transport: 'streamable-http', url: 'https://x.test/mcp', headers: { Authorization: 'Basic YWJj' } }),
    mcpEntry('b', { serverName: 'b', transport: 'stdio', command: 'node', env: { PLAIN: '1' } })
  ])
  assert.deepEqual(rows[0].headerKeys, ['Authorization'])
  assert.equal(rows[0].hasSensitiveValues, true)
  assert.equal(JSON.stringify(rows[0]).includes('YWJj'), false, '绝不回显组合层已经求值出来的密钥')
  assert.equal(rows[1].hasSensitiveValues, false)
})

test('停用与运行阶段如实反映', () => {
  const [row] = describeProfileTargets([
    mcpEntry('a', { serverName: 'a', transport: 'stdio', command: 'node' }, { disabled: true, phase: null })
  ])
  assert.equal(row.enabled, false)
  assert.equal(row.phase, null)
})

test('isSelfEntry 认出本插件自己那条', () => {
  assert.equal(isSelfEntry({ entryId: 'dsh-mcp-manager', moduleName: 'dsh-mcp-manager' }, 'dsh-mcp-manager'), true)
  assert.equal(isSelfEntry({ entryId: 'x', moduleName: 'y' }, 'dsh-mcp-manager'), false)
})

test('完整导入：非敏感字段照抄，敏感字段换成凭据占位符', () => {
  const planned = importDraftFromConfig({
    id: 'srv-1',
    config: {
      serverName: 'jira',
      transport: 'streamable-http',
      url: 'https://mcp.atlassian.com/v2/mcp',
      headers: { Authorization: 'Basic ABC123', 'X-Trace': 'on' },
      env: { PLAIN: '1' },
      toolCallTimeoutMs: 120000
    },
    credentialKeyFor: (field, key) => credentialKeyFor('jira', field, key)
  })
  assert.equal(planned.draft.id, 'srv-1')
  assert.equal(planned.draft.url, 'https://mcp.atlassian.com/v2/mcp', 'URL 要带过来（用户反馈过：只抄名字等于没导入）')
  assert.equal(planned.draft.headers['X-Trace'], 'on', '非敏感请求头照抄')
  assert.equal(planned.draft.headers.Authorization, 'credential:MCP_JIRA_HEADERS_AUTHORIZATION')
  assert.equal(planned.draft.env.PLAIN, '1')
  assert.equal(planned.draft.toolCallTimeoutMs, 120000, '超时也要带上')
  assert.deepEqual(planned.credentials.map((item) => item.ref), ['MCP_JIRA_HEADERS_AUTHORIZATION'])
  assert.deepEqual(planned.notes, [], '不再往弹窗塞"已转入凭据库"那句提示（用户反馈：重复、而且删掉键之后就成了假消息）')
  assert.equal(JSON.stringify(planned.draft).includes('ABC123'), false, '草稿里不得出现明文')
})

test('完整导入：URL 里带 token 时整条 URL 也进凭据库（它没法只替换一段）', () => {
  const planned = importDraftFromConfig({
    id: 'srv-2',
    config: { serverName: 'x', transport: 'streamable-http', url: 'https://host/mcp?token=SECRET#f' },
    credentialKeyFor: (field, key) => credentialKeyFor('x', field, key)
  })
  assert.equal(planned.draft.url, 'credential:MCP_X_URL_URL')
  assert.equal(planned.credentials[0].value, 'https://host/mcp?token=SECRET#f')
  assert.equal(JSON.stringify(planned.draft).includes('SECRET'), false)
})

test('完整导入：stdio 的命令、参数、工作目录、普通环境变量都带过来', () => {
  const planned = importDraftFromConfig({
    id: 'srv-3',
    config: { serverName: 's', transport: 'stdio', command: '/usr/bin/node', args: ['a', 'b'], cwd: '/tmp', env: { TOKEN: 'credential:ALREADY' } },
    credentialKeyFor: (field, key) => credentialKeyFor('s', field, key)
  })
  assert.equal(planned.draft.command, '/usr/bin/node')
  assert.deepEqual(planned.draft.args, ['a', 'b'])
  assert.equal(planned.draft.cwd, '/tmp')
  // 值本身就是占位符的字段：键名敏感 → 仍然转成新键，值就是那句占位符
  assert.equal(planned.draft.env.TOKEN, 'credential:MCP_S_ENV_TOKEN')
})

test('凭据键名是合法标识符（credentials 的 ref 语法）', () => {
  assert.equal(credentialKeyFor('my-server', 'headers', 'X-API-Key'), 'MCP_MY_SERVER_HEADERS_X_API_KEY')
  assert.match(credentialKeyFor('a.b c', 'env', '1'), /^MCP_[A-Z0-9_]+$/u)
  assert.equal(credentialKeyFor('', '', ''), 'MCP_VALUE')
  // 清洗后可能撞名（X-API-Key 与 X_API_Key）——同一个条目内极少见，撞了就共用一条凭据
  assert.equal(credentialKeyFor('s', 'headers', 'X-API-Key'), credentialKeyFor('s', 'headers', 'X_API_Key'))
})
