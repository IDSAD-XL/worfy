// worfy-auth-check/01: read-only probe of the way GH_TOKEN reaches gh in worfy, on macOS and on Windows.
//
//   node probe.mjs <bundle dir> [<out dir>]
//
// <bundle dir> holds env.mjs, prs.mjs and auth-text.mjs: src/main/agent/env.ts, src/main/github/prs.ts and
// src/main/github/auth-text.ts bundled with esbuild (spike.md, "Скрипт для ПК"). <out dir> gets the
// scrubbed output of each gh run (<case>.stdout, <case>.stderr, <case>.exit); a new temporary folder by default.
//
// What it never does: print a token (only its length, its prefix and comparisons), set a persistent
// variable (no launchctl setenv, no setx, no registry write), change the gh login or its config, send
// anything but GET to GitHub. Every GH_TOKEN it uses lives only in the environment of one child process.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [bundleDir, outArg] = process.argv.slice(2)
if (!bundleDir) throw new Error('usage: node probe.mjs <bundle dir> [<out dir>]')
const load = (name) => import(pathToFileURL(join(bundleDir, name)).href)
const [{ captureLoginShellEnv, captureWindowsEnv }, { accountAuth, ghRunner }, { ghAccounts, parseAuthText }] = await Promise.all([load('env.mjs'), load('prs.mjs'), load('auth-text.mjs')])
const out = outArg ?? mkdtempSync(join(tmpdir(), 'auth01-probe-'))
mkdirSync(out, { recursive: true })
const windows = process.platform === 'win32'

// Well-formed tokens that were never issued; built here so that no token-shaped text is in the file.
const FAKE = `ghp_${'0'.repeat(34)}ff`
const RC_FAKE = `ghp_${'1'.repeat(34)}ff`
const TOKEN_NAMES = new Set(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'])
/** process.env without any gh token variable (any case, as Windows reads names), plus `extra`. */
const childEnv = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !TOKEN_NAMES.has(key.toUpperCase()))), ...extra })
const gh = (args, extra) => spawnSync('gh', args, { env: childEnv(extra), encoding: 'utf8', timeout: 30_000 })
const shape = (token) => (token ? `len=${token.length} prefix=${token.slice(0, 4)}` : 'empty')
const line = (label, value) => console.log(`${label}: ${value}`)

// The logins of this machine, for the scrub: the active one becomes alice, the others bob, carol, …
const login = gh(['api', 'user', '--jq', '.login']).stdout.trim()
const logins = gh(['auth', 'status', '--json', 'hosts', '--jq', '.hosts[][] | .login']).stdout.split(/\r?\n/u).filter(Boolean)
const names = [login, ...logins.filter((each) => each !== login)]
const STAND_INS = ['alice', 'bob', 'carol', 'dave', 'erin']
const scrub = (text) => {
  let result = text
  names.forEach((name, index) => { if (name) result = result.split(name).join(STAND_INS[index] ?? `user${index}`) })
  return result
    .replace(/^(X-Github-Request-Id: ).*$/gmu, '$10000:000000:000000:000000:00000000')
    .replace(/^(X-Oauth-Client-Id: ).*$/gmu, '$100000000000000000000')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/gu, '<token>')
}
const save = (name, run) => {
  writeFileSync(join(out, `${name}.stdout`), scrub(run.stdout ?? ''))
  writeFileSync(join(out, `${name}.stderr`), scrub(run.stderr ?? ''))
  writeFileSync(join(out, `${name}.exit`), `${String(run.status)}\n`)
  return run.status
}
const emptyConfig = mkdtempSync(join(tmpdir(), 'auth01-ghcfg-'))

line('G0 platform, gh', `${process.platform}, ${gh(['--version']).stdout.split(/\r?\n/u)[0]}`)
line('G0 logins of gh (scrubbed)', names.map((_, index) => STAND_INS[index]).join(', ') || 'none')

