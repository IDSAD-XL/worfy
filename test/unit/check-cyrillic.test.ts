// scripts/check-cyrillic.mjs: no Cyrillic in the code of src/, scripts/, test/ and harness/. It has
// two halves: an ESLint rule for the JS and TS files that `eslint .` reads, and a command for the
// files ESLint does not read — shell scripts, extensionless scripts and the Markdown of harness/.
// Comments are English everywhere. Cyrillic outside comments is allowed in test/fixtures/, in test
// files (the Russian input a test feeds a parser) and in the statement right after a comment that
// carries the marker of an old Russian token, which a reader still accepts for one release.
// In harness/ the words of a list (scripts/cyrillic-allow.json, or the file of --allow and the
// rule's harnessWords option) pass outside comments. The cases are small files in a temporary folder
// that stands for the repository root; one case lints a probe text through the repository's own
// eslint.config.js.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'check-cyrillic.mjs')
const MARKER = '// shortcut: accepts the old Russian token, remove after the next release'
// The allowed words of the cases, in place of scripts/cyrillic-allow.json: one of its placeholders
// and a word it does not have. The epic placeholder is in the repository's list and not here, so
// the cases report it.
const WORDS = ['<ветка>', '<проба>']

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

/** `path:line` of every error the ESLint rule reports for the JS, TS and TSX files of a root. */
async function eslintErrors(root: string): Promise<string[]> {
  // A computed specifier: the script is plain JavaScript without types.
  const { noCyrillic } = (await import(pathToFileURL(SCRIPT).href)) as { noCyrillic: unknown }
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,mjs}'],
        languageOptions: { parser: tseslint.parser },
        plugins: { worfy: { rules: { 'no-cyrillic': noCyrillic } } } as never,
        rules: { 'worfy/no-cyrillic': ['error', { harnessWords: WORDS }] },
      },
    ],
  })
  const results = await eslint.lintFiles(['.'])
  return results.flatMap((r) => r.messages.map((m) => `${r.filePath.slice(root.length + 1)}:${m.line}`)).sort()
}

