// scripts/guide-lag.mjs: the report of worfy Guide Topics that lag behind the pages of docs/features/
// they were checked against, and of Russian texts older than their English ones (worfy-guide ticket
// 03, ADR-0090). Each test writes a temporary git repository.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'guide-lag.mjs')
const TOPIC = 'src/renderer/guide/topics/canvas'
const META = `${TOPIC}/topic.json`
const EN = `${TOPIC}/en.json`
const RU = `${TOPIC}/ru.json`
const PAGE = 'docs/features/canvas.md'

const meta = (sha: string, page = PAGE): string => `${JSON.stringify({ sources: [{ page, sha }], files: [] })}\n`
const text = (title: string): string => `${JSON.stringify({ title })}\n`

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

let scratch = ''
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'worfy-guide-lag-config-'))
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

function git(root: string, ...args: string[]): string {
  const child = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-C', root, ...args], { encoding: 'utf8', env: gitEnv() })
  if (child.status !== 0) throw new Error(`git ${args.join(' ')}: ${child.stderr}`)
  return child.stdout.trim()
}

/** Commits these files and returns the full SHA of the commit. */
function commit(root: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'change')
  return git(root, 'rev-parse', 'HEAD')
}

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'worfy-guide-lag-'))
  dirs.push(root)
  git(root, 'init', '-q')
  commit(root, files)
  return root
}

/** A repository with the page, then a Topic checked against it, both texts in one commit; returns the page's commit too. */
function withTopic(): { root: string; pageSha: string } {
  const root = repository({ [PAGE]: '# Canvas\n' })
  const pageSha = git(root, 'rev-parse', 'HEAD')
  commit(root, { [META]: meta(pageSha.slice(0, 8)), [EN]: text('Canvas'), [RU]: text('Canvas ru') })
  return { root, pageSha }
}

function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(scriptNode(), [SCRIPT, root], { encoding: 'utf8', env: { ...gitEnv(), ELECTRON_RUN_AS_NODE: '1' } })
  return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

const SUMMARY = (pages: number, translations: number, topics: number): string => `guide lag: ${pages} behind their pages, ${translations} translations behind (${topics} Topics checked)\n`

describe('guide-lag: the report', () => {
  it('is empty when no page moved since its commit and both texts came together', () => {
    const { root } = withTopic()
    commit(root, { 'other.txt': 'not the page\n' })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(SUMMARY(0, 0, 1))
  })

  it('finds a Topic whose page has commits after the one it was checked at', () => {
    const { root, pageSha } = withTopic()
    commit(root, { [PAGE]: '# Canvas\n\nMore.\n' })
    commit(root, { 'other.txt': 'not the page\n' })
    commit(root, { [PAGE]: '# Canvas\n\nEven more.\n' })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe(`canvas: ${PAGE} has 2 commits after ${pageSha.slice(0, 8)}\n${SUMMARY(1, 0, 1)}`)
  })

  it('finds a Russian text older than the English one, and forgets it once the Russian one catches up', () => {
    const { root } = withTopic()
    commit(root, { [EN]: text('Canvas, again') })
    const behind = run(root)
    expect(behind.status).toBe(0)
    expect(behind.stdout).toBe(`canvas: ${RU} is behind ${EN} by 1 commit\n${SUMMARY(0, 1, 1)}`)
    commit(root, { [RU]: text('Canvas ru, again') })
    expect(run(root).stdout).toBe(SUMMARY(0, 0, 1))
  })

  it('reports both lags of one Topic, and every Topic of the folder', () => {
    const { root, pageSha } = withTopic()
    commit(root, { 'src/renderer/guide/topics/autopilot/topic.json': meta(pageSha), 'src/renderer/guide/topics/autopilot/en.json': text('A'), 'src/renderer/guide/topics/autopilot/ru.json': text('A ru') })
    commit(root, { [PAGE]: '# Canvas\n\nMore.\n', [EN]: text('Canvas, again') })
    const { status, stdout } = run(root)
    expect(status).toBe(0)
    expect(stdout).toBe(
      [
        `autopilot: ${PAGE} has 1 commit after ${pageSha.slice(0, 8)}`,
        `canvas: ${PAGE} has 1 commit after ${pageSha.slice(0, 8)}`,
        `canvas: ${RU} is behind ${EN} by 1 commit`,
        SUMMARY(2, 1, 2),
      ].join('\n'),
    )
  })

  it('accepts the full SHA of the page commit', () => {
    const { root, pageSha } = withTopic()
    commit(root, { [META]: meta(pageSha) })
    expect(run(root).stdout).toBe(SUMMARY(0, 0, 1))
  })
})

describe('guide-lag: exit code 1, the rest still reported', () => {
  it('a commit that does not exist', () => {
    const { root } = withTopic()
    commit(root, { [META]: meta('1a2b3c4d') })
    const { status, stdout, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${META}: commit 1a2b3c4d not found`)
    expect(stdout).toBe(SUMMARY(0, 0, 1))
  })

  it('a page that is not in the repository', () => {
    const { root, pageSha } = withTopic()
    commit(root, { [META]: meta(pageSha, 'docs/features/gone.md') })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${META}: docs/features/gone.md does not exist`)
  })

  it('a topic.json that is not JSON, or has no sources', () => {
    const { root } = withTopic()
    commit(root, { [META]: '{ not json' })
    expect(run(root)).toMatchObject({ status: 1, stderr: expect.stringContaining(`${META}: cannot be read`) as string })
    commit(root, { [META]: '{"files": []}\n' })
    expect(run(root)).toMatchObject({ status: 1, stderr: expect.stringContaining(`${META}: no sources`) as string })
  })

  it('a Topic without its Russian text in the history', () => {
    const root = repository({ [PAGE]: '# Canvas\n' })
    const sha = git(root, 'rev-parse', 'HEAD')
    commit(root, { [META]: meta(sha), [EN]: text('Canvas') })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`${RU}: no commit has this file`)
  })
})

describe('guide-lag: exit code 2', () => {
  it('a root that is not a git repository with a commit', () => {
    const root = mkdtempSync(join(tmpdir(), 'worfy-guide-lag-plain-'))
    dirs.push(root)
    mkdirSync(join(root, TOPIC), { recursive: true })
    const { status, stderr } = run(root)
    expect(status).toBe(2)
    expect(stderr).toContain('not a git repository with a commit')
  })

  it('a repository without the folder of Topics', () => {
    const root = repository({ 'README.md': 'x\n' })
    const { status, stderr } = run(root)
    expect(status).toBe(2)
    expect(stderr).toContain('src/renderer/guide/topics: cannot be read')
  })
})
