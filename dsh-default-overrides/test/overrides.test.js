import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ENTRIES,
  describeAdvanced,
  describeSessionEntry,
  describeTitleSource,
  describeWhitelist,
  entryAvailability,
  normalizeFieldValue,
  planFieldReset,
  planFieldWrite,
  selectRetitleCandidates,
  sortAndLimitSessions,
  summarizeSessions
} from '../lib/overrides.js'

test('planFieldWrite 写完整配置块，且不改动入参', () => {
  const current = { targetWords: 5, maxInputBytes: 4096, timeoutMs: 60000 }
  const next = planFieldWrite(current, 'maxInputBytes', 8192)
  assert.deepEqual(next, { targetWords: 5, maxInputBytes: 8192, timeoutMs: 60000 })
  assert.equal(current.maxInputBytes, 4096)
  assert.notEqual(next, current)
})

test('planFieldWrite 拒绝非对象配置', () => {
  assert.throws(() => planFieldWrite(undefined, 'maxInputBytes', 1), TypeError)
})

test('planFieldReset 只把目标字段退回继承层，保留其它字段', () => {
  const current = { targetWords: 5, maxInputBytes: 8192, timeoutMs: 30000 }
  const inherited = { targetWords: 5, maxInputBytes: 4096, timeoutMs: 60000 }
  const next = planFieldReset(current, inherited, 'maxInputBytes')
  assert.deepEqual(next, { targetWords: 5, maxInputBytes: 4096, timeoutMs: 30000 })
})

test('planFieldReset 在整块等于继承层时给出与继承层相同的块（交由 configEditor 删覆盖）', () => {
  const inherited = { targetWords: 5, maxInputBytes: 4096 }
  const current = { targetWords: 5, maxInputBytes: 8192 }
  assert.deepEqual(planFieldReset(current, inherited, 'maxInputBytes'), inherited)
})

test('planFieldReset 对没有默认值的字段报错', () => {
  assert.throws(() => planFieldReset({ a: 1 }, { b: 2 }, 'a'), /没有可回退的默认值/u)
})

test('normalizeFieldValue 接受数字与数字字符串，拒绝越界与非整数', () => {
  assert.equal(normalizeFieldValue('session-title-llm', 'maxInputBytes', 8192), 8192)
  assert.equal(normalizeFieldValue('session-title-llm', 'maxInputBytes', ' 8192 '), 8192)
  assert.throws(() => normalizeFieldValue('session-title-llm', 'maxInputBytes', 0), /不能小于/u)
  assert.throws(() => normalizeFieldValue('session-title-llm', 'maxInputBytes', 1.5), /需要整数/u)
  assert.throws(() => normalizeFieldValue('session-title-llm', 'maxInputBytes', 'abc'), /需要整数/u)
})

test('normalizeFieldValue 拒绝白名单之外的字段', () => {
  assert.throws(() => normalizeFieldValue('session-title-llm', 'provider', 'x'), /不在可覆盖白名单/u)
  assert.throws(() => normalizeFieldValue('some-other-entry', 'maxInputBytes', 1), /不在可覆盖白名单/u)
})

test('entryAvailability 区分缺条目、未激活、加载失败与就绪', () => {
  assert.equal(entryAvailability(undefined).reason, 'missing')
  assert.equal(entryAvailability({ fiber: undefined }).reason, 'inactive')
  assert.equal(entryAvailability({ fiber: { runtime: null } }).reason, 'inactive')
  assert.equal(entryAvailability({ fiber: { runtime: {}, state: 3 } }).reason, 'failed')
  assert.equal(entryAvailability({ fiber: { runtime: {}, state: 2 } }).writable, true)
})

function row(entryId, { inherited = {}, override = {}, config = {}, state = 2, fiber = true } = {}) {
  return {
    entry: Object.assign({ options: { id: entryId, config } }, fiber ? { fiber: { runtime: {}, state } } : {}),
    inherited,
    override
  }
}

test('describeWhitelist 覆盖白名单全部条目，缺条目时降级为不可写', () => {
  const described = describeWhitelist([
    row('session-title-llm', {
      inherited: { targetWords: 5, maxInputBytes: 4096 },
      override: { maxInputBytes: 2048 },
      config: { targetWords: 5, maxInputBytes: 2048 }
    })
  ])
  assert.equal(described.length, ENTRIES.length)
  const llm = described.find((entry) => entry.id === 'session-title-llm')
  const field = llm.fields.find((item) => item.path === 'maxInputBytes')
  assert.equal(field.default, 4096)
  assert.equal(field.override, 2048)
  assert.equal(field.effective, 2048)
  const missing = described.find((entry) => entry.id === 'session-title')
  assert.equal(missing.availability.writable, false)
  assert.equal(missing.availability.reason, 'missing')
  assert.equal(missing.fields.length, 3)
})

