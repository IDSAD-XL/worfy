# 142 — Аудит повторного review: гонки test-ов и docs

Type: bug
Status: claimed 2026-11-25T08:05Z
Blocked by: none
Source: audit-pr-rereview-2026-11-13, triage.md «Чинить сейчас»; checked open on main 3c9c06e8c 2026-11-25

Кто: агент. Глубина review — `low`. Не платформенный PR.

Семь finding-ов повторного review смёрженных PR (`.scratch/audit-pr-rereview-2026-11-13/spec.md`, номера 39, 49, 116,
119, 120, 127, 192): два flaky test-а с гонкой, одна подсказка в UI и пять мест в `docs/features/`, где страница
расходится с кодом. Каждое проверено на main 3c9c06e8c: все семь на месте, ни одно не исправлено.

## Что происходит

- **49.** `test/contract/autopilot-retry.test.ts:626-628` ждёт строку `waiting-until` в journal и сразу читает
  `h.state()`. В `src/main/autopilot/run.ts:3486-3492` (`waitForLimits`) строка пишется первой, а `wait.wait(...)`,
  от которого зависят `status: 'waiting'` и `waitingFor: 'limits'` (`snapshot`, `run.ts:4275-4280`), идёт после
  `await` записи. Test может прочитать state между ними. То же в `test/contract/codex-orchestrator.test.ts:868-869`:
  ждёт вторую строку `waiting-until` и читает `resumesAt` второго ожидания.
- **116.** `harness/bin/tests/wave-gate-heartbeat.test.sh:227` (и тот же порядок на `:184`): счётчик пауз heartbeat-а
  `n` читается до того, как test перезаписывает `holder.json` чужим владельцем. Если shell test-а задержится между
  ними дольше одной паузы heartbeat-а, heartbeat уже начал паузу после `n`, проснулся и прочитал старый (свой)
  `holder.json`: `step_done "$n"` проходит, а его `touch` лока приходит после `touch -t` test-а — mtime меняется, test
  красный.
- **39.** Подсказка группы «Not allowed in this Project» (`src/renderer/session/McpChip.tsx:100`) и
  `docs/features/mcp-servers.md:139-140` предлагают вписать имя connector-а claude.ai в список MCP servers Project-а.
  Claude Code берёт в `allowedMcpServers` имя только из букв, цифр, `_` и `-`
  (`src/main/vendors/claude/mcp-addresses.ts:5-8,28`), у connector-а имя `claude.ai <name>`, а connector без адреса из
  инвентаря worfy в список не кладёт (`allowedMcpEntries`, `mcp-addresses.ts:107-118`). Вписанное имя ничего не даёт.
- **119.** `docs/features/gate-and-github.md:186-190` (таблица «Gate full before the merge») не говорит, что `land`
  держит PR с кодом, пока main красный (`harness/bin/land:31-45`, `mainGreen`, `mainAllows`). Абзац про marker
  `main-red-<key>.json` (`:129-134`) есть, но в нём «no screen or Autopilot step acts on it yet», хотя Autopilot его
  читает (`src/main/ipc/autopilot.ts:248`, `docs/features/autopilot-faults.md:266-269`).
- **120.** `docs/features/gate-and-github.md:372,404-405` и `docs/features/evidence.md:184` говорят о host name как о
  секрете целиком. `harness/lib/privacy.cjs` (`distinctiveHost`, `hostNeedles`, `:138-164`) ищет полное имя, если в
  нём больше одной метки, и первую метку, только если она не общее слово (`mac`, `dev`, `server`…), не цифры и не
  короче трёх символов.
- **127.** `docs/features/vendors.md:55-56`: «under Codex the Harness's Stop hook runs the gate». На Stop в main checkout
  (не в linked worktree) gate не запускается (`harness/hooks/stop.mjs:27-31,189`).
- **192.** `docs/features/projects.md:639`: «The same renderer draws Claude's answers in the Session view and on the
  Canvas». Session Node рисует последний ответ в `<pre>` (`src/renderer/canvas/nodes/SessionNode.tsx:517-519`), без
  markdown и ссылок; markdown renderer — только в Session view (`src/renderer/session/Transcript.tsx:516,544`).

## Что делаем

