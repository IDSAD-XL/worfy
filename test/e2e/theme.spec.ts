import { expect, test, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './helpers'

type Scheme = 'light' | 'dark'

// Expected values are copied by hand from the "Tokens" table of docs/design/F-SPEC.md, so this
// test compares the stylesheet against the design spec rather than against itself.
const expected: Record<Scheme, Record<string, string>> = {
  light: {
    '--bg': '#F7F7F9',
    '--canvas': '#F7F7F9',
    '--canvas-dot': '#D0D0D6',
    '--sidebar': '#E9E9EC',
    '--toolbar': '#F2F2F5',
    '--toolbar-border': '#DCDCE0',
    '--surface': '#FFFFFF',
    '--surface-raised': '#F2F2F5',
    '--selected': '#E1ECFB',
    '--border': '#E2E2E6',
    '--border-strong': '#CFCFD4',
    '--text': '#1D1D1F',
    '--text-secondary': '#48484A',
    '--text-muted': '#636366',
    '--primary': '#0071E3',
    '--primary-text': '#FFFFFF',
    '--accent': '#0062CC',
    '--ready-text': '#146B4B',
    '--ready-bg': '#E4F4EC',
    '--ready-dot': '#30B07E',
    '--working-text': '#0062CC',
    '--working-bg': '#E6F0FC',
    '--working-dot': '#0071E3',
    '--blocked-text': '#A84B00',
    '--blocked-bg': '#FFF0DE',
    '--blocked-ring': '#FF9F0A',
    '--done-text': '#636366',
    '--done-bg': '#F2F2F5',
    '--terminal-bg': '#1D1D1F',
    '--terminal-text': '#E5E5EA',
  },
  dark: {
    '--bg': '#121110',
    '--canvas': '#0F0E0D',
    '--canvas-dot': '#2C2926',
    '--sidebar': '#161513',
    '--toolbar': '#181715',
    '--toolbar-border': '#2E2B28',
    '--surface': '#1B1A18',
    '--surface-raised': '#22201E',
    '--selected': '#2A2825',
    '--border': '#2E2B28',
    '--border-strong': '#3B3834',
    '--text': '#ECE8E1',
    '--text-secondary': '#C2BCB2',
    '--text-muted': '#9C968D',
    '--primary': '#C8F25A',
    '--primary-text': '#121110',
    '--accent': '#C8F25A',
    '--ready-text': '#C8F25A',
    '--ready-bg': '#23281A',
    '--ready-dot': '#C8F25A',
    '--working-text': '#5E9BFF',
    '--working-bg': '#1A2233',
    '--working-dot': '#5E9BFF',
    '--blocked-text': '#FFAE5C',
    '--blocked-bg': '#2E2216',
    '--blocked-ring': '#FFAE5C',
    '--done-text': '#9C968D',
    '--done-bg': '#1B1A18',
    '--terminal-bg': '#0B0A09',
    '--terminal-text': '#ECE8E1',
  },
}

const lightNodeShadow = 'rgba(0, 0, 0, 0.06) 0px 1px 2px 0px, rgba(0, 0, 0, 0.06) 0px 4px 12px 0px'

/**
 * The few DOM globals the page-side callbacks use. test/e2e is type-checked without the DOM
 * library (it runs under Node), so the callbacks declare what they touch.
 */
interface PageGlobals {
  document: {
    documentElement: object
    body: { append: (node: object) => void }
    createElement: (tag: string) => { className: string; remove: () => void }
  }
  getComputedStyle: (element: object) => { getPropertyValue: (name: string) => string; boxShadow: string }
}

async function readTokens(page: Page, names: string[]): Promise<Record<string, string>> {
  return page.evaluate((list) => {
    const { document, getComputedStyle } = globalThis as unknown as PageGlobals
    const style = getComputedStyle(document.documentElement)
    return Object.fromEntries(list.map((name) => [name, style.getPropertyValue(name).trim().toUpperCase()]))
  }, names)
}

/** Computed box-shadow of an element styled the way a canvas Node is (class from tokens.css). */
async function nodeShadow(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { document, getComputedStyle } = globalThis as unknown as PageGlobals
    const probe = document.createElement('div')
    probe.className = 'w-node-surface'
    document.body.append(probe)
    const shadow = getComputedStyle(probe).boxShadow
    probe.remove()
    return shadow
  })
}

let launched: LaunchedApp

test.beforeAll(async () => {
  launched = await launchApp()
})

test.afterAll(async () => {
  await launched.close()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: colour tokens match F-SPEC`, async () => {
    await launched.window.emulateMedia({ colorScheme: scheme })
    const tokens = await readTokens(launched.window, Object.keys(expected[scheme]))
    expect(tokens).toEqual(expected[scheme])
  })

  test(`${scheme}: a Node has ${scheme === 'light' ? 'the layered shadow' : 'no shadow'}`, async () => {
    await launched.window.emulateMedia({ colorScheme: scheme })
    // Dark has no visible shadow: the token is one transparent layer rather than `none`, so that it
    // stays valid inside a box-shadow list (test/e2e/theme-shadows.spec.ts).
    expect(await nodeShadow(launched.window)).toBe(scheme === 'light' ? lightNodeShadow : 'rgba(0, 0, 0, 0) 0px 0px 0px 0px')
  })

  test(`${scheme}: the shell renders and its screenshot is saved for review`, async () => {
    const { window } = launched
    await window.emulateMedia({ colorScheme: scheme })
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // omitBackground keeps the translucent sidebar transparent instead of laying it over white;
    // the native vibrancy behind it does not appear in a page screenshot.
    await window.screenshot({ path: test.info().outputPath(`window-${scheme}.png`), omitBackground: true })
  })
}

test('switching the system appearance restyles the open window without a restart', async () => {
  const { app, window } = launched
  // Drop the emulation so the page follows the system setting that nativeTheme drives.
  await window.emulateMedia({ colorScheme: null })
  try {
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'dark'
    })
    await expect.poll(async () => (await readTokens(window, ['--surface']))['--surface']).toBe('#1B1A18')
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light'
    })
    await expect.poll(async () => (await readTokens(window, ['--surface']))['--surface']).toBe('#FFFFFF')
  } finally {
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'system'
    })
  }
})
