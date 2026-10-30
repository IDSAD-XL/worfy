import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath, URL } from 'node:url'

const CLI = fileURLToPath(new URL('../bin/textkit.mjs', import.meta.url))
const textkit = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const folder = mkdtempSync(join(tmpdir(), 'textkit-json-'))
const sample = join(folder, 'sample.txt')
writeFileSync(sample, 'b a c b\nA b c\n')
const empty = join(folder, 'empty.txt')
writeFileSync(empty, '')

/** The whole stdout of a run that exited 0, parsed as one JSON value. */
const json = (run) => {
  assert.equal(run.status, 0, run.stderr)
  return JSON.parse(run.stdout)
}

test('count --json before the file name', () => {
  assert.deepEqual(json(textkit('count', '--json', sample)), { count: 7 })
})

test('count --json after the file name', () => {
  assert.deepEqual(json(textkit('count', sample, '--json')), { count: 7 })
})

test('count --json of an empty file', () => {
  assert.deepEqual(json(textkit('count', '--json', empty)), { count: 0 })
})

test('top --json keeps the order of the text output', () => {
  assert.deepEqual(json(textkit('top', '--json', sample)), [
    { word: 'b', count: 3 },
    { word: 'a', count: 2 },
    { word: 'c', count: 2 },
  ])
})

test('top --json with a count, the option last', () => {
  assert.deepEqual(json(textkit('top', sample, '2', '--json')), [
    { word: 'b', count: 3 },
    { word: 'a', count: 2 },
  ])
})

test('top --json with a count, the option before the file name', () => {
  assert.deepEqual(json(textkit('top', '--json', sample, '1')), [{ word: 'b', count: 3 }])
})

test('without --json the text output is unchanged', () => {
  const count = textkit('count', sample)
  assert.equal(count.status, 0, count.stderr)
  assert.equal(count.stdout, '7\n')
  const top = textkit('top', sample, '2')
  assert.equal(top.status, 0, top.stderr)
  assert.equal(top.stdout, 'b 3\na 2\n')
})

test('a missing file and a missing command are still errors', () => {
  assert.equal(textkit('count', '--json', join(folder, 'missing.txt')).status, 1)
  assert.equal(textkit('--json').status, 2)
})
