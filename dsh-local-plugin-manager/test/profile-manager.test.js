import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { nextPatchText, pruneRowOverrides } from '../lib/patch-writer.js'
import {
  DSH_COMPATIBILITY_RANGE,
  MAX_DESCRIPTION_LENGTH,
  LocalPluginManagerError,
  LocalPluginProfile,
  classifyDshVersion,
  resolveCurrentDshRuntime,
  runDshPluginRemove
} from '../lib/profile-manager.js'

const TEST_DSH_VERSION = '0.1.7-alpha.2'
const FIGMA_PATCH = `# Your patch layer\n# >>> Figma Desktop MCP\n- insert:\n    - id: mcp-figma-desktop\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: figma\n# <<< Figma Desktop MCP\n`
const ROW = { id: 'dsh-demo-local', name: 'dsh-demo-local' }

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function createFixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-local-plugin-manager-'))
  const dshHome = join(root, '.dsh')
  const profileDir = join(dshHome, 'profiles', 'web')
  const sourceRoot = join(root, 'sources')
  await mkdir(profileDir, { recursive: true })
  await mkdir(sourceRoot, { recursive: true })

  const definitions = options.plugins ?? [
    { name: 'dsh-demo-local', version: '1.2.3', client: true }
  ]
  const dependencies = {}
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
  for (const definition of definitions) {
    const pluginDir = join(sourceRoot, definition.name)
    await mkdir(pluginDir, { recursive: true })
    const patch = definition.patch ?? `- insert:\n    - id: ${definition.name}\n      name: ${definition.name}\n`
    await writeFile(join(pluginDir, 'cordis.patch.yml'), patch)
    const manifest = {
      name: definition.manifestName ?? definition.name,
      version: definition.version ?? '0.1.0',
      type: 'module',
      main: 'index.js',
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        ...(definition.client ? { client: { platform: 'web' } } : {})
      }
    }
    if (definition.description !== null) {
      manifest.description = definition.description ?? `${definition.name} fixture`
    }
    await writeJson(join(pluginDir, 'package.json'), manifest)
    dependencies[definition.name] = `link:${pluginDir}`
    if (definition.inBundleStack !== false) bundles.push(definition.name)
  }

  await writeJson(join(profileDir, 'package.json'), {
    name: 'fixture-profile',
    private: true,
    dsh: { profile: { bundles, patchReload: 'live' } },
    dependencies
  })
  await writeFile(join(profileDir, 'cordis.patch.yml'), options.profilePatch ?? FIGMA_PATCH)
  if (options.homePatch !== undefined) await writeFile(join(dshHome, 'cordis.patch.yml'), options.homePatch)

  const liveCalls = []
  const profile = new LocalPluginProfile({
    dshHome,
    profileDir,
    profile: 'web',
    runtime: { cliPath: '/unused', version: TEST_DSH_VERSION },
    processMarker: options.processMarker ?? 'process-a',
    onLiveState: async (plugin, disabled) => {
      liveCalls.push({ name: plugin.name, disabled })
      return { applied: true, matched: 1 }
    },
    commandRunner: options.commandRunner
  })

  return {
    root,
    dshHome,
    profileDir,
    profile,
    liveCalls,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    async readPatch() { return readFile(join(profileDir, 'cordis.patch.yml'), 'utf8') },
    async cleanup() { await rm(root, { recursive: true, force: true }) }
  }
}

function pluginByName(snapshot, name = 'dsh-demo-local') {
  return snapshot.plugins.find((plugin) => plugin.name === name)
}

function overrideCount(text, id) {
  return text.split('\n').filter((line) => line === `- id: ${id}`).length
}

test('appends a top-level override and treats an already-matching row as no change', () => {
  const next = nextPatchText(FIGMA_PATCH, [ROW], false)
  assert.equal(next.changed, true)
  // 既有字节原样保留：注释、引号与缩进都不被重排。
  assert.equal(next.text.includes('# Your patch layer'), true)
  assert.equal(next.text.includes('# >>> Figma Desktop MCP'), true)
  assert.equal(next.text.includes("name: '@deepseek-ai/dsh-mcp-client'"), true)
  assert.equal(next.text.includes('- id: dsh-demo-local\n  disabled: true'), true)
  assert.equal(overrideCount(next.text, 'dsh-demo-local'), 1)

  // 官方语义：值已经正确时返回「无变化」，调用方因此不会白白重写文件。
  assert.deepEqual(nextPatchText(next.text, [ROW], false), { text: next.text, changed: false })

  // 启用写显式 `disabled: false` 而不是删除条目，这样官方也读得到同一个值。
  const enabled = nextPatchText(next.text, [ROW], true)
  assert.equal(enabled.text.includes('- id: dsh-demo-local\n  disabled: false'), true)
  assert.equal(overrideCount(enabled.text, 'dsh-demo-local'), 1)
})

