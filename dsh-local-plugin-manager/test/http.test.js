import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { LocalPluginManagerError } from '../lib/profile-manager.js'
import { clientRequestRejection, observeLoaderEntryState, readJsonBody, sameOriginRequest } from '../lib/index.js'

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

test('observes the Loader row without writing to it', async () => {
  let visible = true
  const entry = {
    id: 'include:dsh-demo-local',
    options: { id: 'dsh-demo-local', name: 'different-module-name' },
    get fiber() { return visible ? {} : undefined },
    async update() { throw new Error('observation must never update the Loader entry') }
  }
  const unrelated = {
    id: 'include:plugin-subtree:dsh-demo-local',
    options: { id: 'dsh-demo-local', name: 'dsh-demo-local' },
    fiber: {},
    async update() { throw new Error('unrelated same-name row must not be touched') }
  }
  const ctx = {
    get(name) {
      assert.equal(name, 'loader')
      return { entries: () => [entry, unrelated] }
    }
  }
  const target = { name: 'dsh-demo-local', rowIds: ['dsh-demo-local'] }

  // 行已经停用：立刻得到肯定结论，且没有碰 Loader。
  visible = false
  assert.deepEqual(await observeLoaderEntryState(ctx, target, true), { applied: true })

  // 行仍在运行：观察超时后报告「尚未生效」，由调用方提示需要重启。
  visible = true
  assert.deepEqual(await observeLoaderEntryState(ctx, target, true, { timeoutMs: 30, pollMs: 10 }), { applied: false })

  // 没有 loader 服务时同样只能报告「尚未生效」，而不是假装已生效。
  assert.deepEqual(await observeLoaderEntryState({ get: () => undefined }, target, true), { applied: false })
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
