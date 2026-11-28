// harness/lib/ticket-trail.cjs (worfy-harness-guarantees ticket 04): the one reader of a ticket's trail — the section
// tickets.trail_section of the ticket file that names the files the ticket may edit. bin/land reads it for a PR's
// verification paths, and the guard hook of ticket 03 is to read it the same way, at the tip of the base branch.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

type Ticket = { epic: string; nn: string; path?: string | null }
type Tickets = { branch?: string | null; path?: string | null; root?: string | null; trail_section?: string | null }
type Read = { ticket: Ticket | null; trail: string[] | null; reason: string | null; unread?: boolean }
type TicketTrail = {
  ticketOfBranch: (branch: string, template: string | null | undefined) => Ticket | null
  ticketPattern: (template: string, epic: string, nn: string) => string | null
  trailPaths: (text: string, heading: string) => string[] | null
  namedByTrail: (file: string, trail: readonly string[] | null, options?: { platform?: string; root?: string }) => boolean
  readTrail: (input: { repo: string; ref: string; branch: string; tickets: Tickets; git?: string; folder?: string | null }) => Read
}

const tt = createRequire(import.meta.url)('../../harness/lib/ticket-trail.cjs') as TicketTrail

const HEADING = '## Где в коде'
const TICKET = [
  '# 04: land',
  '',
  'Status: open',
  '',
  '## Что строить',
  '',
  '- `harness/bin/not-in-the-trail` is named outside the trail',
  '',
  HEADING,
  '',
  '- `harness/bin/land` — шапка `:1-58`, `PR_FIELDS` `:356`, `ready()` `:755-764`, разбор (новый `--check`)',
  '- `harness/lib/verification-paths.cjs` — or `harness/lib/ticket-trail.cjs`',
  '- `.github\\workflows\\ci.yml` written on Windows, `test/quarantine/**`, the folder `docs/features/`',
  '- `harness/skills/epic-wave/SKILL.md:922` and `land --check <N>`',
  '',
  '```text',
  '## Not a heading inside a code block',
  '`inside/the/code-block.ts`',
  '```',
  '',
  '### A subsection stays in the trail',
  '',
  '- `harness/bin/tests/land.test.sh`',
  '',
  '## Test-ы',
  '',
  '- `test/unit/after-the-trail.test.ts`',
].join('\n')

describe('ticketOfBranch', () => {
  it('reads the epic and the number by the template of the profile', () => {
    expect(tt.ticketOfBranch('worfy-harness-guarantees/04', '<epic>/<NN>')).toEqual({ epic: 'worfy-harness-guarantees', nn: '04' })
    expect(tt.ticketOfBranch('pay-flow/07-retry', '<epic>/<NN>-<slug>')).toEqual({ epic: 'pay-flow', nn: '07' })
  })

  it('gives no ticket for a branch off the template, or with no template', () => {
    expect(tt.ticketOfBranch('fix-ci-by-hand', '<epic>/<NN>')).toBeNull()
    expect(tt.ticketOfBranch('worfy-harness-guarantees/04-extra', '<epic>/<NN>')).toBeNull()
    expect(tt.ticketOfBranch('a/b/04', '<epic>/<NN>')).toBeNull()
    expect(tt.ticketOfBranch('e/04', null)).toBeNull()
  })
})

describe('trailPaths', () => {
  const trail = tt.trailPaths(TICKET, HEADING)

  it('takes the paths in backticks of the trail section only, line suffixes dropped', () => {
    expect(trail).toEqual([
      'harness/bin/land',
      'harness/lib/verification-paths.cjs',
      'harness/lib/ticket-trail.cjs',
      '.github/workflows/ci.yml',
      'test/quarantine/**',
      'docs/features/**',
      'harness/skills/epic-wave/SKILL.md',
      'harness/bin/tests/land.test.sh',
    ])
  })

  it('names no file by a word, a line number or a command, nor by what stands outside the section or in a code block', () => {
    for (const word of ['PR_FIELDS', 'ready()', ':356', '--check', 'land --check <N>', 'inside/the/code-block.ts', 'harness/bin/not-in-the-trail', 'test/unit/after-the-trail.test.ts'])
      expect(trail).not.toContain(word)
  })

  it('is null for a file without the section', () => {
    expect(tt.trailPaths('# t\n\n## Other\n\n- `a/b.ts`\n', HEADING)).toBeNull()
    expect(tt.trailPaths(TICKET.replace(/\n/g, '\r\n'), HEADING)).toEqual(trail)
  })
})

