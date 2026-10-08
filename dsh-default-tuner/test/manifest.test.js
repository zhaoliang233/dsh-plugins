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
  assert.equal(manifest.name, 'dsh-default-tuner')
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
  }

  // 4) 文档：只在全文任意处出现版本号是不够的（那时把兼容段那行改掉仍然全绿，2026-10-01
  // 注入缺陷验证过；而且清单版本号是 range 下界的子串，`includes` 会假绿）。兼容段**那一行**
  // 必须逐字写出 range，并写出「逐版本清单」标记 + 与 package.json 同源的版本清单。
  const assertCompatLine = (label, text, lineKeyword, listPattern) => {
    const line = text.split('\n').find((item) => item.includes(lineKeyword))
    assert.ok(line !== undefined, `${label} 必须有一段兼容说明（含「${lineKeyword}」的行）`)
    assert.ok(line.includes(manifest.dshCompatibility.range), `${label} 的兼容段必须逐字写出 range`)
    const matched = listPattern.exec(line)
    assert.ok(matched !== null, `${label} 的兼容段必须写出逐版本清单标记`)
    assert.deepEqual(
      matched[1].split(/\s+/u).filter(Boolean),
      verified,
      `${label} 的逐版本清单必须与 package.json 同源`
    )
  }
  assertCompatLine('AGENTS.md', agentsText, '兼容线', /逐版本核对清单\s*`([^`]+)`/u)
  assertCompatLine('README.md', read('README.md'), '逐版本验证', /逐版本验证：\s*`([^`]+)`/u)

  // 范围外必须 inert：行为用例在 test/version-gate.test.js，这里只确认运行时门确实存在
  // （曾经的缺陷正是声明齐全、四处同源，却完全没有实现）。本插件这一轮跨到 0.2.0 线，
  // 所以「上一线」与「下一条线」都必须在门外，旧线的 0.1.7-rc.2 不再兼容。
  assert.equal(typeof host.classifyDshVersion, 'function', '宿主必须实现版本门')
  assert.equal(host.classifyDshVersion('0.2.0-rc.2').supported, true, '已核对的本线版本必须在门内')
  assert.equal(host.classifyDshVersion('0.1.7-rc.2').supported, false, '上一发布线必须被挡在门外')
  assert.equal(host.classifyDshVersion('0.2.1').supported, false, '下一发布线必须被挡在门外')
})

// 跨线时四处必须同时改：package.json 的 range 与 engines.dsh、install.sh 的五个版本门常量，
// 以及 lib/index.js 的 DSH_RELEASE_LINE / DSH_RELEASE_FLOOR / VERIFIED_DSH_VERSIONS。
// 这条守卫拦住"只换了 range 忘改下界"这类半改：下界是 rc 时 alpha/beta/更低 rc 必须仍在门外。
test('发布线、下界与清单在 lib / install.sh / package.json 三处逐字同源', async () => {
  const host = await import(new URL('lib/index.js', root))

  assert.equal(host.DSH_COMPATIBILITY_RANGE, manifest.dshCompatibility.range)
  assert.equal(host.DSH_COMPATIBILITY_RANGE, manifest.engines.dsh, 'engines.dsh 必须与声明的 range 同源')
  assert.deepEqual(host.VERIFIED_DSH_VERSIONS, manifest.dshCompatibility.verifiedVersions)
  // 上界由发布线自身派生：0.2.0 线只服务 <0.2.1。
  const nextPatch = host.DSH_RELEASE_LINE.replace(/(\d+)$/u, (digits) => String(Number(digits) + 1))
  assert.equal(
    host.DSH_COMPATIBILITY_RANGE,
    `>=${host.DSH_RELEASE_LINE}-${host.DSH_RELEASE_FLOOR.channel}.${host.DSH_RELEASE_FLOOR.sequence} <${nextPatch}`
  )
  assert.equal(installText.includes(`DSH_COMPATIBILITY_RANGE="${host.DSH_COMPATIBILITY_RANGE}"`), true)
  assert.equal(installText.includes(`DSH_VERIFIED_VERSIONS="${host.VERIFIED_DSH_VERSIONS.join(' ')}"`), true)
  assert.equal(installText.includes(`DSH_RELEASE_LINE="${host.DSH_RELEASE_LINE}"`), true)
  assert.equal(installText.includes(`DSH_RELEASE_FLOOR_CHANNEL="${host.DSH_RELEASE_FLOOR.channel}"`), true)
  assert.equal(installText.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${host.DSH_RELEASE_FLOOR.sequence}`), true)
  // shell 侧的 channel 优先级表必须与 lib 的 PRERELEASE_CHANNELS 同序（alpha < beta < rc）。
  const ranks = ['alpha', 'beta', 'rc'].map((channel) => {
    const matched = new RegExp(`^\\s*${channel}\\) echo (\\d+) ;;`, 'mu').exec(installText)
    assert.ok(matched !== null, `install.sh 的 prerelease_rank() 必须给 ${channel} 一个序号`)
    return Number(matched[1])
  })
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'shell 侧 channel 优先级必须 alpha < beta < rc')
})

test('bundle patch 只插入一个插件条目', () => {
  assert.match(patchText, /- insert:/u)
  assert.match(patchText, /id: dsh-default-tuner/u)
  assert.match(patchText, /name: dsh-default-tuner/u)
})

test('客户端 bundle 是 __ModuleLoader__ 形态且样式带 data-plugin 标记', () => {
  assert.match(clientText, /window\.__ModuleLoader__\.load\(\{/u)
  assert.match(clientText, /id: 'dsh-default-tuner'/u)
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
  assert.match(clientText, /className: 'ddt-chevron'/u)
})

test('设置分区 order 不低于 100（插件项排在 DSH 自带项之后）', () => {
  const matched = /const SECTION_ORDER = (\d+)/u.exec(clientText)
  assert.ok(matched !== null, '应声明 SECTION_ORDER')
  assert.ok(Number(matched[1]) >= 100)
})

test('宿主入口导出 name/apply，且不把可选服务放进顶层 inject', async () => {
  const host = await import(new URL('lib/index.js', root))
  assert.equal(host.name, 'dsh-default-tuner')
  assert.equal(typeof host.apply, 'function')
  assert.equal(host.inject, undefined)
})
