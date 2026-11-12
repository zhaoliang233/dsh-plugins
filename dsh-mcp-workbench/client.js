/**
 * dsh-mcp-workbench 客户端半体（单文件 CJS 惰性 bundle，无构建步骤）。
 *
 * 职责：设置页「MCP 服务器」分区——官方 `@deepseek-ai/dsh-mcp-manager` 的
 * 管理界面：列表、编辑、启停、状态、重启、探测、凭据，以及旧版本本插件
 * 托管清单的迁移。
 *
 * 数据流（四条各自独立）：
 * 1. **清单真相 = 官方 mcp-manager 条目的 `config.servers`**（`Record<serverName, Entry>`），
 *    经 `ctx.configForms.get(<官方条目 id>)` 读写（带 revision 栅栏）；
 * 2. 运行态（连接状态、工具数、重连/失败原因）来自 `ctx.remote.mcpManager.watch()`；
 * 3. 探测 / 重启走 `ctx.remote.mcpManager.probe()/restart()`；
 * 4. 凭据值经 `ctx.remote.credentials` 写进 credentials 存储，
 *    条目值里只留 `${credential:KEY}` 模板。
 *
 * 官方条目 id 由宿主状态路由告诉客户端（浏览器侧拿不到「条目名 → 包名」的映射）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-mcp-workbench',
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

    const PLUGIN_ID = 'dsh-mcp-workbench'
    /**
     * 本插件在 profile 里的条目 id —— 仍保留这个条目，但它只承载「迁移源」
     * （旧版本的 `servers` 数组）与宿主侧版本门；服务器清单本身在官方条目里。
     */
    const SETTINGS_ENTRY = 'dsh-mcp-workbench'
    /** 官方 MCP 管理器包名与默认条目 id（探测不到真实 id 时的兜底）。 */
    const MANAGER_MODULE = '@deepseek-ai/dsh-mcp-manager'
    const DEFAULT_MANAGER_ENTRY = 'mcp-manager'
    const STATUS_PATH = '/dsh-mcp-workbench/status'
    const ACTION_PATH = '/dsh-mcp-workbench/action'
    const CLIENT_HEADER = 'x-dsh-mcp-workbench-client'
    const CSRF_HEADER = 'x-dsh-mcp-workbench-csrf'
    const SECTION_ID = 'mcp-console'
    const SECTION_LABEL = 'MCP 服务器'
    /**
     * 设置分区 order。DSH 自带分区是 account −10 / general 0 / models 10 / plugins 15 /
     * agent-presets 20，**插件分区一律 ≥ 100**：排在内置之后，不插队、也不与内置并列。
     * 同 slot 内各插件不复用同一档：extra-context 100 / local-plugin-manager 110 /
     * default-tuner 120 / 本包 130 / chat-archive-manager 140。
     */
    const SECTION_ORDER = 130
    const NAV_ICON_ID = 'mcp-console-nav-icon'
    const STYLE_OWNER = `${PLUGIN_ID}-v2`
    /**
     * 官方凭据模板语法：`${credential:KEY}`（`dsh-credentials` / `mcp-client` 的约定）。
     * 旧版本本插件用的是不带模板包装的 `credential:KEY`，只在迁移时识别。
     */
    const CREDENTIAL_TOKEN = /\$\{credential:([A-Za-z_][A-Za-z0-9_]*)\}/gu
    const CREDENTIAL_PREFIX = '${credential:'
    const CREDENTIAL_SUFFIX = '}'
    const LEGACY_CREDENTIAL_TOKEN = /(?<![\w$])credential:([A-Za-z_][A-Za-z0-9_]*)(?![\w}])/gu
    /** 官方 mcp-manager 的条目默认值（与 `ServerEntrySchema` 同源）。 */
    const DEFAULT_STARTUP_TIMEOUT_MS = 30000
    const DEFAULT_RECONNECT = { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 }
    const NAV_PATCH_FLAG = 'dmwNavIcon'
    const NAV_PATCH_COUNT = 'dmwNavIconReferences'
    const NAV_PATCH_MASK = '--dmw-nav-icon-mask'

    const styleText = `
.dmw-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:14px}
.dmw-heading{display:flex;align-items:center;gap:8px;min-height:32px}
.dmw-title{min-width:0;margin:0;font-size:16px;font-weight:500;line-height:24px;letter-spacing:0}
.dmw-count{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dmw-heading-spacer{flex:1}
.dmw-icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dmw-icon-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dmw-icon-button.danger{color:var(--dsw-alias-state-error-primary)}
.dmw-icon-button:disabled{opacity:.42;cursor:not-allowed;background:transparent}
.dmw-notice,.dmw-error{margin:0;padding:9px 11px;border-radius:6px;font-size:13px;line-height:20px;overflow-wrap:anywhere}
.dmw-notice{display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dmw-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.dmw-list{display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--dsw-alias-border-l2)}
.dmw-row{display:flex;flex-direction:column;min-width:0;padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dmw-row-line{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;min-width:0}
.dmw-title-block{display:flex;align-items:center;gap:7px;min-width:0}
/* 挂了 tooltip 的标题区：盒子照样铺满（气泡以它的中线居中，才不会探出面板），
   但整块不吃指针事件，只有那枚 tag 自己能悬停——触发区仍然只是 tag。 */
.dmw-title-block.tip{pointer-events:none}
.dmw-title-block.tip>.dmw-tip-trigger{pointer-events:auto}
.dmw-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;line-height:22px}
.dmw-badge{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;white-space:nowrap}
.dmw-badge.warn{color:var(--dsw-alias-state-warn-primary)}
.dmw-badge.off{color:var(--dsw-alias-label-tertiary)}
.dmw-meta{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dmw-endpoint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmw-namespace{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
.dmw-status{flex:none;padding:1px 7px;border-radius:5px;font-size:11px;line-height:17px;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);color:var(--dsw-alias-label-secondary)}
.dmw-status.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.dmw-status.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dmw-status.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.dmw-live-logs>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmw-live-logs[open]>summary{margin-bottom:6px}
/* 工具清单浮层的内容：官方 Tooltip 的气泡只负责底色/圆角，换行与滚动由这一层负责
   （气泡是 white-space:pre-line 且 pointer-events:none，尺寸必须自己约束）。 */
.dmw-tip-content{box-sizing:border-box;display:flex;flex-direction:column;gap:5px;min-width:0;padding:6px 7px;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:18px}
.dmw-tip-head{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dmw-tip-list{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.dmw-tip-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.dmw-actions{display:flex;align-items:center;gap:7px;flex:none}
.dmw-switch{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;flex:none;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background-color .15s ease}
.dmw-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.dmw-switch::after{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.22);transition:transform .15s ease}
.dmw-switch[aria-checked=true]::after{transform:translateX(16px)}
.dmw-switch:disabled{opacity:.42;cursor:not-allowed}
.dmw-editor{display:flex;flex-direction:column;gap:10px;margin-top:11px;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.dmw-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.dmw-field-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;min-width:0}
.dmw-label{display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmw-label-note{color:var(--dsw-alias-label-tertiary)}
.dmw-required{color:var(--dsw-alias-state-error-primary)}
.dmw-input,.dmw-textarea{width:100%;box-sizing:border-box;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px}
.dmw-textarea{min-height:64px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:19px}
.dmw-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
/* 行式键值编辑器（环境变量 / 请求头）：一行一张小卡片，字段逐行铺开，
   这样长键名、长地址都不会被截断（早先五个输入框挤一行，用户截图反馈看不全）。 */
.dmw-pairs{display:flex;flex-direction:column;gap:9px;min-width:0}
.dmw-pair{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.dmw-pair-head{display:flex;align-items:center;gap:8px;min-width:0}
.dmw-pair-name{flex:1 1 auto;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.dmw-fields{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:center;gap:8px 10px;min-width:0}
.dmw-field-line{display:contents}
.dmw-field-key{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;text-align:right}
.dmw-field-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.dmw-field-ctl>.dmw-input{flex:1 1 160px;min-width:0}
.dmw-select-wrap{position:relative;display:inline-flex;flex:none}
.dmw-select{box-sizing:border-box;height:34px;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;-webkit-appearance:none;appearance:none}
.dmw-select-caret{position:absolute;right:9px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--dsw-alias-label-secondary)}
.dmw-key-hints{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex:1 1 100%;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dmw-key-hints>.dmw-chip-button{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.dmw-label-line{display:flex;align-items:center;gap:6px}
.dmw-label-spacer{flex:1 1 auto}
/* 小按钮：与 dsh-extra-context 的「+ 添加规则」同尺寸（28px / 12px 字号），
   这样输入框旁边的小按钮和整行高度对得上，不会一高一低。 */
.dmw-btn-sm{flex:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dmw-btn-sm:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dmw-btn-sm:disabled{opacity:.45;cursor:default}
.dmw-icon-button.sm{width:26px;height:26px}
.dmw-value-prefix-group{display:flex;align-items:center;gap:6px;flex:1 1 42%;min-width:0}
.dmw-value-prefix-mode{flex:none;width:auto;min-width:104px;padding:6px 6px;font-size:12px}
.dmw-chip-button{flex:none;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dmw-chip-button:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dmw-chip-button.on{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-label-primary)}
.dmw-pair-add{align-self:flex-start;color:var(--dsw-alias-label-secondary)}
.dmw-hint-error{color:var(--dsw-alias-state-error-primary)}
.dmw-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dmw-button{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:5px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.dmw-button.primary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-layer-1)}
.dmw-button.danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:white}
.dmw-button:disabled{opacity:.5;cursor:not-allowed}
.dmw-radio-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dmw-radio{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px;cursor:pointer}
.dmw-checkline{display:flex;align-items:baseline;gap:7px;font-size:13px;line-height:20px;cursor:pointer}
.dmw-checkline>input{flex:none;align-self:center}
.dmw-checkline .dmw-hint{font-size:12px}
.dmw-cred{display:flex;flex-direction:column;gap:9px;padding:9px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2)}
.dmw-cred-row{display:flex;flex-direction:column;gap:6px;min-width:0}
.dmw-cred-head{display:flex;align-items:center;gap:7px;min-width:0}
.dmw-cred-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dmw-cred-input-row{display:flex;align-items:center;gap:8px;min-width:0}
.dmw-cred-input{flex:1 1 auto;min-width:0}
.dmw-targets{display:flex;flex-direction:column;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 5%,transparent);overflow:hidden}
.dmw-targets-head{display:flex;align-items:center;gap:8px;padding:10px 12px}
.dmw-targets-title{min-width:0;margin:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}
.dmw-targets-hint{margin-left:auto;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap}
.dmw-target{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 12px;border-top:1px solid var(--dsw-alias-border-l2)}
.dmw-target-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.dmw-target-name-line{display:flex;align-items:center;gap:7px;min-width:0}
.dmw-target-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px}
.dmw-target-endpoint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dmw-target-fields{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmw-nav-icon-template{display:none}
/* 0.2.2-alpha.3 起壳层把原图标包进 <span aria-hidden>：新结构要连包装层一起隐藏，旧结构保留兼容。 */
[data-dmw-nav-icon]>svg:first-child{display:none}
[data-dmw-nav-icon]>span[aria-hidden="true"]{display:none}
[data-dmw-nav-icon]>span[aria-hidden="true"] svg{display:none}
[data-dmw-nav-icon]::before{content:"";flex:none;width:16px;height:16px;background:currentColor;pointer-events:none;-webkit-mask:var(--dmw-nav-icon-mask) center/16px 16px no-repeat;mask:var(--dmw-nav-icon-mask) center/16px 16px no-repeat}
.dmw-empty,.dmw-loading{padding:30px 0;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dmw-loading{display:flex;align-items:center;justify-content:center;gap:8px}
.dmw-dialog{width:min(560px,calc(100vw - 32px));border-radius:8px}
.dmw-dialog .dmw-field,.dmw-dialog .dmw-field-row,.dmw-dialog .dmw-editor{margin:0;padding:0;background:transparent}
.dmw-form{display:flex;flex-direction:column;gap:10px;min-width:0;max-height:min(72vh,640px);overflow:auto}
.dmw-dialog-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dmw-dialog-inline{margin-top:12px;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;display:flex;flex-direction:column;gap:10px}
.dmw-dialog-title{font-size:14px;font-weight:500;line-height:22px}
.dmw-notes{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmw-verify{display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dmw-verify.ok{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-label-primary)}
.dmw-verify.failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.dmw-verify.stale{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dmw-confirm{display:flex;flex-direction:column;gap:8px;min-width:0}
.dmw-log{max-height:132px;overflow:auto;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:600px){.dmw-row-line{grid-template-columns:auto minmax(0,1fr)}.dmw-row-line .dmw-actions{grid-column:2;justify-content:flex-start}.dmw-target{grid-template-columns:minmax(0,1fr)}.dmw-targets-hint{white-space:normal}}
/* ── A 方案：卡片分组（680px 弹窗） ───────────────────────────────────── */
.dmw-dialog{width:min(680px,100%);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
/* 官方 Modal 的标题/说明结构固定，标题图标用伪元素补上，不另造弹窗。 */
.dmw-dialog h2{font-weight:600;letter-spacing:.01em}
.dmw-dialog h2::before{content:"";display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:-3px;background:var(--dsw-alias-label-secondary);-webkit-mask:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M2%203.1h12v4.1H2zM2%208.8h12v4.1H2z'%20fill='%23000'/%3E%3C/svg%3E") center/16px 16px no-repeat;mask:url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M2%203.1h12v4.1H2zM2%208.8h12v4.1H2z'%20fill='%23000'/%3E%3C/svg%3E") center/16px 16px no-repeat}
.dmw-dialog > div:first-child > p{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dmw-dialog .dmw-form{max-height:min(74vh,680px);padding:0 0 2px;gap:12px}
.dmw-card{display:flex;flex-direction:column;gap:12px;flex:none;min-width:0;padding:14px 15px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 94%,var(--dsw-alias-label-primary) 6%)}
.dmw-card-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;min-width:0}
.dmw-card-heading{flex:1 1 auto;min-width:0}
.dmw-card-title{display:flex;align-items:center;gap:7px;margin:0;font-size:12.5px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}
.dmw-card-desc{margin:3px 0 0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}
.dmw-card-extra{flex:none;margin-left:auto}
.dmw-card-body{display:flex;flex-direction:column;gap:12px;min-width:0}
.dmw-count{flex:none;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);font-size:10.5px;font-weight:500;line-height:17px;font-variant-numeric:tabular-nums}
.dmw-seg{display:inline-flex;align-items:center;gap:2px;padding:3px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.dmw-seg-option{position:relative;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:6px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;white-space:nowrap;cursor:pointer;transition:background-color .12s,color .12s}
.dmw-seg-option svg{flex:none;opacity:.85}
.dmw-seg-option:hover{color:var(--dsw-alias-label-secondary)}
.dmw-seg-option.on{background:color-mix(in srgb,var(--dsw-alias-bg-layer-3) 94%,var(--dsw-alias-label-primary) 6%);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.14)}
.dmw-seg-input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.dmw-seg-option:focus-within{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dmw-adv{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 94%,var(--dsw-alias-label-primary) 6%);overflow:hidden}
.dmw-adv>summary{display:flex;align-items:center;gap:9px;padding:13px 15px;cursor:pointer;list-style:none;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.dmw-adv>summary::-webkit-details-marker{display:none}
.dmw-adv>summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dmw-adv-title{flex:none;color:var(--dsw-alias-label-primary)}
.dmw-adv-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.dmw-adv-spacer{flex:1;min-width:4px}
.dmw-adv-caret{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dmw-adv[open] .dmw-adv-caret{transform:rotate(180deg)}
.dmw-adv-body{display:flex;flex-direction:column;gap:12px;padding:14px 15px;border-top:1px solid var(--dsw-alias-border-l1)}
.dmw-timeout-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dmw-timeout-input{width:100px;text-align:right;font-variant-numeric:tabular-nums}
.dmw-quick{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.dmw-quick .dmw-btn-sm{height:26px;padding:0 8px;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dmw-quick .dmw-btn-sm.on{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.dmw-cmd-preview{display:flex;align-items:center;gap:8px;min-width:0;padding:8px 10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font-size:11.5px}
.dmw-cmd-preview>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.dmw-cmd-label{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary)}
.dmw-cmd-preview code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:11px}
.dmw-input,.dmw-textarea,.dmw-select{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5}
.dmw-input{height:34px;padding:0 12px}
.dmw-textarea{min-height:72px;padding:8px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.65;resize:vertical}
.dmw-select{height:34px;padding:0 30px 0 12px;font-size:13px}
.dmw-input::placeholder,.dmw-textarea::placeholder{color:var(--dsw-alias-label-tertiary);opacity:1}
.dmw-input:focus-visible,.dmw-textarea:focus-visible,.dmw-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.dmw-label{font-size:11.5px;font-weight:500}
.dmw-field{gap:5px}
.dmw-label-note{font-size:10.5px;font-weight:400}
.dmw-hint{font-size:11px;line-height:1.55}
.dmw-pair{gap:8px;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.dmw-pair-head{gap:6px}
.dmw-pair-name{font-size:11.5px}
.dmw-pair .dmw-fields{gap:7px 10px}
.dmw-pair .dmw-field-key{font-size:11px}
.dmw-cred{gap:8px;padding:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dmw-cred-name{font-size:11.5px}
.dmw-cred-input-row .dmw-input{height:32px}
.dmw-dialog-footer{display:flex;align-items:center;gap:10px;flex-wrap:wrap;width:100%;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}
.dmw-footer-actions{display:flex;align-items:center;gap:8px;flex:none;margin-left:auto}
.dmw-foot-status{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:7px;padding:0;border:0;border-radius:0;background:transparent;font-size:11.5px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dmw-foot-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmw-foot-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none;opacity:.8}
.dmw-foot-status.run{color:var(--dsw-alias-label-secondary)}
.dmw-foot-status.ok{color:var(--dsw-alias-state-success-primary);background:transparent}
.dmw-foot-status.failed{color:var(--dsw-alias-state-error-primary);background:transparent}
.dmw-foot-status.stale{color:var(--dsw-alias-state-warn-primary);background:transparent}
.dmw-spinner{width:12px;height:12px;flex:none;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);animation:dmw-spin .7s linear infinite}
@keyframes dmw-spin{to{transform:rotate(360deg)}}
.dmw-button{min-height:34px;padding:0 15px;border-radius:var(--dsw-radius-md);font-size:12.5px;font-weight:500}
.dmw-chip-button.on{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 15%,transparent);color:var(--dsw-alias-label-primary)}
.dmw-field-ctl.dmw-field-ctl-wide{grid-column:1 / -1}
.dmw-host-warning{padding:9px 11px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
@media(max-width:600px){.dmw-card{padding:12px}.dmw-card-extra{width:100%;margin-left:0}.dmw-adv-hint{display:none}.dmw-dialog-footer{align-items:flex-start}.dmw-foot-status{flex:1 1 100%}.dmw-footer-actions{width:100%;justify-content:flex-end}}

`

    // ── 纯函数区（可在 node --test 下独立验证）────────────────────────────

    /** 把任意值收敛成可安全渲染的字符串。 */
    function asText(value) {
      return typeof value === 'string' ? value : ''
    }

    /**
     * 官方条目的解码：`config.servers` 是 `Record<serverName, Entry>`。
     * 任何缺字段都补默认值，绝不抛错。
     */
    function decodeServers(value) {
      const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
      const servers = source.servers
      if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return []
      return Object.keys(servers)
        .sort()
        .map((name) => normalizeServer(servers[name], name))
    }

    /**
     * 单个官方条目规范化（字段与宿主 store.normalizeEntry / mcp-manager 的
     * `McpManagedServerEntry` 对齐）。`id` 是本地展示用的稳定 key（= serverName）。
     */
    function normalizeServer(raw, fallbackName = '') {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const transport = source.transport === 'streamable-http' ? 'streamable-http' : 'stdio'
      const timeout = Number(source.toolCallTimeoutMs)
      const startup = Number(source.startupTimeoutMs)
      const close = Number(source.closeTimeoutMs)
      const name = asText(fallbackName) || asText(source.serverName)
      const reconnect = asRecord(source.reconnect)
      return {
        id: name,
        serverName: name,
        label: '',
        enabled: source.enabled !== false,
        transport,
        command: asText(source.command),
        args: Array.isArray(source.args) ? source.args.filter((item) => typeof item === 'string') : [],
        cwd: asText(source.cwd),
        env: asRecord(source.env),
        url: asText(source.url),
        headers: asRecord(source.headers),
        toolCallTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : 60000,
        startupTimeoutMs: Number.isFinite(startup) && startup > 0 ? Math.floor(startup) : DEFAULT_STARTUP_TIMEOUT_MS,
        closeTimeoutMs: Number.isFinite(close) && close > 0 ? Math.floor(close) : 0,
        reconnect: {
          enabled: reconnect.enabled !== false,
          initialDelayMs: Number(reconnect.initialDelayMs) > 0 ? Math.floor(Number(reconnect.initialDelayMs)) : DEFAULT_RECONNECT.initialDelayMs,
          maxDelayMs: Number(reconnect.maxDelayMs) > 0 ? Math.floor(Number(reconnect.maxDelayMs)) : DEFAULT_RECONNECT.maxDelayMs,
          maxAttempts: Number(reconnect.maxAttempts) > 0 ? Math.floor(Number(reconnect.maxAttempts)) : DEFAULT_RECONNECT.maxAttempts
        }
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
     * 把一个值拆成「前缀 + 凭据键 + 后缀」；值里没有 `${credential:` 时返回 null（= 直接填写）。
     *
     * 官方模板语法是 `${credential:KEY}`：键名必须合法，且模板可以出现在值中间
     * （例如 `https://…?token=${credential:TOKEN}`）。键名还没写完时把剩余文本
     * 放进 `key`，界面可以继续编辑；保存前由 `credentialKeyIssue` 报错。
     */
    function splitCredential(value) {
      const text = String(value ?? '')
      const at = text.indexOf(CREDENTIAL_PREFIX)
      if (at === -1) return null
      const rest = text.slice(at + CREDENTIAL_PREFIX.length)
      const valid = /^([A-Za-z_][A-Za-z0-9_]*)\}/u.exec(rest)
      if (valid !== null) {
        return { prefix: text.slice(0, at), key: valid[1], suffix: rest.slice(valid[1].length + 1) }
      }
      return { prefix: text.slice(0, at), key: rest.replace(/\}$/u, ''), suffix: '' }
    }

    /** 反向拼回要存进设置的值。 */
    function joinCredential(parts) {
      return `${parts?.prefix ?? ''}${CREDENTIAL_PREFIX}${parts?.key ?? ''}${CREDENTIAL_SUFFIX}${parts?.suffix ?? ''}`
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
        className: 'dmw-input dmw-value-prefix',
        type: 'text',
        value: custom ? value : '',
        placeholder: '自定义前缀',
        'aria-label': `${ariaLabel}前缀（自定义）`,
        onChange: (event) => onChange(event.target.value)
      })
      return React.createElement(
        'span',
        { className: 'dmw-value-prefix-group' },
        React.createElement(
          'select',
          {
            className: 'dmw-input dmw-value-prefix-mode',
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

    /** 键名不合法（模板里的键不是合法标识符）时给出可读原因。 */
    function credentialKeyIssue(parts) {
      if (parts === null) return ''
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parts.key)) return ''
      if (parts.key === '' && parts.suffix === '') return ''
      return '凭据键名要以字母或下划线开头，后面只能是字母、数字或下划线'
    }

    /**
     * 条目里引用到的凭据键（去重、保持出现顺序）。
     * 官方模板可以出现在 command/args/cwd/env/url/headers 六个位置，全都要算。
     */
    function credentialRefsOf(server) {
      const keys = []
      const values = [
        server?.command ?? '',
        ...(Array.isArray(server?.args) ? server.args : []),
        server?.cwd ?? '',
        server?.url ?? '',
        ...Object.values(server?.env ?? {}),
        ...Object.values(server?.headers ?? {})
      ]
      for (const value of values) {
        for (const match of String(value).matchAll(CREDENTIAL_TOKEN)) {
          if (!keys.includes(match[1])) keys.push(match[1])
        }
      }
      return keys
    }

    /**
     * 一行到底在说什么：先看宿主/管理器可用性，再看官方连接状态。
     * `live` 是 `ctx.remote.mcpManager.watch()` 里同名的 `McpManagedServerView`。
     * @returns {{tone:'error'|'warn'|'idle'|'ok', text:string, short?:string, detail?:string}}
     */
    function rowState(server, live, runtime, conflictNote) {
      if (runtime !== 'ready') return { tone: 'error', text: runtimeText(runtime), short: '宿主未就绪', detail: runtimeText(runtime) }
      if (typeof conflictNote === 'string' && conflictNote !== '') {
        return { tone: 'warn', text: conflictNote, short: '与配置文件重名', detail: conflictNote }
      }
      if (!server.enabled) return { tone: 'idle', text: '已停用', short: '已停用' }
      if (live === null || live === undefined) return { tone: 'idle', text: '等待连接状态', short: '等待状态' }
      const status = live.status ?? {}
      switch (status.state) {
        case 'connected':
          return status.toolCount > 0
            ? { tone: 'ok', text: `已连接，提供 ${status.toolCount} 个工具`, short: `已连接 · ${status.toolCount} 个工具` }
            : { tone: 'warn', text: '已连接，但该服务器未提供工具', short: '已连接 · 无工具', detail: '该服务器未提供工具' }
        case 'connecting':
          return { tone: 'warn', text: status.attempt > 0 ? `正在重试连接（第 ${status.attempt} 次失败后）` : '正在连接', short: '连接中' }
        case 'reconnecting':
          return {
            tone: 'warn',
            text: `重连等待中（${status.attempt}/${status.maxAttempts}）：${status.lastError ?? '原因未知'}`,
            short: `重连 ${status.attempt}/${status.maxAttempts}`,
            detail: status.lastError ?? ''
          }
        case 'waiting-credentials':
          return { tone: 'warn', text: `缺少凭据：${status.lastError}`, short: '缺凭据', detail: status.lastError }
        case 'disabled':
          return { tone: 'idle', text: '已停用', short: '已停用' }
        case 'closed':
          return { tone: 'idle', text: '已关闭', short: '已关闭' }
        case 'failed': {
          const reason =
            status.reason === 'gave-up'
              ? '重连次数用尽，已停止'
              : status.reason === 'reconnect-disabled'
                ? '连接已断开，且未启用自动重连'
                : status.reason === 'load'
                  ? '配置加载失败'
                  : status.reason === 'cleanup'
                    ? '清理未完成，重启宿主才能恢复'
                    : '连接无法继续'
          const detail = status.lastError ?? status.result?.cleanupError ?? ''
          return { tone: 'error', text: detail === '' ? reason : `${reason}：${detail}`, short: '连接失败', detail: detail === '' ? reason : `${reason}：${detail}` }
        }
        default:
          return { tone: 'idle', text: '状态未知', short: '状态未知' }
      }
    }

    /**
     * 把失败原因压成列表能用的短标签（全文在弹窗里）。
     * @param {string} reason
     * @returns {string}
     */
    function shortReason(reason) {
      if (/凭据/u.test(reason)) return '缺凭据'
      if (/已被/u.test(reason) && /使用/u.test(reason)) return '名字被占用'
      if (/重复/u.test(reason)) return '名字重复'
      if (/必须填写/u.test(reason) || /必须是/u.test(reason)) return '配置不完整'
      if (/URL|无法解析|http/u.test(reason)) return 'URL 有问题'
      return '未生效 · 点编辑看原因'
    }

    function runtimeText(runtime) {
      if (runtime === 'unsupported-dsh') return '当前 DSH 版本不在本插件支持的范围内，未装配'
      if (runtime === 'manager-missing') return '没有找到官方 MCP 管理器（需要 DSH 0.2.2-rc.2 及以上，且 mcp-manager 条目已启用）'
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

    /**
     * 订阅一个 `configForm`（官方条目或本插件旧条目）并返回解码后的快照。
     * @param {any} controller `ctx.configForms.get(id)`，可为 null
     * @param {(value: any) => any} decode 把原始 value 解成界面模型
     */
    function useConfigForm(controller, decode) {
      const [snapshot, setSnapshot] = React.useState(() => (controller === null || controller === undefined ? undefined : decode(controller.getSnapshot?.()?.value)))
      React.useEffect(() => {
        if (controller === null || controller === undefined) return undefined
        const sync = () => setSnapshot(decode(controller.getSnapshot()?.value))
        sync()
        return controller.subscribe(sync)
      }, [controller, decode])
      return snapshot
    }

    /**
     * 一次原子写入：`ops` 按顺序落在同一个 revision 栅栏里。
     *
     * `mutate` 用返回值表示"宿主是否接受"，被拒时**不抛错**；漏掉这层判断
     * 会让界面把"没写进去"当成功（随后的状态刷新才暴露）。
     * @returns {Promise<boolean>}
     */
    async function writeConfig(ctx, controller, ops, onError) {
      if (controller === null || controller === undefined) {
        onError?.('设置接口不可用：目标条目没有可写的设置 schema（请看宿主日志）')
        return false
      }
      try {
        const accepted = await controller.mutate(ops)
        if (accepted === false) {
          onError?.('写入被宿主拒绝：目标条目当前不可写（刷新页面重试，或看宿主日志）。')
          return false
        }
        return true
      } catch (error) {
        onError?.(`写入失败：${String(error?.message ?? error)}`)
        return false
      }
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
          const panel = typeof anchor.closest === 'function' ? anchor.closest('.dmw-section') : null
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
        { className: 'dmw-tip-content', style: { maxHeight: `${bounds.maxHeight}px` } },
        React.createElement('div', { className: 'dmw-tip-head' }, `共 ${tools.length} 个工具${scrollable ? ' · 滚轮滚动' : ''}`),
        React.createElement(
          'div',
          { className: 'dmw-tip-list', ref: attachList },
          tools.map((name) => React.createElement('div', { key: name, className: 'dmw-tip-name' }, name))
        )
      )

      // 拿不到官方组件（理论上不该发生：primitives 是 boot graph 的 seed）时退化成纯标签，
      // 而不是抛异常把整个分区打崩。
      const plain = React.createElement('div', { className: 'dmw-title-block' }, nameNode, namespaceNode, tag)
      if (typeof Tooltip !== 'function') return plain

      return React.createElement(
        Tooltip,
        {
          label,
          side: bounds.side,
          maxWidth: bounds.maxWidth,
          children: React.createElement(
            'div',
            { className: 'dmw-title-block tip', ref: wrapRef },
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
     * 工具数来自官方 `watch` 的 `toolCount`（没有工具名清单，名字要 probe 才拿得到）；
     * 传输方式、命令/URL、环境变量与请求头、超时、失败原因全部收进编辑弹窗。
     */
    function ServerRow({ server, live, conflictNote, runtime, onToggle, onEdit, onDelete, busy }) {
      const state = rowState(server, live, runtime, conflictNote)
      const namespace = `mcp__${server.serverName}__`
      const tag = React.createElement(
        'span',
        { className: `dmw-status ${state.tone}`, title: state.text },
        state.short ?? state.text
      )
      const nameNode = React.createElement('span', { className: 'dmw-name', title: server.serverName }, server.serverName)
      const namespaceNode = React.createElement('code', { className: 'dmw-namespace' }, namespace)

      return React.createElement(
        'div',
        { className: 'dmw-row' },
        React.createElement(
          'div',
          { className: 'dmw-row-line' },
          // 左：启停开关
          React.createElement('button', {
            type: 'button',
            className: 'dmw-switch',
            role: 'switch',
            'aria-checked': server.enabled ? 'true' : 'false',
            'aria-label': `${server.enabled ? '停用' : '启用'} ${server.serverName}`,
            disabled: busy,
            onClick: () => onToggle(server)
          }),
          // 中：名字 + 工具命名空间 + 状态 tag
          React.createElement('div', { className: 'dmw-title-block' }, nameNode, namespaceNode, tag),
          // 右：编辑 / 删除
          React.createElement(
            'div',
            { className: 'dmw-actions' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmw-icon-button',
                'aria-label': `编辑 ${server.serverName}`,
                onClick: () => onEdit(server)
              },
              React.createElement(IconEditOutline16, { size: 16 })
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmw-icon-button danger',
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
        label: server.label ?? '',
        serverName: server.serverName,
        transport: server.transport,
        command: server.command,
        argsText: server.args.join('\n'),
        cwd: server.cwd,
        envRows: recordToRows(server.env),
        url: server.url,
        headerRows: recordToRows(server.headers),
        toolCallTimeoutMs: String(server.toolCallTimeoutMs),
        startupTimeoutMs: String(server.startupTimeoutMs)
      }
    }

    /**
     * 草稿 → 官方条目记录（写进 `config.servers.<name>` 的值）。
     * `label`/`id` 只属于界面，不写回设置。
     */
    function fromDraft(draft) {
      const timeout = Number(draft.toolCallTimeoutMs)
      const startup = Number(draft.startupTimeoutMs)
      return {
        transport: draft.transport,
        command: draft.command.trim(),
        args: parseArgs(draft.argsText),
        cwd: draft.cwd.trim(),
        env: rowsToRecord(draft.envRows),
        url: draft.url.trim(),
        headers: rowsToRecord(draft.headerRows),
        enabled: draft.enabled !== false,
        ...(Number.isFinite(timeout) && timeout > 0 ? { toolCallTimeoutMs: Math.floor(timeout) } : {}),
        startupTimeoutMs: Number.isFinite(startup) && startup > 0 ? Math.floor(startup) : DEFAULT_STARTUP_TIMEOUT_MS,
        reconnect: { ...DEFAULT_RECONNECT }
      }
    }

    /**
     * 新条目的初始草稿。刻意在**弹窗里**才生成、保存成功后才写进官方设置——
     * 点「+」不直接落一条空条目，避免留下一条永远连不上的垃圾配置。
     */
    function emptyDraft(id) {
      return {
        id,
        enabled: true,
        label: '',
        // 服务器名留空、给占位符：它是官方 dict 的 key，直接决定工具前缀。
        serverName: '',
        transport: 'stdio',
        command: '',
        argsText: '',
        cwd: '',
        envRows: [],
        url: '',
        headerRows: [],
        toolCallTimeoutMs: '60000',
        startupTimeoutMs: String(DEFAULT_STARTUP_TIMEOUT_MS)
      }
    }

    /**
     * 表单里的一行：左边小标题、右边控件。
     *
     * 外层必须包一层 `FieldGroup`（`.dmw-fields`）——它才是真正的 grid，
     * `FieldLine` 自身 `display:contents` 把两个 span 直接塞进父 grid，
     * 于是**同一组里的标签列同宽、所有输入框左边缘对齐**。
     * 早先每行各自成 grid，标签长度不同导致输入框一个个错开（用户截图："看起来这么乱"）。
     */
    function FieldLine({ label, children }) {
      return React.createElement(
        'div',
        { className: 'dmw-field-line' },
        React.createElement('span', { className: 'dmw-field-key' }, label),
        React.createElement('span', { className: 'dmw-field-ctl' }, children)
      )
    }

    /** 一组字段行：共享标签列的 grid 容器。 */
    function FieldGroup({ children }) {
      return React.createElement('div', { className: 'dmw-fields' }, children)
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
          { className: 'dmw-select-wrap' },
          React.createElement(
            'select',
            {
              className: 'dmw-select',
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
          React.createElement(IconChevronDownOutline14, { size: 14, className: 'dmw-select-caret' })
        ),
        custom
          ? React.createElement('input', {
              className: 'dmw-input',
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
          className: 'dmw-input',
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
              { className: 'dmw-key-hints' },
              '用过的键：',
              candidates.map((key) =>
                React.createElement(
                  'button',
                  {
                    key,
                    type: 'button',
                    className: 'dmw-chip-button',
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
    function ValueEditor({ value, onChange, keys, prefixMode, ariaLabel, placeholder, prefixHint, emptyPrefixHint, valueLabel, hideValueLabel }) {
      const parts = splitCredential(value)
      const set = (patch) => onChange(joinCredential({ ...parts, ...patch }))
      if (parts === null) {
        const input = React.createElement('input', {
          className: 'dmw-input',
          type: 'text',
          value: String(value ?? ''),
          placeholder: placeholder ?? '值',
          'aria-label': ariaLabel,
          onChange: (event) => onChange(event.target.value)
        })
        // URL 的字段标签已经写明「服务器 URL」，直接填写时不再重复一个「地址」标签；
        // 输入框跨满两列，和上面的标签栏对齐。
        if (hideValueLabel === true) {
          return React.createElement(
            'div',
            { className: 'dmw-field-line dmw-field-line-wide' },
            React.createElement('span', { className: 'dmw-field-ctl dmw-field-ctl-wide' }, input)
          )
        }
        return React.createElement(FieldLine, { label: valueLabel ?? '值' }, input)
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
                  className: 'dmw-input',
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
                className: 'dmw-input',
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
        { className: 'dmw-pairs' },
        rows.map((row, index) => {
          const parts = splitCredential(row.value)
          const credential = parts !== null
          return React.createElement(
            'div',
            { className: 'dmw-pair', key: index },
            React.createElement(
              'div',
              { className: 'dmw-pair-head' },
              React.createElement('input', {
                className: 'dmw-input dmw-pair-name',
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
                  className: `dmw-chip-button${credential ? ' on' : ''}`,
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
                  className: 'dmw-icon-button sm',
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
          { type: 'button', className: 'dmw-btn-sm dmw-pair-add', 'aria-label': `添加${label}`, onClick: add },
          `+ 添加${kind === 'env' ? '环境变量' : '请求头'}`
        ),
        issues.length === 0 ? null : React.createElement('span', { className: 'dmw-hint dmw-hint-error' }, issues[0])
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
      const rows = isHttp ? (draft.headerRows ?? []) : (draft.envRows ?? [])
      // 空名字时保留原来的静态提示（GUI 验收也按这段文案断言）；一旦开始输入就变成实时前缀。
      const prefixName = String(draft.serverName ?? '').trim() || '<名字>'
      const timeoutMs = Number(draft.toolCallTimeoutMs)
      const timeoutText =
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? timeoutMs % 1000 === 0
            ? `${timeoutMs / 1000} 秒`
            : `${timeoutMs} 毫秒`
          : '未设置'
      const commandText = String(draft.command ?? '').trim()
      const commandPreview = commandText === '' ? '' : [commandText, ...parseArgs(draft.argsText)].join(' ')

      const cardHead = (title, desc, extra, count) =>
        React.createElement(
          'div',
          { className: 'dmw-card-head' },
          React.createElement(
            'div',
            { className: 'dmw-card-heading' },
            React.createElement(
              'h3',
              { className: 'dmw-card-title' },
              title,
              count === undefined ? null : React.createElement('span', { className: 'dmw-count' }, `${count} 项`)
            ),
            React.createElement('p', { className: 'dmw-card-desc' }, desc)
          ),
          extra === undefined || extra === null
            ? null
            : React.createElement('div', { className: 'dmw-card-extra' }, extra)
        )

      // 传输方式仍然用两个原生 radio（键盘/读屏语义不变，测试也按 radio 顺序操作），
      // 只是外面套一层分段控件的外观。
      const transportOption = (value, label, Icon) =>
        React.createElement(
          'label',
          { className: `dmw-seg-option${draft.transport === value ? ' on' : ''}` },
          React.createElement('input', {
            type: 'radio',
            name: `dmw-transport-${draft.id}`,
            className: 'dmw-seg-input',
            checked: draft.transport === value,
            onChange: () => setValue('transport', value)
          }),
          React.createElement(Icon, { size: 14 }),
          React.createElement('span', null, label)
        )

      const transport = React.createElement(
        'div',
        { className: 'dmw-seg', role: 'group', 'aria-label': '传输方式' },
        transportOption('stdio', '本地进程', IconCodeOutline16),
        transportOption('streamable-http', '远程服务', IconLinkOutline16)
      )

      const serverName = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement(
          'span',
          { className: 'dmw-label' },
          '服务器名',
          React.createElement('span', { className: 'dmw-required' }, ' *'),
          // 文案与运行时同源：工具全名就是 mcp__<服务器名>__<工具名>（见行上的命名空间 chip）。
          React.createElement('span', { className: 'dmw-label-note' }, `(工具前缀为 mcp__${prefixName}__)`)
        ),
        React.createElement('input', {
          className: 'dmw-input',
          type: 'text',
          placeholder: '例如 github',
          'aria-label': '服务器名',
          ...field('serverName')
        })
      )

      const labelField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '备注名'),
        React.createElement('input', {
          className: 'dmw-input',
          type: 'text',
          placeholder: '例如 GitHub',
          'aria-label': '备注名',
          ...field('label')
        })
      )

      const commandField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '命令', React.createElement('span', { className: 'dmw-required' }, ' *')),
        React.createElement('input', {
          className: 'dmw-input',
          type: 'text',
          placeholder: 'npx、uvx、node、python…',
          'aria-label': '命令',
          ...field('command')
        })
      )

      const argsField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '参数（每行一个）'),
        React.createElement('textarea', {
          className: 'dmw-textarea',
          placeholder: '-y\n@modelcontextprotocol/server-github',
          'aria-label': '参数（每行一个）',
          ...field('argsText')
        })
      )

      const cwdField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '工作目录'),
        React.createElement('input', {
          className: 'dmw-input',
          type: 'text',
          placeholder: '~/code（可留空）',
          'aria-label': '工作目录',
          ...field('cwd')
        })
      )

      const commandPreviewNode =
        commandPreview === ''
          ? null
          : React.createElement(
              'div',
              { className: 'dmw-cmd-preview' },
              React.createElement(IconCodeOutline16, { size: 14 }),
              React.createElement('span', { className: 'dmw-cmd-label' }, '启动预览'),
              React.createElement('code', { title: commandPreview }, commandPreview)
            )

      const stdioPane = React.createElement(
        React.Fragment,
        null,
        commandField,
        argsField,
        cwdField,
        commandPreviewNode
      )

      const urlField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement(
          'span',
          { className: 'dmw-label dmw-label-line' },
          '服务器 URL',
          React.createElement('span', { className: 'dmw-required' }, ' *'),
          React.createElement('span', { className: 'dmw-label-spacer' }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: `dmw-chip-button${splitCredential(draft.url) === null ? '' : ' on'}`,
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
        React.createElement(
          FieldGroup,
          null,
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
            hideValueLabel: true,
            prefixHint: '地址前段',
            emptyPrefixHint: '可留空：整条地址都进凭据库时'
          })
        )
      )

      const timeoutField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '单次调用超时（毫秒）'),
        React.createElement(
          'div',
          { className: 'dmw-timeout-row' },
          React.createElement('input', {
            className: 'dmw-input dmw-timeout-input',
            type: 'text',
            'aria-label': '单次调用超时（毫秒）',
            ...field('toolCallTimeoutMs')
          }),
          React.createElement(
            'div',
            { className: 'dmw-quick' },
            [30000, 60000, 120000].map((ms) =>
              React.createElement(
                'button',
                {
                  key: ms,
                  type: 'button',
                  className: `dmw-btn-sm${String(ms) === String(draft.toolCallTimeoutMs) ? ' on' : ''}`,
                  onClick: () => setValue('toolCallTimeoutMs', String(ms))
                },
                `${ms / 1000} 秒`
              )
            )
          )
        )
      )

      const startupField = React.createElement(
        'div',
        { className: 'dmw-field' },
        React.createElement('span', { className: 'dmw-label' }, '启动超时（毫秒）'),
        React.createElement(
          'div',
          { className: 'dmw-timeout-row' },
          React.createElement('input', {
            className: 'dmw-input dmw-timeout-input',
            type: 'text',
            'aria-label': '启动超时（毫秒）',
            ...field('startupTimeoutMs')
          }),
          React.createElement(
            'div',
            { className: 'dmw-quick' },
            [15000, 30000, 60000].map((ms) =>
              React.createElement(
                'button',
                {
                  key: ms,
                  type: 'button',
                  className: `dmw-btn-sm${String(ms) === String(draft.startupTimeoutMs) ? ' on' : ''}`,
                  onClick: () => setValue('startupTimeoutMs', String(ms))
                },
                `${ms / 1000} 秒`
              )
            )
          )
        )
      )

      const advanced = React.createElement(
        'details',
        { className: 'dmw-adv' },
        React.createElement(
          'summary',
          null,
          React.createElement('span', { className: 'dmw-adv-title' }, '高级设置'),
          React.createElement(
            'span',
            { className: 'dmw-adv-hint' },
            `调用超时 ${timeoutText} · 启动超时 ${Number(draft.startupTimeoutMs) > 0 ? `${Number(draft.startupTimeoutMs) / 1000} 秒` : '未设置'}`
          ),
          React.createElement('span', { className: 'dmw-adv-spacer' }),
          React.createElement(IconChevronDownOutline14, { size: 14, className: 'dmw-adv-caret' })
        ),
        React.createElement(
          'div',
          { className: 'dmw-adv-body' },
          timeoutField,
          startupField,
          React.createElement(
            'span',
            { className: 'dmw-hint' },
            '启动超时覆盖「解析模板 + 连接 + 首次工具发现」的总预算；重连策略沿用官方默认（500ms 起、最长 30 秒、单次中断最多 10 次）。'
          )
        )
      )

      return React.createElement(
        'div',
        { className: 'dmw-form' },
        React.createElement(
          'section',
          { className: 'dmw-card' },
          cardHead('基本信息', '服务器名决定工具前缀，备注名只影响列表显示。'),
          React.createElement('div', { className: 'dmw-field-row' }, serverName, labelField)
        ),
        React.createElement(
          'section',
          { className: 'dmw-card' },
          cardHead('连接方式', '用命令启动本地进程，或连接已经运行的远程服务。', transport),
          React.createElement('div', { className: 'dmw-card-body' }, isHttp ? urlField : stdioPane)
        ),
        React.createElement(
          'section',
          { className: 'dmw-card' },
          cardHead(
            isHttp ? '请求头' : '环境变量',
            isHttp ? '请求远程端点时附带的 HTTP 头；密钥建议用「凭据」引用。' : '传给 MCP 子进程的环境变量；密钥建议用「凭据」引用。',
            undefined,
            rows.length
          ),
          React.createElement(
            'div',
            { className: 'dmw-card-body' },
            React.createElement(PairEditor, {
              kind: isHttp ? 'headers' : 'env',
              rows,
              onChange: (next) => setValue(isHttp ? 'headerRows' : 'envRows', next),
              keys: keyOptions
            }),
            React.createElement(
              'span',
              { className: 'dmw-hint' },
              '密钥点「凭据」：键名自己取，值存进凭据库、界面不回显、可多处复用；直接填写的值会明文存进设置文件。'
            ),
            refs.length === 0 ? null : React.createElement(CredentialBox, { refs, section })
          )
        ),
        advanced
      )
    }

    /**
     * 新增/编辑弹窗：表单 + 取消/保存。
     *
     * 保存语义跟随官方管理器：写入 `config.servers` 并立即生效；若用户要「先验证」，
     * 保存时会先以停用态写入、调用官方 `probe` 探测，通过后再启用（失败则保持停用
     * 并把原因留在弹窗里，配置不丢）。
     */
    function ServerDialog({ mode, draft, verification, verifying, busy, notes, runtime, setDraft, onCancel, onSave, credentialKeys }) {
      const footer = React.createElement(
        'div',
        { className: 'dmw-dialog-footer' },
        React.createElement(FooterStatus, { verifying, verification }),
        React.createElement(
          'div',
          { className: 'dmw-footer-actions' },
          React.createElement(
            'button',
            { type: 'button', className: 'dmw-button', 'aria-label': '取消', disabled: verifying, onClick: onCancel },
            '取消'
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dmw-button primary',
              'aria-label': '保存',
              disabled: busy || verifying || runtime !== 'ready',
              title: runtime !== 'ready' ? runtimeText(runtime) : undefined,
              onClick: onSave
            },
            verifying ? '验证并保存中…' : '保存'
          )
        )
      )
      const body = React.createElement(
        'div',
        { className: 'dmw-dialog-body' },
        visibleNotes(notes).length > 0
          ? React.createElement(
              'div',
              { className: 'dmw-notes' },
              visibleNotes(notes).map((note, index) => React.createElement('div', { key: index }, note))
            )
          : null,
        React.createElement(ServerEditor, { draft, setDraft, busy, verifying, verification, credentialKeys })
      )
      const title = mode === 'edit' ? '编辑 MCP 服务器' : '新增 MCP 服务器'
      if (typeof Modal !== 'function') {
        // 拿不到官方 Modal 时退化成页面内表单，功能不丢（但不再有遮罩）
        return React.createElement(
          'div',
          { className: 'dmw-dialog-inline', role: 'dialog', 'aria-label': title },
          React.createElement('div', { className: 'dmw-dialog-title' }, title),
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
          description: '保存会写入官方 MCP 管理器的服务器清单并立即生效；连接状态在列表里显示，不需要重启。',
          className: 'dmw-dialog',
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
        { className: 'dmw-live-logs' },
        React.createElement('summary', null, `最近日志（${logs.length} 条）`),
        React.createElement('div', { className: 'dmw-log' }, logs.join('\n'))
      )
    }

    /**
     * 底部状态条：把「保存 = 先验证」讲清楚，验证中 / 成功 / 失败都在同一处反馈。
     *
     * 保留 `dmw-verify` 这个 class：真机验收脚本按它读失败原因（旧版在表单末尾，
     * 现在挪到底部，选择器不变）。
     */
    function FooterStatus({ verifying, verification }) {
      const node = (tone, text, spinner, title) =>
        React.createElement(
          'div',
          { className: `dmw-verify dmw-foot-status ${tone}`, title },
          spinner === true
            ? React.createElement('span', { className: 'dmw-spinner' })
            : React.createElement('span', { className: 'dmw-foot-dot' }),
          React.createElement('span', { className: 'dmw-foot-text' }, text)
        )
      if (verifying === true) return node('run', '正在写入并连接探测…', true)
      if (verification === null || verification === undefined || verification.status === 'idle') {
        return node('', '保存会写入官方 MCP 管理器；勾选「先验证」时先探测、通过才启用')
      }
      if (verification.status === 'failed') {
        const error = verification.error ?? '原因未知'
        return node('failed', `验证失败：${error}`, false, `验证失败：${error}`)
      }
      const tools = verification.tools ?? []
      return node(
        'ok',
        tools.length === 0 ? '连接成功 · 该服务器没有提供工具' : `连接成功 · ${tools.length} 个工具`
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
        { className: 'dmw-cred' },
        React.createElement('span', { className: 'dmw-label' }, '引用的凭据'),
        state.error === '' ? null : React.createElement('div', { className: 'dmw-error' }, state.error),
        refs.map((ref) => {
          const info = state.entries?.[ref]
          const configured = info?.configured === true
          const writable = info?.writable !== false
          return React.createElement(
            'div',
            { key: ref, className: 'dmw-cred-row' },
            // 第一行：键名 + 状态小标签（"未配置"是状态，不该长成一句说明）
            React.createElement(
              'div',
              { className: 'dmw-cred-head' },
              React.createElement('span', { className: 'dmw-cred-name', title: ref }, ref),
              React.createElement(
                'span',
                { className: `dmw-status ${configured ? 'ok' : 'warn'}` },
                configured ? `已配置 · ${info?.source ?? 'credentials'}` : '未配置'
              ),
              writable ? null : React.createElement('span', { className: 'dmw-status' }, '只读来源')
            ),
            // 第二行：输入框与两个小按钮同一行、垂直居中对齐
            React.createElement(
              'div',
              { className: 'dmw-cred-input-row' },
              React.createElement('input', {
                className: 'dmw-input dmw-cred-input',
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
                  className: 'dmw-btn-sm',
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
                  className: 'dmw-btn-sm',
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
     *   混用同一套 `.dmw-row` 会让这一块看起来像"另一批可编辑条目"。
     */
    function ProfileTargets({ rows, onImport, busy }) {
      if (!Array.isArray(rows) || rows.length === 0) return null
      return React.createElement(
        'section',
        { className: 'dmw-targets' },
        React.createElement(
          'div',
          { className: 'dmw-targets-head' },
          React.createElement('h3', { className: 'dmw-targets-title' }, '配置文件中的服务器'),
          React.createElement('span', { className: 'dmw-badge' }, `${rows.length} 个`),
          React.createElement('span', { className: 'dmw-targets-hint' }, '只读 · 值不显示')
        ),
        rows.map((row) =>
          React.createElement(
            'div',
            { key: row.entryId, className: 'dmw-target' },
            React.createElement(
              'div',
              { className: 'dmw-target-copy' },
              React.createElement(
                'div',
                { className: 'dmw-target-name-line' },
                React.createElement('span', { className: 'dmw-target-name' }, row.serverName || row.entryId),
                React.createElement('span', { className: 'dmw-badge' }, row.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
                row.enabled ? null : React.createElement('span', { className: 'dmw-badge off' }, '已停用')
              ),
              row.endpoint === ''
                ? null
                : React.createElement('div', { className: 'dmw-target-endpoint', title: row.endpoint }, row.endpoint),
              fieldSummary(row) === ''
                ? null
                : React.createElement('div', { className: 'dmw-target-fields' }, fieldSummary(row))
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dmw-button',
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

    /**
     * 调官方 `probe` 探测一个已写入清单的服务器（不注册工具、不抢命名空间）。
     * @returns {{ok: true, tools: string[]} | {ok: false, error: string}}
     */
    async function probeServer(ctx, name) {
      try {
        const manager = ctx?.remote?.mcpManager
        if (typeof manager?.probe !== 'function') return { ok: false, error: '宿主没有挂载官方 MCP 管理器' }
        const result = await manager.probe(name)
        if (result?.ok !== true) {
          return { ok: false, error: String(result?.error?.message ?? result?.error ?? '探测被拒绝') }
        }
        const value = result.value ?? {}
        if (value.ok !== true) {
          const stage = value.stage === 'list' ? '列出工具' : '连接'
          return { ok: false, error: `${stage}失败：${String(value.message ?? '原因未知')}` }
        }
        return { ok: true, tools: Array.isArray(value.toolNames) ? value.toolNames : [] }
      } catch (cause) {
        return { ok: false, error: String(cause?.message ?? cause) }
      }
    }

    /**
     * 保存前的本地校验：与官方 mcp-manager 的写时校验同口径（名字、传输必填项、URL、
     * 凭据键名）。官方仍会再校验一次，这里只负责把问题提前说清楚。
     * @returns {string[]}
     */
    function validateDraft(draft, name, servers, originalName) {
      const issues = []
      if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) {
        issues.push('服务器名必须是 1-32 位的字母、数字、下划线或短横线')
      } else if (servers.some((item) => item.serverName === name && item.serverName !== originalName)) {
        issues.push(`服务器名「${name}」已被另一个条目占用`)
      }
      if (draft.transport === 'stdio') {
        if (String(draft.command ?? '').trim() === '') issues.push('stdio 传输必须填写可执行命令')
      } else {
        const url = String(draft.url ?? '').trim()
        if (url === '') {
          issues.push('streamable-http 传输必须填写 URL')
        } else if (!url.includes(CREDENTIAL_PREFIX)) {
          try {
            const parsed = new URL(url)
            if (!/^https?:$/u.test(parsed.protocol)) issues.push('URL 只支持 http/https')
          } catch {
            issues.push(`URL「${url}」无法解析`)
          }
        }
      }
      const texts = [
        draft.command,
        draft.cwd,
        draft.url,
        ...parseArgs(draft.argsText),
        ...Object.values(rowsToRecord(draft.envRows)),
        ...Object.values(rowsToRecord(draft.headerRows))
      ]
      const template = /\$\{credential:([^}]*)\}/gu
      const unclosed = /\$\{credential:[^}]*$/u
      for (const value of texts) {
        const text = String(value ?? '')
        for (const match of text.matchAll(template)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(match[1])) issues.push(`凭据键名「${match[1]}」不合法`)
        }
        if (unclosed.test(text)) issues.push('凭据模板没有闭合（缺少 }）')
      }
      return issues
    }

    /** 旧版本条目（`credential:KEY`）→ 官方条目（`${credential:KEY}`）。 */
    function legacyToManaged(legacy, fallbackName) {
      const source = legacy !== null && typeof legacy === 'object' ? legacy : {}
      const convert = (value) =>
        String(value ?? '').replace(LEGACY_CREDENTIAL_TOKEN, (_whole, key) => `${CREDENTIAL_PREFIX}${key}${CREDENTIAL_SUFFIX}`)
      const name = String(source.serverName ?? '').trim() || fallbackName || ''
      const entry = {
        serverName: name,
        transport: source.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
        command: convert(source.command),
        args: Array.isArray(source.args) ? source.args.map(convert) : [],
        cwd: convert(source.cwd),
        env: Object.fromEntries(Object.entries(asRecord(source.env)).map(([key, value]) => [key, convert(value)])),
        url: convert(source.url),
        headers: Object.fromEntries(Object.entries(asRecord(source.headers)).map(([key, value]) => [key, convert(value)])),
        enabled: source.enabled !== false,
        toolCallTimeoutMs: Number(source.toolCallTimeoutMs) > 0 ? Math.floor(Number(source.toolCallTimeoutMs)) : 60000,
        startupTimeoutMs: DEFAULT_STARTUP_TIMEOUT_MS,
        reconnect: { ...DEFAULT_RECONNECT }
      }
      return { entry, notes: [] }
    }

    /** 界面条目 → 写进 `config.servers` 的记录（去掉界面专用的 serverName）。 */
    function toManagedRecord(entry) {
      const { serverName: _name, ...record } = entry
      return record
    }

    /** 设置页分区主体：官方 mcp-manager 的服务器清单管理界面。 */
    function McpManagerSection() {
      const { ctx } = useSection()
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [busy, setBusy] = React.useState(false)
      const [views, setViews] = React.useState([])
      const [confirming, setConfirming] = React.useState(null)
      const [editor, setEditor] = React.useState(null)
      const [migrating, setMigrating] = React.useState(false)
      const [migrationNote, setMigrationNote] = React.useState('')

      const refreshStatus = React.useCallback(async () => {
        try {
          const payload = await fetchStatus(ctx)
          setStatus(payload)
          setError('')
          return payload
        } catch (cause) {
          setError(`读取宿主状态失败：${String(cause?.message ?? cause)}`)
          return null
        } finally {
          setLoading(false)
        }
      }, [ctx])

      React.useEffect(() => {
        void refreshStatus()
      }, [refreshStatus])

      const runtime = status?.runtime ?? 'starting'
      const managerEntryId = status?.manager?.entryId ?? DEFAULT_MANAGER_ENTRY
      const managerAvailable = status?.manager?.available === true

      const managerForm = React.useMemo(
        () => (typeof ctx?.configForms?.get === 'function' ? ctx.configForms.get(managerEntryId) : null),
        [ctx, managerEntryId]
      )
      const legacyForm = React.useMemo(
        () => (typeof ctx?.configForms?.get === 'function' ? ctx.configForms.get(SETTINGS_ENTRY) : null),
        [ctx]
      )
      const decodeManager = React.useCallback((value) => decodeServers(value), [])
      const decodeLegacy = React.useCallback((value) => (Array.isArray(value?.servers) ? value.servers : []), [])
      const managerValue = useConfigForm(managerForm, decodeManager)
      const legacyServers = useConfigForm(legacyForm, decodeLegacy)
      const servers = React.useMemo(() => (Array.isArray(managerValue) ? managerValue : []), [managerValue])

      // 运行状态：官方 manager 的 watch 流（断线由 $stream 处理，拿不到时退回裸流）。
      React.useEffect(() => {
        const manager = ctx?.remote?.mcpManager
        if (managerAvailable !== true || typeof manager?.watch !== 'function') return undefined
        const controller = new AbortController()
        let disposed = false
        const run = async () => {
          try {
            const stream =
              typeof ctx.remote.$stream === 'function'
                ? ctx.remote.$stream({
                    name: 'mcp servers',
                    open: (signal) => manager.watch(signal),
                    ended: () => new Error('MCP 服务器状态流已结束'),
                    carrierFailed: () => {
                      if (!disposed) setError('连接中断，正在重连…')
                    }
                  })
                : manager.watch(controller.signal)
            for await (const frame of stream) {
              if (disposed) return
              const value = typeof frame?.accept === 'function' ? frame.value : frame
              frame?.accept?.()
              setViews(Array.isArray(value) ? value : [])
            }
          } catch (cause) {
            if (!disposed) setError(`读取连接状态失败：${String(cause?.message ?? cause)}`)
          }
        }
        void run()
        return () => {
          disposed = true
          controller.abort()
        }
      }, [ctx, managerAvailable])

      const viewOf = React.useCallback((name) => views.find((item) => item?.name === name) ?? null, [views])

      const write = React.useCallback(
        async (ops) => {
          setBusy(true)
          try {
            return await writeConfig(ctx, managerForm, ops, setError)
          } finally {
            setBusy(false)
          }
        },
        [ctx, managerForm]
      )

      const openEditor = (mode, server) => {
        setEditor({
          mode,
          draft: server === null || server === undefined ? emptyDraft('') : toDraft(server),
          verification: { status: 'idle' },
          verifying: false
        })
      }

      const changeDraft = (next) => {
        setEditor((current) => (current === null ? current : { ...current, draft: next, verification: { status: 'idle' } }))
      }

      /**
       * 保存：写入官方清单；要启用时先写停用态、`probe` 通过再启用。
       * 失败时配置仍以停用态留在清单里（不丢数据），弹窗显示原因可继续修正。
       */
      const saveDraft = async () => {
        if (editor === null || editor.verifying === true) return
        const name = String(editor.draft.serverName ?? '').trim()
        const originalName = editor.mode === 'edit' ? editor.draft.id : undefined
        const issues = validateDraft(editor.draft, name, servers, originalName)
        if (issues.length > 0) {
          setEditor((current) => (current === null ? current : { ...current, verification: { status: 'failed', error: issues.join('；') } }))
          return
        }
        const entry = fromDraft(editor.draft)
        setEditor((current) => (current === null ? current : { ...current, verifying: true }))
        try {
          const renamed = editor.mode === 'edit' && originalName !== name
          /** @type {any[]} */
          const ops = []
          if (renamed) ops.push({ op: 'unset', path: ['servers', originalName] })
          ops.push({ op: 'set', path: ['servers', name], value: { ...entry, enabled: false } })
          if (!(await write(ops))) {
            setEditor((current) => (current === null ? current : { ...current, verifying: false, verification: { status: 'failed', error: '写入被宿主拒绝' } }))
            return
          }
          if (entry.enabled === false) {
            setEditor(null)
            return
          }
          const probed = await probeServer(ctx, name)
          if (probed.ok === true) {
            await write([{ op: 'set', path: ['servers', name, 'enabled'], value: true }])
            setEditor(null)
            return
          }
          setEditor((current) =>
            current === null
              ? current
              : {
                  ...current,
                  verifying: false,
                  verification: {
                    status: 'failed',
                    error: `${probed.error}（配置已保存为停用状态；修好后再次保存即可启用）`
                  }
                }
          )
        } catch (cause) {
          setEditor((current) =>
            current === null ? current : { ...current, verifying: false, verification: { status: 'failed', error: String(cause?.message ?? cause) } }
          )
        }
      }

      const toggle = async (server) => {
        await write([{ op: 'set', path: ['servers', server.serverName, 'enabled'], value: !server.enabled }])
      }

      const remove = async (server) => {
        setConfirming(null)
        await write([{ op: 'unset', path: ['servers', server.serverName] }])
      }

      /** 旧版本清单 → 官方条目；同名冲突跳过并报告。 */
      const migrate = async () => {
        if (!Array.isArray(legacyServers) || legacyServers.length === 0) return
        setMigrating(true)
        setMigrationNote('')
        try {
          const taken = new Set(servers.map((item) => item.serverName))
          /** @type {any[]} */
          const ops = []
          const notes = []
          let converted = 0
          for (const legacy of legacyServers) {
            const { entry } = legacyToManaged(legacy)
            const name = entry.serverName
            if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) {
              notes.push('一个没有合法服务器名的条目已跳过')
              continue
            }
            if (taken.has(name)) {
              notes.push(`${name}（官方清单已有同名）`)
              continue
            }
            taken.add(name)
            ops.push({ op: 'set', path: ['servers', name], value: toManagedRecord(entry) })
            converted += 1
          }
          if (ops.length > 0 && !(await write(ops))) return
          await writeConfig(ctx, legacyForm, [{ op: 'set', path: ['servers'], value: [] }], setError)
          setMigrationNote(
            `迁移完成：${converted} 条已写入官方清单${notes.length === 0 ? '' : `；跳过：${notes.join('；')}`}`
          )
        } finally {
          setMigrating(false)
        }
      }

      /**
       * 导入：向宿主取组合层某条 MCP 行的完整配置（敏感值已转成凭据模板并写入凭据库），
       * 以「新增」弹窗预填，保存后进入官方清单。
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
          const entry = normalizeServer(value.entry, value.entry?.serverName)
          setEditor({ mode: 'create', draft: toDraft(entry), verification: { status: 'idle' }, verifying: false, notes: value.notes ?? [] })
        } catch (cause) {
          setError(`导入失败：${String(cause?.message ?? cause)}`)
        }
      }

      const enabledCount = servers.filter((item) => item.enabled).length
      const knownCredentialKeys = [...new Set(servers.flatMap((item) => credentialRefsOf(item)))]
      const profileNames = new Map(
        (status?.profileTargets ?? [])
          .filter((row) => typeof row?.serverName === 'string' && row.serverName !== '')
          .map((row) => [row.serverName, row.entryId])
      )

      if (loading) {
        return React.createElement(
          'div',
          { className: 'dmw-section' },
          React.createElement(
            'div',
            { className: 'dmw-loading' },
            React.createElement(IconLoadingOutline16, { size: 16 }),
            '正在读取宿主状态…'
          )
        )
      }

      return React.createElement(
        'div',
        { className: 'dmw-section' },
        React.createElement(
          'div',
          { className: 'dmw-heading' },
          React.createElement('h2', { className: 'dmw-title' }, SECTION_LABEL),
          React.createElement('span', { className: 'dmw-count' }, `${enabledCount}/${servers.length} 已启用`),
          React.createElement('span', { className: 'dmw-heading-spacer' }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dmw-icon-button',
              'aria-label': '刷新状态',
              disabled: busy,
              onClick: () => void refreshStatus()
            },
            React.createElement(IconRefreshOutline16, { size: 16 })
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dmw-icon-button',
              'aria-label': '新增服务器',
              disabled: busy || runtime !== 'ready',
              onClick: () => openEditor('create', null)
            },
            React.createElement(IconPlusOutline16, { size: 16 })
          )
        ),
        runtime === 'ready'
          ? null
          : React.createElement('div', { className: 'dmw-error' }, runtimeText(runtime)),
        status?.manager?.available !== true && runtime === 'ready'
          ? React.createElement(
              'div',
              { className: 'dmw-error' },
              `没有找到可用的官方 MCP 管理器条目（reason: ${String(status?.manager?.reason ?? 'unknown')}）。请确认 dsh-mcp-manager 已启用，或升级到 0.2.2-rc.2 及以上。`
            )
          : null,
        Array.isArray(legacyServers) && legacyServers.length > 0
          ? React.createElement(
              'div',
              { className: 'dmw-notice dmw-migrate' },
              React.createElement(
                'span',
                null,
                `检测到旧版本托管的 ${legacyServers.length} 个服务器。迁移到官方清单后由官方管理器统一连接（展示名与「首次连接失败即拒绝」选项不会迁移）。`
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dmw-button',
                  disabled: migrating || busy || runtime !== 'ready',
                  onClick: () => void migrate()
                },
                migrating ? '迁移中…' : '迁移到官方清单'
              )
            )
          : null,
        migrationNote === '' ? null : React.createElement('div', { className: 'dmw-notice' }, migrationNote),
        error === '' ? null : React.createElement('div', { className: 'dmw-error' }, error),
        servers.length === 0
          ? React.createElement(
              'div',
              { className: 'dmw-empty' },
              '还没有配置 MCP 服务器；用右上角的 + 新增，或在下方从启动配置导入一条。'
            )
          : React.createElement(
              'div',
              { className: 'dmw-list' },
              servers.map((server) =>
                React.createElement(ServerRow, {
                  key: server.serverName,
                  server,
                  live: viewOf(server.serverName),
                  conflictNote: profileNames.has(server.serverName)
                    ? `启动配置里也声明了同名服务器「${server.serverName}」（${profileNames.get(server.serverName)}）；两边只能留一个，否则启动配置那一条会加载失败`
                    : '',
                  runtime,
                  busy,
                  onToggle: toggle,
                  onEdit: (target) => openEditor('edit', target),
                  onDelete: (target) => setConfirming(target)
                })
              )
            ),
        React.createElement(ProfileTargets, { rows: status?.profileTargets ?? [], onImport: importRow, busy }),
        editor === null
          ? null
          : React.createElement(ServerDialog, {
              mode: editor.mode,
              draft: editor.draft,
              verification: editor.verification,
              verifying: editor.verifying === true,
              notes: editor.notes ?? [],
              runtime,
              busy,
              setDraft: changeDraft,
              onCancel: () => setEditor(null),
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
          { className: 'dmw-notice' },
          `确认删除「${server.serverName}」？`,
          React.createElement('button', { type: 'button', className: 'dmw-button danger', onClick: onConfirm }, '删除')
        )
      }
      return React.createElement(
        Modal,
        { open: true, onClose: onCancel, className: 'dmw-dialog' },
        React.createElement(
          'div',
          { className: 'dmw-confirm' },
          React.createElement('div', { className: 'dmw-name' }, `删除「${server.serverName}」？`),
          React.createElement(
            'p',
            { className: 'dmw-hint' },
            '只会从托管清单里移除，并立即卸载它；已经写入的凭据不会被删除。'
          ),
          React.createElement(
            'div',
            { className: 'dmw-footer' },
            React.createElement('button', { type: 'button', className: 'dmw-button', onClick: onCancel }, '取消'),
            React.createElement('button', { type: 'button', className: 'dmw-button danger', onClick: onConfirm }, '删除')
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
        console.error('dsh-mcp-workbench section failed:', error)
      }

      render() {
        if (this.state.error !== null) {
          return React.createElement(
            'div',
            { className: 'dmw-section' },
            React.createElement('div', { className: 'dmw-error' }, `MCP 服务器分区渲染失败：${String(this.state.error?.message ?? this.state.error)}`)
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

    /**
     * 0.2.2 起官方图标是 sprite 壳：组件渲染出的 `<svg>` 只有
     * `<use href="#dsw-icon-…">`，直接拿 outerHTML 当 mask 会得到一份引用不存在
     * 符号的独立文档，图标整块空白。`ICON_SYMBOLS` 提供符号 id → 完整 SVG 的映射，
     * 优先用它还原自包含 SVG；旧线没有这个导出时退回 outerHTML（并补 xmlns）。
     */
    function navIconSymbolSource(svg) {
      if (svg === null || svg === undefined) return ''
      const declared = typeof svg.getAttribute === 'function' ? svg.getAttribute('data-icon') : null
      const use = typeof svg.querySelector === 'function' ? svg.querySelector('use') : null
      const href = use !== null && use !== undefined && typeof use.getAttribute === 'function' ? use.getAttribute('href') : null
      const key = String(declared || href || '').replace(/^#/u, '')
      const symbols = primitives?.ICON_SYMBOLS
      if (key !== '' && symbols !== null && typeof symbols === 'object' && typeof symbols[key] === 'string') {
        return symbols[key]
      }
      return navIconMaskSource(typeof svg.outerHTML === 'string' ? svg.outerHTML : '')
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
          // 官方 `settings.section.icon` 槽接管这一行后撤销 DOM 补丁，避免两个图标。
          // 每轮 mark 都检查，因此即使补丁先装、官方槽后渲染也会自动让位。
          const official = typeof button.querySelector === 'function'
            ? button.querySelector('[data-slot="settings.section.icon"]')
            : null
          if (official !== null) {
            if (touched.has(button)) {
              delete button.dataset[NAV_PATCH_FLAG]
              delete button.dataset[NAV_PATCH_COUNT]
              button.style.removeProperty(NAV_PATCH_MASK)
              touched.delete(button)
            }
            continue
          }
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
      // 官方 `settings.section.icon` 槽已渲染时直接用它（见 `McpSectionIcon`），
      // 再打 DOM 补丁会出现两个图标（自定义图标 + 官方槽图标）。
      try {
        if (doc !== null && doc !== undefined && typeof doc.querySelector === 'function' && doc.querySelector('[data-slot="settings.section.icon"]') !== null) {
          return () => {}
        }
      } catch {
        /* 查询失败按"槽不可用"处理，退回 DOM 补丁 */
      }
      const svg = template !== null && template !== undefined && typeof template.querySelector === 'function' ? template.querySelector('svg') : null
      if (svg === null || svg === undefined) return () => {}
      const source = navIconSymbolSource(svg)
      if (source === '') return () => {}
      return patchSettingsNavIcon(doc, source, SECTION_LABEL)
    }

    /**
     * 官方 `settings.section.icon` 槽（0.2.2-alpha.3 起）的注册项：
     * 壳层按 section id 找图标时直接渲染它，不再回落到齿轮。
     */
    function McpSectionIcon(props) {
      const Icon = typeof IconLinkOutline16 === 'function' ? IconLinkOutline16 : null
      if (Icon === null) return null
      return React.createElement(Icon, { size: typeof props?.size === 'number' ? props.size : 16 })
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
        { ref: templateRef, className: 'dmw-nav-icon-template', 'aria-hidden': true },
        React.createElement(IconLinkOutline16, { size: 16 })
      )
    }

    // ── 装配 ─────────────────────────────────────────────────────────────

    /**
     * 依赖的客户端服务。
     *
     * 带点号的命名空间必须**单独声明**：客户端的 Cordis 里 `remote.credentials` /
     * `remote.mcpManager` 本身就是服务名，只写 `remote` 时读它们会同步抛
     * `cannot get property "remote.mcpManager" without inject`——外面包 `ctx?.remote?.x`
     * 也拦不住（属性访问本身就是抛点）。官方同一套数据面的写法见
     * `dsh-client-ui-settings-plugins/lib/client.js` 的 inject 数组。
     */
    const inject = ['slots', 'configForms', 'remote', 'remote.credentials', 'remote.mcpManager']

    function apply(ctx) {
      // 官方条目 id 来自宿主状态路由（浏览器侧无法从包名反查 Loader 条目），
      // 所以这里不预先取 configForm；分区组件在拿到 status 后再 `configForms.get(id)`。
      installStyles(ctx)
      const contextValue = { ctx }
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
      // 官方 `settings.section.icon` 槽（0.2.2-alpha.3 起）：注册同 id 的图标即可替换，
      // 不再需要 DOM 补丁。旧版本壳层没有这个槽（register 会抛），所以两层都保留：
      // 槽可用时用它；不可用时退回 `settings.action` 里的 DOM 补丁。
      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SECTION_ID,
        order: SECTION_ORDER
      }, McpSectionIcon))
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
      McpSectionIcon,
      ServerEditor,
      ServerDialog,
      LiveLogs,
      emptyDraft,
      fromDraft,
      CredentialBox,
      ProfileTargets,
      decodeServers,
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
      validateDraft,
      legacyToManaged,
      toManagedRecord,
      probeServer,
      useConfigForm,
      writeConfig,
      newId,
      patchSettingsNavIcon,
      installNavIconPatch,
      STATUS_PATH,
      ACTION_PATH,
      CLIENT_HEADER,
      CSRF_HEADER,
      SETTINGS_ENTRY,
      MANAGER_MODULE,
      DEFAULT_MANAGER_ENTRY,
      SECTION_ID,
      SECTION_LABEL,
      styleText
    })

    return module.exports
  }
})
