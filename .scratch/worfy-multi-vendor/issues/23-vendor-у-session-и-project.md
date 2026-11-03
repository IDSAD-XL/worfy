# 23 — Vendor у Session и у Project

Type: task
Status: claimed 2026-11-03T01:03Z
Blocked by: 14, 17, 18, 20, 21
Source: [spec.md](../spec.md), «Модель» (Vendor), «Решено без владельца», п. 5, 7, 8; Ticket 01 ([01-destination-vendor-масштаб.md](01-destination-vendor-масштаб.md), п. 3); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md))

## Что происходит

- Данные Node Session — `worfySessionNodeDataSchema` (`src/shared/ipc/sessions.ts:22`), вид — `sessionNodeViewSchema`
  (`:61`), «New session» — `sessions.new` (`:81`).
- Session-ы Node-ов ведёт `src/main/agent/node-sessions.ts`; реестр — `src/main/agent/app-registry.ts`.
- Настройки Project-а — `projectSettingsSchema` (`src/shared/projects/action-templates.ts:139`).

## Что делаем

1. `vendor` в данных Node Session и в её виде; нет поля — `claude`.
2. `defaultVendor` в настройках Project-а; нет поля — `claude`; сборка, которая не знает значения, читает его как
   «не выбрано» (как `terminalShell`, `:155-158`).
3. `sessions.new` принимает `vendor?`; без него — `defaultVendor` Project-а. Resume и Start берут Vendor Node-а.
4. Реестр Session-ов берёт driver по Vendor-у Session (`vendorDriver(id)`). Orchestrator — всегда `claude` в первом
   выпуске.
5. Vendor, которого нет в этой сборке или у которого нет входа, — отказ `sessions.new` с причиной, а не падение.
6. Черновик профиля Project (`src/main/projects/connect.ts`) переходит на нейтральный `vendorDriver(<vendor>).oneShot`.
   Сейчас он зовёт части driver-а Claude напрямую: `claudeOneShotQuery` (через `src/main/ipc/projects.ts`) и
   `readOneShot` (`src/main/vendors/claude/one-shot.ts`); так решено в Ticket-е 15. Решено Orchestrator-ом
   2026-11-02, подтвердить при приёмке.

## Готово, когда

- [ ] Contract test: Node без `vendor` стартует Claude; `sessions.new {vendor: 'codex'}` на фейках стартует Codex и
      сохраняет `vendor`; Resume Node Codex идёт в driver Codex.
- [ ] Contract test: `defaultVendor` Project-а действует, когда `vendor` не передан; незнакомое значение не ломает
      файл настроек.
- [ ] `pnpm typecheck`, `pnpm lint`, unit и contract test-ы Session-ов и настроек Project-а — exit 0.

## Где в коде

- `src/shared/ipc/sessions.ts` — `:22`, `:61`, `:81-94`
- `src/main/ipc/sessions.ts`
- `src/main/agent/node-sessions.ts`, `src/main/agent/app-node-sessions.ts`
- `src/main/agent/app-registry.ts`
- `src/shared/projects/action-templates.ts` — `:139-160`
- `test/contract/sessions-vendor.test.ts` (новый)

## Итог

- `src/shared/ipc/sessions.ts` — в данных Node Session поле `vendor` (строка; нет поля — Claude Code; значение более
  поздней сборки хранится как есть), в виде Node-а — `vendor: VendorId` (нет поля — `claude`). `sessions.new` принимает
  `vendor?` — любую короткую строку, чтобы незнакомый Vendor был отказом с причиной, а не ошибкой схемы.
- `src/shared/projects/action-templates.ts` — `defaultVendor` в настройках Project-а; при чтении незнакомое значение —
  «не выбрано» (`.catch(undefined)`, как `terminalShell`), остальной файл не трогается.
- `src/main/projects/settings.ts` — запись без `defaultVendor` сохраняет сохранённый: диалог настроек его пока не
  показывает (Ticket 24) и иначе стирал бы его при Save. Файла нет в «Где в коде»: без этого Save диалога терял бы
  данные.
- `src/main/agent/session/registry.ts` — `SessionRegistry` берёт session part по Vendor-у Session (`VendorSessions`,
  `sessionsOf(vendor)`); `start(…, vendor = 'claude')`. Один SessionPart или QueryFactory (так строят test-ы) — только
  Claude Code, другой Vendor — отказ. Снята пометка `shortcut:`, которая ждала этот Ticket. Файла нет в «Где в коде»:
  выбор driver-а по Vendor-у живёт в реестре.
