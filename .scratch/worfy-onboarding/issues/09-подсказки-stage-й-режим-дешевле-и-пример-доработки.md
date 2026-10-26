# 09 — Подсказки Stage-й, переключатель «дешевле / дороже» и записанный пример доработки

Type: task
Status: open
Blocked by: 07
Source: решения владельца 2026-10-26, пункты 4 (остальные понятия — короткие подсказки на Stage-ах Ticket-а demo), 5 (запасной путь: «this time the review found nothing» и записанный пример REJECTED и доработки), 6 (по умолчанию Sonnet, effort medium; переключатель на Opus; только «a bit cheaper» / «a bit more expensive»); [spec.md](../spec.md), «Тексты (черновик)»; «Решено без владельца», Р5, Р10, Р11 (решено без владельца, подтверждено владельцем 2026-10-26)

## Что происходит

- Stage-ы Ticket-ов в renderer: `usePipeline(root)` (`src/renderer/pipeline/usePipeline.ts:85`) и
  `stageOfTicket` (`:95`). У Ticket-а — `kind` Stage-а, `passed` и `rework`
  (`src/shared/workflow/pipeline.ts:167-192`). После Ticket-а 02 у demo они двигаются без GitHub.
- Раздел Getting started (Ticket 07, `src/renderer/shell/sidebar/GettingStartedSection.tsx`) показывает
  шаги; подсказок Stage-й и переключателя стоимости в нём нет. После Ticket-а 06 в состоянии есть
  `reworkSeen` и шаг 5.
- Toast `info` скрывается сам через `TOAST_MS`; с `projectId` виден, только пока этот Project активный
  (`src/renderer/toast/toasts.ts:7-13`, `:38-39`).
- Модель и effort Orchestrator-а Demo project выставляет Ticket 05 (Sonnet, medium) в
  `SessionSettingsStore` (`src/main/agent/session-settings.ts:64`). Живой Session настройки меняет
  handler `agent.configure` (`src/main/ipc/agent.ts:168`; канал — `src/shared/ipc/agent.ts:77`).
  Subagent-ы implementer и reviewer берут модель Orchestrator-а (`model: inherit`,
  `harness/agents/implementer.md:4`, `harness/agents/reviewer.md:5`).

## Что делаем

1. `src/renderer/getting-started/hints.ts` (новый): чистая функция «снимок Stage-а Ticket-а demo →
   подсказка или null». Шесть подсказок из spec-а: Epic и Ticket (шаг 3), Implementing,
   Agent review, Implementing с `rework`, Gate & merge, Done. Подсказка показывается, когда Ticket
   входит в её Stage: строкой под текущим шагом раздела и одним toast `info` с `projectId` demo (Р10).
   Показанная — `gettingStarted.hintSeen { id }` в main, второй раз toast-а нет; строка в разделе
   остаётся, пока Ticket на этом Stage-е.
2. Запасной путь: шаг 5 отмечен, `reworkSeen: false` — в шаге 5 «This time the review found nothing.» и
   «Show an example». `src/renderer/getting-started/ReviewExample.tsx` (новый) раскрывает записанный
   пример (Р11): вердикт ревьюера REJECTED с находкой «`done 2` on a task that is already done exits 0
   and says nothing», правка исполнителя (десяток строк diff-а) и вердикт VERIFIED. Текст — константа в
   этом файле, на английском.
3. `src/renderer/getting-started/CostSwitch.tsx` (новый) под шагом 2, пока есть demo: подпись и два
   варианта — тексты spec-а. Канал `gettingStarted.setCost { cost: 'cheaper' | 'more-expensive' }`:
   main пишет `cost` в запись `demo` и настройки Node-а Orchestrator-а demo — Sonnet + medium или
   Opus + effort по умолчанию модели (Р5). Session жива — меняет и её, как `agent.configure`;
   действует со следующего хода. Цен и чисел нет нигде.

## Готово, когда

- [ ] Unit test `hints`: каждый из шести случаев даёт свою подсказку; `rework: true` на Implementing —
      подсказка круга доработки, а не первого Implementing; другой Project — null.
- [ ] Contract test `setCost`: `more-expensive` — в `session-settings.json` у Node-а Orchestrator-а demo
      Opus и effort null; `cheaper` — Sonnet и medium; живая Session (fake agent) получила изменение.
- [ ] e2e (fake agent; Status и файл отметок пишет test): Ticket demo проходит Implementing →
      Agent review → Implementing (`review failure`) → Gate & merge → Done; каждая подсказка видна
      строкой в разделе и одним toast-ом; после перезапуска toast-ы не повторяются.
- [ ] e2e: шаг 5 без `review failure` — «This time the review found nothing.», «Show an example»
      раскрывает пример.
- [ ] Снимки переключателя и примера в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/getting-started-hints.test.ts` (новый).
- Contract `test/contract/getting-started-cost.test.ts` (новый).
- e2e `test/e2e/getting-started-hints.spec.ts` (новый).
- Сначала падающий: unit `hints` для Agent review — модуля нет.

## Где в коде

- `src/renderer/getting-started/hints.ts` (новый)
- `src/renderer/getting-started/ReviewExample.tsx` (новый)
- `src/renderer/getting-started/CostSwitch.tsx` (новый)
- `src/renderer/shell/sidebar/GettingStartedSection.tsx`
- `src/main/getting-started/demo.ts`, `src/main/getting-started/state.ts`
- `src/shared/ipc/getting-started.ts`, `src/main/ipc/getting-started.ts`
- `test/unit/getting-started-hints.test.ts` (новый)
- `test/contract/getting-started-cost.test.ts` (новый)
- `test/e2e/getting-started-hints.spec.ts` (новый)

Только читать: `src/renderer/pipeline/usePipeline.ts`, `src/shared/workflow/pipeline.ts`,
`src/main/agent/session-settings.ts`, `src/main/ipc/agent.ts`, `src/renderer/toast/toasts.ts`.

## Итог

Заполняется при закрытии.
