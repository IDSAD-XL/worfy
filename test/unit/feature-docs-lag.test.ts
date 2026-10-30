// scripts/feature-docs-lag.mjs: the report of translations of Feature pages that lag behind their English
// version (docs/features/README.md, section "Translation"). Each test writes a temporary git repository.
// The Russian header lines below are the input the script parses: it reads them by their Latin marker alone.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'feature-docs-lag.mjs')
const EN = 'docs/features/page.md'
const RU = 'docs/features/ru/page.md'
const WRITTEN = '# Page\n\nThe text of the page.\n'
const STUB_EN = '# Page\n\nThis page is not written yet.\n'
const STUB_RU = '# Page\n\nСтраница ещё не написана.\n'

/** The Russian file with this commit in its header. */
const translated = (commit: string): string => `# Page\n\n> Перевод [английской версии](../page.md), commit \`${commit}\`.\n\nТекст страницы.\n`

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

let scratch = ''
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-feature-docs-lag-config-'))
  writeFileSync(join(scratch, 'empty-gitconfig'), '')
})
afterAll(() => {
  removeTestTree(scratch)
})

/** The environment without the git settings of the machine or of a git hook that started this run. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(scratch, 'empty-gitconfig') }
}

function temporary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worfy-feature-docs-lag-'))
  dirs.push(dir)
  return dir
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

/** Runs git in the repository and returns its output; a git that fails fails the test. */
function git(root: string, ...args: string[]): string {
  const child = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-C', root, ...args], { encoding: 'utf8', env: gitEnv() })
  if (child.status !== 0) throw new Error(`git ${args.join(' ')}: ${child.stderr}`)
  return child.stdout.trim()
}

/** Commits these files and returns the full SHA of the commit. */
function commit(root: string, files: Record<string, string>): string {
  for (const [path, text] of Object.entries(files)) put(root, path, text)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'change')
  return git(root, 'rev-parse', 'HEAD')
}

/** A new git repository with one commit of these files. */
function repository(files: Record<string, string>): string {
  const root = temporary()
  git(root, 'init', '-q')
  commit(root, files)
  return root
}

/** Runs the script on a repository root, under the real node (test/script-node.ts). */
function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(scriptNode(), [SCRIPT, root], { encoding: 'utf8', env: { ...gitEnv(), ELECTRON_RUN_AS_NODE: '1' } })
  return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

const NONE = (translations: number, stubs = 0): string => `feature docs lag: 0 behind (${translations} checked, ${stubs} not written yet)\n`

describe('feature-docs-lag: the report', () => {
  it('prints an empty report for a real SHA whose English file has not changed since', () => {
    const root = repository({ [EN]: WRITTEN })
    const sha = git(root, 'rev-parse', 'HEAD')
    commit(root, { [RU]: translated(sha.slice(0, 8)) })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(NONE(1))
  })

  it('accepts a full SHA and the shortest one of 7 characters', () => {
    const root = repository({ [EN]: WRITTEN })
    const sha = git(root, 'rev-parse', 'HEAD')
    commit(root, { [RU]: translated(sha) })
    expect(run(root).stdout).toBe(NONE(1))
    commit(root, { [RU]: translated(sha.slice(0, 7)) })
    expect(run(root).stdout).toBe(NONE(1))
  })

  it('shows a translation whose English file changed after the commit of the real SHA', () => {
    const root = repository({ [EN]: WRITTEN })
    const sha = git(root, 'rev-parse', 'HEAD')
    commit(root, { [RU]: translated(sha) })
    commit(root, { [EN]: `${WRITTEN}One more line.\n` })
    commit(root, { 'other.txt': 'not the page\n' })
    commit(root, { [EN]: `${WRITTEN}Two more lines.\n` })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(`${RU}: ${EN} has 2 commits after ${sha.slice(0, 8)}\nfeature docs lag: 1 behind (1 checked, 0 not written yet)\n`)
  })

  it('prints an empty report for same-pr: both files came in the same commit', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr') })
    commit(root, { 'other.txt': 'not the page\n' })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(NONE(1))
  })

  it('counts same-pr from the last commit that changed the Russian file', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr') })
    const base = git(root, 'rev-parse', 'HEAD')
    commit(root, { [EN]: `${WRITTEN}One more line.\n` })
    const { status, stdout } = run(root)
    expect(status).toBe(0)
    expect(stdout).toBe(`${RU}: ${EN} has 1 commit after ${base.slice(0, 8)}\nfeature docs lag: 1 behind (1 checked, 0 not written yet)\n`)
    // A later edit of the Russian file moves the starting point: why a separate edit must carry a real SHA.
    commit(root, { [RU]: `${translated('same-pr')}Ещё строка.\n` })
    expect(run(root).stdout).toBe(NONE(1))
  })

  it('reads the header with CRLF line ends', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr').replace(/\n/g, '\r\n') })
    const { status, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('skips a stub without a header when the English file is a stub too', () => {
    const root = repository({ [EN]: STUB_EN, [RU]: STUB_RU })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(NONE(1, 1))
  })

  it('reads the pages of the index too: README.md has a translation like any page', () => {
    const root = repository({ 'docs/features/README.md': WRITTEN, 'docs/features/ru/README.md': translated('same-pr'), [EN]: STUB_EN, [RU]: STUB_RU })
    expect(run(root).stdout).toBe(NONE(2, 1))
  })
})

