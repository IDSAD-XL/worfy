// The format of the failure records of the gate (harness/hooks/gate-failures.mjs): the run file and its
// checks, the id of a test, the scrubbing of text and the first line of an error.
import { describe, expect, it } from 'vitest'
import { byTest, findLeaks, firstLine, parseRunFile, scrub, scrubRecord, testId, type FailureRecord, type RunRecord } from '../../harness/hooks/gate-failures.mjs'

const COMPUTER = { id: '0a1b2c3d', name: 'mac', platform: 'darwin' }

function failure(over: Partial<FailureRecord> = {}): FailureRecord {
  const runner = over.runner === undefined ? 'vitest' : over.runner
  const file = over.file === undefined ? 'test/unit/a.test.ts' : over.file
  const name = over.name === undefined ? 'group > does a thing' : over.name
  return {
    step: 'worfy/.:test',
    runner,
    file,
    line: 12,
    name,
    test: runner === null || file === null || name === null ? null : testId(runner, file, name),
    ms: 40,
    error: 'AssertionError: expected 1 to be 2',
    attempt: 1,
    rerun: runner === null ? null : ['node', 'scripts/vitest-electron.mjs', 'test/unit/a.test.ts', '-t', 'group > does a thing'],
    ...over,
  }
}

function run(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    kind: 'run',
    run: '1a2b3c4d/2026-11-04T10-00-00Z-4242',
    at: '2026-11-04T10:00:00Z',
    key: 'worfy',
    profile: 'full',
    head: 'abc1234def5678',
    outcome: 'red',
    computer: COMPUTER,
    dirty: false,
    failures: [
      failure(),
      failure({ file: 'test/unit/b.test.ts', name: 'b > works', test: testId('vitest', 'test/unit/b.test.ts', 'b > works') }),
      failure({ runner: null, file: null, name: null, line: null, test: null, rerun: null, error: 'lint failed: 3 problems' }),
    ],
    ...over,
  }
}

const CTX = { repo: '/Users/jdoe/work/repo', home: '/Users/jdoe', user: 'jdoe', host: 'jdoes-laptop' }

describe('the run file', () => {
  it('reads a run file with two test records and one step record', () => {
    const parsed = parseRunFile(JSON.stringify(run()))
    expect(parsed.ok, parsed.ok ? '' : parsed.reason).toBe(true)
    if (!parsed.ok) return
    const record: RunRecord = parsed.record
    expect(record.failures).toHaveLength(3)
    expect(record.failures.filter((f) => f.runner !== null)).toHaveLength(2)
    expect(record.failures[2]).toMatchObject({ runner: null, file: null, name: null, test: null })
  })

  it.each([
    ['no version', { version: undefined }, /version/],
    ['version 2', { version: 2 }, /version/],
    ['an `at` that is not a date', { at: 'yesterday' }, /\bat\b/],
    ['an `at` that is not a real day', { at: '2026-13-45T10:00:00Z' }, /\bat\b/],
    ['no `dirty`', { dirty: undefined }, /dirty/],
    ['a `dirty` that is not a boolean', { dirty: 'no' }, /dirty/],
    ['another kind', { kind: 'rerun' }, /kind/],
    ['a computer with a host name for an id', { computer: { ...COMPUTER, id: 'jdoes-laptop' } }, /computer/],
  ])('does not read a run file with %s, and names the reason', (_what, over, reason) => {
    const parsed = parseRunFile(JSON.stringify(run(over)))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toMatch(reason)
    expect(parsed.reason).not.toContain('\n')
  })

  it('does not read a file that is not JSON', () => {
    const parsed = parseRunFile('{"version": 1,')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toMatch(/JSON/)
  })

  it('does not read a broken failure record, and names its index', () => {
    const parsed = parseRunFile(JSON.stringify(run({ failures: [failure(), { ...failure(), attempt: 0 }] })))
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.reason).toMatch(/failures\[1\]\.attempt/)
  })
})

