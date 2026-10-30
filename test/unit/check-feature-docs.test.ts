// scripts/check-feature-docs.mjs: the path check of `pnpm lint`. It reads the English Feature pages
// docs/features/*.md in the form of their index (docs/features/README.md, section "Form of paths") and
// fails only on a path that does not exist. The repositories are temporary folders written by each test.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-feature-docs.mjs')
const PAGE = 'docs/features/page.md'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** A temporary repository root with these files; the file src/real.ts is always there. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'worfy-check-feature-docs-'))
  dirs.push(root)
  for (const [path, text] of Object.entries({ 'src/real.ts': 'export {}\n', ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** Runs the script on a repository root, under the real node (test/script-node.ts). */
function run(root: string): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(scriptNode(), [SCRIPT, root], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  return { status: child.status, stdout: child.stdout, stderr: child.stderr }
}

/** Runs the script on one page with this body; its heading is line 1, the body starts on line 3. */
function page(...body: string[]): { status: number | null; stdout: string; stderr: string } {
  return run(repository({ [PAGE]: ['# Page', '', ...body, ''].join('\n') }))
}

/** The address of a missing path on line `line` of the page. */
const missing = (line: number, path: string): string => `${PAGE}:${line}: ${path} does not exist\n`

describe('check-feature-docs: inline code', () => {
  it('passes a path that exists and prints one line', () => {
    const { status, stdout, stderr } = page('The module is `src/real.ts`, in the folder `src/` too.')
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('feature docs: ok (1 page, 2 paths)\n')
  })

  it('fails a path that does not exist, with the file and the line', () => {
    const { status, stdout, stderr } = page('First line.', 'The module is `src/gone.ts`.')
    expect(status).toBe(1)
    expect(stderr).toBe(missing(4, 'src/gone.ts'))
    expect(stdout).toBe('')
  })

  it.each(['src/', 'test/', 'scripts/', 'harness/', 'docs/', 'build/', '.github/'])('reads a path that starts with %s', (prefix) => {
    const { status, stderr } = page(`See \`${prefix}gone.txt\`.`)
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, `${prefix}gone.txt`))
  })

  it('does not read code that starts with anything else, or code with a space', () => {
    const { status, stderr } = page('`lib/gone.ts`, `./src/gone.ts`, `gone.ts`, `src/gone.ts --flag`, `pnpm test src/gone.ts`, `xsrc/gone.ts`.')
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('reads the path from the repository root, not from the folder of the page', () => {
    const root = repository({ [PAGE]: '# Page\n\n`docs/near.md`\n', 'docs/features/docs/near.md': 'near\n' })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, 'docs/near.md'))
  })

  it('drops the suffix :<number> of a path that exists and of one that does not', () => {
    expect(page('`src/real.ts:12`').status).toBe(0)
    const { status, stderr } = page('`src/gone.ts:12`')
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, 'src/gone.ts'))
  })

  it('keeps a suffix that is not a number as part of the path', () => {
    const { status, stderr } = page('`src/real.ts:name`')
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, 'src/real.ts:name'))
  })

  it.each(['src/<name>.ts', 'src/gone>.ts', 'src/*.ts', 'src/{a,b}.ts'])('skips the template %s', (token) => {
    const { status, stdout, stderr } = page(`\`${token}\``)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('feature docs: ok (1 page, 0 paths)\n')
  })

  it('reads a span of two backticks, and an unmatched backtick does not swallow the next span', () => {
    expect(page('``src/gone.ts``').stderr).toBe(missing(3, 'src/gone.ts'))
    expect(page('A stray ` here.', '', '`src/gone.ts`').stderr).toBe(missing(5, 'src/gone.ts'))
    expect(page('An escaped \\` here and `src/gone.ts`.').stderr).toBe(missing(3, 'src/gone.ts'))
  })
})

