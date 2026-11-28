import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

// A Session whose Harness did not load says so (worfy-harness-guarantees ticket 07), against the built app on the
// fake agent: test/fixtures/agent-scripts/harness-did-not-load.jsonl answers with a system/init whose `plugins` keep
// the plugin worfy and whose `plugin_errors` carry `hook-load-failed` of its folder (`harness@inline`), as Claude
// Code 2.1.322 does with a hooks.json that is not JSON (test/fixtures/sdk-messages/init-plugin-errors.jsonl). The
// Session's transcript shows the notice "Harness did not load" with Open Health and Copy details.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'alpha-0000000a'

let scratch: string
let dataDir: string
let claudeHome: string

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-harness-did-not-load-')))
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

test('an init with an error of the Harness plugin gives the notice "Harness did not load" with Open Health and Copy details', async () => {
  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'harness-did-not-load' } })
  try {
    const { window } = launched
    const node = window.getByTestId('orchestrator-node')
    await expect(node.getByTestId('orchestrator-state')).toHaveText('idle')
    await node.locator('.w-orchestrator__header').dblclick()
    const view = window.locator('.w-shell__view[data-view="session"]').getByTestId('session-view')
    const field = view.getByRole('textbox', { name: 'Message Orchestrator' })
    await field.fill('start')
    await field.press('Enter')
    await expect(view.getByTestId('transcript-text').first()).toContainText('Ready.')

    const notice = view.getByTestId('notice-block')
    await expect(notice).toHaveCount(1)
    await expect(notice).toContainText('Harness did not load')
    await expect(notice).toContainText('worfy · hook-load-failed: Hook load failed: JSON Parse error: Unexpected EOF')
    await expect(notice).toContainText('Guards and the gate do not hold in this Session.')
    await expect(notice.getByRole('button', { name: 'Open Health' })).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Copy details' })).toBeVisible()
  } finally {
    await launched.close()
  }
})
