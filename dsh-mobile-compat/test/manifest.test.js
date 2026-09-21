import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const matrix = JSON.parse(await readFile(new URL('compatibility.json', root), 'utf8'))
const client = await readFile(new URL('client.js', root), 'utf8')
const host = await readFile(new URL('lib/index.js', root), 'utf8')
const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
const readme = await readFile(new URL('README.md', root), 'utf8')
const agents = await readFile(new URL('AGENTS.md', root), 'utf8')
const publishing = await readFile(new URL('PUBLISHING.md', root), 'utf8')
const installScript = await readFile(new URL('install.sh', root), 'utf8')

test('manifest declares the formal dual-half Web plugin', () => {
  assert.equal(manifest.name, 'dsh-mobile-compat')
  assert.equal(manifest.main, 'lib/index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./cordis.patch.yml'], './cordis.patch.yml')
  assert.equal(manifest.exports['./compatibility.json'], './compatibility.json')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-client-ui-primitives'
  ])
  assert.match(patch, /id: dsh-mobile-compat/)
  assert.match(installScript, /\[\[ "\$DSH_PROFILE" != "web" \]\]/)
})

test('compatibility matrix declares the verified 0.1.6 release line', () => {
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.1.6-alpha.1 <0.1.7',
    verifiedVersions: ['0.1.6-alpha.1', '0.1.6-alpha.2'],
    matrix: './compatibility.json',
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(matrix.schemaVersion, 2)
  assert.equal(matrix.policy, 'compatible-release-line')
  assert.equal(matrix.range, '>=0.1.6-alpha.1 <0.1.7')
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.deepEqual(matrix.verifiedVersions, ['0.1.6-alpha.1', '0.1.6-alpha.2'])
  assert.equal(matrix.futureVersionsRequireCapabilityChecks, true)
  assert.deepEqual(matrix.versions.map((entry) => entry.version), ['0.1.6-alpha.1', '0.1.6-alpha.2'])
  assert.equal(matrix.versions.every((entry) => entry.status === 'source-verified'), true)
  for (const id of ['app-frame-columns', 'workspace-header-controls', 'right-panel-chrome', 'right-panel-overlay-stacking', 'composer-dock-inline-cards', 'modal-and-popover-viewport']) {
    assert.equal(matrix.contracts.structural.some((entry) => entry.id === id), true, id)
  }

  assert.match(readme, />=0\.1\.6-alpha\.1 <0\.1\.7/)
  assert.match(readme, /0\.1\.6-alpha\.1/)
  assert.match(agents, /兼容发布线/)
  assert.match(publishing, /兼容发布线/)
})

test('client source declares release-line, connection, and structure gates', () => {
  assert.match(client, /DSH_COMPATIBILITY_RANGE = '>=0\.1\.6-alpha\.1 <0\.1\.7'/)
  assert.match(client, /VERIFIED_DSH_VERSIONS = new Set\(\['0\.1\.6-alpha\.1', '0\.1\.6-alpha\.2'\]\)/)
  // classifyDshVersion() derives the gate from DSH_RELEASE_LINE / DSH_MINIMUM_ALPHA, so those two
  // constants must still produce the declared range: a release-line bump that only edits the
  // range (or only the client constants) would otherwise pass every other gate.
  const releaseLine = /DSH_RELEASE_LINE = '([^']+)'/.exec(client)?.[1]
  const minimumAlpha = /DSH_MINIMUM_ALPHA = (\d+)/.exec(client)?.[1]
  assert.equal(releaseLine !== undefined && minimumAlpha !== undefined, true, 'client.js must declare DSH_RELEASE_LINE and DSH_MINIMUM_ALPHA')
  const [lowerBound, upperBound] = manifest.dshCompatibility.range.split(' ')
  assert.equal(lowerBound, `>=${releaseLine}-alpha.${minimumAlpha}`)
  const [major, minor, patch] = releaseLine.split('.')
  assert.equal(upperBound, `<${major}.${minor}.${Number(patch) + 1}`)
  assert.equal(Number(minimumAlpha) >= 1, true, 'the verified line must start at alpha.1 or later')
  assert.match(host, /readDshPackage/)
  assert.match(host, /\/dsh-mobile-compat\/status/)
  assert.match(client, /connection\?\.generation/)
  assert.match(client, /readiness\.getSnapshot/)
  assert.match(client, /fetch\(STATUS_PATH/)
  assert.match(client, /requestController\?\.abort\(\)/)
  assert.match(client, /data-dsh-mobile-shell-compatible/)
  assert.match(client, /data-dsh-mobile-workspaces-compatible/)
  assert.match(client, /native layout was preserved/)
  assert.match(client, /\[role='textbox'\]\[aria-multiline='true'\]/)
  assert.doesNotMatch(client, /closeDetails\s*\(/)
  assert.doesNotMatch(client, /closeRightbar\s*\(/)
  assert.doesNotMatch(client, /data-composer-input/)
})

test('the 44px touch floor stays off fixed-shape controls', () => {
  // Two controls are fixed shapes rather than glyph buttons: the attachment rail (a thumbnail row)
  // and a switch (a 36x20 capsule with a 16px thumb). Squaring either one off is a visible defect,
  // so every 44px floor excludes them and they grow an invisible target instead.
  assert.equal((client.match(/\[role='group'\], \[role='group'\] \*, \[role='switch'\]/g) || []).length, 5, 'every 44px floor must exclude role=group and role=switch')
  assert.match(client, /\[role='switch'\]::after/)
})

test('client probes the 0.1.6 sidebar/main/rightbar seats, not the retired conversation/details seats', () => {
  assert.match(client, /directSlot\(center, 'main'\)/)
  assert.match(client, /directSlot\(rightbar, 'rightbar'\)/)
  assert.doesNotMatch(client, /directSlot\(conversation, 'conversation'\)/)
  assert.doesNotMatch(client, /directSlot\(details, 'details'\)/)
})

test('client uses documented outer capabilities instead of module hashes', () => {
  assert.match(client, /data-shell-overlay/)
  assert.match(client, /data-sidebar-collapsed/)
  assert.match(client, /data-conversation-scroll/)
  assert.match(client, /data-composer-seat/)
  assert.match(client, /data-composer-card/)
  assert.match(client, /viewport-fit=cover/)
  assert.doesNotMatch(client, /__DSH_BOOT__/)
  assert.doesNotMatch(client, /\.[A-Za-z0-9_-]{6,}_(?:frame|panel|root|scrollBody|composerSeat|input)\b/)
})
