import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { powershellScriptCommand, type RunFile } from '../../src/main/agent/env'
import {
  batchedProcessStarts,
  PROCESS_START_BATCH_MS,
  PROCESS_START_CACHE_MS,
  processState,
  PROCESS_IDS_VAR,
  PROCESS_STARTS_SCRIPT,
  readWindowsProcessStarts,
} from '../../src/main/claude-home/registry'

// The live Session check on Windows, of src/main/claude-home/registry.ts: the start time of each
// process read by one Windows PowerShell call. Moved out of claude-home-registry.test.ts, which
// had grown past 1000 lines (worfy-windows ticket 29).

// On Windows procStart is the FILETIME of the start in decimal (evidence of worfy-windows ticket 01,
// section 23), read by Get-Process through one PowerShell call; the command is replaced here.
describe('process liveness on Windows (worfy-windows ticket 08)', () => {
  const START = '134359927685768597'
  const win = (answer: Map<number, string> | Error) => ({ platform: 'win32' as const, windowsStart: async () => (answer instanceof Error ? Promise.reject(answer) : answer) })

  it('is alive when the start of the running pid is procStart, gone when it is another, unknown when it cannot be read', async () => {
    expect(await processState(process.pid, START, win(new Map([[process.pid, START]])))).toBe('alive')
    expect(await processState(process.pid, ` ${START}\n`, win(new Map([[process.pid, START]])))).toBe('alive')
    expect(await processState(process.pid, START, win(new Map([[process.pid, '134359927685768590']])))).toBe('gone')
    expect(await processState(process.pid, START, win(new Map()))).toBe('gone')
    expect(await processState(process.pid, START, win(new Map([[process.pid, '?']])))).toBe('unknown')
    expect(await processState(process.pid, START, win(new Error('powershell timed out')))).toBe('unknown')
    expect(await processState(process.pid, undefined, win(new Error('not asked')))).toBe('alive')
  })

  it('reads the start times of all pids by one PowerShell call and parses its lines', async () => {
    const calls: { file: string; args: string[]; pids: string | undefined }[] = []
    const run: RunFile = (file, args, options, done) => {
      calls.push({ file, args, pids: options.env?.[PROCESS_IDS_VAR] })
      done(null, `41001 ${START}\r\n41002 ?\r\nnoise\r\n`, '')
    }
    const starts = await readWindowsProcessStarts('C:\\Windows', run)([41001, 41002, 41003])
    expect(starts).toEqual(new Map([[41001, START], [41002, '?']]))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(calls[0]!.args).toEqual(['-NoProfile', '-NonInteractive', '-Command', PROCESS_STARTS_SCRIPT])
    expect(calls[0]!.pids).toBe('41001,41002,41003')
    expect(await readWindowsProcessStarts('C:\\Windows', run)([])).toEqual(new Map())
    expect(calls).toHaveLength(1)
    const failing: RunFile = (_file, _args, _options, done) => done({ code: 1 }, '', 'boom')
    await expect(readWindowsProcessStarts('C:\\Windows', failing)([1])).rejects.toThrow(/could not read process start times: exit 1/)
  })

  it('gathers the pids asked for at the same time into one read', async () => {
    const reads: number[][] = []
    const start = batchedProcessStarts(async (pids) => {
      reads.push([...pids])
      return new Map(pids.map((pid) => [pid, START]))
    }, 5)
    const answers = await Promise.all([start(1), start(2), start(3)])
    expect(reads).toEqual([[1, 2, 3]])
    expect(answers.every((map) => map.get(2) === START)).toBe(true)
    await start(4)
    expect(reads).toEqual([[1, 2, 3], [4]])
  })

  it('gathers for 25 ms and keeps a start time for 30 s by default', () => {
    expect(PROCESS_START_BATCH_MS).toBe(25)
    expect(PROCESS_START_CACHE_MS).toBe(30_000)
  })

  it('by default reads the clock of Date.now and the batch delay of PROCESS_START_BATCH_MS', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    try {
      const reads: number[][] = []
      const start = batchedProcessStarts(async (pids) => {
        reads.push([...pids])
        return new Map(pids.map((pid) => [pid, START]))
      })
      const first = start(1)
      await vi.advanceTimersByTimeAsync(24)
      expect(reads).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      await first
      expect(reads).toEqual([[1]])
      vi.setSystemTime(Date.now() + 29_999)
      await start(1)
      expect(reads).toHaveLength(1)
      vi.setSystemTime(Date.now() + 1)
      const again = start(1)
      await vi.advanceTimersByTimeAsync(25)
      await again
      expect(reads).toEqual([[1], [1]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('reuses a start time read for a pid for 30 s, and never `?`, a missing pid or a failed read', async () => {
    let clock = 1_000
    const reads: number[][] = []
    let answer: Map<number, string> | Error = new Map([[1, START], [2, '?']])
    const start = batchedProcessStarts(
      async (pids) => {
        reads.push([...pids])
        if (answer instanceof Error) throw answer
        return answer
      },
      1,
      30_000,
      () => clock,
    )
    await Promise.all([start(1), start(2), start(3)])
    expect(reads).toEqual([[1, 2, 3]])
    expect((await start(1)).get(1)).toBe(START)
    expect(reads).toHaveLength(1)
    await start(2)
    await start(3)
    expect(reads).toEqual([[1, 2, 3], [2], [3]])
    clock += 30_000
    answer = new Error('powershell failed')
    await expect(start(1)).rejects.toThrow('powershell failed')
    answer = new Map([[1, START]])
    await start(1)
    expect(reads.at(-1)).toEqual([1])
  })

  // worfy-windows ticket 21. On the owner's PC, from Electron, a call of powershell.exe whose script
  // had to be decoded from base64 cost a second more the first time a text was seen; with the pids
  // in the text every new set of live Sessions was such a text.
  it('hands powershell.exe the same arguments whatever the pids: they are not in the text of the script', async () => {
    const calls: string[][] = []
    const given: (Record<string, string | undefined> | undefined)[] = []
    const run: RunFile = (_file, args, options, done) => {
      calls.push(args)
      given.push(options.env)
      done(null, '', '')
    }
    await readWindowsProcessStarts('C:\\Windows', run)([7, 8])
    await readWindowsProcessStarts('C:\\Windows', run)([41001, 41002])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
    // They come in a variable of the environment, added to the whole environment of worfy: PowerShell
    // started with that one variable alone would miss SystemRoot, PSModulePath and the rest
    // (worfy-windows ticket 29).
    expect(given).toEqual([
      { ...process.env, [PROCESS_IDS_VAR]: '7,8' },
      { ...process.env, [PROCESS_IDS_VAR]: '41001,41002' },
    ])
  })

  it('gives the script only whole numbers above zero that fit an int, in the order asked', async () => {
    const given: (string | undefined)[] = []
    const run: RunFile = (_file, _args, options, done) => {
      given.push(options.env?.[PROCESS_IDS_VAR])
      done(null, '', '')
    }
    // 1e21 is an integer to Number.isInteger but prints as 1e+21; 2 ** 31 is one past the largest
    // int, the type the script turns each pid into (worfy-windows ticket 29).
    await readWindowsProcessStarts('C:\\Windows', run)([9, -1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e21, 2 ** 31, Number.MAX_SAFE_INTEGER + 1, 0x7fffffff, 7])
    expect(given).toEqual(['9,2147483647,7'])
    for (const each of given) expect(each).toMatch(/^[0-9]+(,[0-9]+)*$/)
    await readWindowsProcessStarts('C:\\Windows', run)([-1, 0.5, 1e21, 2 ** 31])
    expect(given).toHaveLength(1)
  })

  it('starts the PowerShell of SystemRoot and asks Get-Process for each pid, its start as UTC FILETIME', async () => {
    const calls: { file: string; script: string }[] = []
    const run: RunFile = (file, args, _options, done) => {
      calls.push({ file, script: args[3]! })
      done(null, '', '')
    }
    await readWindowsProcessStarts('D:\\Win', run)([7, 8])
    expect(calls[0]!.file).toBe('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(PROCESS_IDS_VAR).toBe('WORFY_PROCESS_IDS')
    expect(calls[0]!.script).toBe(
      [
        "$ErrorActionPreference = 'SilentlyContinue'",
        'if ($null -eq $env:WORFY_PROCESS_IDS) { exit 2 }',
        "$ids = @([string]$env:WORFY_PROCESS_IDS -split ',' | Where-Object { $_ -match '^[0-9]+$' } | ForEach-Object { [int]$_ })",
        'if ($ids.Count -eq 0) { exit 0 }',
        'foreach ($process in Get-Process -Id $ids) {',
        '  $start = $null',
        '  try { $start = $process.StartTime } catch { }',
        '  if ($null -eq $start) { "$($process.Id) ?" } else { "$($process.Id) $($start.ToFileTimeUtc())" }',
        '}',
        'exit 0',
      ].join('\n'),
    )
  })
})

describe.runIf(process.platform === 'win32')('process liveness on this Windows machine', { timeout: 30_000 }, () => {
  it('is alive for this process at its own start time, gone at another, read through PowerShell', async () => {
    const own = (await readWindowsProcessStarts()([process.pid])).get(process.pid)
    expect(own).toMatch(/^\d{17,}$/)
    expect(await processState(process.pid, own)).toBe('alive')
    expect(await processState(process.pid, '134359927685768590')).toBe('gone')
  })

  // worfy-windows ticket 21: the script itself takes only what is all digits of its variable. The
  // parent of this process runs, so ` <its pid>` would give a second line if a space passed
  // (worfy-windows ticket 29).
  it('the script reads its pids from the environment and passes by whatever is not a number there', async () => {
    const { file, args, options } = powershellScriptCommand(process.env.SystemRoot, PROCESS_STARTS_SCRIPT, { [PROCESS_IDS_VAR]: `x,${process.pid};Get-Date,,-5,${process.pid}, ${process.ppid},$(Get-Date)` })
    const out = await new Promise<string>((resolve, reject) => execFile(file, args, options, (error, stdout) => (error ? reject(error) : resolve(stdout))))
    const lines = out.split(/\r?\n/).filter((line) => line !== '')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(new RegExp(`^${process.pid} \\d{17,}$`))
    // With nothing to ask about it prints nothing and ends well.
    const empty = powershellScriptCommand(process.env.SystemRoot, PROCESS_STARTS_SCRIPT, { [PROCESS_IDS_VAR]: 'none' })
    expect(await new Promise<string>((resolve, reject) => execFile(empty.file, empty.args, empty.options, (error, stdout) => (error ? reject(error) : resolve(stdout))))).toBe('')
  })

  // worfy-windows ticket 29: a lost environment must not read as "every process ended".
  it('the script fails when its variable is missing altogether, and processState then answers unknown, not gone', async () => {
    const withoutIds = (env: Record<string, string | undefined> | undefined): Record<string, string | undefined> => {
      const copy = { ...(env ?? process.env) }
      delete copy[PROCESS_IDS_VAR]
      return copy
    }
    const bare = powershellScriptCommand(process.env.SystemRoot, PROCESS_STARTS_SCRIPT)
    const answer = await new Promise<{ code: unknown; stdout: string }>((resolve) =>
      execFile(bare.file, bare.args, { ...bare.options, env: withoutIds(undefined) }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout })),
    )
    expect(answer).toEqual({ code: 2, stdout: '' })
    // A runner that loses the environment it is given, as runFile would if it stopped passing it on.
    const losing: RunFile = (file, args, options, done) => {
      execFile(file, args, { ...options, env: withoutIds(options.env) }, (error, stdout, stderr) => done(error, stdout, stderr))
    }
    const own = (await readWindowsProcessStarts()([process.pid])).get(process.pid)
    const windowsStart = batchedProcessStarts(readWindowsProcessStarts(process.env.SystemRoot, losing), 1)
    expect(await processState(process.pid, own, { platform: 'win32', windowsStart })).toBe('unknown')
  })

  it('several pids in one call: each running one gets its line, one that runs no more gets none', async () => {
    const starts = await readWindowsProcessStarts()([process.pid, process.ppid, 4_194_299])
    expect([...starts.keys()].sort((a, b) => a - b)).toEqual([process.pid, process.ppid].sort((a, b) => a - b))
    for (const start of starts.values()) expect(start).toMatch(/^\d{17,}$|^\?$/)
  })
})
