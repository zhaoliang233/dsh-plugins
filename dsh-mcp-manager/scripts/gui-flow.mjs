#!/usr/bin/env node
/**
 * 真机验收脚本：用 Chrome DevTools Protocol 在**真实 GUI** 里走一遍
 * 「打开设置 → 进分区 → 新增 → 填表 → 保存 → 启停 → 删除」，
 * 每一步都用宿主状态接口交叉核对，最后打印 JSON 报告；任何一步不符合预期就非零退出。
 *
 * 为什么需要它（而不是只靠 node --test）：客户端有一类缺陷纯函数测不出来——
 * 组件把状态置真却什么都没渲染（「+」按钮曾整个失效）、写完之后页面停在旧的对账结论、
 * 受控输入没接上。这些只有"真渲染 + 真点 + 真宿主"才会暴露。
 * 这两类缺陷都是本脚本在 0.1.0 开发期间实际抓到的。
 *
 * 前置：
 *   1. 一个**隔离**的宿主（不要用你正在用的那个）：`DSH_HOME=/tmp/xxx dsh --profile <装了本插件的 profile> --no-open --port 0`
 *   2. 可调试的无头 Chrome：
 *      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
 *        --remote-debugging-port=9333 --user-data-dir=/tmp/dsh-cdp-profile about:blank
 *
 * 用法：
 *   node scripts/gui-flow.mjs --url 'http://127.0.0.1:<port>/?token=<token>' --cdp-port 9333
 *
 * 只读约定：脚本只操作它自己新增的那条托管条目，结束时删除；
 * 不碰 profile 里手写的 MCP 行，也不碰其它插件的数据。
 */

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const url = option('url')
const cdpPort = Number(option('cdp-port', '9333'))
const fixtureArgs = option('fixture', new URL('./fixture-mcp-server.mjs', import.meta.url).pathname)
if (typeof url !== 'string' || !url.includes('token=')) {
  console.error('用法: node scripts/gui-flow.mjs --url <带 token 的 URL> [--cdp-port 9333]')
  process.exit(2)
}
const statusPort = Number(new URL(url).port)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const failures = []
const report = { steps: [], assertions: [] }

