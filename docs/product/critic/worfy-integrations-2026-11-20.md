# Critic: worfy-integrations — 2026-11-20

Plan: `.scratch/worfy-integrations/spec.md`
Verdict: Split — ticket 04 carries two independent sign-in paths (OAuth and plain tokens), so the first usable Integration waits for the whole OAuth flow, and the `Blocked by:` lines of 05, 07 and 08 miss the tickets whose results they use.

## Objections

### 1. Tickets 05, 07 and 08 use results of tickets their `Blocked by:` lines do not name

Fact: `.scratch/worfy-integrations/spec.md:285-287` gives the proxy (ticket 05) "refresh под замком … 401 → refresh и один повтор", while `:446-448` puts "refresh под замком" in ticket 04 and `:451` gives 05 "Blocked by: 01, 03", same Wave as 04 (`:472`); ticket 07 shows "Test, фильтр с числом и размером" (`:455-456`), which is `initialize` and `tools/list` against the service (`:119-120`), the proxy client of 05, yet 07 is "Blocked by: 02, 03, 04" (`:457`); ticket 06 adds "строки Codex в chip-е" (`:452`) and ticket 08 "строки Integration в chip-е" (`:458`), both in `src/shared/agent/mcp-status.ts`, and 08 is "Blocked by: 05, 07" without 06.

Judgement: The Wave table hides this today, but the spec itself says the Wave is recomputed from `Blocked by:` at launch (`:478`), so 05 can start beside 04 and invent its own refresh, and 07 can run without a working tools count. Either 05 is blocked by 04 (or refresh moves into 05), 07 is blocked by 05, and 08 by 06 — or the chip rows go into one ticket.

Owner decision:

### 2. Ticket 04 rebuilds OAuth client code that the MCP SDK already in the lockfile provides

Fact: `pnpm-lock.yaml:3929-3932` resolves `@modelcontextprotocol/sdk` 1.32.0 as the peer of `@anthropic-ai/claude-agent-sdk` 0.3.322; its `dist/esm/client/auth.d.ts` exports `OAuthClientProvider` (line 15, with `clientMetadataUrl` for a Client ID Metadata Document at line 25), `discoverOAuthProtectedResourceMetadata` (268), `startAuthorization` with `resource` (361), `refreshAuthorization` (418) and `registerClient` (466), and `client/streamableHttp.d.ts:62-73` says a transport given an `authProvider` refreshes an expired token itself and throws `UnauthorizedError` when it cannot; the spec names the MCP SDK only for the server and the transport (`spec.md:281-282`) and plans discovery, DCR, PKCE, `resource` and refresh in its own `src/main/integrations/auth/` (`:299-305`, `:446`); `package.json` lists neither the MCP SDK nor any OAuth library as a direct dependency.

Judgement: Ticket 04 can shrink to an `OAuthClientProvider` over `SecretStore` plus the sign-in window and its redirect, with the protocol steps already tested upstream. Refresh then lives in the transport of ticket 05, which also settles part of objection 1. Client ID Metadata Document support costs one field instead of a second path (the "DCR deprecated" risk, `:352-353`). The ticket must add `@modelcontextprotocol/sdk` as a direct dependency pinned to the version the Agent SDK uses.

Owner decision:

### 3. The first usable Integration waits for the OAuth flow, though tokens alone cover the owner's case

Fact: Ticket 04 (`spec.md:446-448`) holds both the OAuth flow (discovery, DCR, PKCE, window with partition, loopback, refresh, revocation, Slack app template) and the token paths (Bearer, Basic, own header, stdio secrets, `gh` token), and ticket 07 is blocked by all of 04 (`:457`); the spec's own facts say an Atlassian API token "не привязан к site" (`:216-217`), and Linear, GitHub and Notion take Bearer tokens (`:239-241`); Q5 (в) "Без OAuth в этом Epic-е: только token-ы" (`:399`) is already an option.

Judgement: The two paths share only the secret store; the token path is small and needs no window, no DCR and no live service in tests. Cut 04 into 04a (tokens and stdio secrets) and 04b (OAuth). Then 07 can depend on 04a, and two Jira accounts in two Projects work after 03, 04a, 05 and 07. OAuth Sign in arrives as its own ticket later, not as a gate before anything works. Caveat: the Atlassian token needs the client organization's admin to enable it (`:217`), so OAuth stays in the Epic.

Owner decision:

## Alternative

Wave 1: 01, 02, 03. Wave 2: 04a (token sign-in over `SecretStore`) and 05 (proxy on the MCP SDK client transport, Claude Session), 05 blocked by 03 and 04a. Wave 3: 07 (screen, Sign in by token only), blocked by 02, 04a, 05; 04b (OAuth as an `OAuthClientProvider` plugged into the transport of 05, window, loopback, Slack), blocked by 01, 05. Wave 4: 06 (Codex), then 08 blocked by 04b, 06, 07. Then 09 and 10 as written. The plan as written is still better only if the owner rejects Q5 (в) for the first slice and wants Sign in on the first screen he sees.

## What the critic cannot know

Whether the MCP SDK client's auth works with Atlassian, Linear, Notion and Sentry as they answer today, and whether its refresh behaves under parallel calls the way the spec wants (one refresh at a time). Spike 01 can check both. How often the owner would use an API token rather than Sign in is unknown: there is no product analytics. Whether client organizations' admins allow Atlassian API tokens is not known. The issues cited as unverified in the spec's "Факты" were not re-read.
