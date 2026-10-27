// Which window of a Linked machine is open (worfy-link ticket 37), outside React: the sidebar's
// Machines section, Settings → Machines and the command palette open one through askRemoveMachine and
// openChangeAddress; MachineDialogs.tsx, in the shell, shows it. Also the look the two windows share.
import type { CSSProperties } from 'react'
import { create } from 'zustand'

type MachineDialog = { kind: 'remove' | 'address'; id: string }

export const useMachineDialog = create<{ dialog: MachineDialog | undefined }>(() => ({ dialog: undefined }))

/** Asks to confirm "Remove" of Linked machine `id`; nothing is removed before the user confirms. */
export function askRemoveMachine(id: string): void {
  useMachineDialog.setState({ dialog: { kind: 'remove', id } })
}

/** Opens "Change address…" of Linked machine `id`. */
export function openChangeAddress(id: string): void {
  useMachineDialog.setState({ dialog: { kind: 'address', id } })
}

export function closeMachineDialog(): void {
  useMachineDialog.setState({ dialog: undefined })
}

/**
 * Above the Settings window (SETTINGS_LAYER, 110, settings/settings-window.ts): "Remove" of Settings →
 * Machines opens its confirmation over it, and the Settings modal guard lets a higher layer keep its keys.
 */
const MACHINE_DIALOG_LAYER = 120

export const dialogStyles = {
  backdrop: { position: 'fixed', inset: 0, zIndex: MACHINE_DIALOG_LAYER, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.25)' },
  dialog: {
    width: 440,
    maxWidth: 'calc(100vw - 32px)',
    boxSizing: 'border-box',
    padding: 'var(--space-4)',
    borderRadius: 'var(--radius-popover)',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow-node)',
    fontSize: 'var(--text-13)',
  },
  title: { margin: '0 0 var(--space-3)', fontSize: 'var(--text-15)', fontWeight: 600 },
  text: { margin: '0 0 var(--space-4)', lineHeight: '18px' },
  field: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginBottom: 'var(--space-3)' },
  label: { fontWeight: 600 },
  input: {
    height: 'var(--row-height)',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-12)',
  },
  hint: { color: 'var(--text-muted)', fontSize: 'var(--text-12)' },
  error: { color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  secondary: {
    height: 'var(--row-height)',
    padding: '0 var(--space-3)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: 'var(--text-13)',
  },
} satisfies Record<string, CSSProperties>