test('never writes through an override that declares another module name', () => {
  const foreign = `${FIGMA_PATCH}- id: dsh-demo-local\n  name: someone-else\n  disabled: true\n`
  const next = nextPatchText(foreign, [ROW], true)
  assert.equal(overrideCount(next.text, 'dsh-demo-local'), 2, 'must append its own row instead of editing a different module')
  assert.equal(next.text.includes('name: someone-else\n  disabled: true'), true)
})

test('keeps comments and !!js expressions intact while editing a row', () => {
  const patch = `# keep me\n- insert:\n    - id: mcp-jira\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        headers:\n          Authorization: !!js '\`Basic \${process.env.JIRA}\`'\n`
  const next = nextPatchText(patch, [ROW], false)
  assert.equal(next.text.includes('# keep me'), true)
  assert.equal(next.text.includes('!!js'), true)
  assert.equal(next.text.includes('Basic ${process.env.JIRA}'), true)
})

test('creates a sequence in a comment-only patch instead of failing', () => {
  const next = nextPatchText('# user patch\n', [ROW], false)
  assert.equal(next.text.includes('- id: dsh-demo-local\n  disabled: true'), true)
})

test('refuses a patch that is not a top-level sequence', () => {
  assert.throws(
    () => nextPatchText('id: not-a-sequence\n', [ROW], false),
    (error) => error instanceof LocalPluginManagerError && error.code === 'invalid-patch'
  )
})

test('prunes a stale override, keeping any other configuration on that entry', () => {
  const both = pruneRowOverrides('- id: dsh-demo-local\n  disabled: true\n', ['dsh-demo-local'])
  assert.equal(both.changed, true)
  assert.equal(both.text.includes('dsh-demo-local'), false)

  const configured = pruneRowOverrides('- id: dsh-demo-local\n  disabled: true\n  name: dsh-demo-local\n', ['dsh-demo-local'])
  assert.equal(configured.text.includes('disabled'), false)
  assert.equal(configured.text.includes('name: dsh-demo-local'), true)

  assert.deepEqual(pruneRowOverrides(FIGMA_PATCH, ['dsh-demo-local']), { text: FIGMA_PATCH, changed: false })
})

test('lists link bundles and protects source paths as server-owned facts', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const snapshot = await fixture.profile.list()
  const plugin = pluginByName(snapshot)
  assert.equal(snapshot.profile, 'web')
  assert.equal(plugin.version, '1.2.3')
  assert.equal(plugin.path.startsWith(await realpath(fixture.root)), true)
  assert.equal(plugin.manageable, true)
  assert.equal(plugin.enabled, true)
  assert.equal(plugin.status, 'enabled')
  assert.equal(plugin.canDisable, true)
})

