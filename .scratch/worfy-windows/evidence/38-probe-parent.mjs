// Probe of worfy-windows ticket 38: what a recursive fs.watch of a folder reports on macOS when a
// folder above it is renamed away and back, or removed; and when the folder is removed by unlink + rmdir.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, writeFileSync, watch, unlinkSync, rmdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import console from 'node:console'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout } from 'node:timers'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function run(label, act) {
  const top = realpathSync.native(mkdtempSync(join(tmpdir(), 'probe38b-')))
  const dir = join(top, 'parent'); mkdirSync(dir)
  const root = join(dir, 'project'); mkdirSync(root)
  writeFileSync(join(root, 'HANDOFF.md'), '# h\n')
  await pause(300)
  const events = []; const t0 = Date.now()
  const w = watch(root, { recursive: true }, (e, name) => events.push(`${Date.now() - t0}ms ${e} ${JSON.stringify(name)}`))
  w.on('error', (err) => events.push(`error ${err}`)); w.on('close', () => events.push('close'))
  await pause(1500); events.push(`--- act at ${Date.now() - t0}ms`)
  await act(root, dir, top, (s) => events.push(`--- ${s} at ${Date.now() - t0}ms`))
  await pause(1500); w.close()
  console.log(`== ${label}`); for (const e of events) console.log('  ' + e)
  await rm(top, { recursive: true, force: true })
}
await run('parent renamed away, then renamed back', async (root, dir, top, mark) => {
  renameSync(dir, join(top, 'p2')); await pause(1500); mark('back'); renameSync(join(top, 'p2'), dir)
})
await run('parent removed recursively', async (root, dir) => { await rm(dir, { recursive: true }) })
await run('unlink + rmdir, no ADR', async (root) => { unlinkSync(join(root, 'HANDOFF.md')); rmdirSync(root) })
