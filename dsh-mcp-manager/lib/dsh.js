/**
 * DSH 安装定位、版本门与内部模块加载。
 *
 * 为什么需要这一层：
 * - 本插件的宿主半体不声明 `@deepseek-ai/*` 依赖（工作区惯例），裸 `import`
 *   在 `link:` 源码安装下必然 `ERR_MODULE_NOT_FOUND`（插件目录向上找不到
 *   DSH 的 node_modules）；
 * - 首选走 `ctx.loader.import(name)`：它以 profile 目录为解析锚点，源码安装
 *   与 registry 安装都能解析（本机隔离环境实测的落地策略）；
 * - 兜底走 `createRequire(<DSH 安装>/package.json).resolve()` 再动态 import，
 *   与 dsh-extra-context 的 schemastery 定位同款。
 *
 * @module dsh-mcp-manager/dsh
 */

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 与本包 manifest 的 `dshCompatibility.range` / `engines.dsh` 同源。 */
export const DSH_COMPATIBILITY_RANGE = '>=0.1.7-alpha.1 <0.1.8'
/** 逐版本核对过的 DSH 版本（其它同线版本带警告运行）。 */
export const VERIFIED_DSH_VERSIONS = ['0.1.7-alpha.2']

/**
 * 判定 DSH 版本是否落在已核对契约的兼容线内。
 * @param {unknown} version
 * @returns {{supported: boolean, verified: boolean, normalized?: string}}
 */
export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === '0.1.7') return { supported: true, verified, normalized }
  const prerelease = /^0\.1\.7-(alpha|beta|rc)\.(0|[1-9]\d*)$/u.exec(normalized)
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const supported = prerelease[1] !== 'alpha' || Number(prerelease[2]) >= 1
  return { supported, verified: supported && verified, normalized }
}

/**
 * 从 DSH CLI 入口向上找 `@deepseek-ai/dsh` 的安装目录。
 * @param {string} [entryPath]
 * @returns {Promise<{version: string, root: string}>}
 */
export async function readDshPackage(entryPath = process.argv[1]) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    throw new Error('cannot locate the DSH CLI entry path')
  }
  let directory = dirname(await realpathSafe(entryPath))
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest?.name === '@deepseek-ai/dsh') {
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
          throw new Error('@deepseek-ai/dsh package.json has no version')
        }
        return { version: manifest.version, root: directory }
      }
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`cannot parse ${manifestPath}: ${error.message}`)
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('cannot locate @deepseek-ai/dsh/package.json from the DSH CLI entry')
}

/** @param {string} path @returns {Promise<string>} */
async function realpathSafe(path) {
  const { realpath } = await import('node:fs/promises')
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

/**
 * 按绝对路径动态加载一个 DSH 内部模块。
 * @param {string} dshRoot
 * @param {string} specifier
 * @returns {Promise<any>}
 */
export async function importFromInstall(dshRoot, specifier) {
  const require = createRequire(join(dshRoot, 'package.json'))
  return await import(require.resolve(specifier))
}

/**
 * 加载 `@deepseek-ai/dsh-mcp-client` 模块与 schemastery。
 *
 * 两者都缺失时本插件无法工作，因此按 fail closed 处理：返回值里带上失败原因，
 * 由调用方决定「只提供状态页」还是整体拒绝。
 *
 * @param {any} ctx host 上下文
 * @param {{specifier: string}} options
 * @returns {Promise<{ok: boolean, module?: any, strategy?: string, errors: string[]}>}
 */
export async function loadDshModule(ctx, { specifier }) {
  /** @type {string[]} */
  const errors = []
  const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
  if (typeof loader?.import === 'function') {
    try {
      const module = await loader.import(specifier)
      const unwrapped = unwrapModule(module)
      if (unwrapped !== undefined) return { ok: true, module: unwrapped, strategy: 'loader-import', errors }
      errors.push(`loader.import(${specifier}) 没有返回可用的插件对象`)
    } catch (error) {
      errors.push(`loader-import: ${String(error?.message ?? error)}`)
    }
  } else {
    errors.push('loader-import: ctx.loader.import 不可用')
  }
  try {
    const { root } = await readDshPackage()
    const module = unwrapModule(await importFromInstall(root, specifier))
    if (module !== undefined) return { ok: true, module, strategy: 'install-absolute', errors }
    errors.push(`安装目录里的 ${specifier} 没有可用的插件对象`)
  } catch (error) {
    errors.push(`install-absolute: ${String(error?.message ?? error)}`)
  }
  return { ok: false, errors }
}

/**
 * 取出真正的插件对象：ESM 命名空间直接用（带 apply），CommonJS 取 default。
 * @param {any} module
 * @returns {any | undefined}
 */
export function unwrapModule(module) {
  if (module === null || module === undefined) return undefined
  if (typeof module.apply === 'function') return module
  const fallback = module.default ?? module
  if (typeof fallback?.apply === 'function') return fallback
  return undefined
}
