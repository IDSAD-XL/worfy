// Probe of worfy-windows 92 and 93 (not product code, Windows only): drives the real
// TerminalRegistry of main (src/main/terminal/pty.ts) with shells of Windows in a temporary
// profile (USERPROFILE, APPDATA, LOCALAPPDATA, HOME, HOMEDRIVE, HOMEPATH in <outDir>) and measures
//   leak    — the handles of this process per way a shell ends (exit, close, kill), by object type,
//             with 92-handles.ps1 (NtQuerySystemInformation; Sysinternals handle.exe is not needed);
//   history — whether Git Bash writes ~/.bash_history per way its Terminal ends.
// Build and run from the repo root in Git Bash (the bundle goes to a temp folder with handles.ps1):
//   D=$(mktemp -d); cp .scratch/worfy-windows/evidence/92-handles.ps1 "$D/handles.ps1"
//   node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/bin/esbuild .scratch/worfy-windows/evidence/92-probe.ts \
//     --bundle --platform=node --format=cjs --external:node-pty --external:electron \
//     --inject:<file exporting `function globStub() { return {} }`> --define:import.meta.glob=globStub \
//     '--define:import.meta.url="file:///<repo>/src/main/terminal/cursor-answers.ts"' --outfile="$D/probe.cjs"
//   ELECTRON_RUN_AS_NODE=1 NODE_PATH="$PWD/node_modules" "$(node -p "require('electron')")" --expose-gc "$D/probe.cjs" \
//     leak "$D/out" powershell "exit:10,exit:20,close:20,kill:20,exit:100:4"     (or git-bash; step = way:count[:parallel])
//   ELECTRON_RUN_AS_NODE=1 NODE_PATH="$PWD/node_modules" "$(node -p "require('electron')")" "$D/probe.cjs" history "$D/out"
// The stub stands in for vite's import.meta.glob of the zsh integration, which a Windows shell does not use.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { join, win32 } from 'node:path'
import { spawn as spawnNodePty } from 'node-pty'
import { spawnShellPty, TerminalRegistry, type SpawnPty } from '../../../src/main/terminal/pty'

const SYSTEM_ROOT = process.env['SystemRoot'] ?? 'C:\\Windows'
const POWERSHELL = win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const HANDLES_PS1 = win32.join(__dirname, 'handles.ps1')
const GIT_KILL = 'C:\\Program Files\\Git\\usr\\bin\\kill.exe'
const [, , mode = 'leak', outDir = __dirname, shellArg = 'powershell', planArg = 'exit:10'] = process.argv
const LOG = join(outDir, `${mode}-${mode === 'leak' ? shellArg : 'git-bash'}.log`)