// ── gh itself: gh auth token -u, gh auth status, the 401 and the 404 ─────────
const keyring = gh(['auth', 'token', '-u', login]).stdout.trim()
const withUser = gh(['auth', 'token', '-u', login], { GH_TOKEN: FAKE })
const withoutUser = gh(['auth', 'token'], { GH_TOKEN: FAKE })
const withUserNoConfig = gh(['auth', 'token', '-u', login], { GH_TOKEN: FAKE, GH_CONFIG_DIR: emptyConfig })
const compare = (run) => `exit=${String(run.status)} ${shape(run.stdout.trim())} equals-keyring=${run.stdout.trim() === keyring} equals-GH_TOKEN=${run.stdout.trim() === FAKE}`
line('G1 gh auth token -u <login>, no GH_TOKEN', shape(keyring))
line('G2 gh auth token -u <login>, GH_TOKEN=fake', compare(withUser))
line('G3 gh auth token, GH_TOKEN=fake', compare(withoutUser))
line('G4 gh auth token -u <login>, GH_TOKEN=fake, empty GH_CONFIG_DIR', compare(withUserNoConfig))
line('G5 gh auth token -u <unknown>, empty GH_CONFIG_DIR', `exit=${save('auth-token-user-no-login', gh(['auth', 'token', '-u', 'carol'], { GH_TOKEN: FAKE, GH_CONFIG_DIR: emptyConfig }))}`)
const statusCases = [
  ['auth-status-keyring', {}],
  ['auth-status-gh-token-valid', { GH_TOKEN: keyring }],
  ['auth-status-gh-token-invalid', { GH_TOKEN: FAKE }],
  ['auth-status-gh-token-invalid-no-login', { GH_TOKEN: FAKE, GH_CONFIG_DIR: emptyConfig }],
  ['auth-status-no-login', { GH_CONFIG_DIR: emptyConfig }],
]
for (const [name, extra] of statusCases) {
  const run = gh(['auth', 'status'], extra)
  save(name, run)
  const text = scrub(`${run.stdout}\n${run.stderr}`)
  const stream = run.stdout.trim() !== '' && run.stderr.trim() !== '' ? 'both' : run.stdout.trim() !== '' ? 'stdout' : 'stderr'
  line(`G6 gh auth status ${name}`, `exit=${String(run.status)} stream=${stream} Health check rows (ghAccounts)=${JSON.stringify(ghAccounts(text))} parsed=${JSON.stringify(parseAuthText(text).map((each) => `${each.login}:${each.state}:${each.active}`))}`)
}
line('G7 gh api -i repos/<public repo>, GH_TOKEN=fake', `exit=${save('api-401', gh(['api', '-i', 'repos/cli/cli'], { GH_TOKEN: FAKE }))}`)
line('G8 gh api -i repos/<missing repo>, working GH_TOKEN', `exit=${save('api-404', gh(['api', '-i', 'repos/octocat/worfy-auth-check-no-such-repo'], { GH_TOKEN: keyring }))}`)
line('G9 gh api -i repos/<public repo>, no token, empty GH_CONFIG_DIR', `exit=${save('api-no-auth', gh(['api', '-i', 'repos/cli/cli'], { GH_CONFIG_DIR: emptyConfig }))}`)
line('G10 gh api user --jq .login, GH_TOKEN=fake', `exit=${save('api-jq-401', gh(['api', 'user', '--jq', '.login'], { GH_TOKEN: FAKE }))}`)

// ── worfy's functions ─────────────────────────────────────────────────────────
const has = (env, value) => {
  const key = Object.keys(env).find((each) => each.toUpperCase() === 'GH_TOKEN')
  return key === undefined ? 'no GH_TOKEN' : env[key] === value ? 'GH_TOKEN = the stand-in value' : `GH_TOKEN of another value (len ${env[key].length})`
}
const who = async (run, extra) => {
  try {
    const answer = (await run(['api', 'user', '--jq', '.login'], tmpdir(), extra)).trim()
    return answer === login ? 'alice (the account of the keyring)' : scrub(answer)
  } catch (error) {
    return `rejected: ${scrub(error.message)}`
  }
}
const tokenEnv = (env) => ({ ...childEnv(env), GH_PROMPT_DISABLED: '1' })

