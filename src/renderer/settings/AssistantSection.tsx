// Settings → Assistant (worfy-assistant tickets 15 and 25; owner's decisions 5, 7, 10, 17 and 20; stories 12–15, 17–20,
// 34 and 35), after the prototype Card the owner accepted: four tabs.
// - General: the switch of the Assistant on this Mac (off until turned on; on, only worfy's own duties work and each
//   outside source is turned on by itself) with «On since …», the work hours (days, one window, the time zone), each
//   check of a source — on, interval, sleep outside work hours — with its failures in a row and Check now (ticket 22),
//   and the notifications: the speech card in the window (urgent and batched, urgent only, none) and the system one.
// - Duties: each duty on or off, its threshold, the Projects of this Machine it covers, the mode of each action (only
//   the modes the action may have), its counters and its pause with Resume; how many ignored or disliked items in a row
//   pause a duty.
// - Usage and limits: the tokens of the day or the week by source, by wake and for the conversation, the share of each
//   Limits window marked as an estimate, and the daily limit of automatic wakes.
// - Memory: the rules the user's dislikes wrote, each with Delete.
// The switch, the work hours, the checks, the notifications and the daily limit are app settings of this Machine
// (`assistant` and `assistantSchedule`); the rest is main's (useAssistantSettings.ts). The texts are English (docs/design/BRIEF.md).
import { useState, type ReactElement } from 'react'
import { DUTY_ACTION_MODES, type DutyActionMode } from '../../shared/assistant/duties'
import { CHECK_KINDS, checkSettingsOf, workHoursOf, type CheckKind, type CheckSettings } from '../../shared/assistant/schedule/settings'
import { DEFAULT_WORK_HOURS, machineTimeZone, WEEKDAYS, type WorkHours } from '../../shared/assistant/schedule/work-hours'
import { ACTION_LABELS, CHECK_LABELS, intervalText, MODE_LABELS, minuteText } from '../../shared/assistant/settings-change'
import type { AssistantSettingsView, SettingsCheck, SettingsDuty, UsagePeriodView } from '../../shared/assistant/settings-view'
import { assistantOn, assistantOnSince, DAILY_WAKE_LIMIT_BOUNDS, dailyWakeLimitOf, inWindowOf, systemNoticesOf, type InWindowNotices } from '../../shared/assistant/settings'
import type { AppSettingsPatch } from '../../shared/settings/app-settings'
import { forgetRule } from '../assistant/useAssistant'
import { Tab, TabList, TabPanel, Tabs } from '../theme/kit/Tabs'
import { ToggleGroup, ToggleGroupItem } from '../theme/kit/ToggleGroup'
import { Select, type SelectOption } from '../theme/Select'
import './assistant-settings.css'
import { SettingRow, SettingSwitch } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'
import { failureLine, onSinceText, timeText, tokensText } from './assistant-settings-format'
import { checkNow, configureDuty, resumeDuty, setPauseAfter, useAssistantSettings } from './useAssistantSettings'
import type { SettingsGroup, SettingsIconName } from './sections'

export const order = 55
export const title = 'Assistant'
export const group: SettingsGroup = 'Agents'
export const icon: SettingsIconName = 'spark'

export const SWITCH_LABEL = 'Assistant on this Mac'

type SettingsTab = 'general' | 'duties' | 'usage' | 'memory'

const TABS: readonly { tab: SettingsTab; label: string }[] = [
  { tab: 'general', label: 'General' },
  { tab: 'duties', label: 'Duties' },
  { tab: 'usage', label: 'Usage and limits' },
  { tab: 'memory', label: 'Memory' },
]

const DAY_NAMES: Readonly<Record<(typeof WEEKDAYS)[number], string>> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }

