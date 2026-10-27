// The template of the Demo project (src/main/getting-started/demo-template.ts): its files and its
// Profile draft, read as values. Running them — the demo's own tests, project-connect --check and
// epic-status — is test/contract/demo-template.test.ts.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { demoTemplate } from '../../src/main/getting-started/demo-template'
import { pipelineSchema } from '../../src/shared/workflow/pipeline'

const ROOT = '/home/someone/worfy-demo'

describe('the files of the Demo project', () => {
  it('are a todo CLI without dependencies, an Epic with one Ticket, and only \\n line breaks', () => {
    const { files } = demoTemplate({ root: ROOT, profileName: 'worfy-demo' })
    expect(Object.keys(files).sort()).toEqual([
      '.gitignore',
      '.scratch/todo/issues/01-done-command.md',
      '.scratch/todo/spec.md',
      'README.md',
      'bin/todo.js',
      'package.json',
      'src/todo.js',
      'test/fast/todo.test.js',
      'test/full/cli.test.js',
    ])
    for (const text of Object.values(files)) {
      expect(text).not.toContain('\r')
      expect(text.endsWith('\n')).toBe(true)
    }
    const pkg = JSON.parse(files['package.json'] ?? '') as Record<string, unknown>
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.devDependencies).toBeUndefined()
    expect(pkg.type).toBe('module')
    expect(pkg.scripts).toEqual({ 'test:fast': 'node --test test/fast/*.test.js', test: 'node --test' })
    expect((files['.gitignore'] ?? '').split('\n')).toEqual(expect.arrayContaining(['todo.json', '.claude/worktrees/']))
  })

  it('give the Ticket a worfy header and say nothing of the edge cases of done', () => {
    const { files } = demoTemplate({ root: ROOT, profileName: 'worfy-demo' })
    const ticket = files['.scratch/todo/issues/01-done-command.md'] ?? ''
    expect(ticket).toMatch(/^# 01 — add `done <n>` that marks a task done\n\nType: task\nStatus: open\nBlocked by: —\nSource: .+\n/u)
    for (const section of ['## Done when', '## Where in code']) expect(ticket).toContain(`\n${section}\n`)
    // Finding them is the reviewer's part of the demo (the spec of worfy-onboarding, risk 1).
    expect(ticket).not.toMatch(/already|outside|out of range|test\/full|npm test\b/iu)
    expect(files['.scratch/todo/spec.md']).toMatch(/^# todo: .+\n\nStatus: .+\nSource: .+\n\n## Goal\n/u)
  })
})

describe('the Profile draft of the Demo project', () => {
  it('is Full mode, finishes local-green without GitHub, and has a Pipeline without CI', () => {
    const { draft } = demoTemplate({ root: ROOT, profileName: 'worfy-demo' })
    const profile = draft.profile as Record<string, Record<string, unknown>>
    expect(draft.profile.name).toBe('worfy-demo')
    expect(draft.profile.mode).toBe('full')
    expect(profile.workflow).toMatchObject({ folder: null, finish: 'local-green' })
    expect(profile.github).toEqual({ account: null })
    expect(profile.language).toEqual({ team: 'en', docs: 'en' })
    expect(profile.tickets).toMatchObject({ root: '.scratch/', path: '.scratch/<epic>/issues/NN-*.md', spec: '.scratch/<epic>/spec.md', branch: '<epic>/<NN>' })
    // The implementer's check is the fast suite only: the edge cases stay for the review.
    expect(profile.commands).toMatchObject({ test: 'npm run test:fast', verify: 'npm run test:fast' })
    const pipeline = pipelineSchema.parse(profile.workflow?.pipeline)
    expect(pipeline.map((stage) => stage.kind)).toEqual(['queued', 'implementing', 'agent-review', 'gate-merge', 'done'])
    // The gate runs package.json scripts with npm (`pm` null): fast — test/fast only, full — every test.
    expect(draft.gate).toEqual([{ key: 'worfy-demo', match: ROOT, profile: 'worfy-demo', pm: null, root: { fast: ['test:fast'], full: ['test'] }, workspace: {} }])
  })

  it('names the worktrees of the repository in shell commands that survive a space and a quote in the path', () => {
    const root = "/Users/Ann O'Neil/worfy-demo"
    const { draft } = demoTemplate({ root, profileName: 'worfy-demo' })
    const worktree = draft.profile.worktree as Record<string, string>
    expect(worktree.root).toBe(`${join(root, '.claude', 'worktrees')}/`)
    expect(worktree.implementer).toBe("git worktree add -b <branch> '/Users/Ann O'\\''Neil/worfy-demo/.claude/worktrees/<NN>' main")
    expect(worktree.reviewer).toBe("git worktree add '/Users/Ann O'\\''Neil/worfy-demo/.claude/worktrees/review-<review-target>' --detach <branch>")
  })
})
