import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, { PLUGIN_NAME, applyForVersion, classifyDshVersion, inject } from '../lib/index.js'

test('keeps the Host half inert outside the audited release line', () => {
  assert.equal(classifyDshVersion('0.1.6-alpha.2+local').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.2+local').verified, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.1').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.1').verified, false)
  assert.equal(classifyDshVersion('0.1.6-beta.0').supported, true)
  assert.equal(classifyDshVersion('0.1.6').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.5-alpha.1').supported, false)
  assert.equal(classifyDshVersion('0.2.0').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)

  let warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.7')
  assert.equal(warnings, 1)
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.6-alpha.1')
  assert.equal(warnings, 2)
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.6-alpha.2')
  assert.equal(warnings, 2)
})

test('exports an inert Host half for the client-only feature', () => {
  assert.equal(PLUGIN_NAME, 'dsh-auto-load-history')
  assert.deepEqual(inject, [])
  assert.equal(plugin.name, PLUGIN_NAME)
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.doesNotThrow(() => plugin.apply({}))
})
