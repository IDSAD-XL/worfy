// The pure reading of git's output for the Changes screen (src/shared/changes/parse.ts; worfy-changes-view
// ticket 02): what the screen gets out of a list of files and a patch — renames, binary files, «\ No newline at
// end of file», CRLF lines, paths with spaces and letters outside ASCII, and the patches that come folded. The
// outputs are written as git 2.50 printed them with `-z` and `core.quotePath=false`.
import { describe, expect, it } from 'vitest'
import { foldOf, isLockFile, isRepoPath, isWorkflowPath, parseCommits, patchOfPath, parseDiffList, parseGenerated, parseNumstat, parsePatch, unquotePath, FOLD_LINES } from '../../src/shared/changes/parse'

const z = (...fields: string[]): string => `${fields.join('\0')}\0`
const OLD = '0ff3bbb9c8bba2291654cd64067fa417ff54c508'
const NEW = 'd4de868f166881c4b312015004db3d4c27b0adce'

describe('the list of files (diff --raw --numstat -z)', () => {
  it('reads a rename to a path with a space and a letter outside ASCII, with its counts and blobs', () => {
    const output = z(`:100644 100644 ${OLD} ${NEW} R094`, 'move.txt', 'moved ü.txt', '1\t0\t', 'move.txt', 'moved ü.txt')
    expect(parseDiffList(output)).toEqual([
      { path: 'moved ü.txt', oldPath: 'move.txt', status: 'R', additions: 1, deletions: 0, binary: false, oldMode: '100644', newMode: '100644', oldBlob: OLD, newBlob: NEW },
    ])
  })

  it('reads a binary file: no counts', () => {
    const [file] = parseDiffList(z(`:100644 100644 ${OLD} ${NEW} M`, 'img/logo.png', '-\t-\timg/logo.png'))
    expect(file).toMatchObject({ path: 'img/logo.png', status: 'M', binary: true, additions: null, deletions: null })
  })

  it('reads an added, a deleted and a mode-only file; a work-tree side has no blob', () => {
    const output = z(
      `:000000 100644 ${'0'.repeat(40)} ${NEW} A`,
      'new.ts',
      `:100644 000000 ${OLD} ${'0'.repeat(40)} D`,
      'gone.ts',
      `:100644 100755 ${OLD} ${'0'.repeat(40)} M`,
      'run.sh',
      '3\t0\tnew.ts',
      '0\t2\tgone.ts',
      '0\t0\trun.sh',
    )
    expect(parseDiffList(output).map((file) => [file.path, file.status, file.oldMode, file.newMode, file.oldBlob, file.newBlob])).toEqual([
      ['new.ts', 'A', null, '100644', null, NEW],
      ['gone.ts', 'D', '100644', null, OLD, null],
      ['run.sh', 'M', '100644', '100755', OLD, null],
    ])
  })

  it('leaves out a file whose stat changed but whose text did not: raw names it, numstat does not', () => {
    const output = z(`:100644 100644 ${OLD} ${'0'.repeat(40)} M`, 'touched.txt', `:100644 100644 ${OLD} ${'0'.repeat(40)} M`, 'edited.txt', '1\t1\tedited.txt')
    expect(parseDiffList(output).map((file) => file.path)).toEqual(['edited.txt'])
  })

  it('reads a path with a tab and one that starts with a colon', () => {
    const output = z(`:100644 100644 ${OLD} ${NEW} M`, ':colon\tand tab.md', '2\t1\t:colon\tand tab.md')
    expect(parseDiffList(output)).toMatchObject([{ path: ':colon\tand tab.md', additions: 2, deletions: 1 }])
  })

  it('reads the numstat of diff --no-index, which names /dev/null as the old side', () => {
    expect(parseNumstat(z('1\t0\t', '/dev/null', 'new ü file.txt'))).toEqual([{ path: 'new ü file.txt', oldPath: '/dev/null', additions: 1, deletions: 0 }])
  })
})

