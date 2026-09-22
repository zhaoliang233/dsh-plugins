import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const installPath = fileURLToPath(new URL('../install.sh', import.meta.url))
const pluginPath = dirname(installPath)

async function runInstaller(version) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-archive-install-'))
  const bin = join(root, 'bin')
  const log = join(root, 'invocations.log')
  await mkdir(bin)
  await writeFile(join(bin, 'dsh'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf '%s\\n' "\${FAKE_DSH_VERSION:?}"
  exit 0
fi
printf 'dsh:%s\\n' "$*" >> "\${FAKE_INVOCATION_LOG:?}"
`, { mode: 0o755 })
  await writeFile(join(bin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
printf 'npm:%s\\n' "$*" >> "\${FAKE_INVOCATION_LOG:?}"
`, { mode: 0o755 })

  const result = spawnSync('bash', [installPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      FAKE_DSH_VERSION: version,
      FAKE_INVOCATION_LOG: log
    }
  })
  let invocations = ''
  try {
    invocations = await readFile(log, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return {
    root,
    result,
    invocations,
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}

test('installer accepts the verified version and runs the complete gate before profile add', async () => {
  const fixture = await runInstaller('0.1.7-alpha.1+local.1')
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr)
    assert.equal(fixture.result.stderr, '')
    assert.equal(fixture.result.stdout.includes('DSH:      0.1.7-alpha.1+local.1'), true)
    assert.deepEqual(fixture.invocations.trim().split('\n'), [
      `npm:run publish:check --prefix ${pluginPath}`,
      `dsh:plugin --profile web add link:${pluginPath} --config.minimumReleaseAge=0`
    ])
  } finally {
    await fixture.cleanup()
  }
})

test('installer warns for an unverified version within the compatible line', async () => {
  const fixture = await runInstaller('0.1.7-alpha.2')
  try {
    assert.equal(fixture.result.status, 0, fixture.result.stderr)
    assert.equal(fixture.result.stderr.includes('尚未列入逐版本验证清单'), true)
    assert.equal(fixture.invocations.includes('npm:run publish:check'), true)
    assert.equal(fixture.invocations.includes('dsh:plugin --profile web add'), true)
  } finally {
    await fixture.cleanup()
  }
})

test('installer rejects a version outside the release line before npm or profile changes', async () => {
  for (const version of ['0.1.6-alpha.2', '0.1.8-rc.1']) {
    const fixture = await runInstaller(version)
    try {
      assert.equal(fixture.result.status, 1)
      assert.match(fixture.result.stderr, />=0\.1\.7-alpha\.1 <0\.1\.8/u, fixture.result.stderr)
      assert.equal(fixture.invocations, '')
    } finally {
      await fixture.cleanup()
    }
  }
})
