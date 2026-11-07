# 01 — Вид Session `product`: данные Node-а и `sessions.new`

Type: task
Status: done 2026-11-07T23:44Z
PR: #1603
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1; «Как работает» → «Вид Session»; «Решено без владельца», п. 1; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), разделы 1.4, 1.5

Не платформенный Ticket: данные и IPC, без путей ОС и процессов. Глубина ревью — `medium`.

## Что происходит

- Вида Session нет. У Session Node-а в данных только `origin`, `vendor`, `sessionId`
  (`worfySessionNodeDataSchema`, `src/shared/ipc/sessions.ts:24-33`); вид на экране — `sessionNodeViewSchema`
  (`:69`).
- Вход «New session» — канал `sessions.new` с `{ projectId, vendor? }` (`src/shared/ipc/sessions.ts:96`), handler —
  `sessions().open(projectId, vendor)` (`src/main/ipc/sessions.ts:13`). `NodeSessions.open` (`src/main/agent/node-sessions.ts:166`)
  зовёт `create` (`:193`), который пишет данные Node-а `{ origin: 'worfy', vendor }` (`:201`) и запускает Session
  через `launch` (`:375`).
- Orchestrator отличается только флагом `SessionLaunch.orchestrator` (`src/main/agent/session-settings.ts:31-39`);
  другого признака вида у Session нет.

## Что делаем

1. Необязательное поле `kind: z.literal('product').optional()` в `worfySessionNodeDataSchema` и в
   `sessionNodeViewSchema`. Node без поля — обычная Session; Node с неизвестным значением (сборка новее) читается как
   неизвестный вид, и main его не запускает — как неизвестный Vendor (`sessions.ts:27-29`).
2. `sessions.new` принимает `kind?: 'product'`; handler передаёт его в `NodeSessions.open` → `create` → данные Node-а.
3. `SessionLaunch.kind?: 'product'` — вид доходит до `registry.start` и до Vendor-а (настройки Claude — Ticket 02).
   Возобновление Node-а с `kind: 'product'` (`resume`, `start`) сохраняет вид.
4. `sessions.new` с `kind: 'product'` и Vendor-ом не Claude Code — отказ: «Product Session runs on Claude Code only».
   Текст — английский (ADR-0074).
5. Renderer: вид Session в store (`src/renderer/session/node-sessions.ts`) несёт `kind`.

## Готово, когда

- [ ] Test: `sessions.new` с `kind: 'product'` создаёт Node с `data.kind === 'product'`; вид Session несёт `kind`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/node-sessions.test.ts test/contract/sessions-vendor.test.ts` exit 0; mutant without SessionLaunch.kind: exit 1, two kind tests red · mac - · 65d7b8ec7d0f6becdf9eb7371e6ce21e85e77d97
  - evidence: review pass · PR #1603 · - - · e331595673922c3a32f76dcf71f445914019591e
- [ ] Test: Node без `kind` создаётся и возобновляется как раньше; данные Node-а старой сборки читаются.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/node-sessions.test.ts` exit 0 (a Node without a kind is created and resumed as before) · mac - · 65d7b8ec7d0f6becdf9eb7371e6ce21e85e77d97
  - evidence: review pass · PR #1603 · - - · e331595673922c3a32f76dcf71f445914019591e
- [ ] Test: `kind: 'product'` + Vendor `codex` — отказ с текстом, Node не создан.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/sessions-vendor.test.ts` exit 0; mutant without the kind refusal in open: exit 1, the codex refusal test red · mac - · 65d7b8ec7d0f6becdf9eb7371e6ce21e85e77d97
  - evidence: review pass · PR #1603 · - - · e331595673922c3a32f76dcf71f445914019591e
- [ ] Test: Session Node-а с `kind: 'product'` после перезапуска возобновляется с тем же `kind` в `SessionLaunch`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/node-sessions.test.ts test/contract/sessions-vendor.test.ts` exit 0; mutant without SessionLaunch.kind: exit 1, two kind tests red · mac - · 65d7b8ec7d0f6becdf9eb7371e6ce21e85e77d97
  - evidence: review pass · PR #1603 · - - · e331595673922c3a32f76dcf71f445914019591e
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 65d7b8ec7d0f6becdf9eb7371e6ce21e85e77d97
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42419012036/job/128564889966 · ci - · e331595673922c3a32f76dcf71f445914019591e