test('describeAdvanced 只列出带覆盖的条目并按 id 排序', () => {
  const advanced = describeAdvanced([
    row('zeta', { override: { a: 1 } }),
    row('alpha', { override: { b: 2 } }),
    row('no-override', { override: {} }),
    row('session-title-llm', { override: { maxInputBytes: 8192 } })
  ])
  assert.deepEqual(advanced.map((item) => item.id), ['alpha', 'session-title-llm', 'zeta'])
  assert.equal(advanced.find((item) => item.id === 'session-title-llm').managed, true)
  assert.equal(advanced.find((item) => item.id === 'alpha').managed, false)
})

test('describeTitleSource 区分模型命名、兜底、手动与无标题', () => {
  assert.equal(describeTitleSource({ kind: 'provider' }).label, '模型命名')
  assert.match(describeTitleSource({ kind: 'fallback' }).label, /兜底/u)
  assert.equal(describeTitleSource({ kind: 'user' }).kind, 'user')
  assert.equal(describeTitleSource(undefined).kind, 'none')
})

test('describeSessionEntry 整理标题快照，并标出手动命名会被覆盖', () => {
  const row = describeSessionEntry(
    { id: 'session-1234567890abcdef', header: { cwd: '/tmp/x', createdAt: 100 } },
    { title: '某个标题', source: { kind: 'user' }, updatedAt: 200 }
  )
  assert.equal(row.id, 'session-1234567890abcdef')
  assert.equal(row.shortId, '567890abcdef')
  assert.equal(row.title, '某个标题')
  assert.equal(row.sourceLabel, '手动命名')
  assert.equal(row.overwritesManual, true)
  assert.equal(row.cwd, '/tmp/x')
  assert.equal(row.updatedAt, 200)
})

test('describeSessionEntry 对没有标题的会话降级到创建时间', () => {
  const row = describeSessionEntry({ id: 'abc', header: { createdAt: 5 } }, undefined)
  assert.equal(row.title, '')
  assert.equal(row.sourceKind, 'none')
  assert.equal(row.overwritesManual, false)
  assert.equal(row.updatedAt, 5)
  assert.equal(row.cwd, '')
})

test('sortAndLimitSessions 按最近活动排序、截断，且不改动入参', () => {
  const rows = [
    { id: 'a', updatedAt: 1 },
    { id: 'b', updatedAt: 3 },
    { id: 'c', updatedAt: 2 }
  ]
  assert.deepEqual(sortAndLimitSessions(rows, 2).map((row) => row.id), ['b', 'c'])
  assert.deepEqual(sortAndLimitSessions(rows, 3).map((row) => row.id), ['b', 'c', 'a'])
  assert.equal(rows[0].id, 'a')
})

test('describeWhitelist 区分"真正改过的覆盖"与"随整块写入的覆盖"', () => {
  const described = describeWhitelist([
    row('session-title-llm', {
      inherited: { targetWords: 5, maxInputBytes: 4096 },
      override: { targetWords: 5, maxInputBytes: 8192 },
      config: { targetWords: 5, maxInputBytes: 8192 }
    })
  ])
  const llm = described.find((entry) => entry.id === 'session-title-llm')
  const changed = llm.fields.find((field) => field.path === 'maxInputBytes')
  const frozen = llm.fields.find((field) => field.path === 'targetWords')
  assert.equal(changed.override, 8192)
  assert.equal(changed.frozenSameAsDefault, false)
  assert.equal(frozen.override, 5)
  assert.equal(frozen.frozenSameAsDefault, true)
})

test('selectRetitleCandidates 只保留兜底截断的会话', () => {
  const entries = [
    { id: 'a', sourceKind: 'provider' },
    { id: 'b', sourceKind: 'fallback' },
    { id: 'c', sourceKind: 'user' },
    { id: 'd', sourceKind: 'none' },
    { id: 'e', sourceKind: 'fallback' }
  ]
  assert.deepEqual(selectRetitleCandidates(entries).map((entry) => entry.id), ['b', 'e'])
  assert.deepEqual(summarizeSessions(entries), { total: 5, needRetitle: 2 })
})

test('重算成功后（来源变成 provider）会从候选列表消失', () => {
  const before = describeSessionEntry({ id: 's1', header: {} }, { title: '兜底标题', source: { kind: 'fallback' } })
  const after = describeSessionEntry({ id: 's1', header: {} }, { title: '模型命名的标题', source: { kind: 'provider' } })
  const manual = describeSessionEntry({ id: 's2', header: {} }, { title: '我改的名字', source: { kind: 'user' } })
  assert.deepEqual(selectRetitleCandidates([before]).map((row) => row.id), ['s1'])
  assert.deepEqual(selectRetitleCandidates([after, manual]), [])
})
