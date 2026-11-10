// The `profileEdit` domain (worfy-polish ticket 78): "Edit profile" of Project settings, the fields of a
// connected Project's Profile that the "Add project" form sets once, and those it does not show. The
// Profile is read, checked and written only through the Harness's `bin/profile-set --field <name>…`
// (ADR-0073; src/main/ipc/profile-edit.ts): worfy never writes `profile.json` itself (ADR-0002, ADR-0005).
// Every value is checked by the rules of the Harness's draft schema (`profiles/draft.schema.json`) before
// it is written, and once more by the write; a refusal names the field. The write goes ahead only while
// the Profile still has the fields the form read (the fingerprint of `read`).
//
// `mode` and `workflow.folder` are read and shown, never written by the form: they change only by moving the
// workflow files, `move` (worfy-polish ticket 81, `bin/profile-set --move`). `name` holds the Profile's folder
// and stays as it is.
//
// The channels are `project`, as `ecoMode`: a window that shows a Linked machine edits the Profile of that
// Machine's Project, and `bin/profile-set` runs on the Machine the Project lives on. Reading and checking
// are `read`; writing is `write`, open only with full access.
import { z } from 'zod'
import { absolutePathSchema } from '../paths'
import { invokeChannel } from './channels'
import { pipelineFingerprintSchema } from './pipeline'

/** The commands of a Profile, as the "Add project" form lists them. */
export const PROFILE_COMMANDS = ['install', 'lint', 'typecheck', 'test', 'test_one', 'contract', 'e2e', 'build', 'verify', 'prepare_tree'] as const

/** The fields "Edit profile" writes, by their dotted name in `profile.json`, in the order of the form. */
export const PROFILE_EDIT_FIELDS = [
  'title',
  ...PROFILE_COMMANDS.map((command) => `commands.${command}` as const),
  'tickets.path',
  'tickets.spec',
  'tickets.trail_section',
  'tickets.done_section',
  'tickets.branch',
  'workflow.finish',
  'review.lenses',
  'review.ticket_lenses',
  'mcp.allowed',
  'skills.allowed',
  'github.account',
  'docs.adr_dir',
  'docs.adr_status_label',
  'docs.feature_pages',
  'docs.context.path',
  'docs.handoff.path',
  'language.reports',
  'language.team',
  'language.docs',
  'attribution',
  'parallel',
  'worktree.root',
  'worktree.base',
  'worktree.implementer',
  'worktree.reviewer',
] as const
export type ProfileEditField = (typeof PROFILE_EDIT_FIELDS)[number]

/** The fields shown and never written here. */
export const PROFILE_FIXED_FIELDS = ['mode', 'workflow.folder'] as const

/** The value of each field as the file has it; null when absent. */
export const profileEditValuesSchema = z.record(z.string(), z.unknown())
export type ProfileEditValues = Record<string, unknown>

/** A refused value: the field (its dotted name, or a path inside it) and the reason. */
export const profileEditIssueSchema = z.object({ path: z.string(), message: z.string() })
export type ProfileEditIssue = z.output<typeof profileEditIssueSchema>

export const profileEditReadSchema = z.discriminatedUnion('available', [
  /** Not read: the Harness has no `bin/profile-set --field` of every field, or the root is no Project of this Machine. */
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    /** The Profile's name: its folder in the Harness. */
    name: z.string(),
    /** The fields of PROFILE_EDIT_FIELDS. */
    values: profileEditValuesSchema,
    /** `mode` and `workflow.folder`, shown without an edit. */
    fixed: profileEditValuesSchema,
    /** The fingerprint of `mode` and `workflow.folder` together: what `move` takes. */
    fixedFingerprint: pipelineFingerprintSchema,
    /** A move of the workflow files was stopped half-way (worfy quit, the machine went down): the next move rolls it back first. */
    interrupted: z.boolean(),
    /** The Project has several repositories: it stays in Silent mode, a move to Full mode is not offered. */
    severalRepos: z.boolean(),
    /** The fingerprint of the fields of PROFILE_EDIT_FIELDS together. */
    fingerprint: pipelineFingerprintSchema,
  }),
])
export type ProfileEditRead = z.output<typeof profileEditReadSchema>

/** The Profile of the Project at `root`. Writes nothing. */
export const profileEditRead = invokeChannel('profileEdit.read', z.object({ root: absolutePathSchema }), profileEditReadSchema, 'project', 'read')

