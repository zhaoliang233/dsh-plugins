import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { LocalPluginManagerError } from '../lib/profile-manager.js'
import { clientRequestRejection, readJsonBody, sameOriginRequest, setLoaderEntryDisabled } from '../lib/index.js'

function request(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } }
}

test('accepts only loopback same-origin browser requests', () => {
  assert.equal(sameOriginRequest(request({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-origin'
  })), true)
  assert.equal(sameOriginRequest(request({
    host: '127.0.0.1:3080',
    origin: 'http://evil.example',
    'sec-fetch-site': 'cross-site'
  })), false)
  assert.equal(sameOriginRequest(request({
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-origin'
  }, '192.168.1.20')), false)
})

test('requires the DSH browser-auth boundary before custom request checks', () => {
  const trustedHeaders = {
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'sec-fetch-site': 'same-origin',
    'x-dsh-local-plugin-manager-client': '1'
  }
  const authenticated = { requestRejection: () => undefined }
  const unauthenticated = { requestRejection: () => 401 }
  const wrongAuthority = { requestRejection: () => 403 }

  assert.equal(clientRequestRejection(request(trustedHeaders), authenticated), undefined)
  assert.equal(clientRequestRejection(request(trustedHeaders), unauthenticated), 401)
  assert.equal(clientRequestRejection(request(trustedHeaders), wrongAuthority), 403)
  assert.equal(clientRequestRejection(request({ ...trustedHeaders, 'x-dsh-local-plugin-manager-client': undefined }), authenticated), 403)
})

test('retries a forced Loader update until fiber state matches', async () => {
  const entry = {
    id: 'include:dsh-demo-local',
    options: { id: 'dsh-demo-local', name: 'different-module-name' },
    fiber: {},
    calls: 0,
    async update(options, write, force) {
      this.calls += 1
      assert.deepEqual(options, { disabled: true })
      assert.equal(write, false)
      assert.equal(force, true)
      if (this.calls === 2) this.fiber = undefined
    }
  }
  const unrelated = {
    id: 'include:plugin-subtree:dsh-demo-local',
    options: { id: 'dsh-demo-local', name: 'dsh-demo-local' },
    fiber: {},
    async update() { throw new Error('unrelated same-name row must not be updated') }
  }
  const ctx = {
    get(name) {
      assert.equal(name, 'loader')
      return { entries: () => [entry, unrelated] }
    }
  }
  const result = await setLoaderEntryDisabled(ctx, {
    name: 'dsh-demo-local',
    rowIds: ['dsh-demo-local']
  }, true)
  assert.deepEqual(result, { applied: true, matched: 1 })
  assert.equal(entry.calls, 2)
})

test('reads only bounded JSON objects', async () => {
  const valid = Readable.from([Buffer.from('{"action":"disable"}')])
  valid.headers = { 'content-type': 'application/json; charset=utf-8' }
  assert.deepEqual(await readJsonBody(valid), { action: 'disable' })

  const wrongType = Readable.from([Buffer.from('{}')])
  wrongType.headers = { 'content-type': 'text/plain' }
  await assert.rejects(
    readJsonBody(wrongType),
    (error) => error instanceof LocalPluginManagerError && error.code === 'invalid-content-type'
  )

  const tooLarge = Readable.from([Buffer.alloc(20)])
  tooLarge.headers = { 'content-type': 'application/json' }
  await assert.rejects(
    readJsonBody(tooLarge, 10),
    (error) => error instanceof LocalPluginManagerError && error.code === 'request-too-large'
  )
})
