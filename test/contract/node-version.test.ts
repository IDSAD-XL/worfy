// Node 24 is required for development on both machines (worfy-windows ticket 24). The version is
// named in four places, and they must name the same major: `engines.node` of package.json, .nvmrc,
// the setup-node steps of the workflows and the README. Scripts run under the system Node and the
// tests under Electron's Node, so a machine with an older system Node gives results the other
// machine does not reproduce.
//
// What stops `pnpm install` under an older Node is `engineStrict` of pnpm-workspace.yaml: with
// `engines.node` alone pnpm 11.22.0 warns and exits 0. The stop itself is not run here — the tests
// and CI have one Node; it was run by hand under Node 22.13.0 and 24.14.1 (the result section of
// the ticket).
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

/** The major of `24`, `v24`, `24.x` and `24.21.0`; NaN for what names none (`lts/*`, `latest`). */
const majorOf = (version: string): number => Number(/^v?(\d+)(?:\.|$)/.exec(version)?.[1])

/** The values of one key of a workflow: the key bare or quoted, on its own line or inside `{ }`. */
const valuesOf = (workflow: string, key: string): string[] =>
  [...workflow.matchAll(new RegExp(String.raw`(?:^|[\s{,])['"]?${key}['"]?[ \t]*:[ \t]*['"]?([^'"#\s,}]+)`, 'gm'))].map((match) => match[1] ?? '')

/**
 * Where the setup-node steps of a workflow take the version of Node from: how many steps there are,
 * the values of `node-version` and the files of `node-version-file`. Comment lines are left out: a
 * step that is commented out sets nothing.
 */
