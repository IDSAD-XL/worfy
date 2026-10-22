// The Chrome DevTools Protocol session on the page of one Live Browser (ADR-0078 item 4,
// worfy-browser ticket 04): Electron's `webContents.debugger` of the <webview>'s guest, in main, on
// the Machine of the Project only (ADR-0078, its consequences: a Linked machine has no CDP session).
// It is what the tools of `worfy-browser` (src/main/mcp/browser-server.ts) do on the page: go to
// an address, click, type, take a screenshot, read the accessibility tree, and the last console
// messages and network requests (BROWSER_LOG_LIMIT each, no bodies; the owner's decision 4).
//
// The debugger is attached on the first call of a Session, not when the page appears: a Browser no
// Session ever drives has none. From then on it keeps two walls:
// - **Origins** (the owner's decision 2). While a Session drives the Browser (`guard.driving()`),
//   every request for a whole new page of the main frame — a link the Session clicked, a redirect, a
//   script, a form, a window.open main turns into a navigation (src/main/window.ts) — is paused by
//   the Fetch domain and checked against the origins of the Browser's profile (`guard.refusal`). A
//   refused one is failed as `Aborted`, which Chromium treats as a cancelled navigation: the page
//   stays as it was, and the call that led there answers with the refusal. Frames inside the page
//   and the requests of its resources are not checked: they do not change the page.
// - **Takeover** (ADR-0078 item 8). A mouse button pressed, a key pressed or a touch on the page by
//   the user is reported (`onUserInput`), and the Browser stops being the Session's
//   (src/main/browser/live.ts). The Session's own clicks and keys go through the same input path, so
//   the events that come while one of them is being sent are the Session's and are not reported.
//
// The page is reached through CdpContents, the part of Electron's WebContents used here, so the
// contract test drives a fake debugger (test/contract/browser-tools.test.ts).
import { BROWSER_LOG_LIMIT, BROWSER_SNAPSHOT_MAX, PASSWORD_REFUSED } from '../../shared/browser/tools'

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
  on(event: 'input-event', listener: (event: unknown, input: CdpInputEvent) => void): unknown
  once(event: 'destroyed', listener: () => void): unknown
}

/** What the page asks of the Browser it belongs to. */
export interface PageGuard {
  /** Whether a Session drives the Browser now: the origin check holds only then. */
  driving(): boolean
  /** Why a Session may not take the Browser to `url` (originRefusal); null when it may. */
  refusal(url: string): string | null
  /** The user pressed a mouse button or a key on the page, or touched it. */
  onUserInput(): void
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

/** How long one CDP command may take before the call gives up. */
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
      if (this.synthetic === 0 && TAKEOVER_INPUT.has(input.type)) guard.onUserInput()
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
    // Only the requests for a document: a whole page or a frame. A frame's is let through at once.
    await this.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] })
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (this.contents.isDestroyed()) return Promise.reject(new PageError('The page of this Browser is closed.'))
    return within(this.contents.debugger.sendCommand(method, params), COMMAND_MS, method)
  }

  /** Sends one of the Session's own input events: the takeover check does not count it. */
  private async input(method: string, params: unknown): Promise<void> {
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
      refusal = wholePage && this.guard.driving() ? this.guard.refusal(url) : null
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

  private async call<T>(objectId: string, functionDeclaration: string): Promise<T> {
    const answer = (await this.send('Runtime.callFunctionOn', { objectId, functionDeclaration, returnByValue: true, awaitPromise: true })) as { result?: RemoteObject; exceptionDetails?: unknown }
    if (answer.exceptionDetails !== undefined) throw new PageError('The page could not do it: the element threw.')
    return answer.result?.value as T
  }

  /** Clicks the middle of the element, as the user's mouse would, after scrolling it into view. */
  async click(target: PageTarget): Promise<PageOutcome> {
    const element = await this.element(target)
    const box = await this.call<{ x: number; y: number; w: number; h: number } | null>(
      element,
      'function () { if (!(this instanceof Element)) return null; this.scrollIntoView({ block: "center", inline: "center" }); const r = this.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } }',
    )
    if (box === null || box.w === 0 || box.h === 0) throw new PageError('The element is not shown on the page, so it cannot be clicked.')
    const at = { x: box.x, y: box.y }
    return this.settle(async () => {
      await this.input('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
      await this.input('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 })
      await this.input('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 })
    })
  }

  /**
   * Types `text` into the element at its caret, and presses Enter after it with `submit`. Refused
   * for a password field (the owner's decision 7): the user logs in, a Session never sees or types a
   * password. The field is checked where the text goes — the element, and the focused element once
   * it has the focus — so a page that moves the focus elsewhere does not get it there either.
   */
  async type(target: PageTarget, text: string, submit: boolean): Promise<PageOutcome> {
    const element = await this.element(target)
    const password = 'function () { const isPassword = (e) => e instanceof HTMLInputElement && e.type === "password"; if (isPassword(this)) return "password"; if (!(this instanceof HTMLElement)) return "none"; this.focus(); return isPassword(document.activeElement) ? "password" : document.activeElement === this ? "ok" : "none" }'
    const state = await this.call<string>(element, password)
    if (state === 'password') throw new PageError(`${PASSWORD_REFUSED}: the user logs in by hand, a Session never types a password. Ask the user to log in.`)
    if (state !== 'ok') throw new PageError('The element does not take the focus, so nothing can be typed into it.')
    return this.settle(async () => {
      if (text !== '') await this.input('Input.insertText', { text })
      if (submit) {
        const enter = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
        await this.input('Input.dispatchKeyEvent', { type: 'keyDown', ...enter, text: '\r' })
        await this.input('Input.dispatchKeyEvent', { type: 'keyUp', ...enter })
      }
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
