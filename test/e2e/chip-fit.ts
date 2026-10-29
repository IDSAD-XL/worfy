import { expect, type Locator } from '@playwright/test'

/** What the page reports for one chip with a border, as laid out. */
interface ChipRead {
  text: string
  lineHeight: string
  /** The height inside the border, not rounded to whole pixels. */
  inner: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Measures every `.w-chip` with a border inside `scope` and expects its text to fit inside that
 * border: an explicit px line height no taller than the box inside the border, and no content
 * standing out of the box. The 18 px chip (src/renderer/theme/primitives.css) keeps 16 px inside a
 * 1 px border, and a line it inherits (17 px on body) would stand out by a pixel. Chips without a
 * border are not measured: they keep the inherited line on purpose.
 *
 * Refuses a scope with no bordered chip in it, so a test that lost its chip does not pass on nothing.
 */
export async function expectBorderedChipsFit(scope: Locator, where: string): Promise<void> {
  const reads = await scope.evaluate((node) => {
    // The e2e typecheck has no DOM library: the few page types used here.
    type Element = { textContent: string | null; clientHeight: number; scrollHeight: number; getBoundingClientRect(): { height: number } }
    type Style = { lineHeight: string; borderTopWidth: string; borderBottomWidth: string }
    const page = globalThis as unknown as { getComputedStyle(element: Element): Style }
    const chips = (node as unknown as { querySelectorAll(selector: string): Iterable<Element> }).querySelectorAll('.w-chip')
    const found: ChipRead[] = []
    for (const chip of Array.from(chips)) {
      const style = page.getComputedStyle(chip)
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
      if (!(border > 0)) continue
      found.push({
        text: (chip.textContent ?? '').trim(),
        lineHeight: style.lineHeight,
        inner: chip.getBoundingClientRect().height - border,
        scrollHeight: chip.scrollHeight,
        clientHeight: chip.clientHeight,
      })
    }
    return found
  })
  expect(reads.length, `${where}: a chip with a border to measure`).toBeGreaterThan(0)
  for (const chip of reads) {
    const said = `${where}, chip "${chip.text}" (${JSON.stringify(chip)})`
    // An explicit length: `normal` takes the height of whatever font the system falls back to.
    expect(chip.lineHeight, `${said}: line height`).toMatch(/^\d+(\.\d+)?px$/)
    expect(parseFloat(chip.lineHeight), `${said}: the line inside the border`).toBeLessThanOrEqual(chip.inner + 0.05)
    expect(chip.scrollHeight, `${said}: the content inside the box`).toBeLessThanOrEqual(chip.clientHeight)
  }
}
