// The Chrome DevTools Protocol session on the page of one Live Browser (ADR-0078 item 4,
// worfy-browser ticket 04): Electron's `webContents.debugger` of the <webview>'s guest, in main, on
// the Machine of the Project only (ADR-0078, its consequences: a Linked machine has no CDP session).
// It is what the tools of `worfy-browser` (src/main/mcp/browser-server.ts) do on the page: go to
// an address, click, type, take a screenshot, read the accessibility tree, and the last console
// messages and network requests (BROWSER_LOG_LIMIT each, no bodies; the owner's decision 4).
//
// The debugger is attached on the first call of a Session, not when the page appears, or when main
// is about to put the Browser to sleep (worfy-browser ticket 05): then it asks the page whether it has
// a `beforeunload` handler and where it is scrolled, takes its picture, and turns no domain on. A
// Browser no Session drives and main never tried to put to sleep has none. Once a Session's call
// attached it, it keeps two walls:
// - **Origins** (the owner's decision 2). While a Session drives the Browser (`guard.driving()`),
//   and until a call ends whose Session left the Canvas while it ran (`guard.walled()`), every request for a whole new page of the main frame — a link the Session clicked, a redirect, a
//   script, a form, a window.open main turns into a navigation (src/main/window.ts) — is paused by
//   the Fetch domain and checked against the origins of the Browser's profile (`guard.refusal`). A
//   refused one is failed as `Aborted`, which Chromium treats as a cancelled navigation: the page
//   stays as it was, and the call that led there answers with the refusal. Service workers are
//   bypassed while the debugger is attached, so none answers such a request before the wall sees it.
//   Frames inside the page and the requests of its resources are not checked: they do not change
//   the page.
// - **Takeover** (ADR-0078 item 8). A mouse button pressed, a key pressed or a touch on the page by
//   the user is reported (`onUserInput`), and the Browser stops being the Session's
//   (src/main/browser/live.ts). The Session's own clicks go through the same input path, so
//   the events that come while one of them is being sent are the Session's and are not reported.
//
// The page is reached through CdpContents, the part of Electron's WebContents used here, so the
// contract test drives a fake debugger (test/contract/browser-tools.test.ts).
import { BROWSER_LOG_LIMIT, BROWSER_SNAPSHOT_MAX, PASSWORD_REFUSED, TAKEN_OVER } from '../../shared/browser/tools'

/** The part of Electron's Debugger used here. */
export interface CdpDebugger {
  attach(protocolVersion?: string): void
  isAttached(): boolean
  sendCommand(method: string, commandParams?: unknown): Promise<unknown>
  on(event: 'message', listener: (event: unknown, method: string, params: unknown) => void): unknown
  on(event: 'detach', listener: (event: unknown, reason: string) => void): unknown
}

/** An input event as Electron's `input-event` hands it over. */
export interface CdpInputEvent {
  type: string
}

/** The part of Electron's WebContents (the guest of a Browser's <webview>) used here. */
export interface CdpContents {
  readonly id: number
  readonly debugger: CdpDebugger
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  /** Whether the page has the keyboard focus (worfy-browser ticket 05); a page without it never has. */
  isFocused?(): boolean
  on(event: 'input-event', listener: (event: unknown, input: CdpInputEvent) => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

/** What the page asks of the Browser it belongs to. */
export interface PageGuard {
  /** Whether a Session drives the Browser now: the origin check holds only then. */
  driving(): boolean
  /**
   * Whether the Session of the call that sends a command now left the Canvas in the middle of that
   * call (worfy-browser ticket 06): the call sends nothing more, whoever has the Browser by then.
   */
  left?(): boolean
  /**
   * Whether the pages are still checked against the origins though no Session drives: a call of a
   * Session that left still runs, and the user has not used the page since.
   */
  walled?(): boolean
  /** Why a Session may not take the Browser to `url` (originRefusal); null when it may. */
  refusal(url: string): string | null
  /** The user pressed a mouse button or a key on the page, or touched it. */
  onUserInput(): void
  /** The user pressed, typed, touched or scrolled the page: the Browser is used (worfy-browser ticket 05). */
  used?(): void
  /** A click of the Session starts or ends: the window keeps its keyboard focus where the user has it. */
  pressing(phase: 'start' | 'end'): void
}

/** What an Asleep Browser keeps of its page (ADR-0078 item 6): a picture of it and where it was scrolled. */
export interface PagePicture {
  /** A JPEG of the page, base64. */
  image: string
  scroll: { x: number; y: number }
}

/** A call refused by the page or by a wall: its message is the tool's answer. */
export class PageError extends Error {}

export interface ConsoleEntry {
  /** log, info, warning, error, debug…; `exception` for an error the page did not catch. */
  level: string
  text: string
  /** The script and line, when the message has one. */
  source?: string
}

export interface NetworkEntry {
  method: string
  url: string
  /** Document, Script, XHR, Fetch, Image…, as Chromium names the resource. */
  type: string
  /** The HTTP status once the answer came; absent while it has not. */
  status?: number
  /** Why the request failed, when it did. */
  failed?: string
}

/** Where the page is after a call, and the refusals of the origin wall while it ran. */
export interface PageOutcome {
  url: string
  title: string
  /** The refusal of each whole-page request the origin wall stopped during the call. */
  refused: string[]
}

/** The element of a call: a CSS selector of the main document, or a ref of the accessibility snapshot. */
export type PageTarget = { selector: string } | { ref: number }

/** The input events that are the user's taking over (the owner's decision 3): a press, not a move or a scroll. */
const TAKEOVER_INPUT = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'touchStart', 'gestureTapDown'])

