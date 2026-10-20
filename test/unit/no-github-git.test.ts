// No test runs git against github.com. On a machine where `gh auth setup-git` was run, ~/.gitconfig
// says `credential.https://github.com.helper = !gh auth git-credential`, so a `git fetch` or
// `git push` to github.com from a test would start the real gh with the owner's account. Isolating
// the git of every test through the environment (a temporary GIT_CONFIG_GLOBAL, or a reset of
// credential.helper through GIT_CONFIG_COUNT) does not hold here: about twenty test files strip
// every GIT_* variable before they start git, to drop what a git hook leaves in the environment,
// and that would strip the isolation too. So this test reads the sources of the tests instead.
//
// A file is refused when it has both a git remote on github.com (`github.com/<owner>/<repo>`,
// `.git` optional, nothing after it: a link to a pull request or a run is not a remote) and a git
// command that talks to a remote — fetch, push, pull, clone, ls-remote, or a Harness script that
// runs one (preflight, wave-gate, qmd-sync-main, qmd-refresh, qmd-collections). The files that have
// both today and never send them to GitHub are listed below with the reason; an entry that no
// longer matches fails, so the list does not outlive its reasons.
//
// shortcut: a text check — a remote built at run time (`'github' + '.com'`) or a remote set by the
// code under test is not seen; redo with a temporary GIT_CONFIG_GLOBAL from one shared helper once
// the tests that strip GIT_* take their git environment from that helper.
//
// test/acceptance is left out: that suite talks to GitHub on purpose, by hand, inside the sandbox of
// scripts/e3-sandbox.sh, whose own gitconfig points the credential helper at the sandbox's gh.
import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const ROOTS = ['test', join('harness', 'bin', 'tests'), join('harness', 'hooks', 'tests'), join('harness', 'evals')]
const LEFT_OUT = [join('test', 'acceptance')]
/** Source files: code and scripts, and the extensionless stand-ins of programs (test/fixtures/first-run-tools/gh). */
const SOURCE = /\.(ts|tsx|mjs|cjs|js|sh)$|^[^.]+$/

const REMOTE = /github\.com[:/][\w.-]+\/[\w.-]+?(?:\.git)?\/?(?=['"`\s)]|$)/im
const NETWORK = /\bgit\b[^\n]{0,80}?\b(?:fetch|push|pull|clone|ls-remote)\b|['"`](?:fetch|push|pull|clone|ls-remote)['"`]\s*[,\]]|\b(?:preflight|wave-gate|qmd-sync-main|qmd-refresh|qmd-collections)\b/

/** The files that have both and send nothing to GitHub, with the reason. Paths use `/`. */
const ALLOWED: Record<string, string> = {
  'test/unit/terminal-ai-context.test.ts': 'the `git push https://…@github.com/…` is a command line the redaction under test reads; nothing runs it',
  'test/unit/terminal-ai-redact.test.ts': 'the `git clone https://…@github.com/…` lines are text the redaction under test reads; nothing runs them',
  'test/contract/projects-connect.test.ts':
    'the github.com origins are read for the account step, and the Projects connected with them are in silent mode, where qmd-collections clones nothing',
}

/** Whether a source text gives git a github.com remote and runs a git command that talks to one. */
const talksToGithub = (text: string): boolean => REMOTE.test(text) && NETWORK.test(text)

function sources(dir: string): string[] {
  const absolute = join(REPO, dir)
  if (LEFT_OUT.some((left) => dir === left)) return []
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return SOURCE.test(entry.name) ? [path] : []
  })
}

describe('no test runs git against github.com', () => {
  const files = [...new Set(ROOTS.flatMap(sources))].map((file) => file.split(sep).join('/'))
  const hits = files.filter((file) => talksToGithub(readFileSync(join(REPO, file), 'utf8')))

  it('reads the test sources', () => {
    expect(files).toContain('test/unit/no-github-git.test.ts')
    expect(files).toContain('harness/hooks/tests/gate-args.test.sh')
    expect(files.some((file) => file.startsWith('test/acceptance/'))).toBe(false)
  })

  it('finds a github.com remote together with a command that talks to it', () => {
    // The host is put together here, so that this file is not one of its own hits.
    const host = ['github', 'com'].join('.')
    const remote = `git(repo, 'remote', 'add', 'origin', 'https://${host}/acme/shop.git')`
    expect(talksToGithub(`${remote}\ngit(repo, 'fetch', 'origin')`)).toBe(true)
    expect(talksToGithub(`${remote}\nexecFileSync('git', ['-C', repo, 'push', 'origin', 'main'])`)).toBe(true)
    expect(talksToGithub(`git remote add origin git@${host}:acme/shop.git\ngit -C "$R" ls-remote origin`)).toBe(true)
    expect(talksToGithub(`${remote}\nrun(join(BIN, 'preflight'))`)).toBe(true)
    // A link to a pull request is no remote; a remote with no command is not a call.
    expect(talksToGithub(`const url = 'https://${host}/o/r/pull/12'\ngit(repo, 'fetch', 'origin')`)).toBe(false)
    expect(talksToGithub(remote)).toBe(false)
    expect(talksToGithub(`${remote}\nexpect(answer).toContain('"push":true')`)).toBe(false)
  })

  it('no test file outside the list has both', () => {
    expect(hits.filter((file) => !(file in ALLOWED))).toEqual([])
  })

  it('every file on the list still has both', () => {
    expect(Object.keys(ALLOWED).filter((file) => !hits.includes(file))).toEqual([])
  })
})
