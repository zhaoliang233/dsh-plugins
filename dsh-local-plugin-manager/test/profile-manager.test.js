import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DSH_COMPATIBILITY_RANGE,
  MANAGED_BEGIN,
  MANAGED_END,
  MAX_DESCRIPTION_LENGTH,
  LocalPluginManagerError,
  LocalPluginProfile,
  classifyDshVersion,
  resolveCurrentDshRuntime,
  rewriteManagedPatch,
  runDshPluginRemove,
  splitManagedPatch
} from '../lib/profile-manager.js'

const TEST_DSH_VERSION = '0.1.6-alpha.1'
const FIGMA_PATCH = `# Your patch layer\n# >>> Figma Desktop MCP\n- insert:\n    - id: mcp-figma-desktop\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: figma\n# <<< Figma Desktop MCP\n`

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
    async cleanup() { await rm(root, { recursive: true, force: true }) }
  }
}

function pluginByName(snapshot, name = 'dsh-demo-local') {
  return snapshot.plugins.find((plugin) => plugin.name === name)
}

test('rewrites only the manager-owned patch block and preserves user rows', () => {
  const disabled = [{ name: 'dsh-demo-local', rowIds: ['dsh-demo-local'] }]
  const next = rewriteManagedPatch(FIGMA_PATCH, disabled)
  assert.equal(next.includes(FIGMA_PATCH.trim()), true)
  assert.equal(next.includes(MANAGED_BEGIN), true)
  assert.equal(next.includes('- id: "dsh-demo-local"\n  disabled: true'), true)
  assert.equal(splitManagedPatch(next).base, FIGMA_PATCH)

  const enabled = rewriteManagedPatch(next, [])
  assert.equal(enabled, FIGMA_PATCH)
})

test('replaces an empty-sequence placeholder without creating invalid YAML', () => {
  const next = rewriteManagedPatch('# user patch\n[]\n', [
    { name: 'dsh-demo-local', rowIds: ['dsh-demo-local'] }
  ])
  assert.equal(next.includes('\n[]\n'), false)
  assert.equal(next.includes('disabled: true'), true)
  const restored = rewriteManagedPatch(next, [])
  assert.equal(restored.includes('[]'), true)
})

test('refuses a corrupted managed marker pair', () => {
  assert.throws(
    () => rewriteManagedPatch(`${FIGMA_PATCH}${MANAGED_BEGIN}\n- id: broken\n  disabled: true\n`, []),
    (error) => error instanceof LocalPluginManagerError && error.code === 'managed-block-corrupt'
  )
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
  assert.equal(plugin.hasClient, true)
  assert.deepEqual(plugin.rowIds, ['dsh-demo-local'])
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
  assert.equal(await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8'), FIGMA_PATCH)
})

test('refuses to overwrite a concurrently edited profile patch', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  const snapshot = await fixture.profile.snapshot()
  const concurrentText = `${FIGMA_PATCH}# concurrent user edit\n`
  await writeFile(join(fixture.profileDir, 'cordis.patch.yml'), concurrentText)
  await assert.rejects(
    fixture.profile.persistState({
      version: 1,
      disabled: ['dsh-demo-local'],
      pendingRemovals: []
    }, snapshot),
    (error) => error instanceof LocalPluginManagerError && error.code === 'concurrent-profile-change'
  )
  assert.equal(await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8'), concurrentText)
})

test('disables and enables through durable state without changing user patch content', async (t) => {
  const fixture = await createFixture()
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()

  let result = await fixture.profile.setEnabled('dsh-demo-local', false)
  assert.equal(result.enabled, false)
  assert.equal(result.refresh, true)
  assert.equal(pluginByName(result.snapshot).enabled, false)
  let patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(splitManagedPatch(patch).base, FIGMA_PATCH)
  assert.equal(patch.includes(MANAGED_BEGIN), true)
  assert.deepEqual(fixture.liveCalls.at(-1), { name: 'dsh-demo-local', disabled: true })

  result = await fixture.profile.setEnabled('dsh-demo-local', true)
  assert.equal(result.enabled, true)
  assert.equal(pluginByName(result.snapshot).enabled, true)
  patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes('mcp-figma-desktop'), true)
  assert.equal(patch.includes(MANAGED_BEGIN), false)
  assert.deepEqual(fixture.liveCalls.at(-1), { name: 'dsh-demo-local', disabled: false })
})

test('does not override an external patch that keeps a plugin disabled', async (t) => {
  const profilePatch = `${FIGMA_PATCH}- id: dsh-demo-local\n  disabled: true\n`
  const fixture = await createFixture({ profilePatch })
  t.after(() => fixture.cleanup())
  await fixture.profile.initialize()
  const plugin = pluginByName(await fixture.profile.list())
  assert.equal(plugin.enabled, false)
  assert.equal(plugin.canEnable, false)
  await assert.rejects(
    fixture.profile.setEnabled('dsh-demo-local', true),
    (error) => error instanceof LocalPluginManagerError && error.code === 'externally-disabled'
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

test('uninstalls through the command runner and cleans its tombstone next boot', async (t) => {
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
  let patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes(MANAGED_BEGIN), true)

  const sameProcessReload = new LocalPluginProfile({
    dshHome: fixture.dshHome,
    profileDir: fixture.profileDir,
    runtime: { cliPath: '/unused', version: TEST_DSH_VERSION },
    processMarker: 'process-a'
  })
  await sameProcessReload.initialize()
  patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes(MANAGED_BEGIN), true)

  const restarted = new LocalPluginProfile({
    dshHome: fixture.dshHome,
    profileDir: fixture.profileDir,
    runtime: { cliPath: '/unused', version: TEST_DSH_VERSION },
    processMarker: 'process-b'
  })
  await restarted.initialize()
  patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes(MANAGED_BEGIN), false)
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
  const patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes(MANAGED_BEGIN), false)
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
  const patch = await readFile(join(fixture.profileDir, 'cordis.patch.yml'), 'utf8')
  assert.equal(patch.includes(MANAGED_BEGIN), false)
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
  assert.deepEqual(classifyDshVersion('0.1.6-alpha.1+build.1'), {
    supported: true,
    verified: true,
    normalized: '0.1.6-alpha.1'
  })
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, true)
  assert.equal(classifyDshVersion('0.1.6-beta.1').supported, true)
  assert.equal(classifyDshVersion('0.1.6-rc.1').supported, true)
  assert.equal(classifyDshVersion('0.1.6').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.0').supported, false)
  assert.equal(classifyDshVersion('0.1.4').supported, false)
  assert.equal(classifyDshVersion('0.1.5-alpha.1').supported, false)
  assert.equal(classifyDshVersion('invalid').supported, false)
  assert.equal(DSH_COMPATIBILITY_RANGE, '>=0.1.6-alpha.1 <0.1.7')
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
