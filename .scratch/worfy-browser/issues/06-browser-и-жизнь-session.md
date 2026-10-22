# 06 — Browser и жизнь Session: связь «открыт этой Session» в Family, уход вместе с Session

Type: task
Status: claimed 2026-10-22T08:00Z
Branch: worfy-browser/06
Blocked by: 04
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 11
(Browser Session-ы уходит с ней при автоархиве, Hide, Remove; pinned и Keep держат; Restore не
возвращает; Browser пользователя живёт до закрытия), пункт 13 (Family по связи «открыт этой Session»;
Browser пользователя — вне Family); [ADR-0076](../../../docs/adr/0076-auto-archive-of-finished-sessions.md)
(автоархив). Термин Family — `CONTEXT.md` (Browser-ы, которые открыли Session-ы, — в Family).
Код перечитан по main `dd6b0afb`.

## Что происходит

- Family строится чистой функцией `familyOf` (`src/renderer/canvas/family.ts:100`) из связей Node-ов
  React Flow, которые собирает `familyLinksOf` (`family.ts:151`) — `worfy-canvas` 03. Browser в ней
  нет.
- Автоархив — `archiveCandidates` (`src/main/layout/archive.ts:116`) и таймер `AutoArchiver`
  (`archive.ts:196`), одна партия — одна операция `archive` мимо ⌘Z (`worfy-canvas` 07). Поля Node-а
  `archived` и `keep` — `src/shared/layout/types.ts:81-83`, `pinned` — `:72`.
- Hide — операция `hide` (`types.ts:134`), Remove — `remove` (`types.ts:136`); main применяет их в
  `LayoutStore.apply` (`src/main/layout/store.ts:320`).
- После Ticket-а 04 у Browser, который открыла Session, в `data` есть `openedBy`.

## Что делаем

1. **Family.** `familyLinksOf` читает `openedBy` Browser Node-ов: Browser входит в Family своей
   Session, а через неё — в Family её Ticket-а и Epic frame-а. Наведение на Browser Session-ы
   подсвечивает её Family. Browser без `openedBy` (открыт пользователем) Family не имеет.
2. **Уход вместе с Session.** Когда Session Node уходит с Canvas — автоархив, Hide или Remove —
   main в той же операции убирает с Canvas Browser-ы с её `openedBy`; их процессы закрываются.
   Browser profile остаётся.
3. **pinned и Keep.** Session, которую автоархив не берёт, держит свои Browser-ы только от
   автоархива. Hide и Remove любой Session, pinned и Keep тоже, убирают её Browser-ы с Canvas по
   правилу 2 (ADR-0078, п. 11).
4. **Restore** Session из архива Browser-ы не возвращает (ADR-0078, п. 11).
5. **Browser пользователя** живёт, пока пользователь его не закроет; Session-ы его не уносят.

## Готово, когда

- [x] Unit `test/unit/family.test.ts`: Browser с `openedBy` — в Family Session, её Ticket-а и Epic
      frame-а; наведение на Browser даёт Family его Session; Browser без `openedBy` — `null`.
- [x] Contract `test/contract/browser-lifecycle.test.ts` (новый): Hide и Remove Session Node-а
      убирают её Browser-ы в той же операции; Hide и Remove pinned Session (и Session с Keep) тоже
      убирают её Browser-ы; Browser пользователя и Browser другой Session остаются; Restore Session
      Browser не возвращает.
- [x] Contract `test/contract/layout-archive.test.ts`: партия автоархива уносит Browser-ы своих
      Session-ов; Session с `pinned` или `keep` их держит.
- [x] e2e `test/e2e/browser-family.spec.ts`: Session открывает Browser через `worfy-browser`,
      наведение на Ticket подсвечивает и Browser; Hide Session — Browser ушёл, Browser пользователя
      на месте; два окна одного Project-а видят одно и то же (ADR-0053); read-only экран
      (ADR-0066) — подсветка работает.
- [x] Contract `test/contract/browser-lifecycle.test.ts`: Hide и Remove пользователя — шаг ⌘Z
      (что он возвращает — по ответу на вопрос 1), партия автоархива — мимо ⌘Z (ADR-0016).
- [x] Мутанты красные: Browser пользователя уходит с Session; Restore возвращает Browser; Keep не
      держит Browser.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «Hide Session убирает её Browser, Browser пользователя остаётся».
- Unit `test/unit/family.test.ts`; contract `test/contract/browser-lifecycle.test.ts` (новый),
  `test/contract/layout-archive.test.ts`; e2e `test/e2e/browser-family.spec.ts` (новый).

