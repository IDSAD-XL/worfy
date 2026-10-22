// Settings → Browser (worfy-browser ticket 05, ADR-0078 items 6 and 7): when a Live Browser goes to
// sleep. "Live browsers at once" — how many Browsers of this Machine are Live at the same time (each
// is a Chromium process); "Sleep when off screen after" — how long a Browser no window shows at a
// readable zoom stays Live; "Sleep when unused after" — how long one without the focus and without a
// Session's call stays Live; "Readable from zoom" — the zoom of the Canvas below which a page counts
// as not read. All four are app settings of this Machine (`browserSleep`,
// src/shared/settings/app-settings.ts): main reads them at every check of the rules
// (src/main/browser/live.ts). A choice is kept as the person's own; a value set outside these lists
// (by hand in app-settings.json) is shown as it is.
import { useState } from 'react'
import { browserSleepOf, type BrowserSleep, type BrowserSleepChoice } from '../../shared/settings/app-settings'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 67
export const title = 'Browser'

export const MAX_LIVE_LABEL = 'Live browsers at once'
export const OFFSCREEN_LABEL = 'Sleep when off screen after'
export const IDLE_LABEL = 'Sleep when unused after'
export const ZOOM_LABEL = 'Readable from zoom'

const seconds = (value: number): string => (value < 60 ? `${value} s` : value % 60 === 0 ? `${value / 60} min` : `${Math.floor(value / 60)} min ${value % 60} s`)
const minutes = (value: number): string => (value < 60 ? `${value} min` : value % 60 === 0 ? `${value / 60} h` : `${Math.floor(value / 60)} h ${value % 60} min`)
const percent = (value: number): string => `${Math.round(value * 100)} %`

/** The offered values of each setting with their labels. */
const OFFERED: { [K in keyof BrowserSleep]: { values: readonly number[]; label: (value: number) => string } } = {
  maxLive: { values: [1, 2, 3, 4, 5, 6, 8, 10], label: String },
  offscreenSeconds: { values: [10, 30, 60, 120, 300, 600], label: seconds },
  idleMinutes: { values: [1, 2, 5, 10, 15, 30, 60], label: minutes },
  zoom: { values: [0.25, 0.3, 0.4, 0.5, 0.6, 0.75], label: percent },
}

/** The options of setting `field`, with its current value among them when it is not one of the offered. */
function optionsOf(field: keyof BrowserSleep, current: number): SelectOption[] {
  const { values, label } = OFFERED[field]
  return [...new Set([...values, current])].sort((a, b) => a - b).map((value) => ({ value: String(value), label: label(value) }))
}

export default function BrowserSection() {
  // One selector per field: each answers a number, which the store compares by value.
  const sleep: BrowserSleep = {
    maxLive: useAppSettings((settings) => browserSleepOf(settings).maxLive),
    offscreenSeconds: useAppSettings((settings) => browserSleepOf(settings).offscreenSeconds),
    idleMinutes: useAppSettings((settings) => browserSleepOf(settings).idleMinutes),
    zoom: useAppSettings((settings) => browserSleepOf(settings).zoom),
  }
  const [problem, setProblem] = useState<string>()
  const choose = (choice: BrowserSleepChoice): void => {
    void setAppSettings({ browserSleep: choice }).then(setProblem)
  }
  const row = (field: keyof BrowserSleep, label: string, description: string) => (
    <SettingRow label={label} description={description} testId={`settings-browser-${field}-row`}>
      <Select aria-label={label} value={String(sleep[field])} options={optionsOf(field, sleep[field])} onChange={(value) => choose({ [field]: Number(value) })} data-testid={`settings-browser-${field}`} />
    </SettingRow>
  )

  return (
    <>
      {row('maxLive', MAX_LIVE_LABEL, 'Each Live Browser is a page process of its own. Opening one more puts to sleep the Browser used longest ago.')}
      {row('offscreenSeconds', OFFSCREEN_LABEL, 'A Browser no window shows at a readable zoom sleeps this long after; a Session driving it keeps it Live.')}
      {row('idleMinutes', IDLE_LABEL, 'A Browser without the focus and without a Session’s action sleeps this long after.')}
      {row('zoom', ZOOM_LABEL, 'Below this zoom of the Canvas a page counts as off screen.')}
      {problem !== undefined ? (
        <p role="alert" className="w-setting-row__description" data-testid="settings-browser-problem">
          Not saved: {problem}
        </p>
      ) : null}
    </>
  )
}
