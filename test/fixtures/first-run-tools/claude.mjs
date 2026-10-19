// The Claude Code CLI stand-in of ./claude as a Node script, for Windows (README.md): the same
// answers and the same plugin state in $FIRST_RUN_TOOLS_STATE.
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { log } from './stand-in.mjs'

const args = process.argv.slice(2)
log('claude', args)
const state = process.env.FIRST_RUN_TOOLS_STATE ?? ''
const file = (name) => join(state, name)

/** The lines of a state file; none when it is not there. */
function lines(name) {
  return existsSync(file(name)) ? readFileSync(file(name), 'utf8').split(/\r?\n/) : []
}
const hasLine = (name, line) => lines(name).includes(line)
const firstLine = (name) => lines(name)[0] ?? ''
const isDir = (path) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
/** The repository's name of `owner/repo`, or the plugin's marketplace of `name@marketplace`: what follows the last `sep`. */
const after = (text, sep) => text.slice(text.lastIndexOf(sep) + 1)

function fail(message, code) {
  process.stderr.write(`claude stand-in: ${message}\n`)
  process.exit(code)
}

const line = args.join(' ')
const failing = process.env.FAKE_CLAUDE_FAIL
if (failing && line.startsWith(failing)) fail(`${line} failed`, 1)

const [first, second, third = '', fourth = ''] = args
if (first === '--version') {
  process.stdout.write(`${process.env.FAKE_CLAUDE_VERSION || '2.1.289'} (Claude Code)\n`)
  process.exit(0)
}
if (first === 'plugin') {
  if (second === 'list') {
    const entries = []
    if (state && existsSync(file('plugin-version')) && statSync(file('plugin-version')).size > 0) {
      entries.push(`{"id":"worfy@worfy-harness","version":"${firstLine('plugin-version')}","scope":"user","enabled":true,"errors":[]}`)
    }
    for (const id of state ? lines('plugins') : []) {
      if (id !== '') entries.push(`{"id":"${id}","version":"1.0.0","scope":"user","enabled":true,"errors":[]}`)
    }
    process.stdout.write(`[${entries.join(',')}]\n`)
    process.exit(0)
  }
  if (second === 'marketplace') {
    if (third === 'list') {
      const names = existsSync(file('marketplace')) ? ['{"name":"worfy-harness"}'] : []
      for (const name of lines('marketplaces')) if (name !== '') names.push(`{"name":"${name}"}`)
      process.stdout.write(`[${names.join(',')}]\n`)
    } else if (third === 'add') {
      // A folder is the Harness copy; anything else is `owner/repo`, known by the repository's name.
      if (isDir(fourth)) writeFileSync(file('marketplace'), `${fourth}\n`)
      else if (!hasLine('marketplaces', after(fourth, '/'))) appendFileSync(file('marketplaces'), `${after(fourth, '/')}\n`)
    }
    process.exit(0)
  }
  if (second === 'install' || second === 'update') {
    if (third.startsWith('worfy@')) {
      const folder = firstLine('marketplace')
      const version = /"version"\s*:\s*"([^"]*)"/.exec(readFileSync(join(folder, '.claude-plugin', 'plugin.json'), 'utf8'))?.[1] ?? ''
      writeFileSync(file('plugin-version'), `${version}\n`)
    } else {
      // Another plugin: installed only from a marketplace added before.
      if (!hasLine('marketplaces', after(third, '@'))) fail(`marketplace of ${third} not found`, 1)
      if (!hasLine('plugins', third)) appendFileSync(file('plugins'), `${third}\n`)
    }
    process.exit(0)
  }
  if (second === 'uninstall') {
    // An empty file is "not installed", as in the shell stand-in.
    if (third.startsWith('worfy@')) writeFileSync(file('plugin-version'), '')
    process.exit(0)
  }
}
fail(`unsupported: ${line}`, 2)