/** Runs the command on a root; `pnpm test` runs under Electron as Node, so the child does too. */
function run(root: string, allowed: unknown = { harnessWords: WORDS }): { status: number | null; lines: string[]; stderr: string } {
  const allow = join(root, '..', `${root.split(/[\\/]/).pop()}.allow.json`)
  writeFileSync(allow, JSON.stringify(allowed))
  dirs.push(allow)
  const child = spawnSync(process.execPath, [SCRIPT, '--root', root, '--allow', allow], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
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
      // Accepted on purpose: a name built from literals is data, not a plain test name.
      "  it('reads ' + 'Выкачено', () => undefined)",
      '})',
      '',
    ].join('\n')
    expect(await eslintErrors(tree({ 'test/unit/b.test.ts': test }))).toEqual(['test/unit/b.test.ts:2', 'test/unit/b.test.ts:4', 'test/unit/b.test.ts:5'])
  })

  it('reports a Russian JSDoc block of a .ts file and a JSX comment of a .tsx file', async () => {
    const doc = '/**\n * Разбор строки.\n */\nexport const a = 1\n'
    const jsx = 'export const A = () => (\n  <div>\n    {/* подпись */}\n    ok\n  </div>\n)\n'
    expect(await eslintErrors(tree({ 'src/doc.ts': doc, 'src/renderer/A.tsx': jsx }))).toEqual(['src/doc.ts:1', 'src/renderer/A.tsx:3'])
  })

  it('a trailing marker covers its own line, not the statement after it', async () => {
    const code = `export const a = 'зелено' ${MARKER}\nexport const b = 'красно'\n`
    expect(await eslintErrors(tree({ 'src/trailing.ts': code }))).toEqual(['src/trailing.ts:2'])
  })

  it('the harnessWords option replaces the list: a word of the option passes, a word of the default list does not', async () => {
    const code = "export const a = 'git switch <проба>'\nexport const b = 'git switch <эпик>'\n"
    expect(await eslintErrors(tree({ 'harness/bin/y.mjs': code }))).toEqual(['harness/bin/y.mjs:2'])
  })

  it('lets the allowed words through in harness/ code, not in its comments and not outside harness/', async () => {
    const harness = "// the branch <ветка>\nexport const t = 'git switch <ветка>'\n"
    const src = "export const t = 'git switch <ветка>'\n"
    expect(await eslintErrors(tree({ 'harness/bin/x.mjs': harness, 'src/x.ts': src }))).toEqual(['harness/bin/x.mjs:1', 'src/x.ts:1'])
  })

  it('checks a src/ file whose name has "test" in it as code; tests/ folders and harness/evals/ are test data', async () => {
    const literal = "export const word = 'Выкачено'\n"
    const files = { 'src/main/testing.ts': literal, 'src/latest.ts': literal, 'harness/bin/tests/x.mjs': literal, 'harness/evals/case/a.mjs': literal }
    expect(await eslintErrors(tree(files))).toEqual(['src/latest.ts:1', 'src/main/testing.ts:1'])
  })

  it("the repository's eslint.config.js turns the rule on for src/", async () => {
    const eslint = new ESLint({ cwd: REPO })
    const [result] = await eslint.lintText('// Проба\nexport const a = 1\n', { filePath: join(REPO, 'src', 'zz-cyrillic-probe.ts') })
    expect((result?.messages ?? []).filter((m) => m.ruleId === 'worfy/no-cyrillic').map((m) => m.line)).toEqual([1])
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

  it('a # inside quotes starts no comment', () => {
    const test = ["echo 'a #не комментарий'", 'echo "a #не комментарий"', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/q.test.sh': test })).lines).toEqual([])
  })

  it('a heredoc with a dashed or a backslash-quoted delimiter ends at its delimiter', () => {
    const dashed = ['cat <<END-DOC', 'данные', 'END-DOC', '# комментарий', ''].join('\n')
    const quoted = ['cat <<\\EOF', 'данные', 'EOF', '# комментарий', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/d.test.sh': dashed, 'harness/bin/tests/q.test.sh': quoted })).lines).toEqual([
      'harness/bin/tests/d.test.sh:4',
      'harness/bin/tests/q.test.sh:4',
    ])
  })

  it('a << inside $(( … )) is a shift, not a heredoc', () => {
    const script = ['x=$(( a << b ))', '# комментарий', 'echo ok', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/shift.test.sh': script })).lines).toEqual(['harness/bin/tests/shift.test.sh:2'])
  })

  it('a here-string opens no heredoc', () => {
    const files = {
      'harness/bin/tests/a.test.sh': ['tr a b <<<hello', '# комм', ''].join('\n'),
      'harness/bin/tests/b.test.sh': ["tr a b <<< 'x'", '# комм', ''].join('\n'),
      'harness/bin/tests/c.test.sh': ['tr a b <<< "x"', '# комм', ''].join('\n'),
      'harness/hooks/d.sh': ['# shortcut: accepts the old Russian token, remove after the next release', 'tr a b <<<"зелено"', 'echo "нет"', ''].join('\n'),
    }
    expect(run(tree(files)).lines).toEqual(['harness/bin/tests/a.test.sh:2', 'harness/bin/tests/b.test.sh:2', 'harness/bin/tests/c.test.sh:2', 'harness/hooks/d.sh:3'])
  })

  it('a heredoc after a closed $(( … )) on the same line is a heredoc', () => {
    const script = ['x=$(( a << b )); cat <<EOF', '# данные', 'EOF', '# комм', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/s.test.sh': script })).lines).toEqual(['harness/bin/tests/s.test.sh:4'])
  })

  it('reads every heredoc a line opens, in order', () => {
    const script = ['cat <<A; cat <<B', '# данные A', 'A', '# данные B', 'B', '# комм', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/two.test.sh': script })).lines).toEqual(['harness/bin/tests/two.test.sh:6'])
  })

  it('a (( that is a nested subshell does not turn heredocs off for the lines after it', () => {
    const script = ['((cd a && make) || true)', 'cat <<EOF', '# данные', 'EOF', '# комм', ''].join('\n')
    expect(run(tree({ 'harness/bin/tests/sub.test.sh': script })).lines).toEqual(['harness/bin/tests/sub.test.sh:5'])
  })

  it('--allow replaces the list: a word of the file passes, a word of the default list does not', () => {
    const script = ['git switch "<проба>"', 'git switch "<эпик>"', ''].join('\n')
    expect(run(tree({ 'harness/hooks/allow.sh': script })).lines).toEqual(['harness/hooks/allow.sh:2'])
  })

  it('--allow with a malformed list exits non-zero and names the field', () => {
    const r = run(tree({ 'harness/hooks/ok.sh': 'echo ok\n' }), { harnessWords: 1 })
    expect(r.status).not.toBe(0)
    expect(r.status).not.toBe(1)
    expect(r.stderr).toContain('harnessWords')
  })

  it('a trailing marker covers its own command, not the next one', () => {
    const script = ['echo "зелено" # shortcut: accepts the old Russian token, remove after the next release', 'echo "нет"', ''].join('\n')
    expect(run(tree({ 'harness/hooks/t.sh': script })).lines).toEqual(['harness/hooks/t.sh:2'])
  })

  it('reads CRLF lines as LF lines', () => {
    const script = [
      '#!/bin/bash',
      '# комментарий',
      '# shortcut: accepts the old Russian token, remove after the next release',
      'if [ "$w" = "зелено" ] \\',
      '    || [ "$w" = "красно" ]; then :; fi',
      'echo "нет"',
      '',
    ].join('\r\n')
    expect(run(tree({ 'harness/hooks/crlf.sh': script })).lines).toEqual(['harness/hooks/crlf.sh:2', 'harness/hooks/crlf.sh:6'])
  })

  it('allowed words pass in harness/ code, not in its comments and not outside harness/', () => {
    const harness = ['# the branch <ветка>', 'git switch "<ветка>"', ''].join('\n')
    const scripts = ['echo "<ветка>"', ''].join('\n')
    expect(run(tree({ 'harness/hooks/w.sh': harness, 'scripts/w.sh': scripts })).lines).toEqual(['harness/hooks/w.sh:1', 'scripts/w.sh:1'])
  })

  it('harness/evals/ and a tests/ folder hold test data', () => {
    const data = "echo 'Привет'\n"
    expect(run(tree({ 'harness/evals/case/scaffold.sh': data, 'harness/hooks/tests/helper.sh': data })).lines).toEqual([])
  })

  it('reports Cyrillic in CSS and lets clean HTML through', () => {
    const r = run(tree({ 'src/renderer/a.css': '/* комментарий */\n.a { color: red; }\n', 'src/renderer/b.html': '<p>ok</p>\n' }))
    expect(r.lines).toEqual(['src/renderer/a.css:1'])
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
      'The branch is `<ветка>`, the probe `<проба>`: the allowed words.',
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

  it('Markdown of harness/: a marked paragraph covers its later lines too', () => {
    const md = ['<!-- shortcut: accepts the old Russian token, remove after the next release -->', 'The old form is read as well:', '"волна N эпика X".', '', 'Волна.', ''].join('\n')
    expect(run(tree({ 'harness/skills/x/SKILL.md': md })).lines).toEqual(['harness/skills/x/SKILL.md:5'])
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
