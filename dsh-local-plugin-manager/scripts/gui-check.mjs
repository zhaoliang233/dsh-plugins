#!/usr/bin/env node
/**
 * 真机验收脚本：用 Chrome DevTools Protocol 在**隔离**宿主的真实 GUI 里走一遍
 * 「打开设置 → 菜单里出现「插件开发」并带专属图标 → 点开分区 → 列表内容 →
 *  启停一条本地 link 插件 → 宿主状态 / profile patch 同步 → 再切回」，任何一步
 * 不符合预期就非零退出。
 *
 * 为什么需要它（而不是只靠 `node --test`）：客户端有一类缺陷纯函数测不出来——
 * 分区注册了却没进菜单、导航图标补丁"标记打了但 mask 没生效"、开关点了但 patch 没写。
 * 这三类都是"真渲染 + 真点 + 真宿主"才会暴露的。
 *
 * 前置（都必须是**隔离**资源，不要碰你正在用的 3080 宿主）：
 *   1. DSH_HOME=/tmp/<隔离目录> dsh --profile web --port <非 3080> --no-open
 *   2. "<Chrome>" --headless=new --disable-gpu --remote-debugging-port=9344 \
 *        --user-data-dir=/tmp/<隔离目录>-cdp about:blank
 *
 * 用法：
 *   node scripts/gui-check.mjs --url 'http://127.0.0.1:<port>/?token=<token>' \
 *     [--cdp-port 9344] [--patch <profile>/cordis.patch.yml]
 */

import { readFile } from 'node:fs/promises'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const url = option('url')
const cdpPort = Number(option('cdp-port', '9344'))
const patchPath = option('patch')
if (typeof url !== 'string' || !url.includes('token=')) {
  console.error('用法: node scripts/gui-check.mjs --url <带 token 的 URL> [--cdp-port 9344] [--patch <profile>/cordis.patch.yml]')
  process.exit(2)
}

const SECTION_LABEL = '插件开发'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail ?? ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      const page = list.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) {
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true })
          socket.addEventListener('error', reject, { once: true })
        })
        let next = 1
        const pending = new Map()
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(event.data)
          const entry = pending.get(message.id)
          if (entry === undefined) return
          pending.delete(message.id)
          if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
          else entry.resolve(message.result)
        })
        const send = (method, params = {}) => new Promise((resolve, reject) => {
          pending.set(next, { resolve, reject })
          socket.send(JSON.stringify({ id: next, method, params }))
          next += 1
        })
        return {
          send,
          async evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
            if (result.exceptionDetails !== undefined) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 500))
            return result.result?.value
          }
        }
      }
    } catch { /* Chrome 还没起来 */ }
    await sleep(250)
  }
  throw new Error('无法连接 CDP：Chrome 起了吗？--remote-debugging-port 对吗？')
}

/** 页内取值脚本：只读 DOM，不替组件推导任何状态。 */
const READ_NAV = `(() => [...document.querySelectorAll('nav button')].map((button) => ({
  label: (button.textContent || '').trim(),
  patched: button.dataset.dlpmNavIcon === '',
  mask: (button.style.getPropertyValue('--dlpm-nav-icon-mask') || '').slice(0, 22),
  drawn: (getComputedStyle(button, '::before').maskImage || '').slice(0, 22)
})))()`

const READ_SECTION = `(() => {
  const root = document.querySelector('section[aria-label="${SECTION_LABEL}"]')
  if (root === null) return null
  const text = (node, selector) => node.querySelector(selector)?.textContent ?? null
  return {
    scope: text(root, '.dlpm-scope'),
    count: text(root, '.dlpm-count'),
    rows: [...root.querySelectorAll('.dlpm-row')].map((row) => {
      const control = row.querySelector('[role="switch"]') ?? row.querySelector('button[aria-checked]')
      return {
        name: text(row, '.dlpm-name'),
        version: text(row, '.dlpm-version'),
        path: text(row, '.dlpm-path'),
        description: text(row, '.dlpm-description'),
        loaderRows: text(row, '.dlpm-rows-value'),
        tags: [...row.querySelectorAll('span')].map((span) => span.textContent).filter((value) => ['当前管理器', '已启用', '已禁用', '部分启用'].includes(value)),
        checked: control?.getAttribute('aria-checked') ?? null,
        disabled: control?.disabled === true || control?.getAttribute('aria-disabled') === 'true'
      }
    })
  }
})()`

const clickNav = (label) => `(() => {
  const target = [...document.querySelectorAll('nav button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)})
  if (target === undefined) return false
  target.click()
  return true
})()`

