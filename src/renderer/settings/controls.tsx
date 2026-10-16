// The shared parts of Settings sections: a row with a label, a hint and its control, and a
// switch. Every section builds from these, so the sections look alike: a slider, a SettingSwitch
// or a Select goes into a SettingRow.
import type { ReactNode } from 'react'
import './settings.css'

export interface SettingRowProps {
  label: ReactNode
  /** One or two lines under the label, in 12 px secondary text. */
  description?: ReactNode
  /** The control at the right: a slider, a SettingSwitch, a Select, a value. */
  children: ReactNode
  testId?: string
}

/** One setting: the label and its hint on the left, the control on the right. */
export function SettingRow({ label, description, children, testId }: SettingRowProps) {
  return (
    <div className="w-setting-row" data-testid={testId}>
      <div className="w-setting-row__text">
        <div className="w-setting-row__label">{label}</div>
        {description !== undefined ? <div className="w-setting-row__description">{description}</div> : null}
      </div>
      <div className="w-setting-row__control">{children}</div>
    </div>
  )
}

export interface SettingSwitchProps {
  /** The accessible name: what the switch turns on. */
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** The tooltip, which a screen reader reads as the description: why a disabled switch is disabled. */
  title?: string
  testId?: string
}

/** An on/off switch; a click asks for the other value, a disabled switch asks for nothing. */
export function SettingSwitch({ label, checked, onChange, disabled = false, title, testId }: SettingSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      className="w-setting-switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      data-testid={testId}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked)
      }}
    >
      <span aria-hidden="true" className="w-setting-switch__thumb" />
    </button>
  )
}
