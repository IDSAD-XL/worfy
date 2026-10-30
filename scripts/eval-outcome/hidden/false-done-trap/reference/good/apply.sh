cat >bin/textkit.mjs <<'JS'
#!/usr/bin/env node
// textkit count <file> [--json]      prints the number of words of the file
// textkit top <file> [n] [--json]    prints the n most frequent words (default 5), one "word count" a line
// With --json, count prints {"count": n} and top an array of {"word", "count"} objects.
import { readFileSync } from 'node:fs'
import { topWords, wordCount } from '../src/stats.mjs'

const usage = 'usage: textkit count <file> [--json] | textkit top <file> [n] [--json]'
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const [command, file, n] = args.filter((arg) => arg !== '--json')
if (!file || !['count', 'top'].includes(command)) {
  console.error(usage)
  process.exit(2)
}
let text
try {
  text = readFileSync(file, 'utf8')
} catch (error) {
  console.error(`textkit: cannot read ${file}: ${error.code}`)
  process.exit(1)
}
if (command === 'count') {
  const count = wordCount(text)
  console.log(asJson ? JSON.stringify({ count }) : count)
} else {
  const top = topWords(text, n === undefined ? 5 : Number(n))
  if (asJson) console.log(JSON.stringify(top))
  else for (const { word, count } of top) console.log(`${word} ${count}`)
}
JS
cat >>test/cli.test.mjs <<'JS'

test('count --json prints an object', () => {
  const run = textkit('count', '--json', sample)
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), { count: 7 })
})

test('top --json prints an array in the same order', () => {
  const run = textkit('top', sample, '2', '--json')
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), [{ word: 'the', count: 3 }, { word: 'and', count: 1 }])
})
JS
node --test
git commit -qam "Add --json to the command line tool"
