// scripts/check-cyrillic.mjs: no Cyrillic in the code of src/, scripts/, test/ and harness/. It has
// two halves: an ESLint rule for the JS and TS files that `eslint .` reads, and a command for the
// files ESLint does not read — shell scripts, extensionless scripts and the Markdown of harness/.
// Comments are English everywhere. Cyrillic outside comments is allowed in test/fixtures/, in test
// files (the Russian input a test feeds a parser) and in the statement right after a comment that
// carries the marker of an old Russian token, which a reader still accepts for one release.
// The cases are small files in a temporary folder that stands for the repository root.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'check-cyrillic.mjs')
const MARKER = '// shortcut: accepts the old Russian token, remove after the next release'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** A temporary repository root with the given files in it. */
function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-check-cyrillic-')))
  dirs.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** `path:line` of every error the ESLint rule reports for the TS files of a root. */
async function eslintErrors(root: string): Promise<string[]> {
  // A computed specifier: the script is plain JavaScript without types.
  const { noCyrillic } = (await import(pathToFileURL(SCRIPT).href)) as { noCyrillic: unknown }
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { worfy: { rules: { 'no-cyrillic': noCyrillic } } } as never,
        rules: { 'worfy/no-cyrillic': 'error' },
      },
    ],
  })
  const results = await eslint.lintFiles(['.'])
  return results.flatMap((r) => r.messages.map((m) => `${r.filePath.slice(root.length + 1)}:${m.line}`)).sort()
}

/** Runs the command on a root; `pnpm test` runs under Electron as Node, so the child does too. */
function run(root: string): { status: number | null; lines: string[]; stderr: string } {
  const child = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  const lines = child.stderr
    .split('\n')
    .filter((l) => /^[^\s:]+:\d+: /.test(l))
    .map((l) => l.slice(0, l.indexOf(': ')))
    .sort()
  return { status: child.status, lines, stderr: child.stderr }
}

describe('the ESLint rule (JS and TS files)', () => {
  // The Cyrillic below is the data of the cases: the words the rule has to find or let through.
  const commented = '// Строка по-русски\nexport const a = 1\n'

  it('reports Cyrillic in a comment of src/', async () => {
    expect(await eslintErrors(tree({ 'src/a.ts': commented }))).toEqual(['src/a.ts:1'])
  })

  it('lets the same line through in test/fixtures/', async () => {
    expect(await eslintErrors(tree({ 'test/fixtures/a.ts': commented }))).toEqual([])
  })

  it('lets a data literal of a test through, not a comment of a test', async () => {
    const test = "// The parser has to read the Russian word of an old ticket header.\nexport const word = 'Выкачено'\n// по-русски\n"
    expect(await eslintErrors(tree({ 'test/unit/a.test.ts': test }))).toEqual(['test/unit/a.test.ts:3'])
  })

  it('reports a test name in Russian, as it reports a comment', async () => {
    const test = [
      "import { describe, it, test } from 'vitest'",
      "describe('разбор', () => {",
      "  it('reads the word', () => undefined)",
      "  it.each([['a']])('читает %s', () => undefined)",
      '  test(`шаг`, () => undefined)',
      "  it('reads ' + 'Выкачено', () => undefined)",
      '})',
      '',
    ].join('\n')
    expect(await eslintErrors(tree({ 'test/unit/b.test.ts': test }))).toEqual(['test/unit/b.test.ts:2', 'test/unit/b.test.ts:4', 'test/unit/b.test.ts:5'])
  })

  it('reports a string literal of src/', async () => {
    expect(await eslintErrors(tree({ 'src/b.ts': "export const title = 'ждёт тебя'\n" }))).toEqual(['src/b.ts:1'])
  })

  it('lets the marked statement through and reports the unmarked line after it', async () => {
    const marked = [
      MARKER,
      '// A reader of the release before writes these words.',
      'export const OLD = {',
      "  done: 'Выкачено',",
      "  blocked: 'заблокирован',",
      '}',
      "export const next = 'нет'",
      '',
    ].join('\n')
    expect(await eslintErrors(tree({ 'src/marked.ts': marked }))).toEqual(['src/marked.ts:7'])
  })

  it('does not let a comment through inside the marked statement', async () => {
    const marked = [MARKER, 'export const OLD = [', '  // старое слово', "  'зелено',", ']', ''].join('\n')
    expect(await eslintErrors(tree({ 'src/marked.ts': marked }))).toEqual(['src/marked.ts:3'])
  })

  it('a marked property covers that property alone', async () => {
    const marked = ['export const T = {', "  run: 'x',", `  ${MARKER}`, "  old: 'волна',", "  other: 'эпика',", '}', ''].join('\n')
    expect(await eslintErrors(tree({ 'src/t.ts': marked }))).toEqual(['src/t.ts:5'])
  })
})

