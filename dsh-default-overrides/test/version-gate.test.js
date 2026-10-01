/**
 * 版本门守卫。
 *
 * 这条契约此前**完全没有实现**：插件在 package.json / install.sh 里声明了
 * `>=0.1.7-alpha.1 <0.1.8` 与逐版本清单，运行时却从不判定，于是在 DSH 0.2.0-rc.2 上
 * 照常注册路由、照常读改写 profile 补丁——而它读的 `configEditor.configuration()`
 * 恰好在 0.2.0 被改过（2026-10-01 核对，实测语义等价，但当时没有任何机制阻止它跑）。
 *
 * 范围外必须 inert 的理由不是保守习惯：本插件整块改写 profile 补丁里的 `config`，
 * 写错会让目标条目因 required 校验失败而加载失败（fiber.state = 3），
 * 那时 configEditor 拒绝服务，只能手改文件救回来。
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  DSH_COMPATIBILITY_RANGE,
  VERIFIED_DSH_VERSIONS,
  applyForEntry,
  applyForVersion,
  classifyDshVersion,
  readDshPackage
} from '../lib/index.js'

function createFakeCtx() {
  const state = { injected: [], errors: [], warnings: [] }
  const ctx = {
    inject(services, register) {
      state.injected.push(services)
      return register
    },
    logger: {
      error: (message) => state.errors.push(message),
      warn: (message) => state.warnings.push(message)
    }
  }
  return { ctx, state }
}

test('classifyDshVersion：只看版本号形状，不猜“看起来差不多”的版本', () => {
  assert.deepEqual(classifyDshVersion('0.1.7-rc.2'), { supported: true, verified: true, normalized: '0.1.7-rc.2' })
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1'), { supported: true, verified: false, normalized: '0.1.7-alpha.1' })

  assert.equal(classifyDshVersion('0.1.7').supported, true, '正式版与 prerelease 同线')
  assert.equal(classifyDshVersion('0.1.7').verified, false, '没核对过就不得自称已核对')
  assert.equal(classifyDshVersion('0.1.7-beta.3').supported, true)
  assert.equal(classifyDshVersion('0.1.7-rc.2+build.7').verified, true, 'build 元数据不影响判定')

  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false, '兼容线下界之前必须挡住')
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, '上一发布线必须挡住')
  assert.equal(classifyDshVersion('0.1.4').supported, false)
  assert.equal(classifyDshVersion('0.2.0-rc.2').supported, false, '下一发布线必须挡住——本轮就是踩在这里')
  assert.equal(classifyDshVersion('1.0.0').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)
  assert.equal(classifyDshVersion('nonsense').supported, false)
})

test('范围外：完全不注册任何东西，并留下 error 日志', async () => {
  for (const version of ['0.2.0-rc.2', '1.0.0', '0.1.6-alpha.2', '0.1.7-alpha.0', undefined, 'nonsense']) {
    const { ctx, state } = createFakeCtx()
    await applyForVersion(ctx, version)
    assert.deepEqual(state.injected, [], `${String(version)}：不支持时不得 ctx.inject（不得注册路由）`)
    assert.equal(
      state.errors.some((message) => message.includes('unsupported DSH')),
      true,
      `${String(version)}：必须留下 unsupported 的 error 日志`
    )
  }
})

test('范围内已核对版本：装配且不告警', async () => {
  for (const version of VERIFIED_DSH_VERSIONS) {
    const { ctx, state } = createFakeCtx()
    await applyForVersion(ctx, version)
    assert.deepEqual(state.injected, [['configEditor', 'webServer', 'connection']], `${version}：必须按原样装配`)
    assert.deepEqual(state.warnings, [], `${version}：已核对版本不得告警`)
  }
})

test('范围内未核对版本：继续运行但必须告警（能力探测仍是权威判定）', async () => {
  const { ctx, state } = createFakeCtx()
  await applyForVersion(ctx, '0.1.7-rc.1')
  assert.deepEqual(state.injected, [['configEditor', 'webServer', 'connection']], '同线未核对版本必须继续运行')
  assert.equal(
    state.warnings.some((message) => message.includes('not individually verified')),
    true,
    '必须留下未核对告警'
  )
})

test('入口定位失败时必须 inert，而不是带着未知版本继续跑', async () => {
  for (const entryPath of ['/nonexistent/entry/point.js', '', undefined]) {
    const { ctx, state } = createFakeCtx()
    await applyForEntry(ctx, entryPath)
    assert.deepEqual(state.injected, [], `${String(entryPath)}：定位失败时不得注册任何东西`)
    assert.equal(
      state.errors.some((message) => message.includes('remains inert')),
      true,
      `${String(entryPath)}：必须留下 inert 日志`
    )
  }
})

test('readDshPackage：从 CLI 入口向上 4 层内命中包根，找不到就抛错', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-default-overrides-gate-'))
  try {
    await mkdir(join(dir, 'lib'), { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-rc.2' }))
    await writeFile(join(dir, 'lib', 'bin.js'), '// fixture\n')
    // 探测链路会 realpath 入口，所以期望值也要取 realpath（macOS 上 /var → /private/var）。
    const resolvedDir = await realpath(dir)
    assert.deepEqual(await readDshPackage(join(dir, 'lib', 'bin.js')), { version: '0.1.7-rc.2', root: resolvedDir })

    // 名字不叫 @deepseek-ai/dsh 的包不得被当成 DSH：继续向上找，找不到就抛
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/something-else', version: '9.9.9' }))
    await assert.rejects(() => readDshPackage(join(dir, 'lib', 'bin.js')), /cannot locate @deepseek-ai\/dsh\/package\.json/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('DSH_COMPATIBILITY_RANGE 与声明的一致（四处同源的第一处）', () => {
  assert.equal(DSH_COMPATIBILITY_RANGE, '>=0.1.7-alpha.1 <0.1.8')
  assert.deepEqual(VERIFIED_DSH_VERSIONS, ['0.1.7-rc.2'])
})
