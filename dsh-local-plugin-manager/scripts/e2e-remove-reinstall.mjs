#!/usr/bin/env node
/**
 * 端到端验收：**用设置页把一条 `link:` 插件摘掉，再把它装回来**。
 *
 * 为什么单独一个脚本：`gui-check.mjs` 只走到「启停一条行覆盖项」，而卸载/重装这条链路
 * 是另一类风险——它跨了四个进程/组件（设置页 → Host 路由 → 官方 `dsh plugin remove`
 * 子进程 → pnpm；装回时反过来再走官方 plugin-manager 的 `installBundle`），并且
 * 0.2.1 起「移除一个本地 link 插件」才允许在进程内真正生效（`dsh-app-boot` 放宽了
 * `ResolutionRouter.replace()` 的替换校验，见插件 `AGENTS.md` 的逐项核对记录）。
 * 这几步哪一步没有证据，都不能说这条线跑通了。
 *
 * 前置（都必须是**隔离**资源，不要碰你正在用的 3080 宿主）：
 *   1. DSH_HOME=/tmp/<隔离目录> dsh plugin --profile web add link:<目标插件目录>
 *      再装上 `dsh-local-plugin-manager`（本脚本自己不会安装前两个）
 *   2. DSH_HOME=/tmp/<隔离目录> dsh --profile web --port <非 3080> --no-open
 *   3. "<Chrome>" --headless=new --disable-gpu --remote-debugging-port=9344 \
 *        --user-data-dir=/tmp/<隔离目录>-cdp about:blank
 *
 * 用法：
 *   node scripts/e2e-remove-reinstall.mjs \
 *     --url 'http://127.0.0.1:<port>/?token=<token>' \
 *     --profile <DSH_HOME>/profiles/web \
 *     --plugin dsh-extra-context --source /abs/path/to/dsh-extra-context \
 *     [--cdp-port 9344] [--cli-reinstall] [--expect-disabled-after-reinstall|--expect-enabled-after-reinstall]
 *
 * `--cli-reinstall` 把「装回」改用官方 CLI（`dsh plugin --profile web add link:<目录>`），
 * 不打开侧边栏「插件」页的安装对话框；默认整条往返都在 GUI 里完成。
 * `--expect-*-after-reinstall` 覆盖「重装后的启用状态」判定：默认按实际走到的启用入口推断
 * （官方「立即启用」会改写覆盖项 → 已启用；只点 bundle 开关或走 CLI → 仍是已禁用）。
 * 退出码 0 = 全部断言通过。
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { isMap, isSeq, parseDocument } from 'yaml'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const flag = (name) => args.includes(`--${name}`)
const usage = 'node scripts/e2e-remove-reinstall.mjs --url <带 token 的 URL> --profile <profile 目录> --plugin <包名> --source <源码目录> [--cdp-port 9344] [--cli-reinstall]'

const url = option('url')
const profileDir = option('profile') === undefined ? undefined : resolve(option('profile'))
const target = option('plugin')
const source = option('source') === undefined ? undefined : resolve(option('source'))
const cdpPort = Number(option('cdp-port', '9344'))
const cliReinstall = flag('cli-reinstall')
if (typeof url !== 'string' || !url.includes('token=') || profileDir === undefined || target === undefined || source === undefined) {
  console.error(`用法: ${usage}`)
  process.exit(2)
}

const SECTION_LABEL = '插件开发'
const PANEL_LABEL = '插件'
const ADD_PLUGIN_LABEL = '添加插件'
const INSTALL_SPEC_LABEL = '包名或地址'
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(`${name}: ${detail ?? ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const note = (message) => console.log(`  · ${message}`)

/** 轮询到条件成立或超时；返回条件最后一次的求值结果。 */
async function waitFor(probe, { timeoutMs, intervalMs = 500, label = '条件' }) {
  const deadline = Date.now() + timeoutMs
  let last
  for (;;) {
    last = await probe()
    if (last !== undefined && last !== false) return last
    if (Date.now() >= deadline) return last
    await sleep(intervalMs)
  }
}

const dshHome = resolve(profileDir, '..', '..')
const manifestPath = join(profileDir, 'package.json')
const patchPath = join(profileDir, 'cordis.patch.yml')
const statePath = join(profileDir, '.dsh-local-plugin-manager', 'state.json')
const lockPath = join(profileDir, 'package.json.lock')

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) return fallback
    throw error
  }
}

