// scripts/check-personal.mjs: the guard of personal strings in the tracked files of the repository
// (epic worfy-scrub, tickets 01 and 06). Each test builds a small git repository in the temporary folder,
// with its own scripts/check-personal.hashes.json and scripts/check-personal.allow.json, and runs
// the guard on it with --root.
//
// Every personal-looking value here is invented, and it is built at run time from parts, so that this
// file itself carries none of them whole and the guard finds nothing in it: the words of the hash list
// are invented words with their hashes, the user name and the host are made up.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-personal.mjs')

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

// Invented values, one per rule; none of them is whole in this file.
const NAME = ['qw', 'yzzle'].join('')
const HOME = ['', 'Users', NAME, 'proj', 'notes.md'].join('/')
const HOST = [NAME, 'MacBook', 'Pro'].join('-')
const IP = ['100', '101', '7', '9'].join('.')
const EMAIL = [`zed.${NAME}`, 'mailbox.dev'].join('@')
const TOKEN = ['gh', 'p_', 'Ab3'.repeat(12)].join('')
const UUID = ['5f0c2a8e', '9b1d', '4c3e', 'a7f2', '6d8e1b4c9a02'].join('-')
// Invented words of the hash list: one word, two words, three words.
const WORD = ['zor', 'blax'].join('')
const PAIR = ['vex', 'moor'].join('-')
const TRIPLE = ['kel', 'dun', 'ra'].join('-')
// An invented Cyrillic word: the guard cuts words of any script.
const CYRILLIC = ['жмый', 'хорт'].join('')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

type Run = { status: number | null; stdout: string; stderr: string }

