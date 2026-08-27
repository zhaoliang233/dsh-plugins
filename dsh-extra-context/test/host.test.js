import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import test from 'node:test'

import {
  CLIENT_HEADER,
  NOTES_TOOL_NAME,
  STATUS_PATH,
  SECTION_NAME,
  SECTION_ORDER,
  SETTINGS_NAMESPACE,
  appendNote,
  buildStatus,
  byteLength,
  applyForEntry,
  applyForVersion,
  classifyDshVersion,
  createRuntime,
  effectiveSegments,
  estimateTokens,
  normalizeSettings,
  readDshPackage,
  renderExtraContext
} from '../lib/index.js'
import { DEFAULT_MAX_BYTES, NOTES_MAX_BYTES, createSegmentId } from '../lib/rules.js'

/**
 * 真实 DSH 安装的 package.json 绝对路径。
 * 从 PATH 里的 dsh 可执行文件解析（与运行时同源），而不是硬编码某台机器的路径。
 */
const REAL_DSH_MANIFEST = (() => {
  try {
    const binary = execFileSync('command', ['-v', 'dsh'], { encoding: 'utf8', shell: '/bin/sh' }).trim()
    return join(dirname(realpathSync(binary)), '..', 'package.json')
  } catch {
    return undefined
  }
})()

