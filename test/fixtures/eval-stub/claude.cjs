#!/usr/bin/env node
// A stand-in for claude in test/contract/harness-evals-run.test.ts; what it answers and logs is described
// in test/contract/harness-evals-shared.ts, at the constant STUB. CommonJS, started by its path through a link, as the real claude is.
/* global require, process, console, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script */
const { spawnSync } = require('node:child_process')
const { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') {
  if (process.env.STUB_VERSION_LOG) appendFileSync(process.env.STUB_VERSION_LOG, '--version\n')
  console.log(process.env.STUB_VERSION + ' (Claude Code)')
  process.exit(0)
}
const log = process.env.STUB_LOG
const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0
const manifest = JSON.parse(readFileSync(join(args[2], '.claude-plugin', 'plugin.json'), 'utf8'))
const evals = readdirSync(join(args[2], 'evals'))
const evalGit = process.env.EVAL_GIT || ''
// Windows starts no #!/bin/sh script by its path: there sh runs the wrapper, with the PATH of the run,
// through which the copied git.exe loads its DLLs; git prints its exec path with forward slashes.
const windows = process.platform === 'win32'
const runGit = (gitArgs, env = {}) => windows
  ? spawnSync('sh', [evalGit, ...gitArgs], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } })
  : spawnSync(evalGit, gitArgs, { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } })
const version = evalGit ? runGit(['--version']) : null
const execPathOut = evalGit ? runGit(['--exec-path']).stdout.trim() : ''
const execPath = windows && execPathOut ? resolve(execPathOut) : execPathOut
const systemConfig = evalGit && process.env.STUB_SYSTEM_CONFIG
  ? runGit(['config', '--get', 'worfy.probe'], { GIT_CONFIG_SYSTEM: process.env.STUB_SYSTEM_CONFIG, GIT_CONFIG_GLOBAL: '/dev/null' }).status
  : null
const core = evalGit ? join(dirname(evalGit), 'git-core') : ''
// On Windows the names of the commands, without .exe: git.exe is the command git.
const gitFiles = core && existsSync(core) ? readdirSync(core).map((file) => (windows ? file.replace(/\.exe$/, '') : file)) : []
appendFileSync(log, JSON.stringify({
  args, manifest, evals, path: process.env.PATH, evalGit, evalHarnessHome: process.env.EVAL_HARNESS_HOME ?? null,
  gitVersion: version ? { status: version.status, stdout: version.stdout } : null, execPath, systemConfig, gitFiles,
}) + '\n')
// As claude parses its arguments: whatever follows a '--' is a positional argument, no option.
const dash = args.indexOf('--')
const options = dash === -1 ? args : args.slice(0, dash)
// As claude does: every --tag adds its values; --case takes one name glob, and the last one counts.
const tagsOf = () => {
  const values = []
  options.forEach((arg, at) => {
    if (arg === '--tag') for (let i = at + 1; i < options.length && !options[i].startsWith('-'); i++) values.push(options[i])
    else if (arg.startsWith('--tag=')) values.push(arg.slice('--tag='.length))
  })
  return values
}
const lastCase = () => {
  let value
  options.forEach((arg, at) => {
    if (arg === '--case') value = options[at + 1]
    else if (arg.startsWith('--case=')) value = arg.slice('--case='.length)
  })
  return value
}
// A name glob with * only, which is all these tests use.
const globMatch = (glob, name) => {
  const parts = glob.split('*')
  if (parts.length === 1) return glob === name
  if (!name.startsWith(parts[0])) return false
  let at = parts[0].length
  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at)
    if (found === -1) return false
    at = found + part.length
  }
  const last = parts[parts.length - 1]
  return name.length - last.length >= at && name.endsWith(last)
}
// The cases claude would run: those of the target whose tags meet a --tag, and that the last --case matches.
const casesRun = () => {
  const tags = tagsOf()
  const only = lastCase()
  return evals
    .filter((name) => existsSync(join(args[2], 'evals', name, 'prompt.md')))
    .filter((name) => {
      const own = (/^tags:\s*\[([^\]]*)\]/m.exec(readFileSync(join(args[2], 'evals', name, 'prompt.md'), 'utf8'))?.[1] ?? '').split(',').map((tag) => tag.trim())
      return (tags.length === 0 || tags.some((tag) => own.includes(tag))) && (only === undefined || globMatch(only, name))
    })
    .sort()
}
if (process.env.STUB_AGGREGATE) {
  const outputDir = options[options.indexOf('--output-dir') + 1]
  mkdirSync(outputDir, { recursive: true })
  // A report that names neither its cases nor their number gets the cases this call ran, as claude's does.
  let report = process.env.STUB_AGGREGATE
  try {
    const parsed = JSON.parse(report)
    if (!('cases' in parsed) && parsed.aggregates?.casesTotal === undefined) {
      const ran = casesRun()
      report = JSON.stringify({ ...parsed, cases: ran.map((name) => ({ name })), aggregates: { ...parsed.aggregates, casesTotal: ran.length } })
    }
  } catch {
    // Not a JSON object: written as it is.
  }
  writeFileSync(join(outputDir, 'aggregate-result.json'), report)
}
if (process.env.STUB_LOCK && calls === 0) chmodSync(args[2], 0o555)
const code = Number((process.env.STUB_CODES || '0').split(',')[calls] || 0)
if (process.env.STUB_HANG && calls === 0) {
  // STUB_CATCH: the stub catches the signal and exits 0, as a claude that ends cleanly on Ctrl-C.
  if (process.env.STUB_CATCH) for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
  writeFileSync(process.env.STUB_HANG, String(process.pid))
  setTimeout(() => process.exit(code), 60000)
} else process.exit(code)
