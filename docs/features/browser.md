# Browser

Two Features. **Browser** is a Node with a Chromium page that the user and Sessions both work in. **Browser profile**
is the saved sign-in of one role, under which a Browser opens. Terms are explained in [Concepts](concepts.md).

## Browser

### Behaviour

A Browser is a Node on the Canvas with a page of a site or web app, open under one Browser profile. The user browses
in it by hand. A Session drives it with tools, on request in the chat or to check a Ticket as a given role.

**Creating.** "New browser" in the Canvas context menu or the Command palette makes the Node, 640 by 440 pixels. A
Session's `browser_open` makes one of the same size next to the Session's Node, off any Node it would cover. Which
profile a new Browser gets is under [Browser profile](#browser-profile). The header holds the name of the profile, Back,
Forward, Reload, the address bar, the button of the Browser settings sidebar, and the marks below. A selected frame is
resized by its handles, down to 360 by 200.

**The address bar.** Enter sends the page to the typed address. An address without `://` gets `https://`. A `scheme://`
other than `http` or `https`, text with spaces, or an address that still makes no valid URL is refused and the bar is
marked invalid. Esc leaves the bar as it was and does nothing else. A new Browser has no address and shows an empty
page. The address a page reaches, by a link or by the bar, is kept
in the Node, so the bar shows it and a restart opens it again. This is not a step of ⌘Z. Back and Forward are inactive
at the ends of the page's history. All three are inactive while this window has no ready page of the Browser, which
includes a frame that shows frames from another window.

**The page on the Canvas.** The page moves and scales with its frame and is clipped at the frame's edge. Another Node or
a menu over the frame covers the page. The wheel over the page scrolls the page and leaves the Canvas where it is. While
the main mouse button pressed on the Canvas is held, the page takes no mouse. The page keeps running when its frame
leaves the screen, until the rules below put it to sleep. In Focus mode the page lies over the frame's body in its
tile and takes input there. Leaving Focus mode puts it back on the frame: the same page, with its history, scroll and
typed text.

**Page viewport.** The sidebar sets the size the page is laid out at: "Fit to card", the default, makes it as large as
the frame's body; 1440 × 900, 1280 × 800, 768 × 1024 and 390 × 844 are ready; "Custom" takes whole numbers from 200 to
3840. With a viewport, the page is scaled into the body as large as it fits whole, from the top-left corner. Only the
width and height change, and no device is emulated, so the ready sizes are named by their size. The choice is kept in
the Node and survives a restart. No Session tool sets it. Esc closes the sidebar.

**Links that ask for a window.** A page never opens a window. For a `target="_blank"` link or `window.open`:

- Asked by a frame of the page's own origin, the page itself goes to the address. A form that posts this way opens
  its address as a plain GET.
- Asked by a frame of another origin, or without a referrer, the page stays. The frame offers the address in the Open
  bar, "The page wants to open", with Open and a close button. A new request replaces the address, and a navigation
  of the page takes the bar away.
- An address that is not http or https is neither opened nor offered.

The Open bar always shows the scheme and host whole and leaves out any user name. It cuts only the rest of the address,
keeping its last 24 characters. The whole address is in the tooltip. A page gets no web permission: every request for
the camera, microphone, notifications, geolocation or clipboard is refused, and every permission check answers no.

#### What the frame shows

| The frame shows | Meaning |
|---|---|
| The page | Live, and this window draws it |
| Frames of the page | Live, and another window or Machine draws it |
| A dimmed picture under "Asleep · Click to wake" | Asleep. The picture is the page as it went to sleep |
| "Asleep · Click to wake" alone | Asleep, without a picture: worfy restarted, or there was none to take |
| "Choose a profile" | No page: see [Browser profile](#browser-profile) |
| "Unsaved changes" in the header | The page has a `beforeunload` handler, so it does not sleep |
| "Over the Live limit" in the header | Live beyond the limit: the user opened it while every other Live Browser was busy, or the limit was lowered |
| "Claude is driving" and an accent border | A Session drives it |
| "Return control to Claude" in the header | The user took it over from a Session |

#### Live and Asleep

A Live Browser has a running page, and each one is a page process. An Asleep Browser has no page: its cookies stay on
disk, and main keeps a picture and the scroll position. Main checks the rules once a second, for all windows.

| Settings → Browser | Default | Offered | Accepted in the file |
|---|---|---|---|
| Live browsers at once | 3 | 1, 2, 3, 4, 5, 6, 8, 10 | 1–10 |
| Sleep when off screen after | 30 s | 10 s, 30 s, 1, 2, 5, 10 min | 1–3600 s |
| Sleep when unused after | 5 min | 1, 2, 5, 10, 15, 30 min, 1 h | 1–240 min |
| Readable from zoom | 40 % | 25, 30, 40, 50, 60, 75 % | 10–100 % |

A Live Browser goes to sleep in two cases, both only while its page has no keyboard focus:

- No screen shows it at a readable zoom for longer than the off-screen time. A frame in the window on a Canvas zoomed
  out below the readable zoom counts as off screen. One screen that shows it readable is enough to keep it. A hidden
  window, such as a minimised one, shows no Browser. A Browser in a Focus mode tile counts as shown and readable. While
  a Focus mode tile shows a Browser, the whole window counts as readable, so the Browsers inside the window, even on a
  Canvas zoomed out below the readable zoom, sleep later.
- Nothing used it for longer than the unused time. Use is a press, a key, a touch or a scroll on the page, input in
  its frames, a Session's call, or its wake.

It does not sleep in these cases:

- A Session drives it now: a call runs, or the last call ended less than the unused time ago. A Browser the user took
  over does not count as driven.
- Its page has a `beforeunload` handler. Main asks right before a sleep, and a page with a handler again every 5
  seconds.
- Its page did not answer within 3 seconds, for example with its DevTools open. It stays Live without the mark.

**The limit** counts all Browsers of the Machine, in every Project. Opening or waking one beyond the limit puts to
sleep the Live Browser used longest ago that may sleep. When none may, the user's Browser opens over the limit with
the mark, and a Session's call is refused with "All Live Browsers are busy" and changes nothing. The mark goes once the
Live Browsers fit the limit again. A limit lowered in Settings holds at the next check: those beyond it that may sleep
do, and the others are marked.

**Waking.** A click on the frame wakes a Browser, and so does a Session's call. The page loads the Node's address again
and main scrolls it back. A wake is a reload, so a form without a `beforeunload` handler loses what was typed. An
Asleep Browser with a picture stays Asleep when a screen shows it again.

**After a restart.** Pictures are kept in memory only. After a restart, or once no window shows a Project and all its
Browsers sleep, main forgets them. The next first screen of the Project wakes its Browsers up to the limit, those it
shows first, and the rest are Asleep without a picture. Such a Browser wakes by itself when a screen shows it at a
readable zoom and a place is free.

A Session's call needs a window of this Machine that shows the Project, because only such a window can draw the page.
Without one, a call on a Browser with no page is refused and asks for the Project to be opened.

#### Who drives

A Session drives a Browser from its first call on it, and the frame says so. "Claude is driving" stays between calls.
Only one Session drives a Browser at a time, and another Session's call is refused. A Session may drive the Browsers it
opened and those the user opened, never one that another Session opened. A call that took the Browser and could not
attach to the page, or found the page off the origins by then, gives it up again. A call that fails later, on a refused
address or an element the page does not have, keeps driving it.

**Takeover.** A press, a key or a touch of the user on the page or the frame takes the Browser over. A mouse move or a
scroll does not, and neither do the Session's own events. From then on the user goes anywhere, and every call of a
Session answers "The user took over this Browser". A click or typing in progress sends nothing more to the page. "Return
control to Claude" gives the Browser back to the Session that drove it. A Browser nobody drives has nothing to take
over. While a Session clicks or types, the keyboard focus of the window stays where the user has it.

#### What a Session can do

The tools come from the MCP server `worfy-browser`, one server per Session. A Session gets it when it starts in a
Project, with its canvas attached, and when the Profile's list of MCP servers, if there is one, names `worfy-browser`
or `worfy-canvas`.

| Tool | What it does |
|---|---|
| `browser_list` | The Project's profiles with their origins; its Browsers with their profile, address, opener, Ticket, Live state and who drives |
| `browser_open` | A new Browser under an existing profile, optionally at a URL and for a Ticket |
| `browser_navigate` | Sends the page to a URL and waits for it to load |
| `browser_click` | Scrolls an element into view and clicks its middle; an element not shown is refused |
| `browser_type` | Up to 10,000 characters into a field, after what it holds; `submit` presses Enter after them |
| `browser_screenshot` | A PNG of the page as it is now |
| `browser_read` | The accessibility tree as text, with a `[ref=…]` per element, cut at 60,000 characters |
| `browser_console` | The last 200 console messages and uncaught errors, oldest first |
| `browser_network` | The last 200 requests, oldest first: method, URL, type, status; no bodies |

An element is a CSS selector or a ref from `browser_read`, exactly one of them. A ref of an older page is refused. The
logs start at the Session's first call on a page, and a woken or moved page starts them anew. A call waits at most 15
seconds for a window to draw the page. A click or a typing waits 300 ms for a navigation it may have started. A load is
waited for at most 20 seconds, and one command to the page gets 20 seconds.

**Origins.** A Session stays on the origins of the Browser's profile, matched whole: another port of localhost is
another site.

- The address of `browser_open` and `browser_navigate` is checked before the page moves. Anything but http and https
  is refused, and a profile without origins lets a Session open no page.
- Any other whole-page navigation of the main frame off the list is cancelled while the Session drives: a clicked link,
  a redirect, a script, a form. The page stays where it was, and the call answers with the refusal, naming the origin
  and the list.
- Frames inside the page and the requests of its resources are not checked.
- A page outside the origins, where the user went by hand before giving the Browser back, is not the Session's to read
  or use. Only `browser_navigate` leaves it. An empty page belongs to no site and may be used.
- After a Session's first call, the page's loads bypass its service worker until the page closes, so a service worker
  cannot answer a navigation before the check sees it.

The user's own browsing is not held to the origins.

**Passwords.** `browser_type` refuses a password field. It follows the focus from the element through open shadow roots
and frames, and refuses when a password field is on that way. It also refuses a frame of another site, a field with a
closed shadow root and a page that moves the focus away, because none of them can be checked. An input of a text kind,
a text area or an editable element takes the text. A Session never signs in; see
[Browser profile](#browser-profile).

#### When a Session leaves the Canvas

An operation that takes the last Node of a Session off the Canvas also removes the Browsers that Session opened, in the
same operation: Hide, Remove, Delete to the Trash or the archive. A Session the archive leaves alone (pinned, Keep)
keeps them from the archive, but not from a Hide or a Remove. Three kinds of Browser stay:

- One the user opened. It has no opener, and the Session's control of it ends.
- One the user locked.
- One the user took over and has not given back, or whose page has a `beforeunload` handler or does not answer within 3
  seconds. Main asks the pages right before the operation. Such a Browser stays as the user's own: it no longer counts
  as opened by the Session, it leaves the Family, and any Session may drive it.

Showing the Session again or a Restore does not bring the Browsers back. ⌘Z of the user's Hide, Remove, Delete or
"Archive finished sessions now" does: the Session returns with its Browsers at their former places, those that stayed get
their opener back, and a taken-over one gets the takeover back. ⇧⌘Z repeats the step and leaves the same Browsers with
the user. The archive's own timer makes no step of ⌘Z.

While all its Nodes are off the Canvas, a Session opens and drives no Browser. A Session with no Node at all, an agent
the Canvas does not show, is not off the Canvas. A click or typing running when the Session leaves stops before its next
event with "This Session left the Canvas", and the pages the call leads to stay checked until it ends or the user uses
the page. A Session shown again drives again at once.

**Family.** A Browser a Session opened is in that Session's Family, and in the Family of the Ticket it was opened for,
with that Ticket's Epic frame. A Browser the user opened has no Family.

#### Several windows

A Browser has one page. Of the windows of this Machine that show the Project, one draws it, and the others show its
frames. The first window to show the Project draws it. Each other window watches the frames while its frame is shown,
and sends its click, drag, scroll, keys and address to the page as the user's own. A press, a key or an address takes
the Browser over from a Session; a scroll does not. Back, Forward and Reload are inactive there, and there is no Open
bar.

Once the user's input in another window has rested for 1.5 seconds, the page moves there: main keeps the scroll, the old
window closes the page, and the new one opens the Node's address again. So a move is a reload. The page does not move
while it has a `beforeunload` handler or does not answer, while a Session drives it or while a call runs on it. The
window then keeps the frames, and its next input tries again. When the drawing window closes or reloads, the page goes
to the window worked in most recently, otherwise to the one that has shown the Project longest.

Frames are JPEGs of quality 60, at most 1280 × 1280 and at most one per 100 ms, sent only while a screen watches.

On macOS, ⌘A, ⌘C, ⌘V, ⌘X, ⌘Z and ⌘⇧Z from the frames go with their editing command, because Chromium runs them from
the app's menu and a key alone does nothing. Copy and paste use the clipboard of the Machine of the Project.

#### On a Linked machine

The Browser runs on the Machine of its Project. A Linked machine never draws the page and holds no cookies of it.

**With full access** the frame works as in another window of this Machine, with the same frames at the same rate. The
input has no password check, so the user can sign in through the frames. A screen tells the Machine what it shows every
20 seconds, and a report counts for 60 seconds, so a Browser seen there does not sleep for being off screen. This holds
only while a window of the Machine shows the Project. Without such a window no page can be drawn, and a wake from the
Linked machine is refused.

**With read-only access** the frame has the name of the profile alone: no address bar, buttons, frames, marks or picture.
The accent border of a driven Browser still shows. The Layout it gets carries no Browser address. It cannot take a
Browser over.

#### Windows

The one difference in the Browser's code is the editing commands of ⌘ shortcuts: a Windows Machine adds none, and the key
and its modifiers go to the page as they are.

### How it works

- **A `<webview>` in a layer of its own.** A `<webview>` is an element of the page, so the Canvas zoom scales it and
  Nodes and menus cover it ([ADR-0078](../adr/0078-browser-node.md)). The Canvas draws only the Nodes on screen, which
  would destroy a page inside a Node. So a layer inside React Flow's viewport, under all Nodes, draws each page at the
  place of its frame's body. The body is transparent and lets the mouse through.
- **main decides, windows report.** Each window tells main which frames it shows and at which zoom. Main holds the state
  of every Browser and tells each window which pages it draws. A Linked machine's report expires because its screens can
  vanish without a word.
- **Control is over CDP.** Main uses Electron's `webContents.debugger` of the page, on the Machine of the Project. It
  attaches at the first need: a Session's call, a question before sleep, a screencast. It stays attached. When DevTools
  takes the page, the next call attaches again and the origin check holds again, and the logs stay.
- **The origin check is in the Fetch domain.** After a Session's first call on the page, every request for a document
  pauses. For the main frame, while a Session drives, it is checked, and one off the list is failed as `Aborted`, which
  Chromium treats as a cancelled navigation. A guard that cannot read the origins refuses.
- **Typing happens inside the page.** The text goes in by the page's own editing command, and Enter as page events with
  HTML's implicit submission. A key through Chromium's input would move the focus of the worfy window. A click is
  Chromium's own and trusted, and the window puts the focus back after the release.
- **The page has none of the app's powers.** A `<webview>` attaches with no preload and no Node integration, with context
  isolation and the sandbox, with web security on, and only on the partition of a Browser profile of a Project of this
  Machine. Main checks every attach and refuses any other.
- **The viewport is CSS.** The `<webview>` gets the viewport's size and a scale transform, and main does not read it
  ([ADR-0087](../adr/0087-browser-page-viewport.md)). A frame or a picture is fitted the same way, and input is mapped
  back by the same scale.

### Implementation

| What | Where |
|---|---|
| The IPC contract of the `browser` domain | `src/shared/ipc/browser.ts` |
| Handlers; which guest a window may hand to main | `src/main/ipc/browser.ts` |
| Life, control and owner of each Browser | `src/main/browser/live.ts` |
| The rules of sleep and the limit; which window draws the page, as plain functions | `src/main/browser/sleep.ts`, `src/main/browser/owner.ts` |
| The CDP session on one page; frames for other screens | `src/main/browser/cdp.ts`, `src/main/browser/screencast.ts` |
| Origin rules | `src/main/browser/origins.ts` |
| What a read-only Linked machine gets | `src/main/browser/read-only.ts`, `src/main/ipc/layout.ts` |
| The attach check; permissions and window requests of a page | `src/main/browser/attach-policy.ts`, `src/main/window.ts` |
| The MCP server and its instructions | `src/main/mcp/browser-server.ts`, `src/main/mcp/browser-instructions.md` |
| Tool schemas, limits, answer texts | `src/shared/browser/tools.ts` |
| Which Session gets the server | `src/main/agent/app-registry.ts`, `src/main/agent/options.ts` |
| Browsers leaving with a Session; ⌘Z | `src/main/layout/store.ts`, `src/renderer/canvas/history.ts` |
| The frame; its geometry, address, Open bar and profile choice | `src/renderer/canvas/nodes/BrowserNode.tsx`, `src/renderer/canvas/nodes/browser-frame.ts` |
| The sidebar and the viewport | `src/renderer/canvas/nodes/BrowserSidebar.tsx`, `src/renderer/canvas/nodes/browser-viewport.ts` |
| The layer of pages; no mouse for them during a gesture | `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/canvas/overlays/browser-pages.ts`, `src/renderer/canvas/nodes/frames-step-aside.ts` |
| The window's side of control, frames and lives | `src/renderer/browser/control.ts`, `src/renderer/browser/frames.ts`, `src/renderer/browser/lives.ts` |
| Settings → Browser; Family | `src/renderer/settings/BrowserSection.tsx`, `src/shared/settings/app-settings.ts`, `src/renderer/canvas/family.ts` |
| How an implementer uses a Browser | `harness/skills/ship-ticket/implementer-browser-checks.md` |

**Data flow.** The layer reports what the window shows on `browser.screen`, and reads Live and Asleep from
`browser.lives.list` and `browser.lives.changed`. For each Browser whose `here` is true it draws a `<webview>` on the
partition of the profile. At `dom-ready` it hands main the guest on `browser.page.live`. Main accepts only a guest whose
host is the caller, on the Browser's partition, from the window that owns the Browser, and makes a `CdpPage`. A Session's
call goes through `browserToolCaller`, which holds the Browser for the call. The call wakes it if needed, waits for the
page, takes control and sends CDP commands. Another screen watches on `browser.frames.watch`, gets `browser.frame`, and
sends `browser.input` and `browser.navigate`.

**Main tests.**

- `test/e2e/browser.spec.ts`: the frame, address, history, restart, Open bar.
- `test/e2e/browser-layer.spec.ts`, `test/e2e/browser-focus.spec.ts`, `test/e2e/browser-viewport.spec.ts`: the page.
- `test/e2e/browser-sleep.spec.ts`, `test/unit/browser-sleep.test.ts`: the rules and the limit.
- `test/e2e/browser-mcp.spec.ts`, `test/contract/browser-tools.test.ts`: the tools, origins, passwords, takeover,
  sign-in.
- `test/contract/browser-lifecycle.test.ts`, `test/e2e/browser-family.spec.ts`: leaving with a Session, ⌘Z, Family.
- `test/e2e/browser-screens.spec.ts`, `test/e2e/linked-browser.spec.ts`, `test/contract/browser-frames.test.ts`,
  `test/unit/browser-owner.test.ts`: several windows, frames and a Linked machine.
- `test/e2e/browser-webview-guard.spec.ts`, `test/unit/browser-editing-commands.test.ts`: the attach check and
  permissions; the ⌘ shortcuts by platform.

## Browser profile

### Behaviour

A Browser profile is the saved sign-in of one role, such as admin, moderator or user: its cookies, logins and site data.
The user signs in by hand in a Browser. Sessions arrive signed in and never see the passwords. A profile may be open in
several Browsers, which share its cookies; a Browser of another profile does not see them. A profile belongs to the
Project and is kept on the Machine, with nothing in the repository. Its sign-ins survive a restart.

**The window "Browser profiles…"** opens from the profile's name in a frame's header and from the menu of "Choose a
profile". It lists the Project's profiles with the number of Browsers on the Canvas that use each one, and creates a new
one from a name. Only the user creates, changes and deletes profiles, and no Session tool does.

| Field | Rules |
|---|---|
| Name | Required, up to 60 characters, unique in the Project regardless of case. Renaming keeps the sign-ins |
| Origins | One per line, up to 50. Exactly `scheme://host:port`, http or https: no path, query, user or `*`. Kept as the browser writes them. Empty is allowed |
| Sign-in page | Optional. One http or https address up to 2000 characters, on one of the profile's origins, without a user name or password |
| Available to Autopilot | Off unless the user turns it on |

The window shows an error as the user types, and main checks again before it writes. A change of origins that leaves
the sign-in page off them is refused.

**Default.** A Project with no profile file has one profile, Default, with no origins and not available to Autopilot. A
Session can open no page under it until the user adds origins. Default can be renamed and deleted like any other. A list
the user emptied stays empty.

**Which profile a Browser uses.**

| The Node | The Project | The Browser |
|---|---|---|
| Keeps a profile that exists | any | Uses it |
| Keeps a deleted profile | any | Asks: "The Browser profile of this Browser was deleted." |
| New | Exactly one profile | Takes it, and keeps it from then on |
| New | Several | Asks: "This Browser has no Browser profile yet." |
| New | None | Asks: "This Project has no Browser profile yet." |
| Saved before profiles existed, with an address | Has Default | Uses Default, and keeps it from then on |
| Saved before profiles existed, with an address | No Default | Asks, as for a deleted profile |

A Browser saved before profiles existed without an address counts as new. A Browser that asks has no page, and its
address bar says "Choose a profile first". Its menu lists the profiles and "Browser profiles…". The frame offers no other
way to change a profile once it is settled.

**Deleting.** "Delete…" asks once more and names how many Browsers on this Canvas use the profile. Its cookies, logins,
caches and site data are erased, and those Browsers ask for another profile. Pages open on it are closed first, and the
storage is erased after they have gone, or after 2 seconds anyway. If the erase fails, the window says so, and the
profile is gone by then. A new profile never gets the id of one that exists or `default`.

**An expired sign-in.** A page counts as signed out in two cases, and nothing is read from its text:

- It is the profile's sign-in page: the same origin and path, whatever the query. A profile without one relies on 401.
- Its main document answered 401. A 401 of a frame inside the page or of a script does not count.

Outside Autopilot, the answer to `browser_open`, `browser_navigate`, `browser_click` or `browser_type` then carries a
note that the sign-in expired and asks the Session to ask the user. The note names the sign-in page by origin and path
only.

**Autopilot.** A Session in Autopilot knows only the profiles marked "Available to Autopilot":

- `browser_list` shows no other profile and no Browser under one. A call naming one is refused before anything is made,
  woken or driven, with the answer to report `sign-in needed as <name>`.
- `browser_open` needs `ticket`, an `<epic>/<NN>` of the Epic the run works on. Outside Autopilot it is optional, and any
  Ticket of the Project is accepted.
- An expired sign-in refuses the call with `Sign-in expired in Browser profile "<name>"`. While the page is there only
  `browser_navigate` away is allowed, because a click could press a single sign-on button. The Session reports
  `sign-in expired in Browser profile <name>` and goes on without that check.

#### On a Linked machine

A profile is one for all screens, because the Browser runs on the Machine of the Project and its cookies stay there. With
full access, the window works as on the Machine and its changes run there. A read-only Linked machine reads the list,
with the names, origins and sign-in pages. Its create, change and delete are refused before they reach the handler, and
the window shows its fields read-only with a note.

### How it works

- **One persistent partition per profile.** Each profile has the partition `persist:worfy-browser-<hash>-<id>`, where
  `<hash>` ends the Project id ([ADR-0078](../adr/0078-browser-node.md)). Electron keeps it in the worfy data folder. It
  is named by the profile's id and not its name, so a rename keeps the sign-ins.
- **The id cannot take over old sign-ins.** It is a slug of the name, up to 24 characters, and six random hex digits. So
  a new profile with a deleted one's name gets a partition of its own.
- **The partition list is read at every attach.** A deleted profile's partition is refused at once.
- **Reading writes nothing.** Listing is a read channel, which a read-only Linked machine may call, so the file appears
  at the first change ([ADR-0005](../adr/0005-worfy-own-state-inventory.md)).
- **A bad file does not cost the profiles.** An unreadable file is set aside and the Project is back to Default. A
  sign-in page with a user or password, written by hand into the file, reads as none, and the profile stays.

### Implementation

| What | Where |
|---|---|
| The store: `browser-profiles.json` in the Project's data folder, the erase, the attach list | `src/main/browser/profiles.ts` |
| The record, the file schema, reading an origin and a sign-in page; the partition name | `src/shared/browser/profiles.ts`, `src/shared/browser/partition.ts` |
| Handlers `browser.profiles.*` | `src/main/ipc/browser.ts` |
| The window, and its copy of the list | `src/renderer/browser/BrowserProfiles.tsx`, `src/renderer/browser/profiles.ts` |
| Which profile a Node uses, the use count, a new Node's data | `src/renderer/canvas/nodes/browser-frame.ts`, `src/renderer/canvas/overlays/create-items.ts` |
| The sign-in check and Autopilot's limits | `src/main/mcp/browser-server.ts` |

**Data flow.** The window calls `browser.profiles.create`, `browser.profiles.update` or `browser.profiles.delete`. Main
writes the file and tells every window on `browser.profiles.changed`, also when an erase failed. Each window reads the
list again, and a frame and the layer pick the profile from it. The layer writes a picked profile into a Node that has
none, as a Layout operation that is not a step of ⌘Z.

**Main tests.**

- `test/e2e/browser-profile.spec.ts`: cookies per profile across a restart, deleting, the palette.
- `test/contract/browser-profiles.test.ts`: the store, the erase, read-only access, the attach check.
- `test/unit/browser-profiles.test.ts`, `test/unit/browser-profile-choice.test.tsx`,
  `test/unit/browser-profiles-window.test.tsx`: origins, the choice rule, the window.
- `test/e2e/browser-autopilot.spec.ts`, `test/contract/browser-tools.test.ts`: Autopilot's limits and an expired sign-in.