test('版本门只放行已核对的 0.1.6 兼容线', () => {
  assert.deepEqual(classifyDshVersion('0.1.6-alpha.1'), { supported: true, verified: true, normalized: '0.1.6-alpha.1' })
  // 当前部署实际运行的版本：必须落在"已逐版本核对"清单里，
  // 否则每次启动都退化成"同线未验证"告警，等于没核对。
  assert.equal(classifyDshVersion('0.1.6-rc.1').supported, true, '同线更早的 rc 可运行')
  assert.equal(classifyDshVersion('0.1.6-rc.1').verified, false, '但不得自称已核对')
  assert.equal(classifyDshVersion('0.1.6-alpha.0').supported, false, '兼容线下界之前必须挡住')
  assert.equal(classifyDshVersion('0.1.6-beta.2').supported, true)
  assert.equal(classifyDshVersion('0.1.6-beta.2').verified, false)
  assert.equal(classifyDshVersion('0.1.6').supported, true)
  assert.equal(classifyDshVersion('0.1.5-alpha.1').supported, false, '上一发布线必须挡住')
  assert.equal(classifyDshVersion('0.1.4').supported, false)
  assert.equal(classifyDshVersion('1.0.0').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)
  assert.equal(classifyDshVersion('0.1.6-alpha.1+local').supported, true)
})
test('从 CLI 入口向上定位 DSH 安装目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-extra-context-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.6-alpha.1' }))
    const nested = join(root, 'lib', 'bin')
    await mkdir(nested, { recursive: true })
    const entry = join(nested, 'bin.js')
    await writeFile(entry, '')
    const located = await readDshPackage(entry)
    assert.equal(located.version, '0.1.6-alpha.1')
    assert.equal(located.root.endsWith(root.replace('/var/', '/private/var/')) || located.root.endsWith(root), true)
    await assert.rejects(() => readDshPackage(''), /cannot locate the DSH CLI entry path/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('normalizeSettings 对脏数据保持形状稳定', () => {
  const normalized = normalizeSettings(undefined)
  assert.equal(normalized.enabled, true)
  assert.equal(normalized.maxBytes, DEFAULT_MAX_BYTES)
  assert.equal(Array.isArray(normalized.segments), true)

  const dirty = normalizeSettings({
    enabled: 'yes',
    maxBytes: -1,
    notes: 42,
    segments: [
      { id: 'a', label: 7, enabled: 0, text: 'hello' },
      null,
      { id: 'a', text: 'duplicate id' }
    ]
  })
  assert.equal(dirty.enabled, true)
  assert.equal(dirty.maxBytes, DEFAULT_MAX_BYTES)
  assert.equal(dirty.notes, '')
  assert.equal(dirty.segments.length, 3)
  assert.equal(dirty.segments[0].enabled, true)
  assert.equal(dirty.segments[0].label, '')
  // order 已随排序功能移除：规范化结果里不应再出现该字段
  assert.equal(Object.hasOwn(dirty.segments[0], 'order'), false)
  assert.equal(dirty.segments[1].id, 'segment-2')
  assert.notEqual(dirty.segments[2].id, 'a')
  assert.equal(new Set(dirty.segments.map((segment) => segment.id)).size, 3)
})
test('effectiveSegments 只保留启用且非空的分段，并保持数组顺序', () => {
  const value = {
    segments: [
      { id: 'c', enabled: true, text: 'third' },
      { id: 'a', enabled: true, text: 'first' },
      { id: 'b', enabled: true, text: '   ' },
      { id: 'd', enabled: false, text: 'disabled' },
      { id: 'e', enabled: true, text: 'last' }
    ]
  }
  // 顺序即数组顺序：即使旧数据残留 order 字段也不再影响结果
  assert.deepEqual(effectiveSegments(value).map((segment) => segment.id), ['c', 'a', 'e'])
})
test('renderExtraContext 渲染分段与笔记，禁用或空内容时不贡献任何文本', () => {
  const rendered = renderExtraContext({
    segments: [
      { id: 'a', label: '长期偏好', enabled: true, order: 10, text: '回答用中文。' },
      { id: 'b', label: '', enabled: true, order: 20, text: '提交信息不要超过 10 行。' }
    ],
    notes: '用户在 macOS 上工作。'
  })
  assert.equal(rendered.includes('回答用中文。'), true)
  assert.equal(rendered.includes('提交信息不要超过 10 行。'), true)
  // 分段名称不得出现在给模型看的文本里
  assert.equal(rendered.includes('【长期偏好】'), false)
  assert.equal(rendered.includes('长期偏好'), false)
  assert.equal(rendered.includes('【模型笔记】'), true)
  assert.equal(rendered.includes('用户在 macOS 上工作。'), true)
  assert.equal(rendered.startsWith('以下内容由用户在'), true)
  assert.equal(rendered.includes('持续有效'), true)
  // 引导语必须简短：结构说明不能比规则本身还长（曾经有 4 行免责声明）。
  const heading = rendered.split('--- 额外上下文开始 ---')[0].trim()
  assert.equal(heading.length <= 60, true, `引导语过长（${String(heading.length)} 字）`)
  assert.equal(rendered.trimEnd().endsWith('--- 额外上下文结束 ---'), true)

  assert.equal(renderExtraContext({ enabled: false, segments: [{ id: 'a', enabled: true, order: 1, text: 'x' }] }), '')
  assert.equal(renderExtraContext({ segments: [] }), '')
  assert.equal(renderExtraContext({ segments: [{ id: 'a', enabled: true, order: 1, text: '   ' }] }), '')
  assert.equal(renderExtraContext(null), '')
})
test('buildStatus 报告分段明细与预算', () => {
  const status = buildStatus({
    segments: [
      { id: 'a', label: 'A', enabled: true, text: 'aaa' },
      { id: 'b', label: 'B', enabled: false, text: 'bbb' }
    ],
    maxBytes: 16
  })
  assert.deepEqual(status.segments.map((segment) => segment.id), ['a', 'b'])
  assert.equal(status.segments[0].effective, true)
  assert.equal(status.segments[1].effective, false)
  assert.equal(status.sectionName, SECTION_NAME)
  assert.equal(status.sectionOrder, SECTION_ORDER)
  assert.equal(status.overBudget, true)
  assert.equal(status.bytes > 16, true)
  assert.equal(status.source, 'segments')

  const empty = buildStatus({ segments: [] })
  assert.equal(empty.source, 'none')
  assert.equal(empty.rendered, '')
  assert.equal(empty.overBudget, false)
})
test('appendNote 合并与限长', () => {
  assert.deepEqual(appendNote({ notes: 'a' }, 'b'), { ok: true, notes: 'a\nb' })
  assert.deepEqual(appendNote({ notes: '' }, ' b '), { ok: true, notes: 'b' })
  assert.equal(appendNote({ notes: 'a' }, '   ').ok, false)
  const full = 'x'.repeat(NOTES_MAX_BYTES)
  const rejected = appendNote({ notes: full }, 'y')
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason.includes(String(NOTES_MAX_BYTES)), true)
  assert.equal(byteLength('中文') === 6, true)
  assert.equal(estimateTokens('中文字符') === 4, true)
})
test('createSegmentId 避免重复且对相同标签稳定', () => {
  assert.equal(createSegmentId('Long Term', []), 'long-term')
  assert.equal(createSegmentId('Long Term', [{ id: 'long-term' }]), 'long-term-2')
  assert.equal(createSegmentId('', []), 'segment')
})