function run(args: readonly string[]): Run {
  const child = spawnSync(scriptNode(), [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

type Allow = { path: string; rule: string; sha256: string }

/**
 * A git repository with `files` tracked, the hash list of `words` (already in the joined form) and the
 * exceptions `allow`. A `{ link }` body makes a symbolic link to that target.
 */
function repo(files: Record<string, string | Buffer | { link: string }>, words: readonly string[] = [WORD, PAIR, TRIPLE], allow: readonly Allow[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'worfy-check-personal-'))
  dirs.push(root)
  const all: Record<string, string | Buffer | { link: string }> = {
    'scripts/check-personal.hashes.json': `${JSON.stringify({ sha256: words.map(sha), first: words.filter((w) => w.includes('-')).map((w) => sha(w.slice(0, w.indexOf('-'))).slice(0, 4)) }, null, 2)}\n`,
    'scripts/check-personal.allow.json': `${JSON.stringify({ allow }, null, 2)}\n`,
    ...files,
  }
  for (const [rel, body] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    if (typeof body === 'object' && 'link' in body) symlinkSync(body.link, join(root, rel))
    else writeFileSync(join(root, rel), body)
  }
  const empty = join(root, '.git-empty-config')
  writeFileSync(empty, '')
  const env = { ...process.env, GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1' }
  for (const args of [['init', '-q'], ['add', '--', ...Object.keys(all)]]) {
    const git = spawnSync('git', args, { cwd: root, encoding: 'utf8', env })
    expect(git.status, git.stderr).toBe(0)
  }
  return root
}

/** The finding lines of stdout: `<path>:<line>: <rule>: <mask>`. */
function findings(stdout: string): string[] {
  return stdout.split(/\r?\n/).filter((line) => /^[^\s].*:(\d+|name): [a-z-]+: /.test(line))
}

describe('check-personal: the rules of harness/lib/privacy.cjs', () => {
  it('finds each rule in a text with its line and a mask, and never prints the value', () => {
    const root = repo({
      'docs/notes.md': ['# Notes', `see ${HOME}`, `the machine ${HOST} answers`, `ping ${IP} now`, `mail ${EMAIL}`, `token ${TOKEN}`, `id ${UUID}`, ''].join('\n'),
    })
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    expect(findings(stdout)).toEqual([
      `docs/notes.md:2: home-path: qw…(${NAME.length})`,
      `docs/notes.md:3: host: qw…(${HOST.length})`,
      `docs/notes.md:4: tailscale-ip: 10…(${IP.length})`,
      `docs/notes.md:5: email: ze…(${EMAIL.length})`,
      `docs/notes.md:6: token: gh…(${TOKEN.length})`,
    ])
    for (const value of [NAME, HOST, IP, EMAIL, TOKEN]) expect(stdout).not.toContain(value)
  })

  it('leaves out the uuid rule: ids in fixtures are not personal', () => {
    const root = repo({ 'test/fixture.json': `{"id": "${UUID}"}\n` })
    const { status, stdout } = run(['--root', root])
    expect(findings(stdout)).toEqual([])
    expect(status).toBe(0)
  })

  it('finds a rule in a file name, and reads a binary file by its name only', () => {
    const binary = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]), Buffer.from(` ${EMAIL} `)])
    const root = repo({ [`docs/${HOST}.png`]: binary, 'docs/plain.png': binary })
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    // The path is printed with the value masked in it too.
    expect(findings(stdout)).toEqual([`docs/${mask(HOST)}.png:name: host: ${mask(HOST)}`])
    expect(stdout).not.toContain(HOST)
    expect(stdout).not.toContain(EMAIL)
  })

  it('takes a file for binary by either sign alone: a NUL byte without an image extension, an image extension without a NUL byte', () => {
    const text = `mail ${EMAIL}\n`
    const root = repo({
      'data/blob': Buffer.concat([Buffer.from('head\0'), Buffer.from(text)]),
      'docs/no-nul.png': text,
      'docs/plain.txt': text,
    })
    expect(findings(run(['--root', root]).stdout)).toEqual([`docs/plain.txt:1: email: ${mask(EMAIL)}`])
  })

  // Git on Windows checks a link out as a plain file unless core.symlinks is on.
  it.skipIf(process.platform === 'win32')('reads the target of a symbolic link as its text', () => {
    const root = repo({ 'docs/link.md': { link: HOME } })
    expect(findings(run(['--root', root]).stdout)).toEqual([`docs/link.md:1: home-path: ${mask(NAME)}`])
  })

  it('counts lines the same with CRLF line ends', () => {
    const root = repo({ 'docs/windows.md': ['one', 'two', `mail ${EMAIL}`, ''].join('\r\n') })
    expect(findings(run(['--root', root]).stdout)).toEqual([`docs/windows.md:3: email: ${mask(EMAIL)}`])
  })
})

/** The mask of privacy.mask for a value of four characters or more: the first two and the length. */
function mask(value: string): string {
  return `${value.slice(0, 2)}…(${value.length})`
}

describe('check-personal: stand-ins', () => {
  it('finds none of the stand-ins of fixtures: the invented host, example.ts.net hosts, the Tailscale DNS address and the invented Tailscale addresses, /Users/someone, the capture host and home of the Codex recordings', () => {
    const root = repo({
      'test/fixtures/hosts.md': [
        'host someones-mac answers',
        'host someones-mac.local answers',
        'host someones-MacBook-Pro answers',
        'host someones-PC answers',
        'host pc.example.ts.net answers',
        'dns 100.100.100.100',
        'peers 100.64.0.1 100.64.0.2 100.64.0.9 100.64.0.10',
        `home ${['', 'Users', 'someone', 'x'].join('/')}`,
        // The host and the home folder scripts/codex-capture.mjs writes into the Codex recordings.
        'host capture-host answers',
        `host ${['capture-host', 'local'].join('.')} answers`,
        `home ${['', 'home', 'owner', '.zshrc'].join('/')}`,
        '',
      ].join('\n'),
    })
    const { status, stdout } = run(['--root', root])
    expect(findings(stdout)).toEqual([])
    expect(status).toBe(0)
  })

  it('still finds a Tailscale address next to the stand-in ones', () => {
    const root = repo({ 'test/fixtures/peers.md': `peers 100.64.0.1 ${IP}\n` })
    expect(findings(run(['--root', root]).stdout)).toEqual([`test/fixtures/peers.md:1: tailscale-ip: ${mask(IP)}`])
  })

  it('finds the stand-in host name under a tailnet that is not an example one: only the whole value is a stand-in', () => {
    // An invented tailnet, built at run time so that this file carries no host whole.
    const onTailnet = ['someones-mac', 'tailzq7', 'ts', 'net'].join('.')
    const root = repo({ 'test/fixtures/peer.md': `peer ${onTailnet}\n` })
    const { status, stdout } = run(['--root', root])
    expect(findings(stdout)).toEqual([`test/fixtures/peer.md:1: host: ${mask(onTailnet)}`])
    expect(status).toBe(1)
  })
})