/** The input events that count as the user's use of the page: a press, a key, a touch or a scroll. */
const USE_INPUT = new Set([...TAKEOVER_INPUT, 'mouseWheel'])

/** How long one CDP command may take before the call gives up. */
/** The start of the answer of a call whose Session left the Canvas while it ran. */
export const SESSION_LEFT = 'This Session left the Canvas'

const COMMAND_MS = 20_000
/** How long a navigation may take to load. */
const LOAD_MS = 20_000
/** How long a click or a key waits for a navigation it may have started. */
const SETTLE_MS = 300

/** Roles of the accessibility tree that carry no meaning of their own: their children are printed in their place. */
const PLAIN_ROLES = new Set(['none', 'generic', 'InlineTextBox', 'LineBreak', 'RootWebArea'])

interface AxValue {
  value?: unknown
}
interface AxNode {
  nodeId: string
  ignored?: boolean
  role?: AxValue
  name?: AxValue
  value?: AxValue
  childIds?: string[]
  parentId?: string
  backendDOMNodeId?: number
}

interface RemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  description?: string
  objectId?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const textOf = (value: AxValue | undefined): string => (value === undefined || value.value === undefined || value.value === null ? '' : String(value.value))

/** Waits for `promise` at most `ms`, then rejects naming `what`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new PageError(`${what} did not answer within ${ms / 1000} s`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Keeps the last `limit` items. */
class Ring<T> {
  readonly items: T[] = []
  constructor(private readonly limit: number) {}
  push(item: T): T | undefined {
    this.items.push(item)
    return this.items.length > this.limit ? this.items.shift() : undefined
  }
}

/** A console argument as text: its value, else Chromium's description of it. */
function argumentText(argument: unknown): string {
  if (!isRecord(argument)) return String(argument)
  if (argument.value !== undefined) return typeof argument.value === 'string' ? argument.value : JSON.stringify(argument.value)
  if (typeof argument.description === 'string') return argument.description
  return typeof argument.type === 'string' ? argument.type : ''
}

/**
 * Run on the element of browser_type, twice. It focuses the element and follows the focus from the
 * page's active element down through open shadow roots and frames to the element the text reaches.
 * Elements of a frame are of that frame's window, so they are told by their tag, not by `instanceof`.
 * With `text` null (the first run) it answers that element, or why there is none: `password`,
 * `frame` (the focus is in a frame of another site), `none` (no field takes the text: the element is
 * no field, or the page moves the focus away from it). The second run, with the text and the element
 * of the first, does it all again and types in the same synchronous turn, so no timer of the page
 * runs between the check and the text: `moved` when the focus ends elsewhere this time, `unchanged`
 * when the field took no text, `typed` when it did. The text is inserted by the page's own editing
 * command and Enter is sent as page events: neither goes through the window's input, so the
 * keyboard focus of the worfy window stays where the user has it.
 */
