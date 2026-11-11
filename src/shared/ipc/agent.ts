// The `agent` domain: Sessions of Claude Code run by main (src/main/agent/session.ts).
//
// A Session is started with `agent.start` and gets a temporary id; once Claude Code reports its
// own session id (system/init), events carry that id and a `renamed` event names the old one.
// Both ids are accepted by the other channels. Every event of every Session arrives on
// `agent.event`, tagged with its Session's id.
//
// Ticket 19: `agent.send` during a turn puts the message in the Session's queue; the queue, the
// settings (model, effort, permission mode) and their changes arrive as `queue` and `settings`
// events, and `agent.controls` answers both for a view that opens later.
//
// Ticket 20: `agent.send` takes the message's attachments, checked beforehand by `agent.attach`
// (what the renderer has: a pasted image, a dropped file) or `agent.attachPick` (main's own file
// dialog, behind "+"); `agent.commands` lists the slash commands and skills of the Session.
//
// Ticket 21: outside bypassPermissions Claude Code asks before tools; the request arrives as a
// `permission_request` event and `agent.permission` answers it.
//
// worfy-ui ticket 17: Claude Code's questions with answer options arrive as a `question_request`
// event and `agent.answerQuestion` answers them.
//
// worfy-product-session ticket 30: `agent.requests` answers the requests still open, for a window that did
// not see their events go out.
//
// worfy-flight-recorder ticket 22: an Autopilot command typed in a chat starts Autopilot instead of
// reaching the agent, and `agent.send` answers what became of it.
import { z } from 'zod'
import { attachmentSchema, attachmentSourceSchema, attachResultSchema, MAX_ATTACHMENTS } from '../agent/attachments'
import { slashCommandSchema } from '../agent/commands'
import { agentEventEnvelope, openRequestEvent, permissionOptionIdSchema, queueSnapshotSchema, sessionState } from '../agent/events'
import { questionPickSchema } from '../agent/questions'
import { modelOptionSchema, sessionSettingsSchema, settingsChangeSchema } from '../agent/settings'
import { capabilitiesSchema } from '../vendors/capabilities'
import { absolutePathSchema } from '../paths'
import { eventChannel, invokeChannel } from './channels'

const sessionId = z.string().min(1)

export const agentStart = invokeChannel(
  'agent.start',
  z.object({
    /** Root of the Project: an absolute path to an existing directory. */
    cwd: absolutePathSchema,
    /** SDK session id to continue. */
    resume: sessionId.optional(),
  }),
  z.object({ sessionId }),
  'project',
  'write',
)

/**
 * What became of an Autopilot command typed in a chat (worfy-flight-recorder ticket 22): the run
 * started, it waits for the busy Orchestrator (kind `after-turn`, a name kept from ADR-0091), or it
 * was refused; `message` says it in words.
 */
export const chatCommandAnswerSchema = z.object({ kind: z.enum(['started', 'after-turn', 'refused']), epic: z.string(), message: z.string() })
export type ChatCommandAnswer = z.infer<typeof chatCommandAnswerSchema>

/**
 * Sends a message the person typed. A message that is an Autopilot command (`/worfy:epic-wave …`,
 * src/shared/autopilot/chat-command.ts) does not reach the agent: it starts Autopilot, and the
 * answer says what became of it. Any other message answers nothing.
 */
export const agentSend = invokeChannel(
  'agent.send',
  z
    .object({ sessionId, text: z.string(), attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS).default([]) })
    .refine((message) => message.text.trim() !== '' || message.attachments.length > 0, 'the message is empty'),
  z.object({ autopilot: chatCommandAnswerSchema }).optional(),
  'project',
  'write',
)

/** What main makes of each thing attached, in the order given: an attachment, or why it was refused. */
const attachResults = z.object({ results: z.array(attachResultSchema) })

/** Checks pasted and dropped things, and copies what needs copying (src/main/agent/attachments.ts). */
/**
 * `keep`: main also keeps a copy of each image it answers, `<sha256>.<ext>` in its images folder, and
 * refuses an image whose copy it could not write; a `kept` source reads such a copy back (the images
 * of comments on quotes, worfy-polish ticket 102).
 */
export const agentAttach = invokeChannel(
  'agent.attach',
  z.object({ sessionId, sources: z.array(attachmentSourceSchema).min(1).max(MAX_ATTACHMENTS), keep: z.boolean().default(false) }),
  attachResults,
  'project',
  'write',
)

/** "+": main's file dialog; no results when the user cancels it. */
export const agentAttachPick = invokeChannel('agent.attachPick', z.object({ sessionId }), attachResults, 'desktop')