describe('feature-docs-lag: exit code 1', () => {
  it('fails a translation with no header when the English file is written', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: STUB_RU })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: no translation header`)
  })

  it('fails a written translation with no header when the English file is a stub', () => {
    const root = repository({ [EN]: STUB_EN, [RU]: '# Page\n\nПервая строка.\n\nВторая строка.\n' })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: no translation header`)
  })

  it.each([
    ['no commit', '> Перевод [английской версии](../page.md).'],
    ['a word that is not same-pr', '> Перевод [английской версии](../page.md), commit `same-branch`.'],
    ['a SHA that is too short', '> Перевод [английской версии](../page.md), commit `1a2b3c`.'],
    ['a SHA in capitals', '> Перевод [английской версии](../page.md), commit `1A2B3C4D`.'],
    ['no final full stop', '> Перевод [английской версии](../page.md), commit `same-pr`'],
    ['no backticks', '> Перевод [английской версии](../page.md), commit same-pr.'],
    ['not a quote', 'Перевод [английской версии](../page.md), commit `same-pr`.'],
  ])('fails a broken header: %s', (_name, header) => {
    const root = repository({ [EN]: WRITTEN, [RU]: `# Page\n\n${header}\n\nТекст страницы.\n` })
    const { status, stdout, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: no translation header`)
    expect(stdout).toContain('feature docs lag: 0 behind')
  })

  it('fails a header below the first line under the heading', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: `# Page\n\nТекст страницы.\n\n> Перевод [английской версии](../page.md), commit \`same-pr\`.\n` })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: no translation header`)
  })

  it('fails a commit that does not exist', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('1a2b3c4d') })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: commit 1a2b3c4d not found`)
  })

  it('fails a commit outside the history of HEAD, such as a SHA from a branch before its squash merge', () => {
    const root = repository({ [EN]: WRITTEN })
    git(root, 'checkout', '-q', '-b', 'side')
    const side = commit(root, { 'side.txt': 'side\n' })
    git(root, 'checkout', '-q', '-')
    commit(root, { [RU]: translated(side) })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: commit ${side} not found in the history of HEAD`)
  })

  it('fails same-pr in a Russian file that no commit changed', () => {
    const root = repository({ [EN]: WRITTEN })
    put(root, RU, translated('same-pr'))
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}:3: same-pr, and no commit changed this file`)
  })

  it('fails a translation whose English file is gone', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr') })
    git(root, 'rm', '-q', EN)
    commit(root, {})
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}: the English file ${EN} does not exist`)
  })

  it('still reports the lag of the other pages when one header is broken', () => {
    const other = 'docs/features/other.md'
    const otherRu = 'docs/features/ru/other.md'
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr'), [other]: WRITTEN, [otherRu]: '# Other\n\n> broken\n\nТекст.\n' })
    commit(root, { [EN]: `${WRITTEN}One more line.\n` })
    const { status, stdout, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${otherRu}:3: no translation header`)
    expect(stdout).toContain(`${RU}: ${EN} has 1 commit after`)
  })
})

describe('feature-docs-lag: exit code 2', () => {
  it('stops when the folder of translations cannot be read', () => {
    const root = repository({ [EN]: WRITTEN })
    const { status, stderr } = run(root)
    expect(status).toBe(2)
    expect(stderr).toContain('docs/features/ru: cannot be read')
  })

  it('stops outside a git repository', () => {
    const root = repository({ [EN]: WRITTEN, [RU]: translated('same-pr') })
    removeTestTree(join(root, '.git'))
    const { status, stderr } = run(root)
    expect(status).toBe(2)
    expect(stderr).toContain('not a git repository with a commit')
  })
})