/** 构造一个足以跑通宿主装配的伪 Cordis 上下文。 */
function createFakeCtx() {
  const state = {
    section: null,
    tools: [],
    commands: [],
    effects: [],
    injections: [],
    warnings: [],
    registers: []
  }
  const scope = {
    get: () => state.value,
    watch(callback) {
      state.watcher = callback
      return () => {
        state.watcher = null
      }
    },
    update: async (patch) => {
      state.value = { ...state.value, ...patch }
      state.watcher?.(state.value, state.value)
    }
  }
  const ctx = {
    logger: {
      info: (message) => state.warnings.push(`info:${message}`),
      warn: (message) => state.warnings.push(`warn:${message}`),
      error: (message) => state.warnings.push(`error:${message}`)
    },
    systemPrompt: {
      section(definition) {
        state.section = definition
        return () => {
          state.section = null
        }
      }
    },
    tools: {
      register(definition) {
        state.tools.push(definition)
        return () => {}
      }
    },
    commands: {
      register(definition) {
        state.commands.push(definition)
        return () => {}
      }
    },
    get: () => undefined,
    inject(names, callback) {
      state.injections.push(names)
      if (names.includes('settings')) {
        callback({
          settings: {
            register(ns, schema, options) {
              state.registers.push({ ns, schema, options })
              state.value = options?.base ?? {}
              return scope
            },
            // describe 的 user 层：用于判定"用户是否显式写过字段"
            describe() {
              if (typeof state.describeOverride === 'function') return state.describeOverride()
              // 忠实模拟真实 describe：用户从未写过该段时**不返回 user 键**
              // （曾写成 state.user ?? state.value，把"没写过"伪装成"写过"，
              //  从而掩盖了"组合层 config 被丢弃"的缺陷）。
              return [{ ns: SETTINGS_NAMESPACE, value: state.value, user: state.user }]
            }
          },
          effect: (factory) => {
            state.effects.push(factory())
          }
        })
      }
      if (names.includes('webServer')) {
        callback({
          connection: { requestRejection: () => undefined },
          webServer: {
            register: (route) => {
              state.route = route
              /**
               * 模拟一次请求。默认是同源 + 带客户端头的合法 GET。
               * 返回 { status, body, threw }，测试可自定义 method/url/headers
               * 来逐项验证鉴权与状态码语义。
               */
              state.probeRoute = (options = {}) => {
                const response = {
                  statusCode: 0,
                  headers: null,
                  body: '',
                  writeHead(status, headers) { this.statusCode = status; this.headers = headers },
                  end(text) { this.body = text ?? '' }
                }
                const request = {
                  method: options.method ?? 'GET',
                  url: options.url ?? STATUS_PATH,
                  headers: {
                    host: '127.0.0.1:3080',
                    origin: 'http://127.0.0.1:3080',
                    [CLIENT_HEADER]: '1',
                    ...(options.headers ?? {})
                  }
                }
                if (options.headers?.omitClientHeader === true) delete request.headers[CLIENT_HEADER]
                let body = null
                let threw = null
                try {
                  route.handler(request, response)
                  try { body = JSON.parse(response.body) } catch { body = response.body }
                } catch (error) {
                  threw = String(error && error.message ? error.message : error)
                }
                return { status: response.statusCode, body, threw }
              }
              // 挂载时先跑一次默认请求，供现有断言使用（口径一致性测试）
              const first = state.probeRoute()
              if (first.status === 200) state.routeBody = first.body
              return () => {}
            }
          },
          effect: (factory) => {
            state.effects.push(factory())
          }
        })
      }
    },
    effect: (factory) => {
      state.effects.push(factory())
    }
  }
  return { ctx, state, scope }
}