describe('check-personal: a property read of code is not a host', () => {
  it('finds no host in code that reads a .local property, and still finds a one-word host in prose, with a port and in a path', () => {
    const local = (name: string): string => [name, 'local'].join('.')
    const root = repo({
      'src/link.ts': [`if (${local('root')} !== true) send(${local('side')}, x)`, `f(${local('this.options')})`, `const a = ${local('opts')} ?? b`, ''].join('\n'),
      'docs/hosts.md': [`ssh ${local('studio')} to connect`, `open ${local('studio')}:52000 now`, `see /Volumes/x/${local('studio')}/file`, ''].join('\n'),
    })
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    const host = mask(local('studio'))
    expect(findings(stdout)).toEqual([`docs/hosts.md:1: host: ${host}`, `docs/hosts.md:2: host: ${host}`, `docs/hosts.md:3: host: ${host}`])
  })
})

describe('check-personal: the hash list of words', () => {
  it('finds a word, two neighbouring words and three neighbouring words in any case and with any separator', () => {
    const root = repo({
      'docs/a.md': ['Zorblax said hi', 'the Vex Moor plan', 'the vex_moor plan', 'the vex.moor plan', 'kel/dun/ra here', 'zorblaxes are not whole words', 'wrapped prose: Vex', 'Moor goes on', ''].join('\n'),
    })
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    expect(findings(stdout)).toEqual([
      // The mask is of the text as it stands, from the first word to the last.
      `docs/a.md:1: deny-word: ${mask('Zorblax')}`,
      `docs/a.md:2: deny-word: ${mask('Vex Moor')}`,
      `docs/a.md:3: deny-word: ${mask('vex_moor')}`,
      `docs/a.md:4: deny-word: ${mask('vex.moor')}`,
      `docs/a.md:5: deny-word: ${mask('kel/dun/ra')}`,
      // Neighbours on two lines: the line of the first word.
      `docs/a.md:7: deny-word: ${mask('Vex\nMoor')}`,
    ])
    expect(stdout).not.toMatch(/zorblax|vex.moor|kel.dun/i)
  })

  it('finds a word of any script: an invented Cyrillic word, in any case and in its decomposed form, and not inside a longer word', () => {
    const decomposed = CYRILLIC.toUpperCase().normalize('NFD')
    expect(decomposed).not.toBe(CYRILLIC.toUpperCase()) // its short i has a combining breve in NFD
    const root = repo({ 'docs/ru.md': [`сказал ${CYRILLIC} вчера`, `${CYRILLIC.toUpperCase()}!`, decomposed, `${CYRILLIC}ович не целое слово`, ''].join('\n') }, [CYRILLIC])
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    expect(findings(stdout)).toEqual([`docs/ru.md:1: deny-word: ${mask(CYRILLIC)}`, `docs/ru.md:2: deny-word: ${mask(CYRILLIC.toUpperCase())}`, `docs/ru.md:3: deny-word: ${mask(decomposed)}`])
    expect(stdout).not.toContain(CYRILLIC)
    expect(stdout.toLowerCase()).not.toContain(CYRILLIC)
  })

  it('finds a word of the list in a path', () => {
    const root = repo({ 'docs/Vex_Moor/plan.md': 'nothing here\n' })
    expect(findings(run(['--root', root]).stdout)).toEqual([`docs/${mask('Vex_Moor')}/plan.md:name: deny-word: ${mask('Vex_Moor')}`])
  })

  it('fails without its hash list', () => {
    const root = repo({ 'docs/a.md': 'x\n' })
    removeTestTree(join(root, 'scripts', 'check-personal.hashes.json'))
    const { status, stderr } = run(['--root', root])
    expect(status).toBe(2)
    expect(stderr).toContain('check-personal.hashes.json')
    // A list without the prefixes of first words would miss every entry of two or three words.
    writeFileSync(join(root, 'scripts', 'check-personal.hashes.json'), JSON.stringify({ sha256: [sha(PAIR)] }))
    const broken = run(['--root', root])
    expect(broken.status).toBe(2)
    expect(broken.stderr).toContain('"first"')
  })
})

