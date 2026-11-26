// The Assistant's notifications outside the window (worfy-assistant ticket 14; spec, UI; owner's decision 17): while worfy
// is not in front, a system notification only of an urgent item, only in work hours and only while the Assistant is on,
// titled «worfy Assistant» — the OS chooses where a notification stands, so the title and the text set it apart from
// worfy's usual ones, which name a Project or a Session. A click raises the window and opens the Assistant's section.
//
// One notification per item. An item seen while worfy is in front never comes later: the window showed it, as the card
// next to the Assistant's icon. One that came outside work hours waits for them, as long as it waits for the user.
//
// The user may turn them off (Settings → Assistant → System notifications, ticket 25): off, none shows, urgent or not,
// and an item that came while they were off is not told of once they are on again — it is in the window's list.
import { ASSISTANT_NOTE_TITLE, type AssistantView } from '../../../shared/assistant/window'

/** The longest text of a notification: the lock screen shows little more. */
const BODY_LIMIT = 160

export interface AssistantNoticeDeps {
  /** Whether a worfy window has focus now; a promise while the system is asked (src/main/foreground.ts). */
  focused(): boolean | Promise<boolean>
  show(note: { title: string; body: string }, onClick: () => void): void
  /** Raises worfy's window, or opens one, and shows the Assistant's section. */
  reveal(): void
  /** Whether the user lets them show (systemNoticesOf the app settings); they do while absent. */
  allowed?(): boolean
}

export function assistantNoteBody(item: AssistantView['items'][number]): string {
  const text = item.projectName === null ? item.title : `${item.projectName}: ${item.title}`
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT - 1)}…` : text
}

export class AssistantNotices {
  /** The items told of, or seen in front: never told of again. */
  private readonly done = new Set<string>()

  constructor(private readonly deps: AssistantNoticeDeps) {}

  /** Looks at a view: tells of each urgent new item not told of yet, when the rules allow. */
  look(view: AssistantView): void {
    if (!view.on || !view.workHours) return
    const due = view.items.filter((item) => item.urgent && item.state === 'new' && !this.done.has(item.id))
    if (due.length === 0) return
    for (const item of due) this.done.add(item.id)
    if (this.deps.allowed?.() === false) return
    const tell = (): void => {
      for (const item of due) this.deps.show({ title: ASSISTANT_NOTE_TITLE, body: assistantNoteBody(item) }, () => this.deps.reveal())
    }
    const focused = this.deps.focused()
    if (typeof focused === 'boolean') {
      if (!focused) tell()
      return
    }
    focused.then((yes) => (yes ? undefined : tell())).catch((error: unknown) => console.warn('[assistant] a notification was not shown', error))
  }
}