// 全新的隔离 DSH_HOME 会带引导对话框（「内测声明」写入 profile patch 后不再出现，
// 「添加一个 API Key」在没有凭据时每次加载都出现）。它们带 `aria-modal`，会吃掉
// 对设置入口的点击，于是设置面板根本打不开。这里只认这两类引导，其它对话框一律不碰。
const DISMISS_ONBOARDING = `(() => {
  const dismissed = []
  for (const dialog of document.querySelectorAll('[aria-modal="true"], [role="dialog"]')) {
    const label = dialog.getAttribute('aria-label') ?? ''
    if (!/内测声明|API Key/u.test(label)) continue
    const button = [...dialog.querySelectorAll('button')].find((item) => ['继续', '稍后配置'].includes((item.textContent ?? '').trim()))
    if (button === undefined) continue
    button.click()
    dismissed.push(label + ' → ' + button.textContent.trim())
  }
  return dismissed
})()`

const clickSwitch = (name) => `(() => {
  const root = document.querySelector('section[aria-label="${SECTION_LABEL}"]')
  const row = [...root.querySelectorAll('.dlpm-row')].find((item) => item.querySelector('.dlpm-name')?.textContent === ${JSON.stringify(name)})
  if (row === undefined) return null
  const control = row.querySelector('[role="switch"]') ?? row.querySelector('button[aria-checked]')
  if (control === null || control.disabled === true) return null
  const before = control.getAttribute('aria-checked')
  control.click()
  return before
})()`

const countOverrides = (text, name) => (text.match(new RegExp(`id: ${name}\\b`, 'gu')) ?? []).length

/** 该行在 patch 文本里最后一条顶层覆盖项的 disabled 值；没有覆盖项时返回 null。 */
const lastOverrideDisabled = (text, name) => {
  const lines = text.split('\n')
  const starts = lines.flatMap((line, index) => (/^-\s/u.test(line) ? [index] : []))
  let value = null
  for (const start of starts) {
    if (lines[start].trim() !== `- id: ${name}`) continue
    const end = starts.find((index) => index > start) ?? lines.length
    const disabled = lines.slice(start + 1, end).find((line) => /^\s+disabled:\s+(?:true|false)\s*$/u.test(line))
    value = disabled === undefined ? null : /\btrue\s*$/u.test(disabled)
  }
  return value
}

const cdp = await connect()
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Page.navigate', { url })
for (let attempt = 0; attempt < 40; attempt += 1) {
  if (await cdp.evaluate(`!!document.querySelector('button[aria-label="设置"]')`)) break
  await sleep(250)
}

// 1) 设置菜单：本插件必须是**独立分区**，排在 DSH 自带项之后。
// 引导对话框带 `aria-modal`，会吃掉对设置入口的点击，先按需关掉再点开设置面板。
let nav = []
for (let attempt = 0; attempt < 4; attempt += 1) {
  const dismissed = await cdp.evaluate(DISMISS_ONBOARDING)
  if (dismissed.length > 0) console.log(`（已关闭引导对话框：${dismissed.join('、')}）`)
  await cdp.evaluate(`document.querySelector('button[aria-label="设置"]').click()`)
  await sleep(900)
  nav = await cdp.evaluate(READ_NAV)
  if (nav.some((row) => row.label !== '')) break
  await sleep(700)
}
const labels = nav.map((row) => row.label)
check(`设置菜单里出现「${SECTION_LABEL}」`, labels.includes(SECTION_LABEL), JSON.stringify(labels))
// 契约是「排在 DSH 自带项之后」，不是「排在最后一行」：别的插件同样会贡献 ≥100 的分区
// （extra-context 100、default-overrides 与 mcp-manager 110、chat-archive-manager 120），
// 所以「最后一行」只在只装本插件的隔离环境里才成立。这里按内置 label 定位最后一个自带项。
const BUILTIN_SECTION_LABELS = ['通用设置', '模型', '内置插件', 'Agent 预设']
const lastBuiltinIndex = Math.max(...BUILTIN_SECTION_LABELS.map((label) => labels.indexOf(label)))
check(
  '本分区排在 DSH 自带项之后',
  BUILTIN_SECTION_LABELS.every((label) => labels.includes(label)) && labels.indexOf(SECTION_LABEL) > lastBuiltinIndex,
  JSON.stringify(labels)
)
const selfRow = nav.find((row) => row.label === SECTION_LABEL)
check('导航行的专属图标补丁已打上', selfRow?.patched === true && selfRow.mask.startsWith('url("data:image/svg'), JSON.stringify(selfRow))
check('专属图标真的画了出来（::before 的 mask 生效）', typeof selfRow?.drawn === 'string' && selfRow.drawn.includes('data:image/svg'), selfRow?.drawn)
check('没有复用官方插件分区的 tab（客户端不注册 settings.plugins.tab）',
  await cdp.evaluate(`document.querySelectorAll('section[aria-label="${SECTION_LABEL}"]').length === 0`), '分区在点开前不应渲染')

