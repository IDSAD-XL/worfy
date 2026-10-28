// Triage only (a draft PR, never merged): how long one launch of node takes on the Windows runner, with the
// runner idle and while a shard of the unit and contract suite runs. Inside the suite a test's
// `process.execPath` is Electron's binary under ELECTRON_RUN_AS_NODE (scripts/vitest-electron.mjs), so both
// node.exe and electron.exe are timed.
//   idle             each binary 10 times in a row, before the suite starts
//   sample <file>    each binary once every 5 s until killed, one line per sample appended to <file>
//   summary <file>   per binary: samples, median, 90th percentile, slowest; and the slowest of each minute
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron')
const binaries = { node: [process.execPath, process.env], electron: [electron, { ...process.env, ELECTRON_RUN_AS_NODE: '1' }] }

function launch(name) {
  const [cmd, env] = binaries[name]
  const start = performance.now()
  spawnSync(cmd, ['-e', '0'], { env })
  return Math.round(performance.now() - start)
}

const stats = (times) => {
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return `${sorted.length} launches, median ${at(0.5)} ms, p90 ${at(0.9)} ms, slowest ${sorted.at(-1)} ms`
}

const [mode, file] = process.argv.slice(2)
if (mode === 'idle') {
  for (const name of Object.keys(binaries)) console.log(`launch time idle, ${name}: ${stats(Array.from({ length: 10 }, () => launch(name)))}`)
} else if (mode === 'sample') {
  const begin = Date.now()
  for (;;) {
    const line = Object.keys(binaries).map((name) => `${name}=${launch(name)}`).join(' ')
    appendFileSync(file, `${Math.round((Date.now() - begin) / 1000)} ${line}\n`)
    await new Promise((wait) => setTimeout(wait, 5000))
  }
} else if (mode === 'summary') {
  const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => {
    const [at, ...rest] = line.split(' ')
    return { at: Number(at), ...Object.fromEntries(rest.map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)])) }
  })
  for (const name of Object.keys(binaries)) console.log(`launch time under the suite, ${name}: ${stats(rows.map((row) => row[name]))}`)
  const minutes = new Map()
  for (const row of rows) {
    const minute = Math.floor(row.at / 60)
    const was = minutes.get(minute) ?? { node: 0, electron: 0 }
    minutes.set(minute, { node: Math.max(was.node, row.node), electron: Math.max(was.electron, row.electron) })
  }
  for (const [minute, max] of minutes) console.log(`minute ${minute}: slowest node ${max.node} ms, electron ${max.electron} ms`)
} else {
  console.error('usage: triage-launch-time.mjs idle | sample <file> | summary <file>')
  process.exit(2)
}
