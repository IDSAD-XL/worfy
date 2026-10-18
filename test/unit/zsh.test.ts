import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { needsPosix, needsZsh, NO_POSIX_ON_WINDOWS, NO_ZSH, NO_ZSH_ON_WINDOWS, zshPath } from '../zsh'

// The skip flags of test/zsh.ts switch off whole groups of tests without failing the run: inverted, the zsh
// tests of test/contract and test/e2e would skip on macOS and Linux and the run would still exit 0
// (worfy-windows ticket 54). Each flag is pinned to the system here.
const WINDOWS = process.platform === 'win32'

type SkipContext = { skip: (condition: boolean, note?: string) => void }

/** The condition and the note a helper passed to `context.skip`. */
function skipOf(helper: (context: SkipContext) => void): [boolean, string | undefined] {
  let call: [boolean, string | undefined] | undefined
  helper({
    skip: (condition, note) => {
      call = [condition, note]
    },
  })
  if (!call) throw new Error('the helper did not call context.skip')
  return call
}

describe('the skip flags of the tests that need zsh or a POSIX system', () => {
  it('NO_ZSH is true on Windows and false on macOS and Linux', () => {
    expect(NO_ZSH).toBe(WINDOWS)
  })

  it('needsZsh skips on Windows only, with the reason', () => {
    expect(skipOf(needsZsh)).toEqual([WINDOWS, NO_ZSH_ON_WINDOWS])
  })

  it('needsPosix skips on Windows only, with the reason', () => {
    expect(skipOf(needsPosix)).toEqual([WINDOWS, NO_POSIX_ON_WINDOWS])
  })

  it('zshPath names a zsh that exists on macOS and Linux', (context) => {
    context.skip(WINDOWS, NO_ZSH_ON_WINDOWS)
    expect(existsSync(zshPath())).toBe(true)
  })
})
