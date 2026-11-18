// Whose token gh takes and what GitHub answered (src/main/github/auth-diagnosis.ts, worfy-auth-check ticket 05),
// on the answers of gh 2.97 that ticket 01 recorded (test/fixtures/gh-auth/, scrubbed).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  environmentEntry,
  environmentToken,
  removeVariableCommand,
  repoAccess,
  signInWithoutVariables,
  sourceText,
  tokenSource,
} from '../../src/main/github/auth-diagnosis'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'gh-auth')
/** What gh printed for a case, stdout and stderr together, as the runner hands them over. */
const printed = (name: string): string => `${readFileSync(join(FIXTURES, `${name}.stdout`), 'utf8')}\n${readFileSync(join(FIXTURES, `${name}.stderr`), 'utf8')}`
/** A token shaped as gh's, built here so that no token-shaped text sits in the source (scripts/check-personal.mjs). */
const SHAPED = ['ghp', '0123456789abcdefghijklmnopqrstuvwxyzAB'].join('_')
const exitOf = (name: string): number => Number(readFileSync(join(FIXTURES, `${name}.exit`), 'utf8').trim())

describe('whose token gh takes', () => {
  it('GH_TOKEN, then GITHUB_TOKEN, then the keyring; an empty variable is unset', () => {
    expect(environmentToken({ GH_TOKEN: 'x', GITHUB_TOKEN: 'y' }, 'darwin')).toBe('GH_TOKEN')
    expect(environmentToken({ GITHUB_TOKEN: 'y' }, 'darwin')).toBe('GITHUB_TOKEN')
    expect(environmentToken({ GH_TOKEN: '', GITHUB_TOKEN: 'y' }, 'darwin')).toBe('GITHUB_TOKEN')
    expect(environmentToken({ GH_TOKEN: '' }, 'darwin')).toBeNull()
    expect(environmentToken({}, 'darwin')).toBeNull()
  })

  it('on Windows the name compares without case, as the system does; elsewhere it does not', () => {
    expect(environmentToken({ Gh_Token: 'x' }, 'win32')).toBe('GH_TOKEN')
    expect(environmentToken({ Gh_Token: 'x' }, 'darwin')).toBeNull()
  })

  it("the Profile's account wins over any variable; without one the variable, else the keyring", () => {
    expect(tokenSource({ account: 'alice', env: { GH_TOKEN: 'x' }, platform: 'darwin' })).toEqual({ kind: 'account', login: 'alice' })
    expect(tokenSource({ account: null, env: { GITHUB_TOKEN: 'x' }, platform: 'darwin' })).toEqual({ kind: 'environment', variable: 'GITHUB_TOKEN' })
    expect(tokenSource({ account: null, env: {}, platform: 'darwin' })).toEqual({ kind: 'keyring' })
  })

  it('the source in words names the variable or the login, never a value', () => {
    const secret = SHAPED
    const texts = [
      sourceText(tokenSource({ account: null, env: { GH_TOKEN: secret }, platform: 'darwin' })),
      sourceText(tokenSource({ account: 'alice', env: { GH_TOKEN: secret }, platform: 'darwin' })),
      sourceText(tokenSource({ account: null, env: {}, platform: 'darwin' })),
    ]
    expect(texts).toEqual(['GH_TOKEN from the environment', "the token of alice from gh's keyring", "the token of gh's active account"])
    for (const text of texts) expect(text).not.toContain(secret)
  })

  it('`gh auth status`: the entry of GH_TOKEN with its state, or none for the keyring alone', () => {
    expect(environmentEntry(printed('auth-status-keyring'))).toBeNull()
    expect(environmentEntry(printed('auth-status-gh-token-valid'))).toEqual({ variable: 'GH_TOKEN', host: 'github.com', state: 'success', active: true, login: 'alice' })
    expect(environmentEntry(printed('auth-status-gh-token-invalid'))).toEqual({ variable: 'GH_TOKEN', host: 'github.com', state: 'error', active: true, login: null })
    expect(environmentEntry(printed('auth-status-gh-token-invalid-no-login'))).toMatchObject({ variable: 'GH_TOKEN', state: 'error', login: null })
    expect(environmentEntry(printed('auth-status-no-login'))).toBeNull()
  })

  it('the commands the user copies: worfy changes no variable itself', () => {
    expect(removeVariableCommand('GH_TOKEN', 'darwin')).toBe('launchctl unsetenv GH_TOKEN')
    expect(removeVariableCommand('GITHUB_TOKEN', 'win32')).toBe("[Environment]::SetEnvironmentVariable('GITHUB_TOKEN', $null, 'User')")
    expect(signInWithoutVariables('darwin')).toBe('env -u GH_TOKEN -u GITHUB_TOKEN gh auth login')
    expect(signInWithoutVariables('win32')).toContain('Remove-Item Env:GH_TOKEN')
  })
})

describe('what GitHub answered to gh api -i repos/<owner>/<repo>', () => {
  it('401 of the fixture: the token does not work', () => {
    expect(exitOf('api-401')).toBe(1)
    expect(repoAccess({ output: printed('api-401') })).toEqual({ kind: 'bad-token' })
  })

  it('404 of the fixture: no access', () => {
    expect(repoAccess({ output: printed('api-404') })).toEqual({ kind: 'no-access' })
  })

  it('exit 4 without a token: gh has none', () => {
    expect(exitOf('api-no-auth')).toBe(4)
    expect(repoAccess({ output: printed('api-no-auth') })).toEqual({ kind: 'no-token' })
  })

  it('200: access', () => {
    expect(repoAccess({ output: 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"full_name":"acme/app"}' })).toEqual({ kind: 'ok' })
  })

  it.each([500, 502, 503, 429])('HTTP %i: unknown, never a failure', (status) => {
    expect(repoAccess({ output: `HTTP/2.0 ${status} Server Error\r\n\r\n{"message":"Server Error"}\ngh: Server Error (HTTP ${status})` })).toEqual({ kind: 'unknown', reason: `GitHub answered HTTP ${status}` })
  })

  it('another 4xx: refused with its status (a 403 of SSO is ticket 06)', () => {
    expect(repoAccess({ output: 'HTTP/2.0 403 Forbidden\r\n\r\n{}' })).toEqual({ kind: 'refused', status: 403 })
  })

  it('no network, a timeout: unknown with the last line gh printed, never the body', () => {
    expect(repoAccess({ output: 'error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n' })).toEqual({
      kind: 'unknown',
      reason: 'check your internet connection or https://githubstatus.com',
    })
    expect(repoAccess({ failure: 'Command failed: gh api -i repos/acme/app' })).toEqual({ kind: 'unknown', reason: 'Command failed: gh api -i repos/acme/app' })
    expect(repoAccess({ failure: '' })).toEqual({ kind: 'unknown', reason: 'gh did not answer' })
  })

  it('a token-shaped word in what gh printed does not reach the reason', () => {
    const answer = repoAccess({ output: `something went wrong with ${SHAPED}` })
    expect(JSON.stringify(answer)).not.toContain(SHAPED.slice(0, 8))
  })
})
