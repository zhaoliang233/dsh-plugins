import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const PLUGIN_NAME = 'dsh-mobile-compat'
export const STATUS_PATH = '/dsh-mobile-compat/status'
export const inject = []

const DSH_PACKAGE = '@deepseek-ai/dsh'

export function readDshPackage(entryPath = process.argv[1]) {
  if (typeof entryPath !== 'string' || entryPath.trim() === '') {
    throw new Error('cannot locate the DSH CLI entry path')
  }

  let directory = dirname(realpathSync(entryPath))
  for (let depth = 0; depth < 4; depth += 1) {
    const manifestPath = join(directory, 'package.json')
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest?.name === DSH_PACKAGE) {
        if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
          throw new Error(`${DSH_PACKAGE} package.json has no version`)
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
  throw new Error(`cannot locate ${DSH_PACKAGE}/package.json from the DSH CLI entry`)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  })
  res.end(body)
}

export function createStatusRoute(snapshot, connection) {
  return {
    kind: 'exact',
    path: STATUS_PATH,
    handler(req, res) {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, {
          ok: false,
          error: rejection === 401 ? 'browser authentication required' : 'request authority rejected'
        })
        return
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!snapshot.ok) {
        sendJson(res, 503, snapshot)
        return
      }
      sendJson(res, 200, snapshot)
    }
  }
}

export function apply(ctx, entryPath = process.argv[1]) {
  let snapshot
  try {
    const manifest = readDshPackage(entryPath)
    snapshot = { ok: true, package: manifest.name, version: manifest.version }
  } catch (error) {
    snapshot = {
      ok: false,
      package: DSH_PACKAGE,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  ctx.inject(['webServer', 'connection'], (webContext) => {
    if (typeof webContext.connection?.requestRejection !== 'function') {
      throw new Error('incompatible DSH connection service: missing requestRejection()')
    }
    const route = createStatusRoute(snapshot, webContext.connection)
    webContext.effect(
      () => webContext.webServer.register(route),
      `${PLUGIN_NAME}: runtime version route`
    )
  })
}

export default {
  name: PLUGIN_NAME,
  inject,
  apply
}
