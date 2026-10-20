// The Git Bash the tests run `.sh` scripts with on Windows (test/git-bash.ts): CLAUDE_CODE_GIT_BASH_PATH
// is taken as it is, except the bash.exe under %SystemRoot%, which is the WSL launcher. Pure: the
// environment and the file check are passed in, so every case runs on every system.
import { describe, expect, it } from 'vitest'
import { windowsGitBash } from '../git-bash'

const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'
const everyFile = (): boolean => true

describe('windowsGitBash', () => {
  it('takes CLAUDE_CODE_GIT_BASH_PATH when it names a file outside %SystemRoot%', () => {
    expect(windowsGitBash({ CLAUDE_CODE_GIT_BASH_PATH: GIT_BASH, SystemRoot: 'C:\\Windows' }, everyFile)).toBe(GIT_BASH)
  })

  it.each(['C:\\Windows\\System32\\bash.exe', 'c:/windows/system32/bash.exe', 'D:\\WinNT\\System32\\bash.exe'])(
    'refuses CLAUDE_CODE_GIT_BASH_PATH %s under the SystemRoot folder with the reason, as findGitBash refuses such a candidate',
    (wsl) => {
      const systemRoot = wsl.startsWith('D:') ? 'D:\\WinNT' : 'C:\\Windows'
      expect(() => windowsGitBash({ CLAUDE_CODE_GIT_BASH_PATH: wsl, SystemRoot: systemRoot, ProgramFiles: 'C:\\Program Files' }, everyFile)).toThrow(/WSL launcher, not Git Bash/)
    },
  )

  it('without CLAUDE_CODE_GIT_BASH_PATH, the Git Bash findGitBash finds', () => {
    const exists = (path: string): boolean => path === GIT_BASH
    expect(windowsGitBash({ ProgramFiles: 'C:\\Program Files', SystemRoot: 'C:\\Windows' }, exists)).toBe(GIT_BASH)
  })
})
