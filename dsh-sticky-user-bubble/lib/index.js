import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PLUGIN_NAME = 'dsh-sticky-user-bubble'
export const inject = []
/**
 * 兼容发布线。与 `package.json#dshCompatibility.range` / `engines.dsh` /
 * `install.sh` 的 `DSH_COMPATIBILITY_RANGE` **同源**。
 */
export const DSH_COMPATIBILITY_RANGE = '>=0.2.0-rc.2 <0.2.1'
/** 发布线本体；兼容线只覆盖这一个 patch 系列。 */
export const DSH_RELEASE_LINE = '0.2.0'
/**
 * 兼容线下界（`0.2.0-rc.2`）：同线内更低 channel（alpha/beta）或更小序列号
 * 的 rc 都低于下界，判为不支持。跨线时改这三个常量即可，判定逻辑不用动。
 */
export const DSH_RELEASE_FLOOR = { channel: 'rc', sequence: 2 }
/** prerelease channel 的先后顺序；下标即优先级。 */
const PRERELEASE_CHANNELS = ['alpha', 'beta', 'rc']
/** 逐版本核对清单；与 `package.json#dshCompatibility.verifiedVersions` / `install.sh` 同源。 */
export const VERIFIED_DSH_VERSIONS = ['0.2.0-rc.2']

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
  const supported =
    rank > floorRank || (rank === floorRank && Number(prerelease[2]) >= DSH_RELEASE_FLOOR.sequence)
  return { supported, verified: supported && verified, normalized }
}

export function readDshPackage(entryPath = process.argv[1]) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    throw new Error('cannot locate the DSH CLI entry path')
  }
  let directory = dirname(realpathSync(entryPath))
  for (let depth = 0; depth < 4; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest?.name === '@deepseek-ai/dsh') {
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
          throw new Error('@deepseek-ai/dsh package.json has no version')
        }
        return { name: manifest.name, version: manifest.version }
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

export function applyForVersion(ctx, version) {
  const compatibility = classifyDshVersion(version)
  if (!compatibility.supported) {
    ctx?.logger?.warn?.(`${PLUGIN_NAME}: DSH ${version} is outside ${DSH_COMPATIBILITY_RANGE}; plugin remains inert`)
    return
  }
  if (!compatibility.verified) {
    ctx?.logger?.warn?.(`${PLUGIN_NAME}: DSH ${version} is inside ${DSH_COMPATIBILITY_RANGE} but is not individually verified; client capability checks remain authoritative`)
  }
}

// The feature lives entirely in the Web client. The Host half is intentionally
// inert, but still verifies the running DSH release before participating in the
// normal bundle lifecycle.
export function apply(ctx) {
  let manifest
  try {
    manifest = readDshPackage(process.argv[1])
  } catch (error) {
    ctx?.logger?.error?.(`${PLUGIN_NAME}: cannot verify the running DSH package; plugin remains inert: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  return applyForVersion(ctx, manifest.version)
}

export default {
  name: PLUGIN_NAME,
  inject,
  apply
}