describe('check-personal: exceptions', () => {
  it('an exception of path, rule and value hash drops that finding only', () => {
    const root = repo({ 'docs/a.md': `mail ${EMAIL}\n`, 'docs/b.md': `mail ${EMAIL}\n` }, [WORD], [{ path: 'docs/a.md', rule: 'email', sha256: sha(EMAIL) }])
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    expect(findings(stdout)).toEqual([`docs/b.md:1: email: ${mask(EMAIL)}`])
  })

  it('an exception for a word of the list takes the hash of the joined lower-case word', () => {
    const root = repo({ 'docs/a.md': 'the Vex Moor plan\n' }, [PAIR], [{ path: 'docs/a.md', rule: 'deny-word', sha256: sha(PAIR) }])
    const { status, stdout } = run(['--root', root])
    expect(findings(stdout)).toEqual([])
    expect(status).toBe(0)
  })

  it('names an exception no finding uses any more as a stale one, by path and rule, without a value', () => {
    const root = repo({ 'docs/a.md': 'clean now\n' }, [WORD], [{ path: 'docs/a.md', rule: 'email', sha256: sha(EMAIL) }])
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(1)
    expect(findings(stdout)).toEqual(['scripts/check-personal.allow.json:0: stale-allow: allow[0] (email)'])
    expect(stdout).not.toContain(sha(EMAIL))
  })
})

describe('check-personal: exit codes and the summary', () => {
  it('exits 0 on findings with --report and 1 without it; --report prints the counts only, --list adds the lines', () => {
    const root = repo({ 'docs/a.md': `mail ${EMAIL}\nZorblax\n`, 'test/b.md': `ping ${IP}\n`, 'README.md': 'the Vex Moor plan\n' })
    const report = run(['--report', '--root', root])
    const listed = run(['--report', '--list', '--root', root])
    const strict = run(['--root', root])
    expect(report.status).toBe(0)
    expect(listed.status).toBe(0)
    expect(strict.status).toBe(1)
    const summary = ['check-personal: 4 findings in 3 of 5 files', '  by rule: deny-word 2, email 1, tailscale-ip 1', '  by top folder: docs 2, (root) 1, test 1', ''].join('\n')
    expect(report.stdout).toBe(summary)
    expect(findings(strict.stdout)).toHaveLength(4)
    expect(strict.stdout.endsWith(summary)).toBe(true)
    expect(listed.stdout).toBe(strict.stdout)
  })

  it('exits 0 and says so on a clean tree', () => {
    const root = repo({ 'docs/a.md': 'nothing personal\n' })
    const { status, stdout } = run(['--root', root])
    expect(status).toBe(0)
    expect(stdout).toBe('check-personal: no findings in 3 files\n')
  })
})

describe('check-personal in pnpm lint', () => {
  it('pnpm lint runs the guard without --report, so a finding fails lint', () => {
    const lint = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: { lint: string } }).scripts.lint
    const steps = lint.split('&&').map((step) => step.trim())
    const guard = steps.filter((step) => step.includes('check-personal.mjs'))
    expect(guard).toEqual(['node scripts/check-personal.mjs'])
  })
})

