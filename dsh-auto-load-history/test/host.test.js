import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, {
  PLUGIN_NAME,
  applyForVersion,
  classifyDshVersion,
  inject
} from '../lib/index.js'

test('keeps the Host half inert outside the audited release line', () => {
  assert.equal(classifyDshVersion('0.2.0-rc.2+local').supported, true)
  assert.equal(classifyDshVersion('0.2.0-rc.2+local').verified, true)
  assert.equal(classifyDshVersion('0.2.0-rc.3').supported, true)
  assert.equal(classifyDshVersion('0.2.0-rc.3').verified, false, 'same line but not individually verified')
  // 下界是 rc：同线内的 alpha/beta 与更小的 rc 序列号一律在门外，正式版在门内。
  assert.equal(classifyDshVersion('0.2.0-alpha.9').supported, false, 'alpha sits below the rc floor')
  assert.equal(classifyDshVersion('0.2.0-beta.9').supported, false, 'beta sits below the rc floor')
  assert.equal(classifyDshVersion('0.2.0-rc.1').supported, false, 'a smaller rc sequence sits below the floor')
  assert.equal(classifyDshVersion('0.2.0').supported, true, 'the GA release of the line is inside the door')
  assert.equal(classifyDshVersion('0.2.0').verified, false, 'GA is inside but not individually listed')
  assert.equal(classifyDshVersion('0.1.7-rc.2').supported, false, 'previous release line is now outside')
  assert.equal(classifyDshVersion('0.2.1').supported, false, 'the next patch line is outside')
  assert.equal(classifyDshVersion(undefined).supported, false)

  let warnings = 0
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.1.7-rc.2')
  assert.equal(warnings, 1, 'below the line: warn and stay inert')
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.2.0')
  assert.equal(warnings, 2, 'same line but unlisted: warn but still run')
  applyForVersion({ logger: { warn() { warnings += 1 } } }, '0.2.0-rc.2')
  assert.equal(warnings, 2, 'the verified version is silent')
})

test('exports an inert Host half for the client-only feature', () => {
  assert.equal(PLUGIN_NAME, 'dsh-auto-load-history')
  assert.deepEqual(inject, [])
  assert.equal(plugin.name, PLUGIN_NAME)
  assert.deepEqual(plugin.inject, [])
  assert.equal(typeof plugin.apply, 'function')
  assert.doesNotThrow(() => plugin.apply({}))
})