/** The options of a time of day: every half hour, with the current one among them. */
function minuteOptions(current: number): SelectOption[] {
  const minutes = new Set<number>(Array.from({ length: 48 }, (_unused, half) => half * 30))
  minutes.add(current)
  return [...minutes].sort((a, b) => a - b).map((minute) => ({ value: String(minute), label: minuteText(minute) }))
}

/** The zones offered: this Mac's, UTC, every zone Intl knows, and the current one. */
function zoneOptions(current: string | undefined): SelectOption[] {
  const known = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  const zones = [...new Set<string>(['UTC', ...known, ...(current === undefined ? [] : [current])])]
  return [{ value: '', label: `This Mac's zone (${machineTimeZone()})` }, ...zones.map((zone) => ({ value: zone, label: zone }))]
}

const INTERVALS = [5, 10, 15, 20, 30, 60, 120, 240, 480, 1440] as const

const withCurrent = (values: readonly number[], current: number): number[] => [...new Set<number>([...values, current])].sort((a, b) => a - b)

const WINDOW_LABELS: Readonly<Record<string, string>> = { five_hour: '5-hour window', seven_day: 'weekly window' }

const IN_WINDOW_OPTIONS: readonly SelectOption<InWindowNotices>[] = [
  { value: 'batched', label: 'Urgent and batched' },
  { value: 'urgent', label: 'Urgent only' },
  { value: 'none', label: 'None: the list only' },
]

function useChoose(): [string | undefined, (patch: AppSettingsPatch) => void] {
  const [problem, setProblem] = useState<string>()
  return [problem, (patch) => void setAppSettings(patch).then(setProblem)]
}

function WorkHoursRows({ hours, choose }: { hours: WorkHours; choose: (hours: WorkHours) => void }): ReactElement {
  const first = hours.windows[0] ?? DEFAULT_WORK_HOURS.windows[0]!
  const others = hours.windows.slice(1)
  const setWindow = (edge: 'from' | 'to', minute: number): void => {
    const next = { ...first, [edge]: minute }
    if (next.from !== next.to) choose({ ...hours, windows: [next, ...others] })
  }
  return (
    <>
      <SettingRow label="Work days" description="Checks that sleep wait outside work hours. Urgent items still reach you." testId="settings-assistant-days">
        <span className="w-asst-set__days">
          {WEEKDAYS.map((day) => {
            const on = hours.days.includes(day)
            return (
              <button
                key={day}
                type="button"
                className="w-asst-set__day"
                aria-pressed={on}
                // The last day stays: work hours need one.
                disabled={on && hours.days.length === 1}
                onClick={() => choose({ ...hours, days: WEEKDAYS.filter((each) => (each === day ? !on : hours.days.includes(each))) })}
              >
                {DAY_NAMES[day]}
              </button>
            )
          })}
        </span>
      </SettingRow>
      <SettingRow label="Work hours" description={others.length > 0 ? `Also ${others.map((each) => `${minuteText(each.from)}–${minuteText(each.to)}`).join(', ')}.` : 'A window may go across midnight.'}>
        <span className="w-asst-set__inline">
          <Select aria-label="Work hours from" value={String(first.from)} options={minuteOptions(first.from)} onChange={(value) => setWindow('from', Number(value))} />
          <span className="w-asst-set__muted">to</span>
          <Select aria-label="Work hours to" value={String(first.to)} options={minuteOptions(first.to)} onChange={(value) => setWindow('to', Number(value))} />
        </span>
      </SettingRow>
      <SettingRow label="Time zone">
        <Select
          aria-label="Time zone"
          value={hours.timeZone ?? ''}
          options={zoneOptions(hours.timeZone)}
          onChange={(value) => choose({ days: hours.days, windows: hours.windows, ...(value === '' ? {} : { timeZone: value }) })}
        />
      </SettingRow>
    </>
  )
}

