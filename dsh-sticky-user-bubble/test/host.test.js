import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, { PLUGIN_NAME, applyForVersion, classifyDshVersion, inject } from '../lib/index.js'

test('keeps the Host half inert outside the audited release line', () => {
  assert.equal(classifyDshVersion('0.2.1-alpha.2+local').supported, true)
  assert.equal(classifyDshVersion('0.2.1-alpha.2+local').verified, true, 'build metadata is stripped before the check')
  assert.equal(classifyDshVersion('0.2.1-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.2.1-alpha.2').verified, true, 'individually verified within the line')
  assert.equal(classifyDshVersion('0.2.1-alpha.3').supported, true)
  assert.equal(classifyDshVersion('0.2.1-alpha.3').verified, false, 'same line but not individually verified')
  assert.equal(classifyDshVersion('0.2.1-beta.1').supported, true, 'beta sits above the alpha floor')
  assert.equal(classifyDshVersion('0.2.1-rc.1').supported, true)
  assert.equal(classifyDshVersion('0.2.1-rc.1').verified, false, 'a higher channel on the line runs with a warning')
  assert.equal(classifyDshVersion('0.2.1').supported, true, 'the stable release of the line stays inside')
  assert.equal(classifyDshVersion('0.2.1').verified, false, 'the stable release is still unlisted until audited')
  assert.equal(classifyDshVersion('0.2.1-alpha.1').supported, false, 'a smaller alpha sequence sits below the floor')
  assert.equal(classifyDshVersion('0.2.0-rc.2').supported, false, 'previous verified line is now outside')
  assert.equal(classifyDshVersion('0.2.2').supported, false, 'the next patch line belongs to another plugin version')
  assert.equal(classifyDshVersion(undefined).supported, false)

  let warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.2.0-rc.2')
  assert.equal(warnings, 1, 'a version below the line must warn and stay inert')
  warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.2.1')
  assert.equal(warnings, 1, 'an unlisted same-line version must warn but still run')
  warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.2.1-alpha.2')
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
