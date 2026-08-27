import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('declares publishable bundle and client metadata', () => {
  assert.equal(manifest.name, 'dsh-default-workspace')
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: [
      '@deepseek-ai/dsh-api-workspace-controller',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-workspace',
      '@deepseek-ai/dsh-client-ui-primitives'
    ]
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.1.6-alpha.1 <0.1.7',
    verifiedVersions: ['0.1.6-alpha.1'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.1.6-alpha.1 <0.1.7"'), true)
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.equal(installScript.includes('0\\.1\\.6-(alpha|beta|rc)'), true)
  assert.equal(installScript.includes('npm run publish:check --prefix "$PLUGIN_DIR"'), true)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('CHANGELOG.md'))
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
})