describe('check-personal --hash-from', () => {
  function list(deny: readonly unknown[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-check-personal-list-'))
    dirs.push(dir)
    const file = join(dir, 'privacy.json')
    writeFileSync(file, JSON.stringify({ deny }))
    return file
  }

  it('prints the hashes only, of each entry cut and joined by the rule of the text, so an entry with ., _ or a space matches as with -', () => {
    const { status, stdout, stderr } = run(['--hash-from', list(['Vex.Moor', 'kel_dun ra', 'Zorblax'])])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    const printed = JSON.parse(stdout) as { sha256: string[] }
    expect(printed.sha256).toEqual([sha(PAIR), sha(TRIPLE), sha(WORD)].sort())
    expect(stdout).not.toMatch(/vex|moor|kel|zorblax/i)
    // The printed list, as the hash list of a repository, finds the entries written with -.
    const root = repo({ 'docs/a.md': 'vex-moor\nkel-dun-ra\nzorblax\n' }, [])
    writeFileSync(join(root, 'scripts', 'check-personal.hashes.json'), stdout)
    expect(findings(run(['--root', root]).stdout)).toEqual([
      `docs/a.md:1: deny-word: ${mask(PAIR)}`,
      `docs/a.md:2: deny-word: ${mask(TRIPLE)}`,
      `docs/a.md:3: deny-word: ${mask(WORD)}`,
    ])
  })

  it('turns entries with - and . and a Cyrillic entry into hashes that find them in the text, written with -, . or a space', () => {
    const dash = ['quill', 'fen'].join('-')
    const dot = ['brask', 'oy'].join('.')
    const { status, stdout, stderr } = run(['--hash-from', list([dash, dot, CYRILLIC])])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect((JSON.parse(stdout) as { sha256: string[] }).sha256).toEqual([sha(dash), sha(dot.replace('.', '-')), sha(CYRILLIC)].sort())
    const root = repo({ 'docs/a.md': [dash, dot, 'Quill Fen', 'brask-oy', CYRILLIC, ''].join('\n') }, [])
    writeFileSync(join(root, 'scripts', 'check-personal.hashes.json'), stdout)
    expect(findings(run(['--root', root]).stdout)).toEqual([
      `docs/a.md:1: deny-word: ${mask(dash)}`,
      `docs/a.md:2: deny-word: ${mask(dot)}`,
      `docs/a.md:3: deny-word: ${mask('Quill Fen')}`,
      `docs/a.md:4: deny-word: ${mask('brask-oy')}`,
      `docs/a.md:5: deny-word: ${mask(CYRILLIC)}`,
    ])
  })

  it('refuses an entry of four parts and an empty one with exit 1, naming the entry index and not its value', () => {
    const { status, stdout, stderr } = run(['--hash-from', list(['Zorblax', 'one two three quux', '...', ''])])
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('deny[1]: 4 words')
    expect(stderr).toContain('deny[2]: no words')
    expect(stderr).toContain('deny[3]: no words')
    expect(stderr).not.toMatch(/zorblax|quux/i)
  })

  it('refuses an entry that is not a string with exit 1 and its index', () => {
    const { status, stdout, stderr } = run(['--hash-from', list(['Zorblax', 42, { word: 'Zorblax' }])])
    expect(status).toBe(1)
    expect(stdout).toBe('')
    expect(stderr).toContain('deny[1]: not a string')
    expect(stderr).toContain('deny[2]: not a string')
    expect(stderr).not.toMatch(/zorblax/i)
  })

  it('a personal list that is not JSON fails with exit 2 and quotes none of it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-check-personal-list-'))
    dirs.push(dir)
    const file = join(dir, 'privacy.json')
    writeFileSync(file, '{"deny": ["Zorblax", oops]}')
    const { status, stdout, stderr } = run(['--hash-from', file])
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain('not valid JSON')
    expect(stderr).not.toMatch(/zorblax|oops/i)
  })
})
