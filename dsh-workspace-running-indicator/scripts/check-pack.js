import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const packageRoot = new URL('..', import.meta.url)
const manifest = JSON.parse(
  await readFile(new URL('package.json', packageRoot), 'utf8')
)
const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
)
// npm 10 返回包结果数组，更新版本的 npm 返回按包名索引的对象；两种都接受，
// 避免把发布闸门绑死在某一个 npm 版本上。
const parsed = JSON.parse(output)
const [pack] = Array.isArray(parsed) ? parsed : Object.values(parsed)
const actualFiles = pack.files.map((entry) => entry.path).sort()
const expectedFiles = [
  'AGENTS.md',
  'CHANGELOG.md',
  'LICENSE',
  'PUBLISHING.md',
  'README.md',
  'client.js',
  'cordis.patch.yml',
  'lib/index.js',
  'package.json'
].sort()

assert.equal(pack.name, manifest.name)
assert.equal(pack.version, manifest.version)
assert.deepEqual(actualFiles, expectedFiles)
console.log(`package contents verified (${actualFiles.length} files, ${pack.size} bytes)`)
