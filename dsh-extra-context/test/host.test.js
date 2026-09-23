import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import test from 'node:test'

import {
  CLIENT_HEADER,
  STATUS_PATH,
  SECTION_NAME,
  SECTION_ORDER,
  SETTINGS_NAMESPACE,
  buildStatus,
  applyForEntry,
  applyForVersion,
  classifyDshVersion,
  createRuntime,
  effectiveSegments,
  normalizeSettings,
  readDshPackage,
  renderExtraContext
} from '../lib/index.js'
import { DEFAULT_MAX_BYTES, byteLength, createSegmentId, estimateTokens, renderCompactionNote } from '../lib/rules.js'

/**
 * 真实 DSH 安装的 package.json 绝对路径。
 * 从 PATH 里的 dsh 可执行文件解析（与运行时同源），而不是硬编码某台机器的路径。
 *
 * **必须跨平台**：原先只跑 POSIX 的 `command -v dsh`，Windows 上拿不到值 → 依赖它的
 * 「真实 schemastery 全链路」用例被整体 skip，于是 Windows 专属的装载缺陷
 * （`import(绝对路径)` → `ERR_UNSUPPORTED_ESM_URL_SCHEME`）一路溜到用户机器上，
 * 表现为设置页动作按钮永久禁用。这条探测本身也要有 Windows 分支，否则护栏形同虚设。
 */
const REAL_DSH_MANIFEST = (() => {
  const binaries = []
  const push = (value) => {
    const path = String(value ?? '').trim()
    if (path !== '') binaries.push(path)
  }
  try {
    push(realpathSync(execFileSync('command', ['-v', 'dsh'], { encoding: 'utf8', shell: '/bin/sh' }).trim()))
  } catch {
    // 没有 POSIX shell：继续尝试 Windows 的 where
  }
  try {
    for (const line of execFileSync('where', ['dsh'], { encoding: 'utf8' }).split(/\r?\n/u)) push(line)
  } catch {
    // 没有 where：保持 undefined（用例自行 skip）
  }

  const isDshManifest = (path) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8')).name === '@deepseek-ai/dsh'
    } catch {
      return false
    }
  }

  for (const binary of binaries) {
    // POSIX 全局安装：入口是 <包根>/lib/bin.js，向上两级即包根
    const sibling = join(dirname(binary), '..', 'package.json')
    if (isDshManifest(sibling)) return sibling
    // Windows（nvm-windows 等）：可执行文件是 <前缀>/dsh.ps1，包在其 node_modules 下
    let directory = dirname(binary)
    for (let depth = 0; depth < 6; depth += 1) {
      const manifest = join(directory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
      if (isDshManifest(manifest)) return manifest
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }
  return undefined
})()

/**
 * 极简 schemastery 替身源码（写进假 DSH 根的 node_modules）。
 * `createSettingsSchema` 只用到 object/array/string/boolean/number + default，
 * 所以链式构造器全部返回自身即可；`toJSON` 用来断言注册的确实是 schema 对象。
 */
const STUB_SCHEMASTERY_SOURCE = [
  'function make() {',
  '  const schema = (value) => value',
  '  schema.default = () => make()',
  '  schema.object = () => make()',
  '  schema.array = () => make()',
  '  schema.string = () => make()',
  '  schema.boolean = () => make()',
  '  schema.number = () => make()',
  '  schema.toJSON = () => ({ uid: 1 })',
  '  return schema',
  '}',
  'module.exports = make()',
  ''
].join('\n')

