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

test('兼容发布线与安装脚本的逐版本清单一致', () => {
  const verified = manifest.dshCompatibility.verifiedVersions
  for (const version of verified) assert.ok(installText.includes(version), `${version} 应出现在 install.sh`)
  assert.ok(installText.includes(manifest.dshCompatibility.range))
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