function log(line: string): void {
  const text = `[${new Date().toISOString()}] ${line}`
  process.stdout.write(text + '\n')
  appendFileSync(LOG, text + '\n')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A temporary profile: every variable a Windows shell finds its profile, history and rc files by. */
function profileEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  const appData = join(home, 'AppData', 'Roaming')
  const localAppData = join(home, 'AppData', 'Local')
  mkdirSync(appData, { recursive: true })
  mkdirSync(join(localAppData, 'Temp'), { recursive: true })
  return {
    SystemRoot: SYSTEM_ROOT,
    SystemDrive: SYSTEM_ROOT.slice(0, 2),
    windir: SYSTEM_ROOT,
    ComSpec: win32.join(SYSTEM_ROOT, 'System32', 'cmd.exe'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    Path: [win32.join(SYSTEM_ROOT, 'System32'), SYSTEM_ROOT, win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0')].join(';'),
    ProgramFiles: process.env['ProgramFiles'] ?? 'C:\\Program Files',
    ProgramData: process.env['ProgramData'] ?? 'C:\\ProgramData',
    USERPROFILE: home,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    HOMEDRIVE: home.slice(0, 2),
    HOMEPATH: home.slice(2),
    HOME: home,
    TEMP: join(localAppData, 'Temp'),
    TMP: join(localAppData, 'Temp'),
    ...extra,
  }
}

const withoutProfile: SpawnPty = (file, args, options) => spawnShellPty(file, /(?:powershell|pwsh)\.exe$/i.test(file) ? [...args, '-NoProfile'] : args, options)

interface Sample {
  total: number
  handleCount: number
  threads: number
  types: Record<string, number>
  files: Record<string, number>
  processes: string[]
  children: string[]
}

function sample(): Sample {
  if (typeof global.gc === 'function') global.gc()
  const out = execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HANDLES_PS1, '-TargetPid', String(process.pid)], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(out.trim().split(/\r?\n/).at(-1) ?? '{}') as Sample
}

function delta(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const d: Record<string, number> = {}
  for (const k of keys) {
    const v = (b[k] ?? 0) - (a[k] ?? 0)
    if (v !== 0) d[k] = v
  }
  return d
}

/** Process handles grouped by image and state, without the handle values. */
function processSummary(list: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of list) {
    const [, image = '?', , state = '?'] = p.split(':')
    const k = `${image}:${state}`
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

interface Shell {
  key: string
  client: object
  pid: number
  text: () => string
  exited: Promise<void>
  hasExited: () => boolean
}

async function openShell(registry: TerminalRegistry, key: string, cwd: string, gitBash: boolean): Promise<Shell> {
  let output = ''
  let done = false
  let resolveExit: () => void = () => undefined
  const exited = new Promise<void>((resolve) => (resolveExit = resolve))
  const client = {}
  const result = await registry.open(key, { cwd, cols: 100, rows: 30, shell: () => (gitBash ? 'git-bash' : undefined) }, client, {
    output: (data) => (output += data),
    exit: () => {
      done = true
      resolveExit()
    },
    started: () => undefined,
  })
  return { key, client, pid: result.pid, text: () => output, exited, hasExited: () => done }
}

async function waitFor(test: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms
  while (!test()) {
    if (Date.now() > until) throw new Error(`timed out: ${what}`)
    await sleep(25)
  }
}

/** Waits for the first output and then for a quiet moment: the prompt is up. */
async function waitPrompt(shell: Shell): Promise<void> {
  await waitFor(() => shell.text().length > 0, 15000, `${shell.key}: first output`)
  let last = shell.text().length
  let quietSince = Date.now()
  while (Date.now() - quietSince < 400) {
    await sleep(50)
    const now = shell.text().length
    if (now !== last) {
      last = now
      quietSince = Date.now()
    }
  }
}

function consoleChildren(): string[] {
  const out = execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance -Query "SELECT ProcessId, ParentProcessId, Name FROM Win32_Process WHERE ParentProcessId = ${process.pid} AND Name = 'OpenConsole.exe'" | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', windowsHide: true })
  return out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
}

async function oneShell(registry: TerminalRegistry, key: string, cwd: string, gitBash: boolean, how: string, trace = false): Promise<void> {
  const shell = await openShell(registry, key, cwd, gitBash)
  await waitPrompt(shell)
  if (trace) log(`trace ${key} (${how}): shell pid ${shell.pid}, OpenConsole.exe under this process: ${consoleChildren().join(',')}`)
  if (how === 'exit') {
    registry.write(key, 'exit\r', shell.client)
    await Promise.race([shell.exited, sleep(10000).then(() => Promise.reject(new Error(`${key}: no exit in 10 s`)))])
    await registry.close(key)
  } else if (how === 'close') {
    await registry.close(key)
  } else if (how === 'kill') {
    // From outside, as a crash or the Task Manager would: TerminateProcess of the shell's pid.
    process.kill(shell.pid)
    await Promise.race([shell.exited, sleep(10000).then(() => Promise.reject(new Error(`${key}: no exit in 10 s after kill`)))])
    await registry.close(key)
  } else throw new Error(`unknown way ${how}`)
}

async function leak(): Promise<void> {
  const gitBash = shellArg === 'git-bash'
  const home = mkdtempSync(join(outDir, `home-${shellArg}-`))
  const registry = new TerminalRegistry({ env: () => Promise.resolve(profileEnv(home)), spawn: withoutProfile })
  log(`leak: pid ${process.pid}, shell ${shellArg}, plan ${planArg}, home ${home}, gc ${typeof global.gc === 'function'}`)
  let n = 0
  let previous = sample()
  log(`start: total ${previous.total} handleCount ${previous.handleCount} threads ${previous.threads} children ${JSON.stringify(previous.children)}`)
  for (const step of planArg.split(',')) {
    const [how = 'exit', countText = '1', parallelText = '1'] = step.split(':')
    const count = Number(countText)
    const parallel = Number(parallelText)
    const started = Date.now()
    let failures = 0
    for (let i = 0; i < count; i += parallel) {
      const batch: Promise<void>[] = []
      for (let j = i; j < Math.min(count, i + parallel); j++) {
        batch.push(oneShell(registry, `s${++n}`, home, gitBash, how, parallel === 1 && j < 2).catch((error: unknown) => {
          failures++
          log(`error: ${String(error)}`)
        }))
      }
      await Promise.all(batch)
    }
    // node-pty's dispose() of the output worker fires 1000 ms later; the exit look 1.0-1.5 s.
    await sleep(3000)
    const now = sample()
    log(
      `after ${how} x${count} (${Date.now() - started} ms, ${failures} failed): total ${now.total} (${now.total - previous.total >= 0 ? '+' : ''}${now.total - previous.total}) handleCount ${now.handleCount} (${now.handleCount - previous.handleCount}) threads ${now.threads} (${now.threads - previous.threads})` +
        ` types ${JSON.stringify(delta(previous.types, now.types))} files ${JSON.stringify(delta(previous.files, now.files))}` +
        ` processHandles ${JSON.stringify(delta(processSummary(previous.processes), processSummary(now.processes)))}` +
        ` newProcessHandles(first 6) ${JSON.stringify(now.processes.filter((p) => !previous.processes.includes(p)).slice(0, 6))} children ${JSON.stringify(now.children)}`,
    )
    previous = now
  }
  await registry.closeAll()
  log('done')
}

/** One Git Bash Terminal that runs two commands and ends `how`; answers what the temporary ~/.bash_history holds. */
async function historyCase(name: string, how: string, options: { extraEnv?: Record<string, string>; systemConsole?: boolean; noDescendants?: boolean } = {}): Promise<void> {
  const home = mkdtempSync(join(outDir, `hist-${name}-`))
  const spawn: SpawnPty = options.systemConsole === true ? (file, args, o) => spawnNodePty(file, args, { ...o, useConptyDll: false }) : withoutProfile
  const registry = new TerminalRegistry({
    env: () => Promise.resolve(profileEnv(home, options.extraEnv)),
    spawn,
    ...(options.noDescendants === true ? { endDescendants: () => 'ended' as const } : {}),
  })
  const shell = await openShell(registry, 'h', home, true)
  await waitPrompt(shell)
  const tree = execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId, Name FROM Win32_Process' | Where-Object { $_.ParentProcessId -eq ${shell.pid} -or $_.ProcessId -eq ${shell.pid} } | ForEach-Object { $_.Name + ':' + $_.ProcessId + '<' + $_.ParentProcessId }`], { encoding: 'utf8', windowsHide: true })
    .trim()
    .split(/\r?\n/)
  const inner = tree.map((line) => /^bash\.exe:(\d+)<(\d+)$/.exec(line.trim())).find((m) => m !== null && Number(m[2]) === shell.pid)
  for (const word of ['one', 'two']) {
    registry.write('h', `echo probe-${word}-$((40+2))\r`, shell.client)
    await waitFor(() => shell.text().includes(`probe-${word}-42`), 5000, `${name}: echo ${word}`)
  }
  await sleep(300)
  const started = Date.now()
  if (how === 'close') await registry.close('h')
  else if (how === 'exit') {
    registry.write('h', 'exit\r', shell.client)
    await Promise.race([shell.exited, sleep(10000)])
    await registry.close('h')
  } else if (how === 'hup') {
    // SIGHUP through the MSYS runtime to the bash under the launcher, by its Windows pid; then the usual close.
    if (inner === undefined || inner === null) throw new Error(`${name}: no bash.exe under ${shell.pid}: ${tree.join(' | ')}`)
    execFileSync(GIT_KILL, ['-HUP', '-W', inner[1] as string], { env: profileEnv(home), windowsHide: true })
    await Promise.race([shell.exited, sleep(5000)])
    log(`${name}: after kill -HUP -W ${inner[1]}: exited by itself ${shell.hasExited()} in ${Date.now() - started} ms`)
    await registry.close('h')
  }
  const ms = Date.now() - started
  await sleep(500)
  const file = join(home, '.bash_history')
  const there = existsSync(file)
  const body = there ? readFileSync(file, 'utf8') : ''
  log(
    `${name}: ended by ${how} in ${ms} ms; tree ${JSON.stringify(tree)}; .bash_history ${there ? `${statSync(file).size} bytes` : 'missing'}; probe-one ${body.includes('probe-one')} probe-two ${body.includes('probe-two')}`,
  )
  await registry.closeAll()
}

async function history(): Promise<void> {
  log(`history: pid ${process.pid}`)
  await historyCase('close', 'close')
  await historyCase('exit', 'exit')
  await historyCase('prompt-command-close', 'close', { extraEnv: { PROMPT_COMMAND: 'history -a' } })
  await historyCase('hup-then-close', 'hup')
  await historyCase('system-console-close', 'close', { systemConsole: true })
  await historyCase('system-console-close-no-descendants', 'close', { systemConsole: true, noDescendants: true })
  await historyCase('package-console-close-no-descendants', 'close', { noDescendants: true })
  log('done')
}

;(mode === 'history' ? history() : leak()).then(
  () => process.exit(0),
  (error: unknown) => {
    log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
    process.exit(1)
  },
)
