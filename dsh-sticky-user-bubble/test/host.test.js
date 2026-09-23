import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, { PLUGIN_NAME, applyForVersion, classifyDshVersion, inject } from '../lib/index.js'

test('keeps the Host half inert outside the audited release line', () => {
  assert.equal(classifyDshVersion('0.1.7-alpha.1+local').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.1+local').verified, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.2').verified, false, 'same line but not individually verified')
  assert.equal(classifyDshVersion('0.1.7-beta.0').supported, true)
  assert.equal(classifyDshVersion('0.1.7').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, 'previous verified line is now outside')

  let warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.6-alpha.2')
  assert.equal(warnings, 1, 'a version below the line must warn and stay inert')
  warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.7')
  assert.equal(warnings, 1, 'an unlisted same-line version must warn but still run')
  warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.7-alpha.1')
  assert.equal(warnings, 0, 'the verified version must be silent')
})

test('exports an inert Host half for the client-only feature', () => {
  assert.equal(PLUGIN_NAME, 'dsh-sticky-user-bubble')
  assert.deepEqual(inject, [])
  assert.equal(plugin.name, PLUGIN_NAME)
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.doesNotThrow(() => plugin.apply({}))
})
