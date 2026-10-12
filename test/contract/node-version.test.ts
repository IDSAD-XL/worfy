// Node 24 is required for development on both machines (worfy-windows ticket 24). The version is
// named in four places, and they must name the same major: `engines.node` of package.json, .nvmrc,
// `node-version` of the workflows and the README. Scripts run under the system Node and the tests
// under Electron's Node, so a machine with an older system Node gives results the other machine
// does not reproduce.
//
// What stops `pnpm install` under an older Node is `engineStrict` of pnpm-workspace.yaml: with
// `engines.node` alone pnpm 11.22.0 warns and exits 0. The stop itself is not run here — the tests
// and CI have one Node; it was run by hand under Node 22.13.0 (the result section of the ticket).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')

const read = (...path: string[]) => readFileSync(join(REPO, ...path), 'utf8')

/** The major `engines.node` asks for; the field must be a lower bound, `>=<major>`. */
function enginesMajor(): number {
  const pkg = JSON.parse(read('package.json')) as { engines?: { node?: string } }
  const range = pkg.engines?.node
  expect(range, 'package.json has no engines.node').toBeTypeOf('string')
  const bound = /^>=(\d+)$/.exec(range ?? '')
  expect(bound, `engines.node is ${JSON.stringify(range)}, not >=<major>`).not.toBeNull()
  return Number(bound?.[1])
}

/** The values of `node-version:` in a workflow, without quotes: `24`, `24.x`, `lts/*`. */
const nodeVersions = (workflow: string): string[] =>
  [...workflow.matchAll(/^\s*node-version:[ \t]*['"]?([^'"#\s]+)/gm)].map((match) => match[1] ?? '')

describe('the version of Node for development', () => {
  it('engines.node of package.json names the major of .nvmrc', () => {
    const nvmrc = /^v?(\d+)/.exec(read('.nvmrc').trim())
    expect(nvmrc, '.nvmrc names no version').not.toBeNull()
    expect(enginesMajor()).toBe(Number(nvmrc?.[1]))
  })

  it('every node-version of the workflows names the same major, and ci.yml sets one', () => {
    const major = enginesMajor()
    const workflows = readdirSync(join(REPO, '.github', 'workflows')).filter((name) => /\.ya?ml$/.test(name))
    expect(workflows).toContain('ci.yml')
    for (const name of workflows) {
      const versions = nodeVersions(read('.github', 'workflows', name))
      if (name === 'ci.yml') expect(versions.length, 'ci.yml sets no node-version').toBeGreaterThan(0)
      // `24`, `24.x` and `24.21.0` name the major; `lts/*` and `latest` name none and do not pass.
      const majors = versions.map((version) => Number(/^v?(\d+)(?:\.|$)/.exec(version)?.[1]))
      expect(majors, `${name}: node-version ${versions.join(', ')}`).toEqual(versions.map(() => major))
    }
  })

  it('pnpm stops under an older Node: engineStrict of pnpm-workspace.yaml is true', () => {
    // The setting stops nothing without the field it enforces.
    enginesMajor()
    expect(read('pnpm-workspace.yaml')).toMatch(/^engineStrict:[ \t]*true[ \t]*(#.*)?$/m)
  })

  it("Electron's Node, which runs the tests, is not older than engines.node", () => {
    expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(enginesMajor())
  })

  it('the README names that major for Node.js, and no other', () => {
    const named = [...read('README.md').matchAll(/Node\.js (\d+)/g)].map((match) => Number(match[1]))
    expect(named.length, 'the README names no version of Node.js').toBeGreaterThan(0)
    const major = enginesMajor()
    expect(named).toEqual(named.map(() => major))
  })
})
