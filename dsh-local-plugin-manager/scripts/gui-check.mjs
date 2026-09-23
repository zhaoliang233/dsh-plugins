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

const cdp = await connect()
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Page.navigate', { url })
for (let attempt = 0; attempt < 40; attempt += 1) {
  if (await cdp.evaluate(`!!document.querySelector('button[aria-label="设置"]')`)) break
  await sleep(250)
}

// 1) 设置菜单：本插件必须是**独立分区**，排在 DSH 自带项之后。
await cdp.evaluate(`document.querySelector('button[aria-label="设置"]').click()`)
await sleep(900)
const nav = await cdp.evaluate(READ_NAV)
const labels = nav.map((row) => row.label)
check(`设置菜单里出现「${SECTION_LABEL}」`, labels.includes(SECTION_LABEL), JSON.stringify(labels))
check('本分区排在 DSH 自带项之后', labels.indexOf(SECTION_LABEL) === labels.length - 1, JSON.stringify(labels))
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
  const wasChecked = await cdp.evaluate(clickSwitch(target.name))
  await sleep(2500)
  const flipped = await cdp.evaluate(READ_SECTION)
  const after = flipped?.rows.find((row) => row.name === target.name)
  check('开关点击后界面状态翻转', typeof wasChecked === 'string' && after?.checked !== wasChecked, `${wasChecked} → ${after?.checked}`)
  check('徽标跟着翻转', after?.tags.includes(after.checked === 'true' ? '已启用' : '已禁用') === true, JSON.stringify(after?.tags))
  if (patchPath !== undefined) {
    const text = await readFile(patchPath, 'utf8')
    check('profile patch 写出同名覆盖项', countOverrides(text, target.name) === (before === undefined ? 1 : countOverrides(before, target.name) + 1),
      text.trim().split('\n').slice(-3).join(' | '))
  }
  await cdp.evaluate(clickSwitch(target.name))
  await sleep(2500)
  check('再切回后界面状态复原', (await cdp.evaluate(READ_SECTION))?.rows.find((row) => row.name === target.name)?.checked === wasChecked)
  if (patchPath !== undefined) {
    const text = await readFile(patchPath, 'utf8')
    check('覆盖项始终只有一条（与官方插件页共用同一批条目，不互相回滚）',
      countOverrides(text, target.name) <= (before === undefined ? 1 : countOverrides(before, target.name) + 1),
      String(countOverrides(text, target.name)))
  }
}

console.log(failures.length === 0 ? '\n全部通过' : `\n失败 ${failures.length} 项:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
