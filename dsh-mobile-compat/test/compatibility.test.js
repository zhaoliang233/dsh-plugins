import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'

const script = new URL('../scripts/check-compat.js', import.meta.url)

function runInstalled(version) {
  return spawnSync(process.execPath, [script.pathname, '--installed'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_VERSION_OVERRIDE: version }
  })
}

test('source-verified alpha.1 version passes', () => {
  for (const version of ['0.1.6-alpha.1', '0.1.6-alpha.1+build.1']) {
    const result = runInstalled(version)
    assert.equal(result.status, 0, version)
    assert.match(result.stdout, /source-verified compatible release-line match/, version)
  }
})

test('later versions in the compatible release line pass with a warning', () => {
  for (const version of ['0.1.6-alpha.2', '0.1.6-beta.1', '0.1.6-rc.1', '0.1.6']) {
    const result = runInstalled(version)
    assert.equal(result.status, 0, version)
    assert.match(result.stderr, /inside .* but is not individually verified/, version)
  }
})

test('earlier prereleases and adjacent release lines fail closed', () => {
  for (const version of ['0.1.6-alpha.0', '0.1.5-alpha.2', '0.1.2-alpha.4', '0.1.7-alpha.1', 'invalid']) {
    const result = runInstalled(version)
    assert.equal(result.status, 1, version)
    assert.match(result.stderr, /outside the compatible release line/, version)
  }
})

test('manifest checker succeeds independently of the registry', () => {
  const output = execFileSync(process.execPath, [script.pathname, '--manifest'], { encoding: 'utf8' })
  assert.match(output, />=0\.1\.6-alpha\.1 <0\.1\.7; 1 source-verified versions/)
})
