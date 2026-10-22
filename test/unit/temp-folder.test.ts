// insideUserTemp (src/main/projects/temp-folder.ts, worfy-windows ticket 61): whether a folder lies
// inside the Windows %TEMP% of the user, where Storage Sense may delete files. The table models
// Windows on any machine: win32 paths, TEMP/TMP of a stand-in environment, and a realpath that gives
// the long name of a short 8.3 one, as realpathSync.native does on Windows. On Windows itself the
// last block checks the real %TEMP%.
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { insideUserTemp, type TempPlace } from '../../src/main/projects/temp-folder'

const TEMP = 'C:\\Users\\Alexey\\AppData\\Local\\Temp'
/** The short 8.3 spelling of the same folder, as Windows often puts it into TEMP. */
const SHORT_TEMP = 'C:\\Users\\ALEXEY~1\\AppData\\Local\\Temp'

/** The realpath of Windows: the short name of the user folder becomes the long one. */
const longNames = (path: string): string => path.replace(/\\ALEXEY~1(?=\\|$)/i, '\\Alexey').replace(/\/ALEXEY~1(?=\/|$)/i, '/Alexey')

const windows = (env: Record<string, string | undefined>): Partial<TempPlace> => ({ platform: 'win32', env, realpath: longNames })

describe('insideUserTemp on Windows', () => {
  const place = windows({ TEMP })

  it.each([
    ['a worktree inside %TEMP%', `${TEMP}\\worfy-01\\wt\\07`, true],
    ['%TEMP% itself', TEMP, true],
    ['%TEMP% with a separator at the end', `${TEMP}\\`, true],
    ['/ instead of \\', 'C:/Users/Alexey/AppData/Local/Temp/worfy-01', true],
    ['the drive letter in lower case', 'c:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy-01', true],
    ['the rest of the path in another case', 'C:\\users\\alexey\\appdata\\local\\TEMP\\worfy-01', true],
    ['the short 8.3 name of the folder', `${SHORT_TEMP}\\worfy-01`, true],
    ['a neighbour folder whose name starts the same', 'C:\\Users\\Alexey\\AppData\\Local\\Temp2\\worfy', false],
    ['the folder above %TEMP%', 'C:\\Users\\Alexey\\AppData\\Local', false],
    ['a folder outside %TEMP%', 'C:\\Users\\Alexey\\worfy-wt\\07', false],
    ['another drive', 'D:\\Users\\Alexey\\AppData\\Local\\Temp\\worfy', false],
    ['a relative path', 'Temp\\worfy', false],
  ])('%s', (_name, path, inside) => {
    expect(insideUserTemp(path, place)).toBe(inside)
  })

  it('a TEMP in its short 8.3 name still finds the folder in its long one', () => {
    expect(insideUserTemp(`${TEMP}\\worfy-01`, windows({ TEMP: SHORT_TEMP }))).toBe(true)
    expect(insideUserTemp('C:\\Users\\Alexey\\worfy-wt', windows({ TEMP: SHORT_TEMP }))).toBe(false)
  })

  it('without TEMP the folder of TMP counts, as os.tmpdir() reads them', () => {
    expect(insideUserTemp(`${TEMP}\\worfy-01`, windows({ TMP: TEMP }))).toBe(true)
    expect(insideUserTemp(`${TEMP}\\worfy-01`, windows({ TEMP: '', TMP: TEMP }))).toBe(true)
    expect(insideUserTemp(`${TEMP}\\worfy-01`, windows({ TEMP: 'D:\\Temp', TMP: TEMP }))).toBe(false)
  })

  it('no TEMP and no TMP, or one that is not an absolute Windows path, finds nothing', () => {
    expect(insideUserTemp(`${TEMP}\\worfy-01`, windows({}))).toBe(false)
    expect(insideUserTemp('Temp\\worfy-01', windows({ TEMP: 'Temp' }))).toBe(false)
    expect(insideUserTemp('C:\\worfy', windows({ TEMP: 'C:' }))).toBe(false)
  })
})

describe('insideUserTemp on macOS and Linux', () => {
  it.each(['darwin', 'linux'] as const)('%s: always no, even for a folder under TEMP', (platform) => {
    const env = { TEMP: '/tmp', TMP: '/tmp', TMPDIR: '/tmp' }
    expect(insideUserTemp('/tmp/worfy-01', { platform, env, realpath: (path) => path })).toBe(false)
    expect(insideUserTemp(`${TEMP}\\worfy-01`, { platform, env: { TEMP }, realpath: (path) => path })).toBe(false)
    expect(insideUserTemp('/tmp', { platform, env, realpath: (path) => path })).toBe(false)
  })
})

describe.runIf(process.platform === 'win32')('insideUserTemp on this Windows machine', () => {
  it('a folder made in the real %TEMP% is inside it; the working folder of the test run is not', () => {
    const made = mkdtempSync(join(tmpdir(), 'worfy-temp-'))
    mkdirSync(join(made, 'wt'))
    expect(insideUserTemp(join(made, 'wt'))).toBe(true)
    expect(insideUserTemp(realpathSync.native(made).replaceAll('\\', '/'))).toBe(true)
    expect(insideUserTemp(process.cwd())).toBe(realpathSync.native(process.cwd()).toLowerCase().startsWith(`${realpathSync.native(tmpdir()).toLowerCase()}\\`))
    rmSync(made, { recursive: true, force: true })
  })
})

describe.runIf(process.platform !== 'win32')('insideUserTemp on this machine (not Windows)', () => {
  it('the real temporary folder is never reported', () => {
    const made = mkdtempSync(join(tmpdir(), 'worfy-temp-'))
    expect(insideUserTemp(made)).toBe(false)
    rmSync(made, { recursive: true, force: true })
  })
})