describe('testId', () => {
  it('is the runner, the file and the name, without the line', () => {
    expect(testId('vitest', 'test/unit/a.test.ts', 'group > does a thing')).toBe('vitest test/unit/a.test.ts > group > does a thing')
    expect(testId('playwright', 'test/e2e/x.spec.ts', 'opens')).not.toMatch(/:\d+/)
  })

  it('makes one test of the same id in two runs, whatever the line', () => {
    const first = parseRunFile(JSON.stringify(run({ failures: [failure({ line: 12 })] })))
    const second = parseRunFile(JSON.stringify(run({ run: '1a2b3c4d/2026-11-04T11-00-00Z-77', at: '2026-11-04T11:00:00Z', failures: [failure({ line: 30 })] })))
    if (!first.ok || !second.ok) throw new Error('the fixtures must parse')
    const tests = byTest([first.record, second.record])
    expect([...tests.keys()]).toEqual(['vitest test/unit/a.test.ts > group > does a thing'])
    expect(tests.get('vitest test/unit/a.test.ts > group > does a thing')?.map((o) => o.failure.line)).toEqual([12, 30])
  })
})

describe('scrub', () => {
  it('takes the user name out of a Windows path written with /', () => {
    const out = scrub('C:/Users/jdoe/repo/x.ts', { repo: 'C:\\Users\\jdoe\\repo', home: 'C:\\Users\\jdoe', user: 'jdoe', host: 'DESKTOP-AB12CD3' })
    expect(out).not.toContain('jdoe')
    expect(out).toBe('<repo>/x.ts')
  })

  it.each([
    ['/Users/jdoe/x', '~/x'],
    ['C:\\Users\\jdoe\\x', '~/x'],
    ['C:/Users/jdoe/x', '~/x'],
    ['/c/Users/jdoe/x', '~/x'],
  ])('replaces the home folder in %s', (text, expected) => {
    const home = text.startsWith('/Users') ? '/Users/jdoe' : 'C:\\Users\\jdoe'
    expect(scrub(text, { home, user: 'jdoe' })).toBe(expected)
  })

  it('replaces the root of the repository before the home folder that holds it', () => {
    expect(scrub('at /Users/jdoe/work/repo/test/a.test.ts:3:1', CTX)).toBe('at <repo>/test/a.test.ts:3:1')
    expect(scrub('at C:\\Users\\jdoe\\work\\repo\\test\\a.test.ts', { ...CTX, repo: 'C:\\Users\\jdoe\\work\\repo' })).toBe('at <repo>/test/a.test.ts')
  })

  describe('a Windows path under the root or the home folder', () => {
    const WIN = { repo: 'D:\\a\\worfy\\worfy', home: 'C:\\Users\\runneradmin', user: 'runneradmin', host: 'fv-az123' }

    it.each([
      ['with "\\"', 'D:\\a\\worfy\\worfy\\test\\x.test.ts:12:5'],
      ['with "\\\\" as JSON writes it', 'D:\\\\a\\\\worfy\\\\worfy\\\\test\\\\x.test.ts:12:5'],
      ['as Git Bash writes it', '/d/a/worfy/worfy/test/x.test.ts:12:5'],
      ['as WSL writes it', '/mnt/d/a/worfy/worfy/test/x.test.ts:12:5'],
      ['with the other case of the drive letter', 'd:\\a\\worfy\\worfy\\test\\x.test.ts:12:5'],
      ['with "/" after a drive letter', 'D:/a/worfy/worfy/test/x.test.ts:12:5'],
      ['with "\\" and "/" mixed', 'D:\\a\\worfy\\worfy\\test/x.test.ts:12:5'],
    ])('writes the root %s as <repo> and the rest of the path with "/"', (_how, path) => {
      expect(scrub(`AssertionError: failed at ${path}`, WIN)).toBe('AssertionError: failed at <repo>/test/x.test.ts:12:5')
    })

    it.each([
      ['with "\\"', 'C:\\Users\\runneradmin\\AppData\\x.json'],
      ['with "\\\\"', 'C:\\\\Users\\\\runneradmin\\\\AppData\\\\x.json'],
      ['as Git Bash writes it', '/c/Users/runneradmin/AppData/x.json'],
      ['with the other case of the drive letter', 'c:\\users\\RunnerAdmin\\AppData\\x.json'],
    ])('writes the home folder %s as ~ and the rest of the path with "/"', (_how, path) => {
      expect(scrub(`Error: cannot read ${path}`, WIN)).toBe('Error: cannot read ~/AppData/x.json')
    })

    it('takes a folder name with a space as a part of the path, up to the end of the path', () => {
      expect(scrub('Error: at D:\\a\\worfy\\worfy\\test\\a b\\c d.test.ts:12:5', WIN)).toBe('Error: at <repo>/test/a b/c d.test.ts:12:5')
      expect(scrub('Error: at C:\\Users\\runneradmin\\My Documents\\x.ts', WIN)).toBe('Error: at ~/My Documents/x.ts')
    })

    it('keeps the quotes, the parentheses and the line and column after the path', () => {
      expect(scrub('Error: at fn (D:\\a\\worfy\\worfy\\src\\a.ts:12:5), then "D:\\a\\worfy\\worfy\\x y\\b.ts" and \'D:\\a\\worfy\\worfy\\c.ts\'', WIN)).toBe(
        'Error: at fn (<repo>/src/a.ts:12:5), then "<repo>/x y/b.ts" and \'<repo>/c.ts\'',
      )
    })

    it('stops at the end of the path: a "\\" of the words after it stays', () => {
      expect(scrub('expected D:\\a\\worfy\\worfy\\x.ts to match \\d+', WIN)).toBe('expected <repo>/x.ts to match \\d+')
    })

    it.each([
      ['two paths under the root with "\\"', 'expected D:\\a\\worfy\\worfy\\x.ts to equal D:\\a\\worfy\\worfy\\y.ts', 'expected <repo>/x.ts to equal <repo>/y.ts'],
      [
        'two paths under the root with "\\\\" as JSON writes them',
        'expected D:\\\\a\\\\worfy\\\\worfy\\\\x.ts to equal D:\\\\a\\\\worfy\\\\worfy\\\\y.ts',
        'expected <repo>/x.ts to equal <repo>/y.ts',
      ],
      ['two paths under the root with no word between them', 'D:\\a\\worfy\\worfy\\x.ts D:\\a\\worfy\\worfy\\y.ts', '<repo>/x.ts <repo>/y.ts'],
      ['two paths under the root, folder names with a space', 'a D:\\a\\worfy\\worfy\\a b\\x.ts and D:\\a\\worfy\\worfy\\c d\\y.ts', 'a <repo>/a b/x.ts and <repo>/c d/y.ts'],
      ['two paths under the home folder with "\\"', 'a C:\\Users\\runneradmin\\x.ts and C:\\Users\\runneradmin\\y.ts', 'a ~/x.ts and ~/y.ts'],
      [
        'two paths under the home folder with "\\\\" as JSON writes them',
        'a C:\\\\Users\\\\runneradmin\\\\x.ts and C:\\\\Users\\\\runneradmin\\\\y.ts',
        'a ~/x.ts and ~/y.ts',
      ],
      ['a path under the root, then one under the home folder', 'D:\\a\\worfy\\worfy\\x.ts vs C:\\Users\\runneradmin\\y.ts', '<repo>/x.ts vs ~/y.ts'],
      ['a path under the home folder, then one under the root', 'C:\\Users\\runneradmin\\y.ts vs D:\\a\\worfy\\worfy\\x.ts', '~/y.ts vs <repo>/x.ts'],
      ['a path with "\\", then the same root as Git Bash writes it', 'D:\\a\\worfy\\worfy\\x.ts vs /d/a/worfy/worfy/y.ts', '<repo>/x.ts vs <repo>/y.ts'],
    ])('replaces every path of a line: %s', (_how, text, expected) => {
      expect(scrub(text, WIN)).toBe(expected)
    })

    it('runs in milliseconds on a long line of words and separators', () => {
      const lines = [
        `D:\\a\\worfy\\worfy${'\\a b'.repeat(20000)} c`,
        `D:\\a\\worfy\\worfy\\x${' w'.repeat(40000)}:`,
        `C:\\Users\\runneradmin${'\\\\x y z'.repeat(20000)}"`,
        `${'D:\\a\\worfy\\worfy\\x.ts D'.repeat(5000)}`,
      ]
      const started = performance.now()
      for (const line of lines) scrub(line, WIN)
      expect(performance.now() - started).toBeLessThan(1000)
    })

    it('leaves a path outside the root and the home folder as it is', () => {
      expect(scrub('Error: cannot read E:\\data\\x y\\z.json', WIN)).toBe('Error: cannot read E:\\data\\x y\\z.json')
      expect(scrub('Error: cannot read D:\\a\\worfy\\other\\z.json', WIN)).toBe('Error: cannot read D:\\a\\worfy\\other\\z.json')
    })

    it('leaves a POSIX path under the root as it was, "//" included', () => {
      const ctx = { repo: '/work/repo', home: '/home/runner' }
      expect(scrub('failed in /work/repo/test/a b/x.test.ts:3 and /home/runner/x//y', ctx)).toBe('failed in <repo>/test/a b/x.test.ts:3 and ~/x//y')
    })

    it('writes a record of a run with "/" in its error', () => {
      const record = scrubRecord(failure({ error: 'AssertionError: failed at D:\\a\\worfy\\worfy\\test\\a.test.ts:12:5' }), WIN)
      expect(record.error).toBe('AssertionError: failed at <repo>/test/a.test.ts:12:5')
    })
  })

  it('replaces the user name of any home folder path, the 8.3 name of the CI runner too', () => {
    expect(scrub('C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\x', {})).toBe('C:\\Users\\<user>\\AppData\\Local\\Temp\\x')
    expect(scrub('/home/someoneelse/x and /Users/other/y', {})).toBe('/home/<user>/x and /Users/<user>/y')
  })

  it('replaces the host name and the user name as words', () => {
    expect(scrub('connect to jdoes-laptop.local failed for jdoe', CTX)).toBe('connect to <host>.local failed for <user>')
    expect(scrub('JDOES-LAPTOP refused', CTX)).toBe('<host> refused')
  })

  it.each([
    ['a UUID', 'session 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f ended', '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f'],
    ['an email', 'mail jane.doe@corp.io bounced', 'jane.doe@corp.io'],
    ['a GitHub token', 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 refused', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['a Bearer value', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345', 'abcdefghijklmnopqrstuvwxyz012345'],
  ])('masks %s', (_what, text, secret) => {
    const out = scrub(text, CTX)
    expect(out).not.toContain(secret)
    expect(findLeaks(out, { hostname: CTX.host })).toEqual([])
  })

  it('leaves nothing findLeaks finds in a line with all of it at once', () => {
    const text = [
      '/Users/jdoe/x',
      'C:\\Users\\jdoe\\x',
      'C:/Users/jdoe/x',
      '/c/Users/jdoe/x',
      'C:\\Users\\RUNNER~1\\x',
      'jdoes-laptop',
      '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f',
      'jane.doe@corp.io',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'Bearer abcdefghijklmnopqrstuvwxyz012345',
    ].join(' ')
    expect(findLeaks(text, { hostname: CTX.host }).length).toBeGreaterThan(0)
    const out = scrub(text, CTX)
    expect(findLeaks(out, { hostname: CTX.host })).toEqual([])
    for (const value of ['jdoe', 'RUNNER~1', 'jdoes-laptop', '3f2a9c1e', 'jane.doe', 'ghp_abc', 'abcdefghijklmnop']) expect(out).not.toContain(value)
  })

  it('leaves a text without personal data as it is', () => {
    expect(scrub('expected 1 to be 2 in test/unit/a.test.ts:12', CTX)).toBe('expected 1 to be 2 in test/unit/a.test.ts:12')
  })
})

