import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('..', import.meta.url)
const read = (name) => readFileSync(new URL(name, root), 'utf8')

const manifest = JSON.parse(read('package.json'))
const patchText = read('cordis.patch.yml')
const clientText = read('client.js')
const installText = read('install.sh')

test('package.json 声明双面包与 bundle patch', () => {
  assert.equal(manifest.name, 'dsh-default-overrides')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.exports['.'], './lib/index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.equal(manifest.publishConfig.access, 'public')
  assert.ok(manifest.files.includes('client.js'))
  assert.ok(manifest.files.includes('lib'))
})

test('兼容发布线「四处同源」：package.json ⟷ lib ⟷ install.sh ⟷ 文档', async () => {
  const agentsText = read('AGENTS.md')
  const host = await import(new URL('lib/index.js', root))

  // 1) package.json 内部：dshCompatibility.range 与 engines.dsh 必须逐字相同
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh 必须与 dshCompatibility.range 同源')
  // 2) lib 的运行时常量
  assert.equal(
    host.DSH_COMPATIBILITY_RANGE,
    manifest.dshCompatibility.range,
    'lib 的 DSH_COMPATIBILITY_RANGE 必须与 package.json 同源'
  )
  // 3) install.sh：按行解析赋值，而不是 includes 子串匹配
  const shellRange = /^DSH_COMPATIBILITY_RANGE="([^"]*)"/mu.exec(installText)
  assert.ok(shellRange !== null, 'install.sh 必须声明 DSH_COMPATIBILITY_RANGE')
  assert.equal(
    shellRange[1],
    manifest.dshCompatibility.range,
    'install.sh 的 DSH_COMPATIBILITY_RANGE 必须与 package.json 同源'
  )

  const verified = manifest.dshCompatibility.verifiedVersions
  assert.deepEqual(host.VERIFIED_DSH_VERSIONS, verified, 'lib 的 VERIFIED_DSH_VERSIONS 必须与 package.json 同源')
  const shellVerified = /^DSH_VERIFIED_VERSIONS="([^"]*)"/mu.exec(installText)
  assert.ok(shellVerified !== null, 'install.sh 必须声明 DSH_VERIFIED_VERSIONS')
  // 多版本用空格分隔，脚本按词分割消费
  assert.deepEqual(shellVerified[1].split(/\s+/u).filter(Boolean), verified, 'install.sh 的清单必须与 package.json 同源')
  for (const version of verified) {
    assert.equal(host.classifyDshVersion(version).verified, true, `${version}：lib 必须认它是已核对版本`)
    assert.ok(agentsText.includes(version), `${version} 应出现在 AGENTS.md 的逐版本核对记录里`)
    assert.ok(read('README.md').includes(version), `${version} 应出现在 README 的要求段里`)
  }

  // 范围外必须 inert：行为用例在 test/version-gate.test.js，这里只确认运行时门确实存在
  // （曾经的缺陷正是声明齐全、四处同源，却完全没有实现）。
  assert.equal(typeof host.classifyDshVersion, 'function', '宿主必须实现版本门')
  assert.equal(host.classifyDshVersion('0.2.0-rc.2').supported, false, '下一发布线必须被挡在门外')
})

test('bundle patch 只插入一个插件条目', () => {
  assert.match(patchText, /- insert:/u)
  assert.match(patchText, /id: dsh-default-overrides/u)
  assert.match(patchText, /name: dsh-default-overrides/u)
})

test('客户端 bundle 是 __ModuleLoader__ 形态且样式带 data-plugin 标记', () => {
  assert.match(clientText, /window\.__ModuleLoader__\.load\(\{/u)
  assert.match(clientText, /id: 'dsh-default-overrides'/u)
  assert.match(clientText, /data-plugin="\$\{PLUGIN_ID\}"/u)
  assert.match(clientText, /exports\.inject = \['slots'\]/u)
})

test('界面一律使用官方 primitives（图标与控件），不自绘', () => {
  assert.match(clientText, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/u)
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'))
  // 折叠箭头必须是官方图标；标签、按钮、输入框也走官方组件
  assert.match(clientText, /IconTriangleRightFill/u)
  assert.match(clientText, /exportOf\('Button'\)/u)
  assert.match(clientText, /exportOf\('Input'\)/u)
  assert.match(clientText, /exportOf\('Tag'\)/u)
  // 不允许再出现自绘的箭头字符或原生控件
  assert.doesNotMatch(clientText, /'\u25b8'|'▸'/u)
  assert.doesNotMatch(clientText, /React\.createElement\('button'/u)
  assert.doesNotMatch(clientText, /React\.createElement\('input'/u)
})

test('折叠模块只有一个出口，避免手写 details 时漏掉官方图标', () => {
  // 2026-09-28 踩过：高级模式曾手写 <details>，关掉浏览器 marker 后它没有图标、整行没有箭头。
  const detailsCalls = clientText.match(/React\.createElement\('details'/gu) ?? []
  assert.equal(detailsCalls.length, 1, '只允许 Module 组件内部创建 details')
  assert.match(clientText, /className: 'ddo-chevron'/u)
})

test('设置分区 order 不低于 100（插件项排在 DSH 自带项之后）', () => {
  const matched = /const SECTION_ORDER = (\d+)/u.exec(clientText)
  assert.ok(matched !== null, '应声明 SECTION_ORDER')
  assert.ok(Number(matched[1]) >= 100)
})

test('宿主入口导出 name/apply，且不把可选服务放进顶层 inject', async () => {
  const host = await import(new URL('lib/index.js', root))
  assert.equal(host.name, 'dsh-default-overrides')
  assert.equal(typeof host.apply, 'function')
  assert.equal(host.inject, undefined)
})