describe('namedByTrail', () => {
  const trail = tt.trailPaths(TICKET, HEADING)

  it('matches a path, a glob and a folder of the trail, with "\\" as "/"', () => {
    expect(tt.namedByTrail('.github/workflows/ci.yml', trail, { root: '/work/repo', platform: 'linux' })).toBe(true)
    expect(tt.namedByTrail('.github\\workflows\\ci.yml', trail, { root: 'C:\\work\\repo', platform: 'win32' })).toBe(true)
    expect(tt.namedByTrail('test/quarantine/e2e.json', trail, { root: '/work/repo', platform: 'linux' })).toBe(true)
    expect(tt.namedByTrail('docs/features/harness.md', trail, { root: '/work/repo', platform: 'linux' })).toBe(true)
  })

  it('does not match a path the trail does not name', () => {
    expect(tt.namedByTrail('.github/workflows/windows-tests.yml', trail, { root: '/work/repo', platform: 'linux' })).toBe(false)
    expect(tt.namedByTrail('harness/bin/land-other', trail, { root: '/work/repo', platform: 'linux' })).toBe(false)
    expect(tt.namedByTrail('harness/bin/land', null, { root: '/work/repo', platform: 'linux' })).toBe(false)
  })
})

describe('readTrail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ticket-trail-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const tickets: Tickets = { branch: '<epic>/<NN>', path: '.scratch/<epic>/issues/NN-*.md', root: '.scratch/', trail_section: HEADING }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  mkdirSync(join(dir, '.scratch/e/issues'), { recursive: true })
  writeFileSync(join(dir, '.scratch/e/issues/04-land.md'), TICKET)
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'ticket')
  // the working tree differs from the commit: the reader takes the commit at ref
  writeFileSync(join(dir, '.scratch/e/issues/04-land.md'), `${TICKET.replace(HEADING, `${HEADING}\n\n- \`src/only-in-the-working-tree.ts\``)}`)

  it('finds the ticket of the branch at ref and reads its trail there', () => {
    const r = tt.readTrail({ repo: dir, ref: 'main', branch: 'e/04', tickets })
    expect(r.ticket).toEqual({ epic: 'e', nn: '04', path: '.scratch/e/issues/04-land.md' })
    expect(r.trail).toContain('.github/workflows/ci.yml')
    expect(r.trail).not.toContain('src/only-in-the-working-tree.ts')
  })

  it('reads the tickets outside the repository from their folder', () => {
    const r = tt.readTrail({ repo: dir, ref: 'main', branch: 'e/04', tickets, folder: join(dir, '.scratch') })
    expect(r.ticket?.path).toBe('e/issues/04-land.md')
    expect(r.trail).toContain('src/only-in-the-working-tree.ts')
  })

  it('names why there is no trail', () => {
    expect(tt.readTrail({ repo: dir, ref: 'main', branch: 'fix', tickets })).toMatchObject({ ticket: null, trail: null, reason: 'the branch fix is not <epic>/<NN>' })
    expect(tt.readTrail({ repo: dir, ref: 'main', branch: 'e/05', tickets })).toMatchObject({ ticket: { epic: 'e', nn: '05', path: null }, trail: null })
    expect(tt.readTrail({ repo: dir, ref: 'main', branch: 'e/04', tickets: { ...tickets, trail_section: '## Where in the code' } })).toMatchObject({ trail: null, reason: '.scratch/e/issues/04-land.md has no section "## Where in the code"' })
    expect(tt.readTrail({ repo: dir, ref: 'no-such-ref', branch: 'e/04', tickets })).toMatchObject({ trail: null, unread: true })
  })
})
