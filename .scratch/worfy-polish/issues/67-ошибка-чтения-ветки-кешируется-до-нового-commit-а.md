# 67 — Ошибка чтения ветки кешируется до нового commit-а

Type: bug
Status: done 2026-11-08T03:13Z
PR: #1613
Blocked by: —
Source: аудит кода 2026-11-08 (Orchestrator), находка MED. Строки перечитаны по main `3bb9e0778`.

## Что происходит

- Статус Ticket-а из его worktree-ветки читает `epic-status --ref <branch>` (ADR-0033). Ответ хранится в кеше
  веток по имени ветки: `readBranches` читает ветку снова, только когда сдвинулся её head
  (`src/main/workflow/reader.ts:458`).
- Любая ошибка этого чтения тоже ложится в кеш: `{ head, ticket: null, error }` (`reader.ts:471`). Проверка кеша
  смотрит только на `head`, поле `error` не учитывает. Одна случайная ошибка — timeout 60 s (`reader.ts:97`) под
  нагрузкой, сбой git или EMFILE — и Ticket, взятый в работу в worktree, показывает `open` из checkout-а до
  следующего commit-а в этой ветке.
- Следствие: `readyWave` (`src/shared/workflow/waves.ts`) считает такой Ticket готовым, его файлы перестают быть
  `held`, и модель Autopilot (`src/main/autopilot/run.ts`, чтение модели около `:1953`) может предложить второй
  запуск Ticket-а, над которым уже идёт работа.
- `branchErrors` доходит до renderer-а (`diffModels`, `src/renderer/workflow/useWorkflow.ts:54`), но нигде не
  показывается.

## Что делаем

1. Запись кеша с ошибкой не переиспользуется: ветка читается снова. Чтобы ветка, которая ломается постоянно, не
   запускала `epic-status` на каждое событие, — пауза перед повтором; watcher сам назначает повтор по таймеру, без
   ожидания нового события.
2. Ветка, которую не удалось прочитать, не делает Ticket готовым: пока чтение не удалось, Ticket не входит в Wave,
   его файлы `held`. Прошлый удачный ответ ветки сохраняется на время ошибки.
3. `branchErrors` видны пользователю — минимально, рядом с другими проблемами чтения workflow.

## Готово, когда

- [ ] Test: после ошибки чтения ветки следующее чтение (после паузы) читает её снова, и Ticket показывает статус
      ветки. До правки — красный; mutant со старым условием кеша — красный.
  - evidence: test-run pass · `pnpm test` exit 0; mutant with the old cache condition: `vitest run test/contract/workflow-reader.test.ts -t "worfy-polish 67"` exit 1 · mac - · 39570471a
  - evidence: test-run pass · `pnpm test` exit 0; mutants: success keeps the old retry exit 1, failures carried over a new head exit 1 · mac - · 65b9c08e7
- [ ] Test: watcher сам перечитывает ветку после ошибки, без нового события.
  - evidence: test-run pass · `pnpm test` exit 0 (workflow-reader.test.ts, watcher re-reads a failed branch with no event) · mac - · 39570471a
  - evidence: test-run pass · `pnpm test` exit 0 (watcher: no branch read after recovery; mutant success keeps the old retry exit 1) · mac - · 65b9c08e7
- [ ] Test: Ticket, ветку которого не удалось прочитать, `readyWave` не берёт в Wave, его файлы `held`.
  - evidence: test-run pass · `pnpm test` exit 0 (waves.test.ts and workflow-reader.test.ts, unreadBranch keeps the Ticket out of readyWave) · mac - · 39570471a
- [ ] `branchErrors` показаны пользователю или в «Итог» обосновано, почему нет.
  - evidence: test-run pass · `pnpm test` exit 0 (workflow-stages.test.ts, branch errors in the Pipeline problems) · mac - · 39570471a
  - evidence: test-run pass · `pnpm test` exit 0 (workflow-stages.test.ts: at most three branches named; mutant without the bound exit 1) · mac - · 65b9c08e7
- [ ] Все unit и contract test-ы `src/main/workflow/`, `src/shared/workflow/`, test-ы модели Autopilot,
      `pnpm lint`, `pnpm typecheck`, `pnpm test`, gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 · mac - · 39570471a
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 · mac - · 65b9c08e7
  - evidence: gate pass · `gate fast` exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` exit 0 after the rebase onto 64c8946c2 · mac - · 282e33bd2
- [ ] ci-ok зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42432788499/job/128595935797 · ci - · 9196a54bb44d0574217a89ada4708e11db687c01

## Где в коде

- `src/main/workflow/reader.ts` — `BranchSnapshot`, `readBranches`, `applyBranches`, `readWorkflow`.
- `src/main/workflow/watch.ts` — повтор чтения веток по таймеру.
- `src/main/workflow/stages.ts` — строки проблем Pipeline.
- `src/shared/workflow/types.ts` — поле Ticket-а о непрочитанной ветке.
- `src/shared/workflow/waves.ts` — `readyWave`, `inFlight`.
- `test/contract/workflow-reader.test.ts`, `test/contract/workflow-stages.test.ts`, `test/unit/waves.test.ts`.
- `test/contract/autopilot.test.ts` — fixture кеша веток получает новое поле `retry`.
- `docs/features/workflow.md` — ready Wave, чтение веток, notice Pipeline.

## Итог

- Находка подтвердилась: mutant со старым условием кеша (`cached.head === worktree.head`) роняет все три новых
  test-а чтения веток (exit code 1).
- Повтор: запись с ошибкой хранит `retry: { at, failures }`; до `at` она переиспользуется, после — ветка читается
  снова, даже при том же head. Пауза растёт с числом ошибок подряд: 30 s, 1 min, 2 min, затем каждые 5 минут
  (`BRANCH_RETRY_MS`). Так ветка с timeout 60 s не задерживает каждое чтение модели, а случайная ошибка проходит
  за 30 s. Новый commit в ветке начинает паузы сначала. Удачное чтение сбрасывает `retry` в null. Watcher сам
  ставит таймер на ближайший `at` и читает ветки без нового события; после восстановления таймер не ставится.
- Безопасный выбор для Wave: при ошибке сохраняется то, что сказало последнее удачное чтение ветки (claim не
  откатывается в `open`), а Ticket получает поле `unreadBranch`. Открытый Ticket с этим полем `readyWave` не берёт и
  держит его файлы `held`, как Ticket в работе; blocked и done в checkout-е поле не получают. Если ветка не
  читалась ни разу (первое чтение упало), Ticket показывает `open` из checkout-а, но в Wave не идёт.
- Autopilot читает модель заново на каждый шаг (`readWorkflow` без кеша, `src/main/ipc/autopilot.ts`), поэтому кеш
  его не задевал; задевала одна неудачная попытка чтения — теперь она не делает Ticket готовым.
- `branchErrors` показаны в notice Pipeline («Some Stages may be short of facts»): строка на ветку — имя, что статус
  её Ticket-а может отставать (открытый Ticket не идёт в Wave), и причина; не больше трёх веток, остальные числом. Это то же место, где уже стоят другие проблемы
  чтения workflow (`src/main/workflow/stages.ts`).