function CheckRow({ kind, check, choose }: { kind: CheckKind; check: SettingsCheck | undefined; choose: (patch: AppSettingsPatch) => void }): ReactElement {
  // One value per selector: a selector that builds an object would give a new one on every render.
  const settings = {
    enabled: useAppSettings((all) => checkSettingsOf(all, kind).enabled),
    intervalMinutes: useAppSettings((all) => checkSettingsOf(all, kind).intervalMinutes),
    sleepOutsideWorkHours: useAppSettings((all) => checkSettingsOf(all, kind).sleepOutsideWorkHours),
  }
  const name = CHECK_LABELS[kind]
  const change = (field: Partial<CheckSettings>): void => choose({ assistantSchedule: { checks: { [kind]: field } } })
  return (
    <div className="w-asst-set__check" data-testid={`settings-assistant-check-${kind}`}>
      <div className="w-asst-set__check-row">
        <span className="w-asst-set__check-name">{name}</span>
        <Select aria-label={`${name} interval`} value={String(settings.intervalMinutes)} options={withCurrent(INTERVALS, settings.intervalMinutes).map((minutes) => ({ value: String(minutes), label: intervalText(minutes) }))} onChange={(value) => change({ intervalMinutes: Number(value) })} />
        <label className="w-asst-set__inline">
          <SettingSwitch label={`${name} sleeps outside work hours`} checked={settings.sleepOutsideWorkHours} onChange={(next) => change({ sleepOutsideWorkHours: next })} />
          <span className="w-asst-set__muted">{settings.sleepOutsideWorkHours ? 'Sleeps outside work hours' : 'Keeps checking'}</span>
        </label>
        <SettingSwitch label={`${name} check`} checked={settings.enabled} onChange={(next) => change({ enabled: next })} />
      </div>
      {check !== undefined && check.failures > 0 ? (
        <div className="w-asst-set__failures" role="status" data-testid={`settings-assistant-failures-${kind}`}>
          <span>{failureLine(check)}</span>
          {/* A check the person turned off is not read on a click either. */}
          <button type="button" className="w-action" disabled={check.running || !settings.enabled} title={settings.enabled ? undefined : 'Turn the check on to run it'} onClick={() => void checkNow(kind)}>
            Check now
          </button>
        </div>
      ) : null}
    </div>
  )
}

function General({ view }: { view: AssistantSettingsView | null }): ReactElement {
  const on = useAppSettings(assistantOn)
  const onSince = useAppSettings(assistantOnSince)
  const inWindow = useAppSettings(inWindowOf)
  const systemNotices = useAppSettings(systemNoticesOf)
  const hours = useAppSettings(workHoursOf)
  // «today» or «yesterday» of «On since …» is read against the moment the section opened.
  const [openedAt] = useState(() => Date.now())
  const [problem, choose] = useChoose()
  const status = !on ? 'Off. worfy runs no part of it: no wake, no check of a source.' : view?.running === false ? 'On, but it has not started: worfy could not read the events of the Projects.' : 'On. Only worfy’s own duties work until you turn a source on below.'
  return (
    <>
      <SettingRow label={SWITCH_LABEL} description={status} testId="settings-assistant-switch-row">
        <span className="w-asst-set__inline">
          {/* Turned on before ticket 25 kept the time: no line then. */}
          {onSince === null ? null : (
            <span className="w-asst-set__muted" data-testid="settings-assistant-on-since">
              {onSinceText(onSince, Math.max(openedAt, onSince))}
            </span>
          )}
          <SettingSwitch label={SWITCH_LABEL} checked={on} onChange={(next) => choose({ assistant: { on: next } })} testId="settings-assistant-switch" />
        </span>
      </SettingRow>
      <WorkHoursRows hours={hours} choose={(next) => choose({ assistantSchedule: { workHours: next } })} />
      <div className="w-asst-set__group">Checks</div>
      <p className="w-asst-set__note">Each source is off until you turn it on. Slack and Jira are read through your claude.ai connectors.</p>
      <div data-testid="settings-assistant-checks">
        {CHECK_KINDS.map((kind) => (
          <CheckRow key={kind} kind={kind} check={view?.checks.find((each) => each.kind === kind)} choose={choose} />
        ))}
      </div>
      <div className="w-asst-set__group">Notifications</div>
      <SettingRow label="In the window" description="A speech card next to the Assistant icon, one at a time." testId="settings-assistant-in-window">
        <Select aria-label="In the window" value={inWindow} options={IN_WINDOW_OPTIONS} onChange={(value) => choose({ assistant: { inWindow: value } })} />
      </SettingRow>
      <SettingRow label="System notifications" description="Titled “worfy Assistant”, when worfy is not in front." testId="settings-assistant-system-notices">
        <span className="w-asst-set__inline">
          <span className="w-asst-set__muted">Urgent only, in work hours</span>
          <SettingSwitch label="System notifications" checked={systemNotices} onChange={(next) => choose({ assistant: { systemNotices: next } })} testId="settings-assistant-system-notices-switch" />
        </span>
      </SettingRow>
      {problem !== undefined ? (
        <p role="alert" className="w-setting-row__description">
          Not saved: {problem}
        </p>
      ) : null}
    </>
  )
}

