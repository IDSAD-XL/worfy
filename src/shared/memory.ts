// worfy's own memory (worfy-ui ticket 20): what main reads from app.getAppMetrics() every few
// seconds while a window shows it (src/main/diagnostics/memory.ts), and how the toolbar writes it
// (src/renderer/memory/AppMemory.tsx). Only the processes of Electron itself count: main, the
// windows' renderers, GPU and utility. The children of the terminals (claude CLI under node-pty)
// are not in app.getAppMetrics() and are not counted.
import { z } from 'zod'

/** The part of Electron's ProcessMetric used here: the process type and its working set in KB. */
export interface ProcessMemoryMetric {
  type: string
  memory: { workingSetSize: number }
}

const kb = z.number().nonnegative()

/** One sample: the total and the split by process kind, in KB, and when it was taken (ms). */
export const memoryUsageSchema = z.object({
  totalKb: kb,
  byKind: z.object({
    /** The main process (Electron's 'Browser'). */
    main: kb,
    /** The renderers of the windows (Electron's 'Tab'). */
    windows: kb,
    gpu: kb,
    /** Every other process: utility, network, zygote and the like. */
    other: kb,
  }),
  sampledAt: z.number(),
})
export type MemoryUsage = z.output<typeof memoryUsageSchema>
type MemoryKind = keyof MemoryUsage['byKind']

function kindOf(type: string): MemoryKind {
  if (type === 'Browser') return 'main'
  if (type === 'Tab') return 'windows'
  if (type === 'GPU') return 'gpu'
  return 'other'
}

/** A size in KB as a number fit to add: one that is not finite or below zero counts as 0. */
const sizeOf = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

/** The sum of app.getAppMetrics() by process kind, taken at `now`. */
export function sumAppMetrics(metrics: readonly ProcessMemoryMetric[], now: number): MemoryUsage {
  const byKind = { main: 0, windows: 0, gpu: 0, other: 0 }
  for (const metric of metrics) byKind[kindOf(metric.type)] += sizeOf(metric.memory.workingSetSize)
  return { totalKb: byKind.main + byKind.windows + byKind.gpu + byKind.other, byKind, sampledAt: now }
}

/** "412 MB" below 1024 MB, "1.3 GB" from there; a size that is not a valid number is "0 MB". */
export function formatMemory(sizeKb: number): string {
  const mb = Math.round(sizeOf(sizeKb) / 1024)
  if (mb < 1024) return `${mb} MB`
  return `${(sizeOf(sizeKb) / 1024 / 1024).toFixed(1)} GB`
}

/** The tooltip of the toolbar's figure: what is counted, then the split by kind. */
export function memoryTooltip(usage: MemoryUsage): string {
  const { main, windows, gpu, other } = usage.byKind
  return [
    "Memory used by worfy's own processes (not counting terminal sessions)",
    `Main ${formatMemory(main)} · Windows ${formatMemory(windows)} · GPU ${formatMemory(gpu)} · Other ${formatMemory(other)}`,
  ].join('\n')
}
