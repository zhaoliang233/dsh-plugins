import assert from 'node:assert/strict'
import test from 'node:test'

import { planReconcile } from '../lib/plan.js'
import { mountConfigFor, normalizeSettings, substituteCredentials } from '../lib/store.js'

const settingsOf = (servers, enabled = true) => normalizeSettings({ enabled, servers })

const resolveConfig = (server) => mountConfigFor(server, (value) => substituteCredentials(value, () => 'X'))

const plan = (settings, actual = new Map(), profileNames = new Map()) =>
  planReconcile({ settings, actual, profileNames, resolveConfig })

const stdio = (id, name, extra = {}) => ({ id, serverName: name, transport: 'stdio', command: 'node', args: [], ...extra })

test('首次对账：可用条目全部挂载，停用条目不动', () => {
  const settings = settingsOf([stdio('a', 'alpha'), stdio('b', 'beta', { enabled: false })])
  const result = plan(settings)
  assert.deepEqual(
    result.mount.map((item) => item.id),
    ['a']
  )
  assert.deepEqual(result.unmount, [])
  assert.deepEqual(result.blocked, [])
})

test('第二次对账：配置没变则一个动作都不产生（幂等）', () => {
  const settings = settingsOf([stdio('a', 'alpha')])
  const first = plan(settings)
  const actual = new Map(first.mount.map((item) => [item.id, { configKey: item.configKey }]))
  const second = plan(settings, actual)
  assert.deepEqual(second.mount, [])
  assert.deepEqual(second.unmount, [])
  assert.deepEqual(second.unchanged, ['a'])
})

test('改配置：先卸后挂，不留下旧实例', () => {
  const before = settingsOf([stdio('a', 'alpha')])
  const actual = new Map(plan(before).mount.map((item) => [item.id, { configKey: item.configKey }]))
  const after = settingsOf([stdio('a', 'alpha', { args: ['--changed'] })])
  const result = plan(after, actual)
  assert.deepEqual(result.unmount, ['a'])
  assert.deepEqual(
    result.mount.map((item) => item.id),
    ['a']
  )
})

test('删除条目与停用条目都产生卸载', () => {
  const before = settingsOf([stdio('a', 'alpha'), stdio('b', 'beta')])
  const actual = new Map(plan(before).mount.map((item) => [item.id, { configKey: item.configKey }]))
  const after = settingsOf([stdio('a', 'alpha'), stdio('b', 'beta', { enabled: false })])
  assert.deepEqual(plan(after, actual).unmount, ['b'])
  const removed = settingsOf([stdio('a', 'alpha')])
  assert.deepEqual(plan(removed, actual).unmount, ['b'])
})

test('总开关关闭时全部卸载', () => {
  const before = settingsOf([stdio('a', 'alpha')])
  const actual = new Map(plan(before).mount.map((item) => [item.id, { configKey: item.configKey }]))
  const result = plan(settingsOf([stdio('a', 'alpha')], false), actual)
  assert.deepEqual(result.unmount, ['a'])
  assert.deepEqual(result.mount, [])
})

test('校验不通过的条目不挂载，并给出可读原因', () => {
  const result = plan(settingsOf([{ id: 'x', serverName: 'broken', transport: 'stdio', command: '' }]))
  assert.deepEqual(result.mount, [])
  assert.equal(result.blocked.length, 1)
  assert.match(result.blocked[0].reason, /可执行命令/u)
})

test('把已挂载的条目改成非法配置时必须先卸载旧实例', () => {
  const before = settingsOf([stdio('a', 'alpha')])
  const actual = new Map(plan(before).mount.map((item) => [item.id, { configKey: item.configKey }]))
  const broken = settingsOf([{ id: 'a', serverName: 'alpha', transport: 'stdio', command: '' }])
  const result = plan(broken, actual)
  assert.deepEqual(result.unmount, ['a'], '旧实例必须停下来，否则界面显示新配置、跑的是旧配置')
  assert.deepEqual(result.mount, [])
  assert.equal(result.blocked.length, 1)
})

test('与 profile 组合重名时拒绝挂载（同 root 作用域会撞 serverName 预留）', () => {
  const result = plan(
    settingsOf([stdio('a', 'figma')]),
    new Map(),
    new Map([['figma', '配置文件中的 MCP 条目']])
  )
  assert.deepEqual(result.mount, [])
  assert.match(result.blocked[0].reason, /配置文件中的 MCP 条目/u)
})

test('重名的两个条目都不挂载', () => {
  const result = plan(settingsOf([stdio('a', 'dup'), stdio('b', 'dup')]))
  assert.deepEqual(result.mount, [])
  assert.equal(result.blocked.length, 2)
  assert.match(result.blocked[0].reason, /重复/u)
})

test('计划里带上缺失凭据，由挂载管理器决定是否拦下', () => {
  const settings = settingsOf([
    { id: 'a', serverName: 'alpha', transport: 'streamable-http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'credential:MISSING' } }
  ])
  const resolved = planReconcile({
    settings,
    actual: new Map(),
    resolveConfig: (server) => mountConfigFor(server, (value) => substituteCredentials(value, () => undefined))
  })
  assert.deepEqual(resolved.mount[0].missingCredentials, ['MISSING'])
})