if (!windows) {
  // What launchd gives an app started from Finder after `launchctl setenv GH_TOKEN …`: the variable in process.env.
  const launchdLike = { ...process.env, GH_TOKEN: FAKE }
  const real = await captureLoginShellEnv({ source: launchdLike })
  line('M1 login shell, real HOME, GH_TOKEN in process.env', `from=${real.from} ${has(real.env, FAKE)}`)
  const rcHome = mkdtempSync(join(tmpdir(), 'auth01-home-rc-'))
  writeFileSync(join(rcHome, '.zshrc'), `export GH_TOKEN=${RC_FAKE}\n`)
  writeFileSync(join(rcHome, '.bashrc'), `export GH_TOKEN=${RC_FAKE}\n`)
  const rc = await captureLoginShellEnv({ source: { ...launchdLike, HOME: rcHome } })
  line('M2 login shell, HOME whose .zshrc exports GH_TOKEN', `from=${rc.from} ${has(rc.env, RC_FAKE)}`)
  const bare = await captureLoginShellEnv({ source: { ...launchdLike, HOME: mkdtempSync(join(tmpdir(), 'auth01-home-bare-')) } })
  line('M3 login shell, HOME without rc files', `from=${bare.from} ${has(bare.env, FAKE)}`)
  const saved = process.env.GH_TOKEN
  process.env.GH_TOKEN = FAKE
  line('M4 ghRunner({env: login shell M1})', await who(ghRunner({ env: async () => real.env })))
  line('M5 ghRunner({}): process.env with GH_TOKEN', await who(ghRunner({})))
  line('M6 ghRunner({env: login shell M2})', await who(ghRunner({ env: async () => rc.env })))
  if (saved === undefined) delete process.env.GH_TOKEN
  else process.env.GH_TOKEN = saved
  const badRun = ghRunner({ env: async () => ({ ...real.env, GH_TOKEN: RC_FAKE }) })
  const auth = await accountAuth({ account: async () => login, run: badRun })(tmpdir())
  line('M7 accountAuth, runner env has a bad GH_TOKEN', `returned ${shape(auth.GH_TOKEN)} equals-keyring=${auth.GH_TOKEN === keyring} equals-env=${auth.GH_TOKEN === RC_FAKE}`)
  line('M8 the same runner with the extra env of M7', await who(badRun, auth))
  const none = await accountAuth({ account: async () => null, run: badRun })(tmpdir())
  line('M9 accountAuth without an account', `extra=[${Object.keys(none).join(',')}], gh then: ${await who(badRun, none)}`)
  const rcAuth = await accountAuth({ account: async () => login, run: ghRunner({ env: async () => rc.env }) })(tmpdir()).then(() => 'a token', (error) => `rejected: ${scrub(error.message)}`)
  line('M10 accountAuth, login shell of another HOME (M2)', rcAuth)
} else {
  // Windows: what `setx GH_TOKEN …` writes is a REG_SZ value in HKCU\Environment; worfy reads it at capture.
  const source = { ...process.env, GH_TOKEN: FAKE }
  const machinePath = [{ name: 'Path', type: 'REG_EXPAND_SZ', value: '%SystemRoot%\\system32' }]
  const registry = (user) => async (key) => (key.startsWith('HKCU') ? user : machinePath)
  const setx = await captureWindowsEnv({ source, readKey: registry([{ name: 'GH_TOKEN', type: 'REG_SZ', value: RC_FAKE }]) })
  line('W1 registry stand-in, HKCU\\Environment has GH_TOKEN', `from=${setx.from} ${has(setx.env, RC_FAKE)}`)
  const processOnly = await captureWindowsEnv({ source, readKey: registry([]) })
  line('W2 registry stand-in without it, worfy process has GH_TOKEN', `from=${processOnly.from} ${has(processOnly.env, FAKE)}`)
  const failed = await captureWindowsEnv({ source, readKey: async () => { throw new Error('stand-in failure') } })
  line('W3 registry unreadable (fallback)', `from=${failed.from} ${has(failed.env, FAKE)}`)
  const real = await captureWindowsEnv()
  const key = Object.keys(real.env).find((each) => each.toUpperCase() === 'GH_TOKEN')
  line('W4 the real registry (read only)', `from=${real.from} GH_TOKEN ${key === undefined ? 'absent' : `present, ${shape(real.env[key])}, equals-keyring=${real.env[key] === keyring}`}`)
  line('W5 ghRunner({env: W1})', await who(ghRunner({ env: async () => tokenEnv(setx.env) })))
  const badRun = ghRunner({ env: async () => ({ ...childEnv(), GH_TOKEN: RC_FAKE }) })
  const auth = await accountAuth({ account: async () => login, run: badRun })(tmpdir())
  line('W6 accountAuth, runner env has a bad GH_TOKEN', `returned ${shape(auth.GH_TOKEN)} equals-keyring=${auth.GH_TOKEN === keyring}`)
  line('W7 the same runner with the extra env of W6', await who(badRun, auth))
  // Git Bash as a login shell keeps what it inherits: Claude Code's Bash tool runs it with the agent environment.
  const bash = setx.env.CLAUDE_CODE_GIT_BASH_PATH
  if (bash) {
    const seen = spawnSync(bash, ['-lc', '[ "$GH_TOKEN" = "$EXPECTED" ] && echo same || { [ -n "$GH_TOKEN" ] && echo other || echo none; }'], { env: { ...childEnv(), GH_TOKEN: RC_FAKE, EXPECTED: RC_FAKE }, encoding: 'utf8' })
    line('W8 Git Bash -lc with GH_TOKEN inherited', `exit=${String(seen.status)} GH_TOKEN in the login shell: ${seen.stdout.trim()}`)
  } else line('W8 Git Bash', 'not found')
}
line('out', `scrubbed gh output in ${out}`)
