/**
 * dsh-mcp-manager 客户端半体（单文件 CJS 惰性 bundle，无构建步骤）。
 *
 * 职责：设置页「MCP 服务器」分区——列表、编辑、启停、状态、凭据、以及
 * 把 profile 组合里已有的 MCP 条目导入到托管清单。
 *
 * 数据流（三条各自独立）：
 * 1. 清单真相 = settings 命名空间 `mcp-manager`，经 `ctx.settingsScope` 读写
 *    （带 revision 栅栏，写入即触发宿主对账）；
 * 2. 运行态（是否挂载、工具、最近日志、与组合层重名）来自宿主状态路由；
 * 3. 凭据值经 `ctx.remote.credentials` 写进 credentials 存储，
 *    settings 里只留 `credential:KEY` 占位符。
 */

window.__ModuleLoader__.load({
  id: 'dsh-mcp-manager',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    /**
     * 取一个官方图标，按**能力**而不是按 DSH 版本号：图标名在发布线之间改过名
     * （0.1.6 是数字档位 `IconSearchOutline16`，0.1.7 换成档位词
     * `IconSearchOutlineMedium`；同名同几何，只是命名法变了），所以按顺序取第一个
     * 真实存在的导出。全都缺失时退化成不渲染任何东西的空组件，绝不让整个 bundle
     * 因为一个图标名消失而挂掉。
     * @param names - 候选导出名，从最新命名往后排。
     */
    function iconOf(...names) {
      for (const name of names) {
        const candidate = primitives?.[name]
        if (typeof candidate === 'function' || (candidate !== null && typeof candidate === 'object')) return candidate
      }
      return () => null
    }
    const IconChevronDownOutline14 = iconOf('IconChevronDownOutlineMedium', 'IconChevronDownOutlineRegular', 'IconChevronDownOutline14')
    const IconCodeOutline16 = iconOf('IconCodeOutlineMedium', 'IconCodeOutlineRegular', 'IconCodeOutline16')
    const IconEditOutline16 = iconOf('IconEditOutlineMedium', 'IconEditOutlineRegular', 'IconEditOutline16')
    const IconLinkOutline16 = iconOf('IconLinkOutlineMedium', 'IconLinkOutlineRegular', 'IconLinkOutline16')
    const IconLoadingOutline16 = iconOf('IconLoadingOutlineMedium', 'IconLoadingOutlineRegular', 'IconLoadingOutline16')
    const IconPlusOutline16 = iconOf('IconPlusOutlineMedium', 'IconPlusOutlineRegular', 'IconPlusOutline16')
    const IconRefreshOutline16 = iconOf('IconRefreshOutlineMedium', 'IconRefreshOutlineRegular', 'IconRefreshOutline16')
    const IconTrashOutline16 = iconOf('IconTrashOutlineMedium', 'IconTrashOutlineRegular', 'IconTrashOutline16')
    const { Modal, Tooltip } = primitives

    const PLUGIN_ID = 'dsh-mcp-manager'
    const SETTINGS_NAMESPACE = 'mcp-manager'
    const STATUS_PATH = '/dsh-mcp-manager/status'
    const ACTION_PATH = '/dsh-mcp-manager/action'
    const CLIENT_HEADER = 'x-dsh-mcp-manager-client'
    const CSRF_HEADER = 'x-dsh-mcp-manager-csrf'
    const SECTION_ID = 'mcp-manager'
    const SECTION_LABEL = 'MCP 服务器'
    /**
     * 设置分区 order。DSH 自带分区是 general 0 / models 10 / plugins 15 /
     * agent-presets 20 / archived-sessions 25，**插件分区一律 ≥ 100**：排在内置之后，
     * 不插队、也不与内置并列（并列时只能靠注册顺序决胜）。
     */
    const SECTION_ORDER = 110
    const NAV_ICON_ID = 'mcp-manager-nav-icon'
    const STYLE_OWNER = `${PLUGIN_ID}-v1`
    const CREDENTIAL_TOKEN = /credential:([A-Za-z_][A-Za-z0-9_]*)/gu
    /** 存在设置里的占位符前缀；界面不暴露它，用户看到的是「凭据」开关 + 键名。 */
    const CREDENTIAL_PREFIX = 'credential:'
    const NAV_PATCH_FLAG = 'dmmNavIcon'
    const NAV_PATCH_COUNT = 'dmmNavIconReferences'
    const NAV_PATCH_MASK = '--dmm-nav-icon-mask'

    const styleText = `
.dmm-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}
.dmm-heading{display:flex;align-items:center;gap:8px;min-height:32px}
.dmm-title{min-width:0;margin:0;font-size:16px;font-weight:500;line-height:24px;letter-spacing:0}
.dmm-count{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dmm-heading-spacer{flex:1}
.dmm-icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dmm-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dmm-icon-button.danger{color:var(--dsw-alias-state-error-primary)}
.dmm-icon-button:disabled{opacity:.42;cursor:not-allowed;background:transparent}
.dmm-notice,.dmm-error{margin:0;padding:9px 11px;border-radius:6px;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.dmm-notice{display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dmm-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dmm-list{display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dmm-row{display:flex;flex-direction:column;min-width:0;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dmm-row-line{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;min-width:0}
.dmm-title-block{display:flex;align-items:center;gap:7px;min-width:0}
/* 挂了 tooltip 的标题区：盒子照样铺满（气泡以它的中线居中，才不会探出面板），
   但整块不吃指针事件，只有那枚 tag 自己能悬停——触发区仍然只是 tag。 */
.dmm-title-block.tip{pointer-events:none}
.dmm-title-block.tip>.dmm-tip-trigger{pointer-events:auto}
.dmm-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:22px}
.dmm-badge{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;white-space:nowrap}
.dmm-badge.warn{color:var(--dsw-alias-state-warn-primary)}
.dmm-badge.off{color:var(--dsw-alias-label-tertiary)}
.dmm-meta{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dmm-endpoint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmm-namespace{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
.dmm-status{flex:none;padding:1px 7px;border-radius:5px;font-size:11px;line-height:17px;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-secondary)}
.dmm-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dmm-status.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dmm-status.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dmm-live-logs>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmm-live-logs[open]>summary{margin-bottom:6px}
/* 工具清单浮层的内容：官方 Tooltip 的气泡只负责底色/圆角，换行与滚动由这一层负责
   （气泡是 white-space:pre-line 且 pointer-events:none，尺寸必须自己约束）。 */
.dmm-tip-content{box-sizing:border-box;display:flex;flex-direction:column;gap:5px;min-width:0;padding:6px 7px;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:18px}
.dmm-tip-head{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dmm-tip-list{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.dmm-tip-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.dmm-actions{display:flex;align-items:center;gap:7px;flex:none}
.dmm-switch{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;flex:none;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background-color .15s ease}
.dmm-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.dmm-switch::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .15s ease}
.dmm-switch[aria-checked=true]::after{transform:translateX(16px)}
.dmm-switch:disabled{opacity:.42;cursor:not-allowed}
.dmm-editor{display:flex;flex-direction:column;gap:10px;margin-top:11px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dmm-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dmm-field-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;min-width:0}
.dmm-label{display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmm-label-note{color:var(--dsw-alias-label-tertiary)}
.dmm-required{color:var(--dsw-alias-state-error-primary)}
.dmm-input,.dmm-textarea{width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dmm-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:19px}
.dmm-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
/* 行式键值编辑器（环境变量 / 请求头）：一行一张小卡片，字段逐行铺开，
   这样长键名、长地址都不会被截断（早先五个输入框挤一行，用户截图反馈看不全）。 */
.dmm-pairs{display:flex;flex-direction:column;gap:9px;min-width:0}
.dmm-pair{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.dmm-pair-head{display:flex;align-items:center;gap:8px;min-width:0}
.dmm-pair-name{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dmm-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:8px 10px;min-width:0}
.dmm-field-line{display:contents}
.dmm-field-key{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;text-align:right}
.dmm-field-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dmm-field-ctl>.dmm-input{flex:1 1 160px;min-width:0}
.dmm-select-wrap{position:relative;display:inline-flex;flex:none}
.dmm-select{box-sizing:border-box;height:34px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;-webkit-appearance:none;appearance:none}
.dmm-select-caret{position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--dsw-alias-label-secondary)}
.dmm-key-hints{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 100%;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dmm-key-hints>.dmm-chip-button{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dmm-label-line{display:flex;align-items:center;gap:6px}
.dmm-label-spacer{flex:1 1 auto}
/* 小按钮：与 dsh-extra-context 的「+ 添加规则」同尺寸（28px / 12px 字号），
   这样输入框旁边的小按钮和整行高度对得上，不会一高一低。 */
.dmm-btn-sm{flex:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dmm-btn-sm:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dmm-btn-sm:disabled{opacity:.45;cursor:default}
.dmm-icon-button.sm{width:26px;height:26px}
.dmm-value-prefix-group{display:flex;align-items:center;gap:6px;flex:1 1 42%;min-width:0}
.dmm-value-prefix-mode{flex:none;width:auto;min-width:104px;padding:6px 6px;font-size:12px}
.dmm-chip-button{flex:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dmm-chip-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dmm-chip-button.on{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-label-primary)}
.dmm-pair-add{align-self:flex-start;color:var(--dsw-alias-label-secondary)}
.dmm-hint-error{color:var(--dsw-alias-state-error-primary)}
.dmm-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dmm-button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.dmm-button.primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
.dmm-button.danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:white}
.dmm-button:disabled{opacity:.5;cursor:not-allowed}
.dmm-radio-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dmm-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;cursor:pointer}
.dmm-checkline{display:flex;align-items:baseline;gap:7px;font-size:13px;line-height:20px;cursor:pointer}
.dmm-checkline>input{flex:none;align-self:center}
.dmm-checkline .dmm-hint{font-size:12px}
.dmm-cred{display:flex;flex-direction:column;gap:9px;padding:9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2)}
.dmm-cred-row{display:flex;flex-direction:column;gap:6px;min-width:0}
.dmm-cred-head{display:flex;align-items:center;gap:7px;min-width:0}
.dmm-cred-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dmm-cred-input-row{display:flex;align-items:center;gap:8px;min-width:0}
.dmm-cred-input{flex:1 1 auto;min-width:0}
.dmm-targets{display:flex;flex-direction:column;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 5%,transparent);overflow:hidden}
.dmm-targets-head{display:flex;align-items:center;gap:8px;padding:10px 12px}
.dmm-targets-title{min-width:0;margin:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}
.dmm-targets-hint{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.dmm-target{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l2)}
.dmm-target-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dmm-target-name-line{display:flex;align-items:center;gap:7px;min-width:0}
.dmm-target-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px}
.dmm-target-endpoint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmm-target-fields{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmm-nav-icon-template{display:none}
[data-dmm-nav-icon]>svg:first-child{display:none}
[data-dmm-nav-icon]::before{content:"";flex:none;width:16px;height:16px;background:currentColor;pointer-events:none;-webkit-mask:var(--dmm-nav-icon-mask) center/16px 16px no-repeat;mask:var(--dmm-nav-icon-mask) center/16px 16px no-repeat}
.dmm-empty,.dmm-loading{padding:30px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dmm-loading{display:flex;align-items:center;justify-content:center;gap:8px}
.dmm-dialog{width:min(560px,calc(100vw - 32px));border-radius:8px}
.dmm-dialog .dmm-field,.dmm-dialog .dmm-field-row,.dmm-dialog .dmm-editor{margin:0;padding:0;background:transparent}
.dmm-form{display:flex;flex-direction:column;gap:10px;min-width:0;max-height:min(72vh,640px);overflow:auto}
.dmm-dialog-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dmm-dialog-inline{margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;flex-direction:column;gap:10px}
.dmm-dialog-title{font-size:14px;font-weight:500;line-height:22px}
.dmm-notes{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmm-verify{display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmm-verify.ok{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-label-primary)}
.dmm-verify.failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.dmm-verify.stale{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dmm-confirm{display:flex;flex-direction:column;gap:8px;min-width:0}
.dmm-log{max-height:132px;overflow:auto;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:600px){.dmm-row-line{grid-template-columns:auto minmax(0,1fr)}.dmm-row-line .dmm-actions{grid-column:2;justify-content:flex-start}.dmm-target{grid-template-columns:minmax(0,1fr)}.dmm-targets-hint{white-space:normal}}
`

    // ── 纯函数区（可在 node --test 下独立验证）────────────────────────────

    /** 把任意值收敛成可安全渲染的字符串。 */
    function asText(value) {
      return typeof value === 'string' ? value : ''
    }

    /** 设置快照解码：任何缺字段都补默认值，绝不抛错。 */
    function decodeSettings(section) {
      const source = section !== null && typeof section === 'object' ? section : {}
      return {
        enabled: source.enabled !== false,
        servers: Array.isArray(source.servers) ? source.servers.map(normalizeServer) : []
      }
    }

    /** 单个条目规范化（字段与宿主 store.normalizeServer 对齐）。 */
    function normalizeServer(raw) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const transport = source.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
      const timeout = Number(source.toolCallTimeoutMs)
      return {
        id: asText(source.id),
        label: asText(source.label),
        enabled: source.enabled !== false,
        transport,
        serverName: asText(source.serverName),
        command: asText(source.command),
        args: Array.isArray(source.args) ? source.args.filter((item) => typeof item === 'string') : [],
        cwd: asText(source.cwd),
        env: asRecord(source.env),
        url: asText(source.url),
        headers: asRecord(source.headers),
        toolCallTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 60000,
        failOnStartupError: source.failOnStartupError === true
      }
    }

    function asRecord(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
      const out = {}
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') out[key] = entry
      }
      return out
    }

    /** 把「每行一个参数」的文本转成数组（忽略空行）。 */
    function parseArgs(text) {
      return String(text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    }

    /**
     * 把 `KEY=value`（env）或 `Header: value`（headers）文本解析成对象。
     * 分隔符用第一个出现的分隔符，值里可以再出现分隔符。
     */
    function parsePairs(text, separator) {
      const out = {}
      for (const rawLine of String(text ?? '').split('\n')) {
        const line = rawLine.trim()
        if (line === '' || line.startsWith('#')) continue
        const index = line.indexOf(separator)
        if (index <= 0) continue
        const key = line.slice(0, index).trim()
        const value = line.slice(index + separator.length).trim()
        if (key === '') continue
        out[key] = value
      }
      return out
    }

    /** 反向格式化，供编辑器回显。 */
    function formatPairs(record, separator) {
      return Object.entries(record ?? {})
        .map(([key, value]) => (separator === '=' ? `${key}=${value}` : `${key}: ${value}`))
        .join('\n')
    }

    /**
     * 设置里的 env/headers 是 `Record<string,string>`，编辑器用「一行一条」编辑。
     * 行模型刻意不做文本往返：用户在空名字的行里打字时不能被解析规则吞掉。
     */
    function recordToRows(record) {
      return Object.entries(record ?? {}).map(([name, value]) => ({ name, value: String(value ?? '') }))
    }

    /** 反向：空名字的行不写进设置（还没填完的行不该变成脏数据）。 */
    function rowsToRecord(rows) {
      const out = {}
      for (const row of rows ?? []) {
        const name = String(row?.name ?? '').trim()
        if (name === '') continue
        out[name] = String(row?.value ?? '')
      }
      return out
    }

    /**
     * 把一个值拆成「前缀 + 凭据键 + 后缀」；值里没有 `credential:` 时返回 null（= 直接填写）。
     *
     * 凭据键仍以 `credential:<键名>` 存进设置（settings 里只能放字符串），但**用户不必知道这个写法**：
     * 界面上是一个「凭据」开关 + 键名输入框（键名可以自己取，也可以从用过的键里挑）。
     * 键名不合法时保留原文（放进后缀），既不吞输入，也交给下面的提示去说明。
     */
    function splitCredential(value) {
      const text = String(value ?? '')
      const at = text.indexOf(CREDENTIAL_PREFIX)
      if (at === -1) return null
      const rest = text.slice(at + CREDENTIAL_PREFIX.length)
      const valid = /^([A-Za-z_][A-Za-z0-9_]*)/u.exec(rest)
      return {
        prefix: text.slice(0, at),
        key: valid === null ? '' : valid[1],
        suffix: valid === null ? rest : rest.slice(valid[1].length)
      }
    }

    /** 反向拼回要存进设置的值。 */
    function joinCredential(parts) {
      return `${parts?.prefix ?? ''}${CREDENTIAL_PREFIX}${parts?.key ?? ''}${parts?.suffix ?? ''}`
    }

    /** 请求头常见的前缀档位（用户不必知道能自己拼字符串，但也允许「其它」自己填）。 */
    const PREFIX_PRESETS = ['', 'Bearer ', 'Basic ']
    const CUSTOM_PREFIX = '__custom__'

    /**
     * 前缀控件（只用于请求头）。
     *
     * 早先是一个空的文本框，用户不知道要填什么；现在给「不加前缀 / Bearer / Basic / 其它」四档，
     * 选「其它」才出现自由输入框——校验需要自己拼 `Bearer ` + token 这件事因此变得显而易见。
     */
    function PrefixControl({ value, onChange, ariaLabel }) {
      // 「其它」是一个档位而不是值：值里不该出现 sentinel，用本地状态记住用户选过"其它"
      const [forced, setForced] = React.useState(false)
      const custom = forced || !PREFIX_PRESETS.includes(value)
      const mode = custom ? CUSTOM_PREFIX : value
      const input = React.createElement('input', {
        className: 'dmm-input dmm-value-prefix',
        type: 'text',
        value: custom ? value : '',
        placeholder: '自定义前缀',
        'aria-label': `${ariaLabel}前缀（自定义）`,
        onChange: (event) => onChange(event.target.value)
      })
      return React.createElement(
        'span',
        { className: 'dmm-value-prefix-group' },
        React.createElement(
          'select',
          {
            className: 'dmm-input dmm-value-prefix-mode',
            value: mode,
            'aria-label': `${ariaLabel}前缀`,
            onChange: (event) => {
              const next = event.target.value
              setForced(next === CUSTOM_PREFIX)
              onChange(next === CUSTOM_PREFIX ? '' : next)
            }
          },
          [
            React.createElement('option', { key: 'none', value: '' }, '不加前缀'),
            React.createElement('option', { key: 'bearer', value: 'Bearer ' }, 'Bearer'),
            React.createElement('option', { key: 'basic', value: 'Basic ' }, 'Basic'),
            React.createElement('option', { key: 'custom', value: CUSTOM_PREFIX }, '其它…')
          ]
        ),
        custom ? input : null
      )
    }

    /**
     * 弹窗顶部要显示的提示。
     *
     * 宿主导入后会回一句「敏感字段已转入凭据库…」——**不要再显示它**：
     * 字段旁边的提示已经说清了值去哪，而且用户把凭据键删掉之后这句话就成了假消息
     * （用户实测反馈过）。宿主半体已经不发这句，这里再兜一层，避免"新客户端 + 旧宿主进程"时又冒出来。
     */
    function visibleNotes(notes) {
      return (Array.isArray(notes) ? notes : []).filter(
        (note) => typeof note === 'string' && note !== '' && !/^敏感字段已转入凭据库/u.test(note)
      )
    }

    /** 键名不合法（值里有 credential: 但后面不是合法键名）时给出可读原因。 */
    function credentialKeyIssue(parts) {
      if (parts === null || parts.key !== '') return ''
      if (parts.suffix === '') return ''
      return '凭据键名要以字母或下划线开头，后面只能是字母、数字或下划线'
    }

    /** 条目里引用到的凭据键（去重、保持出现顺序）。 */
    function credentialRefsOf(server) {
      const keys = []
      for (const value of [server?.url ?? '', ...Object.values(server?.env ?? {}), ...Object.values(server?.headers ?? {})]) {
        for (const match of String(value).matchAll(CREDENTIAL_TOKEN)) {
          if (!keys.includes(match[1])) keys.push(match[1])
        }
      }
      return keys
    }

    /**
     * 一行到底在说什么：先看宿主阻塞原因，再看运行态。
     * @returns {{tone:'error'|'warn'|'idle'|'ok', text:string}}
     */
    function rowState(server, live, blockedReason, runtime, conflictNote) {
      if (runtime !== 'ready') return { tone: 'error', text: runtimeText(runtime), short: '宿主未就绪', detail: runtimeText(runtime) }
      if (!server.enabled) return { tone: 'idle', text: '已停用', short: '已停用' }
      if (blockedReason !== '') {
        return { tone: 'warn', text: blockedReason, short: shortReason(blockedReason), detail: blockedReason }
      }
      if (typeof conflictNote === 'string' && conflictNote !== '') {
        return { tone: 'warn', text: conflictNote, short: '与配置文件重名', detail: conflictNote }
      }
      if (live === null || live === undefined) return { tone: 'idle', text: '等待宿主对账', short: '等待生效' }
      if (live.state === 'failed') {
        return {
          tone: 'error',
          text: `挂载失败：${live.error || '原因未知'}`,
          short: '挂载失败',
          detail: `挂载失败：${live.error || '原因未知'}`
        }
      }
      if (live.tools.length === 0) {
        return { tone: 'warn', text: '已挂载，但该服务器未提供工具', short: '已连接 · 无工具', detail: '该服务器未提供工具' }
      }
      return { tone: 'ok', text: `已连接，提供 ${live.tools.length} 个工具`, short: `已连接 · ${live.tools.length} 个工具` }
    }

    /**
     * 把宿主给的长原因压成列表能用的短标签（全文在弹窗里）。
     * @param {string} reason
     * @returns {string}
     */
    function shortReason(reason) {
      if (/凭据.*未配置/u.test(reason)) return '缺凭据'
      if (/已被/u.test(reason) && /使用/u.test(reason)) return '名字被占用'
      if (/重复/u.test(reason)) return '名字重复'
      if (/必须填写/u.test(reason) || /必须是/u.test(reason)) return '配置不完整'
      if (/URL|无法解析|http/u.test(reason)) return 'URL 有问题'
      return '未生效 · 点编辑看原因'
    }

    function runtimeText(runtime) {
      if (runtime === 'unsupported-dsh') return '当前 DSH 版本不在本插件支持的范围内，未装配'
      if (runtime === 'mcp-client-unavailable') return '无法加载 @deepseek-ai/dsh-mcp-client，无法挂载任何服务器'
      if (runtime === 'starting') return '宿主仍在装配，请刷新'
      return '宿主状态未知'
    }

    /** transport → 展示用的短标签与图标。 */
    function transportMeta(transport) {
      return transport === 'streamable-http'
        ? { label: 'HTTP', Icon: IconLinkOutline16 }
        : { label: 'stdio', Icon: IconCodeOutline16 }
    }

    /** 条目摘要行（行内第二行展示）。 */
    function endpointSummary(server) {
      if (server.transport === 'streamable-http') return server.url === '' ? '（未填写 URL）' : server.url
      if (server.command === '') return '（未填写命令）'
      const args = server.args.length === 0 ? '' : ` ${server.args.join(' ')}`
      return `${server.command}${args}`
    }

    // ── 网络 ─────────────────────────────────────────────────────────────

    /**
     * 状态读取。
     * @param {any} ctx
     * @returns {Promise<any>}
     */
    async function fetchStatus(ctx) {
      const response = await fetch(STATUS_PATH, {
        method: 'GET',
        headers: { [CLIENT_HEADER]: '1' },
        credentials: 'same-origin'
      })
      if (!response.ok) throw new Error(`状态接口返回 ${response.status}`)
      const payload = await response.json()
      if (payload?.ok !== true) throw new Error(`状态接口拒绝：${String(payload?.error ?? '未知原因')}`)
      return payload
    }

    /**
     * 动作调用（固定白名单，避免开放任意操作面）。
     * @param {any} ctx
     * @param {string} csrf
     * @param {any} body
     */
    async function postAction(ctx, csrf, body) {
      const response = await fetch(ACTION_PATH, {
        method: 'POST',
        headers: { [CLIENT_HEADER]: '1', [CSRF_HEADER]: csrf, 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.ok !== true) {
        throw new Error(`宿主拒绝了该操作：${String(payload?.error ?? response.status)}`)
      }
      return payload
    }

    // ── 组件 ─────────────────────────────────────────────────────────────

    const SectionContext = React.createContext(null)
    const useSection = () => React.useContext(SectionContext)

    /** 一个 O(n) 的乐观写入队列：成功后由设置镜像回灌，失败则报错并读回。 */
    function useSettings(scope, onError) {
      const [snapshot, setSnapshot] = React.useState(() => decodeSettings(scope?.getSnapshot?.()?.value))
      const [busy, setBusy] = React.useState(false)
      React.useEffect(() => {
        if (scope === null || scope === undefined) return undefined
        setSnapshot(decodeSettings(scope.getSnapshot()?.value))
        return scope.subscribe(() => setSnapshot(decodeSettings(scope.getSnapshot()?.value)))
      }, [scope])
      const write = React.useCallback(
        async (next) => {
          if (scope === null || scope === undefined) {
            onError?.('设置接口不可用：宿主没有挂载 settings 服务')
            return
          }
          setBusy(true)
          setSnapshot(next)
          try {
            // 一次原子写入：两次 set 会有两个 revision 栅栏，中途失败就会留下半套配置。
            await scope.mutate([
              { op: 'set', path: ['servers'], value: next.servers },
              { op: 'set', path: ['enabled'], value: next.enabled }
            ])
          } catch (error) {
            onError?.(`写入失败：${String(error?.message ?? error)}`)
          } finally {
            setBusy(false)
          }
        },
        [scope, onError]
      )
      return { snapshot, setSnapshot, busy, write }
    }

    /** 面板里可用的浮层尺寸（宽高都不超过设置面板本身）。 */
    const TOOLTIP_MAX_WIDTH = 360
    const TOOLTIP_MAX_HEIGHT = 320
    const TOOLTIP_MIN_HEIGHT = 96

    /**
     * 量出浮层能用的宽高与朝向。
     *
     * 官方 `Tooltip` 只按**窗口**夹取位置（源码里只跟 `window.innerWidth/innerHeight` 打交道），
     * 没有"别超出某个容器"的选项。所以尺寸由我们算：宽不超过面板宽，高不超过
     * **面板可见区**并且不超过锚点那一侧的剩余空间，朝向取空间大的那一侧
     * ——两端都满足时官方那边的翻转判断也不会触发，位置因此是稳定的。
     */
    function useTooltipBounds(anchorRef) {
      const [bounds, setBounds] = React.useState({ maxWidth: TOOLTIP_MAX_WIDTH, maxHeight: TOOLTIP_MAX_HEIGHT, side: 'top' })
      React.useLayoutEffect(() => {
        const measure = () => {
          const anchor = anchorRef.current
          if (anchor === null || anchor === undefined || typeof anchor.getBoundingClientRect !== 'function') return
          const panel = typeof anchor.closest === 'function' ? anchor.closest('.dmm-section') : null
          const anchorRect = anchor.getBoundingClientRect()
          const panelRect = panel === null || panel === undefined ? anchorRect : panel.getBoundingClientRect()
          const viewport = window.innerHeight
          const top = Math.max(panelRect.top, 0)
          const bottom = Math.min(panelRect.bottom, viewport)
          const above = anchorRect.top - top - 16
          const below = bottom - anchorRect.bottom - 16
          const side = above >= below ? 'top' : 'bottom'
          const next = {
            maxWidth: Math.max(200, Math.min(TOOLTIP_MAX_WIDTH, Math.round(panelRect.width) - 32)),
            maxHeight: Math.max(
              TOOLTIP_MIN_HEIGHT,
              Math.min(TOOLTIP_MAX_HEIGHT, Math.round(Math.max(above, below)), Math.round(bottom - top) - 32)
            ),
            side
          }
          // 只在真变了才 setState：否则 layout effect → 渲染 → effect 会自激。
          setBounds((current) =>
            current.maxWidth === next.maxWidth && current.maxHeight === next.maxHeight && current.side === next.side ? current : next
          )
        }
        measure()
        // 测试环境里的 window 是个只有 __ModuleLoader__ 的壳，别假设有事件接口。
        if (typeof window.addEventListener !== 'function') return undefined
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
        return () => {
          window.removeEventListener('resize', measure)
          window.removeEventListener('scroll', measure, true)
        }
      }, [anchorRef])
      return bounds
    }

    /**
     * 「已连接 · N 个工具」这个 tag 上的官方 Tooltip：内容 = 完整工具清单。
     *
     * 四个约束（用户要求 + 官方组件的实际行为）：
     * - **用 DSH 自带的组件**（`@deepseek-ai/dsh-client-ui-primitives` 的 `Tooltip`），不自己画浮层；
     * - **宽高不超过设置面板**：尺寸见 `useTooltipBounds`；**横向**靠"窄锚点 + 宽盒子"解决——
     *   官方只按窗口夹取位置，锚点若就是那枚窄 tag，气泡会从 tag 右侧探出面板外，所以
     *   这里把整块标题区当作 Tooltip 的子元素（气泡以它的中线居中），并用
     *   `pointer-events:none` 把"能悬停的区域"收回到 tag 本身（tag 单独 `pointer-events:auto`）。
     *   代价：这条行里名称的原生 title、以及名称文字的选中被让掉了（服务器名就在旁边的命名空间 chip 上）。
     * - **允许换行与滚动**：内容区允许换行，清单区 `overflow:auto` 且高度受 `maxHeight` 约束；
     * - 官方的气泡是 `pointer-events:none`、鼠标一离开锚点就关，"把鼠标移进气泡里滚"这条路走不通，
     *   所以滚轮事件由锚点转发给清单（见下面的 native listener）。
     */
    function ToolsTooltip({ tools, nameNode, namespaceNode, tag }) {
      const wrapRef = React.useRef(null)
      const listRef = React.useRef(null)
      const bounds = useTooltipBounds(wrapRef)
      const [scrollable, setScrollable] = React.useState(false)

      // 滚轮转发：React 在根节点上的 wheel 是 passive 监听，preventDefault 无效，
      // 所以这里自己挂非 passive 的原生监听；滚不动时不拦截，页面该怎么滚还怎么滚。
      React.useEffect(() => {
        const wrap = wrapRef.current
        if (wrap === null || wrap === undefined || typeof wrap.addEventListener !== 'function') return undefined
        const onWheel = (event) => {
          const list = listRef.current
          if (list === null || list === undefined || list.scrollHeight <= list.clientHeight) return
          const before = list.scrollTop
          list.scrollTop = before + event.deltaY
          if (list.scrollTop !== before) event.preventDefault()
        }
        wrap.addEventListener('wheel', onWheel, { passive: false })
        return () => wrap.removeEventListener('wheel', onWheel, { passive: false })
      }, [])

      /**
       * 清单节点的挂载回调：也在这里量"是否溢出"。
       *
       * 必须挂在**节点挂载时**，不能用 layout effect：清单只在官方气泡打开时才进 DOM
       * （我们这一层不会因为气泡打开而重渲染），effect 里量到的永远是 `null`，
       * 于是"滚轮滚动"这句提示永远不出现（真机验收抓到过）。
       */
      const attachList = React.useCallback((node) => {
        listRef.current = node
        if (node === null || node === undefined || typeof node.scrollHeight !== 'number') return
        const overflow = node.scrollHeight > node.clientHeight + 1
        setScrollable((current) => (current === overflow ? current : overflow))
      }, [])

      const label = React.createElement(
        'div',
        { className: 'dmm-tip-content', style: { maxHeight: `${bounds.maxHeight}px` } },
        React.createElement('div', { className: 'dmm-tip-head' }, `共 ${tools.length} 个工具${scrollable ? ' · 滚轮滚动' : ''}`),
        React.createElement(
          'div',
          { className: 'dmm-tip-list', ref: attachList },
          tools.map((name) => React.createElement('div', { key: name, className: 'dmm-tip-name' }, name))
        )
      )

      // 拿不到官方组件（理论上不该发生：primitives 是 boot graph 的 seed）时退化成纯标签，
      // 而不是抛异常把整个分区打崩。
      const plain = React.createElement('div', { className: 'dmm-title-block' }, nameNode, namespaceNode, tag)
      if (typeof Tooltip !== 'function') return plain

      return React.createElement(
        Tooltip,
        {
          label,
          side: bounds.side,
          maxWidth: bounds.maxWidth,
          children: React.createElement(
            'div',
            { className: 'dmm-title-block tip', ref: wrapRef },
            nameNode,
            namespaceNode,
            tag
          )
        }
      )
    }

    /**
     * 列表行：**只有一行**——开关在左、标题信息居中、编辑/删除在右。
     *
     * 工具清单不再铺在行里（用户要求"列表页改为一行，去掉工具说明"）：
     * 它挂在「已连接 · N 个工具」这个 tag 上，悬停看全部（见 `ToolsTooltip`）；
     * 传输方式、命令/URL、环境变量与请求头、超时、被拦原因、最近日志依旧全部收进编辑弹窗。
     */
    function ServerRow({ server, live, blockedReason, conflictNote, runtime, onToggle, onEdit, onDelete, busy }) {
      const state = rowState(server, live, blockedReason, runtime, conflictNote)
      const namespace = `mcp__${server.serverName}__`
      const tools = Array.isArray(live?.tools) ? live.tools.filter((name) => typeof name === 'string') : []
      // 只有"真连上、而且真有工具"才挂 tooltip：其它状态下浮层只是把 tag 上的话再说一遍。
      const showTools = live !== null && live !== undefined && live.state === 'mounted' && tools.length > 0

      // 挂 tooltip 时 tag 自己要能吃悬停事件（外层标题区是 pointer-events:none）。
      const tag = React.createElement(
        'span',
        { className: `dmm-status ${state.tone}${showTools ? ' dmm-tip-trigger' : ''}`, title: showTools ? undefined : state.text },
        state.short ?? state.text
      )
      const nameNode = React.createElement(
        'span',
        { className: 'dmm-name', title: server.label === '' ? server.serverName : `${server.label}（${server.serverName}）` },
        server.label === '' ? server.serverName : server.label
      )
      const namespaceNode = server.label === '' ? null : React.createElement('code', { className: 'dmm-namespace' }, namespace)

      return React.createElement(
        'div',
        { className: 'dmm-row' },
        React.createElement(
          'div',
          { className: 'dmm-row-line' },
          // 左：启停开关
          React.createElement('button', {
            type: 'button',
            className: 'dmm-switch',
            role: 'switch',
            'aria-checked': server.enabled ? 'true' : 'false',
            'aria-label': `${server.enabled ? '停用' : '启用'} ${server.serverName}`,
            disabled: busy,
            onClick: () => onToggle(server)
          }),
          // 中：名字（没有备注名时就显服务器名）+ 工具命名空间 + 状态 tag
          showTools
            ? React.createElement(ToolsTooltip, { tools, nameNode, namespaceNode, tag })
            : React.createElement('div', { className: 'dmm-title-block' }, nameNode, namespaceNode, tag),
          // 右：编辑 / 删除
          React.createElement(
            'div',
            { className: 'dmm-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmm-icon-button',
                'aria-label': `编辑 ${server.serverName}`,
                onClick: () => onEdit(server)
              },
              React.createElement(IconEditOutline16, { size: 16 })
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmm-icon-button danger',
                'aria-label': `删除 ${server.serverName}`,
                onClick: () => onDelete(server)
              },
              React.createElement(IconTrashOutline16, { size: 16 })
            )
          )
        )
      )
    }

    function toDraft(server) {
      return {
        id: server.id,
        enabled: server.enabled !== false,
        label: server.label,
        serverName: server.serverName,
        transport: server.transport,
        command: server.command,
        argsText: server.args.join('\n'),
        cwd: server.cwd,
        envRows: recordToRows(server.env),
        url: server.url,
        headerRows: recordToRows(server.headers),
        toolCallTimeoutMs: String(server.toolCallTimeoutMs),
        failOnStartupError: server.failOnStartupError
      }
    }

    function fromDraft(draft) {
      const timeout = Number(draft.toolCallTimeoutMs)
      return {
        id: draft.id,
        enabled: draft.enabled !== false,
        label: draft.label.trim(),
        serverName: draft.serverName.trim(),
        transport: draft.transport,
        command: draft.command.trim(),
        args: parseArgs(draft.argsText),
        cwd: draft.cwd.trim(),
        env: rowsToRecord(draft.envRows),
        url: draft.url.trim(),
        headers: rowsToRecord(draft.headerRows),
        toolCallTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 60000,
        failOnStartupError: draft.failOnStartupError === true
      }
    }

    /**
     * 新条目的初始草稿。刻意在**弹窗里**才生成、只有验证通过后才写进设置——
     * 早先的版本点「+」就直接落一条空条目（用户实测反馈：不符合预期，
     * 而且会留下一条永远连不上的垃圾配置）。
     */
    function emptyDraft(id) {
      return {
        id,
        enabled: true,
        label: '',
        serverName: id,
        transport: 'stdio',
        command: '',
        argsText: '',
        cwd: '',
        envRows: [],
        url: '',
        headerRows: [],
        toolCallTimeoutMs: '60000',
        failOnStartupError: false
      }
    }

    /**
     * 表单里的一行：左边小标题、右边控件。
     *
     * 外层必须包一层 `FieldGroup`（`.dmm-fields`）——它才是真正的 grid，
     * `FieldLine` 自身 `display:contents` 把两个 span 直接塞进父 grid，
     * 于是**同一组里的标签列同宽、所有输入框左边缘对齐**。
     * 早先每行各自成 grid，标签长度不同导致输入框一个个错开（用户截图："看起来这么乱"）。
     */
    function FieldLine({ label, children }) {
      return React.createElement(
        'div',
        { className: 'dmm-field-line' },
        React.createElement('span', { className: 'dmm-field-key' }, label),
        React.createElement('span', { className: 'dmm-field-ctl' }, children)
      )
    }

    /** 一组字段行：共享标签列的 grid 容器。 */
    function FieldGroup({ children }) {
      return React.createElement('div', { className: 'dmm-fields' }, children)
    }

    /**
     * 前缀控件（请求头）：**既能选档位、也能自己输入**。
     *
     * 早先是一个空文本框（用户不知道填什么），后来是"下拉 + 旁边一个被挤到 20px 的输入框"
     * （用户截图反馈：选了「其它」那个框根本没法输入）。现在档位在下拉里，
     * 选「其它」时自由输入框占**整行剩余宽度**，两件事都不丢。
     */
    function PrefixField({ value, onChange, ariaLabel }) {
      // 「其它」是档位而不是值：值里不该出现 sentinel，用本地状态记住用户选过它
      const [forced, setForced] = React.useState(false)
      const custom = forced || !PREFIX_PRESETS.includes(value)
      const mode = custom ? CUSTOM_PREFIX : value
      return React.createElement(
        FieldLine,
        { label: '前缀' },
        React.createElement(
          'span',
          { className: 'dmm-select-wrap' },
          React.createElement(
            'select',
            {
              className: 'dmm-select',
              value: mode,
              'aria-label': `${ariaLabel}前缀`,
              onChange: (event) => {
                const next = event.target.value
                setForced(next === CUSTOM_PREFIX)
                onChange(next === CUSTOM_PREFIX ? '' : next)
              }
            },
            [
              React.createElement('option', { key: 'none', value: '' }, '不加前缀'),
              React.createElement('option', { key: 'bearer', value: 'Bearer ' }, 'Bearer'),
              React.createElement('option', { key: 'basic', value: 'Basic ' }, 'Basic'),
              React.createElement('option', { key: 'custom', value: CUSTOM_PREFIX }, '其它…')
            ]
          ),
          React.createElement(IconChevronDownOutline14, { size: 14, className: 'dmm-select-caret' })
        ),
        custom
          ? React.createElement('input', {
              className: 'dmm-input',
              type: 'text',
              value,
              placeholder: '自定义前缀（例如 Token ）',
              'aria-label': `${ariaLabel}前缀（自定义）`,
              onChange: (event) => onChange(event.target.value)
            })
          : null
      )
    }

    /**
     * 凭据键名：一个整行的输入框 + 下方「用过的键」快捷芯片。
     *
     * 不用原生 `datalist`：它的下拉箭头在深色主题里又小又不居中（用户截图反馈），
     * 而且无法保证用户看懂"可以选"。改成显式按钮——点一下就填进输入框，同时也照常手打新键名。
     */
    function KeyNameField({ value, onChange, keys, ariaLabel }) {
      const candidates = [...new Set(keys ?? [])].filter((key) => key !== value).slice(0, 4)
      return React.createElement(
        FieldLine,
        { label: '凭据键名' },
        React.createElement('input', {
          className: 'dmm-input',
          type: 'text',
          value,
          placeholder: '自己取一个（字母、数字、下划线）',
          'aria-label': `${ariaLabel}凭据键名`,
          onChange: (event) => onChange(event.target.value)
        }),
        candidates.length === 0
          ? null
          : React.createElement(
              'span',
              { className: 'dmm-key-hints' },
              '用过的键：',
              candidates.map((key) =>
                React.createElement(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dmm-chip-button',
                    'aria-label': `使用键名 ${key}`,
                    onClick: () => onChange(key)
                  },
                  key
                )
              )
            )
      )
    }

    /**
     * 值的编辑区：**直接填写 / 引用凭据**两种形态，逐行铺开（不再把三个输入框挤在同一行）。
     *
     * 存进设置的仍是 `[前缀]credential:键名[后缀]`（settings 里只能放字符串），
     * 但界面上用户看到的永远是「前缀 + 凭据键名」这种他能理解的字段。
     */
    function ValueEditor({ value, onChange, keys, prefixMode, ariaLabel, placeholder, prefixHint, emptyPrefixHint, valueLabel }) {
      const parts = splitCredential(value)
      const set = (patch) => onChange(joinCredential({ ...parts, ...patch }))
      if (parts === null) {
        return React.createElement(
          FieldLine,
          { label: valueLabel ?? '值' },
          React.createElement('input', {
            className: 'dmm-input',
            type: 'text',
            value: String(value ?? ''),
            placeholder: placeholder ?? '值',
            'aria-label': ariaLabel,
            onChange: (event) => onChange(event.target.value)
          })
        )
      }
      return React.createElement(
        React.Fragment,
        null,
        prefixMode === 'header'
          ? React.createElement(PrefixField, { value: parts.prefix, onChange: (prefix) => set({ prefix }), ariaLabel })
          : prefixMode === 'address'
            ? React.createElement(
                FieldLine,
                { label: prefixHint ?? '地址前段' },
                React.createElement('input', {
                  className: 'dmm-input',
                  type: 'text',
                  value: parts.prefix,
                  placeholder: emptyPrefixHint ?? '可留空',
                  'aria-label': `${ariaLabel}前缀`,
                  onChange: (event) => set({ prefix: event.target.value })
                })
              )
            : null,
        React.createElement(KeyNameField, { value: parts.key, onChange: (key) => set({ key }), keys, ariaLabel }),
        parts.suffix === ''
          ? null
          : React.createElement(
              FieldLine,
              { label: '后缀' },
              React.createElement('input', {
                className: 'dmm-input',
                type: 'text',
                value: parts.suffix,
                placeholder: '后缀',
                'aria-label': `${ariaLabel}后缀`,
                onChange: (event) => set({ suffix: event.target.value })
              })
            )
      )
    }

    /**
     * 环境变量 / 请求头的一行：一张小卡片，字段**逐行铺开**。
     *
     * 五个输入框挤在同一行时，长键名/长地址都会被截断（用户截图反馈），
     * 而且"第二个框是干嘛的"根本看不出来；现在第一行是名字 + 「凭据」+ 删除，
     * 下面是带标题的字段行（值 / 前缀 / 凭据键名），每个字段都能占满整行。
     */
    function PairEditor({ kind, rows, onChange, keys }) {
      const label = kind === 'env' ? '环境变量' : '请求头'
      const update = (index, patch) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))
      const toggle = (index) => {
        const row = rows[index] ?? { value: '' }
        const parts = splitCredential(row.value)
        update(index, { value: parts === null ? joinCredential({ prefix: '', key: '', suffix: '' }) : parts.prefix })
      }
      const remove = (index) => onChange(rows.filter((unused, at) => at !== index))
      const add = () => onChange([...rows, { name: '', value: '' }])
      const issues = rows.map((row) => credentialKeyIssue(splitCredential(row.value))).filter((issue) => issue !== '')

      return React.createElement(
        'div',
        { className: 'dmm-pairs' },
        rows.map((row, index) => {
          const parts = splitCredential(row.value)
          const credential = parts !== null
          return React.createElement(
            'div',
            { className: 'dmm-pair', key: index },
            React.createElement(
              'div',
              { className: 'dmm-pair-head' },
              React.createElement('input', {
                className: 'dmm-input dmm-pair-name',
                type: 'text',
                value: row.name,
                placeholder: kind === 'env' ? '变量名' : '请求头名字',
                'aria-label': `${label}第 ${index + 1} 行名字`,
                onChange: (event) => update(index, { name: event.target.value })
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: `dmm-chip-button${credential ? ' on' : ''}`,
                  'aria-pressed': credential ? 'true' : 'false',
                  'aria-label': `${label}第 ${index + 1} 行引用凭据`,
                  title: credential ? '改回直接填写明文' : '改用凭据库里的值（界面不回显）',
                  onClick: () => toggle(index)
                },
                '凭据'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dmm-icon-button sm',
                  'aria-label': `删除${label}第 ${index + 1} 行`,
                  onClick: () => remove(index)
                },
                React.createElement(IconTrashOutline16, { size: 16 })
              )
            ),
            React.createElement(
              FieldGroup,
              null,
              React.createElement(ValueEditor, {
                value: row.value,
                onChange: (value) => update(index, { value }),
                keys,
                // 请求头一定有前缀档位；环境变量平时不显示，但值里已经有前缀时照样露出来
                prefixMode: kind === 'headers' ? 'header' : splitCredential(row.value)?.prefix ? 'address' : 'none',
                ariaLabel: `${label}第 ${index + 1} 行`,
                valueLabel: '值'
              })
            )
          )
        }),
        React.createElement(
          'button',
          { type: 'button', className: 'dmm-btn-sm dmm-pair-add', 'aria-label': `添加${label}`, onClick: add },
          `+ 添加${kind === 'env' ? '环境变量' : '请求头'}`
        ),
        issues.length === 0 ? null : React.createElement('span', { className: 'dmm-hint dmm-hint-error' }, issues[0])
      )
    }

    /** 编辑器：本地草稿 + 保存时才写。 */
    /**
     * 表单本体（只渲染字段）：由 `ServerDialog` 放在弹窗里，新增与编辑共用同一份。
     */
    function ServerEditor({ draft, setDraft, busy, verifying, verification, credentialKeys }) {
      const section = useSection()
      const field = (key) => ({
        value: draft[key],
        onChange: (event) => setDraft({ ...draft, [key]: event.target.value }),
        disabled: false
      })
      const setValue = (key, value) => setDraft({ ...draft, [key]: value })
      const isHttp = draft.transport === 'streamable-http'
      /**
       * 凭据区只列当前草稿真正引用到的键。
       *
       * 这里刻意**不**按"行有没有名字"过滤：用户刚点「凭据」、还没给行起名字时就要能填值，
       * 否则点了凭据却看不到任何变化（名字为空的行走 `rowsToRecord` 时会被丢掉，那是保存时的事）。
       */
      const env = (draft.envRows ?? []).map((row) => String(row?.value ?? ''))
      const headers = (draft.headerRows ?? []).map((row) => String(row?.value ?? ''))
      const refs = credentialRefsOf({ url: draft.url, env, headers })
      // 键名候选：**其它托管条目用过、而这份草稿还没用到**的键。
      // 同一个键给两个不同的密钥用没有意义，所以当前草稿里已经出现的键不再推荐
      // （早先把它们也列出来，弹窗里一堆重复候选，看着很乱）。
      const keyOptions = [...new Set(credentialKeys ?? [])].filter((key) => !refs.includes(key))

      return React.createElement(
        'div',
        { className: 'dmm-form' },
        React.createElement(
          'div',
          { className: 'dmm-field-row' },
          // 服务器名在前（它是必填、也是工具前缀的来源），备注名在后
          React.createElement(
            'div',
            { className: 'dmm-field' },
            React.createElement(
              'span',
              { className: 'dmm-label' },
              '服务器名',
              React.createElement('span', { className: 'dmm-required' }, ' *'),
              // 文案与运行时同源：工具全名就是 mcp__<服务器名>__<工具名>（见行上的命名空间 chip）。
              React.createElement('span', { className: 'dmm-label-note' }, '(工具前缀为 mcp__<名字>__)')
            ),
            React.createElement('input', { className: 'dmm-input', type: 'text', ...field('serverName') })
          ),
          React.createElement(
            'div',
            { className: 'dmm-field' },
            React.createElement('span', { className: 'dmm-label' }, '备注名'),
            React.createElement('input', { className: 'dmm-input', type: 'text', ...field('label') })
          )
        ),
        React.createElement(
          'div',
          { className: 'dmm-field' },
          React.createElement('span', { className: 'dmm-label' }, '传输方式'),
          React.createElement(
            'div',
            { className: 'dmm-radio-row' },
            React.createElement(
              'label',
              { className: 'dmm-radio' },
              React.createElement('input', {
                type: 'radio',
                name: `dmm-transport-${draft.id}`,
                checked: !isHttp,
                onChange: () => setValue('transport', 'stdio')
              }),
              'stdio（本地进程）'
            ),
            React.createElement(
              'label',
              { className: 'dmm-radio' },
              React.createElement('input', {
                type: 'radio',
                name: `dmm-transport-${draft.id}`,
                checked: isHttp,
                onChange: () => setValue('transport', 'streamable-http')
              }),
              'streamable-http（远程服务）'
            )
          )
        ),
        isHttp
          ? React.createElement(
              'div',
              { className: 'dmm-field' },
              React.createElement(
                'span',
                { className: 'dmm-label dmm-label-line' },
                'URL',
                React.createElement('span', { className: 'dmm-required' }, ' *'),
                React.createElement('span', { className: 'dmm-label-spacer' }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: `dmm-chip-button${splitCredential(draft.url) === null ? '' : ' on'}`,
                    'aria-pressed': splitCredential(draft.url) === null ? 'false' : 'true',
                    'aria-label': 'URL 引用凭据',
                    title:
                      splitCredential(draft.url) === null
                        ? '整条地址存进凭据库（地址里带 token 时用它，界面不回显）'
                        : '改回直接填写地址',
                    onClick: () => {
                      const parts = splitCredential(draft.url)
                      setValue('url', parts === null ? joinCredential({ prefix: '', key: '', suffix: '' }) : parts.prefix)
                    }
                  },
                  '凭据'
                )
              ),
              React.createElement(FieldGroup, null,
                React.createElement(ValueEditor, {
                  value: draft.url,
                  onChange: (value) => setValue('url', value),
                  keys: keyOptions,
                  // 地址里只有一段是密钥（?token=<密钥>）时，前缀放地址、键放密钥：
                  // 地址保持可见，值只在凭据库里。整条地址进凭据库（前缀留空）也照旧成立。
                  prefixMode: 'address',
                  ariaLabel: 'URL',
                  placeholder: 'https://…/mcp',
                  valueLabel: '地址',
                  prefixHint: '地址前段',
                  emptyPrefixHint: '可留空：整条地址都进凭据库时'
                })
              )
            )
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(
                'div',
                { className: 'dmm-field' },
                React.createElement('span', { className: 'dmm-label' }, '命令', React.createElement('span', { className: 'dmm-required' }, ' *')),
                React.createElement('input', { className: 'dmm-input', type: 'text', ...field('command') })
              ),
              React.createElement(
                'div',
                { className: 'dmm-field' },
                React.createElement('span', { className: 'dmm-label' }, '参数（每行一个）'),
                React.createElement('textarea', { className: 'dmm-textarea', ...field('argsText') })
              ),
              React.createElement(
                'div',
                { className: 'dmm-field' },
                React.createElement('span', { className: 'dmm-label' }, '工作目录'),
                React.createElement('input', { className: 'dmm-input', type: 'text', ...field('cwd') })
              )
            ),
        React.createElement(
          'div',
          { className: 'dmm-field' },
          React.createElement('span', { className: 'dmm-label' }, isHttp ? '请求头' : '环境变量'),
          React.createElement(PairEditor, {
            kind: isHttp ? 'headers' : 'env',
            rows: isHttp ? draft.headerRows : draft.envRows,
            onChange: (rows) => setValue(isHttp ? 'headerRows' : 'envRows', rows),
            keys: keyOptions
          }),
          React.createElement(
            'span',
            { className: 'dmm-hint' },
            '密钥点「凭据」：键名自己取，值存进凭据库、界面不回显、可多处复用；直接填写的值会明文存进设置文件。'
          )
        ),
        refs.length === 0 ? null : React.createElement(CredentialBox, { refs, section }),
        React.createElement(
          'div',
          { className: 'dmm-field' },
          React.createElement('span', { className: 'dmm-label' }, '单次调用超时（毫秒）'),
          React.createElement('input', { className: 'dmm-input', type: 'text', ...field('toolCallTimeoutMs') })
        ),
        // 勾选项文本很长：单独占一整行，别和输入框挤同一行的两列（会换行、也很难看）
        React.createElement(
          'label',
          { className: 'dmm-checkline' },
          React.createElement('input', {
            type: 'checkbox',
            checked: draft.failOnStartupError === true,
            onChange: (event) => setValue('failOnStartupError', event.target.checked)
          }),
          React.createElement('span', null, '启动连不上就报错', React.createElement('span', { className: 'dmm-hint' }, '（默认只记录日志并继续重连）'))
        ),
        React.createElement(VerificationLine, { verifying, verification })
      )
    }

    /**
     * 新增/编辑弹窗：一个表单 + 三个按钮（取消 / 验证 / 保存）。
     *
     * 「先验证、后保存」是用户明确要求的口径：保存按钮在验证通过前是禁用的，
     * 表单任何改动都会让上一次的验证结果作废。这样不会再出现"点一下就多一条
     * 连不上的空条目"。
     */
    function ServerDialog({ mode, draft, verification, verifying, busy, notes, live, blockedReason, conflictNote, runtime, hostSupportsVerify, setDraft, onCancel, onVerify, onSave, credentialKeys }) {
      const footer = React.createElement(
        'div',
        { className: 'dmm-dialog-footer' },
        React.createElement(
          'button',
          { type: 'button', className: 'dmm-button', 'aria-label': '取消', disabled: verifying, onClick: onCancel },
          '取消'
        ),
        // 只有「保存」一个动作：点它就自动先验证、通过才落盘（少一次点击）。
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dmm-button primary',
            'aria-label': '保存',
            disabled: busy || verifying || hostSupportsVerify === false,
            title: hostSupportsVerify === false ? '当前 dsh web 进程没有「验证」接口，请重启后再试' : undefined,
            onClick: onSave
          },
          verifying ? '验证并保存中…' : '保存'
        )
      )
      const body = React.createElement(
        'div',
        { className: 'dmm-dialog-body' },
        hostSupportsVerify === false
          ? React.createElement(
              'div',
              { className: 'dmm-verify stale' },
              '当前 dsh web 进程还是旧版本，没有「验证」接口：请在 Warp 里 Ctrl+C 后重新执行 dsh web --no-open，再刷新页面重试。'
            )
          : null,
        visibleNotes(notes).length > 0
          ? React.createElement(
              'div',
              { className: 'dmm-notes' },
              visibleNotes(notes).map((note, index) => React.createElement('div', { key: index }, note))
            )
          : null,
        // 状态本身在列表行里高亮显示，弹窗不再重复一遍（放这里既挤、也不显眼）。
        // 只有真出了问题时，才把 mcp-client 的最近日志收在折叠块里供排查。
        (live?.logs ?? []).length === 0 ? null : React.createElement(LiveLogs, { logs: live.logs }),
        React.createElement(ServerEditor, { draft, setDraft, busy, verifying, verification, credentialKeys })
      )
      const title = mode === 'edit' ? '编辑 MCP 服务器' : '新增 MCP 服务器'
      if (typeof Modal !== 'function') {
        // 拿不到官方 Modal 时退化成页面内表单，功能不丢（但不再有遮罩）
        return React.createElement(
          'div',
          { className: 'dmm-dialog-inline', role: 'dialog', 'aria-label': title },
          React.createElement('div', { className: 'dmm-dialog-title' }, title),
          body,
          footer
        )
      }
      return React.createElement(
        Modal,
        {
          open: true,
          onClose: onCancel,
          title,
          closeLabel: '关闭',
          description: '保存时会先验证连接，通过才写入；保存后立即生效，不需要重启。',
          className: 'dmm-dialog',
          footer
        },
        body
      )
    }

    /**
     * 弹窗里的诊断折叠块：只放 mcp-client 的最近日志。
     * 状态本身在列表行里高亮显示，这里不重复（用户反馈：状态块跟表单挤在一起、也不显眼）。
     */
    function LiveLogs({ logs }) {
      return React.createElement(
        'details',
        { className: 'dmm-live-logs' },
        React.createElement('summary', null, `最近日志（${logs.length} 条）`),
        React.createElement('div', { className: 'dmm-log' }, logs.join('\n'))
      )
    }

    /** 验证结果一行：未验证 / 验证中 / 通过（带工具清单）/ 失败（带原因）。 */
    function VerificationLine({ verifying, verification }) {
      if (verifying === true) {
        return React.createElement(
          'div',
          { className: 'dmm-verify' },
          React.createElement(IconLoadingOutline16, { size: 14 }),
          '正在连接并读取工具清单…'
        )
      }
      if (verification === null || verification === undefined || verification.status === 'idle') return null
      if (verification.status === 'failed' && verification.hostOutdated === true) {
        return React.createElement('div', { className: 'dmm-verify stale' }, verification.error)
      }
      if (verification.status === 'failed') {
        return React.createElement('div', { className: 'dmm-verify failed' }, `验证失败：${verification.error ?? '原因未知'}`)
      }
      const tools = verification.tools ?? []
      return React.createElement(
        'div',
        { className: 'dmm-verify ok' },
        tools.length === 0
          ? '验证通过：连接成功，该服务器没有提供工具。'
          : `验证通过：连接成功，提供 ${tools.length} 个工具（${tools.join('、')}）。`
      )
    }

    /** 凭据区：只显示「是否已配置」，值永远不回显。 */
    function CredentialBox({ refs, section }) {
      const ctx = useSection()?.ctx
      const [state, setState] = React.useState({ loading: true, entries: {}, error: '' })
      const [drafts, setDrafts] = React.useState({})
      const [busyRef, setBusyRef] = React.useState('')

      /**
       * 取凭据数据面。
       *
       * 必须包 try/catch：客户端 ctx 上的服务读取在"没注入"时是**同步抛错**的
       * （`cannot get property "remote.credentials" without inject`），
       * 以前这里直接读属性，异常让整个 `save()` 在 setBusyRef 之前就退出，
       * 界面表现是"点了保存毫无反应"（用户实测反馈）。
       */
      const credentialsApi = React.useCallback(() => {
        try {
          const credentials = ctx?.remote?.credentials
          if (credentials !== undefined && typeof credentials.describe === 'function') return credentials
        } catch (error) {
          return { __error: String(error?.message ?? error) }
        }
        return { __error: '宿主没有挂载凭据服务' }
      }, [ctx])

      const load = React.useCallback(async () => {
        const credentials = credentialsApi()
        if (credentials.__error !== undefined) {
          setState({ loading: false, entries: {}, error: `凭据服务不可用：${credentials.__error}` })
          return
        }
        try {
          const response = await credentials.describe(refs)
          if (!response?.ok) throw new Error(String(response?.error?.message ?? '读取失败'))
          setState({ loading: false, entries: response.value ?? {}, error: '' })
        } catch (error) {
          setState({ loading: false, entries: {}, error: `读取凭据失败：${String(error?.message ?? error)}` })
        }
      }, [credentialsApi, refs.join(',')])

      React.useEffect(() => {
        void load()
      }, [load])

      const save = async (ref) => {
        const credentials = credentialsApi()
        const value = drafts[ref] ?? ''
        if (credentials.__error !== undefined) {
          setState({ ...state, error: `凭据服务不可用：${credentials.__error}` })
          return
        }
        if (value === '') return
        setBusyRef(ref)
        try {
          const response = await credentials.set(ref, value)
          if (!response?.ok) throw new Error(String(response?.error?.message ?? '写入失败'))
          setDrafts({ ...drafts, [ref]: '' })
          await load()
        } catch (error) {
          setState({ ...state, error: `写入凭据失败：${String(error?.message ?? error)}` })
        } finally {
          setBusyRef('')
        }
      }

      const clear = async (ref) => {
        const credentials = credentialsApi()
        if (credentials.__error !== undefined) {
          setState({ ...state, error: `凭据服务不可用：${credentials.__error}` })
          return
        }
        setBusyRef(ref)
        try {
          const response = await credentials.unset(ref)
          if (!response?.ok) throw new Error(String(response?.error?.message ?? '清除失败'))
          await load()
        } catch (error) {
          setState({ ...state, error: `清除凭据失败：${String(error?.message ?? error)}` })
        } finally {
          setBusyRef('')
        }
      }

      return React.createElement(
        'div',
        { className: 'dmm-cred' },
        React.createElement('span', { className: 'dmm-label' }, '引用的凭据'),
        state.error === '' ? null : React.createElement('div', { className: 'dmm-error' }, state.error),
        refs.map((ref) => {
          const info = state.entries?.[ref]
          const configured = info?.configured === true
          const writable = info?.writable !== false
          return React.createElement(
            'div',
            { key: ref, className: 'dmm-cred-row' },
            // 第一行：键名 + 状态小标签（"未配置"是状态，不该长成一句说明）
            React.createElement(
              'div',
              { className: 'dmm-cred-head' },
              React.createElement('span', { className: 'dmm-cred-name', title: ref }, ref),
              React.createElement(
                'span',
                { className: `dmm-status ${configured ? 'ok' : 'warn'}` },
                configured ? `已配置 · ${info?.source ?? 'credentials'}` : '未配置'
              ),
              writable ? null : React.createElement('span', { className: 'dmm-status' }, '只读来源')
            ),
            // 第二行：输入框与两个小按钮同一行、垂直居中对齐
            React.createElement(
              'div',
              { className: 'dmm-cred-input-row' },
              React.createElement('input', {
                className: 'dmm-input dmm-cred-input',
                type: 'password',
                placeholder: configured ? '输入新值以覆盖' : '输入值以保存',
                value: drafts[ref] ?? '',
                disabled: !writable || busyRef === ref,
                onChange: (event) => setDrafts({ ...drafts, [ref]: event.target.value })
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dmm-btn-sm',
                  'aria-label': `保存凭据 ${ref}`,
                  disabled: !writable || busyRef === ref || (drafts[ref] ?? '') === '',
                  onClick: () => save(ref)
                },
                '保存'
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dmm-btn-sm',
                  'aria-label': `清除凭据 ${ref}`,
                  disabled: !writable || !configured,
                  onClick: () => clear(ref)
                },
                '清除'
              )
            )
          )
        })
      )
    }

    /** 配置文件里已有行（只读）与导入入口。 */
    /**
     * 只读块：DSH 启动配置里已经声明的 MCP 服务器。
     *
     * 两个刻意的取舍：
     * - **文案不出现实现细节**（profile / cordis.patch.yml / !!js 表达式都属实现），
     *   用户需要的只有一句话：这是只读的、来自启动配置、值不显示；
     * - **块自己成一个卡片**，不再复用托管条目的行长样式——两者层级不同，
     *   混用同一套 `.dmm-row` 会让这一块看起来像"另一批可编辑条目"。
     */
    function ProfileTargets({ rows, onImport, busy }) {
      if (!Array.isArray(rows) || rows.length === 0) return null
      return React.createElement(
        'section',
        { className: 'dmm-targets' },
        React.createElement(
          'div',
          { className: 'dmm-targets-head' },
          React.createElement('h3', { className: 'dmm-targets-title' }, '配置文件中的服务器'),
          React.createElement('span', { className: 'dmm-badge' }, `${rows.length} 个`),
          React.createElement('span', { className: 'dmm-targets-hint' }, '只读 · 值不显示')
        ),
        rows.map((row) =>
          React.createElement(
            'div',
            { key: row.entryId, className: 'dmm-target' },
            React.createElement(
              'div',
              { className: 'dmm-target-copy' },
              React.createElement(
                'div',
                { className: 'dmm-target-name-line' },
                React.createElement('span', { className: 'dmm-target-name' }, row.serverName || row.entryId),
                React.createElement('span', { className: 'dmm-badge' }, row.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
                row.enabled ? null : React.createElement('span', { className: 'dmm-badge off' }, '已停用')
              ),
              row.endpoint === ''
                ? null
                : React.createElement('div', { className: 'dmm-target-endpoint', title: row.endpoint }, row.endpoint),
              fieldSummary(row) === ''
                ? null
                : React.createElement('div', { className: 'dmm-target-fields' }, fieldSummary(row))
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmm-button',
                disabled: busy,
                title: '复制成一条可以在这里编辑的托管条目（地址与凭据需要重新填写）',
                onClick: () => onImport(row)
              },
              '导入'
            )
          )
        )
      )
    }

    /**
     * 一行里能说的字段信息：只说有哪些字段、不说值。
     * @param {any} row
     * @returns {string}
     */
    function fieldSummary(row) {
      const parts = []
      if (Array.isArray(row.headerKeys) && row.headerKeys.length > 0) parts.push(`请求头 ${row.headerKeys.join('、')}`)
      if (Array.isArray(row.envKeys) && row.envKeys.length > 0) parts.push(`环境变量 ${row.envKeys.join('、')}`)
      return parts.join(' · ')
    }

    /** 设置页分区主体。 */
    function McpManagerSection() {
      const { ctx, scope } = useSection()
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [refreshing, setRefreshing] = React.useState(false)
      const [confirming, setConfirming] = React.useState(null)
      // 新增后自动展开这条的编辑器：用户点「+」的意图就是"马上填这台服务器"。
      /**
       * 编辑器弹窗状态：null 表示关闭。
       * `{ mode: 'create'|'edit', draft, verification, verifying }`
       * verification = { status: 'idle'|'ok'|'failed', tools?, error? }
       */
      const [editor, setEditor] = React.useState(null)
      const { snapshot, setSnapshot, busy, write } = useSettings(scope, setError)

      /**
       * 读宿主状态。
       *
       * `since` 用于「刚写完设置」的场景：宿主的对账由设置变更触发，可能晚于
       * 这一次读取，于是页面会停在**上一次**的对账结论上（比如刚把配置改好，
       * 行上还挂着旧的被拦原因）。带上写入时刻后，一直重读到对账时间追上为止。
       */
      const refresh = React.useCallback(async (since) => {
        setRefreshing(true)
        try {
          let payload = null
          for (let attempt = 0; attempt < 6; attempt += 1) {
            payload = await fetchStatus(ctx)
            setStatus(payload)
            setError('')
            const reconciled = typeof payload.lastReconcile?.at === 'number' ? payload.lastReconcile.at : 0
            if (since === undefined || reconciled >= since) break
            await new Promise((resolve) => setTimeout(resolve, 700))
          }
          return payload
        } catch (cause) {
          setError(`读取宿主状态失败：${String(cause?.message ?? cause)}`)
          return null
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }, [ctx])

      /** 写入之后调用：等到宿主完成这一轮对账再收工。 */
      const refreshAfterWrite = React.useCallback(() => refresh(Date.now() - 50), [refresh])

      React.useEffect(() => {
        void refresh()
      }, [refresh])

      const liveOf = React.useCallback(
        (id) => {
          const row = (status?.servers ?? []).find((item) => item.id === id)
          return row ?? null
        },
        [status]
      )

      /** 打开弹窗：新增（空草稿）或编辑（按现有条目预填）。 */
      const openEditor = (mode, server) => {
        const draft = server === null || server === undefined ? emptyDraft(newId(snapshot.servers.map((item) => item.id))) : toDraft(server)
        setEditor({ mode, draft, verification: { status: 'idle' }, verifying: false })
      }

      /** 表单任何改动都让上一次的验证结果作废——"验证通过"必须对应眼前这份内容。 */
      const changeDraft = (next) => {
        setEditor((current) => (current === null ? current : { ...current, draft: next, verification: { status: 'idle' } }))
      }

      const closeEditor = () => setEditor(null)

      /** 点「验证」：把表单交给宿主做一次临时挂载探针（不保存任何东西）。 */
      const verifyDraft = async () => {
        if (editor === null) return
        const candidate = fromDraft(editor.draft)
        const csrf = status?.csrf
        if (csrf === undefined) {
          setEditor((current) => (current === null ? current : { ...current, verification: { status: 'failed', error: '还没拿到宿主状态，请先刷新' } }))
          return
        }
        setEditor((current) => (current === null ? current : { ...current, verifying: true }))
        try {
          const response = await postAction(ctx, csrf, { action: 'verify', server: candidate })
          const value = response.value ?? {}
          setEditor((current) =>
            current === null
              ? current
              : {
                  ...current,
                  verifying: false,
                  verification: value.ok === true
                    ? { status: 'ok', tools: value.tools ?? [] }
                    : { status: 'failed', error: value.error ?? '验证失败' }
                }
          )
        } catch (error) {
          const message = String(error?.message ?? error)
          // 宿主进程比客户端旧时，动作路由不认识 verify（400 unknown action）。
          // 这不是配置问题，必须说清"去重启 dsh web"，否则用户会一直改表单重试。
          const hostOutdated = /unknown action/u.test(message)
          setEditor((current) =>
            current === null
              ? current
              : {
                  ...current,
                  verifying: false,
                  verification: {
                    status: 'failed',
                    hostOutdated,
                    error: hostOutdated
                      ? '当前 dsh web 进程还是旧版本，没有「验证」接口：请在 Warp 里 Ctrl+C 后重新执行 dsh web --no-open，再刷新页面重试。'
                      : message
                  }
                }
          )
        }
      }

      /**
       * 点「保存」= 先自动验证、通过才写盘。
       *
       * 用户要求去掉单独的「验证」按钮（"过于繁琐"）：一次点击完成"验证 + 保存"。
       * 验证失败时不写盘，弹窗留在原地把原因显示出来，改完再点保存即可
       * —— 也就是行上永远不会出现"没验证过就存下来的配置"。
       */
      const saveDraft = async () => {
        if (editor === null || editor.verifying === true) return
        const entry = fromDraft(editor.draft)
        const csrf = status?.csrf
        setEditor((current) => (current === null ? current : { ...current, verifying: true }))
        let verification = { status: 'idle' }
        if (csrf === undefined) {
          verification = { status: 'failed', error: '还没拿到宿主状态，请刷新页面后重试' }
        } else {
          try {
            const response = await postAction(ctx, csrf, { action: 'verify', server: entry })
            const value = response.value ?? {}
            verification =
              value.ok === true
                ? { status: 'ok', tools: value.tools ?? [] }
                : { status: 'failed', error: value.error ?? '验证失败' }
          } catch (error) {
            const message = String(error?.message ?? error)
            const hostOutdated = /unknown action/u.test(message)
            verification = {
              status: 'failed',
              hostOutdated,
              error: hostOutdated
                ? '当前 dsh web 进程还是旧版本，没有「验证」接口：请在 Warp 里 Ctrl+C 后重新执行 dsh web --no-open，再刷新页面重试。'
                : `验证失败：${message}`
            }
          }
        }
        setEditor((current) => (current === null ? null : { ...current, verifying: false, verification }))
        if (verification.status !== 'ok') return
        const servers =
          editor.mode === 'edit'
            ? snapshot.servers.map((item) => (item.id === entry.id ? { ...item, ...entry } : item))
            : [...snapshot.servers, entry]
        setEditor(null)
        await write({ ...snapshot, servers })
        await refreshAfterWrite()
      }

      const toggle = async (server) => {
        const servers = snapshot.servers.map((item) => (item.id === server.id ? { ...item, enabled: !item.enabled } : item))
        await write({ ...snapshot, servers })
        await refreshAfterWrite()
      }

      const remove = async (server) => {
        setConfirming(null)
        const servers = snapshot.servers.filter((item) => item.id !== server.id)
        await write({ ...snapshot, servers })
        await refreshAfterWrite()
      }

      /**
       * 导入：向宿主取这一条的**完整**配置（URL、命令、参数、普通环境变量/请求头全带上；
       * 敏感字段在宿主侧被搬进凭据库，这里只拿到 `credential:键名` 与一句说明）。
       * 仍然要先验证才能保存。
       */
      const importRow = async (row) => {
        const csrf = status?.csrf
        if (csrf === undefined) {
          setError('还没拿到宿主状态，请先刷新再导入')
          return
        }
        try {
          const response = await postAction(ctx, csrf, { action: 'import', entryId: row.entryId })
          const value = response.value ?? {}
          if (value.ok !== true) {
            setError(String(value.error ?? '导入失败'))
            return
          }
          // 宿主给的是**清单形状**（env/headers 是对象、args 是数组），编辑器用的是
          // **文本形状**（envText/headersText/argsText）——必须过 toDraft 转换，
          // 否则表现为"导进来是空的"（踩过）。
          setEditor({ mode: 'create', draft: toDraft(value.draft), verification: { status: 'idle' }, verifying: false, notes: value.notes ?? [] })
        } catch (error) {
          const message = String(error?.message ?? error)
          setError(/unknown action/u.test(message)
            ? '当前 dsh web 进程还是旧版本，没有「导入」接口：请重启 dsh web 后再试。'
            : `导入失败：${message}`)
        }
      }

      const runtime = status?.runtime ?? 'starting'
      const enabledCount = snapshot.servers.filter((item) => item.enabled).length
      // 供弹窗里的键名下拉用：其它托管条目已经引用过的凭据键（避免用户记名字、也方便复用）。
      const knownCredentialKeys = [
        ...new Set(snapshot.servers.flatMap((item) => credentialRefsOf({ url: item.url, env: item.env, headers: item.headers })))
      ]

      if (loading) {
        return React.createElement(
          'div',
          { className: 'dmm-section' },
          React.createElement(
            'div',
            { className: 'dmm-loading' },
            React.createElement(IconLoadingOutline16, { size: 16 }),
            '正在读取宿主状态…'
          )
        )
      }

      return React.createElement(
        'div',
        { className: 'dmm-section' },
        React.createElement(
          'div',
          { className: 'dmm-heading' },
          React.createElement('h2', { className: 'dmm-title' }, SECTION_LABEL),
          React.createElement('span', { className: 'dmm-count' }, `${enabledCount}/${snapshot.servers.length} 已启用`),
          React.createElement('span', { className: 'dmm-heading-spacer' }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dmm-icon-button',
              'aria-label': '重新对账',
              disabled: refreshing || busy,
              onClick: async () => {
                try {
                  if (status?.csrf !== undefined) await postAction(ctx, status.csrf, { action: 'reconcile' })
                } catch (cause) {
                  setError(String(cause?.message ?? cause))
                }
                await refreshAfterWrite()
              }
            },
            React.createElement(IconRefreshOutline16, { size: 16 })
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dmm-icon-button', 'aria-label': '新增服务器', disabled: busy, onClick: () => openEditor('create', null) },
            React.createElement(IconPlusOutline16, { size: 16 })
          )
        ),
        runtime === 'ready'
          ? null
          : React.createElement(
              'div',
              { className: 'dmm-error' },
              `${runtimeText(runtime)}${status?.mcpModule?.errors?.length ? `\n${status.mcpModule.errors.join('\n')}` : ''}`
            ),
        status?.settingsAvailable === false
          ? React.createElement('div', { className: 'dmm-error' }, '宿主没有挂载 settings 服务，改动无法持久化。')
          : null,
        error === '' ? null : React.createElement('div', { className: 'dmm-error' }, error),
        React.createElement(
          'label',
          { className: 'dmm-radio' },
          React.createElement('input', {
            type: 'checkbox',
            checked: snapshot.enabled,
            disabled: busy,
            onChange: async (event) => {
              await write({ ...snapshot, enabled: event.target.checked })
              await refreshAfterWrite()
            }
          }),
          '启用托管的所有服务器（关闭后全部断开）'
        ),
        snapshot.servers.length === 0
          ? React.createElement('div', { className: 'dmm-empty' }, '还没有托管任何 MCP 服务器；用右上角的 + 新增，或从下面「配置文件中的服务器」导入一条。')
          : React.createElement(
              'div',
              { className: 'dmm-list' },
              snapshot.servers.map((server) => {
                const live = liveOf(server.id)?.live ?? null
                const blockedReason = liveOf(server.id)?.blockedReason ?? ''
                const conflictNote = liveOf(server.id)?.conflictNote ?? ''
                return React.createElement(ServerRow, {
                  key: server.id,
                  server,
                  live,
                  blockedReason,
                  conflictNote,
                  runtime,
                  busy,
                  onToggle: toggle,
                  onEdit: (target) => openEditor('edit', target),
                  onDelete: (target) => setConfirming(target)
                })
              })
            ),
        React.createElement(ProfileTargets, { rows: status?.profileTargets ?? [], onImport: importRow, busy }),
        editor === null
          ? null
          : React.createElement(ServerDialog, {
              mode: editor.mode,
              draft: editor.draft,
              live: liveOf(editor.draft.id)?.live ?? null,
              blockedReason: liveOf(editor.draft.id)?.blockedReason ?? '',
              conflictNote: liveOf(editor.draft.id)?.conflictNote ?? '',
              runtime,
              // 状态里没有 actions 就是"客户端比宿主新"（actions 与 verify 同时引入）：
              // 直接当成不支持，让用户在弹窗里立刻看到"去重启"而不是点了才报错。
              hostSupportsVerify: Array.isArray(status?.actions) ? status.actions.includes('verify') : false,
              notes: editor.notes ?? [],
              verification: editor.verification,
              verifying: editor.verifying === true,
              busy,
              setDraft: changeDraft,
              onCancel: closeEditor,
              onVerify: verifyDraft,
              onSave: saveDraft,
              credentialKeys: knownCredentialKeys
            }),
        confirming === null
          ? null
          : React.createElement(ConfirmDelete, {
              server: confirming,
              onCancel: () => setConfirming(null),
              onConfirm: () => remove(confirming)
            })
      )
    }

    function ConfirmDelete({ server, onCancel, onConfirm }) {
      if (Modal === undefined) {
        return React.createElement(
          'div',
          { className: 'dmm-notice' },
          `确认删除「${server.serverName}」？`,
          React.createElement('button', { type: 'button', className: 'dmm-button danger', onClick: onConfirm }, '删除')
        )
      }
      return React.createElement(
        Modal,
        { open: true, onClose: onCancel, className: 'dmm-dialog' },
        React.createElement(
          'div',
          { className: 'dmm-confirm' },
          React.createElement('div', { className: 'dmm-name' }, `删除「${server.serverName}」？`),
          React.createElement(
            'p',
            { className: 'dmm-hint' },
            '只会从托管清单里移除，并立即卸载它；已经写入的凭据不会被删除。'
          ),
          React.createElement(
            'div',
            { className: 'dmm-footer' },
            React.createElement('button', { type: 'button', className: 'dmm-button', onClick: onCancel }, '取消'),
            React.createElement('button', { type: 'button', className: 'dmm-button danger', onClick: onConfirm }, '删除')
          )
        )
      )
    }

    /** 生成本地唯一 id（与宿主 store.newServerId 语法一致）。 */
    function newId(taken) {
      const used = new Set(taken)
      for (let attempt = 0; attempt < 64; attempt += 1) {
        const candidate = `srv-${Math.random().toString(16).slice(2, 10)}`
        if (!used.has(candidate)) return candidate
      }
      return `srv-${Date.now().toString(16)}`
    }

    // ── 错误边界 ─────────────────────────────────────────────────────────

    class SectionErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        console.error('dsh-mcp-manager section failed:', error)
      }

      render() {
        if (this.state.error !== null) {
          return React.createElement(
            'div',
            { className: 'dmm-section' },
            React.createElement('div', { className: 'dmm-error' }, `MCP 服务器分区渲染失败：${String(this.state.error?.message ?? this.state.error)}`)
          )
        }
        return this.props.children
      }
    }

    // ── 样式与导航图标 ───────────────────────────────────────────────────

    /**
     * 样式由插件级持有：按 data-plugin + data-owner 打标 + 引用计数，
     * 避免 HMR 先卸旧 fiber 再挂新 fiber 时样式被提前摘掉。
     *
     * 注入必须**同步完成**，`ctx.effect` 只登记清理：把注入整块放进 effect 回调里，
     * 一旦宿主（或导航图标几何固定场景）没有运行该回调，样式就永远到不了文档，
     * 表现为「标记已打、CSS 未到」。dsh-extra-context 踩过同一个坑。
     */
    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      const owner = STYLE_OWNER
      const element = ensureStyleElement(owner)
      element.dataset.plugin = PLUGIN_ID
      if (element.textContent !== styleText) element.textContent = styleText
      incrementOwner(owner)
      if (typeof ctx.effect !== 'function') return
      ctx.effect(() => () => {
        if (decrementOwner(owner) > 0) return
        element.remove()
      }, `${PLUGIN_ID}: styles`)
    }

    function ownerKey(owner) {
      return `${PLUGIN_ID}:style-refs:${owner}`
    }

    function incrementOwner(owner) {
      const key = ownerKey(owner)
      const next = (window[key] ?? 0) + 1
      window[key] = next
      return next
    }

    function decrementOwner(owner) {
      const key = ownerKey(owner)
      const next = Math.max(0, (window[key] ?? 1) - 1)
      window[key] = next
      return next
    }

    function ensureStyleElement(owner) {
      const existing = document.querySelector(`style[data-plugin="${PLUGIN_ID}"][data-owner="${owner}"]`)
      if (existing !== null) return existing
      const element = document.createElement('style')
      element.setAttribute('data-owner', owner)
      document.head.appendChild(element)
      return element
    }


    /**
     * 设置页导航图标补丁：壳层 `navIcon(id)` 只认 4 个官方 id（models /
     * agent-presets / plugins / archived-sessions），其余一律回落齿轮，
     * 而 `settings.section` 的注册选项里没有 `icon`，所以只能做可逆的 DOM 补丁。
     * 壳层哪天支持在 slot 选项里声明图标，这段补丁就该整块删掉。
     *
     * 手法与 dsh-extra-context / dsh-chat-archive-manager 同款：原 svg 只做占位
     * （CSS 里隐藏），图标由 `::before` + mask 画出来，配色继续跟随壳层。
     */

    /** 取图标源码并补 xmlns（缺失时 data: URI 里的 SVG 会按 HTML 解析、mask 静默失效）。 */
    function navIconMaskSource(outerHtml) {
      const source = typeof outerHtml === 'string' ? outerHtml : ''
      if (source === '') return ''
      if (source.includes('xmlns=')) return source
      return source.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    function patchSettingsNavIcon(doc, sourceSvg, label) {
      const noop = () => {}
      if (doc === null || typeof doc !== 'object' || typeof doc.querySelectorAll !== 'function') return noop
      if (typeof sourceSvg !== 'string' || sourceSvg === '') return noop
      if (typeof label !== 'string' || label === '') return noop

      const mask = `url("data:image/svg+xml,${encodeURIComponent(sourceSvg)}")`
      const touched = new Set()

      const mark = () => {
        for (const button of doc.querySelectorAll('nav button')) {
          // 只认文本恰好等于本插件菜单名的那一行。
          if (button.textContent.trim() !== label || touched.has(button)) continue
          button.dataset[NAV_PATCH_FLAG] = ''
          button.dataset[NAV_PATCH_COUNT] = String(referenceCount(button.dataset[NAV_PATCH_COUNT]) + 1)
          button.style.setProperty(NAV_PATCH_MASK, mask)
          touched.add(button)
        }
      }

      mark()

      // 壳层重排导航（例如运行期有插件增删分区）会重建按钮，补丁要跟着补回来。
      // 只观察 childList/subtree：我们自己改的是属性和内联样式，不会自激。
      const view = doc.defaultView
      const Observer = view !== null && typeof view === 'object' && typeof view.MutationObserver === 'function' ? view.MutationObserver : null
      let observer = null
      if (Observer !== null && doc.body !== null && doc.body !== undefined) {
        observer = new Observer(mark)
        observer.observe(doc.body, { childList: true, subtree: true })
      }

      return () => {
        if (observer !== null) observer.disconnect()
        for (const button of touched) {
          const remaining = referenceCount(button.dataset[NAV_PATCH_COUNT]) - 1
          if (remaining > 0) {
            button.dataset[NAV_PATCH_COUNT] = String(remaining)
            continue
          }
          delete button.dataset[NAV_PATCH_FLAG]
          delete button.dataset[NAV_PATCH_COUNT]
          button.style.removeProperty(NAV_PATCH_MASK)
        }
        touched.clear()
      }
    }

    /** @param {unknown} value @returns {number} */
    function referenceCount(value) {
      const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }

    /** 从挂载点里的模板元素取图标源码并装上补丁（抽出来便于单独验证）。 */
    function installNavIconPatch(template, doc) {
      const svg = template !== null && template !== undefined && typeof template.querySelector === 'function' ? template.querySelector('svg') : null
      if (svg === null || svg === undefined || typeof svg.outerHTML !== 'string') return () => {}
      const source = navIconMaskSource(svg.outerHTML)
      if (source === '') return () => {}
      return patchSettingsNavIcon(doc, source, SECTION_LABEL)
    }

    /**
     * 补丁的隐形挂载点，注册在 `settings.action`：随设置面板挂载/卸载，
     * 因此补丁生命周期与面板一致，关掉面板就还原成壳层齿轮。
     * 布局阶段安装，避免先画一帧齿轮再换图标。
     */
    function McpNavIcon() {
      const templateRef = React.useRef(null)
      React.useLayoutEffect(() => {
        return installNavIconPatch(templateRef.current, typeof document === 'undefined' ? null : document)
      }, [])
      // 图标取不到（未来构建裁剪掉它）就什么都不渲染：导航继续用齿轮，绝不因补丁报错。
      if (typeof IconLinkOutline16 !== 'function') return null
      return React.createElement(
        'div',
        { ref: templateRef, className: 'dmm-nav-icon-template', 'aria-hidden': true },
        React.createElement(IconLinkOutline16, { size: 16 })
      )
    }

    // ── 装配 ─────────────────────────────────────────────────────────────

    /**
     * 依赖的客户端服务。
     *
     * `remote.credentials` 必须**单独声明**：客户端的 Cordis 里带点号的命名空间本身就是服务名，
     * 只写 `remote` 时读 `ctx.remote.credentials` 会抛
     * `cannot get property "remote.credentials" without inject`——而它是同步抛的，
     * 外面包 `ctx?.remote?.credentials` 也拦不住，表现就是"点保存完全没反应"（用户实测踩到）。
     * 官方同一套数据面的写法见 `dsh-client-ui-settings-plugins/lib/client.js` 的 inject 数组。
     */
    const inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']

    function apply(ctx) {
      const scope = typeof ctx.settingsScope?.bind === 'function'
        ? ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE, decode: decodeSettings })
        : null
      installStyles(ctx)
      const contextValue = { ctx, scope }
      const Section = () =>
        React.createElement(
          SectionErrorBoundary,
          null,
          React.createElement(
            SectionContext.Provider,
            { value: contextValue },
            React.createElement(McpManagerSection, null)
          )
        )
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: SECTION_LABEL
      }, Section))
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: NAV_ICON_ID,
        order: SECTION_ORDER
      }, McpNavIcon))
    }

    exports.inject = inject
    exports.apply = apply
    exports.__internals = Object.freeze({
      SectionErrorBoundary,
      McpManagerSection,
      ServerEditor,
      ServerDialog,
      VerificationLine,
      LiveLogs,
      emptyDraft,
      fromDraft,
      CredentialBox,
      ProfileTargets,
      decodeSettings,
      normalizeServer,
      parsePairs,
      formatPairs,
      parseArgs,
      credentialRefsOf,
      visibleNotes,
      splitCredential,
      joinCredential,
      recordToRows,
      rowsToRecord,
      rowState,
      runtimeText,
      endpointSummary,
      transportMeta,
      newId,
      patchSettingsNavIcon,
      STATUS_PATH,
      ACTION_PATH,
      CLIENT_HEADER,
      CSRF_HEADER,
      SETTINGS_NAMESPACE,
      SECTION_ID,
      SECTION_LABEL,
      styleText
    })

    return module.exports
  }
})