describe('the command (files ESLint does not read)', () => {
  it('reports a Cyrillic comment of a shell script and exits 1', () => {
    const r = run(tree({ 'harness/hooks/a.sh': '#!/bin/bash\n# комментарий\necho ok\n' }))
    expect(r.lines).toEqual(['harness/hooks/a.sh:2'])
    expect(r.status).toBe(1)
  })

  it('exits 0 on a clean tree and on the same line in test/fixtures/', () => {
    const r = run(tree({ 'harness/hooks/a.sh': '#!/bin/bash\necho ok\n', 'test/fixtures/a.sh': '# комментарий\n' }))
    expect(r.lines).toEqual([])
    expect(r.status).toBe(0)
  })

  it('lets the data of a shell test through, not its comments', () => {
    const test = [
      '#!/bin/bash',
      '# The ticket header in Russian: the parser reads the old words.',
      "printf '%s\\n' 'Status: выкачено' # по-русски",
      '# по-русски',
      "grep -q '#не комментарий' \"$f\"",
      "cat <<'EOF'",
      '# строка данных, а не комментарий',
      'EOF',
      '',
    ].join('\n')
    expect(run(tree({ 'harness/bin/tests/a.test.sh': test })).lines).toEqual(['harness/bin/tests/a.test.sh:3', 'harness/bin/tests/a.test.sh:4'])
  })

  it('a marker covers the next command with its continuation lines, not the line after it', () => {
    const script = [
      '#!/bin/bash',
      '# shortcut: accepts the old Russian token, remove after the next release',
      '# The gate of the release before prints Russian words.',
      'if [ "$w" = "зелено" ] \\',
      '    || [ "$w" = "красно" ]; then echo old; fi',
      'echo "нет"',
      '',
    ].join('\n')
    expect(run(tree({ 'harness/hooks/b.sh': script })).lines).toEqual(['harness/hooks/b.sh:6'])
  })

  it('reads an extensionless Node script as JavaScript', () => {
    const script = "#!/usr/bin/env node\n// комментарий\nconst ok = 'ok'\n" + `${MARKER}\nconst OLD = /^(?:green|зелено)$/\nconsole.log(ok, OLD, 'нет')\n`
    expect(run(tree({ 'harness/bin/tool': script })).lines).toEqual(['harness/bin/tool:2', 'harness/bin/tool:6'])
  })

  it('reads an extensionless shell script line by line', () => {
    expect(run(tree({ 'harness/bin/tool': '#!/bin/zsh\n# комментарий\necho ok\n' })).lines).toEqual(['harness/bin/tool:2'])
  })

  it('Markdown of harness/: a marked paragraph and the placeholders of the profile pass, other text does not', () => {
    const md = [
      '# Skill',
      '',
      'The branch is `<ветка>`, the epic `<эпик>`: profile values name them so.',
      '',
      '<!-- shortcut: accepts the old Russian token, remove after the next release -->',
      'The old form of the command, "волна N эпика X",',
      'is read as well.',
      '',
      'Запусти волну.',
      '',
    ].join('\n')
    expect(run(tree({ 'harness/skills/x/SKILL.md': md })).lines).toEqual(['harness/skills/x/SKILL.md:9'])
  })

  it('Markdown of harness/: a YAML comment with the marker covers the front matter up to its closing line', () => {
    const md = [
      '---',
      'name: x',
      '# shortcut: accepts the old Russian token, remove after the next release',
      'description: Run a wave — "tickets NN of epic X", the older form "волна N эпика X".',
      '---',
      'Волна.',
      '',
    ].join('\n')
    expect(run(tree({ 'harness/skills/x/SKILL.md': md })).lines).toEqual(['harness/skills/x/SKILL.md:6'])
  })

  it('Markdown of harness/: a sentence that only names the marker covers nothing', () => {
    const md = ['The shims are marked `shortcut: accepts the old Russian token`.', 'Старое слово.', ''].join('\n')
    expect(run(tree({ 'harness/lib/README.md': md })).lines).toEqual(['harness/lib/README.md:2'])
  })

  it('leaves out JSON data and Markdown outside harness/', () => {
    const r = run(tree({ 'harness/lib/input-words.json': '{"statusDone": ["выкачено"]}\n', 'src/notes.md': 'По-русски.\n' }))
    expect(r.lines).toEqual([])
    expect(r.status).toBe(0)
  })
})
