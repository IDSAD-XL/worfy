// The undo command the migration form shows after a Harness move: a path with a space must survive
// the shell the owner pastes it into. sh takes single quotes; cmd.exe and PowerShell do not, so on
// Windows the path goes in double quotes.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { restoreCommand } from '../../src/main/harness/migrate/restore'

describe('restoreCommand', () => {
  it('on macOS and Linux a path with a space or a quote goes in single quotes', () => {
    const spaced = join('/Users/Ivan Petrov/.claude/worfy-harness', 'backup-1')
    expect(restoreCommand(spaced, 'darwin')).toBe(`node '${join(spaced, 'restore.mjs')}'`)
    const quoted = join("/home/o'neil/.claude/worfy-harness", 'backup-1')
    expect(restoreCommand(quoted, 'linux')).toBe(`node '${join(quoted, 'restore.mjs').replace("'", `'\\''`)}'`)
  })

  it('on Windows a path with a space goes in double quotes, which cmd.exe and PowerShell both read', () => {
    const spaced = 'C:\\Users\\Ivan Petrov\\.claude\\worfy-harness\\backup-1'
    const command = restoreCommand(spaced, 'win32')
    expect(command).toBe(`node "${join(spaced, 'restore.mjs')}"`)
    expect(command).not.toContain("'")
  })
})
