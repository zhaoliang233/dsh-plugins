import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DSH_COMPATIBILITY_RANGE,
  DSH_RELEASE_FLOOR,
  DSH_RELEASE_LINE,
  PLUGIN_NAME,
  VERIFIED_DSH_VERSIONS
} from '../lib/profile-manager.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('declares one compatible-release-line dual Host and Settings-section bundle', () => {
  assert.equal(manifest.name, PLUGIN_NAME)
  assert.equal(manifest.version, '0.4.0')
  // 本包已由「仅本地 link 使用」改为可公开发布，护栏随之反转：
  // 断言必须显式声明 public，防止将来被误设为 private 或不声明 access。
  assert.equal(manifest.publishConfig.access, 'public')
  assert.equal(manifest.engines.node, '>=20')
  // 运行时依赖固定为官方同一套实现：profile 写锁与原子提交用 dsh-atomic-write，
  // patch 编辑用官方也在用的 yaml（只有 Document API 能保注释地就地改覆盖项）。
  // 依赖范围随发布线一起走：插件跑在 0.2.1 线上，写锁就必须是同一线的实现
  // （锁路径 `<锚点>.lock` + `wx` + mode 0o600 在整条 0.2.x 线上逐字相同，见 AGENTS.md）。
  assert.deepEqual(manifest.dependencies, {
    '@deepseek-ai/dsh-atomic-write': '~0.2.1-alpha.2',
    yaml: '^2.9.0'
  })
  assert.equal(manifest.files.includes('CHANGELOG.md'), true)
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  // 面板挂在设置面板菜单（settings.section 由 dsh-client-ui-settings-general 声明），
  // bundle 依赖随之从官方插件分区包换成它。
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-ui-settings-general']
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
  assert.equal(installScript.includes('-(alpha|beta|rc)'), true)
  assert.equal(patch, '- insert:\n    - id: dsh-local-plugin-manager\n      name: dsh-local-plugin-manager\n      config:\n        profile: web\n')
})

// 跨线时四处必须同时改：package.json 的 range 与 engines.dsh、install.sh 的五个版本门常量，
// 以及 lib/profile-manager.js 的 DSH_RELEASE_LINE / DSH_RELEASE_FLOOR / VERIFIED_DSH_VERSIONS。
// 这条守卫拦住"只换了 range 忘改下界"这类半改：下界是 alpha.2 时更小的 alpha 必须仍在门外。
test('发布线、下界与验证清单在四处保持同源', () => {
  assert.equal(installScript.includes(`DSH_RELEASE_LINE="${DSH_RELEASE_LINE}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_CHANNEL="${DSH_RELEASE_FLOOR.channel}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${DSH_RELEASE_FLOOR.sequence}`), true)
  assert.deepEqual([...VERIFIED_DSH_VERSIONS], manifest.dshCompatibility.verifiedVersions)
  // 上界由发布线自身派生：0.2.1 线只服务 <0.2.2。
  const nextPatch = DSH_RELEASE_LINE.replace(/(\d+)$/u, (digits) => String(Number(digits) + 1))
  assert.equal(
    DSH_COMPATIBILITY_RANGE,
    `>=${DSH_RELEASE_LINE}-${DSH_RELEASE_FLOOR.channel}.${DSH_RELEASE_FLOOR.sequence} <${nextPatch}`
  )
})

test('安装脚本的兼容范围与逐版本验证清单必须与宿主、manifest 同源', () => {
  // 这两处漂移过一次：install.sh 只认 0.1.6-alpha.1，而宿主清单里是 0.1.6-alpha.2，
  // 真机安装因此每次都打一条“尚未列入逐版本验证清单”的假告警。
  const range = /DSH_COMPATIBILITY_RANGE="([^"]+)"/u.exec(installScript)
  assert.notEqual(range, null, 'install.sh 必须声明兼容范围')
  assert.equal(range[1], DSH_COMPATIBILITY_RANGE, 'install.sh 与宿主的兼容范围必须逐字一致')

  const list = /DSH_VERIFIED_VERSIONS="([^"]*)"/u.exec(installScript)
  assert.notEqual(list, null, 'install.sh 必须声明逐版本验证清单')
  const versions = list[1].split(/\s+/u).filter((version) => version !== '')
  assert.equal(versions.length > 0, true, '逐版本验证清单不得为空')
  assert.deepEqual(versions, [...VERIFIED_DSH_VERSIONS], 'install.sh、宿主与 package.json 的清单必须一致')
})
