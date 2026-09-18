import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const uninstallScript = await readFile(new URL('../uninstall.sh', import.meta.url), 'utf8')
const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')

test('declares a publishable Web client bundle', () => {
  assert.equal(manifest.name, 'dsh-auto-load-history')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['.'], './lib/index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: [
      '@deepseek-ai/dsh-api-session-controller',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-ui-conversation',
      '@deepseek-ai/dsh-client-ui-settings-general'
    ]
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.1.6-alpha.1 <0.1.7',
    verifiedVersions: ['0.1.6-alpha.2'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.1.6-alpha.1 <0.1.7"'), true)
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.equal(installScript.includes('(alpha|beta|rc)'), true)
  assert.equal(installScript.includes('--config.minimumReleaseAge=0'), true)
  assert.equal(uninstallScript.includes('remove dsh-auto-load-history'), true)
  assert.equal(uninstallScript.includes('--config.minimumReleaseAge=0'), true)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('CHANGELOG.md'))
  assert.ok(manifest.files.includes('PUBLISHING.md'))
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
  assert.notEqual(manifest.private, true)
})

test('bundle patch inserts the package by its published name', () => {
  assert.equal(patch, '- insert:\n    - id: dsh-auto-load-history\n      name: dsh-auto-load-history\n')
})

test('the browser bundle loads under the package id without joining a Host route', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(\{\n {2}id: 'dsh-auto-load-history',/u)
  assert.equal(client.includes("exports.inject = inject"), true)
  assert.equal(client.includes('exports.apply = apply'), true)
  assert.equal(client.includes('webServer'), false)
})
