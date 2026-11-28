# Critic: worfy-prompt-privacy — 2026-11-28

Plan: `docs/product/prompt-privacy/drafts/worfy-prompt-privacy.md`
Verdict: Reorder — Ticket 3 (masking in `Session.send`) needs the results of Tickets 4 and 5, which share its wave, and it switches masking on for every Project two waves before the human can see real values or send a value as is.

## Objections

### 1. Ticket 3 runs beside the two tickets it depends on, and masking goes live before the chat and the input field can handle it

Fact: The waves at `docs/product/prompt-privacy/drafts/worfy-prompt-privacy.md:274-275` put Tickets 2, 3, 4 and 5 "параллельно" in Wave 2 and Tickets 6 and 8 in Wave 3. Ticket 3's own test at line 233-235 says "После перезапуска таблица читается снова", which is the table store of Ticket 4 (line 262), and the level it masks at is the Project setting of Ticket 5 (line 264: "«Secrets» по умолчанию у всех Project-ов"). Real values in the chat are Ticket 8 (line 268), and "Send as is" is Ticket 6 (line 265-266).

Judgement: Ticket 3 cannot pass its own contract test or read a Project's level without 4 and 5, so its `Blocked by:` must name 4 and 5 and it moves to a wave after them. Worse, as soon as Ticket 3 lands on `main`, every Project masks at "Secrets" while the user's own chat shows `‹API_KEY_1›` and there is no way to send a value as is, because Tickets 6 and 8 have not landed. The Stable copy is updated from `main` between waves, so this half-done state reaches the owner. Either Ticket 3 ships with masking off (and Ticket 6 or 8 turns it on), or 3 lands in the same wave as 8.

Owner decision: accepted — «все да»

### 2. The draft says Link and Integrations already store secrets with `safeStorage`; both rejected it, and the reason still holds

Fact: The draft at `docs/product/prompt-privacy/drafts/worfy-prompt-privacy.md:200-201` says the table goes "через Electron `safeStorage` (Keychain на Mac, DPAPI на Windows). worfy уже хранит так секреты интеграций и Link". `src/main/link/secrets.ts:6-10` says the Link secrets are a 0600 JSON file, "Not Electron's safeStorage: on macOS it keeps its key in the Keychain under the app's code signature, and worfy's ad-hoc signature (electron-builder.yml) changes with every build, so the Keychain would ask for access after each update of the stable copy; tests and CI have no safeStorage at all". `docs/adr/0111-integrations-mcp-servers-worfy-runs.md:77-78` defers `safeStorage` "пока подпись worfy не станет постоянной", and `electron-builder.yml:97` is still `identity: '-' # ad-hoc signature`.

Judgement: The premise is false, and the condition the earlier decision set for a revisit (a permanent signature) is not met. A table read on each restart would bring a Keychain prompt after every Stable update, and the Seam 2 contract test ("после перезапуска таблица читается снова") cannot run in CI. The owner's answer Q5 ("Keychain на Mac", map ticket 06) was given on the same premise, so it should go back to the owner with this fact. The cheap option is the existing `FileSecretStore` behind `SecretStore` (0600 in a 0700 folder). The plan itself says local files are not a target (Q2, line 55-56). A `safeStorage` store can replace it later, as ADR-0111 already provides.

Owner decision: accepted — «все да»

### 3. Where real values travel is decided two ways in the draft, and Link uses the same IPC channels as the windows

Fact: `docs/product/prompt-privacy/drafts/worfy-prompt-privacy.md:191-192` says Session events carry masked text and "Настоящие значения подставляет только вид чата в renderer, из таблицы", but the Seam 2 test at line 234-235 says "Событие для чата показывает настоящие значения, а событие для narrator-а — нет". `src/main/link/ipc-adapter.ts:11-14` and `:21-24` say a Linked machine calls the same handlers the windows use, every `project` channel answers it, and broadcasts of `project` events reach it. Advisor decision 5 (line 96-97) says the phone shows placeholders.

Judgement: If chat events carry real values, or if the renderer reads the table through an ordinary `project` channel, the real values reach the Linked machine. That breaks advisor decision 5 without anyone noticing, because Link reuses the window channels. Tickets 3 and 8 need one design. The table lookup must go over a `desktop` or `local` channel, and a Link contract test must check that no real value crosses it. Without that, Ticket 8 is not sized and its test is not named.

Owner decision: accepted — «все да»

## Alternative

Wave 1: Ticket 1 (engine). Wave 2: Tickets 2, 4 (a 0600 `FileSecretStore` for the table, not `safeStorage`) and 5 (settings, with masking off by default until the last wave). Wave 3: Ticket 3, blocked by 1, 4 and 5, with events masked and the table lookup on a `local` channel, plus Ticket 8 in the same wave. Wave 4: Tickets 6 and 7, then 9, which turns "Secrets" on by default for all Projects. This is one wave longer than the draft. In return, `main` never has masking on without a way to see or release a value. The draft's order is shorter only if Ticket 3 ships with masking off.

## What the critic cannot know

There is no product analytics, so how many worfy users paste secrets or dumps into prompts is not known. The owner's own figures in the research notes come from the owner's prompts only. The critic did not check whether `Session.send` really is the only path from every input (Card, Autopilot, Orchestrator, Link, Codex steering) to the drivers. It also did not check whether the claims about the providers' data retention in "Проблема" match the providers' current terms. The second measurement, of tool output, is still running.
