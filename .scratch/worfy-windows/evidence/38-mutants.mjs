// Mutants of worfy-windows ticket 38: one exact replacement in src/main/docs/watch.ts at a time, the
// three test files of the ticket run under Electron's Node, the file put back from a copy and
// compared. Usage: node .scratch/worfy-windows/evidence/38-mutants.mjs <tree> <folder for the copy> [M1 M4 …]
import console from 'node:console'
import process from 'node:process'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const tree = process.argv[2]
const file = `${tree}/src/main/docs/watch.ts`
const backup = `${process.argv[3]}/watch.ts.orig`
copyFileSync(file, backup)
const original = readFileSync(file, 'utf8')
const tests = ['test/unit/docs-watch-root-gone.test.ts', 'test/contract/docs-watch-root.test.ts', 'test/contract/docs.test.ts']
const mutants = [
  ['M1 the read on the root name removed', "filename === null || filename === itself || isWatchedPath(filename)", "filename === null || isWatchedPath(filename)"],
  ['M2 the root by its full path instead of its last name', "const itself = nameOnDisk(root)", "const itself = root"],
  ['M3 the root name taken for a lost root (closed and waited for)', "if (namesTheFolder(filename, full)) return this.lost()", "if (namesTheFolder(filename, full) || filename === itself) return this.lost()"],
  // Round 1 of the review of PR #491.
  ['M4 any name at the top of the root asks for a read', "filename === null || filename === itself || isWatchedPath(filename)", "filename === null || !filename.includes(sep) || isWatchedPath(filename)"],
  ['M5 the name as written, not that of the real path', "return nativePath.basename(realpathSync.native(folder))", "return nativePath.basename(folder)"],
  ['M6 no name when there is no real path', "  } catch {\n    return nativePath.basename(folder)\n  }", "  } catch {\n    return ''\n  }"],
]
try {
  const only = process.argv.slice(4)
  for (const [name, from, to] of mutants) {
    if (only.length > 0 && !only.includes(name.split(' ')[0])) continue
    if (original.split(from).length !== 2) throw new Error(`${name}: text not found exactly once`)
    writeFileSync(file, original.replace(from, to))
    const run = spawnSync('pnpm', ['test', ...tests], { cwd: tree, encoding: 'utf8' })
    const out = run.stdout + run.stderr
    const failed = out.split('\n').filter((l) => /^\s+×/.test(l)).map((l) => l.trim().replace(/ \d+ms$/, ''))
    console.log(`${name}: exit ${run.status}; ${(out.match(/Tests .*/) ?? [''])[0]}`)
    for (const l of failed) console.log(`   ${l}`)
  }
} finally {
  copyFileSync(backup, file)
  console.log('restored:', readFileSync(file, 'utf8') === original)
}
