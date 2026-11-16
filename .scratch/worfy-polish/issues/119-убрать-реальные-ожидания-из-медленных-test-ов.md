# 119 — Убрать реальные ожидания из медленных test-ов: опции задержек и fake timers

Type: task
Status: claimed 2026-11-16T01:52Z
Blocked by: none
Source: владелец 2026-11-16, «да на тикеты»: кандидаты 1–9 исследования
`docs/research/2026-11-16-fake-timers.md` (раздел 4, «Кандидаты по файлам», и правило «когда fake timers НЕ
использовать»).

Кто: агент.

## Что происходит

- Замер исследования (Mac владельца, `164474a3f`, полный run с JSON reporter-ом): около 90 s из 3268 s суммарного
  времени test-ов уходит на то, что test высиживает настоящую задержку продукта или свою паузу. Wall time локального
  run-а от этого почти не меняется (его держат shell test-ы Harness-а, Ticket 120), на CI job — порядка 10–20 s
  (**оценка** исследования).
- Timer-ы продукта, которые contract test ждёт целиком (рядом настоящие процессы, поэтому fake timers не годятся):
  - `test/contract/autopilot-retry.test.ts:672` и `:688` — по 15 s: Stop во время хода ждёт `interruptTurn` с
    `HALT_TURN_MS = 15_000` (`src/main/agent/session/process.ts:9`; вызов `src/main/agent/session.ts:850`, timer —
    `session.ts:524`), а fake agent держит ход до конца предела.
  - `test/contract/harness-codex-hooks.test.ts:463` — 10 s: test проверяет предел резолвера Stop hook-а
    `RESOLVE_MS = 10_000` (`harness/hooks/stop.mjs:57`, `timeout` — `:180`). Hook — дочерний процесс, fake timers
    vitest до него не достают.
  - `test/contract/docs.test.ts:112` (`pastStartReads`) и `test/unit/docs-watch-root-gone.test.ts:115` — ~15 s:
    ждут чтений после старта `SETTLE_READS_MS = [100, 400, 1000]` (`src/main/docs/watch.ts:215`, цикл — `:501`).
    У `DocsWatcher` уже есть опции (`DocsWatchOptions`, `watch.ts:248`).
- Unit/jsdom test-ы, где весь путь идёт в процессе test-а и fake timers уместны:
  - `test/unit/connect-project.test.tsx:254` (500 ms), `:336` (400 ms), `waitFor` на `:134` — debounce
    `CHECK_DELAY_MS = 350` (`src/renderer/projects/ConnectProject.tsx:172`, timer — `:259`);
  - `test/unit/edit-profile.test.tsx:133` — тот же debounce (`src/renderer/projects/EditProfile.tsx:88`, timer —
    `:152`);
  - `test/unit/kit-tooltip.test.tsx:20` (`flush`) — задержка tooltip-а `TOOLTIP_DELAY_MS = 600`
    (`src/renderer/theme/kit/Tooltip.tsx:34`, timer — `:150`);
  - `test/unit/session-view.test.tsx:834` (400 ms) и паузы `test/unit/session-node-drop.test.tsx:358`, `:376` —
    сохранение черновика `DRAFT_DELAY_MS = 300` (`src/renderer/session/drafts.ts:34`, timer — `:108`);
  - `test/unit/mind-map-view.test.tsx:499` (`nextFrame`, 60 ms ×4) и `test/unit/terminal-replies.test.tsx:362`
    с соседними паузами (50 ms ×6).
- Девять пауз «за это время ничего не случилось», обёрнутые в `ms()` (множитель `test/time-scale.ts` = 3): 4.8 s
  написано, 14.4 s на деле. Множитель нужен пределам ожидания того, что должно прийти; негативную паузу он только
  удлиняет. Места: `test/contract/docs.test.ts:349`, `test/contract/project-pulse.test.ts:278`, `:314`, `:375`,
  `:386`, `test/contract/workflow-reader.test.ts:1550`, `test/contract/terminal-git-bash-close.test.ts:226`,
  `test/contract/auto-approve-codex.test.ts:560`, `test/contract/codex-session-limits.test.ts:132`.