test('publishes one bounded single-line description per plugin', async (t) => {
  const fixture = await createFixture({
    plugins: [
      { name: 'dsh-demo-long', description: `  ${'很长的说明 '.repeat(40)}  ` },
      { name: 'dsh-demo-spaced', description: '第一行\n\t第二行\u0007' },
      { name: 'dsh-demo-nodesc', description: null }
    ]
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const snapshot = await fixture.profile.list()

  const long = pluginByName(snapshot, 'dsh-demo-long')
  assert.equal(long.description.length, MAX_DESCRIPTION_LENGTH)
  assert.equal(long.description.endsWith('…'), true)
  assert.equal(long.description.startsWith('很长的说明 很长的说明'), true)

  assert.equal(pluginByName(snapshot, 'dsh-demo-spaced').description, '第一行 第二行')
  assert.equal(pluginByName(snapshot, 'dsh-demo-nodesc').description, undefined)
})

test('does not list local dependencies outside the active bundle stack', async (t) => {
  const fixture = await createFixture({
    plugins: [{ name: 'dsh-not-a-bundle', inBundleStack: false }]
  })
  t.after(() => fixture.cleanup())
  assert.deepEqual((await fixture.profile.list()).plugins, [])
})

test('rejects a bundle patch symlink that escapes the plugin directory', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  const patchPath = join(fixture.root, 'sources', 'dsh-demo-local', 'cordis.patch.yml')
  const escapedPath = join(fixture.root, 'outside.patch.yml')
  await writeFile(escapedPath, '- insert:\n    - id: escaped\n      name: escaped\n')
  await rm(patchPath)
  await symlink(escapedPath, patchPath)
  const plugin = pluginByName(await fixture.profile.list())
  assert.equal(plugin.manageable, false)
  assert.equal(plugin.reason.includes('符号链接'), true)
})

test('fails closed for bundle patches that override existing rows', async (t) => {
  const fixture = await createFixture({
    plugins: [{
      name: 'dsh-unsafe-local',
      patch: '- id: existing-host-row\n  disabled: true\n'
    }]
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const plugin = pluginByName(await fixture.profile.list(), 'dsh-unsafe-local')
  assert.equal(plugin.manageable, false)
  assert.equal(plugin.reason.includes('改写既有条目'), true)
  await assert.rejects(
    fixture.profile.setEnabled('dsh-unsafe-local', false),
    (error) => error instanceof LocalPluginManagerError && error.code === 'not-manageable'
  )
})

test('protects the manager from self-disable and self-uninstall', async (t) => {
  const fixture = await createFixture({
    plugins: [{ name: 'dsh-local-plugin-manager', client: true }]
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const plugin = pluginByName(await fixture.profile.list(), 'dsh-local-plugin-manager')
  assert.equal(plugin.self, true)
  assert.equal(plugin.canDisable, false)
  assert.equal(plugin.canUninstall, false)
  await assert.rejects(
    fixture.profile.setEnabled('dsh-local-plugin-manager', false),
    (error) => error instanceof LocalPluginManagerError && error.code === 'self-protected'
  )
  await assert.rejects(
    fixture.profile.uninstall('dsh-local-plugin-manager'),
    (error) => error instanceof LocalPluginManagerError && error.code === 'self-protected'
  )
})

test('refuses corrupt state without changing the profile patch', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  const stateDir = join(fixture.profileDir, '.dsh-local-plugin-manager')
  await mkdir(stateDir, { recursive: true })
  await writeFile(join(stateDir, 'state.json'), '{ broken')
  await assert.rejects(
    fixture.profile.initialize(),
    (error) => error instanceof LocalPluginManagerError && error.code === 'invalid-state'
  )
  assert.equal(await fixture.readPatch(), FIGMA_PATCH)
})

test('refuses a legacy v1 state file instead of guessing what it meant', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  const stateDir = join(fixture.profileDir, '.dsh-local-plugin-manager')
  await mkdir(stateDir, { recursive: true })
  // v1 用 `disabled` 包名列表记账，本版只认 v2 卸载墓碑：读到旧 schema 直接 fail closed，
  // 不按猜测重写用户的 patch。
  await writeFile(join(stateDir, 'state.json'), `${JSON.stringify({ version: 1, disabled: ['dsh-demo-local'], pendingRemovals: [] }, null, 2)}\n`)
  await assert.rejects(
    fixture.profile.initialize(),
    (error) => error instanceof LocalPluginManagerError && error.code === 'invalid-state'
  )
  assert.equal(await fixture.readPatch(), FIGMA_PATCH)
})

test('merges with a concurrent profile patch edit instead of overwriting it', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const concurrentText = `${FIGMA_PATCH}# concurrent user edit\n`
  await writeFile(fixture.patchPath, concurrentText)

  const result = await fixture.profile.setEnabled('dsh-demo-local', false)
  assert.equal(result.enabled, false)
  const patch = await fixture.readPatch()
  assert.equal(patch.includes('# concurrent user edit'), true)
  assert.equal(patch.includes('mcp-figma-desktop'), true)
  assert.equal(patch.includes('- id: dsh-demo-local\n  disabled: true'), true)
})

test('writes and clears one shared override across disable and enable', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  let result = await fixture.profile.setEnabled('dsh-demo-local', false)
  assert.equal(result.enabled, false)
  assert.equal(result.refresh, true)
  assert.equal(pluginByName(result.snapshot).enabled, false)
  let patch = await fixture.readPatch()
  assert.equal(patch.includes('- id: dsh-demo-local\n  disabled: true'), true)
  assert.equal(overrideCount(patch, 'dsh-demo-local'), 1)
  assert.deepEqual(fixture.liveCalls.at(-1), { name: 'dsh-demo-local', disabled: true })

  result = await fixture.profile.setEnabled('dsh-demo-local', true)
  assert.equal(result.enabled, true)
  assert.equal(pluginByName(result.snapshot).enabled, true)
  patch = await fixture.readPatch()
  assert.equal(patch.includes('mcp-figma-desktop'), true)
  assert.equal(patch.includes('- id: dsh-demo-local\n  disabled: false'), true)
  assert.equal(overrideCount(patch, 'dsh-demo-local'), 1)
  assert.deepEqual(fixture.liveCalls.at(-1), { name: 'dsh-demo-local', disabled: false })
})

test('takes over the override written by the official plugin manager, in place', async (t) => {
  // 官方侧边栏插件页写的是顶层 `- id / disabled: true`，追加在文件末尾。
  const profilePatch = `${FIGMA_PATCH}- id: dsh-demo-local\n  disabled: true\n`
  const fixture = await createFixture({ profilePatch })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  const before = pluginByName(await fixture.profile.list())
  assert.equal(before.enabled, false)
  assert.equal(before.canEnable, true, '管理器必须能接管 profile 级覆盖项，否则两边会互相回滚')
  assert.equal(before.externalControl, false)

  const result = await fixture.profile.setEnabled('dsh-demo-local', true)
  assert.equal(result.enabled, true)
  const patch = await fixture.readPatch()
  assert.equal(overrideCount(patch, 'dsh-demo-local'), 1, '必须就地改写官方那条，而不是再追加一条')
  assert.equal(patch.includes('- id: dsh-demo-local\n  disabled: false'), true)
  assert.equal(patch.includes('mcp-figma-desktop'), true)

  // 反向：官方把行改成 disabled 后，管理器读到的就是禁用。
  await writeFile(fixture.patchPath, `${FIGMA_PATCH}- id: dsh-demo-local\n  disabled: true\n`)
  assert.equal(pluginByName(await fixture.profile.list()).enabled, false)
})

test('refuses a switch that a home-level patch overrides', async (t) => {
  const homeKeepsDisabled = await createFixture({ homePatch: '- id: dsh-demo-local\n  disabled: true\n' })
  t.after(() => homeKeepsDisabled.cleanup())
  await homeKeepsDisabled.profile.initialize()
  const disabled = pluginByName(await homeKeepsDisabled.profile.list())
  assert.equal(disabled.canEnable, false)
  assert.equal(disabled.externalControl, true)
  await assert.rejects(
    homeKeepsDisabled.profile.setEnabled('dsh-demo-local', true),
    (error) => error instanceof LocalPluginManagerError && error.code === 'externally-disabled'
  )

  const homeForcesEnabled = await createFixture({ homePatch: '- id: dsh-demo-local\n  disabled: false\n' })
  t.after(() => homeForcesEnabled.cleanup())
  await homeForcesEnabled.profile.initialize()
  const enabled = pluginByName(await homeForcesEnabled.profile.list())
  assert.equal(enabled.canDisable, false)
  assert.equal(enabled.enabled, true)
  await assert.rejects(
    homeForcesEnabled.profile.setEnabled('dsh-demo-local', false),
    (error) => error instanceof LocalPluginManagerError && error.code === 'externally-enabled'
  )
})

test('refuses uninstall while a user patch still inserts the package', async (t) => {
  const profilePatch = `${FIGMA_PATCH}- insert:\n    - id: custom-demo\n      name: dsh-demo-local\n`
  const fixture = await createFixture({ profilePatch })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const plugin = pluginByName(await fixture.profile.list())
  assert.equal(plugin.canUninstall, false)
  await assert.rejects(
    fixture.profile.uninstall('dsh-demo-local'),
    (error) => error instanceof LocalPluginManagerError && error.code === 'user-patch-reference'
  )
})

test('uninstalls through the command runner, keeps the row disabled, then prunes it next boot', async (t) => {
  let fixture
  fixture = await createFixture({
    commandRunner: async (_runtime, _profile, name) => {
      const manifestPath = join(fixture.profileDir, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      delete manifest.dependencies[name]
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter((item) => item !== name)
      await writeJson(manifestPath, manifest)
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false }
    }
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  const result = await fixture.profile.uninstall('dsh-demo-local')
  assert.equal(result.ok, true)
  assert.equal(result.restart, true)
  assert.equal(result.snapshot.plugins.length, 0)
  // 当前进程里 bundle 层已冻结，覆盖项必须留到重启。
  assert.equal((await fixture.readPatch()).includes('- id: dsh-demo-local\n  disabled: true'), true)

  const sameProcessReload = new LocalPluginProfile({
    dshHome: fixture.dshHome,
    profileDir: fixture.profileDir,
    runtime: { cliPath: '/unused', version: TEST_DSH_VERSION },
    processMarker: 'process-a'
  })
  await sameProcessReload.initialize()
  assert.equal((await fixture.readPatch()).includes('- id: dsh-demo-local\n  disabled: true'), true)

  const restarted = new LocalPluginProfile({
    dshHome: fixture.dshHome,
    profileDir: fixture.profileDir,
    runtime: { cliPath: '/unused', version: TEST_DSH_VERSION },
    processMarker: 'process-b'
  })
  await restarted.initialize()
  const patch = await fixture.readPatch()
  assert.equal(patch.includes('dsh-demo-local'), false, '陈旧覆盖项必须清掉，否则重装后会被继续禁用')
  assert.equal(patch.includes('mcp-figma-desktop'), true)
})

test('rolls back a failed uninstall when the profile remains installed', async (t) => {
  const fixture = await createFixture({
    commandRunner: async () => ({ exitCode: 1, stdout: '', stderr: 'pnpm remove failed', timedOut: false })
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  await assert.rejects(
    fixture.profile.uninstall('dsh-demo-local'),
    (error) => error instanceof LocalPluginManagerError && error.code === 'uninstall-failed'
  )
  const plugin = pluginByName(await fixture.profile.list())
  assert.equal(plugin.enabled, true)
  assert.equal(await fixture.readPatch(), FIGMA_PATCH)
})

test('rolls back when the uninstall command cannot start', async (t) => {
  const fixture = await createFixture({
    commandRunner: async () => { throw new Error('spawn unavailable') }
  })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  await assert.rejects(
    fixture.profile.uninstall('dsh-demo-local'),
    (error) => error instanceof LocalPluginManagerError && error.code === 'uninstall-failed'
  )
  assert.equal(pluginByName(await fixture.profile.list()).enabled, true)
  assert.equal(await fixture.readPatch(), FIGMA_PATCH)
})

test('force-kills a hung uninstall command after its timeout', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-command-timeout-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const script = join(root, 'hang.js')
  await writeFile(script, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\n")
  const result = await runDshPluginRemove(
    { cliPath: script },
    'web',
    'dsh-demo-local',
    { cwd: root, timeoutMs: 1000, forceKillAfterMs: 50 }
  )
  assert.equal(result.timedOut, true)
  assert.equal(result.signal, 'SIGKILL')
})

test('accepts the compatible DSH release line and rejects adjacent lines', () => {
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.2+build.1'), {
    supported: true,
    verified: true,
    normalized: '0.1.7-alpha.2'
  })
  // 0.1.7-alpha.1 与 alpha.2 都是逐版本验证版本：本插件用到的契约包逐个 diff 过
  // （profile patch 事务与写锁、webServer、requestRejection、settings.section、
  // include 行 id），两版之间逐字相同。同线内其它版本仍允许启动，但只给一条告警，
  // 运行时的结构与能力检查继续 fail closed。
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1'), {
    supported: true,
    verified: true,
    normalized: '0.1.7-alpha.1'
  })
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.3'), {
    supported: true,
    verified: false,
    normalized: '0.1.7-alpha.3'
  })
  assert.equal(classifyDshVersion('0.1.7-beta.1').supported, true)
  assert.equal(classifyDshVersion('0.1.7-rc.1').supported, true)
  assert.equal(classifyDshVersion('0.1.7').supported, true)
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false)
  // 相邻发布线一律拒绝：上一线的用户留在上一线的插件版本上。
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false)
  assert.equal(classifyDshVersion('0.1.6').supported, false)
  assert.equal(classifyDshVersion('0.1.8-alpha.1').supported, false)
  assert.equal(classifyDshVersion('invalid').supported, false)
  assert.equal(DSH_COMPATIBILITY_RANGE, '>=0.1.7-alpha.1 <0.1.8')
})

test('resolves and classifies the running DSH package', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'lib', 'bin.js'), '#!/usr/bin/env node\n')
  await writeJson(join(root, 'package.json'), {
    name: '@deepseek-ai/dsh',
    version: TEST_DSH_VERSION,
    bin: { dsh: 'lib/bin.js' }
  })
  const runtime = await resolveCurrentDshRuntime(join(root, 'lib', 'bin.js'))
  assert.equal(runtime.packageDir, await realpath(root))
  assert.equal(runtime.supported, true)
  assert.equal(runtime.verified, true)
  assert.equal(runtime.compatibilityRange, DSH_COMPATIBILITY_RANGE)
})
