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

test('compatibility matrix declares the verified 0.2.0 release line', () => {
  assert.deepEqual(manifest.dshCompatibility, {
    policy: 'compatible-release-line',
    package: '@deepseek-ai/dsh',
    range: '>=0.2.0-rc.2 <0.2.1',
    verifiedVersions: ['0.2.0-rc.2'],
    matrix: './compatibility.json',
    futureVersionsRequireCapabilityChecks: true
  })
  assert.equal(matrix.schemaVersion, 2)
  assert.equal(matrix.policy, 'compatible-release-line')
  assert.equal(matrix.range, '>=0.2.0-rc.2 <0.2.1')
  assert.equal(manifest.engines.dsh, manifest.dshCompatibility.range, 'engines.dsh must stay in sync with the declared range')
  assert.deepEqual(matrix.verifiedVersions, ['0.2.0-rc.2'])
  assert.equal(matrix.futureVersionsRequireCapabilityChecks, true)
  assert.deepEqual(matrix.versions.map((entry) => entry.version), ['0.2.0-rc.2'])
  assert.equal(matrix.versions.every((entry) => entry.status === 'source-verified'), true)
  // Every contract must carry the whole verified list — that is what stops a cross-line bump
  // from leaving stale evidence behind ("the previous line's conclusions are inherited nowhere").
  for (const contract of [...matrix.contracts.public, ...matrix.contracts.structural]) {
    assert.deepEqual(contract.versions, ['0.2.0-rc.2'], contract.id)
  }
  for (const id of ['app-frame-columns', 'workspace-header-controls', 'right-panel-chrome', 'right-panel-overlay-stacking', 'composer-dock-inline-cards', 'modal-and-popover-viewport']) {
    assert.equal(matrix.contracts.structural.some((entry) => entry.id === id), true, id)
  }

  assert.match(readme, />=0\.2\.0-rc\.2 <0\.2\.1/)
  assert.match(readme, /0\.2\.0-rc\.2/)
  assert.match(agents, /兼容发布线/)
  assert.match(publishing, /兼容发布线/)
})

test('client source declares release-line, connection, and structure gates', () => {
  assert.match(client, /DSH_COMPATIBILITY_RANGE = '>=0\.2\.0-rc\.2 <0\.2\.1'/)
  assert.match(client, /VERIFIED_DSH_VERSIONS = \['0\.2\.0-rc\.2'\]/)
  // classifyDshVersion() derives the gate from DSH_RELEASE_LINE + DSH_RELEASE_FLOOR, so the range
  // is reverse-engineered from those constants here: a release-line bump that only edits the range
  // (or only the client constants) would otherwise pass every other gate. The floor is an rc, so
  // the guard is a channel rank, not "alpha.N".
  const releaseLine = /DSH_RELEASE_LINE = '([^']+)'/.exec(client)?.[1]
  const floor = /DSH_RELEASE_FLOOR = \{ channel: '([^']+)', sequence: (\d+) \}/.exec(client)
  assert.equal(releaseLine !== undefined && floor !== null, true, 'client.js must declare DSH_RELEASE_LINE and DSH_RELEASE_FLOOR')
  const [lowerBound, upperBound] = manifest.dshCompatibility.range.split(' ')
  assert.equal(lowerBound, `>=${releaseLine}-${floor[1]}.${floor[2]}`)
  const [major, minor, patch] = releaseLine.split('.')
  assert.equal(upperBound, `<${major}.${minor}.${Number(patch) + 1}`)
  assert.equal(client.includes('PRERELEASE_CHANNELS = ['), true, 'client.js must rank prerelease channels so a lower channel is below the floor')
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

test('install.sh keeps its shell version gate sourced from the client constants', () => {
  // The script half is the only place a supported version can be accepted while the browser half
  // rejects it (or the reverse), so every constant it consumes is compared literally.
  assert.equal(installScript.includes('DSH_COMPATIBILITY_RANGE=">=0.2.0-rc.2 <0.2.1"'), true)
  assert.equal(installScript.includes('DSH_VERIFIED_VERSIONS="0.2.0-rc.2"'), true)
  const releaseLine = /DSH_RELEASE_LINE = '([^']+)'/.exec(client)?.[1]
  const floor = /DSH_RELEASE_FLOOR = \{ channel: '([^']+)', sequence: (\d+) \}/.exec(client)
  assert.equal(installScript.includes(`DSH_RELEASE_LINE="${releaseLine}"`), true, 'install.sh release line must match client.js')
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_CHANNEL="${floor[1]}"`), true, 'install.sh floor channel must match client.js')
  assert.equal(installScript.includes(`DSH_RELEASE_FLOOR_SEQUENCE=${floor[2]}`), true, 'install.sh floor sequence must match client.js')
  // A literal range is fine, but the old "the floor is an alpha.1" shape must not come back.
  assert.equal(installScript.includes('prerelease_rank()'), true, 'install.sh must rank prerelease channels')
  assert.doesNotMatch(installScript, /DSH_MINIMUM_ALPHA/)
})

test('the 44px touch floor stays off fixed-shape controls', () => {
  // Two controls are fixed shapes rather than glyph buttons: the attachment rail (a thumbnail row)
  // and a switch (a 36x20 capsule with a 16px thumb). Squaring either one off is a visible defect,
  // so every 44px floor excludes them and they grow an invisible target instead.
  assert.equal((client.match(/\[role='group'\], \[role='group'\] \*, \[role='switch'\]/g) || []).length, 5, 'every 44px floor must exclude role=group and role=switch')
  assert.match(client, /\[role='switch'\]::after/)
})

test('client probes the sidebar/main/rightbar seats, not the retired conversation/details seats', () => {
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