function nodeSources(workflow: string): { steps: number; versions: string[]; files: string[] } {
  const text = workflow.replace(/^[ \t]*#.*$/gm, '')
  return {
    steps: [...text.matchAll(/uses:[ \t]*['"]?actions\/setup-node@/g)].length,
    versions: valuesOf(text, 'node-version'),
    files: valuesOf(text, 'node-version-file'),
  }
}

/**
 * The majors a text names for Node, in any of the forms a README uses: "Node.js 24", "Node 22 or
 * newer", "node 22.x", "Node.js v22", "Node.js LTS (22)", "Node.js 24 or 22", and the same with a
 * line break before the number.
 */
function nodeMajorsNamed(text: string): number[] {
  const version = String.raw`v?\d+(?:\.(?:\d+|x))*`
  const named = new RegExp(String.raw`\bNode(?:\.js)?(?:\s+LTS)?[\s(]+${version}(?:\s*(?:,|or|and|\/)\s*${version})*`, 'gi')
  return [...text.matchAll(named)].flatMap((match) => [...match[0].matchAll(/v?(\d+)(?:\.(?:\d+|x))*/gi)].map((each) => Number(each[1])))
}

describe('the version of Node for development', () => {
  it('engines.node of package.json names the major of .nvmrc', () => {
    const nvmrc = /^v?(\d+)/.exec(read('.nvmrc').trim())
    expect(nvmrc, '.nvmrc names no version').not.toBeNull()
    expect(enginesMajor()).toBe(Number(nvmrc?.[1]))
  })

  it('every setup-node step of the workflows names the same major, and ci.yml has one', () => {
    const major = enginesMajor()
    const workflows = readdirSync(join(REPO, '.github', 'workflows')).filter((name) => /\.ya?ml$/.test(name))
    expect(workflows).toContain('ci.yml')
    for (const name of workflows) {
      const { steps, versions, files } = nodeSources(read('.github', 'workflows', name))
      if (name === 'ci.yml') expect(steps, 'ci.yml has no setup-node step').toBeGreaterThan(0)
      // A step without a version takes the Node of the runner image, whatever that is.
      expect(versions.length + files.length, `${name}: ${steps} setup-node steps, node-version ${versions.join(', ')}, node-version-file ${files.join(', ')}`).toBe(steps)
      expect(versions.map(majorOf), `${name}: node-version ${versions.join(', ')}`).toEqual(versions.map(() => major))
      // .nvmrc is the one file allowed: the test above holds it to engines.node.
      expect(files, `${name}: node-version-file`).toEqual(files.map(() => '.nvmrc'))
    }
  })

  it.each([
    ['          node-version: 22', ['22']],
    ["          node-version: '22.x'", ['22.x']],
    ['        with: { node-version: 22, cache: pnpm }', ['22']],
    ['          "node-version": 22', ['22']],
    ['          node-version : 22', ['22']],
    ['          node-version: lts/*', ['lts/*']],
    ['          # node-version: 22', []],
    ['          node-version-file: .nvmrc', []],
  ])('reads node-version of a workflow in the form %j', (line, versions) => {
    expect(nodeSources(`      - uses: actions/setup-node@v7\n        with:\n${line}\n`).versions).toEqual(versions)
  })

  it('reads node-version-file and counts the setup-node steps of a workflow', () => {
    const workflow = ['      - uses: actions/setup-node@v7', '        with:', '          node-version-file: .nvmrc', '      # - uses: actions/setup-node@v7', "      - uses: 'actions/setup-node@v7'"].join('\n')
    expect(nodeSources(workflow)).toEqual({ steps: 2, versions: [], files: ['.nvmrc'] })
  })

  it('pnpm stops under an older Node: engineStrict of pnpm-workspace.yaml is true', () => {
    // The setting stops nothing without the field it enforces.
    enginesMajor()
    expect(read('pnpm-workspace.yaml')).toMatch(/^engineStrict:[ \t]*true[ \t]*(#.*)?$/m)
  })

  it("Electron's Node, which runs the tests, is not older than engines.node, and the README names its major", () => {
    // `pnpm test` runs vitest under Electron's Node (scripts/vitest-electron.mjs). Under a plain
    // `vitest` process.versions.node is the Node of the system: the test fails there rather than
    // pass for a Node it does not speak of — a skip would hide that the tests left Electron's Node.
    expect(process.versions.electron, 'process.versions.electron is not set: this is not Electron\'s Node; run the tests with `pnpm test`').toBeTypeOf('string')
    const node = Number(process.versions.node.split('.')[0])
    expect(node).toBeGreaterThanOrEqual(enginesMajor())
    const said = [...read('README.md').matchAll(/Node of Electron, which is (\d+)/g)].map((match) => Number(match[1]))
    expect(said, 'the README on the Node of Electron').toEqual(said.map(() => node))
  })

  it.each([
    ['Node.js 22 or newer', [22]],
    ['Node 22 or newer', [22]],
    ['node 22.x', [22]],
    ['Node.js v22', [22]],
    ['Node.js LTS (22)', [22]],
    ['Node.js 24 or 22', [24, 22]],
    ['Node.js\n22 or newer', [22]],
    ['Node.js 24, 24.15 or newer of that line', [24, 24]],
    ['a Terminal Node on Windows 10 21H2+', []],
    ['`node --version` must print 24.15', []],
  ])('finds the majors named for Node in %j', (text, majors) => {
    expect(nodeMajorsNamed(text)).toEqual(majors)
  })

  it('the README names that major for Node, and no other', () => {
    const readme = read('README.md')
    const major = enginesMajor()
    const named = nodeMajorsNamed(readme)
    expect(named.length, 'the README names no version of Node').toBeGreaterThan(0)
    expect(named, 'the majors the README names for Node').toEqual(named.map(() => major))
    // The other numbers of the README that repeat the version: a lower bound (`>=24`) and the
    // version a command installs (`--version 24.20.0`).
    const bounds = [...readme.matchAll(/>=[ \t]*v?(\d+)/g)].map((match) => Number(match[1]))
    expect(bounds, 'the lower bounds (>=) of the README').toEqual(bounds.map(() => major))
    const installed = [...readme.matchAll(/--version[ =]+v?(\d+)/g)].map((match) => Number(match[1]))
    expect(installed, 'the versions of --version in the README').toEqual(installed.map(() => major))
  })
})
