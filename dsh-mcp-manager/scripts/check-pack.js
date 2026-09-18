import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const packageRoot = new URL('..', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: packageRoot,
  encoding: 'utf8'
})
const [pack] = JSON.parse(output)
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
