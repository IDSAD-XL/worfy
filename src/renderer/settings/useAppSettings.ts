// The renderer's copy of the app settings of this Machine (src/shared/settings/app-settings.ts).
// Main owns them (src/main/settings/store.ts); this module asks for them once, follows
// `appSettings.changed`, and keeps the state with the highest revision, as useMachines does: an
// answer and an event can arrive out of order. The channels are `local`, so a window on a Linked
// machine's Project reads and writes the settings of its own Machine (src/renderer/ipc.ts).
//
// Without the preload bridge (unit tests of components) the settings stay the defaults and nothing
// is asked.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { WorfyBridge } from '../../shared/ipc/channels'
import { defaultAppSettings, type AppSettings, type AppSettingsPatch } from '../../shared/settings/app-settings'
import { invoke, subscribe } from '../ipc'

interface AppSettingsStore {
  settings: AppSettings
}

const useAppSettingsStore = create<AppSettingsStore>(() => ({ settings: defaultAppSettings() }))

/**
 * Takes settings from main unless newer ones are already here. An equal revision is taken: the
 * answer to `appSettings.set` and the event of the same change carry the same one.
 */
export function acceptAppSettings(settings: AppSettings): void {
  if (settings.revision >= useAppSettingsStore.getState().settings.revision) useAppSettingsStore.setState({ settings })
}

/** Asks main for the settings again. */
export async function refreshAppSettings(): Promise<void> {
  const result = await invoke('appSettings.get')
  if (result.ok) acceptAppSettings(result.value)
  else console.error('appSettings.get failed:', result.error)
}

let started = false

function start(): void {
  if (started) return
  if ((globalThis as { worfy?: WorfyBridge }).worfy === undefined) return
  started = true
  subscribe('appSettings.changed', acceptAppSettings)
  void refreshAppSettings()
}

const whole = (settings: AppSettings): AppSettings => settings

/** The app settings, or the part `select` takes; the defaults until main has answered once. */
export function useAppSettings(): AppSettings
export function useAppSettings<T>(select: (settings: AppSettings) => T): T
export function useAppSettings<T>(select: (settings: AppSettings) => T | AppSettings = whole): T | AppSettings {
  useEffect(start, [])
  return useAppSettingsStore((store) => select(store.settings))
}

/**
 * Changes the settings in parts through `appSettings.set` and takes the answer; the reason when
 * main refused. Every window of this Machine hears the change as `appSettings.changed`.
 */
export async function setAppSettings(patch: AppSettingsPatch): Promise<string | undefined> {
  const result = await invoke('appSettings.set', patch)
  if (!result.ok) return result.error
  acceptAppSettings(result.value)
  return undefined
}
