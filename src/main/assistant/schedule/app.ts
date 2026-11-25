// The scheduler of the Assistant's checks in the running app (worfy-assistant ticket 04): one for the
// Machine, over main's clock (src/main/clock.ts), the app settings of this Machine
// (src/main/settings/store.ts) and the marks of the checks in assistant-check-marks.json of worfy's data
// folder (ADR-0005). startCheckScheduler() starts it once the app is ready and follows the system's sleep
// and the changes of the settings; the checks of sources register on checkScheduler() by their kind.
import { join } from 'node:path'
import { appNow } from '../../clock'
import { appSettingsStore } from '../../settings/store'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'
import { dataRoot } from '../../storage/paths'
import { CheckScheduler, checkMarksSchema, followPower, type CheckMarksStore, type PowerEvents } from './scheduler'

export const CHECK_MARKS_FILE = 'assistant-check-marks.json'

/**
 * Marks in `file`: no file, or an unreadable one (set aside by readJsonFile), reads as no marks — every
 * kind then goes once at start, as a kind that never ran.
 */
export function fileCheckMarks(file: string): CheckMarksStore {
  return {
    read: () => {
      try {
        return readJsonFile(file, checkMarksSchema) ?? {}
      } catch (error) {
        console.warn(`[assistant] ${file} could not be read, the checks start without marks: ${error instanceof Error ? error.message : String(error)}`)
        return {}
      }
    },
    write: (marks) => writeJsonFile(file, checkMarksSchema, marks),
  }
}

let shared: CheckScheduler | undefined

/** The scheduler of the running app; creating it reads no disk. */
export function checkScheduler(): CheckScheduler {
  shared ??= new CheckScheduler({ now: appNow, settings: () => appSettingsStore().get(), marks: fileCheckMarks(join(dataRoot(), CHECK_MARKS_FILE)) })
  return shared
}

/** Starts the scheduler, follows `power` and the settings; answers a function that stops all of it. */
export function startCheckScheduler(power: PowerEvents): () => void {
  const scheduler = checkScheduler()
  const reschedule = (): void => scheduler.reschedule()
  appSettingsStore().on('changed', reschedule)
  const stopPower = followPower(scheduler, power)
  scheduler.start()
  return () => {
    scheduler.stop()
    stopPower()
    appSettingsStore().off('changed', reschedule)
  }
}
