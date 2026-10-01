/**
 * 版本门守卫。
 *
 * 这条契约曾**完全没有实现**：插件在 package.json / install.sh 里声明了范围与逐版本
 * 清单，运行时却从不判定，于是在 DSH 0.2.0-rc.2 上照常注册路由、照常读改写 profile
 * 补丁——而它读的 `configEditor.configuration()` 恰好在 0.2.0 被改过（2026-10-01
 * 核对，实测语义等价，但当时没有任何机制阻止它跑）。
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
  DSH_RELEASE_FLOOR,
  DSH_RELEASE_LINE,
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

/**
 * 13 档版本矩阵，与 8 个已跨线插件的矩阵同形（收口轮统一过一次）：
 * `rc.2` 与带 build 元数据的同一版本接受且 verified、正式版与更高的同线 rc 接受但带
 * 警告，其余一律拒绝——其中 `0.2.0-alpha.9` 是"下界从 alpha 换成 rc 后旧判定会静默
 * 放行"的那一档。
 */
const VERSION_MATRIX = [
  { version: '0.2.0-rc.2', supported: true, verified: true },
  { version: '0.2.0-rc.2+build.1', supported: true, verified: true, normalized: '0.2.0-rc.2' },
  { version: '0.2.0', supported: true, verified: false },
  { version: '0.2.0-rc.3', supported: true, verified: false },
  { version: '0.2.1', supported: false, verified: false },
  { version: '0.1.7-rc.2', supported: false, verified: false },
  { version: '0.2.0-alpha.1', supported: false, verified: false },
  { version: '0.2.0-alpha.9', supported: false, verified: false },
  { version: '0.2.0-beta.4', supported: false, verified: false },
  { version: '0.2.0-rc.1', supported: false, verified: false },
  { version: '0.1.8-alpha.1', supported: false, verified: false },
  { version: undefined, supported: false, verified: false },
  { version: '', supported: false, verified: false }
]

test('classifyDshVersion：13 档矩阵——只看版本号形状，不猜“看起来差不多”的版本', () => {
  assert.equal(VERSION_MATRIX.length, 13, '矩阵必须恰好 13 档')
  for (const row of VERSION_MATRIX) {
    const result = classifyDshVersion(row.version)
    assert.equal(result.supported, row.supported, `${String(row.version)}：supported 判定不符`)
    assert.equal(result.verified, row.verified, `${String(row.version)}：verified 判定不符`)
    if (row.normalized !== undefined) {
      assert.equal(result.normalized, row.normalized, `${String(row.version)}：build 元数据必须被剥掉`)
    }
  }
})

test('判定逻辑从发布线 + 下界派生：range 反推回来必须与常量一致', () => {
  // `>=<line>-<channel>.<seq> <next>`：跨线只改常量，判定逻辑不动。
  const matched = /^>=(\d+\.\d+\.\d+)-([a-z]+)\.(\d+) <(\d+\.\d+\.\d+)$/u.exec(DSH_COMPATIBILITY_RANGE)
  assert.ok(matched !== null, `range 形状不符合发布线约定：${DSH_COMPATIBILITY_RANGE}`)
  assert.equal(matched[1], DSH_RELEASE_LINE, 'range 的下界必须落在 DSH_RELEASE_LINE 这条线上')
  assert.equal(matched[2], DSH_RELEASE_FLOOR.channel, 'range 的下界 channel 必须与 DSH_RELEASE_FLOOR 同源')
  assert.equal(Number(matched[3]), DSH_RELEASE_FLOOR.sequence, 'range 的下界序列号必须与 DSH_RELEASE_FLOOR 同源')
  // 发布线只覆盖一个 patch 系列：上界必须是下一条线（`0.2.0` → `<0.2.1`）。
  const nextPatch = DSH_RELEASE_LINE.replace(/(\d+)$/u, (digits) => String(Number(digits) + 1))
  assert.equal(matched[4], nextPatch, 'range 的上界必须是下一条发布线')
  // 下界必须是 rc：同线内 alpha/beta/更低 rc 都要被 channel 优先级挡住。
  assert.equal(DSH_RELEASE_FLOOR.channel, 'rc', '下界换成 rc 后必须用 channel 优先级比较，不是只比序列号')
  assert.deepEqual(classifyDshVersion(`${DSH_RELEASE_LINE}-${DSH_RELEASE_FLOOR.channel}.${DSH_RELEASE_FLOOR.sequence}`), {
    supported: true,
    verified: true,
    normalized: `${DSH_RELEASE_LINE}-${DSH_RELEASE_FLOOR.channel}.${DSH_RELEASE_FLOOR.sequence}`
  })
})

test('范围外：完全不注册任何东西，并留下 error 日志', async () => {
  const rejected = VERSION_MATRIX.filter((row) => !row.supported).map((row) => row.version)
  assert.equal(rejected.length, 9, '矩阵里应恰好 9 档被拒绝')
  for (const version of rejected) {
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
  // build 元数据不改变结论
  const { ctx, state } = createFakeCtx()
  await applyForVersion(ctx, `${VERIFIED_DSH_VERSIONS[0]}+build.1`)
  assert.deepEqual(state.injected, [['configEditor', 'webServer', 'connection']], '带 build 元数据的同一版本必须装配')
  assert.deepEqual(state.warnings, [], '带 build 元数据的同一版本不得告警')
})

test('范围内未核对版本：继续运行但必须告警（能力探测仍是权威判定）', async () => {
  for (const version of ['0.2.0', '0.2.0-rc.3']) {
    const { ctx, state } = createFakeCtx()
    await applyForVersion(ctx, version)
    assert.deepEqual(state.injected, [['configEditor', 'webServer', 'connection']], `${version}：同线未核对版本必须继续运行`)
    assert.equal(
      state.warnings.some((message) => message.includes('not individually verified')),
      true,
      `${version}：必须留下未核对告警`
    )
  }
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
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2' }))
    await writeFile(join(dir, 'lib', 'bin.js'), '// fixture\n')
    // 探测链路会 realpath 入口，所以期望值也要取 realpath（macOS 上 /var → /private/var）。
    const resolvedDir = await realpath(dir)
    assert.deepEqual(await readDshPackage(join(dir, 'lib', 'bin.js')), { version: '0.2.0-rc.2', root: resolvedDir })

    // 名字不叫 @deepseek-ai/dsh 的包不得被当成 DSH：继续向上找，找不到就抛
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/something-else', version: '9.9.9' }))
    await assert.rejects(() => readDshPackage(join(dir, 'lib', 'bin.js')), /cannot locate @deepseek-ai\/dsh\/package\.json/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('DSH_COMPATIBILITY_RANGE / 清单常量与声明的一致（四处同源的第一处）', () => {
  assert.equal(DSH_COMPATIBILITY_RANGE, '>=0.2.0-rc.2 <0.2.1')
  assert.equal(DSH_RELEASE_LINE, '0.2.0')
  assert.deepEqual(DSH_RELEASE_FLOOR, { channel: 'rc', sequence: 2 })
  assert.deepEqual(VERIFIED_DSH_VERSIONS, ['0.2.0-rc.2'])
})
