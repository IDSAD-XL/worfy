# 16 — Очередь в окне запуска и «Run all accepted»

Type: task
Status: open
Blocked by: 11, 13, 14
Source: [spec.md](../spec.md), «Что видит владелец», п. 4; «Окно запуска (прототип)», вид «Queue»; «Решения владельца», 16; «Открытые вопросы», 2; [03](03-очередь-epic-ов.md), Q1

## Что происходит

- Окно запуска (Ticket-ы 09, 11) показывает один Epic; `autopilot.prepare` уже берёт `epics`, но дату принятия
  отдаёт `null`.
- Список принятых Epic-ов — `acceptedEpics` (Ticket 13); старт с `epics` — Ticket 14.
- Command palette — `buildCommands` (`src/renderer/palette/commands.ts:620`), рядом «Run history» (`open-run-history`,
  `:396`).

## Что делаем

1. **Вид «Queue» окна**: заголовок «Start Autopilot · N Epics, M Waves»; строка «N Epics are accepted and waiting.
   Autopilot runs them one after another.»; список `src/renderer/autopilot/QueueList.tsx` — галочка, номер, имя Epic-а,
   число Wave, «accepted <дата>»; перетаскивание и ⌥↑/⌥↓; «Ordered by acceptance date · drag to reorder, untick to
   drop»; прогноз и сетка — по отмеченным; ни одного отмеченного — старт недоступен.
2. **`autopilot.prepare`**: дата принятия и Wave-ы по каждому Epic-у; прогноз — сумма.
3. **«Run all accepted»** — команда Command palette: открывает окно с `acceptedEpics`; нет принятых — toast «No accepted
   Epic has a ready Ticket». Пункт в меню «⋯» рамки Epic-а — Ticket 17.
4. Просьба агента со списком (Ticket 15) — тот же вид «Queue» под строкой «Asked by …».

## Готово, когда

- [ ] Unit test списка: снять галочку, перетащить мышью и ⌥↑/⌥↓, прогноз пересчитан, пустой выбор — старт недоступен.
  - evidence: test-run pass · `pnpm test test/unit/queue-list.test.tsx` 9 passed, exit 0 · mac - · b7c25ed7dc42eeb0351456614725c54fdfb0ed4e
- [ ] Contract test `autopilot.prepare` с тремя Epic-ами: даты, Wave-ы, сумма прогноза.
  - evidence: test-run pass · `pnpm test test/contract/autopilot-prepare.test.ts` 10 passed, exit 0 · mac - · b7c25ed7dc42eeb0351456614725c54fdfb0ed4e
- [ ] e2e: Command palette → «Run all accepted» → окно с тремя Epic-ами fixture-а → снять второй, первый и третий
      поменять местами → старт → `run-started.epics` в журнале — в новом порядке без снятого.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-start-modal.spec.ts` 4 passed, exit 0 · mac dev · f52e9056af0dfbb9376a4396b71bffcd3cdaa92f
- [ ] Снимок вида «Queue» в обеих темах — `../evidence/16-*.png`.
  - evidence: screenshot pass · `../evidence/16-start-window-queue-light.png` · mac dev · d830ba0fc21f4eb0e88ed4d2d8a067b294b60667 · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/16-start-window-queue-dark.png` · mac dev · d830ba0fc21f4eb0e88ed4d2d8a067b294b60667 · scrub: 2026-11-07
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/queue-list.test.tsx` (новый); contract `test/contract/autopilot-prepare.test.ts`; e2e
  `test/e2e/autopilot-start-modal.spec.ts`.
- Сначала падающий: «Run all accepted» — нет команды.

## Где в коде

- `src/renderer/autopilot/StartAutopilotModal.tsx`, `src/renderer/autopilot/start-modal.ts`
- `src/renderer/autopilot/QueueList.tsx` (новый)
- `src/shared/ipc/autopilot-prepare.ts`, `src/main/ipc/autopilot-prepare.ts`, `src/main/autopilot/prepare.ts`
- `src/renderer/palette/commands.ts`
- `test/unit/queue-list.test.tsx` (новый), `test/contract/autopilot-prepare.test.ts`, `test/e2e/autopilot-start-modal.spec.ts`

Только читать: `src/shared/workflow/accepted-epics.ts`, прототип `card-918c77d9`.

## Итог

- Сначала падающий: новый `test/unit/queue-list.test.tsx` на старом коде — 9 из 9 красные, первый — «Run all accepted»
  нет в `buildCommands` (`expected undefined to match object { group: 'Action', … }`); новый case contract test-а
  `autopilot-prepare` с тремя Epic-ами — красный: `accepted` у каждого Epic-а `null`. На новом коде — 9 из 9 и 10 из 10.
- «Run all accepted» — команда Command palette (`run-all-accepted`, группа Action): окно запуска над `acceptedEpics`
  (не больше 10 — предел очереди); нет принятых — toast «No accepted Epic has a ready Ticket», окно не открывается. На
  read-only экране Linked machine команда неактивна, как прочие команды, которые меняют Project
  (`test/unit/palette-commands.test.tsx`, список `WRITES`, дополнен).
- Вид «Queue» (`src/renderer/autopilot/QueueList.tsx`): галочка, место среди отмеченных, Epic, Wave-ы, «accepted Nov 4»;
  перетаскивание мышью (HTML5 drag) и ⌥↑/⌥↓ на ручке строки, фокус остаётся на ней. Заголовок «Start Autopilot · N Epics,
  M Waves» считает отмеченные; при каждой смене отмеченных окно заново спрашивает `autopilot.prepare` по ним, в их
  порядке, и пока ответ идёт, видны прошлые факты; ни одного отмеченного — Forecast «No Epic is ticked», кнопка старта
  неактивна. Старт — `autopilot.start` с отмеченными Epic-ами в порядке списка.
- `autopilot.prepare` отдаёт дату принятия каждого Epic-а (`acceptedAt` из `epic-status --json`); прогноз очереди — сумма
  Wave-ов, длительность — сумма длительностей по Epic-ам (contract test).
- Просьба агента со списком (Ticket 15): тот же список под «Asked by …», но без галочек, ручек и перетаскивания — ответ
  окна в main несёт только Run mode (`autopilot.confirm.answer`), а канал и `chat-confirm.ts` не в следе этого Ticket-а.
  Чтобы владелец мог править очередь агента, ответ должен нести и список Epic-ов — отдельная правка.
- Снимки вида «Queue»: [светлая](../evidence/16-start-window-queue-light.png),
  [тёмная](../evidence/16-start-window-queue-dark.png); пиксели проверил агент (только данные fixture-а: Project `demo`,
  Epic-и `demo`, `checkout`, `search`), владельцу — посмотреть.
- Решено без владельца: дата — «Nov 4» (месяц и день, как прототип), полная дата — в tooltip; строка под заголовком при
  одном Epic-е — «1 Epic is accepted and waiting.»; квадрат цвета Epic-а — через `canvas/kind-colours.ts` (стили не
  называют роли `kind-*`); toast отказа старта очереди — тот же ключ, что у кнопки Autopilot.
- Вне следа: стили — `src/renderer/autopilot/autopilot-modal.css`; страница `docs/features/autopilot.md` (вид «Queue»,
  «Run all accepted», просьба агента со списком).