describe('a patch', () => {
  it('numbers the lines of both sides and keeps the section after @@', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,4 +10,5 @@ export function read() {',
      ' ten',
      '-eleven',
      '+eleven!',
      '+eleven and a half',
      ' twelve',
      '--- not a header, a deleted line',
      '',
    ].join('\n')
    const [file] = parsePatch(patch)
    expect(file).toMatchObject({ oldPath: 'src/a.ts', newPath: 'src/a.ts', oldMode: '100644', newMode: '100644', binary: false })
    const [hunk] = file!.hunks
    expect(hunk).toMatchObject({ oldStart: 10, oldLines: 4, newStart: 10, newLines: 5, section: 'export function read() {' })
    expect(hunk!.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text])).toEqual([
      ['context', 10, 10, 'ten'],
      ['del', 11, null, 'eleven'],
      ['add', null, 11, 'eleven!'],
      ['add', null, 12, 'eleven and a half'],
      ['context', 12, 13, 'twelve'],
      ['del', 13, null, '-- not a header, a deleted line'],
    ])
  })

  it('reads a rename with a path that has a space: git ends the +++ name with a TAB', () => {
    const patch = [
      'diff --git a/move.txt b/moved ü.txt',
      'similarity index 94%',
      'rename from move.txt',
      'rename to moved ü.txt',
      'index 0ff3bbb..d4de868 100644',
      '--- a/move.txt',
      '+++ b/moved ü.txt\t',
      '@@ -18,3 +18,4 @@',
      ' 18',
      ' 19',
      ' 20',
      '+21',
    ].join('\n')
    const [file] = parsePatch(patch)
    expect(file).toMatchObject({ oldPath: 'move.txt', newPath: 'moved ü.txt', renamed: true })
    expect(file!.hunks[0]!.lines.at(-1)).toMatchObject({ kind: 'add', newLine: 21, text: '21' })
  })

  it('reads a path git had to quote: octal UTF-8 and a quote inside', () => {
    expect(unquotePath('"b/\\303\\274ber \\"q\\".txt"')).toBe('b/über "q".txt')
    const patch = ['diff --git "a/t\\tab.txt" "b/t\\tab.txt"', 'new file mode 100644', 'index 0000000..45b983b', '--- /dev/null', '+++ "b/t\\tab.txt"', '@@ -0,0 +1 @@', '+hi'].join('\n')
    expect(parsePatch(patch)[0]).toMatchObject({ oldPath: null, newPath: 't\tab.txt', oldMode: null, newMode: '100644' })
  })

  it('marks the lines before «\\ No newline at end of file», on both sides', () => {
    const patch = ['diff --git a/nonl.txt b/nonl.txt', 'index 1b32298..6e94b48 100644', '--- a/nonl.txt', '+++ b/nonl.txt', '@@ -1,2 +1,2 @@', ' x', '-y', '\\ No newline at end of file', '+z', '\\ No newline at end of file'].join('\n')
    const lines = parsePatch(patch)[0]!.hunks[0]!.lines
    expect(lines.map((line) => [line.kind, line.text, line.noNewline])).toEqual([
      ['context', 'x', false],
      ['del', 'y', true],
      ['add', 'z', true],
    ])
  })

  it('gives the text of a CRLF line without its \\r, and says it was CRLF', () => {
    const patch = ['diff --git a/crlf.txt b/crlf.txt', 'index c30dea8..57213eb 100644', '--- a/crlf.txt', '+++ b/crlf.txt', '@@ -1,2 +1,2 @@', ' a\r', '-b\r', '+B', ''].join('\n')
    expect(parsePatch(patch)[0]!.hunks[0]!.lines.map((line) => [line.kind, line.text, line.crlf])).toEqual([
      ['context', 'a', true],
      ['del', 'b', true],
      ['add', 'B', false],
    ])
  })

  it('reads a binary file, a mode change and a deleted file, one after another', () => {
    const patch = [
      'diff --git a/bin.dat b/bin.dat',
      'index 8352675..85025d9 100644',
      'Binary files a/bin.dat and b/bin.dat differ',
      'diff --git a/mode.sh b/mode.sh',
      'old mode 100644',
      'new mode 100755',
      'diff --git a/gone file.ts b/gone file.ts',
      'deleted file mode 100644',
      'index 93bfa43..0000000',
      '--- a/gone file.ts\t',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n')
    const [bin, mode, gone] = parsePatch(patch)
    expect(bin).toMatchObject({ oldPath: 'bin.dat', newPath: 'bin.dat', binary: true, hunks: [] })
    expect(mode).toMatchObject({ oldPath: 'mode.sh', newPath: 'mode.sh', oldMode: '100644', newMode: '100755', hunks: [] })
    expect(gone).toMatchObject({ oldPath: 'gone file.ts', newPath: null, oldMode: '100644', newMode: null })
    expect(gone!.hunks[0]!.lines).toMatchObject([{ kind: 'del', oldLine: 1, text: 'bye' }])
  })
})

