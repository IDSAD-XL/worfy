// The fields of a Profile form, shared by the Review step of "Add project" (ConnectProject.tsx) and
// "Edit profile" of Project settings (EditProfile.tsx, worfy-polish ticket 78): a labelled field with the
// Harness's reasons under it, a text input, a list input and a choice of fixed values. The look is the
// first-run screen's (docs/design/F-SPEC.md, "First run"); the focus ring of the inputs is
// connect-project.css; the styles and the path helpers are profile-fields.ts.
import { useId, type CSSProperties, type ReactNode } from 'react'
import './connect-project.css'
import { Select } from '../theme/Select'
import { fieldStyles, issuesAt, list, text, words, type FieldIssue } from './profile-fields'

interface FieldProps {
  label: string
  path: string
  issues: readonly FieldIssue[]
  /** A line under the input, before the problems. */
  hint?: string
  children: (props: { id: string; invalid: boolean; describedBy: string | undefined }) => ReactNode
}

/** A labelled field with its problems under it. */
export function Field({ label, path, issues, hint, children }: FieldProps) {
  const id = useId()
  const errorId = useId()
  const hintId = useId()
  const own = issuesAt(issues, path)
  const describedBy = [hint === undefined ? null : hintId, own.length > 0 ? errorId : null].filter((each) => each !== null).join(' ')
  return (
    <div style={fieldStyles.field} data-field={path}>
      <label htmlFor={id} style={fieldStyles.label}>
        {label}
      </label>
      {children({ id, invalid: own.length > 0, describedBy: describedBy === '' ? undefined : describedBy })}
      {hint === undefined ? null : (
        <span id={hintId} style={fieldStyles.hint}>
          {hint}
        </span>
      )}
      {own.length > 0 ? (
        <span id={errorId} role="alert" style={fieldStyles.fieldError} data-testid="connect-field-error">
          {own.map((issue) => issue.message).join('; ')}
        </span>
      ) : null}
    </div>
  )
}

interface InputProps<V> {
  /** The path the Harness names the field by: its problems are those at this path or below it. */
  path: string
  label: string
  value: unknown
  issues: readonly FieldIssue[]
  disabled: boolean
  hint?: string
  onChange: (value: V) => void
}

const inputStyle = (invalid: boolean): CSSProperties => (invalid ? { ...fieldStyles.input, ...fieldStyles.invalid } : fieldStyles.input)

/**
 * A text field; an empty one is null, or `""` with `emptyAs=""`: a field the Harness requires a text in
 * (commands.verify, tickets.path), where null would mean "none" and pass its check, while `""` is refused at the field.
 */
export function TextField({ path, label, value, issues, disabled, hint, emptyAs = null, onChange }: InputProps<string | null> & { emptyAs?: '' | null }) {
  return (
    <Field label={label} path={path} issues={issues} hint={hint}>
      {({ id, invalid, describedBy }) => (
        <input
          id={id}
          className="w-connect-input"
          style={inputStyle(invalid)}
          value={text(value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === '' ? emptyAs : event.target.value)}
        />
      )}
    </Field>
  )
}

/**
 * A list of words separated by `separator` (", " or " "); the input keeps what is typed, the value is the words.
 * An empty input is `[]`, or null with `emptyAs={null}`: a field the Profile did not have stays absent, since
 * `[]` in skills.allowed or mcp.allowed means "none" and absent means "all".
 */
export function ListField({ path, label, value, issues, disabled, hint, separator, emptyAs = [], onChange }: InputProps<string[] | null> & { separator: ', ' | ' '; emptyAs?: [] | null }) {
  return (
    <Field label={label} path={path} issues={issues} hint={hint}>
      {({ id, invalid, describedBy }) => (
        <input
          id={id}
          className="w-connect-input"
          style={inputStyle(invalid)}
          defaultValue={list(value, separator)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={(event) => {
            const value = words(event.target.value, separator === ' ' ? /\s+/ : /,/)
            onChange(value.length === 0 ? emptyAs : value)
          }}
        />
      )}
    </Field>
  )
}

/**
 * One of fixed values; a value the list does not have (a Profile written by hand) shows as it is, first.
 * With `empty`, the first option is no value (null), under that label: the Harness's default.
 */
export function SelectField({ path, label, value, issues, disabled, hint, options, empty, onChange }: InputProps<string | null> & { options: readonly string[]; empty?: string }) {
  const shown = text(value)
  const all = shown !== '' && !options.includes(shown) ? [shown, ...options] : options
  const choices = [...(empty === undefined ? [] : [{ value: '', label: empty }]), ...all.map((option) => ({ value: option, label: option }))]
  return (
    <Field label={label} path={path} issues={issues} hint={hint}>
      {({ id, invalid, describedBy }) => (
        <Select
          id={id}
          className="w-connect-input"
          style={inputStyle(invalid)}
          value={shown}
          options={choices}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onChange={(next) => onChange(next === '' && empty !== undefined ? null : next)}
        />
      )}
    </Field>
  )
}