- `src/main/agent/app-registry.ts` — реестр приложения: `vendorDriver(vendor).session`, driver создаётся при первом
  старте Session своего Vendor-а. Orchestrator стартует без Vendor-а — Claude Code (spec, решение 5).
- `src/main/agent/node-sessions.ts` — `open(projectId, vendor?)` для «New session»: Vendor из вызова, иначе
  `defaultVendor` Project-а, иначе Claude Code; незнакомый Vendor и Vendor без входа — отказ с причиной до того, как
  появится Node. `create(…, vendor)` пишет `vendor` в данные Node-а. Start и Resume берут Vendor Node-а; Node с
  незнакомым Vendor-ом — отказ «The Session of <node> cannot start: …», данные Node-а не меняются.
  `signInRefusal` — проверка входа через `account.check()` driver-а.
- `src/main/agent/app-node-sessions.ts` — `defaultVendor` из `settings.json` Project-а; правило Resume узнаёт о Session-ах
  Claude Code из Claude home, о thread-ах Codex — из `history.list` driver-а Codex.
- `src/main/ipc/sessions.ts` — `sessions.new` зовёт `open(projectId, vendor)`.
- Черновик профиля (п. 6): `src/main/projects/connect.ts` зовёт нейтральный `OneShot` (`ConnectDeps.oneShot`) с
  `readOnlyTools: DRAFT_TOOLS` и `outputSchema`; Stop — `AbortSignal`. `src/main/ipc/projects.ts` —
  `draftOneShotFromEnv`: `vendorDriver(DRAFT_VENDOR).oneShot`, `DRAFT_VENDOR = 'claude'` (spec, решение 6); под
  `WORFY_AGENT=fake` — `claudeOneShotOver` поверх фейкового агента. `src/main/vendors/claude/one-shot.ts` —
  `claudeOneShotOver(start)`; `claudeOneShot` — он же поверх `claudeOneShotQuery`; Stop во время запуска Claude Code
  теперь тоже закрывает запрос. `draftCanUseTool`, `DRAFT_DISALLOWED_TOOLS`, `DraftRequest` и реэкспорт `activityOf`
  из `connect.ts` убраны: инструменты черновика задаёт oneShot part.
- Test-ы: `test/contract/sessions-vendor.test.ts` (новый) — Node без `vendor` стартует Claude; `open(…, 'codex')` на
  фейке app-server стартует Codex и сохраняет `vendor` и thread; Start Node-а Codex с thread-ом идёт в
  `thread/resume` driver-а Codex; `defaultVendor` Project-а действует без `vendor`; незнакомый `defaultVendor` не
  ломает файл; Save без `defaultVendor` его сохраняет; незнакомый Vendor и Vendor без входа — отказ без Node-а.
  Правки ожидаемых значений: `node-sessions.test.ts`, `projects-connect.test.ts`, `projects.test.ts`,
  `claude-one-shot.test.ts`, `test/e2e/new-session.spec.ts` (в данных Node-а теперь `vendor: 'claude'`), фикстуры вида
  Node-а в unit test-ах renderer-а (`vendor: 'claude'`).
- Документы: `docs/features/sessions.md` (абзац «Vendor», список test-ов), `docs/features/projects.md` (`defaultVendor`,
  черновик через oneShot).

Решено без владельца, подтвердить:

- Проверка входа при «New session» не спрашивает Claude Code: его вход уже требует first-run (spec, решение 6), а
  лишний запуск процесса Claude на каждый первый «New session» стоил бы секунды. Проверка, которая упала или не
  ответила за 15 с, не отказывает: Session покажет ошибку самого Vendor-а, как до этого Ticket-а. Найденный вход
  запоминается до конца работы приложения, отказ — нет (пользователь может войти и повторить).
- `vendor` пишется в данные каждого нового Node-а, и `claude` тоже: Node не меняет Vendor, если потом сменится
  `defaultVendor` Project-а.
- Resume Node-а Codex узнаёт cwd thread-а из `history.list` driver-а Codex — его подключает Ticket 22 той же Wave. До
  его merge Resume и Start Node-а Codex с сохранённым thread-ом — отказ с причиной «history of the codex driver is not
  wired yet».
- «Ship ticket» (`src/main/actions/launch.ts`, `create` без Vendor-а) тоже берёт `defaultVendor` Project-а. Skill-ы
  Harness на Codex — Ticket-ы 35–39; до них Project с `defaultVendor: codex` отправит «Ship ticket» в Codex.
- Текст отказа черновика стал «The draft Session failed: <причина oneShot>» вместо своих текстов черновика («Claude
  Code ended before the draft was ready», «The draft Session gave no draft (…)»): причину теперь даёт driver.