/** 让 systemPrompt section 的 text 函数解析成字符串。 */
function sectionText(state) {
  assert.notEqual(state.section, null)
  return typeof state.section.text === 'function' ? state.section.text() : state.section.text
}
test('装配注册全局 section 与笔记工具，并跟随设置热更新', async () => {
  const { ctx, state } = createFakeCtx()
  await createRuntime({ ctx, schema: { fake: true }, initial: { segments: [], notes: '' }, log: () => {}, notesFeature: true })

  assert.equal(state.section.name, SECTION_NAME)
  assert.equal(state.section.order, SECTION_ORDER)
  assert.equal(state.injections.some((names) => names.includes('settings')), true)
  assert.equal(state.registers.length, 1)
  assert.equal(state.registers[0].ns, SETTINGS_NAMESPACE)
  assert.equal(state.registers[0].options.applies, 'live')
  assert.equal(sectionText(state), '')

  const tool = state.tools.find((candidate) => candidate.name === NOTES_TOOL_NAME)
  assert.notEqual(tool, undefined)

  // 设置改动必须即时反映到下一次 prompt 组装，无需重新注册 section。
  state.watcher?.({ segments: [{ id: 'a', label: 'L', enabled: true, order: 1, text: 'hello' }] }, {})
  assert.equal(sectionText(state).includes('hello'), true)
  assert.equal(state.section.name, SECTION_NAME)
})
test('笔记工具读写设置', async () => {
  const { ctx, state } = createFakeCtx()
  await createRuntime({ ctx, schema: { fake: true }, initial: { segments: [], notes: '' }, log: () => {}, notesFeature: true })
  const tool = state.tools.find((candidate) => candidate.name === NOTES_TOOL_NAME)

  assert.equal(await tool.execute({ action: 'read' }, {}), '(笔记为空)')
  const appended = await tool.execute({ action: 'append', entry: '记得用中文回答' }, {})
  assert.equal(appended.includes('已追加'), true)
  assert.equal(state.value.notes, '记得用中文回答')
  assert.equal((await tool.execute({ action: 'append', entry: '   ' }, {})).includes('拒绝'), true)
  assert.equal((await tool.execute({ action: 'bogus' }, {})).includes('参数不合法'), true)
  assert.equal((await tool.execute({ action: 'read' }, {})).includes('记得用中文回答'), true)
  assert.equal((await tool.execute({ action: 'clear' }, {})).includes('已清空'), true)
  assert.equal(state.value.notes, '')

})
test('真实入口装配：伪 DSH 根 + 真实 schemastery 走完 apply 全链路', { skip: REAL_DSH_MANIFEST === undefined ? 'PATH 中没有 dsh' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-extra-context-entry-'))
  try {
    // 伪造一个与全局安装同形的 DSH 包根：package.json 用真实结构，
    // node_modules 直接软链真实安装目录，这样 schemastery 及其依赖
    // （cosmokit 等）都能解析，测的是真实 schema 方言而不是手写假对象。
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.6-alpha.1' }))
    const entryDirectory = join(root, 'lib', 'bin')
    await mkdir(entryDirectory, { recursive: true })
    const entry = join(entryDirectory, 'bin.js')
    await writeFile(entry, '')
    const realModules = join(dirname(REAL_DSH_MANIFEST), 'node_modules')
    const fixtureModules = join(root, 'node_modules')
    await mkdir(fixtureModules, { recursive: true })
    await symlink(join(realModules, '@deepseek-ai'), join(fixtureModules, '@deepseek-ai'), 'dir')
    for (const name of await readdir(realModules)) {
      if (name === '@deepseek-ai' || name.startsWith('.')) continue
      await symlink(join(realModules, name), join(fixtureModules, name), 'dir')
    }

    const { applyCompatibleRuntime } = await import('../lib/index.js')
    const { ctx, state } = createFakeCtx()
    const config = { enabled: true, segments: [{ id: 'seed', enabled: true, order: 1, text: '组合层基线' }], notes: '', maxBytes: 1024 }
    await applyCompatibleRuntime(ctx, { ...config, notes: true }, { entryPath: entry })

    assert.equal(state.section.name, SECTION_NAME)
    assert.equal(state.section.order, SECTION_ORDER)
    assert.equal(state.tools.some((tool) => tool.name === NOTES_TOOL_NAME), true)
  
    assert.equal(state.registers.length, 1, 'settings 命名空间应已注册')
    assert.equal(state.registers[0].ns, SETTINGS_NAMESPACE)
    const schema = state.registers[0].schema
    assert.equal(typeof schema.toJSON, 'function', '注册的必须是真正的 schemastery schema')
    assert.equal(typeof schema.toJSON().uid, 'number')

    // 「尚未配置」时保留组合层基线；用户写入后以设置为准。
    assert.equal(sectionText(state).includes('组合层基线'), true)
    state.watcher?.({ segments: [{ id: 'a', enabled: true, order: 1, text: '设置层文本' }], notes: '', maxBytes: 1024, enabled: true }, {})
    assert.equal(sectionText(state).includes('设置层文本'), true)
    assert.equal(sectionText(state).includes('组合层基线'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('删除全部分段后必须保持空，不得回退到组合层默认', async () => {
  // 这是用户实测到的缺陷：界面删掉最后一条规则后，它又自己回来了——
  // 根因是"解析值为空"被误判成"尚未配置"，于是回退到组合层 initial。
  const { ctx, state } = createFakeCtx()
  await createRuntime({
    ctx,
    schema: { fake: true },
    initial: { enabled: true, segments: [{ id: 'seed', enabled: true, order: 10, text: '组合层基线' }], notes: '', maxBytes: 8192 },
    log: () => {}
  })
  // 用户一开始显式写过 segments，所以组合层基线生效
  state.user = { segments: [{ id: 'seed', enabled: true, order: 10, text: '组合层基线' }] }
  state.watcher?.(state.user, {})
  assert.equal(sectionText(state).includes('组合层基线'), true)

  // 用户在设置页把分段全部删除：显式写入空数组，必须真的清空
  state.user = { segments: [] }
  state.value = { segments: [] }
  state.watcher?.(state.value, {})
  assert.equal(sectionText(state), '', '显式删除后不得回退到组合层默认值')

  // 只有"从未写过任何字段"时才使用组合层 initial
  const { ctx: fresh, state: freshState } = createFakeCtx()
  await createRuntime({
    ctx: fresh,
    schema: { fake: true },
    initial: { enabled: true, segments: [{ id: 'seed', enabled: true, order: 10, text: '组合层基线' }], notes: '', maxBytes: 8192 },
    log: () => {}
  })
  freshState.user = {}
  freshState.value = { sequencesNeverWritten: true }
  freshState.watcher?.(freshState.value, {})
  assert.equal(sectionText(freshState).includes('组合层基线'), true, '未配置过时仍应使用组合层基线')
})
test('默认设置不含任何预置分段', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/rules.js')
  assert.deepEqual([...DEFAULT_SETTINGS.segments], [], '新安装不应凭空出现一条删不掉的规则')
})

test('F1 回归：用户从未写过时，组合层 config 必须生效（不得被空默认为覆盖）', async () => {
  // 真实缺陷：explicitUserFields 在 describe 未给 user 键时回退到 scope.get()，
  // 而那是 resolved 值（恒含全部字段）→ 被判"用户写过"→ 组合层 config 被丢弃。
  const { ctx, state } = createFakeCtx()
  await createRuntime({
    ctx,
    schema: { fake: true },
    initial: { enabled: true, segments: [{ id: 'seed', enabled: true, text: '组合层基线' }], notes: '', maxBytes: 8192 },
    log: () => {}
  })
  // 模拟真实 DSH 的行为：用户从未写过 → describe 的行里**没有** user 键
  state.user = undefined
  state.value = { enabled: true, segments: [], notes: '', maxBytes: 8192 }   // resolved 值
  state.watcher?.(state.value, {})
  assert.equal(sectionText(state).includes('组合层基线'), true, '从未配置时组合层 config 必须生效')
})

test('备注功能关闭时，遗留笔记既不注入、也不算进状态接口的数字', async () => {
  // 两处口径必须一致：section 注入与实际 status 响应。
  // 曾出现"注入已剔除 notes、但 /status 仍按读 notes 计算"的矛盾——诊断接口虚高，
  // 而且没有任何测试拦着（宿主备注门零守卫，变异后全绿）。
  const initial = { enabled: true, segments: [{ id: 'seed', enabled: true, text: '组合层基线' }], notes: '遗留的笔记内容', maxBytes: 8192 }
  const resolved = { enabled: true, segments: [], notes: '遗留的笔记内容', maxBytes: 8192 }

  // 前提：用户确实写过字段（只写了 notes），组合层基线必须按字段级合并保留下来
  for (const [label, notesFeature] of [['未开启', undefined], ['显式关闭', false]]) {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {}, notesFeature })
    state.user = { notes: '遗留的笔记内容' }
    state.value = resolved
    state.watcher?.(state.value, {})
    const text = sectionText(state)
    assert.equal(text.includes('组合层基线'), true, `${label}：规则仍须注入`)
    assert.equal(text.includes('遗留的笔记内容'), false, `${label}：关闭时不得注入遗留笔记`)
    assert.equal(state.routeBody?.notes, '', `${label}：状态接口不得报出不会被注入的笔记`)
    assert.equal(state.routeBody?.notesBytes, 0, `${label}：关闭时 notesBytes 必须为 0`)
    assert.equal(state.routeBody?.rendered.includes('遗留的笔记内容'), false, `${label}：状态接口的 rendered 必须与注入口径一致`)
    assert.equal(state.routeBody?.bytes, byteLength(state.routeBody?.rendered ?? ''), `${label}：bytes 必须按实际注入内容计算`)
  }

  // 开启时必须真的注入，且状态接口如实反映
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {}, notesFeature: true })
    state.user = { notes: '遗留的笔记内容' }
    state.value = resolved
    state.watcher?.(state.value, {})
    const text = sectionText(state)
    assert.equal(text.includes('遗留的笔记内容'), true, '开启时必须注入笔记')
    assert.equal(state.routeBody?.notesBytes > 0, true, '开启时 notesBytes 必须反映真实体积')
  }
})

