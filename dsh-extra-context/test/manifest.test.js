import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { CLIENT_HEADER, PLUGIN_NAME, STATUS_PATH } from '../lib/index.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
// Windows 检出/npm pack 可能给出 CRLF；YAML 语义与行尾无关，比较前归一化即可
// （不归一化时这条断言会在 Windows 上假失败，发布门禁也就在本机跑不起来）。
const cordisPatch = (await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')).replace(/\r\n/gu, '\n')
const installScript = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const hostSource = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const uninstallScript = await readFile(new URL('../uninstall.sh', import.meta.url), 'utf8')
const clientBundle = await readFile(new URL('../client.js', import.meta.url), 'utf8')

/**
 * 当前环境能否装载 schemastery（= 能否定位 DSH 安装）。
 *
 * 插件在模块作用域按 `process.argv[1]`（DSH CLI 入口）或 PATH 上的 `dsh` 找安装；
 * 两条都没有时 `Config` 为 undefined——这正是 GitHub runner 上的情况（CI 只 checkout
 * 本仓库、不装 DSH）。运行时永远在 DSH 进程里，所以真实部署不会走到这条路径；
 * 这里按环境跳过，而不是把"CI 没装 DSH"当成插件缺陷。
 */
async function canLoadSchemastery() {
  const module = await import('../lib/index.js')
  return module.Config !== undefined
}

test('插件身份与发布面', () => {
  assert.equal(manifest.name, 'dsh-extra-context')
  assert.equal(PLUGIN_NAME, manifest.name)
  assert.equal(cordisPatch, '- insert:\n    - id: dsh-extra-context\n      name: dsh-extra-context\n')
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
    inject: ['@deepseek-ai/dsh-client-ui-settings']
  })
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.1.7-alpha.1 <0.1.8',
    verifiedVersions: ['0.1.7-alpha.1'],
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(manifest.scripts.prepublishOnly, 'npm run publish:check')
  assert.equal(manifest.scripts.check.includes('node --check lib/rules.js'), true)
  assert.equal(manifest.files.includes('lib'), true)
  assert.equal(manifest.files.includes('client.js'), true)
  // Windows 回归护栏：require.resolve 给的是文件系统路径，ESM 装载器只接受带协议的
  // 说明符。直接 `import(resolved)` 在 Windows 上抛 ERR_UNSUPPORTED_ESM_URL_SCHEME，
  // schema 静默变 null → settings 命名空间不注册 → 设置页动作按钮永久禁用。
  // 这条断言在 POSIX 上也会失败（那边裸绝对路径能 import，缺陷更隐蔽），故必须留。
  assert.equal(hostSource.includes('await import(pathToFileURL(resolved).href)'), true, 'schemastery 必须经 file URL 动态 import')
})

test('Config 必须挂在 default 导出上：loader 只从 unwrap 后的插件对象读 runtime.Config', { skip: await canLoadSchemastery() ? false : '当前环境定位不到 DSH 安装（CI 上没装 dsh）：schema 断言跳过' }, async () => {
  // 真实缺陷（用户实测反馈）：插件同时有 default 与命名导出时，Cordis 的
  // `Loader.unwrapExports()` 返回的是 default 对象，而 `registry.plugin()` 只从
  // 那个对象上读 `runtime.Config`。只写 `export const Config` 会让
  // `settings.describe()` 判定本条目没有 schema → 条目不进配置表单 →
  // 状态接口 `writable:false`、设置页动作控件永久禁用、写入全部被拒。
  const module = await import('../lib/index.js')
  assert.notEqual(module.Config, undefined, '模块必须导出 Config（schemastery schema）')
  assert.equal(typeof module.Config.toJSON, 'function', 'Config 必须是真正的 schemastery 对象')
  assert.equal(module.default.Config, module.Config, 'Config 必须同时挂在 default 导出上（loader 取的是 default 对象）')
})

