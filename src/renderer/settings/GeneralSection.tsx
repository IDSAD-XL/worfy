// Settings → General: the interface scale of this Machine (a slider, 80–150 % by steps of 10 %),
// whether the toolbar shows worfy's own memory (worfy-ui ticket 20), the build version
// (`app.version`), numbered as the toolbar shows it with the build version next to it (worfy-update
// ticket 14), and, under it, the block "Updates" (worfy-update ticket 09, UpdatesBlock.tsx).
import { useEffect, useRef, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import { buildVersionTooltip, numberedVersion } from '../../shared/version-number'
import { INTERFACE_SCALE_MAX, INTERFACE_SCALE_MIN, INTERFACE_SCALE_STEP } from '../../shared/settings/app-settings'
import { invoke } from '../ipc'
import { SettingRow, SettingSwitch } from './controls'
import { UpdatesBlock } from './UpdatesBlock'
import { formatScale, scaleToPercent } from './interface-scale'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 10
export const title = 'General'

type Version = { kind: 'loading' } | { kind: 'ok'; version: string; number?: number | undefined } | { kind: 'failed'; reason: string }

/**
 * The interface scale: a native range input and the value next to it. While the thumb is dragged
 * only the value changes; the scale is applied when the browser reports `change` — the thumb was
 * let go, or a key made a step. Applied on every `input`, the window would zoom under the pointer,
 * the slider would move away from it, and the value would jump.
 */
function InterfaceScaleRow() {
  const scale = useAppSettings((settings) => settings.interfaceScale)
  // The percent under the thumb from the first `input` until main has answered the `change`;
  // undefined when the slider shows the scale in force.
  const [dragged, setDragged] = useState<number>()
  const [problem, setProblem] = useState<string>()
  const slider = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const element = slider.current
    if (element === null) return undefined
    // React's onChange is the browser's `input` event; the browser's own `change` has no prop.
    const commit = (): void => {
      const percent = Number(element.value)
      void setAppSettings({ interfaceScale: percent / 100 }).then((error) => {
        setProblem(error)
        // Back to the scale in force, unless the thumb has been taken somewhere else meanwhile.
        setDragged((now) => (now === percent ? undefined : now))
      })
    }
    element.addEventListener('change', commit)
    return () => element.removeEventListener('change', commit)
  }, [])

  const shown = dragged === undefined ? scale : dragged / 100
  return (
    <SettingRow
      label="Interface scale"
      description={
        problem === undefined ? (
          'Zooms the whole window.'
        ) : (
          <span role="alert" data-testid="settings-interface-scale-problem">
            Not saved: {problem}
          </span>
        )
      }
      testId="settings-interface-scale-row"
    >
      <input
        ref={slider}
        type="range"
        className="w-setting-slider"
        min={scaleToPercent(INTERFACE_SCALE_MIN)}
        max={scaleToPercent(INTERFACE_SCALE_MAX)}
        step={scaleToPercent(INTERFACE_SCALE_STEP)}
        value={scaleToPercent(shown)}
        aria-label="Interface scale"
        aria-valuetext={formatScale(shown)}
        data-testid="settings-interface-scale"
        onChange={(event) => setDragged(Number(event.target.value))}
      />
      <span className="w-setting-value" data-testid="settings-interface-scale-value">
        {formatScale(shown)}
      </span>
    </SettingRow>
  )
}

/**
 * Whether the toolbar shows worfy's own memory (src/renderer/memory/AppMemory.tsx). Every open
 * window follows the change at once, through `appSettings.changed`.
 */
function MemoryIndicatorRow() {
  const enabled = useAppSettings((settings) => settings.memoryIndicator)
  const [problem, setProblem] = useState<string>()
  return (
    <SettingRow
      label="Memory in the toolbar"
      description={
        problem === undefined ? (
          "Shows how much memory worfy's own processes use, after the app version. Terminal sessions are not counted."
        ) : (
          <span role="alert" data-testid="settings-memory-indicator-problem">
            Not saved: {problem}
          </span>
        )
      }
      testId="settings-memory-indicator-row"
    >
      <SettingSwitch
        label="Show worfy's memory in the toolbar"
        checked={enabled}
        onChange={(next) => {
          void setAppSettings({ memoryIndicator: next }).then(setProblem)
        }}
        testId="settings-memory-indicator"
      />
    </SettingRow>
  )
}

export default function GeneralSection() {
  const [version, setVersion] = useState<Version>({ kind: 'loading' })

  useEffect(() => {
    let live = true
    void invoke('app.version').then((result) => {
      if (!live) return
      setVersion(result.ok ? { kind: 'ok', version: result.value.version, number: result.value.number } : { kind: 'failed', reason: failureReason('app.version', result.error) })
    })
    return () => {
      live = false
    }
  }, [])

  // The build version with its commit, next to the number; nothing when the version shows unnumbered.
  const build = version.kind === 'ok' && buildVersionTooltip(version.version, version.number) !== undefined ? version.version : undefined
  return (
    <>
      <InterfaceScaleRow />
      <MemoryIndicatorRow />
      <SettingRow label="Version" description="The build of worfy on this Machine." testId="settings-version-row">
        <span className="w-mono" style={{ fontSize: 'var(--text-12)', color: 'var(--text-secondary)' }} data-testid="settings-version" title={version.kind === 'failed' ? version.reason : undefined}>
          {version.kind === 'ok' ? numberedVersion(version.version, version.number) : version.kind === 'loading' ? '…' : 'unknown'}
        </span>
        {build === undefined ? null : (
          <span
            className="w-mono"
            style={{ fontSize: 'var(--text-12)', color: 'var(--text-muted)', marginLeft: 'var(--space-2)' }}
            data-testid="settings-build-version"
            title={buildVersionTooltip(build, version.kind === 'ok' ? version.number : undefined)}
          >
            ({build})
          </span>
        )}
      </SettingRow>
      <UpdatesBlock version={version.kind === 'ok' ? version.version : undefined} />
    </>
  )
}
