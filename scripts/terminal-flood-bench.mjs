#!/usr/bin/env node
// Measures how fast a flood of terminal output reaches the subscribers of the real TerminalRegistry
// (src/main/terminal/pty.ts) while main parses it for its answers (cursor-answers.ts), and how fast
// main answers a cursor-position request during the flood. Not a test: numbers for a ticket.
//
//   node scripts/terminal-flood-bench.mjs [--shells 1,2,4] [--rounds 3] [--warmup 1.5] [--seconds 5]
//                                         [--program yes|node|idle] [--screen-workers <n>|shell] [--root <checkout>]
//
// Each round opens N shells in one registry; each shell runs a program that writes `y\n` without end
// (`yes`, or `node -e` with a loop: the default on Windows, where there is no `yes`). After the
// warm-up it counts for --seconds: the characters the subscribers got (MB = 10^6), the CPU of main's
// thread (process.threadCpuUsage) and of the whole process with its worker threads
// (process.cpuUsage), as % of one core, the pauses and resumes of the ptys during the count, and the warnings
// "refused output" (main's screen gave up). Three times per shell it puts `ESC[6n` at the end of the
// next chunk node-pty hands the registry and times the answer main writes to that pty; after the
// last one it waits up to 5 s more ("none": no answer). RSS is the process's at the end of the count.
// The load of the machine is printed before each number of shells: the load average, on Windows how
// busy all cores were over one second.
// `--program idle` runs a program that prints nothing (`node -e` with a timer): the RSS of N quiet
// shells, what their screens cost at rest; its requests get no answer, as no output carries them.
// Then the shells are closed and the next round starts.
//
// --root measures another checkout (its src/ and its node_modules), for example one of main before a
// change: the script needs nothing of the branch it came with. --screen-workers sets the most worker
// threads main's screens may use (`screenWorker.limit`, "shell" for one per shell); a checkout of
// --root without that setting (main before it) ignores it, and the report says so.
//
// It runs in Electron's Node, as the app's main process and the tests do (node-pty is built for
// Electron's ABI): started with plain node it starts itself again under Electron. TypeScript of src/
// loads through Vite's module runner (runnerImport). Every shell it starts is closed at the end of
// its round, and killed by pid if it is still there.
/* global console, performance, setTimeout, clearTimeout */
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { availableParallelism, cpus, loadavg } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { killShells } from './terminal-flood-bench-kill.mjs'

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..')