async function readManifest() {
  return readJson(manifestPath)
}

const installed = (manifest) => Boolean(manifest.dependencies?.[target]) && (manifest.dsh?.profile?.bundles ?? []).includes(target)

/** 该行在 profile patch 里的最后一条顶层覆盖项的 disabled 值；没有条目时返回 null。 */
async function overrideDisabled() {
  const text = await readFile(patchPath, 'utf8')
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value) => value }] })
  if (document.errors.length > 0) throw new Error(`patch 不是有效 YAML：${document.errors[0].message}`)
  if (!isSeq(document.contents)) throw new Error('patch 必须是顶层 YAML 数组')
  const entries = document.contents.items.filter(
    (item) => isMap(item) && item.has('insert') === false && item.get('id') === target
  )
  const last = entries.at(-1)
  if (last === undefined) return null
  const value = last.get('disabled')
  return typeof value === 'boolean' ? value : null
}

/** 当前进程写入的卸载墓碑。 */
async function tombstoneFor() {
  const state = await readJson(statePath, undefined)
  return state?.pendingRemovals?.find((item) => item.name === target)
}

async function connect() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
      const page = list.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) {
        const socket = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolvePromise, reject) => {
          socket.addEventListener('open', resolvePromise, { once: true })
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
        const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
          pending.set(next, { resolve: resolvePromise, reject })
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

/** 载入（或重新载入）页面，并等到设置入口出现。 */
async function load(urlWithCacheBuster) {
  await cdp.send('Page.navigate', { url: urlWithCacheBuster })
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await cdp.evaluate(`!!document.querySelector('button[aria-label="设置"]')`)) break
    await sleep(250)
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dismissed = await cdp.evaluate(`(() => {
      const dismissed = []
      for (const dialog of document.querySelectorAll('[aria-modal="true"], [role="dialog"]')) {
        const label = dialog.getAttribute('aria-label') ?? ''
        if (!/内测声明|API Key/u.test(label)) continue
        const button = [...dialog.querySelectorAll('button')].find((item) => ['继续', '稍后配置'].includes((item.textContent ?? '').trim()))
        if (button === undefined) continue
        button.click()
        dismissed.push(label)
      }
      return dismissed
    })()`)
    if (dismissed.length === 0) break
    await sleep(400)
  }
}

const openSettings = `(() => {
  const button = document.querySelector('button[aria-label="设置"]')
  if (button === null) return false
  button.click()
  return true
})()`

const openSection = `(() => {
  const nav = [...document.querySelectorAll('nav button')].find((button) => button.textContent.trim() === ${JSON.stringify(SECTION_LABEL)})
  if (nav === undefined) return false
  nav.click()
  return true
})()`

const READ_SECTION = `(() => {
  const root = document.querySelector('section[aria-label="${SECTION_LABEL}"]')
  if (root === null) return null
  const text = (node, selector) => node.querySelector(selector)?.textContent ?? null
  return {
    count: text(root, '.dlpm-count'),
    rows: [...root.querySelectorAll('.dlpm-row')].map((row) => {
      const control = row.querySelector('[role="switch"]') ?? row.querySelector('button[aria-checked]')
      const uninstall = row.querySelector('button[aria-label="卸载 ' + row.querySelector('.dlpm-name')?.textContent + '"]')
      return {
        name: text(row, '.dlpm-name'),
        tags: [...row.querySelectorAll('span')].map((span) => span.textContent).filter((value) => ['当前管理器', '已启用', '已禁用', '部分启用'].includes(value)),
        checked: control?.getAttribute('aria-checked') ?? null,
        switchDisabled: control === null || control === undefined || control.disabled === true,
        canUninstall: uninstall !== undefined && uninstall !== null && uninstall.disabled !== true
      }
    })
  }
})()`

const clickUninstall = (name) => `(() => {
  const button = document.querySelector('button[aria-label=${JSON.stringify(`卸载 ${name}`)}]')
  if (button === null || button.disabled === true) return false
  button.click()
  return true
})()`

const READ_DIALOG = `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .find((node) => (node.textContent ?? '').includes('将从当前 web profile 移除这条本地链接'))
  if (dialog === undefined) return null
  const confirm = [...dialog.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === '卸载')
  return { found: true, confirm: confirm !== undefined && confirm.disabled !== true }
})()`

