// The values and the look of a Profile form, shared by the Review step of "Add project" (ConnectProject.tsx)
// and "Edit profile" of Project settings (EditProfile.tsx, worfy-polish ticket 78): the styles of a field,
// and the helpers that read and set a dotted path of a Profile. The fields themselves are ProfileFields.tsx.
import type { CSSProperties } from 'react'

export const fieldStyles = {
  section: { margin: '0 0 var(--space-4)' },
  sectionTitle: { margin: '0 0 var(--space-2)', color: 'var(--text-muted)', fontSize: 'var(--text-11)', fontWeight: 600 },
  mono: { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-12)', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-2)' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 'var(--space-3)' },
  label: { fontSize: 'var(--text-12)', fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
    minWidth: 0,
  },
  readOnly: { padding: '4px var(--space-2)', borderRadius: 'var(--radius-button)', border: '1px solid var(--border)', background: 'var(--surface-raised)' },
  hint: { color: 'var(--text-muted)', fontSize: 'var(--text-11)' },
  fieldError: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)' },
  /** An input whose value the Harness refused: the blocked colour on its border (the focus ring is connect-project.css). */
  invalid: { borderColor: 'var(--blocked-text)' },
} satisfies Record<string, CSSProperties>

/** A reason the Harness gave for a field: the path of the field (or of a part of it) and the message. */
export interface FieldIssue {
  path: string
  message: string
}

type Json = Record<string, unknown>
export const isJson = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The value at a dotted path of the profile. */
export function getAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((at, key) => (isJson(at) ? at[key] : undefined), value)
}

/** A copy of `value` with `path` set to `next`. */
export function setAt(value: Json, path: readonly string[], next: unknown): Json {
  const [key, ...rest] = path
  if (key === undefined) return value
  return { ...value, [key]: rest.length === 0 ? next : setAt(isJson(value[key]) ? value[key] : {}, rest, next) }
}

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')
export const list = (value: unknown, separator: string): string => (Array.isArray(value) ? value.filter((item) => typeof item === 'string').join(separator) : '')
export const words = (input: string, split: RegExp): string[] =>
  input
    .split(split)
    .map((word) => word.trim())
    .filter((word) => word !== '')

/** The problems of one field: its own path, or a path below it. */
export const issuesAt = <T extends FieldIssue>(issues: readonly T[], path: string): T[] =>
  issues.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`))

