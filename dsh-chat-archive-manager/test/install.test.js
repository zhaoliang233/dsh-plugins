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

test('installer accepts every verified version and runs the complete gate before profile add', async () => {
  // 清单里的每个版本都要走“无警告 + 完整闸门”分支；漏同步 install.sh 的
  // DSH_VERIFIED_VERSIONS 会让它退化成“带警告运行”。
  for (const version of ['0.2.1-alpha.2+local.1']) {
    const fixture = await runInstaller(version)
    try {
      assert.equal(fixture.result.status, 0, fixture.result.stderr)
      assert.equal(fixture.result.stderr, '', `${version} must not warn`)
      assert.equal(fixture.result.stdout.includes(`DSH:      ${version}`), true)
      assert.deepEqual(fixture.invocations.trim().split('\n'), [
        `npm:run publish:check --prefix ${pluginPath}`,
        `dsh:plugin --profile web add link:${pluginPath} --config.minimumReleaseAge=0`
      ])
    } finally {
      await fixture.cleanup()
    }
  }
})

test('installer warns for an unverified version within the compatible line', async () => {
  // 0.2.1-alpha.3 在下界之上、线内，但没有逐版本核对过 → 只警告、仍然安装。
  const fixture = await runInstaller('0.2.1-alpha.3')
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
  // 0.2.1-alpha.0/alpha.1 都低于 alpha.2 下界，0.2.0 一线与 0.2.2 起不在声明范围内：
  // 判定从「发布线 + 下界」派生，不靠写死的 channel 字符串。
  for (const version of ['0.1.7-rc.2', '0.2.0', '0.2.0-rc.2', '0.2.1-alpha.0', '0.2.1-alpha.1', '0.2.2-alpha.1']) {
    const fixture = await runInstaller(version)
    try {
      assert.equal(fixture.result.status, 1, `${version} must be refused`)
      assert.match(fixture.result.stderr, />=0\.2\.1-alpha\.2 <0\.2\.2/u, fixture.result.stderr)
      assert.equal(fixture.invocations, '')
    } finally {
      await fixture.cleanup()
    }
  }
})