test('回归护栏：describe 调用失败时必须保留组合层，而不是回退到解析值', async () => {
  // 真实缺陷：describe 抛错时 rows 变 undefined，代码会继续走到"describe 不可用"的
  // 兜底分支读 scope.get()——那是 resolved 值（恒含全部字段），于是被判"用户写过"，
  // 组合层 config 被整体丢弃。注释当时写的是"较保守，宁可保留组合层基线"，与实际相反。
  const { ctx, state } = createFakeCtx()
  const initial = { enabled: true, segments: [{ id: 'seed', enabled: true, text: '组合层基线' }], notes: '', maxBytes: 8192 }
  state.describeOverride = () => { throw new Error('describe boom') }
  await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
  state.value = { enabled: true, segments: [], notes: '', maxBytes: 8192 }
  state.watcher?.(state.value, {})
  assert.equal(sectionText(state).includes('组合层基线'), true, 'describe 失败时组合层必须保留')
})

test('回归护栏：用户只改一个字段，组合层 config 的其余字段必须保留', async () => {
  // 真实缺陷：applyResolved 曾经是 `current = next` 整体替换。因为注册时不传 base，
  // resolved 里没有组合层内容，于是用户在设置页只动一个开关，组合层 config 里的
  // 基线规则就整体消失——而文档承诺的是"其余字段回落到组合层值"。
  const initial = { enabled: true, segments: [{ id: 'seed', enabled: true, text: '组合层基线' }], notes: '', maxBytes: 8192 }

  // ① 只写 enabled → 基线规则必须保留
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.user = { enabled: true }
    state.value = { enabled: true, segments: [], notes: '', maxBytes: 8192 }
    state.watcher?.(state.value, {})
    assert.equal(sectionText(state).includes('组合层基线'), true, '只改开关时基线规则必须保留')
  }

  // ② 只写 notes（功能开启）→ 基线规则与笔记同时生效
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {}, notesFeature: true })
    state.user = { notes: '我的笔记' }
    state.value = { enabled: true, segments: [], notes: '我的笔记', maxBytes: 8192 }
    state.watcher?.(state.value, {})
    const text = sectionText(state)
    assert.equal(text.includes('组合层基线'), true, '只写 notes 时基线规则必须保留')
    assert.equal(text.includes('我的笔记'), true, '用户写的 notes 必须生效')
  }

  // ③ 显式写 segments → 以用户为准（用户能覆盖基线，规则删得掉）
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.user = { segments: [{ id: 'mine', enabled: true, text: '用户自己的规则' }] }
    state.value = { enabled: true, segments: [{ id: 'mine', enabled: true, text: '用户自己的规则' }], notes: '', maxBytes: 8192 }
    state.watcher?.(state.value, {})
    const text = sectionText(state)
    assert.equal(text.includes('用户自己的规则'), true, '用户写的规则必须生效')
    assert.equal(text.includes('组合层基线'), false, '显式覆盖 segments 后不得再回落到基线（否则规则删不掉）')
  }

  // ④ 显式写空 segments → 同样以用户为准（删除语义）
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.user = { segments: [] }
    state.value = { enabled: true, segments: [], notes: '', maxBytes: 8192 }
    state.watcher?.(state.value, {})
    assert.equal(sectionText(state).includes('组合层基线'), false, '用户显式清空后基线不得复活')
  }
})

