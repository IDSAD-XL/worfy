// What a Product Session may do with its tools (worfy-product-session ticket 02,
// src/main/agent/product-guard.ts): file tools write only below the Product Session folder, the shell
// is refused the known commands that write to the repository or to Tickets, every other tool is
// allowed, and whatever the guard cannot judge is refused. The paths of this machine run against the
// real file system (links included); the Windows paths run on every machine against a file system of
// the test that ignores case, as an NTFS disk does.
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FileSystem } from '../../src/main/agent/auto-approve/roots'
import { productToolDecision, refusedCommand, type ProductGuardPlace } from '../../src/main/agent/product-guard'
import { removeTestTree } from '../remove'

const allowed = { allow: true }
const refused = expect.objectContaining({ allow: false, reason: expect.any(String) as unknown })

describe('file tools of a Product Session on the file system of this machine', () => {
  let top: string
  let root: string
  let product: string
  let place: ProductGuardPlace
  const host = process.platform
  const write = (file_path: unknown, tool = 'Write', at: ProductGuardPlace = place) => productToolDecision(tool, { file_path, content: 'x' }, at, host)

  beforeAll(() => {
    top = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-product-guard-')))
    root = join(top, 'project')
    product = join(root, 'docs', 'product')
    mkdirSync(join(product, 'x'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    mkdirSync(join(top, 'outside'), { recursive: true })
    writeFileSync(join(product, 'x', 'map.md'), '# map\n')
    // A link from docs/product out of it (a junction on Windows: no rights needed).
    symlinkSync(join(top, 'outside'), join(product, 'out'), host === 'win32' ? 'junction' : 'dir')
    symlinkSync(join(product, 'x'), join(product, 'same'), host === 'win32' ? 'junction' : 'dir')
    place = { productDir: product, cwd: root }
  })

  afterAll(() => removeTestTree(top))

  it('allows a file below docs/product/, written absolute or relative to the cwd, existing or new', () => {
    expect(write(join(product, 'x', 'map.md'))).toEqual(allowed)
    expect(write('docs/product/x/map.md')).toEqual(allowed)
    expect(write(join(product, 'new-topic', 'drafts', 'epic.md'))).toEqual(allowed)
    expect(productToolDecision('Edit', { file_path: join(product, 'x', 'map.md'), old_string: 'a', new_string: 'b' }, place, host)).toEqual(allowed)
    expect(productToolDecision('MultiEdit', { file_path: join(product, 'x', 'map.md'), edits: [] }, place, host)).toEqual(allowed)
    expect(productToolDecision('NotebookEdit', { notebook_path: join(product, 'x', 'n.ipynb'), new_source: '' }, place, host)).toEqual(allowed)
    // A link that stays inside the folder leads inside.
    expect(write(join(product, 'same', 'map.md'))).toEqual(allowed)
  })

  it('reads a relative path against the folder of the call, not the Session cwd', () => {
    expect(write('map.md', 'Write', { productDir: product, cwd: join(product, 'x') })).toEqual(allowed)
    expect(write('map.md', 'Write', { productDir: product, cwd: join(root, 'src') })).toEqual(refused)
  })

  it('refuses src/a.ts, docs/adr/0001.md and the Project root files, with a reason that names the folder', () => {
    const decision = write(join(root, 'src', 'a.ts'))
    expect(decision).toEqual(refused)
    expect(decision.allow ? '' : decision.reason).toContain(product)
    expect(write(join(root, 'docs', 'adr', '0001.md'))).toEqual(refused)
    expect(write('src/a.ts')).toEqual(refused)
    expect(write(join(root, 'HANDOFF.md'))).toEqual(refused)
    expect(productToolDecision('Edit', { file_path: join(root, 'src', 'a.ts') }, place, host)).toEqual(refused)
    expect(productToolDecision('MultiEdit', { file_path: join(root, 'src', 'a.ts') }, place, host)).toEqual(refused)
    expect(productToolDecision('NotebookEdit', { notebook_path: join(root, 'n.ipynb') }, place, host)).toEqual(refused)
  })

  it('refuses docs/product/../src/a.ts and a folder whose name only starts like docs/product', () => {
    expect(write(join(product, '..', '..', 'src', 'a.ts'))).toEqual(refused)
    expect(write(`${product}/../../src/a.ts`)).toEqual(refused)
    expect(write('docs/product/../src/a.ts')).toEqual(refused)
    expect(write(`${product}-old/x.md`)).toEqual(refused)
    // The folder itself is no file to write.
    expect(write(product)).toEqual(refused)
  })

  it('refuses a path through a link from docs/product/ out of it', () => {
    const decision = write(join(product, 'out', 'a.md'))
    expect(decision).toEqual(refused)
    expect(decision.allow ? '' : decision.reason).toContain(join(top, 'outside'))
    expect(write(join(product, 'out'))).toEqual(refused)
  })

  it('refuses a `..` after a missing folder: where it leads cannot be told', () => {
    // Lexically below the folder; the system cannot walk `missing/..`.
    expect(write(`${product}/missing/../x.md`)).toEqual(refused)
  })

  it.skipIf(host === 'win32')('refuses a link that leads nowhere: the write would follow it out', () => {
    symlinkSync(join(top, 'outside', 'not-yet.md'), join(product, 'x', 'dangling.md'))
    expect(write(join(product, 'x', 'dangling.md'))).toEqual(refused)
  })

  it('refuses docs/product/ written in another case (a disk that does not ignore case has another folder there)', () => {
    expect(write(join(root, 'DOCS', 'PRODUCT', 'x.md'))).toEqual(refused)
    expect(write(join(root, 'docs', 'Product', 'x.md'))).toEqual(refused)
  })

  it('allows a file of a folder not made yet (a first topic), judged by the nearest existing folder', () => {
    const fresh = join(top, 'fresh')
    mkdirSync(fresh)
    const at = { productDir: join(fresh, 'docs', 'product'), cwd: fresh }
    expect(write(join(fresh, 'docs', 'product', 'topic', 'map.md'), 'Write', at)).toEqual(allowed)
    expect(write(join(fresh, 'docs', 'a.md'), 'Write', at)).toEqual(refused)
  })

  it('in Silent mode allows <Workflow folder>/product/ only, not the repository', () => {
    const workflow = join(top, 'workflow')
    const at = { productDir: join(workflow, 'product'), cwd: root }
    expect(write(join(workflow, 'product', 'topic', 'map.md'), 'Write', at)).toEqual(allowed)
    expect(write(join(product, 'x', 'map.md'), 'Write', at)).toEqual(refused)
  })

  it('fails closed: no folder, no path, a path of another type, input that is no object', () => {
    expect(write(join(product, 'x', 'map.md'), 'Write', { productDir: null, cwd: root })).toEqual(refused)
    expect(write(undefined)).toEqual(refused)
    expect(write('')).toEqual(refused)
    expect(write(42)).toEqual(refused)
    expect(productToolDecision('Write', null, place, host)).toEqual(refused)
    expect(productToolDecision('Write', 'docs/product/x.md', place, host)).toEqual(refused)
    // A relative path with no folder to read it against.
    expect(write('docs/product/x.md', 'Write', { productDir: product, cwd: null })).toEqual(refused)
  })

  it('fails closed when the file system cannot answer or the guard itself throws', () => {
    const failing: FileSystem = { lstat: () => 'error', realpath: () => null, readdir: () => null, readFile: () => null }
    expect(productToolDecision('Write', { file_path: join(product, 'x', 'map.md') }, place, host, failing)).toEqual(refused)
    const throwing: FileSystem = { ...failing, lstat: () => { throw new Error('disk gone') } }
    const decision = productToolDecision('Write', { file_path: join(product, 'x', 'map.md') }, place, host, throwing)
    expect(decision).toEqual(refused)
    expect(decision.allow ? '' : decision.reason).toContain('disk gone')
    const unreal: FileSystem = { ...failing, lstat: () => 'dir', realpath: () => null }
    expect(productToolDecision('Write', { file_path: join(product, 'x', 'map.md') }, place, host, unreal)).toEqual(refused)
  })
})

/**
 * A Windows disk of the test: the folders and links of `entries` by their own spelling, found in any case
 * and answered in that spelling, as realpath.native answers on NTFS. Windows folds `..` before it walks a
 * path, so the disk does too.
 */
function windowsDisk(entries: Record<string, 'dir' | { link: string }>): FileSystem {
  const byKey = new Map(Object.entries(entries).map(([path, entry]) => [path.toLowerCase(), { path, entry }]))
  const parts = (path: string): string[] => {
    const out: string[] = []
    for (const part of path.split('\\')) {
      if (part === '..') out.pop()
      else if (part !== '.' && part !== '') out.push(part)
    }
    return out
  }
  const at = (folder: string, name: string): string => (folder.endsWith('\\') ? `${folder}${name}` : `${folder}\\${name}`)
  /** The real spelling of the folder `names` lead to, links followed; null when one is missing. */
  const walk = (names: readonly string[]): string | null => {
    let real: string | null = null
    for (const name of names) {
      const found = byKey.get((real === null ? `${name}\\` : at(real, name)).toLowerCase())
      if (found === undefined) return null
      real = typeof found.entry === 'object' ? found.entry.link : found.path
    }
    return real
  }
  return {
    lstat: (path) => {
      const names = parts(path)
      if (names.length <= 1) return walk(names) === null ? null : 'dir'
      const folder = walk(names.slice(0, -1))
      const found = folder === null ? undefined : byKey.get(at(folder, names.at(-1) ?? '').toLowerCase())
      if (found === undefined) return null
      return typeof found.entry === 'object' ? 'link' : 'dir'
    },
    realpath: (path) => walk(parts(path)),
    readdir: () => null,
    readFile: () => null,
  }
}

describe('file tools of a Product Session on Windows (win32: `\\` and `/`, drive letters, case, junctions)', () => {
  const disk = windowsDisk({
    'C:\\': 'dir',
    'C:\\Work': 'dir',
    'C:\\Work\\proj': 'dir',
    'C:\\Work\\proj\\src': 'dir',
    'C:\\Work\\proj\\docs': 'dir',
    'C:\\Work\\proj\\docs\\product': 'dir',
    'C:\\Work\\proj\\docs\\product\\x': 'dir',
    'C:\\Work\\proj\\docs\\product\\out': { link: 'C:\\Elsewhere' },
    'C:\\Elsewhere': 'dir',
    'C:\\Users': 'dir',
    'C:\\Users\\RUNNER~1': 'dir',
    'C:\\Users\\RUNNER~1\\proj': 'dir',
  })
  const place: ProductGuardPlace = { productDir: 'C:\\Work\\proj\\docs\\product', cwd: 'C:\\Work\\proj' }
  const write = (file_path: string, at: ProductGuardPlace = place) => productToolDecision('Write', { file_path, content: 'x' }, at, 'win32', disk)

  it('allows docs\\product\\ written with `\\`, with `/`, with a lower-case drive letter, in Git Bash form and relative', () => {
    expect(write('C:\\Work\\proj\\docs\\product\\x\\map.md')).toEqual(allowed)
    expect(write('C:/Work/proj/docs/product/x/map.md')).toEqual(allowed)
    expect(write('c:\\Work\\proj\\docs\\product\\x\\map.md')).toEqual(allowed)
    expect(write('/c/Work/proj/docs/product/x/map.md')).toEqual(allowed)
    expect(write('docs\\product\\new\\map.md')).toEqual(allowed)
    expect(write('docs/product/new/map.md')).toEqual(allowed)
  })

  it('refuses DOCS\\PRODUCT\\x.md and C:/… in another case', () => {
    expect(write('DOCS\\PRODUCT\\x.md')).toEqual(refused)
    expect(write('C:\\Work\\proj\\DOCS\\PRODUCT\\x.md')).toEqual(refused)
    expect(write('C:/work/PROJ/docs/product/x.md')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\Product\\x\\map.md')).toEqual(refused)
  })

  it('refuses src, `..` out of the folder, a junction out of it, another drive and a UNC path', () => {
    expect(write('C:\\Work\\proj\\src\\a.ts')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\product\\..\\..\\src\\a.ts')).toEqual(refused)
    expect(write('docs\\product\\..\\src\\a.ts')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\product\\out\\a.md')).toEqual(refused)
    expect(write('D:\\Work\\proj\\docs\\product\\x.md')).toEqual(refused)
    expect(write('\\\\server\\share\\docs\\product\\x.md')).toEqual(refused)
  })

  it('refuses a name Windows rewrites: a stream, a trailing dot or space, an 8.3 short name', () => {
    expect(write('C:\\Work\\proj\\docs\\product\\x\\map.md:hidden')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\product\\x.')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\product\\x \\map.md')).toEqual(refused)
    expect(write('C:\\Work\\proj\\docs\\product\\TOPIC~1\\map.md')).toEqual(refused)
  })

  it('keeps an 8.3 name above the folder (a runner temporary folder) as it is', () => {
    const at = { productDir: 'C:\\Users\\RUNNER~1\\proj\\docs\\product', cwd: 'C:\\Users\\RUNNER~1\\proj' }
    expect(write('C:\\Users\\RUNNER~1\\proj\\docs\\product\\t\\map.md', at)).toEqual(allowed)
    expect(write('docs\\product\\t\\map.md', at)).toEqual(allowed)
    expect(write('C:\\Users\\RUNNER~1\\proj\\src\\a.ts', at)).toEqual(refused)
  })
})

describe('the shell of a Product Session', () => {
  const bash = (command: unknown) => productToolDecision('Bash', { command }, { productDir: '/p/docs/product', cwd: '/p' }, 'darwin')

  it.each([
    ['bin/ticket done', 'bin/ticket'],
    ['/Users/me/.claude/worfy-harness/plugin/bin/ticket done .scratch/e/issues/01-x.md', 'bin/ticket'],
    ["node 'C:\\h\\bin\\ticket.mjs' claim x", 'bin/ticket'],
    ['node /h/bin/ticket.mjs claim x', 'bin/ticket'],
    ['ticket claim x', 'bin/ticket'],
    ['git commit -m x', 'git commit'],
    ['git push', 'git push'],
    ['git merge main', 'git merge'],
    ['git rebase origin/main', 'git rebase'],
    ['git reset --hard', 'git reset'],
    ['git add docs/product', 'git add'],
    ['git -C /p -c user.name=x commit -m y', 'git commit'],
    ['cd /p && git commit -am x', 'git commit'],
    ['git status; git push origin HEAD', 'git push'],
    ['bash -c "git push"', 'git push'],
    ['echo $(git commit -m x)', 'git commit'],
    ['GIT_EDITOR=true git merge x', 'git merge'],
    ['timeout 10 git push', 'git push'],
    ['sudo -E pnpm install', 'pnpm'],
    ['gh pr merge 1', 'gh pr merge'],
    ['gh pr create --fill', 'gh pr create'],
    ['gh -R owner/repo pr merge 1 --squash', 'gh pr merge'],
    ['pnpm test', 'pnpm'],
    ['FOO=1 npm run build', 'npm'],
    ['/usr/local/bin/pnpm i', 'pnpm'],
    ["'C:\\tools\\PNPM.CMD' test", 'pnpm'],
    ['npx pnpm test', 'pnpm'],
    ['if true; then git push; fi', 'git push'],
    // Quoted values before the subcommand, a quoted subcommand, a backslash-newline (review of PR #1626).
    ['git -C "/p a/repo" commit -m x', 'git commit'],
    ["git -c 'user.name=a' commit", 'git commit'],
    ['git --git-dir="x" reset --hard', 'git reset'],
    ['git "commit" -m x', 'git commit'],
    ['"git" push', 'git push'],
    ['git \\\ncommit -m x', 'git commit'],
    ['git \\\r\n  push', 'git push'],
    ['g\\it push', 'git push'],
    ["sh -c 'git push'", 'git push'],
    ['zsh -c "bash -c \'npm i\'"', 'npm'],
    ['eval "git commit -m x"', 'git commit'],
    ['echo `pnpm i`', 'pnpm'],
    ['echo "$(gh pr merge 1)"', 'gh pr merge'],
    ['x=$(cd /p && git push)', 'git push'],
    ['pwsh -Command "git push"', 'git push'],
    [`${'eval '.repeat(12)}git log`, 'a command nested too deep to read'],
  ])('refuses %s', (command, name) => {
    expect(refusedCommand(command)).toBe(name)
    const decision = bash(command)
    expect(decision).toEqual(refused)
    expect(decision.allow ? '' : decision.reason).toContain(name)
  })

  it.each([
    'git log --oneline -5',
    'git log --grep=commit',
    'git status',
    'git diff main...HEAD',
    'gh pr view 1',
    'gh pr checks 1',
    'gh run view 2 --log-failed',
    'epic-status worfy-product-session',
    '/Users/me/.claude/worfy-harness/plugin/bin/epic-status x',
    'grep -n pnpm package.json',
    'cat README.md | head',
    'ls docs/product',
    // A word in quotes is an argument, not a command (review of PR #1626).
    'grep -rn "pnpm" docs/',
    'rg "git commit" docs/',
    "grep -n 'gh pr merge' notes.md",
    'echo "npm and pnpm are package managers"',
    'git log --grep "git push"',
    'grep -rn bin/ticket docs/',
    'git log # then git push',
    'ls # ; git push',
    "bash -c 'git log'",
    'eval eval git status',
  ])('allows %s', (command) => {
    expect(refusedCommand(command)).toBeNull()
    expect(bash(command)).toEqual(allowed)
  })

  it('judges PowerShell by its own quoting: `\\` is a path separator, the backtick escapes', () => {
    const ps = (command: string) => productToolDecision('PowerShell', { command }, { productDir: null, cwd: null }, 'win32')
    expect(ps('git push')).toEqual(refused)
    expect(ps('C:\\tools\\PNPM.CMD test')).toEqual(refused)
    expect(ps('node C:\\h\\bin\\ticket.mjs claim x')).toEqual(refused)
    expect(ps('git `\ncommit -m x')).toEqual(refused)
    expect(ps('Select-String -Pattern "git push" notes.md')).toEqual(allowed)
    expect(ps('git log')).toEqual(allowed)
  })

  it('fails closed on a command that is not text', () => {
    expect(bash(undefined)).toEqual(refused)
    expect(bash(['git', 'log'])).toEqual(refused)
    expect(productToolDecision('Bash', null, { productDir: null, cwd: null }, 'darwin')).toEqual(refused)
  })
})

describe('the other tools of a Product Session', () => {
  it.each(['Read', 'Glob', 'Grep', 'WebFetch', 'Task', 'TodoWrite', 'mcp__worfy-canvas__create_note'])('allows %s', (tool) => {
    expect(productToolDecision(tool, { file_path: '/p/src/a.ts' }, { productDir: null, cwd: null }, 'darwin')).toEqual(allowed)
  })
})
