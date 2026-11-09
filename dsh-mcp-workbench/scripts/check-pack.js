import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const packageRoot = new URL('..', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: packageRoot,
  encoding: 'utf8'
})
/**
 * `npm pack --dry-run --json` 的返回形状在两个 npm 大版本之间变过：
 *   - npm ≤ 11：`[{ name, version, files: [...] }]`（数组）
 *   - npm 12：`{ "<包名>": { name, version, files: [...] } }`（按包名索引的对象）
 * 只认数组会让闸门在 npm 12 上以 `object is not iterable` 直接崩掉——而
 * `prepublishOnly` 就挂在这个脚本上，崩掉等于**发布会失败**（2026-09-29 踩到，
 * 当时本机是 npm 12.1.0）。两种形状都收。
 * @param {string} raw
 * @returns {{name: string, version: string, size?: number, files: Array<{path: string}>}}
 */
const normalizePackOutput = (raw) => {
  const parsed = JSON.parse(raw)
  const packs = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {})
  assert.equal(packs.length, 1, `期望只有一份打包结果，实得 ${packs.length} 份`)
  return packs[0]
}
const pack = normalizePackOutput(output)
const actualFiles = pack.files.map((entry) => entry.path).sort()
const expectedFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'client.js',
  'cordis.patch.yml',
  'lib/dsh.js',
  'lib/index.js',
  'lib/mount-manager.js',
  'lib/plan.js',
  'lib/store.js',
  'lib/targets.js',
  'package.json'
].sort()

assert.equal(pack.name, manifest.name)
assert.equal(pack.version, manifest.version)
assert.deepEqual(actualFiles, expectedFiles)
console.log(`package contents verified (${actualFiles.length} files, ${pack.size} bytes)`)
