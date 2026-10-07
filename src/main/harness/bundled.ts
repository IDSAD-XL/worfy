// The Harness copy this build carries. The build (electron.vite.config.ts) copies harness/ into
// out/harness/ and writes the build version (scripts/build-version.ts, `<semver>+<SHA>[.dirty]`)
// into its .claude-plugin/plugin.json; electron-builder puts out/harness/ into
// Contents/Resources/harness/, outside app.asar, because a script inside app.asar cannot be run
// (ADR-0008).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'

const manifestSchema = z.object({ version: z.string().min(1) })

/**
 * The folder of the Harness copy: `<process.resourcesPath>/harness` in the packaged app, otherwise
 * out/harness/ next to the built main (out/main/), as `pnpm dev` and `pnpm test:e2e` run it.
 */
export function bundledHarnessDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'harness') : join(import.meta.dirname, '..', 'harness')
}

/**
 * The `version` of the Harness copy, the build version; undefined when the copy, its plugin.json
 * or the field is missing or unreadable (unit tests, `pnpm dev` before the first build).
 */
export function bundledHarnessVersion(dir: string = bundledHarnessDir()): string | undefined {
  let text: string
  try {
    text = readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data.version : undefined
  } catch {
    return undefined
  }
}