describe('check-feature-docs: links', () => {
  it('reads a relative link from the folder of the page', () => {
    const root = repository({ [PAGE]: '# Page\n\n[near](near.md), [up](../up.md), [code](../../src/real.ts)\n', 'docs/features/near.md': 'x\n', 'docs/up.md': 'x\n' })
    const { status, stdout, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('feature docs: ok (2 pages, 3 paths)\n')
  })

  it('fails a link written from the repository root: it is read from the folder of the page', () => {
    const { status, stderr } = page('[code](src/real.ts)')
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, 'src/real.ts'))
  })

  it('does not count an external address or an anchor on the same page', () => {
    const { status, stderr } = page('[a](https://example.com/gone.md), [b](http://example.com), [c](mailto:me@example.com), [d](//example.com/x), [e](#a-section)')
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('drops the part after # and the query, and the suffix :<number>', () => {
    expect(page('[a](../../src/real.ts#L1), [b](../../src/real.ts?plain=1), [c](../../src/real.ts:3)').status).toBe(0)
    expect(page('[a](gone.md#a-section)').stderr).toBe(missing(3, 'gone.md'))
  })

  it('reads a title, angle brackets, percent-encoding, an image and a reference definition', () => {
    const root = repository({
      [PAGE]: '# Page\n\n[a](two%20words.md), [b](<two words.md>), [c](two%20words.md "A title"), ![d](gone.png)\n\n[e]: gone-too.md\n[f]: https://example.com/gone.md\n',
      'docs/features/two words.md': 'x\n',
    })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toBe(`${missing(3, 'gone.png')}${missing(5, 'gone-too.md')}`)
  })

  it('reads the link around inline code, and does not read a link inside inline code', () => {
    expect(page('[`src/real.ts`](gone.md)').stderr).toBe(missing(3, 'gone.md'))
    const inside = page('`[a](gone.md)`')
    expect(inside.stderr).toBe('')
    expect(inside.status).toBe(0)
  })

  it('fails a link that leaves the repository', () => {
    const root = repository({ 'repo/src/real.ts': 'x\n', [`repo/${PAGE}`]: '# Page\n\n[a](../../../outside.md)\n', 'outside.md': 'x\n' })
    const { status, stderr } = run(join(root, 'repo'))
    expect(status).toBe(1)
    expect(stderr).toBe(missing(3, '../../../outside.md'))
  })

  it('skips a template in a link', () => {
    expect(page('[a](<page>.md), [b](*.md)').status).toBe(0)
  })
})

describe('check-feature-docs: which text it reads', () => {
  it('does not read fenced blocks of backticks or of tildes, a longer fence holding a shorter one', () => {
    const { status, stderr } = page(
      '```markdown',
      '`src/gone.ts` [a](gone.md)',
      '```',
      '~~~',
      '`src/gone.ts`',
      '~~~',
      '````',
      '```',
      '`src/gone.ts`',
      '```',
      '`src/gone.ts`',
      '````',
      '  ```',
      '  `src/gone.ts`',
      '  ```',
    )
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('reads the text after a fenced block, on its own line', () => {
    expect(page('```', 'code', '```', '`src/gone.ts`').stderr).toBe(missing(6, 'src/gone.ts'))
  })

  it('does not take a line of inline code for a fence', () => {
    expect(page('``` `src/gone.ts` ```', '', '`src/gone.ts`').stderr).toBe(missing(5, 'src/gone.ts'))
  })

  it('does not read the Russian files', () => {
    const root = repository({ [PAGE]: '# Page\n', 'docs/features/ru/page.md': '# Page\n\n`src/gone.ts` [a](gone.md)\n' })
    const { status, stderr } = run(root)
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('passes a page that is not written yet', () => {
    const { status, stderr } = run(repository({ [PAGE]: '# Page\n\nThis page is not written yet.\n' }))
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('counts lines the same with CRLF line ends, and the suffix still drops', () => {
    const { status, stderr } = run(repository({ [PAGE]: '# Page\r\n\r\n`src/real.ts:3`\r\n`src/gone.ts`\r\n[a](gone.md)\r\n' }))
    expect(status).toBe(1)
    expect(stderr).toBe(`${missing(4, 'src/gone.ts')}${missing(5, 'gone.md')}`)
  })

  it('names every missing path of every page in document order', () => {
    const root = repository({ 'docs/features/a.md': '# A\n\n[a](gone-a.md)\n\n`src/gone-a.ts`\n', 'docs/features/b.md': '# B\n\n`src/gone-b.ts`\n' })
    const { status, stderr } = run(root)
    expect(status).toBe(1)
    expect(stderr).toBe('docs/features/a.md:3: gone-a.md does not exist\ndocs/features/a.md:5: src/gone-a.ts does not exist\ndocs/features/b.md:3: src/gone-b.ts does not exist\n')
  })

  it('exits 2 when the folder of pages cannot be read', () => {
    const { status, stderr } = run(repository({}))
    expect(status).toBe(2)
    expect(stderr).toContain('docs/features: cannot be read')
  })
})

describe('pnpm lint', () => {
  it('runs the path check and leaves the translation report out', () => {
    const lint = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { scripts: { lint: string } }).scripts.lint
    expect(lint).toContain('node scripts/check-feature-docs.mjs')
    expect(lint).not.toContain('feature-docs-lag')
  })
})