test('版本门只放行已核对的 0.1.7 兼容线', () => {
  assert.deepEqual(classifyDshVersion('0.1.7-alpha.1'), { supported: true, verified: true, normalized: '0.1.7-alpha.1' })
  // 当前部署实际运行的版本：必须落在"已逐版本核对"清单里，
  // 否则每次启动都退化成"同线未验证"告警，等于没核对。
  assert.equal(classifyDshVersion('0.1.7-alpha.2').supported, true, '同线 alpha 可运行')
  assert.equal(classifyDshVersion('0.1.7-alpha.2').verified, false, '但不得自称已核对')
  assert.equal(classifyDshVersion('0.1.7-alpha.0').supported, false, '兼容线下界之前必须挡住')
  assert.equal(classifyDshVersion('0.1.7-beta.2').supported, true)
  assert.equal(classifyDshVersion('0.1.7-beta.2').verified, false)
  assert.equal(classifyDshVersion('0.1.7').supported, true)
  assert.equal(classifyDshVersion('0.1.6-alpha.2').supported, false, '上一发布线必须挡住')
  assert.equal(classifyDshVersion('0.1.4').supported, false)
  assert.equal(classifyDshVersion('1.0.0').supported, false)
  assert.equal(classifyDshVersion(undefined).supported, false)
  assert.equal(classifyDshVersion('0.1.7-alpha.1+local').supported, true)
})
test('从 CLI 入口向上定位 DSH 安装目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-extra-context-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.1' }))
    const nested = join(root, 'lib', 'bin')
    await mkdir(nested, { recursive: true })
    const entry = join(nested, 'bin.js')
    await writeFile(entry, '')
    const located = await readDshPackage(entry)
    assert.equal(located.version, '0.1.7-alpha.1')
    // 比较 realpath 之后的真实根，而不是 tmpdir() 的原始字符串：
    // Windows 的 tmpdir 可能是 8.3 短路径（C:\Users\ADMINI~1\…），而实现在定位入口时
    // 做了 realpath（展开成长路径），直接 endsWith 会假失败；macOS 的 /private/var 同理。
    const expectedRoot = dirname(await realpath(join(root, 'package.json')))
    assert.equal(located.root.toLowerCase(), expectedRoot.toLowerCase())
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
    segments: [
      { id: 'a', label: 7, enabled: 0, text: 'hello' },
      null,
      { id: 'a', text: 'duplicate id' }
    ]
  })
  assert.equal(dirty.enabled, true)
  assert.equal(dirty.maxBytes, DEFAULT_MAX_BYTES)
  assert.equal(dirty.segments.length, 3)
  assert.equal(dirty.segments[0].enabled, true)
  // label 已随界面改版移除：规范化结果里不得再出现该字段（脏数据里的 7 也不能留下）
  assert.equal(Object.hasOwn(dirty.segments[0], 'label'), false, '规范化必须丢弃已移除的 label 字段')
  // order 已随排序功能移除：规范化结果里不应再出现该字段
  assert.equal(Object.hasOwn(dirty.segments[0], 'order'), false)
  assert.deepEqual(Object.keys(dirty.segments[0]).sort(), ['enabled', 'id', 'text'], '分段只有 id/enabled/text 三个字段')
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
test('renderExtraContext 渲染分段，禁用或空内容时不贡献任何文本', () => {
  const rendered = renderExtraContext({
    segments: [
      { id: 'a', label: '长期偏好', enabled: true, order: 10, text: '回答用中文。' },
      { id: 'b', label: '', enabled: true, order: 20, text: '提交信息不要超过 10 行。' }
    ]
  })
  assert.equal(rendered.includes('回答用中文。'), true)
  assert.equal(rendered.includes('提交信息不要超过 10 行。'), true)
  // label 字段已移除：即便老数据里还留着分段名称，也绝不能出现在给模型看的文本里
  assert.equal(rendered.includes('【长期偏好】'), false)
  assert.equal(rendered.includes('长期偏好'), false)
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
  // label 已移除：状态接口也不能再把老数据里的 label 透出去
  assert.equal(status.segments.every((segment) => Object.hasOwn(segment, 'label') === false), true, '状态里的分段不再含 label 字段')
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
test('字节数与 token 估算', () => {
  assert.equal(byteLength('中文') === 6, true)
  assert.equal(estimateTokens('中文字符') === 4, true)
})
test('createSegmentId 只在没有冲突时给出 segment，其余依次退让', () => {
  // 分段没有名称之后，id 不再从文本派生：固定基名 + 冲突后缀（界面与宿主两侧同款）
  assert.equal(createSegmentId([]), 'segment')
  assert.equal(createSegmentId(['segment']), 'segment-2')
  assert.equal(createSegmentId(['segment', 'segment-2']), 'segment-3')
  assert.equal(createSegmentId(new Set(['segment', 'segment-2', 'segment-3'])), 'segment-4')
  assert.equal(createSegmentId(['anything-else']), 'segment', '与已有 id 无关时仍用基名')
})

/**
 * 构造一个足以跑通宿主装配的伪 Cordis 上下文（0.1.7 的设置模型）。
 *
 * 关键形状：apply 收到的 `config` 里，volatile 字段是 `{ get() }`（cosmokit 的引用）。
 * loader 只改 volatile 字段时会**就地**更新这些引用而不重启插件，所以测试用
 * `state.setConfig(patch)` 模拟一次设置写入，然后直接读 section 文本即可。
 * 用户显式写过的字段来自 `settings.describe()` 的 `user` 层（profile 条目 override），
 * 旧 `settings.yaml.imported` 的迁移段由 `legacy` 注入。
 */
function createFakeCtx(options = {}) {
  const values = {
    enabled: true,
    segments: [],
    maxBytes: DEFAULT_MAX_BYTES,
    ...(options.config ?? {})
  }
  const config = {}
  for (const key of Object.keys(values)) {
    config[key] = { get: () => values[key] }
  }
  const state = {
    section: null,
    tools: [],
    commands: [],
    effects: [],
    injections: [],
    warnings: [],
    presentations: [],
    describeRows: options.describeRows ?? [],
    legacy: options.legacy ?? { path: join(tmpdir(), 'settings.yaml.imported'), present: false },
    config,
    setConfig(patch) {
      Object.assign(values, patch)
    }
  }
  const ctx = {
    logger: {
      info: (message) => state.warnings.push(`info:${message}`),
      warn: (message) => state.warnings.push(`warn:${message}`),
      error: (message) => state.warnings.push(`error:${message}`)
    },
    fiber: { id: 'dsh-extra-context' },
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
      if (names.includes('llm')) {
        callback({
          on(event, listener) {
            if (event === 'llm/stream') state.llmStreamListener = listener
            return () => {
              state.llmStreamListener = null
            }
          }
        })
      }
      if (names.includes('settings')) {
        callback({
          settings: {
            // 0.1.7：设置页的自动生成由实例级展示策略控制，不再有 register()。
            configure(presentation) {
              state.presentations.push(presentation)
              return () => {
                state.presentations = state.presentations.filter((item) => item !== presentation)
              }
            },
            // describe() 的 user 层 = 用户在 profile 条目里显式写过的字段。
            // 忠实模拟真实行为：用户从未写过时该键不存在（而不是空对象）。
            describe() {
              if (typeof state.describeOverride === 'function') return state.describeOverride()
              return state.describeRows
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
  return { ctx, state, config }
}

/**
 * 在隔离的 DSH_HOME 里跑一段逻辑。
 *
 * 运行时会在 `$DSH_HOME/settings.yaml.imported` 里找旧 `extra-context:` 段（迁移读取），
 * 而测试不能受开发机上真实旧设置文件的影响——夹具必须自带一个空 home。
 */
async function withIsolatedHome(run) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-extra-context-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
}

/** 跑一次装配：把伪 ctx + volatile config + 迁移段交给插件运行时。 */
async function mountRuntime({ ctx, config, state }, options = {}) {
  return createRuntime({
    ctx,
    config,
    legacy: options.legacy ?? state.legacy,
    log: options.log ?? ((level, message) => state.warnings.push(`${level}:${message}`))
  })
}

/**
 * 让 `describe()` 报告"用户在设置页写过这些字段"。
 * `user` 里出现的字段才会盖过迁移段与解析值。
 */
function setUserFields(state, user) {
  state.describeRows = [{ ns: 'dsh-extra-context', value: {}, user }]
}


/** 让 systemPrompt section 的 text 函数解析成字符串。 */
function sectionText(state) {
  assert.notEqual(state.section, null)
  return typeof state.section.text === 'function' ? state.section.text() : state.section.text
}

/**
 * 走一遍插件注册的 `llm/stream` 监听器，返回 { options, downstream, returned }。
 *
 * `downstream` 是终段（真实宿主里是 `adapterStream`）看到的那份 options；
 * 插件是就地改 `options.messages` 生效的，所以断言必须看这个引用，
 * 而不是监听器自己的入参副本。
 */
function runLlmStream(state, options) {
  assert.equal(typeof state.llmStreamListener, 'function', '插件必须注册 llm/stream 监听器')
  let downstream = null
  const returned = state.llmStreamListener(options, () => {
    downstream = options
    return 'downstream-stream'
  })
  return { downstream, returned }
}

/** 与真实摘要请求同形的最小 options（最后一条 user 消息就是 DSH 的英文摘要指令）。 */
function compactionOptions(extra = {}) {
  return {
    provider: 'louhu',
    model: 'deepseek-flash',
    purpose: 'compaction',
    sessionId: 'session-1',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'prompt' }] },
      { role: 'user', content: [{ type: 'text', text: 'Write concise English engineering prose.' }] }
    ],
    ...extra
  }
}
test('装配注册全局 section，并跟随 volatile 配置热更新', async () => {
  const harness = createFakeCtx()
  const { ctx, state } = harness
  await mountRuntime(harness)

  assert.equal(state.section.name, SECTION_NAME)
  assert.equal(state.section.order, SECTION_ORDER)
  assert.equal(state.injections.some((names) => names.includes('settings')), true)
  // 0.1.7：条目 schema 就是模块导出的 Config；settings 只用来声明"不走自动生成页"。
  assert.deepEqual(state.presentations, [{ auto: false }])
  assert.equal(sectionText(state), '')

  // 设置改动必须即时反映到下一次 prompt 组装，无需重新注册 section。
  setUserFields(state, { segments: [{ id: 'a', enabled: true, text: 'hello' }] })
  state.setConfig({ segments: [{ id: 'a', enabled: true, text: 'hello' }] })
  assert.equal(sectionText(state).includes('hello'), true)
  assert.equal(state.section.name, SECTION_NAME)
})
test('真实入口装配：伪 DSH 根 + 真实 schemastery 走完 apply 全链路', { skip: REAL_DSH_MANIFEST === undefined ? 'PATH 中没有 dsh' : false }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-extra-context-entry-'))
  try {
    // 伪造一个与全局安装同形的 DSH 包根：package.json 用真实结构，
    // node_modules 直接软链真实安装目录，这样 schemastery 及其依赖
    // （cosmokit 等）都能解析，测的是真实 schema 方言而不是手写假对象。
    // Windows 下目录符号链接需要开发者模式/管理员（EPERM），junction 不需要任何特权。
    const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir'
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.1' }))
    const entryDirectory = join(root, 'lib', 'bin')
    await mkdir(entryDirectory, { recursive: true })
    const entry = join(entryDirectory, 'bin.js')
    await writeFile(entry, '')
    const realModules = join(dirname(REAL_DSH_MANIFEST), 'node_modules')
    const fixtureModules = join(root, 'node_modules')
    await mkdir(fixtureModules, { recursive: true })
    await symlink(join(realModules, '@deepseek-ai'), join(fixtureModules, '@deepseek-ai'), LINK_TYPE)
    for (const name of await readdir(realModules)) {
      if (name === '@deepseek-ai' || name.startsWith('.')) continue
      await symlink(join(realModules, name), join(fixtureModules, name), LINK_TYPE)
    }

    const { applyCompatibleRuntime } = await import('../lib/index.js')
    const harness = createFakeCtx({ config: { segments: [{ id: 'seed', enabled: true, text: '设置层文本' }] } })
    const { ctx, state, config } = harness
    await withIsolatedHome(() => applyCompatibleRuntime(ctx, config, { entryPath: entry }))

    assert.equal(state.section.name, SECTION_NAME)
    assert.equal(state.section.order, SECTION_ORDER)
    assert.deepEqual(state.presentations, [{ auto: false }], 'settings 服务可用时必须声明不走自动生成页')

    // 模块导出的 Config 必须是真的 schemastery schema（loader 用它做条目校验与表单投影）。
    const { Config } = await import('../lib/index.js')
    assert.equal(typeof Config?.toJSON, 'function', '导出的必须是真正的 schemastery schema')
    assert.equal(typeof Config.toJSON().uid, 'number')
    // 分段形状只声明 id/enabled/text：label 已从设置 schema 移除
    // （schemastery 对未知键是"原样保留"，所以老数据里的 label 不会让校验失败，只是不再被声明）
    assert.equal(JSON.stringify(Config.toJSON()).includes('"label"'), false, '条目 schema 不得再声明 label 字段')
    // 三个字段都必须是 volatile：否则改设置会重启插件（等于每次改设置都重装一次）。
    for (const key of ['enabled', 'segments', 'maxBytes']) {
      assert.equal(Config.dict[key].meta.volatile, true, `${key} 必须声明 volatile`)
    }

    // 用户在设置页写入即落进 profile 条目配置（describe 的 user 层 + 解析值同步变化）。
    assert.equal(sectionText(state).includes('设置层文本'), true)
    setUserFields(state, { segments: [{ id: 'a', enabled: true, text: '改后的文本' }] })
    state.setConfig({ segments: [{ id: 'a', enabled: true, text: '改后的文本' }] })
    assert.equal(sectionText(state).includes('改后的文本'), true)
    assert.equal(sectionText(state).includes('设置层文本'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
/**
 * Windows 装载路径回归护栏。
 *
 * 真实缺陷：装载器曾把 `require.resolve` 的返回值（文件系统路径）直接交给
 * `import()`。Windows 上 `C:` 会被当成 URL 协议，抛 `ERR_UNSUPPORTED_ESM_URL_SCHEME`，
 * 异常被捕获后 schema 变 null → 条目在 `settings.describe()` 里不出现 →
 * 设置页读写被禁用（用户实测反馈）。修法是 `pathToFileURL`。
 *
 * 这里用一个只含桩 schemastery 的假 DSH 根直接调装载器：装载失败本用例即红
 * （Windows 上改回 `import(resolved)` 会立刻失败）。
 */
test('装载 DSH 内的包必须经 file URL：绝对路径直接 import 在 Windows 上会失败', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-extra-context-import-'))
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.1' }))
    const stubRoot = join(root, 'node_modules', '@deepseek-ai', 'schemastery')
    await mkdir(join(stubRoot, 'lib'), { recursive: true })
    await writeFile(join(stubRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', version: '0.0.0-stub', main: 'lib/index.cjs' }))
    await writeFile(join(stubRoot, 'lib', 'index.cjs'), STUB_SCHEMASTERY_SOURCE)

    const { loadDshModule } = await import('../lib/index.js')
    const z = await loadDshModule(root, '@deepseek-ai/schemastery')
    assert.equal(typeof z.toJSON, 'function', '假 DSH 根里的桩 schemastery 必须装载成功')
    await assert.rejects(() => loadDshModule(root, '@deepseek-ai/does-not-exist'), /Cannot find|MODULE_NOT_FOUND/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('删除全部分段后必须保持空，不得回退到迁移段或默认', async () => {
  // 这是用户实测到的缺陷：界面删掉最后一条规则后，它又自己回来了——
  // 根因是"解析值为空"被误判成"尚未配置"，于是回退到基线值。
  const legacy = {
    path: join(tmpdir(), 'settings.yaml.imported'),
    present: true,
    section: { segments: [{ id: 'seed', enabled: true, text: '迁移段基线' }] }
  }
  const harness = createFakeCtx({ legacy })
  const { state } = harness
  await mountRuntime(harness)
  // 还没在设置页写过：迁移段生效
  assert.equal(sectionText(state).includes('迁移段基线'), true)

  // 用户在设置页把分段全部删除：显式写入空数组，必须真的清空
  setUserFields(state, { segments: [] })
  state.setConfig({ segments: [] })
  assert.equal(sectionText(state), '', '显式删除后不得回退到迁移段或默认值')

  // 只有"从未写过该字段"时才使用迁移段
  const fresh = createFakeCtx({ legacy })
  await mountRuntime(fresh)
  assert.equal(sectionText(fresh.state).includes('迁移段基线'), true, '未配置过时仍应使用迁移段')
})

test('默认设置不含任何预置分段', async () => {
  const { DEFAULT_SETTINGS } = await import('../lib/rules.js')
  assert.deepEqual([...DEFAULT_SETTINGS.segments], [], '新安装不应凭空出现一条删不掉的规则')
})

test('F1 回归：用户从未写过时，旧 settings.yaml 迁移段必须生效（不得被空默认为覆盖）', async () => {
  // 真实缺陷：判定"用户写过什么"时误用解析值（恒含全部字段）→ 被判"用户写过"→
  // 迁移段/基线被空默认覆盖。现在判据只有 describe().user 的键。
  const legacy = {
    path: join(tmpdir(), 'settings.yaml.imported'),
    present: true,
    section: { segments: [{ id: 'seed', enabled: true, text: '迁移段基线' }], enabled: true }
  }
  const harness = createFakeCtx({ legacy })
  const { state } = harness
  await mountRuntime(harness)
  // 模拟真实 DSH 的行为：用户从未写过 → describe 的行里**没有** user 键
  state.describeRows = [{ ns: 'dsh-extra-context', value: { enabled: true, segments: [], maxBytes: 8192 } }]
  assert.equal(sectionText(state).includes('迁移段基线'), true, '从未配置时迁移段必须生效')
})

test('回归护栏：describe 调用失败时必须保留迁移段，而不是回退到解析值', async () => {
  // 真实缺陷：describe 抛错时 rows 变 undefined，代码继续走到"describe 不可用"的
  // 兜底分支读解析值——那是 resolved 值（恒含全部字段），于是被判"用户写过"，
  // 迁移段被整体丢弃。
  const legacy = {
    path: join(tmpdir(), 'settings.yaml.imported'),
    present: true,
    section: { segments: [{ id: 'seed', enabled: true, text: '迁移段基线' }] }
  }
  const harness = createFakeCtx({ legacy })
  const { state } = harness
  state.describeOverride = () => { throw new Error('describe boom') }
  await mountRuntime(harness)
  state.setConfig({ enabled: true, segments: [], maxBytes: 8192 })
  assert.equal(sectionText(state).includes('迁移段基线'), true, 'describe 失败时迁移段必须保留')
})

test('回归护栏：用户只改一个字段，迁移段的其余字段必须保留', async () => {
  // 真实缺陷：曾经是整体替换。用户在设置页只动一个开关，迁移段里的基线规则
  // 就整体消失——而文档承诺的是"其余字段回落到基线值"。
  const legacy = {
    path: join(tmpdir(), 'settings.yaml.imported'),
    present: true,
    section: { segments: [{ id: 'seed', enabled: true, text: '迁移段基线' }], maxBytes: 8192 }
  }

  // ① 只写 enabled → 基线规则必须保留
  {
    const harness = createFakeCtx({ legacy })
    await mountRuntime(harness)
    setUserFields(harness.state, { enabled: true })
    harness.state.setConfig({ enabled: true, segments: [], maxBytes: 8192 })
    assert.equal(sectionText(harness.state).includes('迁移段基线'), true, '只改开关时基线规则必须保留')
  }

  // ② 只写 maxBytes → 基线规则同样必须保留（字段级合并，不是整体替换）
  {
    const harness = createFakeCtx({ legacy })
    await mountRuntime(harness)
    setUserFields(harness.state, { maxBytes: 4096 })
    harness.state.setConfig({ enabled: true, segments: [], maxBytes: 4096 })
    assert.equal(sectionText(harness.state).includes('迁移段基线'), true, '只写 maxBytes 时基线规则必须保留')
  }

  // ③ 显式写 segments → 以用户为准（用户能覆盖基线，规则删得掉）
  {
    const harness = createFakeCtx({ legacy })
    await mountRuntime(harness)
    setUserFields(harness.state, { segments: [{ id: 'mine', enabled: true, text: '用户自己的规则' }] })
    harness.state.setConfig({ enabled: true, segments: [{ id: 'mine', enabled: true, text: '用户自己的规则' }], maxBytes: 8192 })
    const text = sectionText(harness.state)
    assert.equal(text.includes('用户自己的规则'), true, '用户写的规则必须生效')
    assert.equal(text.includes('迁移段基线'), false, '显式覆盖 segments 后不得再回落到基线（否则规则删不掉）')
  }

})

test('describe 的各种形状都必须安全：user 为空/为 null/为数组/不含本条目', async () => {
  // 判定"用户是否显式配置过"完全依赖 describe 返回的 user 层，而它是外部服务给的。
  // 这里逐个形状验证：任何形状都不得抛错，也不得把"没写过"误判成"写过"。
  const legacy = {
    path: join(tmpdir(), 'settings.yaml.imported'),
    present: true,
    section: { segments: [{ id: 'seed', enabled: true, text: '迁移段基线' }] }
  }
  const resolved = { enabled: true, segments: [], maxBytes: 8192 }

  // ① 无 user 键 / user 为空对象 / user 为 null / user 是数组 → 都算"没写过"，迁移段必须生效
  for (const user of [undefined, {}, null, []]) {
    const harness = createFakeCtx({ legacy })
    await mountRuntime(harness)
    harness.state.describeRows = [{ ns: 'dsh-extra-context', value: resolved, user }]
    harness.state.setConfig(resolved)
    assert.equal(sectionText(harness.state).includes('迁移段基线'), true,
      `user=${JSON.stringify(user)} 时必须保留迁移段配置（视为未配置）`)
  }

  // ② user 明确含 segments → 用户写过，以用户值为准（迁移段让位）
  {
    const harness = createFakeCtx({ legacy })
    await mountRuntime(harness)
    setUserFields(harness.state, { segments: [] })
    harness.state.setConfig(resolved)
    assert.equal(sectionText(harness.state).includes('迁移段基线'), false, '用户写过 segments 时以用户值为准')
  }

  // ③ describe 不含本条目 → 等同于"没写过"，不得抛错
  {
    const harness = createFakeCtx({ legacy })
    harness.state.describeOverride = () => [{ ns: 'other-entry', value: {} }]
    await mountRuntime(harness)
    harness.state.setConfig(resolved)
    assert.equal(sectionText(harness.state).includes('迁移段基线'), true, '本条目不在 describe 结果里时必须保留迁移段')
  }
})

test('状态路由的鉴权与状态码语义：405/403/200/?debug=1/500', async () => {
  // 这是插件唯一对外暴露的入口，此前它的 handler 从未被调用过（桩直接把 route 丢掉）。
  const harness = createFakeCtx()
  const { state } = harness
  state.describeRows = [{ ns: 'dsh-extra-context', value: { enabled: true, segments: [], maxBytes: 8192 } }]
  await mountRuntime(harness)

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
  assert.equal(typeof debug.body.debug.legacyPath, 'string', '必须给出旧 settings.yaml 的路径（迁移排查用）')
  assert.equal(debug.body.debug.entryPresent, true, '必须报告本条目是否可配置')
  const { Config } = await import('../lib/index.js')
  // 如实报告：取决于当前环境能否定位 DSH 安装（CI 上定位不到 → false）。
  assert.equal(debug.body.debug.schemaPresent, Config !== undefined, '必须如实报告条目 schema 是否存在')

  // 渲染抛错 → 500：诊断接口不允许把异常抛回给 HTTP 层（会变成未处理异常）
  state.setConfig({
    enabled: true,
    segments: [{ id: 'bad', enabled: true, text: { toString() { throw new Error('render boom') } } }],
    maxBytes: 8192
  })
  const boom = state.probeRoute()
  assert.equal(boom.threw, null, 'handler 不得把异常抛出去')
  assert.equal(boom.status === 200 || boom.status === 500, true, '要么正常降级返回，要么明确报 500')
  if (boom.status === 500) assert.equal(boom.body.ok, false, '500 必须是结构化错误')
})

test('版本门 fail closed：不支持的版本必须完全 inert（不注册任何东西）', async () => {
  // 版本门此前只测了纯函数：不支持时"什么都不注册"这条契约没有任何守卫。
  for (const version of ['0.1.4', '1.0.0', '0.1.6-alpha.2', '0.1.7-alpha.0', undefined, 'nonsense']) {
    const { ctx, state } = createFakeCtx()
    await applyForVersion(ctx, version, {})
    assert.equal(state.section, null, `${String(version)}：不支持时不得注册 section`)
    assert.equal(state.tools.length, 0, `${String(version)}：不支持时不得注册工具`)
    assert.deepEqual(state.presentations, [], `${String(version)}：不支持时不得声明设置展示策略`)
    assert.equal(state.route, undefined, `${String(version)}：不支持时不得注册路由`)
    assert.equal(state.warnings.some((w) => w.includes('unsupported DSH')), true, `${String(version)}：必须留下 error 日志`)
  }
})

test('版本门放行时：同线未验证版本继续运行但必须告警', async () => {
  const { ctx, state } = createFakeCtx()
  await applyForVersion(ctx, '0.1.7-rc.1', {})
  assert.notEqual(state.section, null, '同线未验证版本必须继续运行')
  assert.equal(state.warnings.some((w) => w.includes('not individually verified')), true, '必须留下未验证告警')

  const verified = createFakeCtx()
  await applyForVersion(verified.ctx, '0.1.7-alpha.1', {})
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
  await applyForVersion(ctx, '0.1.7-alpha.1', {})
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
    segments: [{ id: 'a', enabled: true, text: '请按 {{user_name}} 与 {{ handlebars }} 的风格回答' }]
  })
  assert.equal(rendered.includes('{{user_name}}'), true, '用户文本必须逐字保留')
  assert.equal(rendered.includes('{{ handlebars }}'), true, '含空格的引用同样逐字保留')
  assert.equal(rendered.includes('\u200b'), false, '渲染结果不得含零宽空格')

  // 终点断言：宿主注册 section 时必须真的声明 interpolate: false。
  // 少了它，用户写 {{name}} 就会让每一次模型请求都失败（很难排查）。
  const { ctx, state } = createFakeCtx()
  await createRuntime({ ctx, schema: { fake: true }, initial: { segments: [] }, log: () => {} })
  assert.equal(state.section.interpolate, false, 'section 必须声明 interpolate: false')

  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.equal(source.includes('interpolate: false'), true, '源码必须显式声明 interpolate: false')
  const bundle = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(bundle.includes('\\u200b'), false, '客户端预览不得再中和 {{')
})

test('压缩摘要补充指令：纯函数只拼生效分段，关掉或空内容时不产出', () => {
  assert.equal(renderCompactionNote({ segments: [] }), '', '没有分段时不得产出补充指令')
  assert.equal(renderCompactionNote({ segments: [{ id: 'a', enabled: true, text: '   ' }] }), '', '空白分段不算生效内容')
  assert.equal(renderCompactionNote({ enabled: false, segments: [{ id: 'a', enabled: true, text: '用中文' }] }), '', '总开关关掉时不得产出')

  const note = renderCompactionNote({
    segments: [
      { id: 'a', enabled: true, text: '所有展示内容用中文' },
      { id: 'b', enabled: false, text: '这条被停用' },
      { id: 'c', enabled: true, text: '回答末尾加 ✅' }
    ]
  })
  assert.equal(note.includes('所有展示内容用中文'), true, '启用分段的原文必须逐字进入补充指令')
  assert.equal(note.includes('回答末尾加 ✅'), true, '多段按顺序拼接')
  assert.equal(note.includes('这条被停用'), false, '停用分段不得进入补充指令')
  // 摘要不是给用户的回复：给回复用的装饰必须显式排除，否则摘要末尾会多出一个 ✅。
  assert.equal(note.includes('not a reply'), true, '必须声明摘要不是对用户的回复')
  assert.equal(note.includes('same language'), true, '必须显式要求沿用额外上下文规定的输出语言')
  assert.equal(note.includes('--- 用户额外上下文开始 ---'), true, '用户文本必须有明确的边界标记')
})

test('压缩摘要补充指令：只在 purpose=compaction 的请求末尾追加一条 user 消息', async () => {
  const harness = createFakeCtx({ config: { segments: [{ id: 'a', enabled: true, text: '所有展示给我看的部分都必须使用中文' }] } })
  const { state } = harness
  await mountRuntime(harness)
  assert.equal(state.injections.some((names) => names.includes('llm')), true, '必须按可选服务注入 llm')

  const options = compactionOptions()
  const before = options.messages.length
  const { downstream, returned } = runLlmStream(state, options)
  assert.equal(returned, 'downstream-stream', '必须把下游流的返回值原样返回')
  assert.equal(downstream, options, '必须放行同一份 options')
  assert.equal(options.messages.length, before + 1, '压缩请求必须恰好追加一条消息')

  const last = options.messages.at(-1)
  assert.equal(last.role, 'user', '追加的必须是 user 消息（摘要请求里最后一条 user 消息优先级最高）')
  assert.equal(last.content[0].type, 'text')
  assert.equal(last.content[0].text.includes('所有展示给我看的部分都必须使用中文'), true, '必须携带用户原文')
  assert.equal(last.source.plugin, 'dsh-extra-context', '来源必须可追溯到本插件')
  assert.equal(typeof last.id, 'string', '消息必须带稳定 id（适配器与遥测按它读）')
  // DSH 自己的英文摘要指令必须还在原位：我们是"追加一条更靠后的要求"，不是改写它。
  assert.equal(options.messages[before - 1].content[0].text.includes('Write concise English engineering prose.'), true)
  assert.equal(options.messages.filter((m) => m.content[0].text.includes('所有展示给我看的部分')).length, 1, '不得重复追加')
})

test('压缩摘要补充指令：其它 purpose、关掉开关、脏 options 都必须原样放行且不抛错', async () => {
  const { ctx, state } = createFakeCtx()
  await createRuntime({
    ctx,
    schema: { fake: true },
    initial: { segments: [{ id: 'a', enabled: true, text: '用中文' }] },
    log: () => {}
  })

  // 1) 其它 purpose（例如会话标题）不得被改动
  const title = compactionOptions({ purpose: 'session-title' })
  const titleBefore = title.messages.length
  runLlmStream(state, title)
  assert.equal(title.messages.length, titleBefore, 'session-title 请求不得被追加内容')

  // 2) 总开关关掉后不得追加（热生效：走的是同一份内存快照）
  const off = createFakeCtx()
  await createRuntime({ ctx: off.ctx, schema: { fake: true }, initial: { enabled: false, segments: [{ id: 'a', enabled: true, text: '用中文' }] }, log: () => {} })
  const offOptions = compactionOptions()
  runLlmStream(off.state, offOptions)
  assert.equal(offOptions.messages.length, 2, '关闭时不得追加内容')

  // 3) 空分段：没有生效文本时不得追加
  const empty = createFakeCtx()
  await createRuntime({ ctx: empty.ctx, schema: { fake: true }, initial: { segments: [] }, log: () => {} })
  const emptyOptions = compactionOptions()
  runLlmStream(empty.state, emptyOptions)
  assert.equal(emptyOptions.messages.length, 2, '没有生效文本时不得追加内容')

  // 4) 脏输入：任何一种形状异常都必须放行，绝不能把压缩请求弄失败
  const dirty = [null, undefined, {}, { purpose: 'compaction' }, { purpose: 'compaction', messages: null }]
  for (const bad of dirty) {
    let downstreamSeen = null
    state.llmStreamListener(bad, () => {
      downstreamSeen = bad
      return 'ok'
    })
    assert.equal(downstreamSeen, bad, `脏输入 ${JSON.stringify(bad)} 必须原样放行`)
  }

  // 5) 冻结的 options（真实宿主里 buildRequest 会 Object.freeze）：赋值抛错必须被吞掉，
  //    仍然放行下游 —— 压缩失败或摘要变差的代价远大于缺一条补充说明。
  const frozen = Object.freeze(compactionOptions())
  const frozenResult = runLlmStream(state, frozen)
  assert.equal(frozenResult.downstream, frozen, '冻结对象也必须放行')
  assert.equal(frozen.messages.length, 2, '冻结对象无法被改写，只能放行原请求')
})

test('压缩摘要补充指令：设置热更新后立即使用新文本', async () => {
  const harness = createFakeCtx({ config: { segments: [{ id: 'a', enabled: true, text: '旧规则' }] } })
  const { state } = harness
  await mountRuntime(harness)

  const first = compactionOptions()
  runLlmStream(state, first)
  assert.equal(first.messages.at(-1).content[0].text.includes('旧规则'), true)

  state.setConfig({ segments: [{ id: 'a', enabled: true, text: '新规则' }] })
  const second = compactionOptions()
  runLlmStream(state, second)
  assert.equal(second.messages.at(-1).content[0].text.includes('新规则'), true, '必须用最新设置')
  assert.equal(second.messages.at(-1).content[0].text.includes('旧规则'), false, '不得残留旧文本')
})

test('压缩摘要补充指令：源码必须把监听器注册在 llm/stream 上（契约锚点）', async () => {
  // 这条护栏的理由：机制靠"排在 DSH 英文摘要指令之后"生效，一旦有人把监听器
  // 换成别的钩子（或换成替换 messages 而不是追加），用例 2 会变红；这里再固定住
  // 契约名，避免改名后静默失效。
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.equal(source.includes("llmCtx.on('llm/stream'"), true, '必须注册在 llm/stream 上')
  assert.equal(source.includes('COMPACTION_PURPOSE'), true, '必须按 purpose 精确筛选')
})
