// worfy's own memory in main (worfy-ui ticket 20): a sample of app.getAppMetrics() every 5 s, summed
// by src/shared/memory.ts, for the windows that show it in the toolbar (src/main/ipc/memory.ts).
//
// The timer runs only while both hold: some window listens, and the `memoryIndicator` setting is on
// (followMemorySetting). Otherwise no timer exists and nothing is read. A window that starts
// listening to a stopped sampler gets a sample at once, so the figure shows without a 5 s wait.
import { app } from 'electron'
import { sumAppMetrics, type MemoryUsage, type ProcessMemoryMetric } from '../../shared/memory'
import type { AppSettings } from '../../shared/settings/app-settings'
import { appSettingsStore } from '../settings/store'

/** How often the memory is sampled while a window shows it. */
export const MEMORY_SAMPLE_MS = 5_000

export interface MemorySamplerOptions {
  /** The metrics of every process of the app: app.getAppMetrics() in the app, a stub in tests. */
  read: () => readonly ProcessMemoryMetric[]
  /** Whether the setting is on at the start. */
  enabled: boolean
  now?: () => number
}

export class MemorySampler {
  private readonly listeners = new Set<(usage: MemoryUsage) => void>()
  private timer: ReturnType<typeof setInterval> | undefined
  private last: MemoryUsage | null = null
  private enabled: boolean
  /** Whether the last read failed, so a failing read warns once and not every 5 s. */
  private failing = false

  constructor(private readonly options: MemorySamplerOptions) {
    this.enabled = options.enabled
  }

  /** Whether the timer runs. */
  get running(): boolean {
    return this.timer !== undefined
  }

  /** The latest sample; null while the setting is off or before the first sample. */
  snapshot(): MemoryUsage | null {
    return this.enabled ? this.last : null
  }

  /** Adds a listener of every new sample; returns its removal. */
  subscribe(listener: (usage: MemoryUsage) => void): () => void {
    this.listeners.add(listener)
    this.update()
    return () => {
      this.listeners.delete(listener)
      this.update()
    }
  }

  /** Follows the setting: off stops the timer and forgets the last sample, on starts it again. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (!enabled) this.last = null
    this.update()
  }

  /** Removes every listener and stops the timer (the app quits). */
  stop(): void {
    this.listeners.clear()
    this.update()
  }

  private update(): void {
    const wanted = this.enabled && this.listeners.size > 0
    if (wanted && this.timer === undefined) {
      this.timer = setInterval(() => this.sample(), MEMORY_SAMPLE_MS)
      this.sample()
    } else if (!wanted && this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  private sample(): void {
    let usage: MemoryUsage
    try {
      usage = sumAppMetrics(this.options.read(), (this.options.now ?? Date.now)())
    } catch (error) {
      // The figure keeps its last value; the next tick tries again.
      if (!this.failing) console.warn(`worfy: the app's memory could not be read: ${error instanceof Error ? error.message : String(error)}`)
      this.failing = true
      return
    }
    this.failing = false
    this.last = usage
    for (const listener of [...this.listeners]) listener(usage)
  }
}

/** Keeps `sampler` on while the `memoryIndicator` setting of `store` is, and off while it is not. */
export function followMemorySetting(sampler: MemorySampler, store: { get(): AppSettings; on(event: 'changed', listener: (settings: AppSettings) => void): unknown }): void {
  sampler.setEnabled(store.get().memoryIndicator)
  store.on('changed', (settings) => sampler.setEnabled(settings.memoryIndicator))
}

let shared: MemorySampler | undefined

/** The sampler of the running app, over app.getAppMetrics() and the app settings; created on first use. */
export function appMemory(): MemorySampler {
  if (shared !== undefined) return shared
  const sampler = new MemorySampler({ read: () => app.getAppMetrics(), enabled: appSettingsStore().get().memoryIndicator })
  followMemorySetting(sampler, appSettingsStore())
  app.on('will-quit', () => sampler.stop())
  shared = sampler
  return sampler
}