1. 49: оба test-а ждут нужный state (`status`, `waitingFor`, `resumesAt`), а не строку journal; journal проверяют
   после. Timeout-ы не меняются. Гонку показать принудительным порядком: пауза между записью journal и `wait.wait` в
   `run.ts` (временная, не в commit-е) — старый test красный, новый зелёный.
2. 116: `n` читается после записи `holder.json` (оба места). Гонку показать паузой между чтением `n` и записью
   `holder.json` в старом порядке (временная копия test-а).
3. 39: подсказка и `docs/features/mcp-servers.md` говорят то, что работает: имя connector-а не разрешить; подключить
   его на claude.ai и открыть список снова — инвентарь запускается при каждом открытии popover-а
   (`src/main/vendors/claude/session.ts:376-383`), найденный connector встаёт в группу с Allow. Unit test
   `test/unit/mcp-chip.test.tsx` проверяет, что подсказка не отправляет вписывать имя.
4. 119: абзац о паузе `land` при красном main и её снятии рядом с таблицей merge; поправить «no … Autopilot step acts
   on it yet».
5. 120: обе страницы — общее слово в host name не секрет, по правилу `privacy.cjs`.
6. 127: оговорка про main checkout в `docs/features/vendors.md`.
7. 192: `docs/features/projects.md` — Session Node показывает ответ простым моноширинным текстом.
8. Каждая английская страница и её перевод в `docs/features/ru/` — с одним смыслом (бриф Orchestrator-а: правка docs
   без поведения, перевод правится вместе).

## Готово, когда

- [ ] 49: `test/contract/autopilot-retry.test.ts` и `test/contract/codex-orchestrator.test.ts` ждут state, а не строку
      journal; с принудительной паузой между записью `waiting-until` и `wait.wait` старый test красный, новый
      зелёный; каждый файл ×10 подряд — зелёный.
- [ ] 116: `harness/bin/tests/wave-gate-heartbeat.test.sh` читает счётчик после записи `holder.json`; с паузой между
      ними старый порядок красный, новый зелёный; ×10 подряд — зелёный.
- [ ] 39: подсказка `CONNECTOR_HINT` и `docs/features/mcp-servers.md` (с `ru/`) не обещают разрешить connector по
      имени и говорят, что работает; unit test `test/unit/mcp-chip.test.tsx` зелёный.
- [ ] 119: `docs/features/gate-and-github.md` (с `ru/`) описывает паузу `land` при красном main и её снятие.
- [ ] 120: `docs/features/gate-and-github.md` и `docs/features/evidence.md` (с `ru/`) говорят, что общее слово в host
      name не считается секретом.
- [ ] 127: `docs/features/vendors.md` (с `ru/`) говорит, что Stop hook в main checkout gate не запускает.
- [ ] 192: `docs/features/projects.md` (с `ru/`) говорит, что Session Node на Canvas показывает ответ в `<pre>`, без
      markdown.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `test/contract/autopilot-retry.test.ts:614-640`
- `test/contract/codex-orchestrator.test.ts:863-875`
- `harness/bin/tests/wave-gate-heartbeat.test.sh:184,227`
- `src/renderer/session/McpChip.tsx:96-100`
- `test/unit/mcp-chip.test.tsx:125-135`
- `docs/features/mcp-servers.md:139-140`, `docs/features/ru/mcp-servers.md:112-114`
- `docs/features/gate-and-github.md:129-134,186-193,372,404-405` и `docs/features/ru/gate-and-github.md` (те же абзацы)
- `docs/features/evidence.md:184`, `docs/features/ru/evidence.md` (та же строка таблицы)
- `docs/features/vendors.md:55-56`, `docs/features/ru/vendors.md` (тот же абзац)
- `docs/features/projects.md:639`, `docs/features/ru/projects.md:610-611`
- Только читать: `src/main/autopilot/run.ts`, `harness/lib/privacy.cjs`, `harness/bin/land`, `harness/hooks/stop.mjs`,
  `src/main/vendors/claude/mcp-addresses.ts`, `src/main/vendors/claude/session.ts`,
  `src/renderer/canvas/nodes/SessionNode.tsx`

## Вне скоупа

- Остальные finding-и triage «Чинить сейчас», в том числе 38 и 118 (русские страницы MCP и skills).
- Отрисовка markdown на Session Node: finding 192 решён правкой страницы, как советует triage.
