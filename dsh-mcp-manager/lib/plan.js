/**
 * 纯逻辑：把「期望的服务器清单」与「当前已挂载的实例」比出一次对账计划。
 *
 * 对账是本插件的核心语义：设置（settings 命名空间）是唯一真相，
 * 挂载状态是它的投影。任何设置写入都只产生一份计划，再由挂载管理器执行。
 * 本文件不依赖 Cordis，可被 `node --test` 独立驱动。
 *
 * @module dsh-mcp-manager/plan
 */

import { canonicalJson, validateServer } from './store.js'

/**
 * @typedef {object} ReconcileInput
 * @property {{enabled: boolean, servers: any[]}} settings 已规范化的设置
 * @property {Map<string, {configKey: string}>} actual 当前已挂载：id → 已挂载配置指纹
 * @property {Map<string, string>} [profileNames] profile 组合里已被占用的 serverName → 来源描述
 * @property {(server: any) => {config: any, missing: string[]}} resolveConfig 生成挂载配置（含凭据替换）
 * @property {(server: any, options: any) => string[]} [validate] 校验函数，默认用 store.validateServer
 */

/**
 * 计算一次对账计划。计划本身幂等：用同一份输入重复调用得到同一份输出。
 *
 * - `mount`：尚未挂载或配置已变的条目（配置变化走「先卸后挂」，避免原地重启的中间态）；
 * - `unmount`：已被删除、被停用、或配置已变（先卸）的已挂载实例；
 * - `blocked`：校验不通过或与配置文件的服务器重名，不挂载并向用户报原因；
 * - `unchanged`：配置指纹一致，保持挂载不动。
 *
 * @param {ReconcileInput} input
 * @returns {{mount: any[], unmount: string[], blocked: any[], unchanged: string[]}}
 */
export function planReconcile(input) {
  const { settings, actual, profileNames = new Map(), resolveConfig, validate } = input
  /** @type {any[]} */
  const mount = []
  /** @type {string[]} */
  const unmount = []
  /** @type {any[]} */
  const blocked = []
  /** @type {string[]} */
  const unchanged = []

  const wantedIds = new Set()
  /** @type {Map<string, string>} */
  const idToName = new Map()
  /** @type {string[]} */
  const allNames = []
  for (const server of settings.servers) {
    idToName.set(server.id, server.serverName)
    allNames.push(server.serverName)
  }
  const check = validate ?? ((server) => validateServer(server, { takenNames: allNames, idToName }))
  const duplicateNames = new Set()
  {
    const seen = new Set()
    for (const name of allNames) {
      if (seen.has(name)) duplicateNames.add(name)
      seen.add(name)
    }
  }

  if (settings.enabled) {
    for (const server of settings.servers) {
      if (!server.enabled) continue
      const issues = check(server)
      // 被拦下的条目刻意**不**计入 wantedIds：它此前可能已经挂着，
      // 而用户刚把它改坏（例如清空了命令）——旧实例必须停下来，
      // 否则界面上显示的是新配置、跑着的却是旧配置。
      if (duplicateNames.has(server.serverName)) {
        blocked.push({
          id: server.id,
          serverName: server.serverName,
          reason: `服务器名「${server.serverName}」重复`
        })
        continue
      }
      const owner = profileNames.get(server.serverName)
      if (owner !== undefined) {
        blocked.push({
          id: server.id,
          serverName: server.serverName,
          reason: `服务器名「${server.serverName}」已被 ${owner} 使用；改名或先移除那一项`
        })
        continue
      }
      if (issues.length > 0) {
        blocked.push({ id: server.id, serverName: server.serverName, reason: issues.join('；') })
        continue
      }
      wantedIds.add(server.id)
      const resolved = resolveConfig(server)
      const configKey = canonicalJson(resolved.config)
      const current = actual.get(server.id)
      if (current !== undefined && current.configKey === configKey) {
        unchanged.push(server.id)
        continue
      }
      if (current !== undefined) unmount.push(server.id)
      mount.push({
        id: server.id,
        serverName: server.serverName,
        config: resolved.config,
        configKey,
        missingCredentials: resolved.missing
      })
    }
  }

  for (const id of actual.keys()) {
    if (wantedIds.has(id)) continue
    unmount.push(id)
  }

  return { mount, unmount, blocked, unchanged }
}
