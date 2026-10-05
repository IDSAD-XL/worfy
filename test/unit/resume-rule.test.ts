// The rule of Resume (src/main/agent/resume.ts): only a finished Session is continued, in the cwd
// its transcript records. A Session with a live Claude Code process (a terminal, Claude desktop) or
// one worfy runs itself is refused, so two processes never write one transcript; a Session whose
// folder is gone (a removed worktree) is refused too, since Claude Code would not find its
// transcript from anywhere else.
import { describe, expect, it } from 'vitest'
import { RESUME_LABELS } from '../../src/shared/ipc/sessions'
import { resumeVerdict, type ResumeInput } from '../../src/main/agent/resume'

const ROOT = '/Users/test/projects/demo'
const WORKTREE = `${ROOT}/.claude/worktrees/07`
const ID = '44444444-4444-4444-8444-444444444444'

const folders = new Set([ROOT, WORKTREE])

function input(change: Partial<ResumeInput> = {}): ResumeInput {
  return {
    sessionId: ID,
    projectRoot: ROOT,
    live: [],
    running: [],
    recorded: { cwd: ROOT },
    isDirectory: (path) => Promise.resolve(folders.has(path)),
    ...change,
  }
}

describe('resumeVerdict', () => {
  it('refuses a Session whose Claude Code process is alive in the registry', async () => {
    const verdict = await resumeVerdict(input({ live: [{ sessionId: ID, entrypoint: 'cli' }] }))
    expect(verdict).toEqual({ resumable: false, reason: 'running', label: 'Still running in terminal' })
  })

  it('names Claude desktop when the live process is the desktop app', async () => {
    const verdict = await resumeVerdict(input({ live: [{ sessionId: ID, entrypoint: 'claude-desktop' }] }))
    expect(verdict).toEqual({ resumable: false, reason: 'desktop', label: RESUME_LABELS.desktop })
  })

  it('refuses a Session worfy runs itself, before asking the registry', async () => {
    const verdict = await resumeVerdict(input({ running: [ID], live: [{ sessionId: ID, entrypoint: 'cli' }] }))
    expect(verdict).toEqual({ resumable: false, reason: 'open', label: RESUME_LABELS.open })
  })

  it('a live process of another Session does not matter', async () => {
    const verdict = await resumeVerdict(input({ live: [{ sessionId: 'other', entrypoint: 'cli' }], running: ['pending-1'] }))
    expect(verdict).toEqual({ resumable: true, cwd: ROOT })
  })

  it('continues a finished Session in the cwd its transcript records, not in the Project root', async () => {
    const verdict = await resumeVerdict(input({ recorded: { cwd: WORKTREE } }))
    expect(verdict).toEqual({ resumable: true, cwd: WORKTREE })
  })

  it('refuses a Session the Project has no transcript of', async () => {
    const verdict = await resumeVerdict(input({ recorded: undefined }))
    expect(verdict).toEqual({ resumable: false, reason: 'unknown', label: RESUME_LABELS.unknown })
  })

  it('refuses a Session whose folder no longer exists', async () => {
    const verdict = await resumeVerdict(input({ recorded: { cwd: `${ROOT}/.claude/worktrees/09` } }))
    expect(verdict).toEqual({ resumable: false, reason: 'folder-missing', label: 'Folder no longer exists' })
  })

  it('falls back to the Project root when the transcript records no cwd', async () => {
    expect(await resumeVerdict(input({ recorded: {} }))).toEqual({ resumable: true, cwd: ROOT })
  })

  it('a folder check that fails counts as a missing folder', async () => {
    const verdict = await resumeVerdict(input({ isDirectory: () => Promise.reject(new Error('EACCES')) }))
    expect(verdict).toMatchObject({ resumable: false, reason: 'folder-missing' })
  })
})
