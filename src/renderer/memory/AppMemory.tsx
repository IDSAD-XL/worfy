// worfy's own memory in the toolbar (worfy-ui ticket 20): "412 MB" or "1.3 GB", the sum over the
// processes of the app (src/shared/memory.ts), with the split by kind in the native tooltip. It
// stands on the second line of the Harness column, after the app version
// (src/renderer/shell/toolbar/HarnessStatus.tsx): it describes the running app, as the version
// does, and that line has room, so the toolbar gets no new item. The `memoryIndicator` setting
// (Settings → General) hides it in every window at once; then nothing is sampled.
import { formatMemory, memoryTooltip, type MemoryUsage } from '../../shared/memory'
import { useAppSettings } from '../settings/useAppSettings'
import { useAppMemory } from './useAppMemory'

// Monospace and 7 characters wide at least ("1023 MB", "12.5 GB"): a new figure does not move the
// items next to it.
// The type is that of the app version before it: small and muted.
const style = {
  display: 'inline-block',
  minWidth: '7ch',
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontSize: 'var(--text-11)',
  lineHeight: '13px',
  color: 'var(--text-muted)',
  opacity: 0.8,
} as const

/** The figure for a sample; "…" until the first one. Exported for tests, which pass their own. */
export function AppMemoryView({ usage }: { usage: MemoryUsage | null }) {
  const text = usage === null ? '…' : formatMemory(usage.totalKb)
  return (
    <span className="w-mono" style={style} title={usage === null ? undefined : memoryTooltip(usage)} aria-label={`worfy memory: ${text}`} data-testid="app-memory">
      {text}
    </span>
  )
}

/** The figure while the setting is on; nothing while it is off. */
export default function AppMemory() {
  const enabled = useAppSettings((settings) => settings.memoryIndicator)
  const usage = useAppMemory(enabled)
  return enabled ? <AppMemoryView usage={usage} /> : null
}
