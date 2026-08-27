import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DSH_COMPATIBILITY_RANGE,
  PLUGIN_NAME,
  VERIFIED_DSH_VERSIONS
} from '../lib/profile-manager.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('declares one compatible-release-line dual Host and Settings-tab bundle', () => {
  assert.equal(manifest.name, PLUGIN_NAME)
  assert.equal(manifest.version, '0.1.3')
  assert.equal(manifest.private, true)
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.dependencies['js-yaml'], '4.3.2')
  assert.equal(manifest.files.includes('CHANGELOG.md'), true)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-ui-settings-plugins']
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: DSH_COMPATIBILITY_RANGE,
    verifiedVersions: [...VERIFIED_DSH_VERSIONS],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(installScript.includes(`DSH_COMPATIBILITY_RANGE="${DSH_COMPATIBILITY_RANGE}"`), true)
  assert.equal(manifest.engines.dsh, DSH_COMPATIBILITY_RANGE, 'engines.dsh must stay in sync with the declared range')
  assert.equal(installScript.includes('0\\.1\\.6-(alpha|beta|rc)'), true)
  assert.equal(patch, '- insert:\n    - id: dsh-local-plugin-manager\n      name: dsh-local-plugin-manager\n      config:\n        profile: web\n')
})