const valuesInput = z.object({ root: absolutePathSchema, values: profileEditValuesSchema })

/** The problems of the values by the draft schema's rules (`bin/profile-set --check`), empty when none. Writes nothing. */
export const profileEditCheck = invokeChannel('profileEdit.check', valuesInput, z.array(profileEditIssueSchema), 'project', 'read')

export const profileEditWriteResultSchema = z.discriminatedUnion('status', [
  /** Written. `warning`: why the change was not committed in the Harness home's git; the write stays. */
  z.object({ status: z.literal('saved'), fingerprint: pipelineFingerprintSchema, warning: z.string().nullable() }),
  /** The Profile's fields are not the ones read: nothing written; the form reads them again. */
  z.object({ status: z.literal('conflict') }),
  /** Another write of the same Profile held its lock for the whole wait: nothing written, try again. */
  z.object({ status: z.literal('busy') }),
  /** `bin/profile-set` refused a value (exit 1): nothing written. `issues` name the fields; `reason` is its message. */
  z.object({ status: z.literal('invalid'), reason: z.string(), issues: z.array(profileEditIssueSchema) }),
])
export type ProfileEditWriteResult = z.output<typeof profileEditWriteResultSchema>

/**
 * Writes the fields: Save of "Edit profile". `expected` is the fingerprint `profileEdit.read` gave. `local`, as
 * `pipeline.write`: a Linked machine never writes this Machine's Profile, whose commands its gate runs.
 */
export const profileEditWrite = invokeChannel('profileEdit.write', valuesInput.extend({ expected: pipelineFingerprintSchema }), profileEditWriteResultSchema, 'local')

/** The modes a Project's workflow files can move to. */
export const profileModeSchema = z.enum(['full', 'silent'])
export type ProfileMode = z.output<typeof profileModeSchema>

export const profileMoveResultSchema = z.discriminatedUnion('status', [
  /**
   * Moved: the files committed on both sides, `mode` and `workflow.folder` written. `warning`: why the Profile
   * change was not committed in the Harness home's git. `ignored`: files the receiving side's .gitignore ignores,
   * committed there all the same. `recovered`: what this run did first with a move stopped half-way. `qmd`: the
   * Project's qmd collections, which still index the old place.
   */
  z.object({
    status: z.literal('moved'),
    mode: profileModeSchema,
    folder: z.string().nullable(),
    files: z.number().int().nonnegative(),
    warning: z.string().nullable(),
    ignored: z.array(z.string()),
    recovered: z.enum(['finished', 'rolled-back']).nullable(),
    qmd: z.array(z.string()),
  }),
  /** `mode` and `workflow.folder` are not the ones read: nothing moved; the form reads them again. */
  z.object({ status: z.literal('conflict') }),
  /** Another write of the same Profile held its lock for the whole wait: nothing moved, try again. */
  z.object({ status: z.literal('busy') }),
  /** Refused before anything was written, or failed and rolled back: `reason` says why; the Project stays in its mode. */
  z.object({ status: z.literal('refused'), reason: z.string() }),
  /** Failed, and the rollback could not undo everything: `left` names what is left to put right by hand. */
  z.object({ status: z.literal('failed'), reason: z.string(), left: z.array(z.string()) }),
])
export type ProfileMoveResult = z.output<typeof profileMoveResultSchema>

/**
 * Moves the Project's workflow files to the other mode (`bin/profile-set --move`): Full to Silent mode puts the
 * tickets, specs, ADRs and the state file in the Workflow folder (`folder`, null — the default one beside the
 * Profile), Silent to Full mode brings them back into the repository (`folder` null). `expected` is the
 * `fixedFingerprint` of `profileEdit.read`. Refused while a Session of the Project is at work. `local`, as
 * `profileEdit.write`.
 */
export const profileEditMove = invokeChannel(
  'profileEdit.move',
  z.object({ root: absolutePathSchema, to: profileModeSchema, folder: absolutePathSchema.nullable(), expected: pipelineFingerprintSchema }),
  profileMoveResultSchema,
  'local',
)

/** The message of a refused write whose fields changed since the read. */
export const PROFILE_CHANGED = 'The profile changed since you opened it. The form shows it as it is now; make your change again.'

declare module './channels' {
  interface IpcContract {
    'profileEdit.read': typeof profileEditRead
    'profileEdit.check': typeof profileEditCheck
    'profileEdit.write': typeof profileEditWrite
    'profileEdit.move': typeof profileEditMove
  }
}
