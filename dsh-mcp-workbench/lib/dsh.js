/**
 * DSH 安装定位与版本门。
 *
 * 改造后宿主半体不再加载 `@deepseek-ai/dsh-mcp-client` 或任何 DSH 内部模块：
 * 服务器由官方 `ctx.mcpManager` 挂载，本插件只负责版本门与 Loader 条目探测。
 * 因此这里只剩「读安装版本」与「按发布线判定」两件事。
 *
 * @module dsh-mcp-workbench/dsh
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 兼容发布线。与 `package.json#dshCompatibility.range` / `engines.dsh` /
 * `install.sh` 的 `DSH_COMPATIBILITY_RANGE` **同源**。
 */
export const DSH_COMPATIBILITY_RANGE = '>=0.2.2-alpha.2 <0.2.3'
/** 发布线本体；兼容线只覆盖这一个 patch 系列。 */
export const DSH_RELEASE_LINE = '0.2.2'
/**
 * 兼容线下界（`0.2.2-alpha.2`）：同线内更小序列号的 alpha，以及整条 0.2.2
 * 的 beta/rc 之前的版本都低于下界，判为不支持。跨线时改这几个常量即可，
 * 判定逻辑不用动。
 */
export const DSH_RELEASE_FLOOR = { channel: 'alpha', sequence: 2 }
/** prerelease channel 的先后顺序；下标即优先级。 */
const PRERELEASE_CHANNELS = ['alpha', 'beta', 'rc']
/**
 * 逐版本核对过的 DSH 版本（其它同线版本带警告运行）。
 *
 * `0.2.2-rc.2` 起官方才有 `@deepseek-ai/dsh-mcp-manager`；更早的同线版本在
 * 门内运行但状态页会提示「官方管理器缺失」（能力探测兜底）。
 */
export const VERIFIED_DSH_VERSIONS = ['0.2.2-alpha.2', '0.2.2-rc.1', '0.2.2-rc.2']

/**
 * 判定 DSH 版本是否落在已核对契约的兼容线内。
 *
 * 只按版本号形状判定，不猜「看起来差不多」的版本：正式版与
 * `0.2.2-{alpha,beta,rc}.N` 里够到或高于下界的那些算同线，其余一律
 * `supported: false`。下界是 rc 时必须比较 channel 优先级——旧的
 * `channel !== 'alpha' || seq >= N` 写法会把 `0.2.0-alpha.9` 判成兼容。
 *
 * @param {unknown} version
 * @returns {{supported: boolean, verified: boolean, normalized?: string}}
 */
export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = VERIFIED_DSH_VERSIONS.includes(normalized)
  if (normalized === DSH_RELEASE_LINE) return { supported: true, verified, normalized }
  const prerelease = new RegExp(`^${DSH_RELEASE_LINE.replace(/\./gu, '\\.')}-(alpha|beta|rc)\\.(0|[1-9]\\d*)$`, 'u').exec(
    normalized
  )
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const rank = PRERELEASE_CHANNELS.indexOf(prerelease[1])
  const floorRank = PRERELEASE_CHANNELS.indexOf(DSH_RELEASE_FLOOR.channel)
  const supported = rank > floorRank || (rank === floorRank && Number(prerelease[2]) >= DSH_RELEASE_FLOOR.sequence)
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
