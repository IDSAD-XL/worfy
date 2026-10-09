import { describe, expect, it } from 'vitest'
import { parseTicketBranch, parseWorktreeFolder } from '../../src/shared/workflow/ticket-ref'

describe('parseTicketBranch', () => {
  it('reads the <epic>/<NN> form worfy uses for its own branches', () => {
    expect(parseTicketBranch('worfy-mvp/07')).toEqual({ epic: 'worfy-mvp', num: 7, slug: null })
    expect(parseTicketBranch('ui-triage-4/01')).toEqual({ epic: 'ui-triage-4', num: 1, slug: null })
    expect(parseTicketBranch('refs/heads/worfy-mvp/10')).toEqual({ epic: 'worfy-mvp', num: 10, slug: null })
  })

  it('reads the older <epic>/<NN>-<slug> form', () => {
    expect(parseTicketBranch('worfy-mvp/07-движок-сессий')).toEqual({ epic: 'worfy-mvp', num: 7, slug: 'движок-сессий' })
    expect(parseTicketBranch('ui-triage-4/12-fix-badge')).toEqual({ epic: 'ui-triage-4', num: 12, slug: 'fix-badge' })
  })

  it('refuses branches of any other form', () => {
    for (const branch of [
      'main',
      'claude/worfy-mvp-epic-53fc44',
      'worfy-mvp',
      'worfy-mvp/',
      'worfy-mvp/07-',
      'worfy-mvp/07abc',
      'worfy-mvp/x07',
      'feature/foo/01',
      'worfy-mvp/07/extra',
      '/07',
      '',
    ]) {
      expect(parseTicketBranch(branch), branch).toBeNull()
    }
  })
})

describe('parseWorktreeFolder', () => {
  it('reads .claude/worktrees/<NN> and .claude/worktrees/<NN>-<slug>', () => {
    expect(parseWorktreeFolder('.claude/worktrees/07')).toEqual({ num: 7, slug: null })
    expect(parseWorktreeFolder('/Users/a/repo/.claude/worktrees/07/')).toEqual({ num: 7, slug: null })
    expect(parseWorktreeFolder('.claude/worktrees/07-движок-сессий')).toEqual({ num: 7, slug: 'движок-сессий' })
    expect(parseWorktreeFolder('/Users/a/repo/.claude/worktrees/07-движок-сессий')).toEqual({ num: 7, slug: 'движок-сессий' })
  })

  it('reads <Harness home>/worktrees/<project>/<NN>, the tree of a Ticket outside the repository (worfy-harness ticket 23)', () => {
    expect(parseWorktreeFolder('/Users/a/.claude/worfy-harness/worktrees/atakama/05')).toEqual({ num: 5, slug: null })
    expect(parseWorktreeFolder('/Users/a/.claude/worfy-harness/worktrees/atakama/05/')).toEqual({ num: 5, slug: null })
    expect(parseWorktreeFolder('/tmp/h/worktrees/my.project/12-fix-badge')).toEqual({ num: 12, slug: 'fix-badge' })
    for (const path of [
      '/Users/a/.claude/worfy-harness/worktrees/atakama',
      '/Users/a/.claude/worfy-harness/worktrees/atakama/05/src',
      '/Users/a/.claude/worfy-harness/worktrees/atakama/review-05',
      '/Users/a/.claude/worfy-harness/worktrees/.hidden/05',
      '/Users/a/.claude/worfy-harness/worktrees/atakama/05-',
    ]) {
      expect(parseWorktreeFolder(path), path).toBeNull()
    }
  })

  it('refuses folders of any other form', () => {
    for (const path of [
      '/Users/a/repo',
      '/Users/a/repo/.claude/worktrees/review-02-tests',
      '/Users/a/repo/.claude/worktrees/worfy-mvp-epic-53fc44',
      '/Users/a/repo/.claude/worktrees/07/src',
      '/Users/a/repo/worktrees/07',
      '/Users/a/repo/.claude/worktrees/07-',
    ]) {
      expect(parseWorktreeFolder(path), path).toBeNull()
    }
  })
})