if (process.versions.electron === undefined) {
  const electron = createRequire(import.meta.url)('electron')
  const child = spawn(electron, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('close', (code, signal) => {
    // Never a silent 1: say how Electron's Node ended when it did not end well.
    if (signal !== null) process.stderr.write(`terminal-flood-bench: Electron's Node was ended by ${signal}\n`)
    else if (code === null) process.stderr.write("terminal-flood-bench: Electron's Node ended without an exit code\n")
    else if (code !== 0) process.stderr.write(`terminal-flood-bench: Electron's Node exited with code ${code}\n`)
    process.exitCode = code ?? 1
  })
} else {
  await main()
}

async function main() {
  const { values } = parseArgs({
    options: {
      shells: { type: 'string', default: '1,2,4' },
      rounds: { type: 'string', default: '3' },
      warmup: { type: 'string', default: '1.5' },
      seconds: { type: 'string', default: '5' },
      program: { type: 'string', default: process.platform === 'win32' ? 'node' : 'yes' },
      'screen-workers': { type: 'string' },
      root: { type: 'string', default: HERE },
    },
  })
  const root = resolve(values.root)
  const counts = values.shells.split(',').map(Number)
  const rounds = Number(values.rounds)
  const warmupMs = Number(values.warmup) * 1000
  const countMs = Number(values.seconds) * 1000

  const { runnerImport } = await import(pathToFileURL(join(HERE, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
  const entry = 'virtual:terminal-flood-bench'
  // Forward slashes: Vite takes `C:/…` for a file on Windows, and a backslash in a specifier is an escape.
  const terminal = join(root, 'src', 'main', 'terminal').replaceAll('\\', '/')
  const { module } = await runnerImport(entry, {
    configFile: false,
    root,
    logLevel: 'error',
    plugins: [
      {
        name: 'terminal-flood-bench',
        resolveId: (id) => (id === entry ? `\0${entry}` : undefined),
        load: (id) =>
          id === `\0${entry}`
            ? `export { TerminalRegistry, spawnShellPty } from ${JSON.stringify(`${terminal}/pty.ts`)}\nexport { screenWorker } from ${JSON.stringify(`${terminal}/cursor-answers.ts`)}\n`
            : undefined,
      },
    ],
  })
  const { TerminalRegistry, spawnShellPty, screenWorker } = module

  let variant = 'as built'
  if (values['screen-workers'] !== undefined) {
    const workers = values['screen-workers']
    const limit = workers === 'shell' ? Number.POSITIVE_INFINITY : Number(workers)
    if (limit !== Number.POSITIVE_INFINITY && !(Number.isInteger(limit) && limit >= 1)) throw new Error(`--screen-workers: a whole number of at least 1 or "shell", not ${workers}`)
    if ('limit' in screenWorker) {
      screenWorker.limit = limit
      variant = `screen workers: ${workers}`
    } else if (root !== HERE) variant = 'as built (this checkout has no screenWorker.limit; --screen-workers ignored)'
    // Its own checkout always has the setting: without it the numbers would be of another variant.
    else throw new Error('--screen-workers: src/main/terminal/cursor-answers.ts of this checkout has no screenWorker.limit')
  }

  const program = programOf(values.program)
  let commit = '?'
  try {
    commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    // Not a git checkout.
  }
  console.log(`# terminal flood bench: ${root} @ ${commit}, ${variant}`)
  console.log(`# ${process.platform} ${cpus()[0]?.model ?? '?'}, availableParallelism ${availableParallelism()}, Electron ${process.versions.electron}, Node ${process.versions.node}`)
  console.log(`# program: ${program.label}; warm-up ${warmupMs} ms, count ${countMs} ms, ${rounds} rounds; load before: ${await loadNow()}`)
  console.log('| shells | round | refused | MB/s total (per shell) | main thread, % | process, % | pause / resume | ESC[6n answer, ms | RSS, MB |')
  console.log('|---|---|---|---|---|---|---|---|---|')

  let refused = 0
  const warn = console.warn
  console.warn = (...args) => {
    if (args.some((arg) => String(arg).includes('refused output'))) refused += 1
    else warn(...args)
  }

  // The ptys, not their pids: on Windows a pty's pid is 0 until the console has started the shell,
  // so it is read when the shells are killed; a pid of 0 or less is never signalled (killShells).
  const started = new Set()
  const killAll = () => killShells([...started].map((pty) => pty.pid))
  process.on('exit', killAll)
  // Ctrl+C or a stop of the run: the shells go first (130, 143: 128 + the signal's number).
  process.on('SIGINT', () => {
    killAll()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    killAll()
    process.exit(143)
  })

  for (const n of counts) {
    if (n !== counts[0]) console.log(`# load before ${n} shells: ${await loadNow()}`)
    for (let round = 1; round <= rounds; round += 1) {
      refused = 0
      const shells = []
      const registry = new TerminalRegistry({
        env: async () => ({ ...process.env }),
        spawn: (_file, _args, options) => {
          const pty = spawnShellPty(program.file, program.args, options)
          started.add(pty)
          const shell = shells.at(-1)
          return instrument(pty, shell)
        },
      })
      for (let i = 0; i < n; i += 1) {
        const shell = { key: `bench-${n}-${round}-${i}`, bytes: 0, pauses: 0, resumes: 0, inject: [], waiting: [], answers: [], pid: 0 }
        shells.push(shell)
        const sink = { output: (data) => void (shell.bytes += data.length), exit: () => undefined, started: () => undefined }
        const opened = await registry.open(shell.key, { cwd: process.cwd(), cols: 80, rows: 24 }, {}, sink)
        shell.pid = opened.pid
      }
      await sleep(warmupMs)
      const before = snapshot(shells)
      // Three requests per shell, spread over the count, each shell a little apart from the others.
      const timers = []
      for (const [index, shell] of shells.entries()) {
        for (const at of [0.2, 0.5, 0.8]) timers.push(setTimeout(() => shell.inject.push(performance.now()), at * countMs + index * 37))
      }
      await sleep(countMs)
      const after = snapshot(shells)
      const rss = process.memoryUsage().rss
      // The last request may still wait for its answer: up to 5 s more.
      const until = performance.now() + 5000
      while (performance.now() < until && shells.some((shell) => shell.inject.length > 0 || shell.waiting.length > 0)) await sleep(50)
      timers.forEach(clearTimeout)

      const seconds = (after.at - before.at) / 1000
      const totalMb = (after.bytes - before.bytes) / 1e6 / seconds
      const perShell = shells.map((shell, i) => (after.each[i] - before.each[i]) / 1e6 / seconds)
      const thread = ((after.thread - before.thread) / 1000 / (after.at - before.at)) * 100
      const proc = ((after.cpu - before.cpu) / 1000 / (after.at - before.at)) * 100
      const pauses = after.pauses - before.pauses
      const resumes = after.resumes - before.resumes
      const answers = shells.flatMap((shell) => shell.answers)
      const missing = shells.reduce((sum, shell) => sum + shell.waiting.length + shell.inject.length, 0)
      const answerText = answers.length === 0 ? 'none' : `${Math.round(Math.min(...answers))}–${Math.round(Math.max(...answers))}${missing > 0 ? `, ${missing} none` : ''}`
      const share = n > 1 ? ` (${Math.min(...perShell).toFixed(1)}–${Math.max(...perShell).toFixed(1)})` : ''
      console.log(`| ${n} | ${round} | ${refused} | ${totalMb.toFixed(1)}${share} | ${thread.toFixed(1)} | ${proc.toFixed(0)} | ${pauses} / ${resumes} | ${answerText} | ${(rss / 1e6).toFixed(0)} |`)

      await Promise.race([registry.closeAll(), sleep(10_000)])
      killAll()
      started.clear()
      await sleep(500)
    }
  }
  console.warn = warn
  // The screens' worker threads are unref'ed; nothing else keeps the process.
  process.exit(0)
}

/**
 * The load of the machine now: the load average, or on Windows, where Node reports it as 0 0 0, how
 * busy all cores were over one second (os.cpus() times).
 */
async function loadNow() {
  if (process.platform !== 'win32') return `load average ${loadavg().map((n) => n.toFixed(2)).join(' ')}`
  const sum = () => cpus().reduce((all, { times }) => ({ idle: all.idle + times.idle, total: all.total + times.user + times.nice + times.sys + times.idle + times.irq }), { idle: 0, total: 0 })
  const before = sum()
  await sleep(1000)
  const after = sum()
  return `CPU busy over 1 s: ${((1 - (after.idle - before.idle) / (after.total - before.total)) * 100).toFixed(0)} % of all cores`
}

/** The program each shell runs: `y\n` without end. */
function programOf(name) {
  if (name === 'yes') return { file: 'yes', args: [], label: 'yes' }
  if (name !== 'node' && name !== 'idle') throw new Error(`--program: yes, node or idle, not ${name}`)
  const node = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  if (name === 'idle') return { file: node, args: ['-e', 'setInterval(() => {}, 1e9)'], label: `${node} -e (prints nothing)` }
  const code = "const b=Buffer.from('y\\n'.repeat(65536));(function w(){while(process.stdout.write(b));process.stdout.once('drain',w)})()"
  return { file: node, args: ['-e', code], label: `${node} -e (a loop writing y\\n)` }
}

/** The pty as the registry gets it: counts its pauses and resumes, puts the requests in its output and times their answers. */
function instrument(pty, shell) {
  return {
    get pid() {
      return pty.pid
    },
    onData: (listener) =>
      pty.onData((data) => {
        if (shell.inject.length > 0) {
          shell.waiting.push(...shell.inject.splice(0))
          listener(`${data}\x1b[6n`)
        } else listener(data)
      }),
    onExit: (listener) => pty.onExit(listener),
    write: (data) => {
      // eslint-disable-next-line no-control-regex
      const answered = data.match(/\x1b\[\d+;\d+R/g)?.length ?? 0
      for (let i = 0; i < answered && shell.waiting.length > 0; i += 1) shell.answers.push(performance.now() - shell.waiting.shift())
      pty.write(data)
    },
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    pause: () => {
      shell.pauses += 1
      pty.pause()
    },
    resume: () => {
      shell.resumes += 1
      pty.resume()
    },
  }
}

function snapshot(shells) {
  const cpu = process.cpuUsage()
  const thread = process.threadCpuUsage()
  return { at: performance.now(), bytes: shells.reduce((sum, shell) => sum + shell.bytes, 0), each: shells.map((shell) => shell.bytes), pauses: shells.reduce((sum, shell) => sum + shell.pauses, 0), resumes: shells.reduce((sum, shell) => sum + shell.resumes, 0), thread: thread.user + thread.system, cpu: cpu.user + cpu.system }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}
