# 26 — Limits по Vendor-ам в панели

Type: task
Status: done 2026-11-03T02:50Z
PR: #1266
Blocked by: 21
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 8; решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md)); [CONTEXT.md](../../../CONTEXT.md), термин Limits

## Что происходит

- Панель Limits — `src/renderer/shell/toolbar/LimitsMeter.tsx`, полоса — `src/renderer/limits/LimitBar.tsx`,
  состояние — `src/renderer/limits/useLimits.ts`; строки — `limitBars` (`src/shared/agent/limits.ts:264`).
- После Ticket-ов 11 и 21 состояние — список окон с Vendor-ом, Codex присылает свои окна.

## Что делаем

1. Раздел на каждого Vendor-а, в которого выполнен вход: имя Vendor-а и его окна в порядке длительности; подписи —
   `label` окна.
2. Нет входа в Vendor-а — нет его раздела. Нет окон (план Codex без лимитов) — строка «No limits reported».
3. Пороги цвета — те же, что сейчас (`WORKING_FROM`, `BLOCKED_FROM`), `reached` — красный.
4. `LimitsTracker` хранит и отдаёт окна обоих Vendor-ов (`src/main/agent/limits.ts:58`).
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/26/`.

## Готово, когда

- [x] Unit test: два Vendor-а — два раздела; Codex Pro — одно окно `weekly`; без входа в Codex — только Claude.
- [x] e2e (фейки): в панели раздел Codex с окнами сценария — из фонового опроса Codex, не после хода Codex (Session Codex
  в приложении не запускается до Ticket-ов 23/24; см. «Итог», решение 2). Событие `limits` хода Codex — contract test
  на фейке.
- [x] Снимки обеих тем в `evidence/26/`.
- [x] `pnpm typecheck`, `pnpm lint`, unit test-ы Limits и e2e spec — exit 0.

## Где в коде

- `src/renderer/shell/toolbar/LimitsMeter.tsx` — `:14-30`
- `src/renderer/limits/LimitBar.tsx`, `src/renderer/limits/useLimits.ts`
- `src/main/agent/limits.ts` — `:58`
- `test/unit/limits-meter.test.tsx`, `test/e2e/limits-vendors.spec.ts` (новый), `scripts/e2e-specs.table.json`
- Дополнено разведкой оркестратора: `src/shared/ipc/limits.ts`, `src/main/ipc/limits.ts`, `src/shared/agent/limits.ts`,
  `src/main/agent/limits-usage.ts`, `src/main/vendors/codex/session.ts` (только `receive()`)

## Итог

- Решения, принятые без владельца (оркестратор, Wave 7; решено без владельца, подтвердить):
  1. Ticket 26 подключает `codexLimitsEvent` и `codexLimitReachedEvent` к Session Codex (`receive()` в
     `src/main/vendors/codex/session.ts`) и пишет окна Session-ов Codex в `LimitsTracker`; на ревью Ticket-а 21 это
     оставили тому из 26 / 38, кто придёт первым.
  2. e2e: Session Codex в приложении не запускается до Ticket-ов 23/24, а `installLimitsRefresh` под `WORFY_AGENT=fake`
     выходил сразу, так что опрос Codex в e2e не работал. Теперь под `WORFY_AGENT=fake` опрос Codex идёт, если и Codex —
     фейк (`WORFY_CODEX=fake`); Claude Code по-прежнему не спрашивают. Пункт «после хода Codex» переформулирован: раздел
     Codex появляется из опроса.
  3. `windowsOf` / `subscribeWindows` различают «вошёл, окон нет» (`[]`) и «вышел» (`null`): панель отличает
     «No limits reported» от «нет раздела».
- Решения implementer-а (решено без владельца, подтвердить):
  - Сценарий фейка для e2e — `account-plus`, а не `limits-two-windows` из брифа: опрос сначала спрашивает
    `account/read`, а в `limits-two-windows` этого шага нет — фейк ответил бы ошибкой, раздела не было бы. Окна у
    `account-plus` те же (5h 12 %, weekly 40 %). Сценарии не менялись.
  - Раздел Claude показан всегда, когда есть хоть один раздел: вход в Claude `LimitsTracker` не отслеживает. Ничего не
    известно ни о Claude, ни о других Vendor-ах — как раньше, «Limits no data yet». Claude без данных рядом с Codex —
    «no data yet» в своём разделе. Имя раздела — `VENDOR_LABELS` («Claude Code», «Codex»).
  - Компактная панель при двух и более разделах: два раздела обычной ширины выталкивали поле поиска за окно 1280 px на
    144 px (замер e2e). Поэтому без заголовка «Limits» (он остаётся именем группы), отступы 8 вместо 12, полосы 80 px
    вместо 104, строка сброса — только время (`Sat 00:40`), полная строка `resets …` — tooltip.
  - Имя Vendor-а у раздела с полосами не видно — это tooltip раздела и его доступное имя (`Codex limits`); между
    разделами — тонкая линия. Видно имя только у раздела без полос: `Codex No limits reported`, `Claude Code no data yet`.
    Пункт 1 «Что делаем» («имя Vendor-а и его окна») так выполнен через tooltip, а не через подпись. Причина — ревью
    раунда 1: видимые имена («Claude Code», «Codex») занимали ширину заголовка Project-а, и в окне 1280 px с двумя
    разделами заголовок сжимался до ~6 px («w…»), строка ветки — до обрывка. Без имён заголовок `worfy — auction` и
    строка `auction · main` целые (ширина заголовка 102 px, запас до переключателя View ~12 px, замер e2e). В макете F
    имён тоже нет, поэтому и один раздел Claude — как в макете: «Limits» и две полосы, без «Claude Code». Короткая
    видимая метка Vendor-а не влезает: каждая подпись — ещё ~35 px на раздел. Значок Vendor-а (`VendorBadge`, Ticket 24)
    может стать такой меткой позже.
  - Codex-окно длиннее суток показывает день недели сброса, как 7-day у Claude; окно неизвестной длины — последним.
- Сделано:
  - `src/shared/agent/limits.ts` — `limitsViewSchema` / `LimitsView` (`claude` + `vendors`), `vendorLimitBars` (окна по
    длительности, подпись — `label` окна, пороги `WORKING_FROM` / `BLOCKED_FROM`, `reached` — красный),
    `limitSections`, `NO_LIMITS_REPORTED`; общие части полосы (`valueOf`, `resetsLine`, `asOfLine`) вынесены из
    `limitBars` без изменения поведения.
  - `src/main/agent/limits.ts` — `windowsOf` → `null` для вышедшего, слушатель получает `null`, новый `view()`.
  - `src/shared/ipc/limits.ts`, `src/main/ipc/limits.ts` — `limits.open` / `limits.changed` несут `LimitsView`;
    окно подписано и на состояние Claude, и на окна Vendor-ов.
  - `src/renderer/...` — `LimitsMeter.tsx` рисует разделы, `LimitBar.tsx` — `testId` и `compact`, `useLimits.ts` —
    `LimitsView`; `AutopilotAction.tsx` берёт `useLimits().claude` (прогноз Run-а — по Claude, Codex добавит Ticket 38).
  - `src/main/vendors/codex/session.ts` — `account/rateLimits/updated` → событие `limits` (раньше — `unknown`) и запись
    окон через `CodexServerOptions.limits` (в приложении — `appLimits().setWindows('codex', …)`); `error` с
    `usageLimitExceeded` этого thread-а → повторное чтение окон на app-server-е Session и `limit_reached` до `result`;
    сообщения после отказа ждут решения, порядок сохраняется. `codex/limits.ts`: `ask` — `Pick<CodexAsk, 'request'>`.
  - `src/main/agent/limits-usage.ts` — `read` у `LimitsRefresher` необязателен; e2e-режим описан выше;
    `refreshAppUsage` в e2e по-прежнему сразу резолвится.
  - `docs/features/transcripts-and-usage.md` — раздел Limits.
- Test-ы: `test/unit/limits-meter.test.tsx` (два Vendor-а — два раздела; Codex Pro — одно окно `weekly`; без входа в
  Codex — только Claude; «No limits reported»; пороги и `reached`; порядок по длительности),
  `test/contract/codex-session-limits.test.ts` (новый: `usage-limit-window`, `usage-limit-quota`, `turn`),
  `test/contract/limits.test.ts` (`null` / `[]`, `view()`, `limits.changed` на окна Vendor-а), `test/unit/limits-usage.test.ts`
  (опрос Codex под фейками), `test/e2e/limits-vendors.spec.ts` (новый: раздел Codex из опроса, порядок, всё в toolbar
  1280 px с открытым Project-ом, ни один текст полосы не обрезан, заголовок Project-а и строка ветки целые); поправлены под новую форму канала `test/contract/link-access.test.ts`,
  `test/unit/canvas-actions.test.tsx`. Правило в `scripts/e2e-specs.table.json` не добавлено: `src/main/agent/limits.ts`
  и соседи видны многим spec-ам, при сомнении — путь вне таблицы.
- Снимки: [светлая тема](../evidence/26/26-limits-vendors-light.png), [тёмная тема](../evidence/26/26-limits-vendors-dark.png).
