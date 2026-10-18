// Probe of worfy-windows ticket 38: what a recursive fs.watch of a folder reports on macOS when the folder is renamed away
// and then (a) made again at the old path, (b) renamed back. Also a recursive remove (rm of node:fs/promises).
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync, watch } from 'node:fs'
import { rm } from 'node:fs/promises'
import console from 'node:console'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers'

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

async function run(label, act) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'probe38-')))
  const root = join(dir, 'project')
  mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# h\n')
  mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
  writeFileSync(join(root, 'docs', 'adr', '0001-a.md'), '# a\n')
  const events = []
  const t0 = Date.now()
  const w = watch(root, { recursive: true }, (e, name) => events.push(`${Date.now() - t0}ms ${e} ${JSON.stringify(name)}`))
  w.on('error', (err) => events.push(`error ${err}`))
  w.on('close', () => events.push('close'))
  await pause(1500)
  events.push(`--- act at ${Date.now() - t0}ms`)
  await act(root, dir, (s) => events.push(`--- ${s} at ${Date.now() - t0}ms`))
  await pause(1500)
  w.close()
  console.log(`== ${label}`)
  for (const e of events) console.log('  ' + e)
  await rm(dir, { recursive: true, force: true })
}

await run('rename away, then mkdir at the old path + write HANDOFF.md', async (root, dir, mark) => {
  renameSync(root, join(dir, 'moved'))
  await pause(1500)
  mark('mkdir again')
  mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# again\n')
  await pause(800)
  mark('write in the moved folder')
  writeFileSync(join(dir, 'moved', 'HANDOFF.md'), '# moved\n')
})

await run('rename away, then rename back', async (root, dir, mark) => {
  renameSync(root, join(dir, 'moved'))
  await pause(1500)
  mark('rename back')
  renameSync(join(dir, 'moved'), root)
  await pause(800)
  mark('write HANDOFF.md after rename back')
  writeFileSync(join(root, 'HANDOFF.md'), '# back\n')
})

await run('a recursive remove, then mkdir again', async (root, _dir, mark) => {
  await rm(root, { recursive: true })
  await pause(1500)
  mark('mkdir again')
  mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# again\n')
})

await run('a file under the root named as the root', async (root) => {
  writeFileSync(join(root, 'project'), 'x')
})
