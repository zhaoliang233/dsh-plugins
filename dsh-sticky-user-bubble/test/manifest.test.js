import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { DSH_RELEASE_FLOOR, DSH_RELEASE_LINE, VERIFIED_DSH_VERSIONS } from '../lib/index.js'

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('declares a publishable Web client bundle', () => {
  assert.equal(manifest.name, 'dsh-sticky-user-bubble')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-ui-chat']
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.2.0-rc.2 <0.2.1',
    verifiedVersions: ['0.2.0-rc.2'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.2.0-rc.2 <0.2.1"'), true)
  assert.equal(
    installScript.includes('DSH_VERIFIED_VERSIONS="0.2.0-rc.2"'),
    true,
    'install.sh must list exactly the verified versions (space separated)'
  )
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.equal(installScript.includes('(alpha|beta|rc)'), true)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('CHANGELOG.md'))
  assert.ok(manifest.files.includes('PUBLISHING.md'))
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
  assert.notEqual(manifest.private, true)
})

// 版本门从常量派生：range、发布线、下界与验证清单在四处保持同源
// （package.json / lib/index.js / install.sh / 插件文档）。
test('the release line, its floor, and the verified list stay in sync across all four places', () => {
  assert.deepEqual(VERIFIED_DSH_VERSIONS, manifest.dshCompatibility.verifiedVersions)
  // 上界由发布线自身派生：0.2.0 线只服务 <0.2.1。
  const nextPatch = DSH_RELEASE_LINE.replace(/(\d+)$/u, (digits) => String(Number(digits) + 1))
  assert.equal(
    manifest.dshCompatibility.range,
    `>=${DSH_RELEASE_LINE}-${DSH_RELEASE_FLOOR.channel}.${DSH_RELEASE_FLOOR.sequence} <${nextPatch}`
  )
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range)
  assert.equal(installScript.includes(`DSH_RELEASE_LINE="${DSH_RELEASE_LINE}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_CHANNEL="${DSH_RELEASE_FLOOR.channel}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${DSH_RELEASE_FLOOR.sequence}`), true)
})

test('bundle patch inserts the package by its published name', () => {
  assert.equal(patch, '- insert:\n    - id: dsh-sticky-user-bubble\n      name: dsh-sticky-user-bubble\n')
})
