window.__ModuleLoader__.load({
  id: 'dsh-extra-context',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    // 规则行里两个图标必须来自**同一尺寸集**：曾用 IconCloseOutline16（16 集、描边）配
    // IconTriangleRightFill14（14 集、实心），实测删除图标 12x12、箭头 5x8，
    // 视觉上一个明显大一圈。官方图标集按 14/16 分档，跨档搭配就会不一致。
    // IconContextInjectionOutline16 单独用在设置页导航（壳层那一列的图标都是 16 档），
    // 与规则行不同行，不参与上面的同档约束。
    //
    // Switch 是壳层自己的开关控件（`<button role="switch" aria-checked>`：36x20、
    // 开启态品牌色轨道、圆形拇指、深浅主题与焦点环都跟随壳层），总开关与每行的启停
    // 都用它。**不要自绘开关**：自绘出来的尺寸/配色/过渡必然与壳层不一致，而壳层已经
    // 提供现成控件（`Switch.d.ts`：`{ checked, onChange, label, disabled, title, className }`）。
    const { IconCloseFill14, IconTriangleRightFill14, IconContextInjectionOutline16, Switch } = require('@deepseek-ai/dsh-client-ui-primitives')

    /**
     * settings 命名空间控制器。apply() 创建它，组件通过闭包读取；
     * 只在 apply 期间赋值一次，组件渲染时必然已就绪。
     */
    let settingsController = null

    /** 与宿主 lib/rules.js 的 SECTION_HEADING 必须逐字一致（预览要对得上实际注入）。 */
    const SECTION_HEADING = '以下内容由用户在 dsh-extra-context 中配置，对本会话与全部子代理持续有效。'
    const SETTINGS_NAMESPACE = 'extra-context'
    /** 设置页导航里的菜单名：既是 section 的 label，也是导航图标补丁的匹配依据。 */
    const SECTION_LABEL = '额外上下文'
    /** 导航图标补丁在按钮 dataset 上留下的标记与引用计数（卸载时逐项回滚）。 */
    const NAV_PATCH_FLAG = 'decNavIcon'
    const NAV_PATCH_COUNT = 'decNavIconReferences'
    /** 承载 mask 图形的 CSS 变量，由补丁按实例写进按钮的 inline style。 */
    const NAV_PATCH_MASK = '--dec-nav-icon-mask'
    const STATUS_PATH = '/dsh-extra-context/status'
    const CLIENT_HEADER = 'x-dsh-extra-context-client'
    const STYLE_ID = 'dsh-extra-context-style'
    const DEFAULT_MAX_BYTES = 8192

    const inject = ['slots', 'settingsScope', 'timer']

    /** apply() 捕获的插件上下文：组件内的计时器必须挂在它下面才能随插件卸载清理。 */
    let pluginCtx = null

    // #region 纯工具函数（无 React、无服务依赖，便于单测）

    /** 估算中英混排文本的 token 量级，仅用于展示。 */
    function estimateTokens(text) {
      const value = typeof text === 'string' ? text : ''
      if (value === '') return 0
      const cjk = (value.match(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/gu) || []).length
      return cjk + Math.ceil((value.length - cjk) / 4)
    }

    /**
     * 用户看到的字符数（按字素簇计）。
     *
     * 为什么必须和 byteLength 分开：UTF-8 里一个汉字占 **3 字节**，
     * 所以用字节数当"字数"显示会大出约 2.7 倍——
     * 用户实测反馈"字符统计跟我看到的字数不一致"，根因就在这。
     * 字节数仍然有用（预算与 maxBytes 都是字节口径），但必须**分别**呈现。
     */
    function characterCount(text) {
      const value = typeof text === 'string' ? text : ''
      if (value === '') return 0
      // 优先按字素簇（一个可见字符算一个，emoji/组合字符不会被多算）
      try {
        if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
          const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          let count = 0
          for (const _piece of segmenter.segment(value)) count += 1
          return count
        }
      } catch {
        // 老浏览器没有 Segmenter：退回码点计数
      }
      return Array.from(value).length
    }

    /** UTF-8 字节数。浏览器没有 Buffer，用 TextEncoder。 */
    function byteLength(text) {
      const value = typeof text === 'string' ? text : ''
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).length
      return value.length
    }

    /**
     * 规范化一个分段，容忍外部文档里的脏字段。
     *
     * 分段只有 id / enabled / text：`label`（分段名称）已随界面改版从代码与设置
     * schema 里移除，所以这里**只挑已知字段**——老数据里残留的 label 会被丢弃，
     * 而不是继续往后传。
     */
    function normalizeSegment(value, index) {
      const record = value !== null && typeof value === 'object' ? value : {}
      return {
        id: typeof record.id === 'string' && record.id !== '' ? record.id : `segment-${String(index + 1)}`,
        enabled: record.enabled !== false,
        text: typeof record.text === 'string' ? record.text : ''
      }
    }

    /** 规范化整个设置值；缺字段时补默认值，保证组件永远拿到完整形状。 */
    /**
     * 规范化 + **id 去重**（与宿主 `lib/rules.js` 的 normalizeSettings 同一责任）。
     *
     * 宿主会对重复 id 重新编号，但客户端曾经不做：脏数据（例如两条 id 相同的规则）
     * 会让 React key 撞车，于是"勾选/删除第 2 条"实际作用到第 1 条——
     * 更糟的是新增规则时算出的 id 也会撞上重复项，提交出去又得靠宿主二次修正。
     * 这里就地补齐，两端口径一致。
     */
    function normalizeSettings(value) {
      const record = value !== null && typeof value === 'object' ? value : {}
      const rawSegments = Array.isArray(record.segments) ? record.segments : []
      const segments = rawSegments.map(normalizeSegment)
      const seen = new Set()
      const deduped = segments.map((segment) => {
        if (!seen.has(segment.id)) {
          seen.add(segment.id)
          return segment
        }
        const id = createSegmentId(seen)
        seen.add(id)
        return { ...segment, id }
      })
      return {
        enabled: record.enabled !== false,
        segments: deduped,
        maxBytes: Number.isFinite(record.maxBytes) && Number(record.maxBytes) > 0 ? Math.trunc(Number(record.maxBytes)) : DEFAULT_MAX_BYTES
      }
    }

    /**
     * 生成一把未被占用的分段 id。
     *
     * id 只是一把稳定的键（React key + 提交时的身份），分段没有名称之后它不再从
     * 任何文本派生：固定基名 `segment`，冲突时依次退让到 `segment-2`、`segment-3`…
     * @param {Iterable<string>} takenIds 已被占用的 id
     */
    function createSegmentId(takenIds) {
      const taken = takenIds instanceof Set ? takenIds : new Set(takenIds || [])
      const base = 'segment'
      if (!taken.has(base)) return base
      for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${base}-${String(suffix)}`
        if (!taken.has(candidate)) return candidate
      }
      return `${base}-${String(Date.now())}`
    }

    /**
     * 本地估算「这段内容会怎样进入 system prompt」。
     * 宿主才是权威（渲染由 lib/rules.js 完成），这里只是即时预览，
     * 用户点保存后以宿主返回的 status 为准。
     */
    /**
     * 与宿主 `lib/rules.js` 的 renderExtraContext 保持同一口径的本地渲染。
     *
     * 预览用它、而不是宿主回读值：预览必须跟随当前编辑内容立即变化
     * （宿主值是提交后才更新的，曾在勾选时表现为"预览不动"）。
     * 包裹文字必须与宿主一致，否则预览的体积/字数会与实际注入不符——
     * `test/host.test.js` 有一条断言守着两边的包裹结构。
     *
     * 用户文本里的 `{{...}}` 原样保留：宿主注册 section 时声明了官方
     * `interpolate: false`，不做变量插值。**不要在这里加回"中和 `{{`"**，
     * 否则预览与实际注入的内容会不一致。
     */
    function previewText(value) {
      const settings = normalizeSettings(value)
      if (!settings.enabled) return ''
      const segments = settings.segments
        .filter((segment) => segment.enabled && segment.text.trim() !== '')
        .map((segment) => segment.text.trim())
      // 与宿主一致：没有任何内容时不贡献文本（否则会渲染出空的包裹结构，
      // 让"当前为空"的提示永远不出现）。
      if (segments.length === 0) return ''
      const parts = [SECTION_HEADING, '--- 额外上下文开始 ---', ...segments]
      parts.push('--- 额外上下文结束 ---')
      return parts.join('\n\n')
    }


    /** 把一次性消息文本按行折叠，避免长错误撑破设置页。 */
    function firstLine(message) {
      const text = String(message === undefined || message === null ? '' : message)
      const index = text.indexOf('\n')
      return index === -1 ? text : `${text.slice(0, index)}…`
    }

    // #endregion

    const styleText = `
.dec-section{width:100%;max-width:720px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;font-size:13px}
.dec-heading{display:flex;flex-direction:column;gap:12px;min-width:0}
.dec-title{margin:0;font-size:18px;font-weight:600;line-height:26px}
.dec-intro-line{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:normal}
.dec-desc{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dec-list{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.dec-item+.dec-item{border-top:1px solid var(--dsw-alias-border-l2)}
.dec-item{display:flex;flex-direction:column}
.dec-item-row{display:flex;align-items:center;gap:8px;padding:0 10px;min-height:44px}
.dec-item-open .dec-item-row{background:var(--dsw-alias-bg-layer-2)}
.dec-item-off .dec-item-preview{opacity:.5}
/* 开关外观完全归官方 Switch 组件（36x20、aria-checked 驱动配色、圆形拇指），
   插件样式只负责定位：每行开关占行首，总开关贴动作行右侧。
   不要在这里给开关写尺寸或颜色——那正是"自绘控件与壳层不一致"的老路。 */
.dec-row-switch{flex:none}
.dec-master{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
.dec-master-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dec-item-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:row;align-items:center;gap:8px;padding:8px 0;cursor:pointer;background:none;border:0;text-align:left;font:inherit;color:inherit}
.dec-item-main:hover .dec-item-preview{color:var(--dsw-alias-label-primary)}
.dec-item-order{flex:none;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dec-item-preview{font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dec-caret{flex:none;color:var(--dsw-alias-label-secondary);transition:transform .12s ease}
.dec-caret-open{transform:rotate(90deg)}
.dec-icon-btn{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.dec-icon-btn>svg{display:block}
.dec-icon-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dec-icon-btn:disabled{opacity:.3;cursor:default}
.dec-editor{padding:0 10px 12px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2)}
.dec-textarea{display:block;width:100%;min-height:110px;box-sizing:border-box;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;resize:vertical}
.dec-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dec-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dec-actions-end{justify-content:flex-end}
.dec-btn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dec-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.dec-btn:disabled{opacity:.45;cursor:default}
.dec-status{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dec-footer{display:flex;flex-direction:column;gap:8px}
/* 预览模块：小标题 / 说明 / 内容 / 消耗 四行分区，整体仍是一个带边框的容器 */
.dec-preview{margin:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
/* 预览卡片只有两段：内容（详情）／消耗。位置与优先级的说明属于页面级文案，
   已移到标题下方的 .dec-intro-line，卡片里不再有说明段（用户明确要求）。 */
.dec-preview-heading{margin:0;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}
.dec-preview-text{padding:10px;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.dec-preview-cost{margin:0;padding:8px 10px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:2px}
.dec-preview-cost-value{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dec-preview-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary)}
.dec-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.dec-ok{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}
/* 设置页导航图标补丁（成因见 patchSettingsNavIcon）：
   壳层只给 4 个官方 id 配了图标，"额外上下文"会回落成齿轮；这里用 ::before
   在**原来的 svg 位置**画专属图标，原 svg 只做占位。
   - ::before 是该 flex 按钮的第一个 flex item，尺寸/间距完全沿用壳层布局，
     因此不写死 padding-left 之类的坐标（壳层改内边距也不会错位）；
   - 图形用 currentColor 上色，选中/悬停/深色主题的配色继续跟随壳层；
   - 模板 div 只是 svg 源码的载体（补丁要拿 outerHTML 做 mask），不参与布局。 */
.dec-nav-icon-template{display:none}
[data-dec-nav-icon]>svg:first-child{display:none}
[data-dec-nav-icon]::before{content:"";flex:none;width:16px;height:16px;background:currentColor;pointer-events:none;-webkit-mask:var(--dec-nav-icon-mask) center/16px 16px no-repeat;mask:var(--dec-nav-icon-mask) center/16px 16px no-repeat}
`



    /**
     * 插件样式表的宿主标识：用来认领"我们自己那份 style"（不看 id，避免和别的插件撞 id）。
     */
    const STYLE_OWNER = 'dsh-extra-context-v1'

    /** 读取 dataset 上的引用计数；脏值一律当 0，免得计数被写成 NaN 后再也回滚不了。 */
    function referenceCount(value) {
      const parsed = Number(value)
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0
    }

    /**
     * 注入插件样式表。**插件级**：由 `apply()` 注入一次，任何组件都不负责它。
     *
     * 为什么必须是插件级（用户实测反馈 + 一次真实缺陷）：样式要服务的不只是分区面板，
     * 还有设置页导航里的图标补丁——它挂在 `settings.action`（面板一打开就渲染），
     * 而分区面板要等用户点开那一行才渲染（壳层 `renderSlot('settings.section', …, { only: active })`）。
     * 曾经把注入写在分区组件里，于是打开设置页时"补丁标记已打好、CSS 还没进文档"，
     * 导航里仍是壳层齿轮，点一下那一行才变对。
     *
     * 与 `dsh-chat-archive-manager` 同款：插件级注入 + **引用计数**（HMR 会先把旧 fiber 卸掉
     * 再重新 materialize，计数保证这个窗口里样式不会被提前移除），并在元素存活但文本过期时重写文本。
     */
    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      let element = typeof document.querySelector === 'function' ? document.querySelector(`style[data-dec-owner="${STYLE_OWNER}"]`) : null
      if (element === null || element === undefined) {
        element = document.createElement('style')
        // id 只是给"人/测试"看的便利标识：被占用（别的插件抢了同名 id）就不设，认领靠 data-dec-owner
        if (document.getElementById(STYLE_ID) === null) element.id = STYLE_ID
        element.dataset.decOwner = STYLE_OWNER
        element.dataset.references = '0'
        document.head.appendChild(element)
      }
      // data-plugin 是必须的：dsh-client-modules 在 materialize 时会把当前所有
      // 未打标签的 <style> 认领给"下一个"插件，而 client HMR 只删除
      // style[data-plugin=<自己的包名>]。不打标签的样式会被记到别的插件名下，
      // 于是别人更新时你的样式被删掉、你更新时旧样式残留。
      element.dataset.plugin = 'dsh-extra-context'
      // 元素还在、文本过期（HMR 复用了同一个元素）时重写，别让它留在旧版本
      if (element.textContent !== styleText) element.textContent = styleText
      element.dataset.references = String(referenceCount(element.dataset.references) + 1)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          const remaining = referenceCount(element.dataset.references) - 1
          element.dataset.references = String(remaining)
          if (remaining === 0 && element.parentNode !== null && element.parentNode !== undefined) element.parentNode.removeChild(element)
        }, 'dsh-extra-context: styles')
      }
    }

    // #region 设置页导航图标

    /**
     * data: URI 里的 SVG 是独立文档，缺 `xmlns` 时浏览器按 HTML 解析、mask 直接失效
     * （表现为图标整块空白）。官方图标组件的 outermost svg 由浏览器序列化时通常已带
     * xmlns，但不保证，所以这里兜一层。
     */
    function navIconMaskSource(outerHtml) {
      const source = typeof outerHtml === 'string' ? outerHtml : ''
      if (source === '') return ''
      if (source.includes('xmlns=')) return source
      return source.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    }

    /**
     * 给设置页导航里本插件那一行换上专属图标。
     *
     * 为什么必须自己改 DOM（这是"壳层不给我们图标"的直接后果）：
     * 1. `settings.section` 的注册选项只有 id/order/label，**没有 icon**；
     * 2. 壳层 `navIcon(id)` 只给 4 个官方 id 配了图标（models / agent-presets /
     *    plugins / archived-sessions），其它 id 一律回落 `IconSettingsOutline16`（齿轮）。
     * 于是「额外上下文」在设置页里显示成齿轮——和"设置"本身撞脸（用户实测反馈）。
     * 壳层未来若支持在 slot 选项里声明图标，这段补丁就应立刻删掉。
     *
     * 手法与 dsh-chat-archive-manager 同款：原 svg 只做占位（CSS 里隐藏），
     * 图标由 `::before` + mask 画出来，因此配色（选中态/悬停态/深色主题）继续跟随壳层。
     * 这里比那边更进一步：::before 参与 flex 布局而不做绝对定位，壳层改内边距也不会错位。
     *
     * 全部副作用都记在按钮的 dataset/内联样式上并做**引用计数**，返回的清理函数能把
     * 按钮完整还原成齿轮（多次挂载、面板开关、HMR 都靠它）。任何一步不满足（没有
     * document、没有模板 svg、壳层结构变了）都静默返回空操作——最差是继续显示齿轮，绝不报错。
     */
    function patchSettingsNavIcon(doc, sourceSvg, label) {
      const noop = () => {}
      if (doc === null || typeof doc !== 'object' || typeof doc.querySelectorAll !== 'function') return noop
      if (typeof sourceSvg !== 'string' || sourceSvg === '') return noop
      if (typeof label !== 'string' || label === '') return noop

      const mask = `url("data:image/svg+xml,${encodeURIComponent(sourceSvg)}")`
      const touched = new Set()

      const mark = () => {
        for (const button of doc.querySelectorAll('nav button')) {
          // 只认文本恰好等于本插件菜单名的那一行：设置页导航里没有别的同名项。
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

    /**
     * 从挂载点里的模板元素取图标源码并装上补丁。
     *
     * 单独抽出来是为了可测：DOM 结构（模板 → svg → outerHTML）与补丁行为分开验证，
     * 组件只负责"把 ref 交进来"。
     */
    function installNavIconPatch(template, doc) {
      const svg = template !== null && template !== undefined && typeof template.querySelector === 'function' ? template.querySelector('svg') : null
      if (svg === null || svg === undefined || typeof svg.outerHTML !== 'string') return () => {}
      const source = navIconMaskSource(svg.outerHTML)
      if (source === '') return () => {}
      return patchSettingsNavIcon(doc, source, SECTION_LABEL)
    }

    /**
     * 补丁的隐形挂载点，注册在 `settings.action`（随设置面板挂载/卸载，
     * 因此补丁生命周期与设置面板完全一致，面板关掉就还原）。
     *
     * 布局阶段安装：等到 useEffect 就已经画过一帧齿轮，会看到图标闪一下。
     */
    function ExtraContextNavIcon() {
      const templateRef = React.useRef(null)

      // 样式由 apply() 插件级注入（见 installStyles），这里只管打标记。
      // 曾经的写法是"由分区组件注入样式"，而分区要等用户点开这一行才渲染，
      // 于是导航里的补丁"标记已打、CSS 未到"，点一下才变对（用户实测反馈）。
      React.useLayoutEffect(() => {
        return installNavIconPatch(templateRef.current, typeof document === 'undefined' ? null : document)
      }, [])

      // 图标取不到（未来构建裁剪掉它）就什么都不渲染：导航继续用壳层齿轮，绝不因补丁报错。
      if (typeof IconContextInjectionOutline16 !== 'function') return null
      return React.createElement(
        'div',
        { ref: templateRef, className: 'dec-nav-icon-template', 'aria-hidden': true },
        React.createElement(IconContextInjectionOutline16, { size: 16 })
      )
    }

    // #endregion

    // #region 数据访问

    /**
     * 读取宿主状态：编译后的全文、分段明细、预算。
     * 只作为权威预览；失败时前端回退到本地估算。
     */
    async function loadStatus() {
      const response = await fetch(STATUS_PATH, { headers: { [CLIENT_HEADER]: '1' } })
      if (!response.ok) throw new Error(`status ${String(response.status)}`)
      const body = await response.json()
      if (body === null || typeof body !== 'object' || body.ok !== true) throw new Error(body && body.error ? String(body.error) : 'invalid status payload')
      return body
    }

    
    /**
     * settings 命名空间的解码器。
     *
     * 不做 schema 校验：宿主才是权威（写入前已按同一 schema 校验，
     * 非法值会被宿主标记为 last-good-value 并保留命名空间），
     * 而组件对任何字段都做防御性读取。这里失败退回 undefined，
     * 会让整个 section 显示成默认值——比显示原始文本更糟。
     */
    function decodeExtraSection(section) {
      // 官方契约：spec.decode 收到的是 section 值本身（不是 view）。
      // 曾写成 view.value（恒为 undefined），于是快照永远是默认值——面板读不到已保存的规则。
      return normalizeSettings(section)
    }

    // #endregion

    // #region React 组件

    /** 正文摘要：折叠状态下给一行可辨认的预览。 */
    function segmentPreview(text) {
      const value = typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : ''
      if (value === '') return '未填写内容'
      return value.length <= 48 ? value : `${value.slice(0, 48)}…`
    }

    /**
     * 一条上下文。
     *
     * 折叠态只占一行：行首是启停开关，随后是序号与"正文摘要"——后者直接回答
     * "到底加载了哪些上下文"。点这一行展开编辑。
     */
    function SegmentCard(props) {
      // 注意：输入控件（正文 / 每行的启停开关）刻意不绑 busy。
      // 自动写入会把 busy 置真，而给已聚焦元素加 disabled 会让浏览器强制失焦，
      // 表现为"打字一停顿就无法继续输入"。
      const { segment, index, expanded, onToggleExpand, onChange, onToggle, onRemove, onCommit } = props
      const row = [
        // 官方 Switch（不是自绘开关，也不再是原生 checkbox）。
        // 与正文输入一样**不绑 busy**：写入期间给聚焦控件加 disabled 会让浏览器强制失焦。
        React.createElement(Switch, {
          key: 'toggle',
          className: 'dec-row-switch',
          checked: segment.enabled,
          disabled: false,
          label: `启用第 ${String(index + 1)} 条上下文`,
          onChange: (next) => onToggle(next)
        }),
        React.createElement('button', {
          key: 'main',
          type: 'button',
          className: 'dec-item-main',
          onClick: onToggleExpand
        }, [
          React.createElement('span', { className: 'dec-item-order', key: 'order' }, `第 ${String(index + 1)} 条`),
          React.createElement('span', { className: 'dec-item-preview', key: 'preview' }, segmentPreview(segment.text))
        ]),
        React.createElement('button', {
          key: 'remove',
          type: 'button',
          className: 'dec-icon-btn',
          title: '删除',
          onBlur: onCommit,
          onClick: onRemove
        }, React.createElement(IconCloseFill14, { className: 'dec-icon-svg' })),
        React.createElement('button', {
          key: 'expand',
          type: 'button',
          className: 'dec-icon-btn',
          title: expanded ? '收起' : '展开编辑',
          'aria-expanded': expanded,
          onBlur: onCommit,
          onClick: onToggleExpand
        }, React.createElement(IconTriangleRightFill14, { className: expanded ? 'dec-caret dec-caret-open' : 'dec-caret' }))
      ]

      const className = ['dec-item', expanded ? 'dec-item-open' : '', segment.enabled ? '' : 'dec-item-off'].filter(Boolean).join(' ')
      const children = [React.createElement('div', { className: 'dec-item-row', key: 'row' }, row)]

      if (expanded) {
        children.push(React.createElement('div', { className: 'dec-editor', key: 'editor' }, [
          React.createElement('textarea', {
            key: 't',
            className: 'dec-textarea',
            value: segment.text,
            placeholder: '写一段希望所有对话都遵守的说明或偏好。',
            // 显式 false：输入控件不随写入状态禁用（禁用会让已聚焦元素失焦）
            disabled: false,
            spellCheck: false,
            // 打字过程中只改本地；失焦才写设置，避免打断输入
            onBlur: onCommit,
            onChange: (event) => onChange({ text: event.target.value })
          }),
          React.createElement('div', { className: 'dec-actions', key: 'meta' }, [
            // 计数单位与预览区保持一致：都用「字符」（用户实测反馈：一处写「N 字」、
            // 一处写「约 N 个字符」，同一个数字两种叫法）。
            // 这条是**精确**字素计数，不加"约"；"约"留给预览里的 token 估算。
            React.createElement('span', { className: 'dec-status', key: 'status' }, `${String(characterCount(segment.text))} 个字符`)
          ])
        ]))
      }

      return React.createElement('div', { className }, children)
    }

    /**
     * 渲染错误边界。
     *
     * 客户端插件里任何渲染异常都会让 React 卸载整棵树——设置页会整页空白，
     * 而且没有任何可见线索。这个边界把异常兜住并就地显示出来。
     * （曾被两次误删，故有明确的回归测试守着。）
     */
    class SectionErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
          console.error('dsh-extra-context: section render failed', error)
        }
      }

      render() {
        if (this.state.error !== null && this.state.error !== undefined) {
          const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error)
          return React.createElement('div', { className: 'dec-section' }, [
            React.createElement('p', { className: 'dec-error', key: 'title' }, `设置页渲染失败：${message}`),
            React.createElement('button', {
              key: 'retry',
              type: 'button',
              className: 'dec-btn',
              onClick: () => this.setState({ error: null })
            }, '重试')
          ])
        }
        return this.props.children
      }
    }

    function ExtraContextSection() {
      const controller = settingsController
      const [report, setReport] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [expandedId, setExpandedId] = React.useState(null)
      const pendingRef = React.useRef(null)
      const flushRef = React.useRef(null)
      /** 上一次没写成功的补丁：只用于"重试"，成功即清空。 */
      const failedRef = React.useRef(null)

      const refreshFromHost = React.useCallback(async () => {
        try {
          const next = await loadStatus()
          setReport(next)
          return next
        } catch (failure) {
          setReport(null)
          setError(firstLine(failure && failure.message ? failure.message : failure))
          return undefined
        }
      }, [])

      React.useEffect(() => {
        void refreshFromHost()
      }, [refreshFromHost])

      /**
       * 写入一次并校验。
       *
       * 没有保存按钮，也不做"停顿即写"：打字过程中绝不打扰输入，
       * 提交由失焦（或离开面板）触发。
       */
      const commit = React.useCallback(
        async (patch) => {
          setError('')
          try {
            // 只走官方通道 settingsScope.mutate：它自带 revision 栅栏。
            // 曾有一条"直连宿主 settings.replace"的备用通道——replace 是整节替换，
            // 而这里的补丁只是部分字段（如 {enabled}），会把用户的规则整节清空。
            let ok = false
            if (controller !== null && typeof controller.mutate === 'function') {
              try {
                const operations = Object.keys(patch).map((key) => ({ op: 'set', path: [key], value: patch[key] }))
                await controller.mutate(operations)
                ok = true
              } catch (_mirrorFailure) {
                ok = false
              }
            }
            if (!ok) {
              setError('写入失败：设置服务不可用。请点“重试”；先不要刷新页面，刷新会丢掉这段未写入的内容。')
              return false
            }
            const verified = await refreshFromHost()
            if (verified !== undefined && patch.segments !== undefined) {
              const expected = Array.isArray(patch.segments) ? patch.segments.length : undefined
              const actual = Array.isArray(verified.segments) ? verified.segments.length : undefined
              if (expected !== undefined && actual !== undefined && expected !== actual) {
                setError('写入未生效（提交 ' + String(expected) + ' 条，宿主返回 ' + String(actual) + ' 条）。请点“重试”；先不要刷新页面，刷新会丢掉这段未写入的内容。')
                return false
              }
            }
            // 只在"没有新的待写改动"时才丢弃本地草稿，回落到宿主回读值。
            //
            // 曾经无条件 setDraft(null)：写入是异步的，期间用户在输入框里继续打字，
            // 写完那一刻草稿被清空、受控输入框被回写成宿主回读的旧值——
            // 用户在在途期间敲的字就这么没了（而且看起来像输入被吃掉）。
            if (pendingRef.current === null && flushRef.current === null) setDraft(null)
            return true
          } catch (failure) {
            setError(firstLine(failure && failure.message ? failure.message : failure))
            return false
          }
        },
        [controller, refreshFromHost]
      )

      /** 串行提交：正在写时把最新一次挂起，写完立刻接着写。 */
      const flush = React.useCallback(
        async (patch) => {
          pendingRef.current = pendingRef.current === null ? patch : { ...pendingRef.current, ...patch }
          if (flushRef.current !== null) return flushRef.current
          setBusy(true)
          flushRef.current = (async () => {
            let landed = true
            try {
              while (pendingRef.current !== null) {
                const next = pendingRef.current
                pendingRef.current = null
                const ok = await commit(next)
                // 没落地的补丁必须留住：否则"重试"按钮重试的是空气，
                // 用户的改动在失败后静默消失（真实缺陷）。
                if (!ok) {
                  landed = false
                  failedRef.current = failedRef.current === null ? next : { ...failedRef.current, ...next }
                }
              }
            } finally {
              // 整轮都落地才算干净：只要有一个没写进去就保留，交给"重试"。
              // （若在单个 commit 成功时就清空，后面仍在排队的失败补丁会被抹掉。）
              if (landed) failedRef.current = null
              flushRef.current = null
              setBusy(false)
            }
          })()
          return flushRef.current
        },
        [commit]
      )

      /**
       * 输入过程中的本地更新：只改界面，写设置等到失焦。
       * @param next 下一份本地设置快照
       * @param patch 该次改动对应的写入补丁
       */
      const editLocal = React.useCallback((next, patch) => {
        setDraft(next)
        pendingRef.current = pendingRef.current === null ? patch : { ...pendingRef.current, ...patch }
      }, [])

      /** 失焦提交：把输入过程中的改动一次写入。 */
      const commitPending = React.useCallback(() => {
        const pending = pendingRef.current
        pendingRef.current = null
        if (pending !== null) void flush(pending)
      }, [flush])

      // 离开面板时兜底写入：避免"改完直接关掉页面"丢字
      React.useEffect(() => () => {
        const pending = pendingRef.current
        pendingRef.current = null
        if (pending !== null) void flush(pending)
      }, [flush])

      const local = draft !== null ? draft : normalizeSettings(report)
      const canWrite = report === null || report.writable !== false

      /**
       * 预览的唯一数据源。
       *
       * 只要本地有未提交的改动（draft 非 null）就用本地内容立即重算，
       * 否则用宿主回读的结果。否则"勾选后预览不动"——宿主报告是提交前算的。
       */
      // 预览永远基于当前编辑内容：单一数据源，不随"是否已提交"切换
      // （曾在本地/宿主两份数据间切换，状态残留时会显示旧内容）。
      const previewBody = previewText(local)
      const preview = {
        text: previewBody,
        // 超限判断保持**字节**口径：宿主的上限（maxBytes）就是按 UTF-8 字节算的，
        // 换成字符数会让"看着没超、实际已超"。呈现给用户时才换算成字符数。
        overBudget: byteLength(previewBody) > local.maxBytes,
        bytes: byteLength(previewBody),
        chars: characterCount(previewBody),
        tokens: estimateTokens(previewBody)
      }

      const state = {
        report,
        preview,
        busy,
        error,
        local,
        isReady: report !== null,
        canWrite,
        expandedId
      }
      /**
       * 重试上一次没写成功的补丁。
       *
       * 必须定义在组件作用域里：`failedRef` 与 `flush` 都只在这里可见。
       * 曾把它写进下面的纯渲染函数，那里既拿不到 ref 也拿不到 flush，
       * 渲染一走到错误分支就抛 `failedRef is not defined`（整页报错）。
       */
      function retryFailedWrite() {
        setError('')
        const retry = failedRef.current
        if (retry === null) return
        failedRef.current = null
        // 用 timer 让重试离开本次点击的渲染周期，避免与设置服务的写入栅栏撞车；
        // 没有 timer 服务时直接写，不因为可选服务缺失而让重试失效。
        const timer = pluginCtx && pluginCtx.timer
        if (timer !== undefined && typeof timer.timeout === 'function') timer.timeout(() => void flush(retry), 0)
        else void flush(retry)
      }

      const actions = {
        flush,
        editLocal,
        commitPending,
        retryFailedWrite,
        setError,
        setExpandedId
      }
      return renderSectionView({ actions, state, helpers: { createSegmentId } })
    }

    /** 空列表提示：区分"设置尚未读回来"与"确实没有上下文"。 */
    function emptyStateHint(isReady) {
      return isReady ? '还没有上下文。点「添加上下文」写一段，之后新开的对话都会带上它。' : '正在读取设置…'
    }

    /**
     * 纯渲染：把状态映射成元素树。
     *
     * 与 hooks 分离是刻意的——组件只负责状态与写入，布局可以在 `node --test`
     * 下确定性地断言（不依赖 React 运行时）。
     *
     * 交互原则：没有保存动作，也没有成功提示。改动即生效，只有真正失败时
     * 才出现一条错误说明与重试入口。
     */
    function renderSectionView(input) {
      const { actions, state, helpers } = input
      const { preview, busy, error, local, isReady, canWrite, expandedId } = state
      const { flush, editLocal, commitPending, retryFailedWrite, setError, setExpandedId } = actions

      const writable = canWrite !== false
      // 列表按数组顺序展示：顺序不影响任何行为，故不提供排序操作。
      const segments = local.segments.slice()

      /**
       * 改一条上下文：立刻反映到界面，写设置留到失焦。
       *
       * 不在输入过程中写入——写入会触发重渲染与状态回读，用户的输入位置会被打断。
       */
      function patchSegment(index, patch) {
        const next = segments.slice()
        next[index] = { ...next[index], ...patch }
        editLocal({ ...local, segments: next }, { segments: next })
      }

      /**
       * 每行的启停开关：立即生效。
       *
       * 与正文输入不同，切开关是一次明确的点击动作，没有"边打边看"的过程，
       * 所以当场提交（曾经只改本地不提交，表现为"切了像没切、预览也不变"）。
       */
      function toggleSegment(index, enabled) {
        const next = segments.slice()
        next[index] = { ...next[index], enabled }
        editLocal({ ...local, segments: next }, { segments: next })
        commitPending()
      }

      function removeSegment(index) {
        const next = segments.slice()
        next.splice(index, 1)
        setExpandedId(null)
        editLocal({ ...local, segments: next }, { segments: next })
        commitPending()
      }

      function addSegment() {
        const id = helpers.createSegmentId(segments.map((segment) => segment.id))
        const next = segments.concat([{ id, enabled: true, text: '' }])
        setExpandedId(id)
        editLocal({ ...local, segments: next }, { segments: next })
        commitPending()
      }

      const children = []

      // 标题与说明：与官方设置页一致——标题 18/600，说明 13 三级色，
      // 两者是外层容器的两个子元素（由区段 gap 撑开），说明内部再留小间距。
      // 「它写在最前面、优先于其他说明」这句是**页面级**说明（位置与优先级），
      // 归这里；预览卡片只呈现内容与消耗，不要再把它塞回卡片里（用户明确要求）。
      children.push(React.createElement('div', { className: 'dec-heading', key: 'head' }, [
        React.createElement('p', { className: 'dec-title', key: 't' }, '额外上下文'),
        React.createElement('p', { className: 'dec-intro-line', key: 'intro' }, '它写在每次对话的最前面，优先于其他说明。这里写的上下文会附加到之后新开的对话里持续生效，改动只影响新开的对话——如果某个对话里看不到这些内容，通常是该对话的 Agent 预设也定义了同名设置。')
      ]))

      // 操作行：左侧「添加上下文」，右侧功能总开关（官方 Switch，贴右）。
      // 总开关是硬开关：关闭后整段上下文都不进入提示词，所以点一下当场提交。
      children.push(React.createElement('div', { className: 'dec-actions', key: 'add-row' }, [
        React.createElement('button', {
          key: 'add',
          type: 'button',
          className: 'dec-btn',
          disabled: busy || !writable,
          onBlur: commitPending,
          onClick: addSegment
        }, '+ 添加上下文'),
        React.createElement('span', { className: 'dec-master', key: 'master' }, [
          React.createElement('span', { className: 'dec-master-label', key: 'label' }, '总开关'),
          React.createElement(Switch, {
            key: 'switch',
            className: 'dec-master-switch',
            checked: local.enabled,
            // 与其它动作按钮一致：写入进行中禁用（输入控件不参与，见本文件相关注释）
            disabled: busy || !writable,
            label: '额外上下文总开关',
            onChange: (next) => void flush({ enabled: next })
          })
        ])
      ]))

      // 规则列表
      const listBody = segments.length === 0
        ? React.createElement('p', { className: 'dec-desc', style: { padding: '14px 10px' } }, emptyStateHint(isReady))
        : React.createElement('div', { className: 'dec-list' }, segments.map((segment, index) =>
            React.createElement(SegmentCard, {
              key: segment.id,
              segment,
              index,
              expanded: expandedId === segment.id,
              onToggleExpand: () => setExpandedId(expandedId === segment.id ? null : segment.id),
              onChange: (patch) => patchSegment(index, patch),
              onToggle: (enabled) => toggleSegment(index, enabled),
              onRemove: () => removeSegment(index),
              onCommit: commitPending
            })
          ))

      children.push(React.createElement('div', { key: 'rules' }, [listBody]))

      // 写入失败时才出现提示与重试（成功不提示）
      if (error !== '') {
        children.push(React.createElement('div', { className: 'dec-actions', key: 'error' }, [
          React.createElement('p', { className: 'dec-error', key: 'text' }, error),
          React.createElement('button', {
            key: 'retry',
            type: 'button',
            className: 'dec-btn',
            disabled: busy,
            onClick: () => { retryFailedWrite() }
          }, '重试')
        ]))
      }

      // 预览常显：它就是这段上下文最终的样子，不做成可关闭的按钮。
      // 「预览」标题在卡片之外；卡片内只有两段：内容（详情）／消耗。
      // 位置与优先级的说明属于页面级文案，已上移到标题下方的 dec-intro-line。
      {
        const { text, overBudget, bytes, chars, tokens } = preview
        children.push(React.createElement('p', { className: 'dec-preview-heading', key: 'preview-heading' }, '预览'))
        children.push(React.createElement('div', { className: 'dec-preview', key: 'preview-body' }, [
          React.createElement('div', { className: 'dec-preview-text', key: 'text' },
            text !== '' ? text : '（当前为空：不会向对话附加任何内容）'),
          React.createElement('div', { className: 'dec-preview-cost', key: 'cost' }, [
            React.createElement('span', { className: 'dec-preview-cost-value', key: 'value' }, `约 ${String(chars)} 个字符 · 约 ${String(tokens)} tokens`),
            overBudget
              ? React.createElement('span', { className: 'dec-preview-warn', key: 'warn' }, '内容偏长，建议精简或拆成按需启用的上下文')
              : null
          ].filter((node) => node !== null))
        ]))
      }

      return React.createElement('div', { className: 'dec-section' }, children)
    }

    function apply(ctx) {
      pluginCtx = ctx
      settingsController = ctx.settingsScope.bind({
        namespace: SETTINGS_NAMESPACE,
        decode: decodeExtraSection
      })
      // 样式由插件自己拥有：apply 时注入一次，不依赖任何组件是否渲染
      // （设置页导航里的补丁比分区面板更早出现，见 installStyles）。
      installStyles(ctx)
      // 显式传递被包住的组件类型：既让接线关系一目了然，
      // 也让"边界有没有接在树上"可被断言（曾出现类还在但没包住的形态）。
      const Section = () => React.createElement(
        SectionErrorBoundary,
        { sectionComponent: ExtraContextSection },
        React.createElement(ExtraContextSection, {})
      )
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'extra-context',
        order: 25,
        label: SECTION_LABEL
      }, Section))
      // 导航图标补丁的挂载点。落在设置面板 header 的动作区，面板一开就存在，
      // 面板关闭即随插件 fiber 卸载并还原图标（见 patchSettingsNavIcon）。
      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: 'extra-context-nav-icon',
        order: 25
      }, ExtraContextNavIcon))
    }

    exports.inject = inject
    exports.apply = apply
    /**
     * 仅用于测试的纯函数出口：产品代码不依赖这里的名字。
     */
    /**
     * 测试探针：只暴露测试真正使用的接口。
     * 曾经把 renderSectionView/预算函数等一并导出，随着测试改为驱动真实组件渲染，
     * 那些导出已无人使用，故收掉。
     */
    exports.__internals = Object.freeze({
      SectionErrorBoundary,
      // 字符计数：测试要验证"界面数字 == 用户看到的字数"，含 emoji 等多码点字符
      characterCount,
      // 接线断言要用：设置页真正的面板组件（测试用例验证它确实被错误边界包住）
      ExtraContextSection,
      // 导航图标补丁：DOM 在浏览器里，测试只能用注入的假 document / 假模板驱动这几个函数
      navIconMaskSource,
      patchSettingsNavIcon,
      installNavIconPatch
    })

    return module.exports
  }
})