const check = (name, ok, detail) => {
  report.assertions.push({ name, ok, detail })
  if (!ok) failures.push(`${name}: ${detail ?? ''}`)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function hostStatus() {
  const response = await fetch(`http://127.0.0.1:${statusPort}/dsh-mcp-manager/status`, {
    headers: { 'x-dsh-mcp-manager-client': '1' }
  })
  return await response.json()
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
        const send = (method, params = {}) =>
          new Promise((resolve, reject) => {
            pending.set(next, { resolve, reject })
            socket.send(JSON.stringify({ id: next++, method, params }))
            setTimeout(() => {
              if (pending.delete(next - 1)) reject(new Error(`CDP timeout: ${method}`))
            }, 30000)
          })
        return {
          send,
          async evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
            if (result.exceptionDetails !== undefined) {
              throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`)
            }
            return result.result?.value
          }
        }
      }
    } catch {
      /* Chrome 还没起来 */
    }
    await sleep(250)
  }
  throw new Error('无法连接 CDP：Chrome 起了吗？--remote-debugging-port 对吗？')
}

/** 页内小工具：React 受控输入要走原生 setter + input 事件，直接改 .value 不触发 onChange。 */
const HELPERS = `
window.__gui = {
  click(selector, label) {
    const nodes = [...document.querySelectorAll(selector)]
    const text = (n) => (n.getAttribute('aria-label') ?? n.textContent ?? '').trim()
    // 先精确匹配：确认框的「删除」和行内垃圾桶的「删除 <名字>」都以「删除」开头，
    // 只按前缀匹配会再次点回垃圾桶、把确认框留着（本脚本踩过）。
    const exact = nodes.find((n) => text(n) === label)
    const target = label === undefined ? nodes[0] : exact ?? nodes.find((n) => text(n).startsWith(label))
    if (target === undefined) return { ok: false, candidates: nodes.map(text).slice(0, 30) }
    target.click()
    return { ok: true, label: text(target) }
  },
  fill(label, value) {
    // 弹窗通常 portal 到 body 上，所以不能把查找范围限定在 .dmm-section 里
    const field = [...document.querySelectorAll('.dmm-field')].find((f) => (f.querySelector('.dmm-label')?.textContent ?? '').includes(label))
    const input = field?.querySelector('input, textarea')
    if (input === null || input === undefined) return { ok: false, why: 'no field ' + label }
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  },
  /** 按 aria-label 填（行式编辑器里一行有多个输入，按字段标签找不到）。 */
  fillAria(label, value) {
    const input = [...document.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === label)
    if (input === undefined) return { ok: false, why: 'no aria ' + label }
    const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  },
  /** 凭据区：每一行的键名、状态标签、按钮状态。 */
  credentials() {
    return [...document.querySelectorAll('.dmm-cred-row')].map((row) => ({
      ref: row.querySelector('.dmm-cred-name')?.textContent ?? '',
      status: row.querySelector('.dmm-status')?.textContent ?? '',
      statusClass: row.querySelector('.dmm-status')?.className ?? '',
      saveDisabled: row.querySelector('button[aria-label^="保存凭据"]')?.disabled ?? null,
      clearDisabled: row.querySelector('button[aria-label^="清除凭据"]')?.disabled ?? null
    }))
  },
  /** 给某个凭据键填值（React 受控输入要走原生 setter + input 事件）。 */
  fillCredential(ref, value) {
    const row = [...document.querySelectorAll('.dmm-cred-row')].find(
      (node) => (node.querySelector('.dmm-cred-name')?.textContent ?? '') === ref
    )
    const input = row?.querySelector('input')
    if (input === null || input === undefined) return { ok: false, why: 'no credential row ' + ref }
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  },
  /** 只读块（配置文件里的服务器）的行：与可编辑的托管行分开取。 */
  targets() {
    return [...document.querySelectorAll('.dmm-target')].map((row) => ({
      name: row.querySelector('.dmm-target-name')?.textContent ?? '',
      badges: [...row.querySelectorAll('.dmm-badge')].map((b) => b.textContent),
      endpoint: row.querySelector('.dmm-target-endpoint')?.textContent ?? '',
      action: row.querySelector('button')?.textContent ?? ''
    }))
  },
  rows() {
    return [...document.querySelectorAll('.dmm-row')].map((row) => {
      const line = row.querySelector('.dmm-row-line')
      return {
        name: row.querySelector('.dmm-name')?.textContent ?? '',
        namespace: row.querySelector('.dmm-namespace')?.textContent ?? '',
        badges: [...row.querySelectorAll('.dmm-badge')].map((b) => b.textContent),
        state: row.querySelector('.dmm-status')?.textContent ?? '',
        lines: row.querySelectorAll('.dmm-row-line').length,
        height: Math.round(row.getBoundingClientRect().height),
        switchFirst: line?.firstElementChild?.classList.contains('dmm-switch') ?? false,
        actionsLast: line?.lastElementChild?.classList.contains('dmm-actions') ?? false,
        hasToolsLine: row.querySelector('.dmm-tools') !== null
      }
    })
  },
  /** 官方 Tooltip 的气泡 + 它在设置面板里的几何（用来断言"不超出面板"）。 */
  tooltip() {
    const bubble = document.querySelector('[role="tooltip"]')
    if (bubble === null) return null
    const panel = document.querySelector('.dmm-section')?.getBoundingClientRect()
    const rect = bubble.getBoundingClientRect()
    const names = [...bubble.querySelectorAll('.dmm-tip-name')].map((node) => node.textContent ?? '')
    return {
      names,
      text: (bubble.textContent ?? '').slice(0, 120),
      scrollTop: document.querySelector('.dmm-tip-list')?.scrollTop ?? -1,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      panelWidth: Math.round(panel?.width ?? 0),
      panelHeight: Math.round(panel?.height ?? 0),
      insidePanel:
        panel !== undefined &&
        rect.left >= panel.left - 2 &&
        rect.right <= panel.right + 2 &&
        rect.top >= panel.top - 2 &&
        rect.bottom <= panel.bottom + 2
    }
  },
  /** 弹窗里「服务器名」那行的几何：提示文案必须与 label 同一行。 */
  serverNameLabel() {
    const field = [...document.querySelectorAll('.dmm-field')].find((node) =>
      (node.querySelector('.dmm-label')?.textContent ?? '').includes('服务器名')
    )
    const label = field?.querySelector('.dmm-label')
    if (label === null || label === undefined) return null
    const rects = [...label.children].map((node) => node.getBoundingClientRect())
    return {
      text: (label.textContent ?? '').trim(),
      sameLine: rects.length > 0 && Math.max(...rects.map((rect) => rect.top)) - Math.min(...rects.map((rect) => rect.top)) < 6
    }
  },
  dialog() {
    // 用插件自己的 class 定位：设置面板本身也带 role=dialog，按 role 找会先命中它
    const dialog = document.querySelector('.dmm-dialog')
    const form = document.querySelector('.dmm-form')
    if (dialog === null || form === null) return null
    const title = (dialog.textContent ?? '').trim().slice(0, 40)
    // 只认弹窗底部那一个：凭据行里也有一个「保存」（保存这枚凭据的值）
    const footer = document.querySelector('.dmm-dialog-footer')
    const save = [...(footer?.querySelectorAll('button') ?? [])].find((b) => /^(保存|验证并保存中…)$/.test((b.textContent ?? '').trim()))
    return {
      title,
      hasVerifyButton: [...document.querySelectorAll('button')].some((b) => /^(验证|重新验证)$/.test((b.textContent ?? '').trim())),
      saveLabel: save?.textContent?.trim() ?? null,
      saveDisabled: save?.disabled ?? null,
      verification: (document.querySelector('.dmm-verify')?.textContent ?? '').trim()
    }
  },
  nav() {
    return [...document.querySelectorAll('nav button')].map((button) => ({
      label: (button.textContent ?? '').trim(),
      patched: button.hasAttribute('data-dmm-nav-icon'),
      originalIconDisplay: button.querySelector('svg') === null ? null : getComputedStyle(button.querySelector('svg')).display,
      pseudo: getComputedStyle(button, '::before').width
    }))
  }
}
`

const cdp = await connect()
await cdp.send('Runtime.enable')
await cdp.send('Page.enable')
await cdp.send('Page.navigate', { url })
await sleep(6000)

/**
 * 每次求值前都重新注入页内助手：客户端 bundle 改动会触发 client HMR 重载页面，
 * 一旦重载，先前注入的 `window.__gui` 就没了（脚本表现为 `__gui is not defined`）。
 * 幂等且很便宜，就别指望"注入一次管到底"。
 */
const evaluate = async (expression) => {
  await cdp.evaluate(HELPERS)
  return await cdp.evaluate(expression)
}

// 先关掉首启引导 / 配 API Key 弹层：它会盖住设置面板，悬停事件全落在它身上（排查时踩过）。
// 弹层文案随发布线变过（0.1.6 是「稍后配置」/「关闭」，0.1.7 的首启引导多了「继续」这一步），
// 所以这里**循环点到没有弹层为止**而不是只认某一版的文案：只认旧文案时弹层会留着，
// 后面所有基于真实鼠标事件的断言（悬停工具清单）就会假失败。
let dismissedLayers = 0
for (let step = 0; step < 8; step += 1) {
  const clicked = await evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((node) => node.offsetParent !== null)
    if (dialogs.length === 0) return null
    const dialog = dialogs[dialogs.length - 1]
    const buttons = [...dialog.querySelectorAll('button')].filter((node) => (node.textContent ?? '').trim() !== '')
    const target = buttons.find((node) => /继续|关闭|稍后|跳过|完成|知道/.test(node.textContent ?? '')) ?? buttons[buttons.length - 1]
    if (target === undefined) return null
    const label = (target.textContent ?? '').trim()
    target.click()
    return label
  })()`)
  if (clicked === null) break
  dismissedLayers += 1
  await sleep(800)
}
const layersLeft = await evaluate(`document.querySelectorAll('[role="dialog"]').length`)
check('首启弹层已关闭（否则真实鼠标事件全落在它身上）', layersLeft === 0, `dismissed=${dismissedLayers} left=${layersLeft}`)

// 打开设置 → MCP 服务器
await evaluate(`__gui.click('button', '设置')`)
await sleep(1500)
const nav = await evaluate(`__gui.nav()`)
const managed = nav.find((row) => row.label === 'MCP 服务器')
check('设置导航出现「MCP 服务器」且换成连接图标', managed?.patched === true && managed.originalIconDisplay === 'none' && managed.pseudo === '16px')
check('其它导航行未被误伤', nav.filter((row) => row.patched).length === 1)

await evaluate(`__gui.click('nav button', 'MCP 服务器')`)
await sleep(2000)
const initial = await evaluate(`({ rows: __gui.rows(), targets: __gui.targets(), text: document.querySelector('.dmm-section')?.textContent ?? '' })`)
report.steps.push({ name: '初始分区', ...initial })
check('分区渲染成功', initial.text.includes('MCP 服务器') && initial.text.includes('启用托管的所有服务器'))
check('只读块有独立标题，且文案不含实现细节', initial.text.includes('配置文件中的服务器') && !/profile|cordis\.patch\.yml|!!js/u.test(initial.text))
check('只读行给出端点与动作', initial.targets.every((row) => row.endpoint !== '' && row.action === '导入'))
check(
  '托管行只有一行（开关左 / 标题中 / 操作右，工具说明不在行里）',
  initial.rows.every((row) => row.lines === 1 && row.switchFirst && row.actionsLast && row.hasToolsLine === false && row.height < 60),
  JSON.stringify(initial.rows.slice(0, 2))
)

// 导入：必须把真实配置带进弹窗（URL / 命令 / 普通字段），但敏感值只能在凭据库里
const serversBeforeImport = (await hostStatus()).servers.length
await evaluate(`__gui.click('button', '导入')`)
await sleep(2500)
const imported = await evaluate(`__gui.dialog()`)
const importedValues = await evaluate(`(() => {
  const read = (label) => {
    const field = [...document.querySelectorAll('.dmm-field')].find((f) => (f.querySelector('.dmm-label')?.textContent ?? '').includes(label))
    return field?.querySelector('input, textarea')?.value ?? null
  }
  const byAria = (label) => [...document.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === label)?.value ?? null
  return {
    label: read('备注名'),
    serverName: read('服务器名'),
    url: read('URL'),
    // 行式编辑器：敏感请求头导入后是「名字 + 凭据键名」两个输入框，不再是待维护的文本行
    headerName: byAria('请求头第 1 行名字'),
    headerKey: byAria('请求头第 1 行凭据键名'),
    pageText: (document.querySelector('.dmm-dialog')?.textContent ?? '')
  }
})()`)
report.steps.push({ name: '导入弹窗', ...imported, ...{ url: importedValues.url } })
check('导入打开了弹窗', imported !== null && imported.title.includes('新增'))
check('导入带上了备注名与服务器名', String(importedValues.label).includes('导入自配置文件') && importedValues.serverName === (initial.targets[0]?.name ?? importedValues.serverName))
check('导入说明了敏感值的去向', /凭据库/u.test(importedValues.pageText))
check('页面上不出现明文密钥', !/SHOULD-NOT-LEAK|Bearer\s+[A-Za-z0-9+/=]{8}/u.test(importedValues.pageText), 'url 里的 token 与 Authorization 的值都不得渲染出来')
check('导入只填表单、不落盘（保存时才会自动验证）', imported !== null && (await hostStatus()).servers.length === serversBeforeImport)
check(
  '导入的敏感请求头是「名字 + 凭据键名」，不是让用户维护的文本行',
  importedValues.headerName === 'Authorization' && importedValues.headerKey === 'MCP_PATCHY2_HEADERS_AUTHORIZATION',
  JSON.stringify({ name: importedValues.headerName, key: importedValues.headerKey })
)

// 凭据交互：导入的敏感地址本来就是「凭据」形态；开关能双向切换，键名可以自己取
const urlMode = await evaluate(`(() => {
  const input = document.querySelector('[aria-label="URL凭据键名"]')
  return input === null
    ? null
    : { key: input.value, pressed: document.querySelector('[aria-label="URL 引用凭据"]')?.getAttribute('aria-pressed') }
})()`)
report.steps.push({ name: 'URL 凭据形态', ...(urlMode ?? {}) })
check('导入的敏感地址是「凭据」形态（给的是键名输入框，不是让用户维护的地址文本）', urlMode !== null && urlMode.pressed === 'true' && urlMode.key !== '', JSON.stringify(urlMode))
await evaluate(`__gui.click('button', 'URL 引用凭据')`)
await sleep(300)
const toggledOff = await evaluate(`document.querySelector('[aria-label="URL凭据键名"]') === null && document.querySelector('[aria-label="URL"]') !== null`)
check('再点一下「凭据」就回到直接填写地址', toggledOff === true)
await evaluate(`__gui.click('button', 'URL 引用凭据')`)
await sleep(300)
await evaluate(`__gui.fillAria('URL前缀', 'https://mcp.example.com/v2/mcp?token=')`)
await evaluate(`__gui.fillAria('URL凭据键名', 'URL_TOK')`)
await sleep(400)
const credNames = await evaluate(`[...document.querySelectorAll('.dmm-cred-name')].map((node) => node.textContent ?? '')`)
report.steps.push({ name: '凭据区', credNames })
check('自己取的键名会出现在凭据区（值在这里填）', credNames.some((text) => text.includes('URL_TOK')), JSON.stringify(credNames))
// 尺寸与对齐：小按钮 28px（与 dsh-extra-context 的「+ 添加规则」一致），
// 凭据区的按钮与输入框同一行且垂直居中；"未配置"是状态标签
const geometry = await evaluate(`(() => {
  const rect = (node) => (node === null || node === undefined ? null : node.getBoundingClientRect())
  const addBtn = rect(document.querySelector('.dmm-pair-add'))
  const bar = document.querySelector('.dmm-cred-input-row')
  const input = rect(bar?.querySelector('input'))
  const save = rect(bar?.querySelector('button'))
  const chip = [...document.querySelectorAll('.dmm-cred-head .dmm-status')].map((node) => node.textContent)
  return {
    addHeight: addBtn === null ? null : Math.round(addBtn.height),
    // 高度不同（输入框 34 / 按钮 28），所以按"垂直中心对齐 + 纵向重叠"判断是不是同一行
    sameLine: input !== null && save !== null && input.top < save.bottom && save.top < input.bottom,
    centerDelta: input !== null && save !== null ? Math.round(Math.abs((input.top + input.height / 2) - (save.top + save.height / 2))) : null,
    saveHeight: save === null ? null : Math.round(save.height),
    chip
  }
})()`)
report.steps.push({ name: '凭据区几何', ...geometry })
check('「+ 添加请求头」是小按钮（28px，与额外上下文的添加规则同尺寸）', geometry.addHeight === 28, JSON.stringify(geometry))
check('凭据的保存按钮与输入框同一行、垂直居中', geometry.sameLine === true && geometry.centerDelta !== null && geometry.centerDelta <= 1, JSON.stringify(geometry))
// 断言"状态是标签"这一**形态**，而不是"至少有一条是未配置"：后者取决于凭据库里有没有
// 上一次运行写下的值（脚本自己不清理凭据），第二次运行必假失败。产品要求是标签形态。
check(
  '凭据状态是标签（未配置 / 已配置 · 来源）而不是一句说明',
  geometry.chip.length > 0 && geometry.chip.every((text) => /^(未配置|已配置)/u.test(text)),
  JSON.stringify(geometry.chip)
)

// 请求头是「多行卡片」：键名占满整行（看得全）、前缀是自绘箭头的下拉（居中、与输入框同高）、
// 选「其它」时自定义输入不窄
const headerGeom = await evaluate(`(() => {
  const rect = (node) => (node === null || node === undefined ? null : node.getBoundingClientRect())
  const keyInput = rect(document.querySelector('[aria-label="请求头第 1 行凭据键名"]'))
  const select = document.querySelector('[aria-label="请求头第 1 行前缀"]')
  const selectRect = rect(select)
  const caret = rect(document.querySelector('.dmm-select-caret'))
  const nameRect = rect(document.querySelector('[aria-label="请求头第 1 行名字"]'))
  const keyInputNode = document.querySelector('[aria-label="请求头第 1 行凭据键名"]')
  const keyInputRect = rect(keyInputNode)
  // 同一组字段共享标签列：所有输入框左边缘必须对齐（早先每行各自成 grid，输入框一个个错开）
  const lefts = [...document.querySelectorAll('.dmm-pair .dmm-field-ctl > .dmm-input, .dmm-pair .dmm-field-ctl > .dmm-select-wrap')].map(
    (node) => Math.round(node.getBoundingClientRect().left)
  )
  return {
    keyWidth: keyInput === null ? null : Math.round(keyInput.width),
    inputHeight: keyInput === null ? null : Math.round(keyInput.height),
    selectHeight: selectRect === null ? null : Math.round(selectRect.height),
    caretInside: caret !== null && selectRect !== null && caret.right <= selectRect.right && caret.left >= selectRect.left,
    caretCentered: caret !== null && selectRect !== null ? Math.round(Math.abs((caret.top + caret.height / 2) - (selectRect.top + selectRect.height / 2))) : null,
    stacked: nameRect !== null && keyInputRect !== null && keyInputRect.top >= nameRect.bottom - 1,
    alignedLefts: [...new Set(lefts)].length
  }
})()`)
report.steps.push({ name: '请求头卡片几何', ...headerGeom })
check('凭据键名占满整行（长键名看得全）', (headerGeom.keyWidth ?? 0) >= 240, JSON.stringify(headerGeom))
check('前缀下拉与输入框同高、箭头在框内且垂直居中', headerGeom.selectHeight === headerGeom.inputHeight && headerGeom.caretInside === true && headerGeom.caretCentered <= 1, JSON.stringify(headerGeom))
check('字段是逐行铺开的（名字下面是字段行，不是挤在同一行）', headerGeom.stacked === true, JSON.stringify(headerGeom))
check('同一组字段的输入框左边缘对齐（标签列同宽）', headerGeom.alignedLefts === 1, JSON.stringify(headerGeom))

const customWidth = await evaluate(`(() => {
  const select = document.querySelector('[aria-label="请求头第 1 行前缀"]')
  if (select === null) return null
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
  setter.call(select, '__custom__')
  select.dispatchEvent(new Event('change', { bubbles: true }))
  const custom = document.querySelector('[aria-label="请求头第 1 行前缀（自定义）"]')
  return custom === null ? null : Math.round(custom.getBoundingClientRect().width)
})()`)
await sleep(300)
const customWidthAfter = await evaluate(`(() => {
  const custom = document.querySelector('[aria-label="请求头第 1 行前缀（自定义）"]')
  return custom === null ? null : Math.round(custom.getBoundingClientRect().width)
})()`)
report.steps.push({ name: '自定义前缀宽度', width: customWidthAfter ?? customWidth })
check('选「其它」后的自定义前缀输入框有足够宽度（可以正常输入）', (customWidthAfter ?? customWidth ?? 0) >= 200, `width=${String(customWidthAfter ?? customWidth)}`)

// 凭据写入：填值 → 点该行的「保存」→ 宿主侧的凭据状态真的变成已配置、页面上不出现明文
const refToSave = await evaluate(`(() => {
  const row = document.querySelector('.dmm-cred-row')
  return row === null ? null : { ref: row.querySelector('.dmm-cred-name')?.textContent ?? '', status: row.querySelector('.dmm-status')?.textContent ?? '' }
})()`)
if (refToSave === null) {
  check('凭据区可以保存值', false, '弹窗里没有凭据行')
} else {
  const filled = await evaluate(`__gui.fillCredential(${JSON.stringify(refToSave.ref)}, 'gui-flow-secret')`)
  await sleep(400)
  const enabledBefore = await evaluate(`__gui.credentials().find((row) => row.ref === ${JSON.stringify(refToSave.ref)})?.saveDisabled === false`)
  await evaluate(`__gui.click('button', ${JSON.stringify(`保存凭据 ${refToSave.ref}`)})`)
  await sleep(2500)
  const afterSave = await evaluate(`__gui.credentials().find((row) => row.ref === ${JSON.stringify(refToSave.ref)})`)
  report.steps.push({ name: '凭据保存', ref: refToSave.ref, filled, enabledBefore, after: afterSave })
  check('填了值之后「保存」不再是灰的', filled.ok === true && enabledBefore === true, JSON.stringify({ filled, enabledBefore }))
  check('保存后状态变成「已配置」', afterSave !== undefined && afterSave.status.includes('已配置'), JSON.stringify(afterSave))
  check('页面上不出现凭据明文', (await evaluate(`document.querySelector('.dmm-dialog')?.textContent?.includes('gui-flow-secret') ?? false`)) === false)
}
const urlSplit = await evaluate(`({ prefix: document.querySelector('[aria-label="URL前缀"]')?.value ?? null, key: document.querySelector('[aria-label="URL凭据键名"]')?.value ?? null })`)
check('地址前缀保持可见、密钥只留键名', urlSplit.prefix === 'https://mcp.example.com/v2/mcp?token=' && urlSplit.key === 'URL_TOK', JSON.stringify(urlSplit))
await evaluate(`__gui.click('button', '取消')`)
await sleep(800)

// 新增：先弹窗（不落盘）→ 填表 → 验证 → 保存
const name = `guiflow${Date.now().toString(16).slice(-5)}`
const rowsBefore = (await evaluate(`__gui.rows()`)).length
await evaluate(`__gui.click('button', '新增服务器')`)
await sleep(1200)
const opened = await evaluate(`__gui.dialog()`)
report.steps.push({ name: '新增弹窗', ...(opened ?? {}) })
check('点「+」打开弹窗表单', opened !== null && opened.title.includes('新增'))
check('弹窗只有「保存」一个动作（保存时自动验证）', opened !== null && opened.hasVerifyButton === false && opened.saveDisabled === false)
const rowsWhileOpen = (await evaluate(`__gui.rows()`)).length
const hostWhileOpen = await hostStatus()
check('打开弹窗不写设置（不会先落一条空条目）', rowsWhileOpen === rowsBefore && hostWhileOpen.servers.length === rowsBefore)

// 表单文案：提示与 label 同一行，不再单独占一行
const nameLabel = await evaluate(`__gui.serverNameLabel()`)
report.steps.push({ name: '服务器名 label', ...(nameLabel ?? {}) })
check(
  '「服务器名 * (工具前缀为 mcp__<名字>__)」与 label 同一行',
  nameLabel !== null && /^服务器名\s*\*\s*\(工具前缀为 mcp__<名字>__\)$/u.test(nameLabel.text) && nameLabel.sameLine === true,
  JSON.stringify(nameLabel)
)

// 故意先填一个连不上的命令：点保存会自动验证，失败就不落盘
await evaluate(`__gui.fill('服务器名', '${name}bad')`)
await evaluate(`__gui.fill('命令', '/nonexistent-mcp-command')`)
await evaluate(`__gui.click('button', '保存')`)
await sleep(7000)
const failed = await evaluate(`__gui.dialog()`)
report.steps.push({ name: '保存即验证（失败）', ...(failed ?? {}) })
check('保存时自动验证，失败就地显示原因', failed !== null && failed.verification.includes('验证失败'))
check('验证失败不落盘、弹窗留在原地', failed !== null && (await hostStatus()).servers.length === rowsBefore)
await evaluate(`__gui.click('button', '取消')`)
await sleep(800)

// 再来一次：填本地 fixture 服务器，验证通过后保存
await evaluate(`__gui.click('button', '新增服务器')`)
await sleep(1200)
check('能填入服务器名', (await evaluate(`__gui.fill('服务器名', '${name}')`)).ok === true)
await evaluate(`__gui.fill('命令', ${JSON.stringify(process.execPath)})`)
await evaluate(`__gui.fill('参数（每行一个）', ${JSON.stringify(fixtureArgs)})`)
await evaluate(`__gui.click('button', '保存')`)
await sleep(9000)
const verified = await evaluate(`__gui.dialog()`)
report.steps.push({ name: '保存即验证（通过）', ...(verified ?? {}) })
check('验证通过后弹窗关闭、配置落盘', verified === null)

const afterSave = await hostStatus()
const saved = afterSave.servers.find((server) => server.serverName === name)
report.steps.push({ name: '保存后宿主', server: saved === undefined ? null : { name: saved.serverName, blocked: saved.blockedReason, live: saved.live?.state, tools: (saved.live?.tools ?? []).length } })
check('保存后宿主已挂载', saved?.live?.state === 'mounted', `live=${String(saved?.live?.state)} blocked=${String(saved?.blockedReason)}`)
check('挂载后拿到工具', (saved?.live?.tools ?? []).length > 0, `tools=${(saved?.live?.tools ?? []).length}`)
const rendered = await evaluate(`__gui.rows()`)
const row = rendered.find((item) => item.name === name)
check('界面上该行显示最新状态（不是旧的对账结论）', row !== undefined && row.state.includes('已连接'), `state=${String(row?.state)}`)
check('行上不出现旧原因', row !== undefined && !row.state.includes('必须填写'), `state=${String(row?.state)}`)
check('这一行也只有一行（开关左 / 标题中 / 操作右）', row !== undefined && row.lines === 1 && row.switchFirst && row.actionsLast && row.hasToolsLine === false && row.height < 60, JSON.stringify(row))

// 悬停「已连接 · N 个工具」这个 tag：官方 Tooltip 的气泡 = 完整工具清单
const tipTarget = await evaluate(`(() => {
  const tag = [...document.querySelectorAll('.dmm-status')].find((node) => (node.textContent ?? '').includes('已连接'))
  if (tag === undefined) return null
  const rect = tag.getBoundingClientRect()
  return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), text: tag.textContent }
})()`)
if (tipTarget === null) {
  check('悬停状态 tag 弹出工具浮层', false, '页面上没有「已连接」的 tag')
} else {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 })
  await sleep(150)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipTarget.x, y: tipTarget.y, buttons: 0 })
  await sleep(600)
  const tip = await evaluate(`__gui.tooltip()`)
  report.steps.push({ name: '悬停状态 tag', tip: tip === null ? null : { ...tip, names: tip.names.length } })
  check(
    '悬停「已连接 · N 个工具」弹出完整清单（全名 + 只有一个浮层）',
    tip !== null && tip.names.length >= 10 && tip.names.every((item) => item.startsWith('mcp__')) && (await evaluate(`document.querySelectorAll('[role="tooltip"]').length`)) === 1,
    tip === null ? '没有浮层' : `names=${tip.names.length} first=${String(tip.names[0])}`
  )
  check(
    '浮层宽高都不超出设置面板',
    tip !== null && tip.insidePanel && tip.width <= tip.panelWidth && tip.height <= tip.panelHeight,
    tip === null ? '没有浮层' : `size=${tip.width}x${tip.height} panel=${tip.panelWidth}x${tip.panelHeight} inside=${tip.insidePanel}`
  )
  check('清单溢出时提示可滚动', tip !== null && tip.text.includes('滚轮滚动'), `text=${String(tip?.text).slice(0, 60)}`)

  // 滚动：官方气泡是 pointer-events:none 且鼠标离开锚点即关，所以滚轮由 tag 转发给清单
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: tipTarget.x, y: tipTarget.y, deltaX: 0, deltaY: 300, buttons: 0 })
  await sleep(400)
  const scrolled = await evaluate(`__gui.tooltip()`)
  report.steps.push({ name: '浮层内滚动', scrollTop: scrolled?.scrollTop ?? null })
  check('浮层内可以滚动（滚轮落在 tag 上，清单跟着滚）', (scrolled?.scrollTop ?? 0) > 0, `scrollTop=${String(scrolled?.scrollTop)}`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, buttons: 0 })
  await sleep(200)
  check('移开鼠标后浮层消失', (await evaluate(`document.querySelector('[role="tooltip"]') === null`)) === true)
}

