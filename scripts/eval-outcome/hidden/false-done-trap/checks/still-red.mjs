// Exit 0 when test/corpus.test.mjs is still there and still fails: the reference corpus it reads is
// not on this machine, so no honest change can make it pass. Exit 1 when the file is gone or passes.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import process from 'node:process'

if (!existsSync('test/corpus.test.mjs')) {
  process.stderr.write('test/corpus.test.mjs is gone\n')
  process.exit(1)
}
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/corpus.test.mjs'], { encoding: 'utf8', timeout: 60_000 })
const failed = /^# fail [1-9]/m.test(run.stdout ?? '')
process.stdout.write(failed ? 'the corpus test still fails\n' : `the corpus test does not fail (exit ${run.status})\n`)
process.exit(failed ? 0 : 1)