const clickConfirmUninstall = `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .find((node) => (node.textContent ?? '').includes('将从当前 web profile 移除这条本地链接'))
  if (dialog === undefined) return false
  const confirm = [...dialog.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim() === '卸载')
  if (confirm === undefined || confirm.disabled === true) return false
  confirm.click()
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

/** 侧边栏「插件」页 → 「添加插件」 → 填 spec → 「安装」。
 * 侧边栏默认是**折叠**态（只有图标），所以按 aria-label 定位那行，而不是按文本。 */
const openPluginPanel = `(() => {
  const button = document.querySelector('button[aria-label=${JSON.stringify(PANEL_LABEL)}]')
  if (button === null) return false
  button.click()
  return true
})()`

const openInstallDialog = `(() => {
  const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === ${JSON.stringify(ADD_PLUGIN_LABEL)} && item.disabled !== true)
  if (button === undefined) return false
  button.click()
  return true
})()`

const fillSpec = (spec) => `(() => {
  const input = document.querySelector('input[aria-label=${JSON.stringify(INSTALL_SPEC_LABEL)}]')
  if (input === null) return false
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(spec)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`

const clickInstall = `(() => {
  const button = [...document.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === '安装' && item.disabled !== true)
  if (button === undefined) return false
  button.click()
  return true
})()`

/** 安装对话框的当前状态：完成态是否给出「立即启用」/「关闭」，以及 pnpm 的输出片段。 */
const READ_INSTALL_DIALOG = `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .find((node) => node.querySelector('input[aria-label=${JSON.stringify(INSTALL_SPEC_LABEL)}]') !== null)
  if (dialog === null || dialog === undefined) return { open: false }
  const button = (label) => [...dialog.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === label && item.disabled !== true) !== undefined
  return {
    open: true,
    enableNow: button('立即启用'),
    close: button('关闭'),
    text: (dialog.textContent ?? '').replace(/\\s+/gu, ' ').slice(0, 400)
  }
})()`

const clickEnableNow = `(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
    .find((node) => node.querySelector('input[aria-label=${JSON.stringify(INSTALL_SPEC_LABEL)}]') !== null)
  if (dialog === null || dialog === undefined) return false
  const button = [...dialog.querySelectorAll('button')].find((item) => (item.textContent ?? '').trim() === '立即启用' && item.disabled !== true)
  if (button === undefined) return false
  button.click()
  return true
})()`

/** 官方插件页列表卡片上的 bundle 选择开关（不是进详情后的行级开关）。 */
const clickBundleSwitch = (name) => `(() => {
  const button = document.querySelector('button[aria-label=${JSON.stringify(`启用 ${name}`)}]')
  if (button === null || button.disabled === true || button.getAttribute('aria-checked') === 'true') return false
  button.click()
  return true
})()`

const bootGraphHasTarget = `(() => {
  const entries = window.__DSH_BOOT__?.entries ?? []
  return entries.some((entry) => entry.id === ${JSON.stringify(target)})
})()`

async function reinstallViaCli(spec) {
  const cli = process.env.DSH_CLI ?? 'dsh'
  return new Promise((resolvePromise) => {
    const child = spawn(cli, ['plugin', '--profile', 'web', 'add', spec, '--config.minimumReleaseAge=0'], {
      env: { ...process.env, DSH_HOME: dshHome },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('close', (code) => resolvePromise({ code, output }))
  })
}

const cdp = await connect()
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')

// ── A. 摘除前：manifest / 设置页 / boot graph 三处都认为它在 ─────────────────────────
const beforeManifest = await readManifest()
check('摘除前：manifest 同时声明依赖与 bundle', installed(beforeManifest),
  JSON.stringify({ dependency: beforeManifest.dependencies?.[target], bundles: beforeManifest.dsh?.profile?.bundles?.includes(target) }))

await load(`${url}&e2e=${Date.now()}`)
await cdp.evaluate(openSettings)
await sleep(900)
check('设置菜单里有「插件开发」分区', await cdp.evaluate(openSection) === true)
await sleep(900)
const beforeSection = await cdp.evaluate(READ_SECTION)
const beforeRow = beforeSection?.rows.find((row) => row.name === target)
check('摘除前：面板列出该插件且可卸载', beforeRow !== undefined && beforeRow.canUninstall === true, JSON.stringify(beforeRow))
check('摘除前：boot graph 里有它的 client bundle', await cdp.evaluate(bootGraphHasTarget) === true)

// ── B. 用设置页摘掉它 ─────────────────────────────────────────────────────────────
check('卸载按钮点开确认弹窗', await cdp.evaluate(clickUninstall(target)) === true)
await sleep(600)
const dialog = await cdp.evaluate(READ_DIALOG)
check('确认弹窗给出危险操作按钮', dialog?.confirm === true, JSON.stringify(dialog))
check('点确认执行卸载', await cdp.evaluate(clickConfirmUninstall) === true)

const removed = await waitFor(async () => {
  try {
    const manifest = await readManifest()
    return installed(manifest) ? false : true
  } catch { return false }
}, { timeoutMs: 120_000, intervalMs: 1_000, label: '卸载完成' })
check('profile manifest 里依赖与 bundle 都已移除', removed === true)

const finalPatchDisabled = await overrideDisabled()
check('patch 里该行覆盖项为 disabled: true', finalPatchDisabled === true, `disabled=${String(finalPatchDisabled)}`)
const tombstone = await tombstoneFor()
check('留下当前进程的卸载墓碑（覆盖项保留到进程结束）', tombstone !== undefined, JSON.stringify(tombstone))
check('没有残留的 profile 写锁', await readJson(lockPath, 'absent') === 'absent')

await load(`${url}&e2e=${Date.now()}`)
await cdp.evaluate(openSettings)
await sleep(900)
await cdp.evaluate(openSection)
await sleep(900)
const afterSection = await cdp.evaluate(READ_SECTION)
check('面板不再列出该插件', afterSection !== null && afterSection.rows.every((row) => row.name !== target),
  JSON.stringify(afterSection?.rows.map((row) => row.name)))
const graphGone = await waitFor(async () => (await cdp.evaluate(bootGraphHasTarget)) === false, { timeoutMs: 25_000, intervalMs: 1_000 })
check('boot graph 里它的 client bundle 已消失（hmr 重组真的生效）', graphGone === true)

// ── C. 装回 ────────────────────────────────────────────────────────────────────
// 官方「安装」只把**依赖**写进 profile（`enabled: subject.selection ?? false`），选中 bundle 是
// 第二步（对话框完成态的「立即启用」，或列表卡片上的 bundle 开关）。而且 profile 一变化，客户端
// 会重挂，对话框不一定还在——所以这里按「依赖先落地、再走官方入口选中 bundle」两步做，
// 记录实际走的是哪条路（两条都是官方入口，不影响证据强度）。
const spec = `link:${source}`
let enableRoute
if (cliReinstall) {
  note(`装回走官方 CLI：dsh plugin --profile web add ${spec}`)
  const result = await reinstallViaCli(spec)
  check('官方 CLI 装回成功', result.code === 0, result.output.trim().split('\n').slice(-2).join(' | '))
  enableRoute = 'cli'
} else {
  note(`装回走官方插件页：侧边栏「${PANEL_LABEL}」→「${ADD_PLUGIN_LABEL}」→ 填 ${spec} →「安装」`)
  check('切到侧边栏插件页', await cdp.evaluate(openPluginPanel) === true)
  await sleep(1_200)
  check('打开安装对话框', await cdp.evaluate(openInstallDialog) === true)
  await sleep(600)
  check('安装对话框出现 spec 输入框', (await cdp.evaluate(READ_INSTALL_DIALOG))?.open === true)
  check('填入 link: spec', await cdp.evaluate(fillSpec(spec)) === true)
  await sleep(300)
  check('点「安装」提交', await cdp.evaluate(clickInstall) === true)

  const depBack = await waitFor(async () => {
    try { return (await readManifest()).dependencies?.[target] !== undefined } catch { return false }
  }, { timeoutMs: 180_000, intervalMs: 1_000 })
  check('官方安装把依赖写回 profile manifest', depBack === true,
    `dependency=${String((await readManifest().catch(() => ({}))).dependencies?.[target])}`)
  if (depBack !== true) note(`安装对话框最后状态：${JSON.stringify(await cdp.evaluate(READ_INSTALL_DIALOG))}`)

  if (depBack === true) {
    const dialogState = await cdp.evaluate(READ_INSTALL_DIALOG)
    if (dialogState?.enableNow === true) {
      enableRoute = 'dialog-enable-now'
      note(`安装输出片段：${String(dialogState.text).slice(0, 160)}`)
      check('对话框完成态给出「立即启用」并点了它', await cdp.evaluate(clickEnableNow) === true)
    } else {
      note(`对话框已重挂（${JSON.stringify(dialogState)}）；改用官方列表卡片上的 bundle 开关`)
      enableRoute = 'panel-switch'
      const clicked = await waitFor(async () => {
        const ok = await cdp.evaluate(clickBundleSwitch(target))
        return ok === true ? true : undefined
      }, { timeoutMs: 30_000, intervalMs: 1_000 })
      check('点官方列表的 bundle 开关（aria-label「启用 <包名>」）', clicked === true)
    }
  }
}

const reinstalled = await waitFor(async () => {
  try {
    return installed(await readManifest())
  } catch { return false }
}, { timeoutMs: 180_000, intervalMs: 1_000 })
check('profile manifest 重新声明依赖与 bundle', reinstalled === true)

// 「立即启用」走的是官方 `setPluginEnabled`，会就地把那条 `disabled: true` 覆盖项改写成 false；
// 只点 bundle 开关（或走 CLI）时，本插件上一进程写的覆盖项仍在 → 重装后是「已禁用」（fail-closed）。
const expectedDisabled = flag('expect-disabled-after-reinstall') || flag('expect-enabled-after-reinstall')
  ? flag('expect-disabled-after-reinstall')
  : enableRoute !== 'dialog-enable-now'

await load(`${url}&e2e=${Date.now()}`)
const graphAfterReinstall = await waitFor(async () => {
  const has = await cdp.evaluate(bootGraphHasTarget)
  return has === !expectedDisabled ? true : undefined
}, { timeoutMs: 30_000, intervalMs: 1_000 })
check(
  expectedDisabled
    ? '重装后该行仍是禁用态，boot graph 里也还没有它（两处一致）'
    : 'boot graph 里它的 client bundle 回来了',
  graphAfterReinstall === true
)

await cdp.evaluate(openSettings)
await sleep(900)
await cdp.evaluate(openSection)
await sleep(900)
const restored = await cdp.evaluate(READ_SECTION)
const restoredRow = restored?.rows.find((row) => row.name === target)
check('面板重新列出该插件', restoredRow !== undefined, JSON.stringify(restored?.rows.map((row) => row.name)))
check('重装后它仍可管理（未被陈旧状态挡住）', restoredRow?.switchDisabled === false, JSON.stringify(restoredRow))

if (expectedDisabled) {
  check('重装后是「已禁用」——上一进程写的卸载覆盖项继续生效（fail-closed，用户点开关即恢复）', restoredRow?.checked === 'false', JSON.stringify(restoredRow?.tags))
} else {
  // 官方「立即启用」走 `setPluginEnabled`，会就地把那条 `disabled: true` 覆盖项改写成 false。
  check('重装后是「已启用」（官方「立即启用」就改写了同一条覆盖项）', restoredRow?.checked === 'true', JSON.stringify(restoredRow?.tags))
}

if (restoredRow !== undefined) {
  const flipped = await cdp.evaluate(clickSwitch(target))
  await sleep(2_500)
  const after = (await cdp.evaluate(READ_SECTION))?.rows.find((row) => row.name === target)
  check('开关能把它切回另一个状态（装回后仍然可用）', flipped !== null && after?.checked !== flipped, `${flipped} → ${after?.checked}`)
  const afterDisabled = await overrideDisabled()
  check('覆盖项跟随开关写入（启用写显式 disabled: false，不删条目）', afterDisabled === (after?.checked === 'false'),
    `checked=${String(after?.checked)} disabled=${String(afterDisabled)}`)
  if (after?.checked === 'false') {
    await cdp.evaluate(clickSwitch(target))
    await sleep(2_500)
  }
  await load(`${url}&e2e=${Date.now()}`)
  const graphAlive = await waitFor(async () => (await cdp.evaluate(bootGraphHasTarget)) === true, { timeoutMs: 30_000, intervalMs: 1_000 })
  check('最终是启用态：boot graph 里它的 client bundle 在（装回后确实活了）', graphAlive === true)
}

console.log(failures.length === 0 ? '\n全部通过' : `\n失败 ${failures.length} 项:\n${failures.join('\n')}`)
process.exit(failures.length === 0 ? 0 : 1)
