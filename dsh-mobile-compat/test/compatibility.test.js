import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not url.pathname: on Windows the latter yields "/C:/..." which node then
// resolves as a relative C:\C:\... path.
const script = fileURLToPath(new URL('../scripts/check-compat.js', import.meta.url))

function runInstalled(version) {
  return spawnSync(process.execPath, [script, '--installed'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_VERSION_OVERRIDE: version }
  })
}

test('source-verified versions pass, including build metadata', () => {
  for (const version of ['0.2.0-rc.2', '0.2.0-rc.2+build.1']) {
    const result = runInstalled(version)
    assert.equal(result.status, 0, version)
    assert.match(result.stdout, /source-verified compatible release-line match/, version)
  }
})

test('later versions in the compatible release line pass with a warning', () => {
  // Everything at or above the floor 0.2.0-rc.2 inside the same line: a later rc and the final
  // release. alpha/beta live BELOW an rc floor, so they belong to the fail-closed case below.
  // The floor itself is source-verified and asserted separately.
  for (const version of ['0.2.0-rc.3', '0.2.0']) {
    const result = runInstalled(version)
    assert.equal(result.status, 0, version)
    assert.match(result.stderr, /inside .* but is not individually verified/, version)
  }
})

test('the floor includes every channel rank below it and adjacent lines fail closed', () => {
  // The floor moved from an alpha to an rc.2, so alpha and beta inside 0.2.0 — plus every
  // lower rc — sit BELOW the floor. The old `channel !== 'alpha'` shape accepted
  // 0.2.0-alpha.9; these four cases are the guard against that regression coming back.
  for (const version of ['0.2.0-alpha.9', '0.2.0-beta.4', '0.2.0-rc.1', '0.2.0-alpha.1', '0.1.7-rc.2', '0.1.6-alpha.2', '0.1.8-alpha.1', 'invalid']) {
    const result = runInstalled(version)
    assert.equal(result.status, 1, version)
    assert.match(result.stderr, /outside the compatible release line/, version)
  }
})

test('manifest checker succeeds independently of the registry', () => {
  const output = execFileSync(process.execPath, [script, '--manifest'], { encoding: 'utf8' })
  assert.match(output, />=0\.2\.0-rc\.2 <0\.2\.1; 1 source-verified versions/)
})
