import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, { PLUGIN_NAME, applyForVersion, classifyDshVersion, inject } from '../lib/index.js'

test('keeps the Host half inert outside the audited release line', () => {
  assert.equal(classifyDshVersion('0.1.6-alpha.1+local').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.6-beta.0').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.5-alpha.1').supported, false, 'previous verified line is now outside')

  let warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.7')
  assert.equal(warnings, 1)
})

test('exports an inert Host half for the client-only feature', () => {
  assert.equal(PLUGIN_NAME, 'dsh-sticky-user-bubble')
  assert.deepEqual(inject, [])
  assert.equal(plugin.name, PLUGIN_NAME)
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.doesNotThrow(() => plugin.apply({}))
})