const COUNTER_LABELS = [
  ['shown', 'Shown'],
  ['accepted', 'Accepted'],
  ['declined', 'Dismissed'],
  ['ignored', 'Ignored'],
  ['liked', 'Liked'],
  ['disliked', 'Disliked'],
] as const

const THRESHOLDS = [5, 10, 15, 30, 60, 120, 240] as const

/**
 * The Projects a duty covers (ticket 25): All Projects, or the Projects of this Machine picked one by one — a Linked
 * machine's are not here (ticket 18). Unpicking the last one goes back to All Projects. None for a duty whose scope is not
 * by Project (`projects: null`).
 */
function DutyProjects({ duty, projects }: { duty: SettingsDuty; projects: AssistantSettingsView['projects'] }): ReactElement | null {
  if (duty.projects === null || projects.length === 0) return null
  const all = duty.projects === 'all'
  const known = new Set(projects.map((project) => project.id))
  // A Project removed since it was picked is not offered again.
  const picked = all ? [] : (duty.projects as readonly string[]).filter((id) => known.has(id))
  const toggle = (id: string): void => {
    const next = picked.includes(id) ? picked.filter((each) => each !== id) : [...picked, id]
    void configureDuty(duty.id, { projects: next.length === 0 ? 'all' : next })
  }
  return (
    // The buttons keep their text on one line and wrap as a row; a long name ends in an ellipsis, read whole in the
    // tooltip (worfy-polish 159).
    <div className="w-asst-set__action w-asst-set__action--projects" data-testid={`settings-assistant-duty-projects-${duty.id}`}>
      <span className="w-asst-set__action-label">Projects</span>
      <span className="w-asst-set__chips" role="group" aria-label={`${duty.title}: Projects`}>
        <button type="button" className="w-asst-set__day w-asst-set__project" aria-pressed={all} onClick={() => (all ? undefined : void configureDuty(duty.id, { projects: 'all' }))}>
          All Projects
        </button>
        {projects.map((project) => (
          <button key={project.id} type="button" className="w-asst-set__day w-asst-set__project" title={project.name} aria-pressed={picked.includes(project.id)} onClick={() => toggle(project.id)}>
            {project.name}
          </button>
        ))}
      </span>
    </div>
  )
}