test('describe 的各种形状都必须安全：user 为空/为 null/为数组/不含本命名空间', async () => {
  // 判定"用户是否显式配置过"完全依赖 describe 的返回形状，而它是外部服务给的。
  // 这里逐个形状验证:任何形状都不得抛错，也不得把"没写过"误判成"写过"。
  const initial = { enabled: true, segments: [{ id: 'seed', enabled: true, text: '组合层基线' }], notes: '', maxBytes: 8192 }
  const resolved = { enabled: true, segments: [], notes: '', maxBytes: 8192 }

  // ① 无 user 键 / user 为空对象 / user 为 null / user 是数组 → 都算"没写过"，组合层必须生效
  for (const user of [undefined, {}, null, []]) {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.user = user
    state.value = resolved
    state.watcher?.(state.value, {})
    assert.equal(sectionText(state).includes('组合层基线'), true,
      `user=${JSON.stringify(user)} 时必须保留组合层配置（视为未配置）`)
  }

  // ② user 明确含 segments → 用户写过，以用户值为准（组合层让位）
  {
    const { ctx, state } = createFakeCtx()
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.user = { segments: [] }
    state.value = resolved
    state.watcher?.(state.value, {})
    assert.equal(sectionText(state).includes('组合层基线'), false, '用户写过 segments 时以用户值为准')
  }

  // ③ describe 不含本命名空间 → 等同于"没写过"，不得抛错
  {
    const { ctx, state } = createFakeCtx()
    state.describeOverride = () => [{ ns: 'other-namespace', value: {} }]
    await createRuntime({ ctx, schema: { fake: true }, initial, log: () => {} })
    state.value = resolved
    state.watcher?.(state.value, {})
    assert.equal(sectionText(state).includes('组合层基线'), true, '命名空间不在 describe 结果里时必须保留组合层配置')
  }
})

