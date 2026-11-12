import assert from 'node:assert/strict'
import test from 'node:test'

import { credentialKeyFor, describeProfileTargets, importEntryFromConfig } from '../lib/targets.js'

test('describeProfileTargets：只投影 MCP 行，且不带值', () => {
  const rows = describeProfileTargets([
    {
      entryId: 'include:mcp-figma',
      moduleName: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'figma',
        transport: 'streamable-http',
        url: 'https://x.test/mcp?token=SECRET',
        headers: { Authorization: 'Bearer SECRET' }
      },
      disabled: false,
      phase: 'active'
    },
    { entryId: 'other', moduleName: '@deepseek-ai/dsh-something', config: {}, disabled: false, phase: 'active' }
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].serverName, 'figma')
  assert.equal(rows[0].endpoint, 'https://x.test/mcp', '查询串必须被抹掉')
  assert.deepEqual(rows[0].headerKeys, ['Authorization'])
  assert.equal(JSON.stringify(rows).includes('SECRET'), false)
})

test('describeProfileTargets：stdio 只给可执行文件名与参数个数', () => {
  const rows = describeProfileTargets([
    {
      entryId: 'mcp-x',
      moduleName: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'x', transport: 'stdio', command: '/usr/local/bin/npx', args: ['--token', 'SECRET'] },
      disabled: true,
      phase: 'inactive'
    }
  ])
  assert.equal(rows[0].endpoint, 'npx（2 个参数）')
  assert.equal(rows[0].enabled, false)
  assert.equal(JSON.stringify(rows).includes('SECRET'), false)
})

test('importEntryFromConfig：非敏感字段照抄、敏感值转模板、默认停用', () => {
  const result = importEntryFromConfig({
    config: {
      serverName: 'jira',
      transport: 'streamable-http',
      url: 'https://mcp.atlassian.com/v2/mcp',
      toolCallTimeoutMs: 120000,
      headers: { Authorization: 'Basic SECRET-VALUE', 'X-Trace': 'plain' }
    },
    credentialKeyFor: (field, key) => `${field}_${key}`.toUpperCase()
  })
  assert.equal(result.entry.serverName, 'jira')
  assert.equal(result.entry.url, 'https://mcp.atlassian.com/v2/mcp')
  assert.equal(result.entry.toolCallTimeoutMs, 120000)
  assert.equal(result.entry.enabled, false, '导入后先停用，保存时才探测并启用')
  assert.equal(result.entry.headers.Authorization, '${credential:HEADERS_AUTHORIZATION}')
  assert.equal(result.entry.headers['X-Trace'], 'plain')
  assert.deepEqual(result.credentials, [
    { ref: 'HEADERS_AUTHORIZATION', value: 'Basic SECRET-VALUE', field: 'headers', key: 'Authorization' }
  ])
  assert.equal(JSON.stringify(result.entry).includes('SECRET-VALUE'), false)
})

test('importEntryFromConfig：URL 带 token 时整条 URL 进凭据库', () => {
  const result = importEntryFromConfig({
    config: {
      serverName: 'remote',
      transport: 'streamable-http',
      url: 'https://h/mcp?token=SECRET'
    },
    credentialKeyFor: (field, key) => `${field}_${key}`.toUpperCase()
  })
  assert.equal(result.entry.url, '${credential:URL_URL}')
  assert.deepEqual(result.credentials, [{ ref: 'URL_URL', value: 'https://h/mcp?token=SECRET', field: 'url', key: 'URL' }])
})

test('importEntryFromConfig：failOnStartupError 给出说明但不进条目', () => {
  const result = importEntryFromConfig({
    config: { serverName: 'x', transport: 'stdio', command: 'node', failOnStartupError: true },
    credentialKeyFor: (field, key) => `${field}_${key}`
  })
  assert.equal('failOnStartupError' in result.entry, false)
  assert.match(result.notes.join('；'), /首次连接失败即拒绝/u)
})

test('credentialKeyFor：生成合法且可读的键名', () => {
  assert.equal(credentialKeyFor('jira', 'headers', 'Authorization'), 'MCP_JIRA_HEADERS_AUTHORIZATION')
  assert.equal(credentialKeyFor('', '', ''), 'MCP_VALUE')
  assert.equal(credentialKeyFor('a b', 'env', 'X-Key'), 'MCP_A_B_ENV_X_KEY')
  assert.equal(credentialKeyFor('x'.repeat(80), 'env', 'K').length <= 60, true)
})