/** The slash menu's rows: the slash commands and skills Claude Code reports for the Session. */
export const agentCommands = invokeChannel('agent.commands', z.object({ sessionId }), z.object({ commands: z.array(slashCommandSchema) }), 'project', 'read')

export const agentInterrupt = invokeChannel('agent.interrupt', z.object({ sessionId }), z.object({ interrupted: z.boolean() }), 'project', 'write')

export const agentClose = invokeChannel('agent.close', z.object({ sessionId }), z.void(), 'project', 'write')

export const agentList = invokeChannel('agent.list', z.void(), z.array(z.object({ sessionId, cwd: z.string(), state: sessionState })), 'project', 'read')

/** The Session's settings and queue as they are now. */
export const agentControls = invokeChannel('agent.controls', z.object({ sessionId }), z.object({ settings: sessionSettingsSchema, queue: queueSnapshotSchema }), 'project', 'read')

/**
 * The permission and question requests of the Session still open, as their `permission_request` and
 * `question_request` events went out (worfy-product-session ticket 30): a window that opened or reloaded
 * after a request went out never got its event, so its view asks for them to draw the cards.
 */
export const agentRequests = invokeChannel('agent.requests', z.object({ sessionId }), z.object({ requests: z.array(openRequestEvent) }), 'project', 'read')

/** Changes some of the model, effort and permission mode; answers the settings now in force. */
export const agentConfigure = invokeChannel('agent.configure', z.object({ sessionId, change: settingsChangeSchema }), sessionSettingsSchema, 'project', 'write')

/** The model picker's rows: supportedModels() of the live Session, or the model of its last system/init. */
export const agentModels = invokeChannel('agent.models', z.object({ sessionId }), z.object({ models: z.array(modelOptionSchema) }), 'project', 'read')

/**
 * What the Session's Vendor can do (worfy-multi-vendor ticket 25): the pickers' presets and effort
 * levels, the flags, and the reason of each one it lacks, for a tooltip.
 */
export const agentCapabilities = invokeChannel('agent.capabilities', z.object({ sessionId }), capabilitiesSchema, 'project', 'read')

/** Takes a queued message out before it is sent; `removed` is false when it was no longer queued. */
export const agentQueueRemove = invokeChannel('agent.queueRemove', z.object({ sessionId, id: z.string().min(1) }), z.object({ removed: z.boolean() }), 'project', 'write')

/** "Send queued": a queue held by Interrupt goes again, starting now when no turn runs. */
export const agentQueueSend = invokeChannel('agent.queueSend', z.object({ sessionId }), z.void(), 'project', 'write')

/**
 * Answers an open permission request with one of the options its `permission_request` offered
 * (`decision`: the option's id; Claude's are "Allow", "Always allow" — this tool, for the rest of
 * this Session — and "Deny"). An id the request does not offer is refused. `answered` is false when
 * the request is no longer open (already answered, or refused by Interrupt or by closing the Session).
 */
export const agentPermission = invokeChannel(
  'agent.permission',
  z.object({ sessionId, requestId: z.string().min(1), decision: permissionOptionIdSchema }),
  z.object({ answered: z.boolean() }),
  'project',
  'write',
)

/**
 * Answers an open question request (Claude Code's AskUserQuestion, worfy-ui ticket 17): one pick
 * per question in the questions' order, or `answers: null` for "Decline". `answered` is false when
 * the request is no longer open; picks that do not answer every question with its own options are
 * refused with an error, and the request stays open.
 */
export const agentAnswerQuestion = invokeChannel(
  'agent.answerQuestion',
  z.object({ sessionId, requestId: z.string().min(1), answers: z.array(questionPickSchema).min(1).max(4).nullable() }),
  z.object({ answered: z.boolean() }),
  'project',
  'write',
)

export const agentEvent = eventChannel('agent.event', agentEventEnvelope, 'project', 'read')

declare module './channels' {
  interface IpcContract {
    'agent.start': typeof agentStart
    'agent.send': typeof agentSend
    'agent.attach': typeof agentAttach
    'agent.attachPick': typeof agentAttachPick
    'agent.commands': typeof agentCommands
    'agent.interrupt': typeof agentInterrupt
    'agent.close': typeof agentClose
    'agent.list': typeof agentList
    'agent.controls': typeof agentControls
    'agent.requests': typeof agentRequests
    'agent.configure': typeof agentConfigure
    'agent.models': typeof agentModels
    'agent.capabilities': typeof agentCapabilities
    'agent.queueRemove': typeof agentQueueRemove
    'agent.queueSend': typeof agentQueueSend
    'agent.permission': typeof agentPermission
    'agent.answerQuestion': typeof agentAnswerQuestion
    'agent.event': typeof agentEvent
  }
}