const TYPE_IN_PAGE = `function (text, submit, expected) {
  const isPassword = (e) => e.localName === "input" && e.type === "password";
  if (isPassword(this)) return "password";
  if (typeof this.focus !== "function") return "none";
  this.focus();
  const way = [];
  for (let e = document.activeElement; e !== null && way.length < 64; ) {
    way.push(e);
    if (isPassword(e)) return "password";
    if (e.shadowRoot && e.shadowRoot.activeElement) { e = e.shadowRoot.activeElement; continue; }
    if (e.localName === "iframe" || e.localName === "frame") {
      let inner = null;
      try { inner = e.contentDocument; } catch (error) { inner = null; }
      if (inner === null) return "frame";
      e = inner.activeElement;
      continue;
    }
    break;
  }
  if (!way.includes(this)) return "none";
  const last = way[way.length - 1];
  const field = last.isContentEditable || last.localName === "textarea" || (last.localName === "input" && !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(last.type));
  if (!field) return "none";
  if (text === null) return last;
  if (last !== expected) return "moved";
  // focus() leaves the caret at the start: the text goes after what the field holds, as after a click.
  if (last.localName === "input" || last.localName === "textarea") {
    try { last.setSelectionRange(last.value.length, last.value.length); } catch (error) { /* a type without a caret (email, number) */ }
  } else {
    last.ownerDocument.getSelection().selectAllChildren(last);
    last.ownerDocument.getSelection().collapseToEnd();
  }
  if (text !== "" && !last.ownerDocument.execCommand("insertText", false, text)) return "unchanged";
  if (submit) {
    // Enter as HTML's implicit submission: nothing when the page stopped the key; else the form's
    // default button is clicked, or a form without one is sent only when this is its one text field.
    const view = last.ownerDocument.defaultView;
    const key = (type) => last.dispatchEvent(new view.KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
    const go = key("keydown") && key("keypress");
    key("keyup");
    const form = last.localName === "input" ? last.form : null;
    if (go && form !== null) {
      const fields = [...form.elements];
      const button = fields.find((e) => (e.localName === "button" && e.type === "submit") || (e.localName === "input" && (e.type === "submit" || e.type === "image")));
      const blocking = ["text", "search", "url", "tel", "email", "password", "date", "month", "week", "time", "datetime-local", "number"];
      if (button !== undefined) { if (!button.disabled) button.click(); }
      else if (fields.filter((e) => e.localName === "input" && blocking.includes(e.type)).length === 1) form.requestSubmit();
    }
  }
  return "typed";
}`

export class CdpPage {
  private attaching: Promise<void> | null = null
  private mainFrame: string | null = null
  /** How many of the Session's own input events are being sent now. */
  private synthetic = 0
  private readonly refusals: string[] = []
  private readonly consoleLog = new Ring<ConsoleEntry>(BROWSER_LOG_LIMIT)
  private readonly networkLog = new Ring<NetworkEntry>(BROWSER_LOG_LIMIT)
  private readonly requests = new Map<string, NetworkEntry>()
  private readonly listeners = new Set<(method: string, params: Record<string, unknown>) => void>()

  constructor(
    readonly contents: CdpContents,
    private readonly guard: PageGuard,
  ) {
    contents.on('input-event', (_event, input) => {
      if (this.synthetic !== 0) return
      if (USE_INPUT.has(input.type)) guard.used?.()
      if (TAKEOVER_INPUT.has(input.type)) guard.onUserInput()
    })
    contents.debugger.on('message', (_event, method, params) => this.onMessage(method, isRecord(params) ? params : {}))
    contents.debugger.on('detach', () => {
      this.attaching = null
      this.mainFrame = null
    })
  }

  /** Attaches the debugger once and turns on what the tools read; again after something else detached it. */
  attach(): Promise<void> {
    this.attaching ??= this.start().catch((error: unknown) => {
      this.attaching = null
      throw error
    })
    return this.attaching
  }