test('安装脚本与运行时的"已验证版本清单"必须同源', () => {
  // 两处清单漂移过一次：install.sh 只认 alpha.1，而实际部署跑 rc.2，
  // 于是每次安装都打假告警。这条断言防止再次漂移。
  const range = /DSH_COMPATIBILITY_RANGE="([^"]+)"/u.exec(installScript)
  assert.notEqual(range, null, 'install.sh 必须声明兼容范围')
  const runtimeRange = /DSH_COMPATIBILITY_RANGE = '([^']+)'/u.exec(hostSource)
  assert.notEqual(runtimeRange, null, '宿主必须声明兼容范围')
  assert.equal(range[1], runtimeRange[1], 'install.sh 与宿主的兼容范围必须逐字一致')

  const runtimeList = /VERIFIED_DSH_VERSIONS = \[([^\]]+)\]/u.exec(hostSource)
  assert.notEqual(runtimeList, null, '宿主必须声明已验证版本清单')
  const runtimeVersions = runtimeList[1].split(',').map((piece) => piece.trim().replace(/^'|'$/gu, '')).filter((piece) => piece !== '')
  assert.equal(runtimeVersions.length > 0, true, '已验证清单不得为空')
  const manifestVersions = manifest.dshCompatibility.verifiedVersions
  assert.deepEqual(runtimeVersions, manifestVersions, 'package.json 与宿主的清单必须一致')
  for (const version of runtimeVersions) {
    assert.equal(installScript.includes(`"${version}"`), true, `install.sh 必须包含已验证版本 ${version}`)
  }
})

test('安装与卸载脚本走官方 profile 管理', () => {
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.1.7-alpha.1 <0.1.8"'), true)
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.equal(installScript.includes('0\\.1\\.7-(alpha|beta|rc)'), true)
  assert.equal(installScript.includes('DSH_VERIFIED_VERSIONS="0.1.7-alpha.1"'), true)
  assert.equal(installScript.includes('npm run publish:check --prefix "$PLUGIN_DIR"'), true)
  assert.equal(installScript.includes('dsh plugin --profile "$DSH_PROFILE" add "link:$PLUGIN_DIR" --config.minimumReleaseAge=0'), true)
  assert.equal(installScript.includes('必须重启 dsh web'), true)
  assert.equal(uninstallScript.includes('dsh plugin --profile "$DSH_PROFILE" remove dsh-extra-context --config.minimumReleaseAge=0'), true)
  assert.equal(uninstallScript.includes('保留不删'), true)
})

test('客户端 bundle 结构与宿主路由契约一致', () => {
  assert.equal(clientBundle.startsWith('window.__ModuleLoader__.load({'), true)
  assert.equal(clientBundle.includes("id: 'dsh-extra-context'"), true)
  assert.equal(clientBundle.includes("require('react')"), true)
  assert.equal(clientBundle.includes(`const STATUS_PATH = '${STATUS_PATH}'`), true)
  assert.equal(clientBundle.includes(`const CLIENT_HEADER = '${CLIENT_HEADER}'`), true)
  assert.equal(clientBundle.includes("exports.inject = inject"), true)
  // 0.1.7：settingsScope 已被删除，改成条目级配置表单
  assert.equal(clientBundle.includes('ctx.configForms.get(SETTINGS_ENTRY)'), true)
  assert.equal(clientBundle.includes('ctx.settingsScope'), false, '不得再引用已删除的 settingsScope 服务')
  assert.equal(clientBundle.includes("ctx.slots.inject('settings.section'"), true)
  // 导航图标补丁的挂载点：壳层只给 4 个官方 id 配图标，缺了它这一行会一直显示齿轮
  assert.equal(clientBundle.includes("ctx.slots.inject('settings.action'"), true)
  assert.equal(clientBundle.includes('IconContextInjectionOutline16'), true)
  assert.equal(clientBundle.includes('React.createElement'), true)
  // 不得出现 JSX / TS / import 语法：bundle 是纯 CJS 惰性模型。
  assert.equal(/<[A-Z][A-Za-z]*\s*\/>/u.test(clientBundle), false)
  assert.equal(/^\s*import\s/mu.test(clientBundle), false)
})
