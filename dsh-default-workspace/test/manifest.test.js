import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8')
)
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

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
    range: '>=0.2.0-rc.2 <0.2.1',
    verifiedVersions: ['0.2.0-rc.2'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.2.0-rc.2 <0.2.1"'), true)
  assert.equal(installScript.includes('DSH_VERIFIED_VERSIONS="0.2.0-rc.2"'), true)
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  // 跨线时发布线/下界是常量而不是一个 range 字符串；宿主与安装脚本必须逐字同源，
  // 否则会出现"宿主放行、安装脚本拒绝"（或反过来）的错配。
  const line = /DSH_RELEASE_LINE = '([^']+)'/u.exec(hostSource)
  assert.notEqual(line, null, '宿主必须声明 DSH_RELEASE_LINE')
  assert.equal(installScript.includes(`DSH_RELEASE_LINE="${line[1]}"`), true, 'install.sh 的发布线必须与宿主同源')
  assert.equal(
    installScript.includes(line[1].replace(/\./gu, '\\.')),
    false,
    'install.sh 不得再硬编码版本号字面量（应从 DSH_RELEASE_LINE 派生）'
  )
  const floor = /DSH_RELEASE_FLOOR = \{ channel: '([^']+)', sequence: (\d+) \}/u.exec(hostSource)
  assert.notEqual(floor, null, '宿主必须声明 DSH_RELEASE_FLOOR')
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_CHANNEL="${floor[1]}"`), true, '下界 channel 必须同源')
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${floor[2]}`), true, '下界序列号必须同源')
  const runtimeList = /VERIFIED_DSH_VERSIONS = \[([^\]]+)\]/u.exec(hostSource)
  assert.notEqual(runtimeList, null, '宿主必须声明已验证版本清单')
  assert.deepEqual(
    runtimeList[1].split(',').map((piece) => piece.trim().replace(/^'|'$/gu, '')).filter((piece) => piece !== ''),
    manifest.dshCompatibility.verifiedVersions
  )
  assert.equal(installScript.includes('npm run publish:check --prefix "$PLUGIN_DIR"'), true)
  assert.ok(manifest.files.includes('LICENSE'))
  assert.ok(manifest.files.includes('CHANGELOG.md'))
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
})
