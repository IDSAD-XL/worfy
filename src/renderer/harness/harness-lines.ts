import { skippedAgentsText, type HarnessStatus as Status } from '../../shared/ipc/harness'
import type { UpdateSnapshot } from '../../shared/ipc/update'

// What the Harness and Codex lines say and offer for a Harness status (harness/HarnessStatus.tsx draws them):
// pure, so the dot of the footer's version chip (shell/footer/version-dot.ts) reads the same buttons the
// lines draw (worfy-layout ticket 03).

/** The icons of the lines' buttons (HarnessStatus.tsx draws them). */
export type IconName = 'install' | 'update' | 'retry' | 'migrate'

/** The button a line offers: its icon, its name, its tooltip, and whether it carries the accent. */
export interface LineButton {
  icon: IconName
  label: string
  title: string
  accent: boolean
}

/** What the Harness line says for a status, and the button it offers while this run may install. */
export interface HarnessPart {
  text: string
  title?: string | undefined
  tone: string
  button: LineButton | null
}

/** The Harness line of an installed, missing, outdated or broken Harness; pure, for the line and the chip's dot. */
export function harnessPart(status: Status, harnessBehind: UpdateSnapshot['harnessBehind'] | null = null): HarnessPart {
  const { state, canInstall } = status
  const offer = (icon: IconName, label: string, title: string, accent = false): LineButton | null => (canInstall ? { icon, label, title, accent } : null)
  switch (state.kind) {
    case 'not-installed':
      return { text: 'Harness not installed', tone: 'var(--text-muted)', button: offer('install', 'Install', `Install the Harness ${status.bundledVersion ?? ''} into ${status.pluginDir}`) }
    case 'installed':
      return {
        text: state.enabled ? `Harness ${state.version}` : `Harness ${state.version} · disabled`,
        title: state.enabled ? undefined : 'The plugin worfy is disabled in Claude Code',
        tone: 'var(--text-muted)',
        button: null,
      }
    case 'outdated':
      if (state.sameVersion && harnessBehind !== null && harnessBehind.from === state.from) {
        // Main found the installed commit behind this copy's (worfy-update ticket 05): an update, as for an older semver.
        // Only for the version this state names as installed: a snapshot about another one is stale.
        return {
          text: canInstall ? `Harness ${harnessBehind.from}` : `Harness ${harnessBehind.from} → ${harnessBehind.to}`,
          tone: 'var(--text-muted)',
          button: offer('update', 'Update Harness', `Update Harness: ${harnessBehind.from} → ${harnessBehind.to}`, true),
        }
      }
      if (state.sameVersion) {
        // The same semver from another commit (worfy-harness ticket 67): no arrow, as worfy cannot tell which one is newer.
        return {
          text: canInstall ? `Harness ${state.from ?? '?'}` : `Harness ${state.from ?? '?'}, this build ${state.to}`,
          tone: 'var(--text-muted)',
          button: offer('update', 'Replace Harness', `Replace Harness ${state.from ?? 'unknown'} with ${state.to}: the same version from another commit, and worfy cannot tell which one is newer`),
        }
      }
      // With the update offered the line names the installed version and the icon the new one.
      return {
        text: canInstall ? `Harness ${state.from ?? '?'}` : `Harness ${state.from ?? '?'} → ${state.to}`,
        tone: 'var(--text-muted)',
        button: offer('update', 'Update Harness', `Update Harness: ${state.from ?? 'unknown'} → ${state.to}`, true),
      }
    case 'error':
      return {
        text: `Harness error: ${state.step}`,
        title: state.reason,
        tone: 'var(--blocked-text)',
        button: offer('retry', 'Retry', 'Retry reads the state again and runs what is left of the install, a missing dependency of the plugin included; the dialog names every command before anything runs'),
      }
  }
}

/**
 * The Codex part for a status, or null: only next to a Harness Claude Code has (worfy-multi-vendor ticket 35),
 * as the same Install installs both, Claude Code first, so until then the Harness line says what to do.
 */
export function codexPartOf({ status, busy, failure }: { status: Status | undefined; busy: boolean; failure: string | undefined }): CodexPart | null {
  if (failure !== undefined || status === undefined || busy) return null
  return status.state.kind === 'installed' && status.codex !== undefined ? codexPart(status.codex) : null
}

export interface CodexPart {
  state: string
  text: string
  title: string
  tone: string
  button?: { icon: IconName; label: string; title: string }
}

/** What the line adds for the Harness in Codex: a short text, its tooltip, and the action when there is one. */
function codexPart(codex: NonNullable<Status['codex']>): CodexPart | null {
  const { state, skippedAgents } = codex
  const muted = 'var(--text-muted)'
  // Agent files worfy leaves alone, as a file of the user's own has the name: said in the tooltip, and as the text when nothing else is.
  const skipped = skippedAgents.length === 0 ? '' : skippedAgentsText(skippedAgents, codex.agentsDir)
  const withSkipped = (title: string): string => (skipped === '' ? title : `${title}\n${skipped}`)
  switch (state.kind) {
    case 'installed':
      // Codex turns the hooks of an updated plugin off until they are approved: the step says how (worfy-multi-vendor ticket 39).
      if (codex.hooksToApprove) return { state: 'hooks', text: 'Codex: approve hooks', title: withSkipped('Codex keeps the Harness hooks off after an install or update until you approve them in Codex (/hooks)'), tone: muted }
      return skipped === '' ? null : { state: 'skipped-agents', text: `Codex: ${String(skippedAgents.length)} ${skippedAgents.length === 1 ? 'agent' : 'agents'} not written`, title: skipped, tone: muted }
    case 'not-installed':
      return {
        state: state.kind,
        text: 'Codex: not installed',
        title: 'The Harness is not installed in Codex',
        tone: muted,
        button: { icon: 'install', label: 'Install in Codex', title: `Install the Harness in Codex, with the agents in ${codex.agentsDir}` },
      }
    case 'outdated':
      return {
        state: state.kind,
        text: `Codex ${state.from ?? '?'}`,
        title: withSkipped(`Codex has the Harness ${state.from ?? 'of an unknown version'}; this build has ${state.to}`),
        tone: muted,
        button: { icon: 'update', label: 'Update Harness in Codex', title: `Update Harness in Codex: ${state.from ?? 'unknown'} → ${state.to}` },
      }
    case 'error':
      return {
        state: state.kind,
        text: `Codex error: ${state.step}`,
        title: state.reason,
        tone: 'var(--blocked-text)',
        button: { icon: 'retry', label: 'Retry', title: 'Retry reads the state of Codex again and runs what is left of the install; the dialog names every command before anything runs' },
      }
  }
}
