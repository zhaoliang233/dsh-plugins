import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DSH_COMPATIBILITY_RANGE,
  DSH_RELEASE_FLOOR,
  DSH_RELEASE_LINE,
  VERIFIED_DSH_VERSIONS,
  classifyDshVersion
} from '../lib/dsh.js'
import { PLUGIN_NAME, SETTINGS_ENTRY } from '../lib/store.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const uninstallScript = await readFile(new URL('../uninstall.sh', import.meta.url), 'utf8')
const clientBundle = await readFile(new URL('../client.js', import.meta.url), 'utf8')

// 这一条是**改名守卫**，不是形式检查：`dsh-mcp-console` 这个包名在 npm 上已被第三方占用，
// 发版前必须整体改名，而改名要同步四处（package.json#name、cordis.patch.yml 的 id/name、
// client bundle 的 module id、lib/store.js 的 PLUGIN_NAME 与 SETTINGS_ENTRY）。
// 只要这四处不同源，插件会在「设置条目找不到 schema」或「client bundle 不进 boot graph」
// 上静默失效，所以先用测试把它们钉在一起。
test('包名、条目 id 与客户端 bundle id 必须四处同源（改名时一起改）', () => {
  assert.equal(manifest.name, PLUGIN_NAME)
  // 设置条目 id 就是包名：客户端 ctx.configForms.get(id) 与宿主 settings.describe() 的 ns 都是它。
  assert.equal(SETTINGS_ENTRY, PLUGIN_NAME)
  assert.equal(patch, `- insert:\n    - id: ${PLUGIN_NAME}\n      name: ${PLUGIN_NAME}\n`)
  // 浏览器 bundle 的注册 id（`window.__ModuleLoader__.load({ id })`）必须等于包名，
  // dsh-client-modules 按它把 bundle 加进 boot graph。
  assert.equal(clientBundle.includes(`id: '${PLUGIN_NAME}'`), true)
  assert.equal(uninstallScript.includes(`remove ${PLUGIN_NAME}`), true)
})

test('声明一条兼容发布线与一个 Web 设置分区', () => {
  assert.equal(manifest.engines.node, '>=20')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-ui-settings']
  })
  assert.equal(manifest.files.includes('CHANGELOG.md'), true)
  assert.equal(manifest.files.includes('AGENTS.md'), false, 'AGENTS.md 不进发布物')
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: DSH_COMPATIBILITY_RANGE,
    verifiedVersions: [...VERIFIED_DSH_VERSIONS],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(manifest.engines.dsh, DSH_COMPATIBILITY_RANGE, 'engines.dsh 必须与声明的兼容范围同源')
  assert.equal(installScript.includes(`DSH_COMPATIBILITY_RANGE="${DSH_COMPATIBILITY_RANGE}"`), true)
  assert.equal(installScript.includes('-(alpha|beta|rc)'), true)
})

// 跨线时四处必须同时改：package.json 的 range 与 engines.dsh、install.sh 的五个版本门常量，
// 以及 lib/dsh.js 的 DSH_RELEASE_LINE / DSH_RELEASE_FLOOR / VERIFIED_DSH_VERSIONS。
// 这条守卫拦住"只换了 range 忘改下界"这类半改：下界是 rc 时 alpha/beta/更低 rc 必须仍在门外。
test('发布线、下界与验证清单在四处保持同源', () => {
  assert.equal(installScript.includes(`DSH_RELEASE_LINE="${DSH_RELEASE_LINE}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_CHANNEL="${DSH_RELEASE_FLOOR.channel}"`), true)
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${DSH_RELEASE_FLOOR.sequence}`), true)
  assert.deepEqual([...VERIFIED_DSH_VERSIONS], manifest.dshCompatibility.verifiedVersions)
  // 上界由发布线自身派生：0.2.0 线只服务 <0.2.1。
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

// 版本门的行为本身（跨线最容易错的一环：下界从 alpha 换成 rc 后必须比较 channel 优先级，
// 旧的 `channel !== 'alpha' || seq >= N` 写法会把 0.2.0-alpha.9 判成兼容）。
test('版本门把同线内低于下界的 prerelease 一律挡在门外', () => {
  const cases = [
    ['0.2.0-rc.2', true],
    ['0.2.0-rc.3', true],
    ['0.2.0-rc.10', true],
    ['0.2.0', true],
    ['0.2.0+build.7', true],
    ['0.2.0-rc.1', false],
    ['0.2.0-rc.0', false],
    ['0.2.0-beta.9', false],
    ['0.2.0-alpha.9', false],
    ['0.2.1', false],
    ['0.2.0-rc.2-beta.1', false],
    ['0.1.7-rc.2', false],
    [undefined, false]
  ]
  for (const [version, supported] of cases) {
    assert.equal(classifyDshVersion(version).supported, supported, `classifyDshVersion(${String(version)}).supported`)
  }
  assert.equal(classifyDshVersion('0.2.0-rc.2').verified, true)
  assert.equal(classifyDshVersion('0.2.0-rc.3').verified, false, '同线内未逐条核对的版本只带警告运行')
  assert.equal(classifyDshVersion('0.2.0').verified, false, '正式版尚未逐版本核对，按带警告处理')
})