function DutyCard({ duty, projects }: { duty: SettingsDuty; projects: AssistantSettingsView['projects'] }): ReactElement {
  return (
    <article className="w-asst-set__duty" data-paused={duty.paused === null ? undefined : ''} data-testid={`settings-assistant-duty-${duty.id}`}>
      <div className="w-asst-set__duty-head">
        <SettingSwitch label={duty.title} checked={duty.enabled} onChange={(next) => void configureDuty(duty.id, { enabled: next })} />
        <div className="w-asst-set__duty-name">
          <span>{duty.title}</span>
          {duty.projectName !== null ? <span className="w-asst-set__chip">Rule of {duty.projectName}</span> : null}
          <span className="w-asst-set__muted">{duty.sources.join(', ')}</span>
        </div>
        {duty.thresholdMinutes !== null ? (
          <Select
            aria-label={`${duty.title}: threshold`}
            value={String(duty.thresholdMinutes)}
            options={withCurrent(THRESHOLDS, duty.thresholdMinutes).map((minutes) => ({ value: String(minutes), label: `After ${minutes} min` }))}
            onChange={(value) => void configureDuty(duty.id, { thresholdMinutes: Number(value) })}
          />
        ) : null}
      </div>
      <DutyProjects duty={duty} projects={projects} />
      <div className="w-asst-set__counters">
        {COUNTER_LABELS.map(([counter, label]) => (
          <span key={counter}>
            {label} <b>{duty.counters[counter]}</b>
          </span>
        ))}
      </div>
      {duty.paused !== null ? (
        <div className="w-asst-set__paused" role="status">
          <span>
            Paused at {timeText(duty.paused.at)}: {duty.paused.by === 'ignored' ? 'its suggestions were ignored' : 'you disliked its items'} too many times in a row. Its items are not shown.
          </span>
          <button type="button" className="w-action" onClick={() => void resumeDuty(duty.id)}>
            Resume
          </button>
        </div>
      ) : null}
      {duty.actions.map((action) => (
        <div key={action.action} className="w-asst-set__action">
          <span className="w-asst-set__action-label">{ACTION_LABELS[action.action]}</span>
          <ToggleGroup
            className="w-asst-set__modes"
            aria-label={ACTION_LABELS[action.action]}
            value={action.mode}
            onValueChange={(mode: DutyActionMode | null) => {
              if (mode !== null && mode !== action.mode) void configureDuty(duty.id, { modes: { [action.action]: mode } })
            }}
          >
            {DUTY_ACTION_MODES.filter((mode) => action.allowed.includes(mode)).map((mode) => (
              <ToggleGroupItem key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ))}
    </article>
  )
}

function Duties({ view }: { view: AssistantSettingsView }): ReactElement {
  return (
    <>
      <p className="w-asst-set__note">Each duty has a trigger, a scope, a mode for each of its actions and counters. A rule of one Project lives in that Project’s settings.</p>
      <SettingRow label="Pause a duty after" description="Ignored suggestions or dislikes in a row.">
        <Select aria-label="Pause a duty after" value={String(view.pauseAfter)} options={withCurrent([3, 5, 10, 20], view.pauseAfter).map((count) => ({ value: String(count), label: `${count} in a row` }))} onChange={(value) => void setPauseAfter(Number(value))} />
      </SettingRow>
      {view.duties.map((duty) => (
        <DutyCard key={duty.id} duty={duty} projects={view.projects} />
      ))}
    </>
  )
}

function Usage({ view }: { view: AssistantSettingsView }): ReactElement {
  const [range, setRange] = useState<'day' | 'week'>('day')
  const limit = useAppSettings(dailyWakeLimitOf)
  const [problem, choose] = useChoose()
  const period: UsagePeriodView = view.usage[range]
  const rows: { label: string; detail: string; tokens: number }[] = [
    ...period.sources.map((source) => ({ label: `${CHECK_LABELS[source.source as CheckKind] ?? source.source} checks`, detail: `${source.calls} checks`, tokens: source.tokens })),
    { label: 'Wakes', detail: `${period.wakes.count} wakes`, tokens: period.wakes.total.tokens },
    { label: 'Conversation', detail: `${period.conversation.calls} messages`, tokens: period.conversation.tokens },
  ]
  return (
    <>
      <div className="w-asst-set__usage" data-testid="settings-assistant-usage">
        <div className="w-asst-set__group w-asst-set__inline">
          Assistant’s usage
          <span className="w-asst-set__range" role="group" aria-label="Period">
            <button type="button" aria-pressed={range === 'day'} onClick={() => setRange('day')}>
              Today
            </button>
            <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')}>
              This week
            </button>
          </span>
        </div>
        <div className="w-asst-set__stats">
          <div>
            <b>{tokensText(period.total.tokens)}</b> tokens, every call counted
          </div>
          {view.usage.shares.map((share) => (
            <div key={share.window}>
              <b>≈{share.share}%</b> of the {WINDOW_LABELS[share.window] ?? share.window} <span className="w-asst-set__chip">estimate</span>
              <span className="w-asst-set__muted"> · the window is at {Math.round(share.utilization)} %</span>
            </div>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.label} className="w-asst-set__bar">
            <span>
              {row.label} <span className="w-asst-set__muted">{row.detail}</span>
            </span>
            <span className="w-mono">{tokensText(row.tokens)}</span>
          </div>
        ))}
        {range === 'day' && period.wakes.byWake.length > 0 ? (
          <div className="w-asst-set__wakes">
            {period.wakes.byWake.map((wake) => (
              <span key={wake.id}>
                {timeText(wake.at)} {wake.urgent ? 'urgent' : 'batched'} · {tokensText(wake.tokens)}
              </span>
            ))}
          </div>
        ) : null}
        <p className="w-asst-set__note">Tokens are counted for every call: Assistant Sessions and each check of a source. The shares of the Limits are estimates: worfy sees only the whole percentage of each window, so the Assistant’s share is worked out from its own cost.</p>
      </div>
      <SettingRow label="Daily limit of automatic wakes" description={`Today: ${view.wakesToday} of ${limit}. Your own messages do not count.`} testId="settings-assistant-wake-limit">
        <Select
          aria-label="Daily limit of automatic wakes"
          value={String(limit)}
          options={withCurrent([5, 10, 20, 30, 50, 100, DAILY_WAKE_LIMIT_BOUNDS.max], limit).map((count) => ({ value: String(count), label: `${count} a day` }))}
          onChange={(value) => choose({ assistant: { dailyWakeLimit: Number(value) } })}
        />
      </SettingRow>
      {problem !== undefined ? (
        <p role="alert" className="w-setting-row__description">
          Not saved: {problem}
        </p>
      ) : null}
    </>
  )
}

function Memory({ view }: { view: AssistantSettingsView }): ReactElement {
  if (view.rules.length === 0) return <p className="w-asst-set__note">No rules yet. A dislike on an item writes one here.</p>
  return (
    <>
      <p className="w-asst-set__note">Rules the Assistant wrote from your dislikes. It follows them; delete one and its items show again.</p>
      {view.rules.map((rule) => (
        <div key={rule.id} className="w-asst-set__rule" data-testid="settings-assistant-rule">
          <span>{rule.text}</span>
          <button type="button" className="w-action" onClick={() => void forgetRule(rule.id)}>
            Delete
          </button>
        </div>
      ))}
    </>
  )
}

export default function AssistantSection() {
  const view = useAssistantSettings()
  const [tab, setTab] = useState<SettingsTab>('general')
  return (
    <Tabs value={tab} onValueChange={setTab} className="w-asst-set">
      <TabList className="w-asst-set__tabs" aria-label="Assistant settings">
        {TABS.map((each) => (
          <Tab key={each.tab} value={each.tab}>
            {each.label}
          </Tab>
        ))}
      </TabList>
      <TabPanel value="general">
        <General view={view} />
      </TabPanel>
      <TabPanel value="duties">{view === null ? null : <Duties view={view} />}</TabPanel>
      <TabPanel value="usage">{view === null ? null : <Usage view={view} />}</TabPanel>
      <TabPanel value="memory">{view === null ? null : <Memory view={view} />}</TabPanel>
    </Tabs>
  )
}
