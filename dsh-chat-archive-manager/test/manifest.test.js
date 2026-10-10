import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { DSH_COMPATIBILITY_RANGE, PLUGIN_NAME, VERIFIED_DSH_VERSIONS, classifyDshVersion } from '../lib/index.js'

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
    range: '>=0.2.1-alpha.2 <0.2.2',
    verifiedVersions: ['0.2.1-alpha.2'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(manifest.dshCompatibility.range, DSH_COMPATIBILITY_RANGE)
  assert.deepEqual(manifest.dshCompatibility.verifiedVersions, [...VERIFIED_DSH_VERSIONS])
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  // 四处同源：manifest / engines / install.sh / 本文档。
  assert.equal(installScript.includes(`DSH_COMPATIBILITY_RANGE="${DSH_COMPATIBILITY_RANGE}"`), true)
  assert.equal(installScript.includes(`DSH_VERIFIED_VERSIONS="${VERIFIED_DSH_VERSIONS.join(' ')}"`), true)
  // 版本门必须从「发布线 + 下界」派生，不能把下界的 channel 写进正则：下界是 alpha 时，
  // 同线内更低的序列号（alpha.0/alpha.1）与更早发布线都要挡住，lib 与 install.sh 共用同一套优先级。
  assert.equal(installScript.includes('DSH_RELEASE_LINE="0.2.1"'), true)
  assert.equal(installScript.includes('DSH_RELEASE_FLOOR_CHANNEL="alpha"'), true)
  assert.equal(installScript.includes('DSH_RELEASE_FLOOR_SEQUENCE=2'), true)
  assert.equal(installScript.includes('prerelease_rank()'), true)
  assert.equal(installScript.includes('-(alpha|beta|rc)\\.'), true)
  assert.equal(installScript.includes('npm run publish:check --prefix "$PLUGIN_DIR"'), true)
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
})

test('keeps the runtime gate inert outside the verified release line', () => {
  // 新发布线：0.2.1（正式版与下界及以上的 alpha/beta/rc）在范围内，0.2.0 一线与 0.2.2 起都在范围外。
  assert.deepEqual(classifyDshVersion('0.2.1-alpha.2+local'), {
    supported: true, verified: true, normalized: '0.2.1-alpha.2'
  })
  assert.equal(classifyDshVersion('0.2.1-alpha.3').supported, true)
  assert.equal(classifyDshVersion('0.2.1-alpha.3').verified, false)
  assert.equal(classifyDshVersion('0.2.1-beta.1').supported, true, 'beta is above an alpha floor')
  assert.equal(classifyDshVersion('0.2.1-rc.1').supported, true, 'rc is above an alpha floor')
  assert.equal(classifyDshVersion('0.2.1').supported, true)
  assert.equal(classifyDshVersion('0.2.1-alpha.1').supported, false, 'a lower alpha sequence is below the floor')
  assert.equal(classifyDshVersion('0.2.1-alpha.0').supported, false, 'a lower alpha sequence is below the floor')
  assert.equal(classifyDshVersion('0.2.0').supported, false, 'previous release line is outside')
  assert.equal(classifyDshVersion('0.2.0-rc.2').supported, false, 'previous release line is outside')
  assert.equal(classifyDshVersion('0.2.2-alpha.1').supported, false, 'next line is not claimed yet')
  assert.equal(classifyDshVersion(undefined).supported, false)
})