  private async start(): Promise<void> {
    const { contents } = this
    if (contents.isDestroyed()) throw new PageError('The page of this Browser is closed.')
    const tool = contents.debugger
    if (!tool.isAttached()) {
      try {
        tool.attach('1.3')
      } catch (error) {
        throw new PageError(`Could not reach the page of this Browser (is its DevTools open?): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.send('Page.enable')
    const tree = await this.send('Page.getFrameTree')
    const frame = isRecord(tree) && isRecord(tree.frameTree) && isRecord(tree.frameTree.frame) ? tree.frameTree.frame.id : undefined
    this.mainFrame = typeof frame === 'string' ? frame : null
    await this.send('Runtime.enable')
    await this.send('Log.enable')
    await this.send('Network.enable')
    // A service worker answers a navigation of its scope itself, before the Fetch domain sees the
    // request: with it bypassed every whole-page request reaches the origin wall below.
    await this.send('Network.setBypassServiceWorker', { bypass: true })
    // Only the requests for a document: a whole page or a frame. A frame's is let through at once.
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] })
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (this.contents.isDestroyed()) return Promise.reject(new PageError('The page of this Browser is closed.'))
    return within(this.contents.debugger.sendCommand(method, params), COMMAND_MS, method)
  }

  /** Sends one of the Session's own input events: the takeover check does not count it. */
  /** The user may take the Browser over in the middle of a call: nothing is done to the page after that. */
  private assertDriving(): void {
    if (this.guard.left?.() === true) throw new PageError(`${SESSION_LEFT}: its Node was hidden, removed or archived in the middle of this call, and its control of this Browser ended; nothing more was sent to the page.`)
    if (!this.guard.driving()) throw new PageError(`${TAKEN_OVER} in the middle of this call; nothing more was sent to the page. Wait until they press «Return control to Claude».`)
  }

  private async input(method: string, params: unknown): Promise<void> {
    this.assertDriving()
    this.synthetic += 1
    try {
      await this.send(method, params)
    } finally {
      // Electron reports the event before Chromium acknowledges it; one turn more for its listener.
      setImmediate(() => {
        this.synthetic -= 1
      })
    }
  }

  private onMessage(method: string, params: Record<string, unknown>): void {
    if (method === 'Fetch.requestPaused') this.onPausedRequest(params)
    else this.record(method, params)
    for (const listener of [...this.listeners]) listener(method, params)
  }

  private onPausedRequest(params: Record<string, unknown>): void {
    const requestId = String(params.requestId)
    const url = isRecord(params.request) && typeof params.request.url === 'string' ? params.request.url : ''
    const wholePage = this.mainFrame !== null && params.frameId === this.mainFrame
    let refusal: string | null
    try {
      refusal = wholePage && (this.guard.driving() || this.guard.walled?.() === true) ? this.guard.refusal(url) : null
    } catch (error) {
      // A guard that cannot answer refuses: the wall must not open by an error.
      refusal = `The origins of this Browser could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
    const answer = refusal === null ? this.send('Fetch.continueRequest', { requestId }) : this.send('Fetch.failRequest', { requestId, errorReason: 'Aborted' })
    if (refusal !== null) this.refusals.push(refusal)
    answer.catch((error: unknown) => console.warn(`[browser] a paused request of ${this.contents.getURL()} could not be answered`, error))
  }

  private record(method: string, params: Record<string, unknown>): void {
    if (method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params.args) ? params.args : []
      this.consoleLog.push({ level: typeof params.type === 'string' ? params.type : 'log', text: args.map(argumentText).join(' ') })
    } else if (method === 'Runtime.exceptionThrown') {
      const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
      const exception = isRecord(details.exception) ? details.exception : {}
      const text = typeof exception.description === 'string' ? exception.description : String(details.text ?? 'an error')
      this.consoleLog.push({ level: 'exception', text, ...(typeof details.url === 'string' && details.url !== '' ? { source: `${details.url}:${Number(details.lineNumber ?? 0) + 1}` } : {}) })
    } else if (method === 'Log.entryAdded') {
      const entry = isRecord(params.entry) ? params.entry : {}
      this.consoleLog.push({ level: String(entry.level ?? 'info'), text: String(entry.text ?? ''), ...(typeof entry.url === 'string' && entry.url !== '' ? { source: entry.url } : {}) })
    } else if (method === 'Network.requestWillBeSent') {
      const request = isRecord(params.request) ? params.request : {}
      const entry: NetworkEntry = { method: String(request.method ?? 'GET'), url: String(request.url ?? ''), type: String(params.type ?? 'Other') }
      const id = String(params.requestId)
      // A redirect comes as the same request id again: each hop is a row of its own.
      this.requests.set(id, entry)
      const dropped = this.networkLog.push(entry)
      if (dropped !== undefined) for (const [key, value] of this.requests) if (value === dropped) this.requests.delete(key)
    } else if (method === 'Network.responseReceived') {
      const entry = this.requests.get(String(params.requestId))
      const response = isRecord(params.response) ? params.response : {}
      if (entry !== undefined && typeof response.status === 'number') entry.status = response.status
    } else if (method === 'Network.loadingFailed') {
      const entry = this.requests.get(String(params.requestId))
      if (entry !== undefined) entry.failed = String(params.errorText ?? 'failed')
    }
  }

  /** Calls `listener` with every CDP event until the returned function is called. */
  private listen(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Runs `act` and waits for what it set off: a navigation of the main frame that started is waited
   * for until it stops loading; with none started within SETTLE_MS (or `wait` for a navigation the
   * call itself asked for) the call is over. Answers where the page is and the refusals meanwhile.
   */
  private async settle(act: () => Promise<void>, wait = SETTLE_MS): Promise<PageOutcome> {
    const from = this.refusals.length
    let loading = false
    let stopped: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      stopped = resolve
    })
    const stop = this.listen((method, params) => {
      if (params.frameId !== this.mainFrame) return
      if (method === 'Page.frameStartedLoading') loading = true
      else if (method === 'Page.frameStoppedLoading') {
        loading = false
        stopped()
      }
    })
    try {
      await act()
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (loading) await within(done, LOAD_MS, 'The page').catch(() => undefined)
    } finally {
      stop()
    }
    return { url: this.contents.getURL(), title: this.contents.getTitle(), refused: this.refusals.slice(from) }
  }

  /** Goes to `url` (already checked against the origins by the caller) and waits for it to load. */
  async navigate(url: string): Promise<PageOutcome & { error: string | null }> {
    let error: string | null = null
    const outcome = await this.settle(async () => {
      const answer = await this.send('Page.navigate', { url })
      if (isRecord(answer) && typeof answer.errorText === 'string' && answer.errorText !== '') error = answer.errorText
    }, 50)
    return { ...outcome, error }
  }

  /** The element of `target`, as a remote object; throws naming it when the page has none. */
  private async element(target: PageTarget): Promise<string> {
    if ('selector' in target) {
      const found = (await this.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(target.selector)})` })) as { result?: RemoteObject; exceptionDetails?: unknown }
      if (found.exceptionDetails !== undefined) throw new PageError(`${JSON.stringify(target.selector)} is not a valid CSS selector.`)
      if (found.result?.objectId === undefined) throw new PageError(`The page has no element ${JSON.stringify(target.selector)}.`)
      return found.result.objectId
    }
    try {
      const resolved = (await this.send('DOM.resolveNode', { backendNodeId: target.ref })) as { object?: RemoteObject }
      if (resolved.object?.objectId !== undefined) return resolved.object.objectId
    } catch {
      // A ref of an older page: answered below.
    }
    throw new PageError(`The page has no element [ref=${target.ref}] any more; call browser_read again.`)
  }

  /** Runs `functionDeclaration` on the element with `args`, and answers its result as a remote object. */
  private async callRaw(objectId: string, functionDeclaration: string, args: unknown[]): Promise<RemoteObject> {
    const answer = (await this.send('Runtime.callFunctionOn', { objectId, functionDeclaration, arguments: args, returnByValue: false })) as { result?: RemoteObject; exceptionDetails?: unknown }
    if (answer.exceptionDetails !== undefined) throw new PageError('The page could not do it: the element threw.')
    return answer.result ?? {}
  }

  private async call<T>(objectId: string, functionDeclaration: string): Promise<T> {
    const answer = (await this.send('Runtime.callFunctionOn', { objectId, functionDeclaration, returnByValue: true, awaitPromise: true })) as { result?: RemoteObject; exceptionDetails?: unknown }
    if (answer.exceptionDetails !== undefined) throw new PageError('The page could not do it: the element threw.')
    return answer.result?.value as T
  }

  /** The middle of the element, scrolled into view; throws when it is not shown. */
  private async middleOf(element: string): Promise<{ x: number; y: number }> {
    const box = await this.call<{ x: number; y: number; w: number; h: number } | null>(
      element,
      'function () { if (!(this instanceof Element)) return null; this.scrollIntoView({ block: "center", inline: "center" }); const r = this.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } }',
    )
    if (box === null || box.w === 0 || box.h === 0) throw new PageError('The element is not shown on the page, so it cannot be clicked.')
    return { x: box.x, y: box.y }
  }

  /** A press and a release of the left mouse button at `at`, as the user's mouse would. */
  private async press(at: { x: number; y: number }): Promise<void> {
    await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
    await this.input('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 })
    await this.input('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 })
  }

  /** Clicks the middle of the element, as the user's mouse would, after scrolling it into view. */
  async click(target: PageTarget): Promise<PageOutcome> {
    const at = await this.middleOf(await this.element(target))
    // The click is Chromium's own, trusted, as the page expects; it moves the window's keyboard
    // focus onto the Browser, and the window puts it back after the release.
    return this.settle(async () => {
      this.guard.pressing('start')
      try {
        await this.press(at)
      } finally {
        this.guard.pressing('end')
      }
    })
  }

  /**
   * Types `text` into the element, and presses Enter after it with `submit` (a form the field is in
   * is submitted, as Enter would). Refused for a password field (the owner's decision 7): the user
   * logs in, a Session never sees or types a password. The check is on where the text goes once the
   * element has the focus: the focused element of the page, followed down through open shadow roots
   * (a host that delegates its focus) and frames to the deepest one. A password field anywhere on
   * that way refuses; so does a frame of another site, whose focus cannot be seen; so does a focus
   * the page moves away from the element; and so does a field that hosts a closed shadow root, whose
   * focus the page hides (a contenteditable host may delegate it to a password field inside). Only an
   * input, a text area or an editable element at the end takes the text (TYPE_IN_PAGE).
   *
   * Nothing goes through Chromium's input here: a click, a key or Input.insertText of the guest
   * moves the worfy window's keyboard focus to the Browser, or lands in whatever the user is typing
   * into in the window.
   */
  async type(target: PageTarget, text: string, submit: boolean): Promise<PageOutcome> {
    const element = await this.element(target)
    const refuse = (state: unknown): never => {
      if (state === 'password') throw new PageError(`${PASSWORD_REFUSED}: the user logs in by hand, a Session never types a password. Ask the user to log in.`)
      if (state === 'frame') throw new PageError('The focus is inside a frame of another site, which cannot be checked for a password field, so nothing is typed there.')
      if (state === 'closed') throw new PageError('The field hides its focus in a closed shadow root, which cannot be checked for a password field, so nothing is typed there.')
      if (state === 'unchanged') throw new PageError('The field took no text.')
      throw new PageError('The element does not take text — it is no input, text area or editable element, or the page moves the focus away from it — so nothing is typed.')
    }
    const first = await this.callRaw(element, TYPE_IN_PAGE, [{ value: null }, { value: false }, { value: null }])
    if (first.subtype !== 'node' || first.objectId === undefined) return refuse(first.value)
    const field = first.objectId
    // A closed shadow root is seen only from here: the page's own code cannot tell it from none.
    const described = (await this.send('DOM.describeNode', { objectId: field, depth: 0 })) as { node?: { shadowRoots?: { shadowRootType?: string }[] } }
    if ((described.node?.shadowRoots ?? []).some((root) => root.shadowRootType === 'closed')) return refuse('closed')
    return this.settle(async () => {
      this.assertDriving()
      const done = await this.callRaw(element, TYPE_IN_PAGE, [{ value: text }, { value: submit }, { objectId: field }])
      if (done.value !== 'typed') refuse(done.value)
    })
  }

  /** A PNG of the page as it is now, base64. */
  async screenshot(): Promise<string> {
    const answer = await this.send('Page.captureScreenshot', { format: 'png' })
    if (!isRecord(answer) || typeof answer.data !== 'string') throw new PageError('The page gave no screenshot.')
    return answer.data
  }

  /** The page as an indented text snapshot of its accessibility tree, with a [ref=…] per element. */
  async read(): Promise<string> {
    const answer = await this.send('Accessibility.getFullAXTree')
    const nodes = isRecord(answer) && Array.isArray(answer.nodes) ? (answer.nodes as AxNode[]) : []
    const header = `Page: ${this.contents.getTitle() || '(no title)'} — ${this.contents.getURL()}`
    return [header, ...snapshotLines(nodes)].join('\n').slice(0, BROWSER_SNAPSHOT_MAX)
  }

  /** The last console messages and page errors, oldest first. */
  console(): ConsoleEntry[] {
    return [...this.consoleLog.items]
  }

  /** The last network requests, oldest first, without bodies. */
  network(): NetworkEntry[] {
    return this.networkLog.items.map((entry) => ({ ...entry }))
  }

  /**
   * Runs `act` with the debugger attached, without turning any domain on: what main asks of a page
   * before it sleeps and after it wakes. The debugger stays attached after: detaching it could come
   * in the middle of a Session's attach().
   */
  private async quietly<T>(act: () => Promise<T>): Promise<T> {
    const { contents } = this
    if (contents.isDestroyed()) throw new PageError('The page of this Browser is closed.')
    if (!contents.debugger.isAttached()) {
      try {
        contents.debugger.attach('1.3')
      } catch (error) {
        throw new PageError(`Could not reach the page of this Browser (is its DevTools open?): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return act()
  }

  /**
   * Whether the page has a `beforeunload` handler («Leave site?», ADR-0078 item 15) — added with
   * addEventListener or set as `onbeforeunload` — on its window. Its own frames are not asked: the
   * handler of a frame does not stop the Browser's page from closing without a question.
   */
  async hasBeforeUnload(): Promise<boolean> {
    return this.quietly(async () => {
      const window = (await this.send('Runtime.evaluate', { expression: 'window' })) as { result?: RemoteObject }
      const objectId = window.result?.objectId
      if (objectId === undefined) throw new PageError('The page has no window to ask.')
      try {
        const answer = await this.send('DOMDebugger.getEventListeners', { objectId })
        const listeners = isRecord(answer) && Array.isArray(answer.listeners) ? (answer.listeners as unknown[]) : []
        return listeners.some((listener) => isRecord(listener) && listener.type === 'beforeunload')
      } finally {
        void this.send('Runtime.releaseObject', { objectId }).catch(() => undefined)
      }
    })
  }

  /** The picture an Asleep Browser shows, and where the page is scrolled. */
  async picture(): Promise<PagePicture> {
    return this.quietly(async () => {
      const scrolled = (await this.send('Runtime.evaluate', { expression: '[scrollX, scrollY]', returnByValue: true })) as { result?: RemoteObject }
      const [x, y] = Array.isArray(scrolled.result?.value) ? (scrolled.result.value as unknown[]) : []
      const at = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
      const shot = await this.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
      if (!isRecord(shot) || typeof shot.data !== 'string') throw new PageError('The page gave no screenshot.')
      return { image: shot.data, scroll: { x: at(x), y: at(y) } }
    })
  }

  /** Scrolls the page to where it was when it went to sleep, once it has loaded. */
  async restoreScroll(scroll: { x: number; y: number }): Promise<void> {
    const x = Math.max(0, Math.round(scroll.x))
    const y = Math.max(0, Math.round(scroll.y))
    await this.quietly(() =>
      this.send('Runtime.evaluate', {
        expression: `new Promise((done) => { const go = () => { window.scrollTo(${x}, ${y}); done(true) }; if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true }) })`,
        awaitPromise: true,
      }),
    )
  }
}

/** The lines of an accessibility snapshot; a line cut off at BROWSER_SNAPSHOT_MAX is the caller's. */
export function snapshotLines(nodes: readonly AxNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]))
  const root = nodes.find((node) => node.parentId === undefined || !byId.has(node.parentId))
  const lines: string[] = []
  let length = 0
  const walk = (node: AxNode, depth: number, parentName: string): void => {
    if (length > BROWSER_SNAPSHOT_MAX) return
    const role = textOf(node.role)
    const name = textOf(node.name).trim()
    const value = textOf(node.value).trim()
    const plain = node.ignored === true || PLAIN_ROLES.has(role) || (role === 'StaticText' && name === parentName)
    let next = depth
    if (!plain && (role !== 'StaticText' || name !== '')) {
      const line = `${'  '.repeat(depth)}- ${role}${name === '' ? '' : ` ${JSON.stringify(name)}`}${value === '' || value === name ? '' : ` value=${JSON.stringify(value)}`}${node.backendDOMNodeId === undefined ? '' : ` [ref=${node.backendDOMNodeId}]`}`
      lines.push(line)
      length += line.length + 1
      next = depth + 1
    }
    for (const id of node.childIds ?? []) {
      const child = byId.get(id)
      if (child !== undefined) walk(child, next, plain ? parentName : name)
    }
  }
  if (root !== undefined) walk(root, 0, '')
  if (length > BROWSER_SNAPSHOT_MAX) lines.push(`… the page is longer than ${BROWSER_SNAPSHOT_MAX} characters; the rest is not shown.`)
  return lines
}
