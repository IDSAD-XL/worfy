// Probe for ticket 86: records the raw output of a ConPTY shell around resizes and the alternate
// screen. Usage: node probe.mjs <ps|bash> <out.json>
import { createRequire } from 'node:module'
import console from 'node:console'
import process from 'node:process'
import { setTimeout } from 'node:timers'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire('C:/Users/Alexey/worfy-wt/wt86/package.json')
const pty = require('node-pty')

const [kind, out] = process.argv.slice(2)
const profile = mkdtempSync(join(tmpdir(), 'p86-'))
const appData = join(profile, 'AppData', 'Roaming')
const local = join(profile, 'AppData', 'Local')
mkdirSync(appData, { recursive: true })
mkdirSync(join(local, 'Temp'), { recursive: true })
const env = { ...process.env, USERPROFILE: profile, APPDATA: appData, LOCALAPPDATA: local, HOMEDRIVE: 'C:', HOMEPATH: profile.slice(2), TERM: 'xterm-256color', TEMP: join(local, 'Temp'), TMP: join(local, 'Temp') }
const file = kind === 'ps' ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : 'C:\\Program Files\\Git\\bin\\bash.exe'
const args = kind === 'ps' ? ['-NoLogo', '-NoProfile'] : ['--login', '-i']
const start = { cols: 117, rows: 30 }
const p = pty.spawn(file, args, { name: 'xterm-256color', ...start, cwd: join(local, 'Temp'), env, useConptyDll: true })
const events = [{ t: 0, start }]
const t0 = Date.now()
p.onData((data) => {
  events.push({ t: Date.now() - t0, data })
  // As main does (console-request.ts): answer the device attributes request of the console.
  // eslint-disable-next-line no-control-regex -- the console's requests are what this probe answers
  if (/\x1b\[0?c/.test(data)) { events.push({ t: Date.now() - t0, answer: 'DA' }); p.write('\x1b[?1;2c') }
  // eslint-disable-next-line no-control-regex -- the console's requests are what this probe answers
  if (/\x1b\[6n/.test(data)) p.write('\x1b[1;1R')
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const type = async (text) => {
  events.push({ t: Date.now() - t0, input: text })
  p.write(text)
  await wait(1500)
}
const resize = async (cols, rows) => {
  events.push({ t: Date.now() - t0, resize: { cols, rows } })
  p.resize(cols, rows)
  await wait(1500)
}

await wait(3000)
if (kind === 'ps') {
  const size = (tag) => `echo "${tag}=$($Host.UI.RawUI.WindowSize.Width)x$($Host.UI.RawUI.WindowSize.Height)"\r`
  await type(size('a'))
  await resize(160, 40)
  await type(size('b'))
  await type("'mark'+'er-one'\r")
  await resize(69, 16)
  await type(size('d'))
  await resize(150, 44)
  await type(size('e'))
  await resize(81, 21)
  await resize(150, 44)
  await type(size('f'))
  await type('exit\r')
} else {
  await type('unset HISTFILE\r')
  // Type right after a resize, at several delays; each command echoes its delay.
  // A focus report (ESC[I, as xterm.js sends on focus) and then a command 500 ms later; with and
  // without a resize before.
  for (const [i, resize] of [[1, false], [2, false], [3, true], [4, true], [5, false]]) {
    if (resize) { events.push({ t: Date.now() - t0, resize: { cols: 81, rows: i % 2 ? 14 : 21 } }); p.resize(81, i % 2 ? 14 : 21); await wait(100) }
    events.push({ t: Date.now() - t0, input: 'ESC[I' })
    p.write('\x1b[I')
    await wait(500)
    events.push({ t: Date.now() - t0, input: `echo f${i}` })
    for (const ch of `echo f${i}\r`) { p.write(ch); await wait(2) }
    await wait(1500)
    p.write('\x1b[O')
    await wait(300)
  }
  await type('exit\r')
}
await wait(2000)
try { p.kill() } catch { /* the shell is gone already */ }
writeFileSync(out, JSON.stringify(events, null, 1))
console.log('events', events.length)
process.exit(0)