// 2) 点开分区读列表。
check('分区菜单行可点', await cdp.evaluate(clickNav(SECTION_LABEL)) === true)
await sleep(900)
const section = await cdp.evaluate(READ_SECTION)
check('分区按 aria-label 挂载', section !== null, JSON.stringify(section)?.slice(0, 160))
check('定位说明写进面板（说明只管 link: 开发插件）', typeof section?.scope === 'string' && section.scope.includes('link:'), section?.scope)
check('行数与会话里的本地插件一致', Number.parseInt(section?.count ?? '', 10) === section?.rows.length, `${section?.count} vs ${section?.rows.length}`)
check('行内给出源码路径', section?.rows.every((row) => typeof row.path === 'string' && row.path.startsWith('/')) === true, JSON.stringify(section?.rows.map((row) => row.path)))
check('行内给出插件自己的说明', section?.rows.every((row) => typeof row.description === 'string' && row.description.length > 0) === true,
  JSON.stringify(section?.rows.map((row) => row.description)))
check('管理器自身只读（标出「当前管理器」）',
  section?.rows.find((row) => row.name === 'dsh-local-plugin-manager')?.tags.includes('当前管理器') === true,
  JSON.stringify(section?.rows.find((row) => row.name === 'dsh-local-plugin-manager')?.tags))
check('行 id 与包名相同时不重复渲染 loader 行', section?.rows.every((row) => row.loaderRows === null) === true,
  JSON.stringify(section?.rows.map((row) => row.loaderRows)))

// 3) 启停一条可管理的本地插件，核对 profile patch 与界面。
const target = section?.rows.find((row) => row.name !== 'dsh-local-plugin-manager' && row.disabled === false && row.checked !== null)
if (target === undefined) {
  check('找到一条可启停的本地 link 插件', false, '隔离 profile 里至少要有两条 link 插件')
} else {
  const before = patchPath === undefined ? undefined : await readFile(patchPath, 'utf8')
  const beforeCount = before === undefined ? 0 : countOverrides(before, target.name)
  // 该行可能已经有一条覆盖项（用户手写、官方插件页或本管理器写的）：官方语义是就地改写，
  // 不是再追加一条，所以断言的是「条目数不增长」而不是「+1」。
  const expectedCount = Math.max(beforeCount, 1)
  const wasChecked = await cdp.evaluate(clickSwitch(target.name))
  await sleep(2500)
  const flipped = await cdp.evaluate(READ_SECTION)
  const after = flipped?.rows.find((row) => row.name === target.name)
  check('开关点击后界面状态翻转', typeof wasChecked === 'string' && after?.checked !== wasChecked, `${wasChecked} → ${after?.checked}`)
  check('徽标跟着翻转', after?.tags.includes(after.checked === 'true' ? '已启用' : '已禁用') === true, JSON.stringify(after?.tags))
  if (patchPath !== undefined) {
    const text = await readFile(patchPath, 'utf8')
    check('profile patch 写出该行的覆盖项，条目数不增长',
      countOverrides(text, target.name) === expectedCount, `${beforeCount} → ${countOverrides(text, target.name)}`)
    check('禁用写进该行覆盖项的 disabled: true', lastOverrideDisabled(text, target.name) === true,
      text.trim().split('\n').slice(-3).join(' | '))
  }
  await cdp.evaluate(clickSwitch(target.name))
  await sleep(2500)
  check('再切回后界面状态复原', (await cdp.evaluate(READ_SECTION))?.rows.find((row) => row.name === target.name)?.checked === wasChecked)
  if (patchPath !== undefined) {
    const text = await readFile(patchPath, 'utf8')
    check('启用写显式 disabled: false 且不删条目（与官方插件页共用同一批覆盖项，不互相回滚）',
      lastOverrideDisabled(text, target.name) === false && countOverrides(text, target.name) === expectedCount,
      `disabled=${String(lastOverrideDisabled(text, target.name))} 条目数=${countOverrides(text, target.name)}`)
  }
}

console.log(failures.length === 0 ? '\n全部通过' : `\n失败 ${failures.length} 项:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
