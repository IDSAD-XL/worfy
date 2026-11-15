import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The accessibility rules of the renderer (worfy-ui-kit ticket 18): eslint-plugin-jsx-a11y in the
// repository's own ESLint config, so `pnpm lint` refuses a control without a name.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const eslint = new ESLint({ cwd: repoRoot })

async function a11yErrors(code: string, file = 'src/renderer/session/probe.tsx'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, file) })
  return (result?.messages ?? []).filter((m) => m.ruleId?.startsWith('jsx-a11y/')).map((m) => m.ruleId ?? '')
}

const ICON = '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>'

describe('jsx-a11y in pnpm lint', () => {
  it('rejects an icon-only button without a name', async () => {
    const code = `export function Close({ onClose }: { onClose: () => void }) {\n  return <button type="button" className="w-close" onClick={onClose}>${ICON}</button>\n}\n`
    expect(await a11yErrors(code)).toEqual(['jsx-a11y/control-has-associated-label'])
  })

  it('rejects a click on a plain div', async () => {
    const code = 'export function Row({ pick }: { pick: () => void }) {\n  return <div className="w-row" onClick={pick}>Row</div>\n}\n'
    expect(await a11yErrors(code)).toEqual(['jsx-a11y/click-events-have-key-events', 'jsx-a11y/no-static-element-interactions'])
  })

  it.each([
    ['an icon-only button with aria-label', `export function Close({ onClose }: { onClose: () => void }) {\n  return <button type="button" aria-label="Close" onClick={onClose}>${ICON}</button>\n}\n`],
    ['a button with text', 'export function Save({ save }: { save: () => void }) {\n  return <button type="button" onClick={save}>Save</button>\n}\n'],
    [
      'a radio card whose label text sits two spans deep',
      'export function Mode({ on, pick }: { on: boolean; pick: () => void }) {\n  return (\n    <label>\n      <input type="radio" name="mode" checked={on} onChange={pick} />\n      <span>\n        <span>Full</span>\n      </span>\n    </label>\n  )\n}\n',
    ],
  ])('allows %s', async (_name, code) => {
    expect(await a11yErrors(code)).toEqual([])
  })

  it('leaves the tests alone: the rules cover src/renderer only', async () => {
    const code = `export function Close() {\n  return <button type="button">${ICON}</button>\n}\n`
    expect(await a11yErrors(code, 'test/unit/probe.test.tsx')).toEqual([])
  })
})
