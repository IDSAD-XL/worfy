// Whether a folder the test denied its user (chmod off Windows, an icacls /deny entry on Windows)
// is still open to the app under test. A Windows process that holds the backup and restore
// privileges enabled gets past the folder's ACL: Git Bash enables both when it starts on an elevated
// token (the GitHub runner's administrator), and every process it starts — Playwright, the app —
// inherits them. CI runs the e2e tests under PowerShell for that reason (.github/workflows/ci.yml,
// job windows-e2e); this check keeps a run from Git Bash on such a machine from reading as a defect
// of the app. The tests that use it skip only when the app really gets in, so on macOS and on a
// Windows machine without those privileges they run as before.
import { randomUUID } from 'node:crypto'
import type { ElectronApplication } from '@playwright/test'

/** The reason a test that needs a deny entry skips when the app gets past it. */
export const DENY_ACE_BYPASSED = 'process holds SeBackup/SeRestore: deny ACE cannot apply'

/**
 * True when the app's main process can still do in `folder` what the test denied it: list the
 * folder (`read`) or add a file to it (`write`). A probe file that got written is removed.
 */
export async function denyBypassed(app: ElectronApplication, folder: string, access: 'read' | 'write'): Promise<boolean> {
  return app.evaluate(
    (_electron, { folder, access, name }) => {
      const { readdirSync, rmSync, writeFileSync } = process.getBuiltinModule('node:fs')
      const { join } = process.getBuiltinModule('node:path')
      try {
        if (access === 'read') readdirSync(folder)
        else {
          const probe = join(folder, name)
          writeFileSync(probe, '')
          rmSync(probe, { force: true })
        }
        return true
      } catch {
        return false
      }
    },
    { folder, access, name: `.deny-probe-${randomUUID()}` },
  )
}
