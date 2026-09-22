import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { DSH_COMPATIBILITY_RANGE, DSH_VERIFIED_VERSIONS, PLUGIN_NAME, classifyDshVersion } from '../lib/index.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const cordisPatch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('declares a publishable dual Host and browser bundle', () => {
  assert.equal(manifest.name, 'dsh-chat-archive-manager')
  assert.equal(PLUGIN_NAME, manifest.name)
  assert.equal(cordisPatch, '- insert:\n    - id: dsh-chat-archive-manager\n      name: dsh-chat-archive-manager\n')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: [
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-client-ui-settings-general'
    ]
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.1.7-alpha.1 <0.1.8',
    verifiedVersions: ['0.1.7-alpha.1'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(manifest.dshCompatibility.range, DSH_COMPATIBILITY_RANGE)
  assert.deepEqual(manifest.dshCompatibility.verifiedVersions, [...DSH_VERIFIED_VERSIONS])
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  // 四处同源：manifest / engines / install.sh / 本文档。
  assert.equal(installScript.includes(`DSH_COMPATIBILITY_RANGE="${DSH_COMPATIBILITY_RANGE}"`), true)
  assert.equal(installScript.includes(`DSH_VERIFIED_VERSIONS="${DSH_VERIFIED_VERSIONS.join(' ')}"`), true)
  assert.equal(installScript.includes('0\\.1\\.7-(alpha|beta|rc)'), true)
  assert.equal(installScript.includes('npm run publish:check --prefix "$PLUGIN_DIR"'), true)
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
})

test('keeps the runtime gate inert outside the verified release line', () => {
  // 新发布线：0.1.7（含 alpha≥1 与后续 beta/rc）在范围内，0.1.6 一线与 0.1.8 起都在范围外。
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1+local'), {
    supported: true, verified: true, normalized: '0.1.7-alpha.1'
  })
  assert.equal(classifyDshVersion('0.1.7-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.2').verified, false)
  assert.equal(classifyDshVersion('0.1.7').supported, true)
  assert.equal(classifyDshVersion('0.1.7-rc.1').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, 'previous release line is outside')
  assert.equal(classifyDshVersion('0.1.8-rc.1').supported, false, 'next line is not claimed yet')
  assert.equal(classifyDshVersion(undefined).supported, false)
})