test('状态路由的鉴权与状态码语义：405/403/200/?debug=1/500', async () => {
  // 这是插件唯一对外暴露的入口，此前它的 handler 从未被调用过（桩直接把 route 丢掉）。
  const { ctx, state } = createFakeCtx()
  await createRuntime({ ctx, schema: { fake: true }, initial: undefined, log: () => {} })

  // 非 GET → 405，并给出 Allow
  const post = state.probeRoute({ method: 'POST' })
  assert.equal(post.status, 405, '非 GET 必须拒绝')
  assert.equal(post.body.ok, false, '拒绝必须是结构化 JSON')

  // 缺少客户端头 → 403
  const noHeader = state.probeRoute({ headers: { omitClientHeader: true } })
  assert.equal(noHeader.status, 403, '缺少客户端标识头必须拒绝')

  // 跨源 → 403（防浏览器页面外的读取）
  const crossOrigin = state.probeRoute({ headers: { origin: 'http://evil.example' } })
  assert.equal(crossOrigin.status, 403, '跨源请求必须拒绝')

  // 合法请求 → 200，且带诊断字段
  const ok = state.probeRoute()
  assert.equal(ok.status, 200, '同源 + 带头的 GET 必须放行')
  assert.equal(ok.body.ok, true)
  assert.equal(typeof ok.body.rendered, 'string', '必须返回实际会注入的文本')
  assert.equal(typeof ok.body.estimatedTokens, 'number', '必须返回 token 估算')
  assert.equal(ok.body.writable, true, 'settings 可用时必须报 writable')

  // ?debug=1 → 带宿主侧命名空间描述（排查用）
  const debug = state.probeRoute({ url: `${STATUS_PATH}?debug=1` })
  assert.equal(debug.status, 200)
  assert.equal(typeof debug.body.debug, 'object', 'debug=1 必须带命名空间描述')
  assert.equal(typeof debug.body.debug.settingsFile, 'string', '必须给出设置文件路径（曾因调用未定义函数而缺失）')
  assert.equal(debug.body.debug.scopePresent, true, '必须报告本命名空间是否已注册')

  // 渲染抛错 → 500：诊断接口不允许把异常抛回给 HTTP 层（会变成未处理异常）
  state.value = {
    enabled: true,
    segments: [{ id: 'bad', enabled: true, text: { toString() { throw new Error('render boom') } } }],
    notes: '',
    maxBytes: 8192
  }
  state.watcher?.(state.value, {})
  const boom = state.probeRoute()
  assert.equal(boom.threw, null, 'handler 不得把异常抛出去')
  assert.equal(boom.status === 200 || boom.status === 500, true, '要么正常降级返回，要么明确报 500')
  if (boom.status === 500) assert.equal(boom.body.ok, false, '500 必须是结构化错误')
})