describe('scrubRecord', () => {
  it('scrubs the error, the name and the file of a record, and its test id with them', () => {
    const dirty = failure({
      file: '/Users/jdoe/work/repo/test/unit/a.test.ts',
      name: 'reads /Users/jdoe/x',
      error: 'ENOENT: /Users/jdoe/x on jdoes-laptop',
    })
    const clean = scrubRecord({ ...dirty, test: testId('vitest', dirty.file as string, dirty.name as string) }, CTX)
    expect(clean.file).toBe('<repo>/test/unit/a.test.ts')
    expect(clean.name).toBe('reads ~/x')
    expect(clean.error).toBe('ENOENT: ~/x on <host>')
    expect(clean.test).toBe(testId('vitest', '<repo>/test/unit/a.test.ts', 'reads ~/x'))
    expect(JSON.stringify(clean)).not.toContain('jdoe')
  })

  it('keeps the nulls of a step record', () => {
    const step = failure({ runner: null, file: null, name: null, line: null, test: null, rerun: null, error: 'failed in /Users/jdoe/x' })
    expect(scrubRecord(step, CTX)).toMatchObject({ runner: null, file: null, name: null, test: null, error: 'failed in ~/x' })
  })
})

describe('firstLine', () => {
  it('takes the first line with text, without ANSI control sequences', () => {
    expect(firstLine('\n\u001b[31mAssertionError\u001b[39m: expected 1\nat line 2', 200)).toBe('AssertionError: expected 1')
  })

  it('cuts a long line to the limit', () => {
    const line = firstLine('x'.repeat(500), 200)
    expect([...line]).toHaveLength(200)
    expect(line.endsWith('…')).toBe(true)
  })
})
