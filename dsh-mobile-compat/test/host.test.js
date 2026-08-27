import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import plugin, {
  PLUGIN_NAME,
  STATUS_PATH,
  apply,
  createStatusRoute,
  inject,
  readDshPackage
} from '../lib/index.js'

function invoke(route, method = 'GET', options = {}) {
  let status
  let headers
  let body = ''
  const res = {
    writeHead(nextStatus, nextHeaders) {
      status = nextStatus
      headers = nextHeaders
    },
    end(chunk = '') { body += chunk }
  }
  route.handler({ method, authenticated: options.authenticated !== false }, res)
  return { status, headers, body: JSON.parse(body) }
}

async function fakeDshPackage(version = '0.1.6-alpha.1') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-host-'))
  const lib = join(root, 'lib')
  await mkdir(lib)
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/dsh', version })}\n`)
  await writeFile(join(lib, 'bin.js'), '')
  return { root, bin: join(lib, 'bin.js') }
}

test('Host resolves an adjacent CLI package manifest and owns its status route', async () => {
  const fixture = await fakeDshPackage()
  const disposers = []
  let route
  let routeRemoved = false
  const ctx = {
    inject(services, bind) {
      assert.deepEqual(services, ['webServer', 'connection'])
      bind({
        connection: {
          requestRejection(request) { return request.authenticated ? undefined : 401 }
        },
        webServer: {
          register(value) {
            route = value
            return () => { routeRemoved = true }
          }
        },
        effect(start, label) {
          assert.match(label, /runtime version route/)
          disposers.push(start())
        }
      })
    }
  }

  try {
    assert.deepEqual(readDshPackage(fixture.bin), { name: '@deepseek-ai/dsh', version: '0.1.6-alpha.1' })
    assert.equal(PLUGIN_NAME, 'dsh-mobile-compat')
    assert.deepEqual(inject, [])
    assert.equal(plugin.name, PLUGIN_NAME)
    assert.equal(plugin.apply, apply)

    apply(ctx, fixture.bin)
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, STATUS_PATH)
    const response = invoke(route)
    assert.equal(response.status, 200)
    assert.match(response.headers['Content-Type'], /application\/json/)
    assert.equal(response.headers['Cache-Control'], 'no-store')
    assert.deepEqual(response.body, {
      ok: true,
      package: '@deepseek-ai/dsh',
      version: '0.1.6-alpha.1'
    })

    const unauthenticated = invoke(route, 'GET', { authenticated: false })
    assert.equal(unauthenticated.status, 401)
    assert.deepEqual(unauthenticated.body, { ok: false, error: 'browser authentication required' })

    const method = invoke(route, 'POST')
    assert.equal(method.status, 405)
    assert.equal(method.body.ok, false)

    for (const dispose of disposers.reverse()) dispose()
    assert.equal(routeRemoved, true)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Host status fails closed when CLI provenance is unavailable', () => {
  const route = createStatusRoute({
    ok: false,
    package: '@deepseek-ai/dsh',
    error: 'cannot locate package'
  }, { requestRejection: () => undefined })
  const response = invoke(route)
  assert.equal(response.status, 503)
  assert.deepEqual(response.body, {
    ok: false,
    package: '@deepseek-ai/dsh',
    error: 'cannot locate package'
  })
})
