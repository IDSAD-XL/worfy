import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// A link in an agent's answer stands out and opens in the system's browser (worfy-polish ticket 101),
// against the built app on the fake agent: test/fixtures/agent-scripts/chat-links.jsonl answers with
// a markdown link to a PR, a bare http:// address in guillemets and an address in a code span.
// `shell.openExternal` of main is replaced by a recorder, so no browser opens.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-chat-links-')))
  dataDir = join(scratch, 'data')
  claudeHome = join(scratch, 'claude-home')
  mkdirSync(claudeHome)
  const path = join(scratch, 'alpha')
  mkdirSync(path)
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path }], activeId: PROJECT }))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('a link in an answer has the accent colour and opens in the browser; an address in code is not a link', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'chat-links' } })
  try {
    const { app, window } = launched
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    const opened = () => app.evaluate(() => [...(globalThis as unknown as { opened: string[] }).opened])

    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('where is the PR?')
    await field.press('Enter')
    const answer = view.getByTestId('transcript-text').first()
    await expect(answer).toContainText('the dev server is «http://localhost:5173».')

    // Two links: the PR and the bare address, without the closing guillemet; the code span is code.
    const links = answer.locator('.w-md a')
    await expect(links).toHaveText(['#1783', 'http://localhost:5173'])
    await expect(answer.locator('code')).toHaveText('open https://example.com/code')
    await expect(answer.locator('code a')).toHaveCount(0)

    // The link / accent colour of F-SPEC (#0062CC light, #C8F25A dark), not the colour of the text.
    const ACCENT = { light: 'rgb(0, 98, 204)', dark: 'rgb(200, 242, 90)' }
    for (const scheme of ['light', 'dark'] as const) {
      await window.emulateMedia({ colorScheme: scheme })
      const look = await links.first().evaluate((link) => {
        const style = (element: object) => (globalThis as unknown as { getComputedStyle(element: object): { color: string; fontWeight: string; textDecorationLine: string } }).getComputedStyle(element)
        return { link: style(link).color, text: style(link.parentElement as object).color, weight: style(link).fontWeight, line: style(link).textDecorationLine }
      })
      expect(look.link, scheme).toBe(ACCENT[scheme])
      expect(look.link, scheme).not.toBe(look.text)
      expect(look.weight, scheme).toBe('500')
      expect(look.line, scheme).toBe('underline')
    }
    await window.emulateMedia({ colorScheme: null })

    // A click opens the address through main and leaves the window where it is.
    const before = window.url()
    await links.nth(0).click()
    await links.nth(1).click()
    await expect.poll(opened).toEqual(['https://github.com/IDSAD-XL/worfy/pull/1783', 'http://localhost:5173/'])
    expect(window.url()).toBe(before)
    await expect(answer).toBeVisible()
  } finally {
    await launched.close()
  }
})