## Тесты

- Contract `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts`.
- Сначала падающий: `sessions.new` с `kind` на `main` теряет поле (zod отбрасывает лишний ключ).

## Где в коде

- `src/shared/ipc/sessions.ts`
- `src/main/ipc/sessions.ts`
- `src/main/agent/node-sessions.ts`
- `src/main/agent/session-settings.ts`
- `src/renderer/session/node-sessions.ts`
- `test/contract/node-sessions.test.ts`
- `test/contract/sessions-vendor.test.ts`

Только читать: `src/main/agent/orchestrator.ts:713` (флаг Orchestrator-а), `src/main/vendors/claude/query.ts`
(Ticket 02), `src/renderer/canvas/nodes/SessionNode.tsx` (Ticket 06).

## Итог

- Вид Session — `SESSION_KINDS = ['product']`, `sessionKindSchema` (`src/shared/ipc/sessions.ts:26-27`). Вид Session на
  экране — `kind: sessionKindSchema.optional()` (`:96`), вход `sessions.new` — `kind` (`:123`), handler передаёт его в
  `NodeSessions.open` (`src/main/ipc/sessions.ts:13`).
- **Отступление от п. 1 «Что делаем».** В данных Node-а `kind` — `z.string().min(1).optional()` (`sessions.ts:52`), а не
  `z.literal('product')`. С `z.literal` Node сборки новее (`kind: 'mentor'`) не прошёл бы `readWorfySessionNodeData` в
  renderer целиком, и Node перестал бы читаться как Session Node worfy. Строка — как у `vendor`: значение сохраняется,
  main отказывает в старте («The Session of later cannot start: mentor is not a kind of Session this build of worfy
  runs»), это и требует второе предложение п. 1.
- `SessionLaunch.kind?: SessionKind` (`src/main/agent/session-settings.ts:45`). `NodeSessions.launch` отдаёт
  `registry.start` launch `{ unattended: false, kind }` для Session с видом и `undefined`, как раньше, без вида
  (`src/main/agent/node-sessions.ts:424`). Вид читается из данных Node-а на каждом старте: New session, Start, Resume,
  после перезапуска (`launchOf`, `:137`).
- Product Session — только Claude Code: без Vendor-а New session берёт Claude Code, а не `defaultVendor` Project-а;
  Vendor `codex` — отказ «Product Session runs on Claude Code only» до создания Node-а и до проверки входа
  (`kindRefusal`, `:121`, `:204`). Сохранённый Node `kind: 'product'` с Vendor-ом `codex` тоже не стартует.
- Renderer: store видов (`src/renderer/session/node-sessions.ts`) хранит `SessionNodeView` целиком, поле `kind`
  приходит в нём без новой логики; правка — комментарий.
- **Не сделано: вид не доходит до Vendor-а.** `SessionStart` (`src/main/vendors/session.ts:104`) поля вида не имеет, его
  собирает `Session.begin()` в `src/main/agent/session.ts`, а этот файл в брифе закрыт (параллельная работа audit-code 01
  и 02). Ticket 02 (настройки Claude) должен добавить `kind` в `SessionStart` и одну строку в `begin()`; трассы Ticket-а
  02 этих двух файлов сейчас не называют. Ещё: `Session.becomeAttended` (`session.ts:490`) пересобирает launch только
  с `orchestrator` и теряет `kind` — Product Session без человека не бывает, но Ticket 02 стоит это поправить там же.
- Test-ы: `test/contract/node-sessions.test.ts`, describe «the kind of a Session (worfy-product-session ticket 01)»
  (`:471`, `:487`, `:509`, `:525`) и channels (`:718`, отказ `kind: 'mentor'` на входе); `test/contract/sessions-vendor.test.ts`
  `:244`, `:253`, `:264`. Сначала красные: 10 test-ов на `main`. Мутанты (код восстановлен `git checkout`): без
  `kindRefusal` в `open` — красный test отказа `codex`; без `SessionLaunch.kind` — красные два test-а вида.
