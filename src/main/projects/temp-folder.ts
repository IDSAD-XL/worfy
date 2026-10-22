// Whether a folder lies inside the user's temporary folder on Windows (worfy-windows ticket 61).
// Windows Storage Sense deletes files from %TEMP% when the disk runs low, and a checkout there loses
// packages from node_modules (worfy-windows ticket 52). "Add project" and the worktree badges warn;
// adding such a folder stays allowed.
//
// The settings of Storage Sense are not read: the warning stands whenever the folder is inside
// %TEMP%. Storage Sense can be turned on at any later time, so a folder that is safe today is not
// safe for good, and reading the registry would cost a process per check. A %TEMP% moved on purpose
// to a folder Storage Sense does not clean gets the warning too.
import { isWindowsAbsolutePath } from '../../shared/paths'
import { isInsidePath } from '../claude-home/registry'
import { realpathOrSelf } from './real-path'

/** What the check reads from the system; tests model Windows with stand-ins. */
export interface TempPlace {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  /** The long spelling of a folder (the long name of a short 8.3 one); the path itself when it cannot be read. */
  realpath: (path: string) => string
}

/** %TEMP% of the user as os.tmpdir() picks it on Windows: TEMP, else TMP; null when neither names a folder. */
function userTemp(env: TempPlace['env']): string | null {
  const temp = env.TEMP || env.TMP
  return temp !== undefined && isWindowsAbsolutePath(temp) ? temp : null
}

/**
 * Whether `path` is %TEMP% of the user or a folder inside it. Both are compared after realpath (so
 * `ALEXEY~1` and `Alexey` match), without regard to case or to `/` against `\`; `Temp2` is not
 * inside `Temp`. Off Windows always false: there is no Storage Sense there.
 */
export function insideUserTemp(path: string, place: Partial<TempPlace> = {}): boolean {
  if ((place.platform ?? process.platform) !== 'win32') return false
  const temp = userTemp(place.env ?? process.env)
  if (temp === null || !isWindowsAbsolutePath(path)) return false
  const realpath = place.realpath ?? realpathOrSelf
  return isInsidePath(realpath(path), realpath(temp), 'win32')
}
