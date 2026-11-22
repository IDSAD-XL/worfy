# Integrations

One Feature. An **Integration** is one account of one service — Jira and Confluence, Linear, Notion, Sentry, GitHub,
Figma or a custom MCP server — with a label such as «Jira — client A». worfy adds it, signs in to it and keeps the
sign-in on this Machine; a Project turns it on, and the Sessions of that Project get its tools as a server of worfy's,
without ever seeing the token. One service may have several Integrations, one per account, so two Jira sites of two
clients work side by side. This page covers the section Integrations of Project settings, Add integration, the two ways
to sign in, the Tools filter and its price, Settings → Integrations, Autopilot, Health check and a Linked machine. The
chip «MCP n/m» that shows an Integration's row in a running Session is on [MCP servers of a Session](mcp-servers.md);
the MCP servers the user added to Claude Code are there too. New to the terms: start with [Concepts](concepts.md).

## Integrations

### Behaviour

#### The catalogue

Add integration lists the services of the catalogue, each with the ways it signs in («Sign in», «API token»):

| Service | Signs in with | Note |
|---|---|---|
| Jira and Confluence | the Atlassian sign-in page; an API token (e-mail and token); a service account token | One site per sign-in: one Integration per site. The token works only when the organisation's admin turned token sign-in on (Admin → Rovo → Rovo MCP server → Authentication); the form says so and links the token page. |
| Linear | the sign-in page; a personal API key | |
| Notion | the sign-in page; a Notion MCP token | |
| Sentry | the sign-in page; a user auth token | |
| GitHub | a personal access token, or the token of the Project's `gh` account | Its sign-in page is closed to a client like worfy, so there is none. |
| Figma | the sign-in page only | Marked: Figma accepts only the clients of its own catalogue and may refuse worfy. |
| Custom server | the server's sign-in page, a token, a header of its own, or none | An `https://` address (`http://` only on this computer), or a command worfy starts on this Machine. |

Slack is not in the catalogue. A Slack server lets in only a Slack app registered with its own secret, and the
workspaces of the owner's clients do not allow such apps; Slack works through the claude.ai connector, one workspace
per claude.ai account, which shows under «From Claude Code» with its Allow. worfy never uses a browser's Slack cookie
tokens.

#### Adding an Integration

- **Project settings → Integrations** is a tab beside General. Its changes go to main at once: the tab has Close, not
  Save. A new Project shows «No Integrations in <Project> yet».
- **Add integration** opens the catalogue. An Integration of this Machine the Project does not use yet stands on top,
  under «Already on this Machine», with «Use in this Project»: it turns on here without a second sign-in.
- **The form of a service** takes a **Label**, unique on the Machine without regard to case («Jira — client A»), and the
  way to sign in. A token is the way picked when the form opens; the service's sign-in page is the second choice, and
  for Figma the only one.