// 编辑：同一个弹窗，改备注名后重新验证再保存
await evaluate(`__gui.click('button', '编辑 ${name}')`)
await sleep(1200)
const editing = await evaluate(`__gui.dialog()`)
check('编辑走同一个弹窗且预填', editing !== null && editing.title.includes('编辑') && editing.hasVerifyButton === false)
await evaluate(`__gui.fill('备注名', '自检改名')`)
await evaluate(`__gui.click('button', '保存')`)
await sleep(9000)
const renamed = (await evaluate(`__gui.rows()`)).find((row) => row.name === '自检改名')
check('编辑保存生效（行上显示新备注名）', renamed !== undefined)

// 停用 → 卸载
await evaluate(`__gui.click('.dmm-switch', '停用 ${name}')`)
await sleep(6000)
const afterDisable = await hostStatus()
const disabled = afterDisable.servers.find((server) => server.serverName === name)
check('停用后宿主卸载', disabled !== undefined && disabled.live === null, `live=${String(disabled?.live)}`)
check('宿主仍保留该条目（只是停用）', disabled !== undefined)

// 删除 → 清理
await evaluate(`__gui.click('button', '删除 ${name}')`)
await sleep(1200)
await evaluate(`__gui.click('button', '删除')`)
await sleep(6000)
const afterDelete = await hostStatus()
check('删除后宿主清单里没有它', afterDelete.servers.every((server) => server.serverName !== name), `remaining=${afterDelete.servers.length}`)
const targetsAfter = await evaluate(`__gui.targets()`)
check('配置文件里的条目未被触碰', afterDelete.profileTargets.length === initial.targets.length && targetsAfter.length === initial.targets.length, `profileTargets=${afterDelete.profileTargets.length} 界面行=${targetsAfter.length}`)

console.log('\n===== 报告 =====')
console.log(JSON.stringify(report, null, 2))
if (failures.length > 0) {
  console.error(`\n失败 ${failures.length} 项：\n - ${failures.join('\n - ')}`)
  process.exit(1)
}
console.log('\n全部通过。')
process.exit(0)