test('版本门 fail closed：不支持的版本必须完全 inert（不注册任何东西）', async () => {
  // 版本门此前只测了纯函数：不支持时"什么都不注册"这条契约没有任何守卫。
  for (const version of ['0.1.4', '1.0.0', '0.1.7-alpha.1', '0.1.6-alpha.0', undefined, 'nonsense']) {
    const { ctx, state } = createFakeCtx()
    await applyForVersion(ctx, version, {})
    assert.equal(state.section, null, `${String(version)}：不支持时不得注册 section`)
    assert.equal(state.tools.length, 0, `${String(version)}：不支持时不得注册工具`)
    assert.equal(state.registers.length, 0, `${String(version)}：不支持时不得注册设置命名空间`)
    assert.equal(state.route, undefined, `${String(version)}：不支持时不得注册路由`)
    assert.equal(state.warnings.some((w) => w.includes('unsupported DSH')), true, `${String(version)}：必须留下 error 日志`)
  }
})

test('版本门放行时：同线未验证版本继续运行但必须告警', async () => {
  const { ctx, state } = createFakeCtx()
  await applyForVersion(ctx, '0.1.6-rc.1', {})
  assert.notEqual(state.section, null, '同线未验证版本必须继续运行')
  assert.equal(state.warnings.some((w) => w.includes('not individually verified')), true, '必须留下未验证告警')

  const verified = createFakeCtx()
  await applyForVersion(verified.ctx, '0.1.6-alpha.1', {})
  assert.notEqual(verified.state.section, null, '已核对版本必须运行')
  assert.equal(verified.state.warnings.some((w) => w.includes('not individually verified')), false, '已核对版本不得告警')
})

test('入口定位失败时必须 inert，而不是带着未知版本继续跑', async () => {
  const { ctx, state } = createFakeCtx()
  await applyForEntry(ctx, '/nonexistent/entry/point.js')
  assert.equal(state.section, null, '定位失败时不得注册 section')
  assert.equal(state.tools.length, 0, '定位失败时不得注册工具')
  assert.equal(state.warnings.some((w) => w.includes('remains inert')), true, '必须留下 inert 日志')
})

test('卸载可逆：注册的清理函数必须可调用且不抛错', async () => {
  const { ctx, state } = createFakeCtx()
  await applyForVersion(ctx, '0.1.6-alpha.1', {})
  assert.equal(state.effects.length > 0, true, '必须有注册在 effect 上的清理函数')
  // 真实部署里这些清理函数由 Cordis 在停用 fiber 时调用；这里逐个调用，
  // 确认它们不会抛错（抛错会让卸载流程中断，留下残影）。
  for (const effect of state.effects) {
    if (typeof effect === 'function') effect()
  }
  // 幂等：再清一次也不应抛错
  for (const effect of state.effects) {
    if (typeof effect === 'function') effect()
  }
  assert.equal(state.section !== undefined, true, '清理后不得让状态变成脏值')
})

test('F2 回归：用户文本里的 {{…}} 必须原样保留，且 section 必须声明 interpolate: false', async () => {
  // 官方渲染 prompt 时会对 section 文本做 {{variable}} 插值，未知变量直接抛错；
  // 抛错点在插件 try/catch 之外 → 该部署每一次模型请求都失败。
  // 这件事自 DSH 0.1.6 起由官方 `interpolate: false` 承担：本段原样保留用户文本，
  // 不再把 `{{` 拆成 `{`+零宽空格+`{`（模型不该看到零宽字符）。
  const rendered = renderExtraContext({
    segments: [{ id: 'a', enabled: true, text: '请按 {{user_name}} 与 {{ handlebars }} 的风格回答' }],
    notes: ''
  })
  assert.equal(rendered.includes('{{user_name}}'), true, '用户文本必须逐字保留')
  assert.equal(rendered.includes('{{ handlebars }}'), true, '含空格的引用同样逐字保留')
  assert.equal(rendered.includes('\u200b'), false, '渲染结果不得含零宽空格')

  // 终点断言：宿主注册 section 时必须真的声明 interpolate: false。
  // 少了它，用户写 {{name}} 就会让每一次模型请求都失败（很难排查）。
  const { ctx, state } = createFakeCtx()
  await createRuntime({ ctx, schema: { fake: true }, initial: { segments: [], notes: '' }, log: () => {}, notesFeature: true })
  assert.equal(state.section.interpolate, false, 'section 必须声明 interpolate: false')

  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.equal(source.includes('interpolate: false'), true, '源码必须显式声明 interpolate: false')
  const bundle = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(bundle.includes('\\u200b'), false, '客户端预览不得再中和 {{')
})