- **With a token** the form takes the token (for Atlassian's API token the e-mail too). For GitHub it also offers «The
  token of the gh account <account>», with the scopes `gh` reports for it; worfy keeps a copy, so after `gh auth
  refresh` or a logout the Integration keeps the old token until it is given a new one. Saving checks the token with
  the service and then lists the tools: a refused token reads «Sign-in needed», any other answer is an error with the
  service's text, tokens hidden. A refusal from Atlassian is an error with the link to the admin's switch, since a right
  token the admin turned off cannot be told from a wrong one.
- **With the sign-in page** («Sign in with Atlassian», «Sign in with Linear»…) there is no token field: saving adds the
  Integration and opens the service's sign-in page in a worfy window titled «Sign in — <label>». The user signs in
  there; the window closes by itself once the service has given the sign-in. The screen opens the sign-in only in a
  worfy window: it has no button for the system browser.
- **A custom server** takes an address and a way to sign in, or a command with its arguments (separated by spaces) and
  its environment variables. A variable marked Secret goes to worfy's secret store, not into the Integration's list.

#### The section of a Project

Under «worfy integrations» each Integration of the Project has a row:

- **The label and where it is**: the site and the account the sign-in names, else the server's address (the host) or
  the stdio command. A sign-in through the service's page names no account and no site, so its row shows the address.
  A Basic token's e-mail is the account. «Also used in <Projects>» names the other Projects that have it on.
- **The status**: `Signed in`, `Sign-in needed` (with Sign in), `Error` with what the service answered, `Checking`.
  `Sign-in needed` adds that Sessions get «Sign-in needed» from its tools.
- **The tools and their price**, «41 tools · ~9k tokens», or with a filter «12 of 41 tools · ~3k tokens». The price is
  counted after the Project's Tools filter, because that is what the Project's Sessions get in every request to the
  model.
- **The Tools filter**: All (the default), Read only — the tools the service marks read-only — and Choose… for a list
  of names. Read only is not offered for a service that marks no tool either way, and the menu says why.
- **Enabled** turns the Integration on or off in this Project only; off, the row says «Off in this Project».
  **Autopilot** («Available to Autopilot») is off for a new Integration.
- **«…»**: Test (asks the service for the tools again), Rename (the label changes on the whole Machine), Re-sign in
  (only for an Integration that signs in through the service's page), Sign out, Disable or Enable in this Project, and
  Remove from Machine…, which asks first when another Project has the Integration on, and then takes it out of every
  Project of the Machine.

**Sign out** deletes the Integration's tokens; for one that signs in through the service's page it first asks the
service to revoke them, where the service has a revocation address, and clears the cookies of its sign-in window.
Remove signs out first.

#### From Claude Code

Under the Integrations, «From Claude Code» lists the servers and claude.ai connectors of Claude Code with their
status, their source and Allowed or Not allowed, as Edit profile does; Allow writes the Profile's list `mcp.allowed` as
before. A Profile with no list shows the default one as allowed, as Sessions get it.

- A server whose name is that of a service of the catalogue («claude.ai Atlassian», `linear`) has **Add as
  integration**: it opens Add integration on that service with the catalogue's address. The Profile's list does not
  change by itself.
- When such a server is allowed and an Integration of the same service is on in this Project, the row warns «Two <service>
  tool sets in this Project»: Sessions get both and may use the wrong account. It offers «Turn off <server> in this
  Project», which takes the name out of the Profile's list. While the server is not allowed, the row warns before Allow.

#### Settings → Integrations

Settings → Integrations lists every Integration of the Machine, its status and the Projects that use it, with Sign out
and Remove; Remove asks first when any Project has it on. An Integration that signs in through the service's page and
needs a sign-in has Sign in too, through the first Project that uses it. One no Project uses shows «Not used in any
Project». Entries a Project still keeps of an Integration the Machine no longer has (a Remove cut short) are named in
one line with Clean up. When the Machine's list could not be read (its file damaged or of another version, and set
aside), a line names the set-aside file and says Clean up waits: every entry would look removed.

#### In a Session

- A Session of the Project, its Orchestrator or a Session Node, on Claude Code or Codex, gets the enabled Integrations
  at its start, each as a server named after its label. A Session that worfy finds no Project for gets none. Terminal
  and Terminal AI run Claude Code with its own servers and get none.
- Each tool's description starts with the label («[Jira — client A] …»), so an agent with two accounts of one service
  tells them apart.
- A tool whose sign-in the service refused answers «Sign-in needed: <label>. Ask the user to sign in in worfy.», not
  silence. A refreshed access token needs no Restart of the Session.
- In the chip «MCP n/m» an Integration's row has its label and the source `worfy integration`; its Sign in opens worfy's
  sign-in window, never Claude Code's or Codex's. An Integration the Project turned on after the Session started stands
  in the group «Enabled in this Project after this Session started.» with Restart Session, which restarts the Session
  with the same conversation and gives it the Integration. That Restart is offered only to a Session a person is at.
  Details: [MCP servers of a Session](mcp-servers.md#integrations).

#### In Autopilot

An unattended Session gets only the Integrations «Available to Autopilot», read when it starts: its set is fixed for the
Wave, a change of the Project during the Wave does not reach it, and its rows offer no Restart. Autopilot never opens a
sign-in window: a refused sign-in answers the tool with «Sign-in needed», Health check gets a row, and the Run goes on by
its own rules for errors.

#### Health check

Health check has a non-critical row per enabled Integration of each Project whose sign-in the service refused or that
failed: «<label>: sign-in needed» or «<label>: <the service's text>», tokens hidden. A row of an Integration that signs in
through the service's page has Sign in; the others say to put in a new token in Project settings → Integrations. Turning
the Integration off in a Project takes that Project's row away at once, and turning it on in another gives that one a
row. A sign-in that works again, or a Remove, takes the rows away.

#### On a Linked machine

- With read-only access the section shows the list and the status, and every control is inactive.
- With full access the ticks Enabled and Autopilot, the Tools filter, Rename and Sign in work. The sign-in window opens
  on the Project's machine, where the person signs in.
- Add integration, a token, Sign out and Remove stay on the Project's machine: «On the Project's machine only: a token
  never crosses the link.»

### How it works

- **worfy stands between the Session and the service.** An Integration is an MCP server of worfy's whose tools are the
  service's. worfy main keeps the connection to the service — streamable HTTP, or the stdio of a process worfy starts
  itself — one per Integration and Machine, shared by every Session that uses it. A Claude Code Session gets the server
  inside worfy's process, as `worfy-canvas`; a Codex Session reaches it on worfy's endpoint on `127.0.0.1` with the
  Session's token. The service's token never reaches the agent's process: not its arguments, not its environment, not
  the files of Claude Code or Codex. Two accounts on one address are two servers with two names, so the limit of one
  connector per service and account does not apply. While worfy is closed, the tools of the Integrations do not work.
- **The Machine owns it, the Project turns it on.** One sign-in serves every Project of the Machine that turns the
  Integration on. Which Integrations a Project uses, with their filter and the Autopilot tick, is worfy's own setting of
  the Project, not the Profile's.
- **Secrets stay in worfy's data folder.** Tokens, the OAuth client and the secret variables of a stdio server are kept in
  a file only the user can read (0600, in a 0700 folder), as the secrets of the link are; the Keychain is not used, since
  the ad-hoc signature of each build would make it ask after every update. worfy writes nothing into the Profile, the
  repository, `~/.claude.json`, `.mcp.json` or Codex's `config.toml`, in Full mode and Silent mode alike.
- **The sign-in.** A token is checked with the service's `initialize`. A sign-in through the service's page is OAuth 2.1
  with PKCE, by the MCP SDK's client: it finds the service's sign-in server, registers worfy as a client once per
  Integration, and asks for the catalogue's scopes, or for those the server names when the catalogue has none. Each Integration's window has its own cookie partition, so a second
  account of one service does not pick up the first one's login. The redirect comes back to `127.0.0.1` and is caught by
  the window, with no listening port. A sign-in not over in 10 minutes fails. The access token is refreshed inside the
  connection, one refresh at a time, because both services tried rotate the refresh token: a second refresh with the
  old one would lose the sign-in.
- **The filter cuts what the agent gets.** The proxy cuts `tools/list` by the Project's filter, and a call of a tool the
  filter left out is refused before the service. This is how the cost of tools in every turn, the reason of the
  Profile's list ([ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md)), is kept for an Integration. The price is
  the length of the JSON of the tools' names, descriptions and schemas over 4, an estimate of the tokens. For the
  servers of Claude Code nothing on the screen promises that turning one off saves context: the warning about two tool
  sets is about the wrong account.
- **Names.** A server's name is the slug of the label: Latin letters, digits and `-`, at most 24 characters, so a tool's
  full name `mcp__<server>__<tool>` stays within the 128 characters Claude Code keeps. A name taken by another Integration
  of the Project, by a server of Claude Code or by worfy's own (`worfy-…`) gets `-2`. A tool whose full name would still
  pass 128 characters is left out. A Codex server of the user's `config.toml` with the same name is replaced in that
  Session, and the chip's row says so.
- **Tools only.** The proxy passes tools — text, images and links to resources as the service gave them; the services
  tried declare no `resources` or `prompts`.
- **The Profile's list stays for the servers of Claude Code.** Integrations are not in `mcp.allowed`, the policy tier
  does not touch them, and no entry of the list becomes an Integration by itself
  ([ADR-0111](../adr/0111-integrations-mcp-servers-worfy-runs.md), the amendment of 2026-11-20 of
  [ADR-0021](../adr/0021-mcp-servers-allowlist-in-profile.md#amendments)).
- **A Linked machine never gets a secret.** The channels that read the list and the status are read channels; those
  that change the Project's use of an Integration are write channels; adding, a token and removing are local only.

### Implementation

#### Modules

| What | Where |
| ---- | ----- |
| The model and the catalogue | `src/shared/integrations/types.ts`, `src/shared/integrations/catalogue.ts` |
| The Machine's list and secret store; the Project's field `integrations` | `src/main/integrations/store.ts`, `src/main/link/secrets.ts`, `src/main/projects/settings.ts` |
| Sign-in with a token, the `gh` account's token | `src/main/integrations/auth/tokens.ts` |
| Sign-in with OAuth, its window, Sign out | `src/main/integrations/auth/oauth.ts`, `src/main/sign-in-windows.ts`, `src/main/window.ts` |
| The proxy, server names, the filter, the price | `src/main/integrations/proxy.ts` |
| A Claude Code Session's Integrations | `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/mcp.ts` |
| A Codex Session's Integrations and worfy's endpoint | `src/main/vendors/codex/mcp.ts`, `src/main/mcp/http-server.ts` |
| The chip's rows of an Integration | `src/main/integrations/rows.ts` |
| Health check rows | `src/main/integrations/health.ts` |
| Channels `integrations.*` | `src/shared/ipc/integrations.ts`, `src/main/ipc/integrations.ts` |
| The section, Add integration, From Claude Code, the price | `src/renderer/integrations/IntegrationsSection.tsx`, `src/renderer/integrations/AddIntegrationDialog.tsx`, `src/renderer/integrations/ClaudeServers.tsx`, `src/renderer/integrations/dialogs.tsx`, `src/renderer/integrations/model.ts`, `src/renderer/integrations/cost.ts` |
| The tab in Project settings; Settings → Integrations | `src/renderer/shell/ProjectSettings.tsx`, `src/renderer/settings/IntegrationsSection.tsx` |

**Data flow.** Add integration calls `integrations.add` and `integrations.setSecret` (which checks a token) or
`integrations.signIn` (which opens the window). The Machine's list goes to `<WORFY_DATA_DIR>/integrations/integrations.json`,
the secrets to `integrations/secrets.json` under `<id>:access`, `<id>:refresh`, `<id>:client` and `<id>:env:<NAME>`, and
the Project's entry `{ id, enabled, tools, autopilot }` to the `integrations` field of `<Project data folder>/settings.json`.
At a Session's start the query of the Vendor reads the Project's entries and asks the proxy for one server per enabled
Integration. The proxy tells each change of status to the Health check rows and answers `integrations.status` and
`integrations.tools`.

#### Tests

| Test | Covers |
|---|---|
| `test/unit/integrations-catalogue.test.ts` | The services of the first version without Slack, GitHub on a token only, Figma marked, the Atlassian admin's condition. |
| `test/contract/integrations-store.test.ts` | The list without a secret, the secrets 0600 in a 0700 folder, the unique label, Remove with its secrets, the Project's field, nothing written outside worfy's data folder. |
| `test/unit/integrations-auth-headers.test.ts` | The headers of Bearer, Basic and a header of its own, no token in an error. |
| `test/contract/integrations-token-auth.test.ts` | The token checked with `initialize`: right, refused, a 403 with the service's text, two Integrations on one address, the `gh` account's token. |
| `test/contract/integrations-oauth.test.ts` | Discovery, one registration per Integration, PKCE and the resource, the system browser's loopback, a refresh without a Restart and one refresh for ten calls, Sign out. |
| `test/unit/integrations-oauth-redirect.test.ts` | The redirect of its own Integration and state, the window on the Integration's partition. |
| `test/contract/web-policy.test.ts` | The sign-in window may go to the service's pages; new windows and permissions stay refused. |
| `test/unit/sign-in-windows.test.ts` | Every list of windows in main leaves the sign-in windows out. |
| `test/unit/integration-server-name.test.ts` | The slug of a label, `-2` on a clash, a name of Claude Code's taken. |
| `test/contract/integrations-proxy.test.ts` | Two Integrations on one address each with its own data, one shared connection, a stdio server's secret in its environment, cancelled calls, a changed secret. |
| `test/contract/integrations-claude-session.test.ts` | A Claude Code Session gets exactly its enabled Integrations next to `worfy-canvas`, the Profile's list untouched, Autopilot, Turn off for this Session, the row's source and label. |
| `test/contract/integrations-codex.test.ts` | The Integrations of a Codex Session on the fake app-server, the filter on the endpoint, no token where Codex or a log sees it. |
| `test/unit/integrations-section.test.tsx` | The rows of each status, the Tools filter and its price, the ticks, the «…» menu, Remove's confirmation, «two tool sets» and «Add as integration», a Linked machine. |
| `test/unit/add-integration-dialog.test.tsx` | The catalogue without Slack, «Use in this Project», the unique Label, the token fields, a custom server over http and stdio. |
| `test/contract/integrations-screen.test.ts` | The channels of the screen: the tools before the filter and the price after it, Sign out, the Machine's list with orphans and Clean up, Remove from Settings, the `gh` account's token. |
| `test/unit/settings-integrations.test.tsx` | Settings → Integrations: the line of a set-aside list, Sign in through a Project that uses the Integration. |
| `test/contract/integrations-autopilot.test.ts` | Autopilot gets only the Integrations «Available to Autopilot», its set fixed for the Wave, no sign-in window. |
| `test/contract/integrations-health.test.ts` | The Health check rows: non-critical, one per Project that has the Integration on, Sign in for OAuth, no token, back to OK. |
| `test/contract/integrations-linked-machine.test.ts` | Read only, full access with Sign in on the Project's machine, the channels never open to a Linked machine. |
| `test/e2e/integrations.spec.ts` | Add integration on a stub server in the built app, two Projects on one address each with its own data, Sign in with OAuth in worfy's window, Restart giving a running Session the Integration, a refused refresh as «Sign-in needed» in the row, the chip and Settings → Health. |