- Правила, когда fake timers брать и когда нет, в правилах test-ов репозитория не записано. Его нарушение уже
  давало flaky test: fake timers без `now` в `orchestrator-continue` (PR #1760).

## Что делаем

1. **`haltTurnMs`.** Опция Session-а, по образцу `returnGraceMs` у orchestrator-а
   (`src/main/agent/orchestrator.ts:169`, применение — `:899`): `session.ts:850` берёт её вместо `HALT_TURN_MS`.
   Её доводит до Session-а тот же путь, которым `autopilot-retry.test.ts` строит Autopilot. Два test-а
   (`:672`, `:688`) передают ~200 ms. Без опции — прежние 15 s.
2. **Предел резолвера Stop hook-а из переменной окружения.** `harness/hooks/stop.mjs` читает предел из переменной
   рядом с `CLAUDE_GATE_RESOLVE` (имя — implementer, например `CLAUDE_GATE_RESOLVE_MS`); пусто, не число, ноль или
   меньше — прежние 10 s. Test на `:463` ставит 1 s и проверяет «≥ 1 s и < 60 s». Скрипт Harness-а — текст и имя
   переменной по-английски (Harness language-neutral).
3. **`settleReadsMs`.** Ещё одна опция `DocsWatchOptions`: список задержек чтений после старта, без неё —
   `SETTLE_READS_MS`. Test-ы, которые не проверяют сами эти чтения, ставят `[10]` и ждут по ней (`pastStartReads`,
   `docs-watch-root-gone.test.ts:115`). Test-ы, которые эти чтения проверяют, остаются на значении по умолчанию.
4. **Пять unit-файлов на fake timers** (п. 4–8 исследования): `connect-project`, `edit-profile`, `kit-tooltip`,
   `session-view` (с паузами `session-node-drop` того же черновика), `mind-map-view` (с паузами
   `terminal-replies`). Форма: `vi.useFakeTimers({ toFake: [...], now: <фиксированная дата> })`, движение времени —
   `await act(() => vi.advanceTimersByTimeAsync(<задержка продукта>))`, `waitFor` Testing Library — на `vi.waitFor`
   (первый под fake timers vitest висит до предела), `vi.useRealTimers()` в `afterEach`. Для React Flow и Base UI, если
   они ставят `requestAnimationFrame`, — `toFake: ['requestAnimationFrame']` и `vi.advanceTimersToNextFrame()`.
   Задержку test берёт из экспорта продукта (`CHECK_DELAY_MS`, `TOOLTIP_DELAY_MS`, `DRAFT_DELAY_MS`), где он есть;
   неэкспортированную константу implementer экспортирует, не меняя значения.
5. **Девять негативных пауз без `ms()`.** Либо голое значение, либо барьер вместо паузы, где он есть
   (`watcher.idle()`, как на `workflow-reader.test.ts:1419`). Исследование отмечает спорность: на медленном runner-е
   короткая негативная пауза может пропустить запоздалое событие — проверка станет слабее, но не краснее. Значение
   паузы не уменьшаем ниже написанного сейчас.
6. **Правило в правилах test-ов репозитория.** Правила test-ов живут в `docs/lessons/testing.md` (формат —
   `docs/lessons/README.md`: заголовок-утверждение, суть, строка `Проверка:`, последней — `Источник:`). Новый урок:
   fake timers — только когда весь путь от действия test-а до проверки идёт в его процессе, без настоящего I/O
   (дочерние процессы, pty, chokidar/fs.watch, сокеты, git, чтение файлов между timer-ами); иначе — короткое значение
   через опцию продукта, барьер или `vi.waitFor`. Если fake timers: узкий `toFake`, всегда явный `now`, только
   `*Async`-варианты, `vi.waitFor`, а не `waitFor` Testing Library, `vi.useRealTimers()` в `afterEach`/`finally`.
   Ссылка на исследование.
7. **Поведение продукта не меняется.** Значения по умолчанию прежние: `HALT_TURN_MS` 15 s, `RESOLVE_MS` 10 s,
   `SETTLE_READS_MS` `[100, 400, 1000]`, `CHECK_DELAY_MS` 350, `TOOLTIP_DELAY_MS` 600, `DRAFT_DELAY_MS` 300.

## Готово, когда

- [ ] Каждый изменённый test сохраняет смысл: мутант задержки продукта, которую он проверяет (задержка убрана,
      timer не ставится или ставится с другим значением), делает его красным. Мутант и красный вывод — в описании PR,
      по одному на п. 1–4.
- [ ] Test на каждую новую опцию (`haltTurnMs`, `settleReadsMs`, переменная окружения hook-а): без неё продукт берёт
      прежнее значение по умолчанию; негодное значение переменной окружения — тоже прежнее.
- [ ] До и после — время каждого тронутого файла из JSON report-а vitest
      (`node scripts/vitest-electron.mjs --reporter=json --outputFile.json=<файл> <файлы>`), одна машина, таблица в
      описании PR. Ожидание исследования — около 75–90 s суммарного времени test-ов.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs --reporter=json --outputFile.json=<file> <14 touched files>` before (origin/main edd313cad) and after, twice each, same Mac, exit 0 except one after-run (exit 1 on the flaky workflow hub test, untouched); table in the PR · mac - · a1a44e9d89ae3c72d0ae14f980f1268e24226ce2
- [ ] Урок в `docs/lessons/testing.md` по формату `docs/lessons/README.md`; `node scripts/check-lessons.mjs` —
      exit 0.
  - evidence: test-run pass · `node scripts/check-lessons.mjs` exit 0 · mac - · a1a44e9d89ae3c72d0ae14f980f1268e24226ce2
- [ ] Все unit- и contract-test-ы тронутых модулей зелёные: каждый файл `test/`, который импортирует
      `src/main/agent/session` или `session/process` (78 файлов на `ea21c0bbb`; список — `grep` в описании PR);
      `test/contract/harness-codex-hooks.test.ts`, `harness/hooks/tests/stop-gate-cycle.test.sh`,
      `harness/hooks/tests/stop-codex-checkout.test.sh`; импортёры `src/main/docs/watch`
      (`test/contract/docs.test.ts`, `docs-watch-root.test.ts`, `docs-hub-hold.test.ts`, `product-watch.test.ts`,
      `profile-move.test.ts`, `projects-remove.test.ts`, `test/unit/docs-watch-root-gone.test.ts`); семь unit-файлов
      п. 4; девять файлов п. 5.
  - evidence: gate pass · `gate fast` exit 0 (pnpm test: 788 files passed, 7 skipped) · mac - · a1a44e9d89ae3c72d0ae14f980f1268e24226ce2
- [ ] gate fast зелёный; Windows job CI зелёный (`stop.mjs` — скрипт Harness-а).

## Где в коде

- `src/main/agent/session/process.ts` (`HALT_TURN_MS`), `src/main/agent/session.ts` (`halt`, `interruptTurn`, вызов на
  `:850`), `src/main/agent/orchestrator.ts` (образец `returnGraceMs`)
- `harness/hooks/stop.mjs` (`RESOLVE_MS`, `CLAUDE_GATE_RESOLVE`)
- `src/main/docs/watch.ts` (`SETTLE_READS_MS`, `DocsWatchOptions`)
- `src/renderer/projects/ConnectProject.tsx`, `src/renderer/projects/EditProfile.tsx`,
  `src/renderer/theme/kit/Tooltip.tsx`, `src/renderer/session/drafts.ts` — только экспорт констант, если нужен
- `test/contract/autopilot-retry.test.ts`, `test/contract/harness-codex-hooks.test.ts`, `test/contract/docs.test.ts`,
  `test/unit/docs-watch-root-gone.test.ts`
- `test/unit/connect-project.test.tsx`, `test/unit/edit-profile.test.tsx`, `test/unit/kit-tooltip.test.tsx`,
  `test/unit/session-view.test.tsx`, `test/unit/session-node-drop.test.tsx`, `test/unit/mind-map-view.test.tsx`,
  `test/unit/terminal-replies.test.tsx`
- `test/contract/project-pulse.test.ts`, `test/contract/workflow-reader.test.ts`,
  `test/contract/terminal-git-bash-close.test.ts`, `test/contract/auto-approve-codex.test.ts`,
  `test/contract/codex-session-limits.test.ts`, `test/time-scale.ts` (только читать)
- `docs/lessons/testing.md`, `docs/lessons/README.md` (формат), `scripts/check-lessons.mjs`
- `docs/research/2026-11-16-fake-timers.md` (замер, риски, правило)
