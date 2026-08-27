import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PLUGIN_NAME = 'dsh-auto-load-history'
export const inject = []
export const DSH_COMPATIBILITY_RANGE = '>=0.1.6-alpha.1 <0.1.7'
const VERIFIED_DSH_VERSIONS = new Set(['0.1.6-alpha.1'])
const DSH_VERSION_PATTERN = /^0\.1\.6(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/u
const DSH_PRERELEASE_ORDER = { alpha: 0, beta: 1, rc: 2 }

export function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const match = DSH_VERSION_PATTERN.exec(normalized)
  if (match === null) return { supported: false, verified: false, normalized }
  const supported = match[1] === undefined
    || DSH_PRERELEASE_ORDER[match[1]] > DSH_PRERELEASE_ORDER.alpha
    || Number(match[2]) >= 1
  return { supported, verified: supported && VERIFIED_DSH_VERSIONS.has(normalized), normalized }
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

// The feature lives entirely in the Web client: it consumes `ctx.sessions` and
// the General-settings item slot there. The Host half stays inert but still
// verifies the running DSH release before joining the bundle lifecycle.
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