describe('folding', () => {
  it(`folds a patch past ${FOLD_LINES} lines or 1 MB, a lock file and a generated file; never a binary one`, () => {
    const file = { path: 'src/big.ts', additions: FOLD_LINES, deletions: 1, binary: false }
    expect(foldOf(file)).toBe('large')
    expect(foldOf({ ...file, additions: FOLD_LINES - 1 })).toBeNull()
    expect(foldOf({ ...file, additions: 1, bytes: 1024 * 1024 + 1 })).toBe('large')
    expect(foldOf({ ...file, path: 'pnpm-lock.yaml', additions: 3 })).toBe('lock')
    expect(foldOf({ ...file, path: 'packages/app/package-lock.json', additions: 3 })).toBe('lock')
    expect(foldOf({ ...file, additions: 3, generated: true })).toBe('generated')
    expect(foldOf({ path: 'big.bin', additions: null, deletions: null, binary: true })).toBeNull()
    expect(isLockFile('docs/yarn.lock.md')).toBe(false)
  })

  it('reads the linguist-generated attribute of check-attr -z', () => {
    expect([...parseGenerated(z('gen/api.ts', 'linguist-generated', 'set', 'src/a.ts', 'linguist-generated', 'unspecified', 'gen/b.ts', 'linguist-generated', 'true'))]).toEqual(['gen/api.ts', 'gen/b.ts'])
  })

  it('puts the files under the Tickets root into the group Workflow files', () => {
    expect(isWorkflowPath('.scratch/ep/issues/02-x.md', '.scratch')).toBe(true)
    expect(isWorkflowPath('.scratchpad/x.md', '.scratch')).toBe(false)
    expect(isWorkflowPath('.scratch/ep/spec.md', null)).toBe(false)
  })
})

describe('a type change (status T): two patches of one path', () => {
  // As git 2.50 prints `git diff HEAD -- f` after a file became a link, and after a link became a file.
  const fileToLink = [
    'diff --git a/f b/f',
    'deleted file mode 100644',
    'index 422c2b7..0000000',
    '--- a/f',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-a',
    '-b',
    'diff --git a/f b/f',
    'new file mode 120000',
    'index 0000000..1de5659',
    '--- /dev/null',
    '+++ b/f',
    '@@ -0,0 +1 @@',
    '+target',
    '\\ No newline at end of file',
    '',
  ].join('\n')
  const linkToFile = [
    'diff --git a/f b/f',
    'deleted file mode 120000',
    'index 1de5659..0000000',
    '--- a/f',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-target',
    '\\ No newline at end of file',
    'diff --git a/f b/f',
    'new file mode 100644',
    'index 0000000..587be6b',
    '--- /dev/null',
    '+++ b/f',
    '@@ -0,0 +1 @@',
    '+x',
    '',
  ].join('\n')
  const lines = (patch: ReturnType<typeof patchOfPath>) => patch?.hunks.flatMap((hunk) => hunk.lines.map((line) => [line.kind, line.oldLine, line.newLine, line.text, line.noNewline]))

  it('joins a file that became a link: both halves, the old mode of the file and the new mode of the link', () => {
    const patch = patchOfPath(parsePatch(fileToLink), 'f')
    expect(patch).toMatchObject({ oldPath: 'f', newPath: 'f', oldMode: '100644', newMode: '120000', binary: false })
    expect(lines(patch)).toEqual([
      ['del', 1, null, 'a', false],
      ['del', 2, null, 'b', false],
      ['add', null, 1, 'target', true],
    ])
  })

  it('joins a link that became a file the same way', () => {
    const patch = patchOfPath(parsePatch(linkToFile), 'f')
    expect(patch).toMatchObject({ oldPath: 'f', newPath: 'f', oldMode: '120000', newMode: '100644' })
    expect(lines(patch)).toEqual([
      ['del', 1, null, 'target', true],
      ['add', null, 1, 'x', false],
    ])
  })

  it('takes the one patch of a path as it is, a deletion too, and none of another path', () => {
    const [deletion] = parsePatch(linkToFile)
    expect(patchOfPath([deletion!], 'f')).toBe(deletion)
    expect(patchOfPath(parsePatch(fileToLink), 'g')).toBeUndefined()
  })
})

describe('a path the screen asks for', () => {
  it('is one from the top folder of the repository: not absolute, no .. part', () => {
    for (const path of ['a.txt', 'notes/с пробелом.md', '.scratch/ep/x.md', 'a..b/c', '...']) expect(isRepoPath(path), path).toBe(true)
    for (const path of ['', '/etc/hosts', '\\\\server\\share', 'C:\\Windows\\win.ini', 'c:x', '..', '../../secret.txt', 'a/../../b', 'a\\..\\b', 'a\0b']) expect(isRepoPath(path), path).toBe(false)
  })
})

describe('the commits (log -z)', () => {
  it('reads each commit, a subject with the separator in it too', () => {
    const output = z(['a'.repeat(40), 'aaaaaaa', 'Ann Ü', '2026-11-19T15:00:14+02:00', 'fix: one'].join('\x1f'), ['b'.repeat(40), 'bbbbbbb', 'Bob', '2026-11-18T10:00:00Z', 'two\x1fparts'].join('\x1f'))
    expect(parseCommits(output)).toEqual([
      { sha: 'a'.repeat(40), short: 'aaaaaaa', author: 'Ann Ü', date: '2026-11-19T15:00:14+02:00', subject: 'fix: one' },
      { sha: 'b'.repeat(40), short: 'bbbbbbb', author: 'Bob', date: '2026-11-18T10:00:00Z', subject: 'two\x1fparts' },
    ])
  })
})
