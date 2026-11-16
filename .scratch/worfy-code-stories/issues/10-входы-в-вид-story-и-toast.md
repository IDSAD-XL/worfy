# 10 — Входы в вид Story: рамка Epic-а, карточка Ticket-а, Pull requests, toast, Command palette

Type: feature
Status: claimed 2026-11-16T13:28Z
Blocked by: 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 10; «Решения владельца» 2, 7, 20 (строки 92–93, 98–99, 121–122);
«Решения по реализации» → worfy: «Входы» (строки 253–255); «Решения по test-ам», Б (строки 282–284); истории 3, 4, 22,
25

Кто: агент.

## Что происходит

- На рамке Epic-а есть кнопка «History» (`src/renderer/canvas/actions/EpicSessionHistory.tsx`), на карточке Ticket-а —
  «Open PR» (`src/renderer/canvas/actions/OpenPr.tsx`, раскладка — `src/renderer/canvas/actions/action-button.ts`,
  `action-menu.ts`, `src/renderer/canvas/ticket-card.ts`).
- PR в Pull requests — `src/renderer/pr-inbox/PrInboxView.tsx` и `src/renderer/shell/sidebar/PullRequestsSection.tsx`.
- Образец toast-а с действием «Открыть» — toast остановки run-а: чистые функции в
  `src/renderer/flight-recorder/stop-toast.ts`, test — `test/unit/flight-recorder-stop-toast.test.ts`; очередь —
  `src/renderer/toast/toasts.ts`.
- Команды Command palette — `src/renderer/palette/commands.ts`.
- Вид Story (Ticket 09) открывается функцией `open`, story — из reader-а (Ticket 08).

## Что делаем

1. «Story» на рамке Epic-а рядом с «History» и в меню Epic-а: открывает story Epic-а. Пока её нет — Ticket 11 даёт
   сборку по кнопке; до него кнопка неактивна с подсказкой.
2. «Story» на карточке Ticket-а рядом с «Open PR»: открывает story PR этого Ticket-а.
3. «Code story» среди действий PR в Pull requests: открывает story PR, если она есть в tickets root. Для PR без story
   эту кнопку использует Ticket 11.
4. Toast «Story Epic-а готова» с действием «Открыть» — один раз на Epic, когда reader впервые видит `story.md` Epic-а.
   Факт «показан» хранится в данных worfy. Story PR уведомлений не даёт (решение 7).
5. Команда «Open code story» в Command palette для текущего Epic-а или Ticket-а.
6. С телефона story Epic-а в режиме Full — это файл на GitHub. Ничего строить не нужно; Ticket 15 это описывает.

## Готово, когда

- [ ] e2e (`test/e2e/code-story.spec.ts`, `WORFY_AGENT=fake`): вид Story открывается с рамки Epic-а, из меню Epic-а, с
      карточки Ticket-а, из Pull requests, из toast-а и из Command palette; Esc каждый раз возвращает на Canvas.
- [ ] Unit test toast-а (чистые функции, как `stop-toast.ts`): первое появление `story.md` даёт один toast; второе чтение
      того же Epic-а и перезапуск worfy — ни одного; новый `stories/*.md` — ни одного.
- [ ] Unit test кнопок: «Story» на карточке Ticket-а без story PR неактивна с подсказкой; на рамке Epic-а без
      `story.md` — неактивна до Ticket-а 11.
- [ ] `test/unit/palette-commands.test.tsx`: команда есть для Epic-а и Ticket-а со story и нет без неё.
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.

## Тесты

- e2e входов и unit test-ы toast-а, кнопок и команды; каждый сначала красный.

## Где в коде

- `src/renderer/canvas/actions/EpicStory.tsx` (новый), `src/renderer/canvas/actions/TicketStory.tsx` (новый)
- `src/renderer/canvas/actions/action-button.ts`, `src/renderer/canvas/actions/action-menu.ts`
- `src/renderer/canvas/ticket-card.ts`
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/shell/sidebar/PullRequestsSection.tsx`
- `src/renderer/stories/story-toast.ts` (новый)
- `src/renderer/toast/toasts.ts`
- `src/renderer/palette/commands.ts`
- `test/unit/story-toast.test.ts` (новый), `test/unit/story-entries.test.tsx` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/e2e/code-story.spec.ts` (из Ticket-а 09)

Только читать: `src/renderer/canvas/actions/EpicSessionHistory.tsx`, `src/renderer/canvas/actions/OpenPr.tsx`,
`src/renderer/flight-recorder/stop-toast.ts`, `test/unit/flight-recorder-stop-toast.test.ts`.

## Вне скоупа

- Сборка story по кнопке — Ticket 11.
