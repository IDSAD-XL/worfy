# 17 — Очередь в строке Autopilot и правка между Wave-ами

Type: task
Status: open
Blocked by: 10, 14, 16
Source: [spec.md](../spec.md), «Что видит владелец», п. 4–5; «Как работает» → «Очередь Epic-ов», «Виды»; «Решения владельца», 17, 18, 21; «Открытые вопросы», 2; [03](03-очередь-epic-ов.md), Q2, Q3, Q6

## Что происходит

- Строка Autopilot — `autopilotStatusLine` (`src/shared/ipc/autopilot.ts:221-…`): «Wave 1 · 2 background tasks»;
  Epic не назван — строка стоит на рамке своего Epic-а (`AutopilotAction.tsx:385`).
- После 14 состояние несёт `queue` и `index`, канал `autopilot.queue` есть.
- Меню «⋯» рамки Epic-а — Force stop и Run history (`AutopilotAction.tsx:449-475`).

## Что делаем

1. **Строка** Run-а очереди: «Epic 2/3: worfy-retry · Wave 1 · …»; на рамке Epic-а, который идёт сейчас. Рамка Epic-а,
   ждущего в очереди, — чип «In queue 3/3»; пропущенного — «Waits for owner».
2. **Меню «⋯»** рамки: «Add to queue» (Epic не в очереди, Run идёт), «Remove from queue» (Epic в очереди, не начат),
   «Run all accepted» (открывает окно Ticket-а 16). Правка во время Wave — «applies after this Wave».
3. Tooltip строки — список очереди со статусами.

## Готово, когда

- [ ] Unit test строки очереди и чипов: `done`, `running`, `next`, `waits-owner`, `elsewhere`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-queue-line.test.ts test/unit/canvas-actions.test.tsx` exit 0 · mac - · 0012f39329e853ebb505655165c82d5e011a11aa
- [ ] e2e: Run из двух Epic-ов fixture-а → строка «Epic 1/2» → «Add to queue» на третьем → после Wave — «Epic 1/3»;
      «Remove from queue» на втором → он не начат, `queue-changed` в журнале.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/autopilot-queue.spec.ts` exit 0 · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa
- [ ] Снимки строки и чипов в обеих темах — `../evidence/17-*.png`.
  - evidence: screenshot pass · `../evidence/17-queue-line-light.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-line-dark.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-light.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-dark.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-joins-light.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-joins-dark.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-leaves-light.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
  - evidence: screenshot pass · `../evidence/17-queue-chip-leaves-dark.png` · mac dev · 0012f39329e853ebb505655165c82d5e011a11aa · scrub: 2026-11-07
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/autopilot-queue-line.test.ts`, e2e `test/e2e/autopilot-queue.spec.ts` (новые).
- Сначала падающий: строка Run-а очереди без «Epic 1/2».

## Где в коде

- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/shared/ipc/autopilot.ts` (`autopilotStatusLine`)
- `test/unit/autopilot-queue-line.test.ts`, `test/e2e/autopilot-queue.spec.ts` (новые)

Только читать: `src/main/ipc/autopilot.ts`, `src/renderer/autopilot/StartAutopilotModal.tsx`.

## Итог

- Сначала падающий: новый `test/unit/autopilot-queue-line.test.ts` на старом коде — 13 из 13 красные; первый —
  строка Run-а очереди без места в очереди (`expected "Wave 1 · running" to be "Epic 2/3: checkout · Wave 1 ·
  running"`), остальные — `queueChip`, `queueTitle`, `queueAction` ещё нет. На новом коде — 13 из 13.
- Строка (`autopilotStatusLine`, `src/shared/ipc/autopilot.ts`): при очереди больше одного Epic-а — «Epic 2/3: checkout ·
  Wave 1 · running», и пока Run ждёт, и после остановки. Стоит на рамке Epic-а, который идёт; её tooltip — список очереди
  со статусами (`queueTitle`: done, running, next, «skipped: waits for the owner», «skipped: runs on another Machine») и
  правками, ждущими конца Wave. Ширина строки очереди — до 340px (одного Epic-а — 220px, как было).
- Чипы (`queueChip`) под кнопкой рамки другого Epic-а очереди, пока Run идёт: `next` — «In queue 3/3», `waits-owner` —
  «Waits for owner», `elsewhere` — «Runs elsewhere»; у `running` и `done` чипа нет (на первой — строка, вторая уходит на
  полку done). После остановки Run-а чипов нет.
- Меню «⋯» (`queueAction`): «Add to queue» на Epic-е вне очереди и «Remove from queue» на не начатом, пока Run идёт и
  Stop не просили (`autopilot.queue`); «Run all accepted» — когда в Project-е нет Run-а (окно Ticket-а 16,
  `runAllAccepted`). Правка во время Wave — toast «… · applies after this Wave» и чип «Joins after this Wave» /
  «Leaves after this Wave», пока состояние main не покажет её сделанной. «Remove from queue» на Epic-е, ждущем
  добавления, забирает добавление назад. Отказ main — error toast и tooltip «⋯».
- e2e `test/e2e/autopilot-queue.spec.ts` на fake agent (новый script `autopilot-queue-held`: четыре хода, каждый ждёт
  отпуска test-ом): «Run all accepted» из «⋯» → снять search → Run demo, checkout → «Epic 1/2: demo · Wave 1 · running»,
  у checkout «In queue 2/2» → «Add to queue» на search → «applies after this Wave», `queue-changed` ещё нет → конец Wave →
  «Epic 1/3: demo · Wave 2 · running», `queue-changed` `added: [search]` → «Remove from queue» на checkout → конец Wave →
  `queue-changed` `removed: [checkout]`, `epic-finished` `removed`, checkout не начат (Wave-а для него нет), Run идёт на
  search «Epic 2/2».
- Снимки (обе темы): строка — [светлая](../evidence/17-queue-line-light.png), [тёмная](../evidence/17-queue-line-dark.png);
  «In queue 2/3» — [светлая](../evidence/17-queue-chip-light.png), [тёмная](../evidence/17-queue-chip-dark.png);
  «Joins after this Wave» — [светлая](../evidence/17-queue-chip-joins-light.png),
  [тёмная](../evidence/17-queue-chip-joins-dark.png); «Leaves after this Wave» —
  [светлая](../evidence/17-queue-chip-leaves-light.png), [тёмная](../evidence/17-queue-chip-leaves-dark.png). Пиксели
  проверил агент (только данные fixture-а: Epic-и `demo`, `checkout`, `search`), владельцу — посмотреть. Чипы «Waits for
  owner» и «Runs elsewhere» — только unit test, снимков нет.
- Решено без владельца: чипы — только пока Run идёт; ожидающие правки main в состоянии не отдаёт, окно держит свои
  (по Project-у и id Run-а) до состояния, где правка сделана, — правка из другого окна там не видна; «Run all accepted»
  в «⋯» — только без Run-а (во время Run-а старт всё равно отказ), и не на рамке, где осталась одна «Run history»;
  подпись — «Add to queue» без многоточия: окна выбора нет.
- not verified: `pnpm test` локально — exit 1 только от file-watch contract test-ов (cards-watch-edits,
  claude-home-registry, docs-watch-root, docs, workflow-reader, harness-script-env; перегружен fseventsd на Mac), остальные
  зелёные; `ci-ok` — по PR.
