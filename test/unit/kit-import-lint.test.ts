import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// Base UI is imported only by the kit, src/renderer/theme/kit/ (worfy-ui-kit ticket 03, ADR-0106).
// The repository's own ESLint config is the guard: `no-restricted-imports` everywhere else in src/.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const eslint = new ESLint({ cwd: repoRoot })

async function importErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, file) })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message)
}

describe('Base UI import lint rule', () => {
  it.each([
    ['src/renderer/session/probe.tsx', "import { Popover } from '@base-ui/react/popover'\nexport { Popover }"],
    ['src/renderer/theme/probe.ts', "import { Menu } from '@base-ui/react/menu'\nexport { Menu }"],
    ['src/renderer/canvas/nodes/probe.tsx', "import { Dialog } from '@base-ui/react'\nexport { Dialog }"],
    ['src/renderer/probe.ts', "export { Tooltip } from '@base-ui/react/tooltip'"],
    ['src/renderer/probe.ts', "import { useStableCallback } from '@base-ui/utils/useStableCallback'\nexport { useStableCallback }"],
    ['src/shared/probe.ts', "import type { PopoverRoot } from '@base-ui/react/popover'\nexport type P = PopoverRoot.Props"],
  ])('rejects %s: %s', async (file, code) => {
    const errors = await importErrors(file, code)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/theme\/kit/)
  })

  it.each([
    ['src/renderer/theme/kit/probe.tsx', "import { Popover } from '@base-ui/react/popover'\nexport { Popover }"],
    ['src/renderer/theme/kit/menus/probe.ts', "import { Menu } from '@base-ui/react/menu'\nexport { Menu }"],
    ['src/renderer/session/probe.tsx', "import { useKitLayer } from '../theme/kit/layer'\nexport { useKitLayer }"],
  ])('allows %s: %s', async (file, code) => {
    expect(await importErrors(file, code)).toEqual([])
  })
})
