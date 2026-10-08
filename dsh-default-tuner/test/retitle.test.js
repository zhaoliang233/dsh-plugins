import assert from 'node:assert/strict'
import { test } from 'node:test'

import { translateRetitleError } from '../lib/index.js'

test('provider 的超限报错翻译成可操作提示，并附建议上限', () => {
  const error = translateRetitleError(new Error('session-title-llm: input is 4697 bytes, exceeding maxInputBytes 4096'))
  assert.equal(error.code, 'title-input-over-limit')
  assert.equal(error.status, 409)
  assert.equal(error.detail.inputBytes, 4697)
  assert.equal(error.detail.inputLimit, 4096)
  assert.equal(error.detail.suggestedLimit, 5120)
  assert.match(error.message, /4697/u)
  assert.match(error.message, /5120/u)
})

test('报错文案没匹配上时，用预检数据兜底', () => {
  const error = translateRetitleError(new Error('boom'), 5000, 4096)
  assert.equal(error.code, 'title-input-over-limit')
  assert.equal(error.detail.suggestedLimit, 5120)
})

test('与超限无关的失败保持原样', () => {
  const error = translateRetitleError(new Error('network down'))
  assert.equal(error.code, 'retitle-failed')
  assert.equal(error.status, 500)
  assert.equal(error.detail, undefined)
})

test('抬过上限之后不再把失败归因为超限', () => {
  const error = translateRetitleError(new Error('missing api key'), 4768, 4096, false, 5120)
  assert.equal(error.code, 'retitle-failed')
  assert.equal(error.detail.raisedLimit, 5120)
  assert.match(error.message, /已调到 5120/u)
  assert.match(error.message, /missing api key/u)
})

test('没抬过上限时，预检数据仍可兜底成超限结论', () => {
  const error = translateRetitleError(new Error('something else'), 4768, 4096, true)
  assert.equal(error.code, 'title-input-over-limit')
  assert.equal(error.detail.suggestedLimit, 5120)
})
