# Link

Two Features. **Machine** is this worfy as the link knows it: an id, a name, a key and a certificate, all tied to one
data folder. **Linked machine** is another Machine connected to this one by a 6-digit code, whose Projects can be
opened from here when it allows that. Terms are explained in [Concepts](concepts.md).

## Machine

### Behaviour

A Machine is one worfy data folder, not one computer. A dev build and the Stable copy on one Mac have different
folders, so they are two Machines and can be linked to each other.

**Identity.** The first start over a data folder creates the Machine: an id, a name, a private key and a certificate.
The folder keeps them. The name is the computer's name without its domain, for example `Alexeys-MacBook-Pro`. An
unpacked build adds ` (dev)`, because otherwise the two Machines on one Mac would show the same name. A narrow row
cuts the name itself and keeps `(dev)` visible. The interface has no action that renames a Machine, and a later rename
of the computer does not change the stored name.

**Projects.** A Project lives on exactly one Machine: its folder, Sessions, worktrees and Gate are there. One folder
that is connected on two Machines is two Projects, each with its own Canvas and Layout. Moving a Node in one does not
move a Node in the other.

**Listening.** A Machine with no Linked machine has no open port. The link server listens only while it has a reason:

| Reason | How long |
|---|---|
| At least one Linked machine | Until the last one is removed |
| "Link a machine" is open in a window of this Machine | Until the last such window closes it, or too many attempts fail |
| This Machine is linking itself to another one | For the length of that attempt, so the other side learns a port that answers |

**The port.** The operating system picks a port on the first listen. worfy keeps it and asks for it again on the next
start, so a Linked machine finds this one where it was. If that port is taken, the system picks a new one, and the new
one is kept from then on. The server listens on every interface. A port that cannot be taken or a key that cannot be
read never stops worfy. The other parts of the app work, and "Link a machine" shows the reason.

