# 05 — Комментарии к строкам в Changes: gutter, popover, лоток, список «To» и Send одним сообщением

Type: task
Status: open
Blocked by: 03, 04
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение» → «Как пользователь идёт по экрану», шаги 4–6 и 8;
«Решения по реализации — часть 1» → «Комментарии к строкам», пункты «Экран», Send, «Список «To»», «На экране только для
чтения»; «Linked machine и Silent mode»; «Вопросы владельцу», Q2

Кто: агент.

Не платформенный Ticket (renderer и чтение в main). Глубина ревью — `medium`; снимок экрана лотка в «Итог».

## Что происходит

- После Ticket-ов 03 и 04 Node Changes показывает diff, а модель Comments on quotes знает комментарий к коду
  (вариант `code`, `src/renderer/session/quote-comments.ts`), но поставить комментарий на строку нельзя.
- Send поля ввода Session — `composeRound` (`src/renderer/session/quote-comments.ts:308`) и `agent.send`
  (`src/shared/ipc/agent.ts:69-75`); сообщение во время хода ждёт в очереди (`docs/features/sessions.md:129-131`).
- Session Node, привязанный к Ticket-у, main уже умеет найти: `ticketSession` (`src/main/actions/launch.ts:409-430`) —
  worfy, Claude Code, не в Archive, Binding manual или launch, с порогом 24 часа. Session Orchestrator-а —
  `liveOrchestratorSession` (`src/main/ipc/getting-started.ts:92`).
- Экран только для чтения не предлагает комментариев (`docs/features/sessions.md:254`); палитра знает `readOnly`
  (`src/renderer/palette/commands.ts:130`).
- Kit: `src/renderer/theme/kit/Popover.tsx`, `ContextMenu.tsx`, `Menu.tsx` (ADR-0106).

## Что делаем

1. Gutter `DiffPane.tsx`: «+» на наведении, клавиша `c` на выбранной строке, выделение нескольких строк — диапазон;
   ContextMenu строки — Comment и Copy line.
2. `src/renderer/changes/LineComment.tsx` — popover kit: текст и до 3 картинок, как у Comments on quotes, ⌘↵ сохраняет;
   неотправленный комментарий под своей строкой с Edit и Delete.
3. `src/renderer/changes/Tray.tsx` — лоток внизу Node-а: «N comments on M files», chip-ы (щелчок — к строке), Clear,
   поле общего текста, «To», Send ⌘↵. Лоток показывает комментарии выбранной Session из её хранилища (`quoteKey`), то
   же видит её поле ввода.
4. Список «To»: канал `changes.targets` (`'project', 'read'`) в `src/shared/ipc/changes.ts` и `src/main/ipc/changes.ts`,
   отбор в `src/main/changes/targets.ts` — Session Node-ы с Binding-ом на Ticket, как `ticketSession`, но без порога 24
   часа, и Orchestrator Project-а. По умолчанию — Session с Binding-ом с самой новой записью, без неё — Orchestrator
   (Q2). Пока Orchestrator ведёт Run — предупреждение «Autopilot is running». Смена «To» переносит неотправленные
   комментарии к коду в лоток новой Session.
5. Send делает то же, что Send поля ввода этой Session (`composeRound`, `agent.send`), с очередью как сейчас.
   Отправленные комментарии остаются тусклыми на своих строках.
6. Блок комментария к коду в сообщении пользователя (`QuotedPrompt.tsx`, Ticket 04) открывает Changes Ticket-а на этой
   строке.
7. Refresh ищет неотправленные комментарии заново (`anchorLines` Ticket-а 04); строки нет — «Line changed», комментарий
   остаётся в лотке.
8. Экран Read only: нет «+», `c`, Comment в ContextMenu и лотка; diff читается.
9. Английская страница `docs/features/changes.md`: комментарии, лоток, «To», Send, Read only. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/changes-tray.test.tsx`): «+», `c` и диапазон открывают popover; лоток показывает
      комментарии выбранной Session; смена «To» переносит комментарии к коду; Read only — без «+» и лотка.
- [ ] Contract test (`test/contract/changes-targets.test.ts`): Session с Binding-ом на Ticket — в списке, Session другого
      Ticket-а — нет, Orchestrator — есть; значение по умолчанию по Q2.
- [ ] e2e test (`test/e2e/changes-comments.spec.ts`, fake agent): карточка → Changes → два комментария к строке и
      диапазону → Send: fake agent получил одно сообщение с разделом «Comments on lines of the diff (2)», путями,
      строками и кодом; блок в пузыре открывает Changes на строке.
- [ ] e2e test: неотправленный комментарий переживает перезапуск окна.
- [ ] Снимок экрана лотка с «To» — в «Итог» (в scratchpad, в репозиторий не кладётся).
- [ ] Английская страница `docs/features/changes.md` описывает комментарии; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/changes/DiffPane.tsx` (Ticket 03), `src/renderer/changes/LineComment.tsx`, `src/renderer/changes/Tray.tsx`
  (новые)
- `src/renderer/session/QuotedPrompt.tsx` (переход к строке)
- `src/shared/ipc/changes.ts`, `src/main/ipc/changes.ts` (Ticket 02), `src/main/changes/targets.ts` (новый)
- `test/unit/changes-tray.test.tsx`, `test/contract/changes-targets.test.ts`, `test/e2e/changes-comments.spec.ts` (новые)
- `docs/features/changes.md`

Только читать: `src/renderer/session/quote-comments.ts:308`, `src/renderer/session/quote-store.ts:39`,
`src/main/actions/launch.ts:409-430`, `src/main/ipc/getting-started.ts:92`, `src/shared/ipc/agent.ts:69-75`.

## Вне скоупа

- «New session in this worktree» и Session самого Node-а в «To», комментарии к PR и Add to comments — часть 2.
