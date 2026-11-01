import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The repository's own ESLint config is the guard for the process boundaries in spec.md:
// src/renderer, src/card-runtime and src/shared never import Electron, Node or src/main.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const eslint = new ESLint({ cwd: repoRoot })

async function boundaryErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, file) })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'worfy/process-boundary').map((m) => m.message)
}

describe('process boundary lint rule', () => {
  it.each([
    ['src/renderer/probe.ts', "import { ipcRenderer } from 'electron'\nexport { ipcRenderer }"],
    ['src/renderer/probe.ts', "import type { IpcRendererEvent } from 'electron/renderer'\nexport type E = IpcRendererEvent"],
    ['src/renderer/probe.ts', "import { readFileSync } from 'node:fs'\nexport { readFileSync }"],
    ['src/renderer/probe.ts', "import { readFile } from 'fs/promises'\nexport { readFile }"],
    ['src/renderer/probe.ts', "export const later = () => import('node:path')"],
    ['src/renderer/probe.ts', "export type T = typeof import('electron')"],
    ['src/renderer/canvas/probe.tsx', "import { dataRoot } from '../../main/storage/paths'\nexport { dataRoot }"],
    ['src/renderer/probe.ts', "export * from '../preload/index'"],
    ['src/card-runtime/probe.ts', "import { app } from 'electron'\nexport { app }"],
    ['src/shared/probe.ts', "import { app } from 'electron'\nexport { app }"],
    ['src/shared/probe.ts', "import { join } from 'path'\nexport { join }"],
    ['src/shared/ipc/probe.ts', "import { App } from '../../renderer/main'\nexport { App }"],
    ['src/shared/probe.ts', "import { dataRoot } from '../main/storage/paths'\nexport { dataRoot }"],
    ['src/shared/flight-recorder/probe.mjs', "import { readFileSync } from 'node:fs'\nexport { readFileSync }"],
    ['src/shared/flight-recorder/probe.mjs', "import { app } from 'electron'\nexport { app }"],
    ['src/shared/flight-recorder/probe.d.mts', "import type { Stats } from 'node:fs'\nexport declare const stats: Stats"],
    ['src/renderer/probe.mjs', "import { readFile } from 'fs/promises'\nexport { readFile }"],
    ['src/card-runtime/probe.mts', "import { app } from 'electron'\nexport { app }"],
  ])('rejects %s: %s', async (file, code) => {
    expect(await boundaryErrors(file, code)).toHaveLength(1)
  })

  it.each([
    ['src/renderer/probe.ts', "import { useState } from 'react'\nexport { useState }"],
    ['src/renderer/canvas/probe.ts', "import { value } from '../../shared/probe'\nexport { value }"],
    ['src/renderer/probe.ts', "import { App } from './main'\nexport { App }"],
    ['src/shared/probe.ts', "import { z } from 'zod'\nexport const value = z.string()"],
    ['src/shared/flight-recorder/probe.mjs', "import { time } from './journal-walk.mjs'\nexport { time }"],
    ['src/main/probe.ts', "import { app } from 'electron'\nimport { join } from 'node:path'\nexport { app, join }"],
    ['src/preload/probe.ts', "import { contextBridge } from 'electron'\nexport { contextBridge }"],
  ])('allows %s: %s', async (file, code) => {
    expect(await boundaryErrors(file, code)).toEqual([])
  })
})