**The Machines section.** "Machines" in the sidebar stands between Projects and Epics and is collapsed until the user
expands it. It lists the Linked machines, with "Link a machine…" under the list. The switches of the link are in
Settings → Machines. Both are described under [Linked machine](#linked-machine).

### How it works

- **A Machine belongs to a data folder.** The first check of the link had to work with a dev build and the Stable copy
  on one Mac, so a Machine cannot be recognised by its computer's name, and two worfy cannot share a port
  ([ADR-0052](../adr/0052-machines-and-linking.md), [ADR-0023](../adr/0023-separate-data-roots-packaged-and-dev.md)).
  The roles host and client belong to one connection. Any Machine plays both.
- **Self-signed certificate, no certificate authority.** The certificate is ECDSA P-256, valid for 20 years, and
  starts a day in the past. Trust rests on the fingerprint remembered at linking, so no root certificate is installed
  anywhere.
- **A lost key makes a new certificate under the same id.** A key that is missing or does not fit the certificate is
  replaced at the start, with a warning in the log. The Linked machines then see "Certificate changed" and have to
  link again.
- **The secrets are a plain file.** The private key and the tokens this Machine presents to others are needed as they
  are, so they cannot be hashes. `link/secrets.json` in the data folder is written with mode 0600 in a folder with
  mode 0700, the way ssh keeps its keys. Electron's safeStorage is not used: on macOS it keeps its key in the Keychain
  under the app's code signature, and worfy's ad-hoc signature changes with every build. Windows uses the same file,
  not DPAPI.

### Implementation

| What | Where |
|---|---|
| Id, name, certificate; `link/machine.json` | `src/main/link/identity.ts` |
| The secret store; `link/secrets.json` | `src/main/link/secrets.ts` |
| The service: reasons to listen, the port, the app's link and its stop on quit | `src/main/link/service.ts` |
| Start and quit in the app | `src/main/index.ts` |
| The data folder | `src/main/storage/paths.ts` |

The files of a Machine are in `<data folder>/link`: `machine.json`, `secrets.json`, `linked.json`, `settings.json` and
the journal `link.log`. `src/main/link/service.ts` also reads three environment variables for tests: `WORFY_LINK_HOST`
(the one address to listen on), `WORFY_LINK_BONJOUR=0` (Bonjour off) and `WORFY_LINK_INTERFACES` (the machine's
interfaces, in an unpacked build only).

Tests: `test/contract/link-server.test.ts` (when the server listens, the certificate over real TLS),
`test/unit/link-secrets-write.test.ts`. `test/contract/link-bench.ts` runs several services over temporary data
folders in one process.

## Linked machine

### Behaviour

#### Linking

1. Open "Link a machine…" on both worfy. Each shows its own six-digit code and its addresses.
2. On either one, pick the other worfy from the list, or type its address as `host:port` and press Next.
3. Type the code the other worfy shows, then Link.

Both windows then say `Linked with <name>`, and each Machine lists the other under Machines. The link works both ways,
so the second side does not link again. The window lists a Machine that is already linked as "Already linked", with no
way to link it, and says which switch to turn on over there. A new link starts with access Off on both sides.

**The list.** Bonjour searches while the window is open and shows the worfy it finds on the local network, without
this Machine; the Machines already linked get their own "Already linked" rows. It keeps at most 64 announcements. An
announcement is a claim and not a proof. "Two addresses" marks two announcements that claim one Machine id at
different addresses, one of which is not that Machine. "Other version" marks a worfy of another link protocol, which
linking will refuse until both run the same version.

**The code.**

| Rule | Value |
|---|---|
| Length | 6 digits |
| Life of a code | 2 minutes, then a new one appears by itself |
| A code is burnt | By the first exchange message of any attempt, also a failed one; a new code then appears |
| Attempts at one time | One; a second gets "another Machine is linking right now; try again in a moment" |
| Wait for each step of the exchange | 15 seconds |

A wrong code gives "the code did not match, or the connection to the other Machine was intercepted; nothing was
linked".

**Too many failures.** Each attempt is one guess at one code, and an attempt that ends before its first message counts
too. 10 failures in a row close linking for that opening. 10 failures within a sliding hour, counted across every
opening and every address, close linking and pause it until the oldest of the ten is an hour old. During the pause:

- The window says `Linking is paused until <time> after repeated failed attempts. Restart worfy to link sooner.`
- The Machine shows one notification with the count and the addresses the attempts came from.
- A worfy that tries to link during the pause learns that linking is paused, and not until when, if this Machine still
  listens, as it does while it has a Linked machine or is linking to another one itself. Otherwise the port is closed,
  and it gets "could not reach".
- When the pause ends, an open window opens linking again by itself.

The count is kept in memory, so a restart lifts the pause. Machines already linked are not affected.

**Other refusals.** These store nothing either: the address of this Machine itself; a Machine id already linked here
with another certificate, with a text that asks to remove it first; a worfy of another link protocol, with a text that
names both versions.

**Closing the window.** Close, Esc or a click outside closes the window. Linking stays open while any window of this
Machine has it open. When the last one closes, an attempt in flight is cut off and stores nothing.

#### States of a Linked machine

| State in the Machines section | Meaning |
|---|---|
| Online | A connection is open, opened by either side |
| Sleeping | It said it was going to sleep, has not said it woke, and no connection has opened since. This wins over a connection that has not dropped yet |
| Offline | No connection, without such a message. worfy keeps trying |
| Certificate changed | The last dial met a certificate other than the remembered one. The tooltip asks to remove it and link again |

The dot next to the "Machines" heading shows even when the section is collapsed. It is amber when any Machine has
"Certificate changed". Otherwise it is green and pulsing when at least one is online, with the number in its tooltip.
With nobody online there is no dot.

Under each row are the access lines. "Can work with your Projects" or "Can't see your Projects" describes this
direction. "Shares its Projects with you" or "Doesn't share its Projects" describes the other direction, and appears
only while the Machine is connected and has said so.

#### Reconnect, Change address, Remove

A row without a connection has the buttons Reconnect, Change address… and Remove. The context menu of any row has the
same actions, without Reconnect on an online Machine. The Command palette has "Reconnect machine…" for each Machine
without a connection and "Remove machine…" for each one.

**Reconnecting is automatic.** The pause between dials doubles from 1 second to 30 seconds, and an open connection
resets it. worfy dials at once, without the pause, in three cases: on wake-up, when the addresses of this machine
change, and on Reconnect. The addresses are read every 5 seconds. Only the IPv4 addresses that may carry the link count:
local-network and Tailscale ones, not 169.254/16 and not IPv6. A new set counts once two reads in a row see it, so a
change is acted on 5 to 10 seconds after it happens, and the journal line names the addresses that came and went. While
a dial runs, Reconnect shows "Connecting…" and is inactive.

One dial tries, in this order and with a limit of 10 seconds per step: the remembered address; the Machine's `.local`
name, when known; its MagicDNS name, when known and while "Link through Tailscale" is on; the address where Bonjour
sees it now, when that is somewhere else. A Machine that answers "not linked" ends the dial at once. Another protocol
at the remembered address skips the names, but the address where Bonjour sees it is still tried.

Bonjour searches while a Linked machine is unavailable, and its announcement gets one dial there at once. Each address
other than the remembered one counts only when the remembered certificate answers there. The new address is then kept.

A connection is checked by a ping every 15 seconds, and one without a pong by the next ping is cut. On wake-up or a
change of network each open connection is checked at once and is cut when no pong comes within 3 seconds.

**Change address…** takes an address or name with its port. worfy keeps it only if the certificate the Machine was
linked with answers there, and that dial then becomes the connection: every other connection between the two Machines,
whichever side dialled it, is closed, so the pair keeps only the new one. The Machine stays connected throughout, with
no "disconnected", and the journal on each side notes which connection was replaced by which. Another certificate or
no answer is shown in the window as a refusal, and the address and the open connections stay as they were.

**Remove** always asks first, and the focus starts on Cancel. It forgets the Machine here at once, including its
access level and tokens. The other side loses the link at once when connected, otherwise on its next connection, when
it gets a refusal and forgets this Machine too. Removing the last Linked machine stops the server, so the other side
shows this computer as Offline until it removes it too or "Link a machine" opens here. Linking again takes a new code.

"Certificate changed" clears when the remembered certificate answers again, for example when another worfy had taken
the address. A Machine that really has a new certificate has to be removed, on the side that remembers the old one,
and linked again.

#### Access to the Projects of this Machine

For access, Settings → Machines has one switch and a level per Linked machine.

"Linked machines can work with my Projects" is off by default. Off means Off for everyone, whatever each level says:
the level rows are inactive and show Off, and the kept levels show again when the switch is on.

| Level | What the Linked machine gets |
|---|---|
| Off | Cannot see or change the Projects. Every call except the link's own ping is refused with "access is off". |
| Read only | Sees the Projects, Sessions and notifications. Terminal output does not leave this Machine, and any change is refused. A Session transcript can show a secret, so this still means trust. |
| Full access | Works with the Projects as the user here does: Sessions, Terminal, Autopilot. |

A change takes effect at once and the connection stays. The Linked machine's subscriptions end, and a call already
running finishes. Between Read only and Full access its windows on this Machine load again. At Off they keep their
Canvas under a line, described below.

**Off closes the way in, not the work.** Sessions and Autopilot runs started from a Linked machine keep running, after
Remove too. The person at this Machine stops them with the usual actions. A Terminal is the exception: a shell ends
when its last screen leaves, so one opened only from that Linked machine ends with its access.

**What no level opens:**

- Anything outside the Projects of this Machine. A path is judged by its real path, so `..`, a symbolic link out of a
  Project or another spelling of a folder does not pass.
- Actions that need this desktop: a native dialog or the OS shell.
- The state of this screen: the active Project, the menu, Limits, the link settings and the pairing code.
- A Project local to this Machine (the Demo project). A Linked machine does not see it, and a call that names it is
  refused.

#### Keep awake

"Keep this computer awake while linked machines are connected" is on by default. The system does not sleep and the
display may go dark, while all of these hold: the switch is on, access is on, and at least one connected Linked
machine has Read only or Full access. It is released the moment any of them stops holding, and on quit. With access
off the switch is inactive and shows off, and the kept value shows again once access is on.

#### Link through Tailscale

By default the server takes peers on the local network and loopback only: 127/8, 10/8, 172.16/12, 192.168/16 and
169.254/16, and in IPv6 ::1, fc00::/7 and fe80::/10. There is no port forwarding, tunnel or relay. "Link through
Tailscale" adds the user's tailnet, with these rules:

- It is off by default and does not depend on access. It decides who may reach the server at all, linking included.
- It has to be on on both computers. A dial to a Tailscale address with the setting off is refused with a text that
  says where to turn it on.
- A peer in a Tailscale range (100.64.0.0/10, fd7a:115c:a1e0::/48) passes only when the connection arrived on a
  Tailscale address of this machine. 100.64.0.0/10 is also carrier-grade NAT, so a neighbour at the same provider
  arrives on the home address and is refused.
- Turning it off closes the connections and the linking attempts over Tailscale, in both directions.

While it is on, "Link a machine" lists this Machine's Tailscale addresses first, with a "Tailscale" mark, and the
address field also takes a MagicDNS name with the port, like `pc:52000`.

**The tailnet list.** While the setting is on, "In your tailnet" comes from `tailscale status --json`, online machines
first, without this Machine and without Linked machines known by a Tailscale address or MagicDNS name. Picking an
online machine puts its address in the field, and the port is still typed: it is under the code on the other worfy. An
offline machine is grey and cannot be picked. No CLI means no list. A CLI that fails, or does not answer within 3
seconds, also gives no list, with one warning in the log and no error in the window.

**This machine's MagicDNS name.** While the setting is on, the server takes `Host` names under `ts.net` only when they
are this machine's own MagicDNS name. worfy reads that name, `Self.DNSName`, from `tailscale status --json` on the
first linking request after the network changes, and keeps it until the next change. A request waits for the CLI for
at most 3 seconds. The full name and its first label pass; every other name under `ts.net` is refused. When the CLI is
missing or fails, worfy guesses the name from the computer's name: its first label, in any tailnet. Then a machine
renamed in the Tailscale admin console is refused by its new name. With the CLI, a rename is seen after the next change
of network or a restart of worfy. The Tailscale address works in both cases.

#### On a Linked machine

This is what a window on this Machine does with a Project of another one.

**Opening.** With at least one Linked machine, the Projects section groups Projects by Machine: this one first, then
the others by name. Each Linked machine has its state: Online or Unavailable, and "Read only" beside Online when it
shares that way. A Machine with access off shows the line `<name> doesn't share its Projects`. A click on a Project of
another Machine loads the window again on that Machine. A window shows the Projects of one Machine, and the toolbar
names it.

**Everything runs on the Project's Machine.** Sessions, Terminals, Autopilot, Gate and Browsers run there. The screen
shows them and sends commands. Opening a Project there keeps its Orchestrator and documents open, as for its own
active Project, and its active Project does not change.

- **Shared by every screen:** the Layout, Cards, Sessions, Terminal and Autopilot state. Layout changes apply in the
  order they arrive, and the last one wins.
- **Own to each screen:** selection, Edge highlight, Find and open panels. ⌘Z (Ctrl+Z on Windows)
  undoes only that screen's own changes. The live camera is the window's own, and one saved camera per Project is kept
  on the screen's Machine.

**When the Projects cannot be reached.** The window keeps its Canvas under one line, and loads again by itself once
they can: `<name> is unreachable` (no connection), `<name> stopped sharing its Projects` (access went off over there)
or `<name> is no longer linked to this Machine` (the link was removed).

**Add project.** With Linked machines, "Add project" first asks for the Machine. On this Machine it opens the system
folder picker. On a Linked machine the folders are browsed inside worfy, up to 2000 per folder, and the Project is
added over there without changing its active Project. A Machine that cannot be chosen says why: its certificate
changed, it is asleep, it is not online, it does not let Linked machines work with its Projects, or it gives read-only
access.

**Actions that belong to the desktop.**

- "+" on a Session opens the file dialog of the screen's Machine, and the Project's Machine keeps the copy.
- A link opens on the Machine where it was clicked.
- "Open in editor" shows the toast `File is on <name>`, because the editor would open on a screen nobody here sees.

**Notifications.** The Project's Machine decides what to notify about and sends a Session's note to every connected
Linked machine with Read only or Full access. Each Machine shows a note by its own rules: the focus of its own window,
its own limit of one per Session in 10 seconds, and its own OS. A Machine that is not connected misses the note, and
nothing is kept for later. A click opens the Session.

**Autopilot.** One run per Epic and origin holds across linked Machines. Before a start, Autopilot asks every Linked
machine for its runs, whether or not access is on. A Machine that is not connected or does not answer within 3 seconds
does not block the start, and the start names it.

**A read-only screen.** The Canvas can be looked at, panned and zoomed. A notice at the top says `<name> gives this
Machine read-only access`. Write actions stay on screen, inactive, with that tooltip, and main refuses such a call
anyway. Nodes do not move and do not resize. A Terminal Node shows a stand-in, its shell does not start, and its
output is not sent.

#### Windows

The row of a Machine without a connection gets a hint while Bonjour searches and the Machine has not answered the
search within the last 30 seconds. The hint says the Machine may be off, asleep or on another network, and if it is on
and nearby, to check that Windows firewall lets this program receive connections: UDP 5353 for finding machines and
the TCP port of the link. It names the program by its path, which in a dev build is `electron.exe`.

The Tailscale CLI is looked for on the Path, then in the Tailscale folder under Program Files.

### How it works

- **The same contract, over a network.** A call from a Linked machine runs the same IPC handlers as a call from a
  window, registered on an adapter instead of on Electron's `ipcMain`, and inputs and answers pass the same schemas
  ([ADR-0052](../adr/0052-machines-and-linking.md)). The renderer never talks to another Machine. It calls its own
  main, and main passes the call on. What comes back is parsed with this side's schema of that channel, so a Linked
  machine cannot hand a window anything else.
- **Each channel has an access mark.** The same mark decides what a Linked machine may call and where a window sends
  the call:

  | Mark | Meaning | In a window on a Linked machine |
  |---|---|---|
  | `link` | Service channel (`link.ping`); open always | Stays on this Machine |
  | `project` | Work with the Projects, also marked `read` or `write` | Goes to that Machine |
  | `desktop` | Needs the desktop; never open to a Linked machine | Goes to that Machine, which refuses |
  | `local` | The screen's own state; never open to a Linked machine | Stays on this Machine |

  A name the adapter does not know is closed. Read-only access is a level of the same check
  ([ADR-0066](../adr/0066-read-only-access-for-a-linked-machine.md)). `terminal.output` is a `write` event, so
  Terminal output stays out of it.
- **The channel.** HTTPS with TLS 1.3 and a WebSocket over it. Each side presents its certificate, and the fingerprint
  is compared with the one remembered at linking. The client checks the server's fingerprint before the request is
  written, so a token never reaches a server with another certificate. The server refuses in this order, before the
  WebSocket handshake: a peer outside the allowed networks (dropped on TCP, before TLS), any `Origin` header, a `Host`
  that does not name this machine and port (against DNS rebinding), another protocol version, an unknown path, then
  the endpoint's own check. Each refusal before the endpoint's check writes `[link] refused a connection from <peer>:
  <reason> (Host <host>)` to the log, without the query string of the path.
- **Pairing proves the two certificates, not only the code.** The exchange is SPAKE2 (RFC 9382, P-256) with the code
  as the password. The identities in the transcript are the two certificate fingerprints each side saw, so a machine
  in the middle makes the transcripts differ, and the key confirmation fails on both sides. A captured exchange cannot
  be checked against other codes offline. Each side introduces itself only after the other's confirmation held. The
  side that shows the code stores the link once the typing side has accepted it, and the typing side stores it after
  that, so it never dials with a token the other does not know.
- **Tokens.** Each side issues the other 32 random bytes. It keeps only the SHA-256 hash of the token it issued, and
  the token it presents goes to the secrets file. Entering needs both the token and the certificate of one Linked
  machine. A 401 from a Machine whose certificate checked out means it has forgotten this one, so this side forgets it
  too.
- **An address is only a hint.** A Bonjour announcement or an address typed by hand proves nothing until the
  remembered certificate answers there. An incoming connection that passed the checks updates the remembered address
  too. The `.local` name is learnt only from an announcement at the address of an open connection.
- **One connection per Machine carries the calls.** Both sides dial, so two connections may be open, and a Machine is
  online while any is; Change address… closes all but its own. Calls go over one, and only its events are passed on.
  When another connection takes over, or sharing comes back, or the level changes between Read only and Full access, a counter called the epoch changes: what
  the old connection subscribed to is gone, and a window on that Machine loads again.
- **Service messages are not IPC channels.** `hello`, `revoked`, `sleeping`, `awake`, `projects-access`, `note`,
  `ticket-note`, `autopilot-runs-ask` and `autopilot-runs` are the link's own, each parsed with a schema on arrival.
  Each `hello` lists what that build accepts, and a message added later, such as `ticket-note`, goes only to a Machine
  that named it, so an older build keeps working
  ([ADR-0079](../adr/0079-link-machines-announce-accepted-messages.md)).
- **Why Tailscale and no other way out of the local network:**
  [ADR-0070](../adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md). The pause after failed attempts is
  there too, with its known limit: anyone on the network can keep linking paused by guessing wrong.
- **Why several screens work this way:** [ADR-0053](../adr/0053-several-screens-on-one-project.md). Why access off
  does not stop work: [ADR-0060](../adr/0060-access-off-keeps-started-work.md).

**Limits on a connection.** The link protocol is version 3. One message on an established connection is at most 16
MiB, and a call or an answer over that gets an error of its own and leaves the connection up. A pairing message is at
most 64 KiB. A call waits 30 seconds for its answer. A Card file or a stored image goes in pieces of at most 4 MB.
Quitting waits at most 1.5 seconds for Bonjour's goodbye, which lets other worfy drop this one from their list at
once.

**Logs.** No pairing code or token reaches the console or an error text, and the code goes only to this Machine's
windows. Every `[link]` line also goes to `link/link.log`, which rotates at 1 MiB and keeps 3 older files, 4 MiB in
all. It replaces anything that looks like a secret before writing. A failed dial is written once per reason, not once
per retry.

### Implementation

| What | Where |
|---|---|
| The service: pairing from both sides, connections, revoke, frames | `src/main/link/service.ts` |
| The server and its checks | `src/main/link/server.ts`, `src/main/link/checks.ts` |
| The client: dial, fingerprint before the token | `src/main/link/client.ts` |
| SPAKE2, the code, failure counts | `src/main/link/pairing.ts` |
| One connection: frames, calls, heartbeat | `src/main/link/connection.ts` |
| Dials and their pauses, the watch on the network | `src/main/link/connections.ts` |
| Bonjour; Tailscale CLI | `src/main/link/discovery.ts`, `src/main/link/tailscale.ts` |
| Frames, protocol version, service messages | `src/main/link/messages.ts` |
| The list of Linked machines; switches and levels | `src/main/link/store.ts`, `src/main/link/settings.ts` |
| Calls from a Linked machine, its two clients | `src/main/link/ipc-adapter.ts` |
| Calls to a Linked machine, the epoch, the level it gave | `src/main/link/remote-calls.ts` |
| Paths inside Projects; Projects local to this Machine | `src/main/link/caller.ts` |
| Keep awake; sleep messages; the journal | `src/main/link/keep-awake.ts`, `src/main/link/sleep-notice.ts`, `src/main/link/log-file.ts` |
| Notes; the Autopilot question; files in pieces | `src/main/link/notes.ts`, `src/main/link/autopilot-runs.ts`, `src/main/link/file-chunks.ts` |
| Holding a Project for a screen; browsing folders; the saved camera | `src/main/projects/holds.ts`, `src/main/projects/browse.ts`, `src/main/layout/viewports.ts` |
| Handlers and contract of the link state | `src/main/ipc/link.ts`, `src/shared/ipc/link.ts` |
| Handlers and contract for a window on a Linked machine | `src/main/ipc/linked.ts`, `src/shared/ipc/linked.ts` |
| Access marks; routing a channel from a window | `src/shared/ipc/channels.ts`, `src/renderer/ipc.ts` |
| Groups in the sidebar, reload on a new epoch, read-only level | `src/renderer/projects/useProjects.ts`, `src/renderer/projects/read-only.ts` |
| The link state in the renderer; access lines | `src/renderer/machines/useMachines.ts` |
| "Link a machine" | `src/renderer/machines/LinkMachineDialog.tsx` |
| Remove and Change address | `src/renderer/machines/MachineDialogs.tsx`, `src/renderer/machines/ChangeAddressDialog.tsx`, `src/renderer/machines/machine-dialogs.ts` |
| The dot; the toast about a file | `src/renderer/machines/machines-dot.ts`, `src/renderer/machines/useFileElsewhere.ts` |
| Machines section; Projects groups; Settings → Machines; palette commands | `src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/settings/MachinesSection.tsx`, `src/renderer/palette/commands.ts` |
| Read-only Canvas and Terminal | `src/renderer/canvas/overlays/ReadOnlyCanvas.tsx`, `src/renderer/canvas/read-only-nodes.ts`, `src/renderer/canvas/ReadOnlyTerminal.tsx` |

**Data flow of a call.** A window on Linked machine M calls a channel. `src/renderer/ipc.ts` reads its mark and sends
a `project` or `desktop` channel as `linked.invoke` to this Machine's main. `src/main/link/remote-calls.ts` sends it
over M's current connection. On M, `src/main/link/service.ts` passes the frame to `src/main/link/ipc-adapter.ts`,
which checks the mark and the level and runs the same handler a window would, with a sender whose id is a string. That
is how `src/main/link/caller.ts` tells a remote call from a window. The answer comes back, is parsed with this side's
schema, and reaches the window. M's broadcasts reach its `project` client as event frames and arrive as
`linked.event`. Windows subscribed to one root on M are counted in `src/main/ipc/linked.ts`, because M sees one client
for all of them: the close goes to M only when the last window lets go.

**Tests.**

- Contract: `test/contract/link-pairing.test.ts` (RFC 9382 vectors, pairing), `test/contract/link-server.test.ts` (the
  certificate, the checks before the handshake, revoke, the heartbeat, size limits),
  `test/contract/link-connections.test.ts` (keeping the connection, the switches, Bonjour, retry timing, quit),
  `test/contract/link-access.test.ts` (levels and refusals), `test/contract/link-reconnect.test.ts` (dials, names, the
  Windows firewall hint), `test/contract/linked-ipc.test.ts`.
- Unit: `test/unit/link-checks.test.ts` (address ranges, `Host`), `test/unit/link-discovery.test.ts`,
  `test/unit/link-caller.test.ts`, `test/unit/link-tailscale.test.ts`, `test/unit/linked-read-only.test.tsx`.
- e2e: `test/e2e/linked-machines.spec.ts` (linking, revoke, Settings, opening a Project),
  `test/e2e/linked-reconnect.spec.ts`, `test/e2e/linked-read-only.spec.ts`, `test/e2e/linked-sleep.spec.ts`,
  `test/e2e/linked-system-actions.spec.ts`.
