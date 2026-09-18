// 插件内共享的错误类型。单独成模块，避免 profile patch 事务模块与 profile 枚举模块互相 import。
export class LocalPluginManagerError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'LocalPluginManagerError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
