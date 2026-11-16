// Handlers of the `stories` domain (src/shared/ipc/stories.ts, worfy-code-stories ticket 04): the invisible
// build of a Code story on the Project's Vendor (its settings' `defaultVendor`, Claude Code when none), its
// progress lines to the window that asked, and its Stop. The builder (src/main/stories/one-shot.ts) writes
// nothing; keeping a story is its caller's (tickets 11 and 12).
//
// Under WORFY_AGENT=fake the Claude driver's oneShot runs over the fake agent, which plays
// test/fixtures/agent-scripts/<WORFY_STORY_SCRIPT or "story">.jsonl and appends what it was asked to
// WORFY_AGENT_LOG, as the draft of a Project's profile does (src/main/ipc/projects.ts): the e2e runs of
// tickets 11 and 12 go through it. A Codex Project is refused by its capabilities before any request.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { storiesActivity, storiesBuild, storiesStop } from '../../shared/ipc/stories'
import type { VendorId } from '../../shared/vendors/vendor'
import { fakeQueryFactory } from '../agent/fake-query'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import { StoryBuilder } from '../stories/one-shot'
import { assistDir } from '../terminal-ai/options'
import { claudeOneShotOver } from '../vendors/claude/one-shot'
import type { OneShot } from '../vendors/one-shot'
import { vendorDriver } from '../vendors/registry'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

/** The oneShot of `vendor`: its driver's, or the fake agent's for Claude Code under WORFY_AGENT=fake. */
export function storyOneShotFromEnv(env: NodeJS.ProcessEnv = process.env): (vendor: VendorId) => OneShot {
  if (env.WORFY_AGENT !== 'fake') return (vendor) => vendorDriver(vendor).oneShot
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_STORY_SCRIPT ?? 'story',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify({ story: true, ...call })}\n`) : undefined,
  })
  const claude = claudeOneShotOver((request) => fake(request))
  return (vendor) => (vendor === 'claude' ? claude : vendorDriver(vendor).oneShot)
}

let shared: StoryBuilder | undefined
const builder = (): StoryBuilder =>
  (shared ??= new StoryBuilder({
    oneShot: storyOneShotFromEnv(),
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    runDir: () => assistDir(dataRoot()),
  }))

function toSender(sender: EventTarget & { isDestroyed?: () => boolean }, send: (target: EventTarget) => void): void {
  if (sender.isDestroyed?.() === true) return
  try {
    send(sender)
  } catch (error) {
    console.warn('[stories] could not send to the window', error)
  }
}

const handlers: HandlerModule = [
  defineHandler(storiesBuild, ({ storyId, projectId, input }, { event }) => {
    const store = projectStore()
    const project = store.get(projectId)
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    return builder().build({ storyId, folder: project.path, vendor, input }, (text) => toSender(event.sender, (target) => emit(target, storiesActivity, { storyId, text })))
  }),

  defineHandler(storiesStop, ({ storyId }) => ({ stopped: builder().stop(storyId) })),
]

export default handlers
