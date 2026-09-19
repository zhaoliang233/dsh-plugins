import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const packageRoot = new URL('..', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: packageRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
)
// npm 10 reports an array of pack results, newer npm reports an object keyed by package
// name; accept both instead of pinning the gate to one CLI version.
const parsed = JSON.parse(output)
const [pack] = Array.isArray(parsed) ? parsed : Object.values(parsed)
const actualFiles = pack.files.map(entry => entry.path).sort()
const expectedFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'client.js',
  'cordis.patch.yml',
  'lib/archive-deletion.js',
  'lib/archive-restoration.js',
  'lib/index.js',
  'package.json'
].sort()

assert.equal(pack.name, manifest.name)
assert.equal(pack.version, manifest.version)
assert.deepEqual(actualFiles, expectedFiles)
console.log(`package contents verified (${actualFiles.length} files, ${pack.size} bytes)`)
