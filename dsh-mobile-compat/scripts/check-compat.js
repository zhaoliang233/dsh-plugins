import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const packageRoot = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
const declaration = manifest.dshCompatibility
const matrix = JSON.parse(await readFile(new URL('compatibility.json', packageRoot), 'utf8'))
const expectedRange = '>=0.1.6-alpha.1 <0.1.7'
const expectedVerifiedVersions = ['0.1.6-alpha.1', '0.1.6-alpha.2']
const releaseLine = '0.1.6'
const minimumAlpha = 1

function fail(message) {
  console.error(`compatibility error: ${message}`)
  process.exitCode = 1
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function classifyDshVersion(version) {
  if (typeof version !== 'string') return { supported: false, verified: false }
  const normalized = version.split('+', 1)[0]
  const verified = expectedVerifiedVersions.includes(normalized)
  if (normalized === releaseLine) return { supported: true, verified, normalized }

  const prerelease = new RegExp(`^${releaseLine.replace(/\./g, '\\.')}-(alpha|beta|rc)\\.(0|[1-9]\\d*)$`, 'u').exec(normalized)
  if (prerelease === null) return { supported: false, verified: false, normalized }
  const supported = prerelease[1] !== 'alpha' || Number(prerelease[2]) >= minimumAlpha
  return { supported, verified: supported && verified, normalized }
}

function validateDeclaration() {
  if (declaration?.policy !== 'compatible-release-line') {
    fail('dshCompatibility.policy must be "compatible-release-line"')
    return false
  }
  if (declaration.package !== '@deepseek-ai/dsh') {
    fail('dshCompatibility.package must be "@deepseek-ai/dsh"')
    return false
  }
  if (declaration.range !== expectedRange) {
    fail(`dshCompatibility.range must be ${JSON.stringify(expectedRange)}`)
    return false
  }
  if (!sameStrings(declaration.verifiedVersions, expectedVerifiedVersions)) {
    fail(`dshCompatibility.verifiedVersions must be ${JSON.stringify(expectedVerifiedVersions)}`)
    return false
  }
  if (declaration.matrix !== './compatibility.json') {
    fail('dshCompatibility.matrix must be "./compatibility.json"')
    return false
  }
  if (declaration.futureVersionsRequireCapabilityChecks !== true) {
    fail('dshCompatibility.futureVersionsRequireCapabilityChecks must be true')
    return false
  }
  if (matrix?.schemaVersion !== 2 || matrix.policy !== declaration.policy) {
    fail('compatibility.json must use schemaVersion 2 and the manifest policy')
    return false
  }
  if (matrix.npmPackage !== declaration.package || matrix.range !== expectedRange) {
    fail('compatibility.json package/range must match package.json')
    return false
  }
  if (!sameStrings(matrix.verifiedVersions, expectedVerifiedVersions)) {
    fail('compatibility.json verifiedVersions must match package.json')
    return false
  }
  if (matrix.futureVersionsRequireCapabilityChecks !== true) {
    fail('compatibility.json futureVersionsRequireCapabilityChecks must be true')
    return false
  }
  if (!Array.isArray(matrix.versions) || !sameStrings(matrix.versions.map((entry) => entry?.version), expectedVerifiedVersions)) {
    fail('compatibility.json versions must exactly match the verified version list')
    return false
  }
  if (matrix.versions.some((entry) => entry.status !== 'source-verified')) {
    fail('every verified compatibility entry must have status "source-verified"')
    return false
  }

  const verified = new Set(expectedVerifiedVersions)
  const contracts = [...(matrix.contracts?.public || []), ...(matrix.contracts?.structural || [])]
  if (contracts.length === 0) {
    fail('compatibility.json must declare public and structural contracts')
    return false
  }
  for (const contract of contracts) {
    if (typeof contract.id !== 'string' || !sameStrings(contract.versions, expectedVerifiedVersions)
      || contract.versions.some((version) => !verified.has(version))) {
      fail('every compatibility contract must reference the complete verified version list')
      return false
    }
  }
  return true
}

function readInstalledVersion() {
  if (process.env.DSH_VERSION_OVERRIDE) return process.env.DSH_VERSION_OVERRIDE.trim()
  const output = execFileSync(process.env.DSH_BIN || 'dsh', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  const match = output.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s|$)/u)
  if (!match) throw new Error(`cannot parse dsh --version output: ${JSON.stringify(output)}`)
  return match[1]
}

if (validateDeclaration()) {
  if (process.argv.includes('--manifest')) {
    console.log(`compatible release-line declaration verified (${expectedRange}; ${expectedVerifiedVersions.length} source-verified versions)`)
  } else if (process.argv.includes('--installed')) {
    let version
    try {
      version = readInstalledVersion()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }

    if (version) {
      const compatibility = classifyDshVersion(version)
      if (!compatibility.supported) {
        fail(`DSH ${version} is outside the compatible release line ${expectedRange}`)
      } else if (!compatibility.verified) {
        console.warn(`compatibility warning: DSH ${version} is inside ${expectedRange} but is not individually verified; runtime capability checks must pass`)
      } else {
        console.log(`DSH ${version}: source-verified compatible release-line match`)
      }
    }
  } else {
    fail('expected --manifest or --installed')
  }
}