## Где в коде

- `src/renderer/canvas/family.ts` (`familyOf` `:100`, `familyLinksOf` `:151`)
- `src/main/layout/store.ts` (`apply` `:320`)
- `src/main/layout/archive.ts` (`archiveCandidates` `:116`, `AutoArchiver` `:196`)
- `test/unit/family.test.ts`
- `test/contract/browser-lifecycle.test.ts` (новый)
- `test/contract/layout-archive.test.ts`
- `test/e2e/browser-family.spec.ts` (новый)

Только чтение: `src/shared/layout/types.ts` (`pinned` `:72`, `archived` и `keep` `:81-83`, `hide` `:134`,
`remove` `:136`), `src/main/mcp/browser-server.ts` (`openedBy`).

## Вне скоупа

- Autopilot и Browser агента Wave в Family Ticket-а — Ticket 08.
- Сон Browser-ов — Ticket 05.

## Открытые вопросы

1. **⌘Z после Hide или Remove Session.** Hide и Remove пользователя — шаги ⌘Z (ADR-0016). Возвращает
   ли ⌘Z вместе с Session и её Browser-ы — ADR не говорит (п. 11 называет только Restore из архива).
   Решает владелец до claim.
2. **Hide Session, потом показать снова:** возвращается ли Browser — ADR не решает. Предложение: нет,
   как Restore.
3. **Browser, открытый Subagent-ом** Session: `openedBy` — Subagent или его Session. ADR говорит
   только про Session. Ответ нужен и Ticket-у 08.

## Итог

Ветка `worfy-browser/06`. Решения без владельца (вопросы 1–3 и то, что из них следует):

- ⌘Z Hide или Remove Session возвращает только Session, без её Browser-ов (как Restore, ADR-0078
  п. 11). Показать скрытую Session снова — Browser-ы тоже не возвращаются. Вопрос 3: `openedBy` —
  Session; вызовы Subagent-а идут через MCP server его Session с её id.
- Browser-ы Session удаляются из Layout (не архивируются и не скрываются) в той же операции `apply`,
  что убрала с Canvas последний показанный Node Session (Session Node или Orchestrator): Hide,
  Remove, партия автоархива. Пока на Canvas остаётся другой Node той же Session, Browser-ы стоят.
  Browser, который пользователь заблокировал (`locked`), остаётся.
- Session водит свои Browser-ы и Browser-ы пользователя, но не Browser другой Session (долг из
  worfy-polish 36); отказ — до того, как что-то взято или разбужено. Session, все Node-ы которой
  скрыты или в архиве, `browser_open` не открывает.
- Когда Session уходит с Canvas, её управление Browser-ами кончается, и перехват пользователя тоже:
  плашка «Claude is driving» и «Return control to Claude» исчезают (`LayoutChange.sessionsLeft`,
  `src/main/browser/live.ts`). По пути исправлено: окно не снимало плашку при отпускании управления
  (zustand сливал state, `src/renderer/browser/control.ts`).
- Подсветка Family для Browser — пунктирная рамка вокруг frame-а (`data-family="lit"`): линию к
  Session Node провести нельзя, у Session Node нет React Flow Handle-ов.

Тесты: `test/contract/browser-lifecycle.test.ts` (15), `test/unit/family.test.ts`,
`test/contract/layout-archive.test.ts`, `test/contract/browser-tools.test.ts`,
`test/unit/browser-frame-session.test.tsx`, e2e `test/e2e/browser-family.spec.ts` (2). Двенадцать
мутантов, три из списка тикета в том числе, — красные. `pnpm lint && pnpm typecheck && pnpm test` —
exit 0; gate fast — green; e2e Browser-ов, Family и автоархива — 39 passed.

Раунд 1 ревью: Session вне Canvas и не открывает, и не водит Browser — проверка до того, как что-то
взято или разбужено, и ещё раз после wake. Вызов, во время которого Session ушла с Canvas, больше
ничего не шлёт странице и отвечает «This Session left the Canvas»; пока он не кончился, страницы, куда
он ведёт, проверяются по origins профиля. Orchestrator Node — тоже Node Session (тест).

Ждёт владельца (сейчас — как выше, не менялось): вернуть ли Browser-ы на ⌘Z Hide/Remove Session; и
оставлять ли пользователю Browser с «Unsaved changes» или перехваченный пользователем, вместо того
чтобы убирать его с Session.

Осталось вне тикета: наведение на страницу внутри webview (не на заголовок frame-а) Family не
подсвечивает.
