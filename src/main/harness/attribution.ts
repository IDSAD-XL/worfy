// The default of a Profile's `attribution` by its mode (ADR-0061): `off` in Silent mode, whose
// repository and PRs show no trace of the workflow, `on` in Full mode.
//
// The rule itself is the Harness's: harness/bin/profile applies it to a Profile without the field.
// This is its copy for the two places where worfy names a value before any Profile exists — the
// draft of "Add project" (src/main/projects/connect.ts) and the move of schema 1 Profiles
// (src/main/harness/migrate/profiles.ts). test/contract/projects-connect.test.ts holds the copy to
// what bin/profile prints, in both modes.

export type ProfileMode = 'full' | 'silent'
export type ProfileAttribution = 'on' | 'off'

/** What `bin/profile --field attribution` prints for a Profile of `mode` that does not set the field. */
export function defaultAttribution(mode: ProfileMode): ProfileAttribution {
  return mode === 'silent' ? 'off' : 'on'
}
