# 04 — Повтор поодиночке: `gate-failures rerun`

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 2, «Модель» (файл повтора, классы), «Windows» (замок e2e — всегда при `workflow.e2e_lock`), «Решено без владельца» (`rerun` запускает только свои записи), «Вопросы владельцу», Q2 (рекомендация А), «Риски», п. 2 и 3; [ADR-0086](../../../docs/adr/0086-pc-gate-full-once-per-wave.md), пункт 3

## Что происходит

- ADR-0086, пункт 3 (строки 37-41): после красного gate full Session на ПК повторяет упавшие test-ы поодиночке на
  том же SHA, руками; итог — текст в сообщении. То же — `harness/skills/epic-wave/SKILL.md:973-978`.
- Замок e2e на Mac — `workflow.e2e_lock` Profile-а; `harness/bin/wave-gate` берёт его функциями `lock` / `unlock`
  (`harness/bin/wave-gate:190`, `:329`, вызов — `:848-850`), проверяет экран перед gate full (`screenLocked` /
  `screenWait`, `wave-gate:347-356`) и снимает замки по сигналу (`release` и обработчики, `wave-gate:1073-1082`).
  Всё это — внутри `wave-gate`, в общий модуль не вынесено. `rules-local-e2e.md` Profile-а требует и замок, и
  проверку экрана перед любым e2e на Mac вне `wave-gate`.
- Записи из `imported/` пришли с другого компьютера, возможно из публичного комментария GitHub (Ticket 06).
- Записи run-а несут `rerun` — argv повтора (Ticket 03) или `null`.

## Что делаем

1. `harness/lib/gate-failures/rerun.mjs` — `gate-failures rerun [--run <id> | --last] [--file <path>] [--limit N]
   [--dry-run]`:
   - берёт run (по умолчанию — последний красный этого worktree по `tag`); HEAD не равен `head` записи или
     `git status --porcelain` не пуст — exit 3 и строка причины;
   - run из `imported/` или с `computer.id`, не равным `id` этого компьютера (`readComputer`), — exit 3 «not a run of
     this computer»: argv чужой записи не исполняется никогда;
   - перед стартом печатает список и оценку времени по `ms` записей; `--dry-run` на этом кончает;
   - каждый test с `rerun` — по одному, в корне worktree, `node` → `process.execPath`, без shell, без
     `GATE_FAILURES_FILE` в окружении; итог — `exit`, `ms`, первая строка ошибки после `scrub`;
   - записи без `rerun` — в итог как «cannot rerun», не запускаются;
   - для `runner: playwright` при заданном `workflow.e2e_lock` (через `profile --field workflow.e2e_lock`) — на любой
     машине — проверка экрана, затем замок на время всех e2e-повторов; SIGINT, SIGTERM, SIGHUP и SIGBREAK снимают
     замок и завершают идущий повтор, как `release` в `wave-gate`;
   - файл повтора (spec, «Модель») пишется после последнего test-а; прерванный повтор (SIGINT) пишет то, что успел,
     с `interrupted: true`.
   - Выход: 0 — все зелёные поодиночке, 2 — хоть один красный, 3 — нечего или нельзя проверить.
2. `harness/lib/e2e-lock.cjs` — `lock` / `unlock`, `screenLocked` / `screenWait` и снятие замков по сигналу из
   `harness/bin/wave-gate` без изменения поведения; `wave-gate` требует их оттуда. `harness/lib/README.md` — строка о
   модуле.

## Готово, когда

- [ ] Contract test: run-fixture с тремя записями (один test зелёный поодиночке, один красный, один без `rerun`) —
      файл повтора с двумя результатами и «cannot rerun»; exit 2.
- [ ] Contract test: все зелёные — exit 0.
- [ ] Contract test: run из `imported/<id>/` и run с чужим `computer.id` — exit 3, stub-test не запущен (файл-след
      stub-а не появился).
- [ ] Contract test: HEAD другой — exit 3 «HEAD is not the SHA of the run»; грязное дерево — exit 3; ни один test не
      запущен.
- [ ] Contract test: `--dry-run` печатает список и оценку, ничего не запускает и не пишет.
- [ ] Contract test: повторы идут по одному (stub-test пишет время старта и конца — интервалы не пересекаются);
      после выхода нет живых дочерних процессов.
- [ ] Contract test: при `workflow.e2e_lock` Playwright-повторы ждут чужой замок и снимают свой; vitest-повторы
      замка не берут; SIGTERM во время e2e-повтора снимает замок (папки замка после выхода нет).
- [ ] Contract test: при заблокированном экране (stub `ioreg` в `PATH` отвечает `"IOConsoleLocked" = Yes`, потом
      `No`) повтор ждёт и стартует после разблокировки.
- [ ] Shell test-ы `wave-gate-lock*.test.sh`, `wave-gate-screen.test.sh`, `wave-gate.test.sh` зелёные после выноса.
- [ ] Платформенный PR, если так скажет `scripts/windows-verdict-scope.mjs`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Contract `test/contract/gate-failures-rerun.test.ts` (новый): временный git-репозиторий; test-ы — stub-скрипты
  `node -e …` в argv `rerun`; Profile — временный (`HARNESS_HOME`).
- Fixture — `test/fixtures/gate-failures/rerun/`.
- Сначала падающий: run с одним зелёным поодиночке test-ом — файла повтора нет.

## Где в коде

- `harness/lib/gate-failures/rerun.mjs` (новый)
- `harness/lib/e2e-lock.cjs` (новый)
- `harness/bin/wave-gate`
- `harness/lib/README.md`
- `test/contract/gate-failures-rerun.test.ts` (новый)
- `test/fixtures/gate-failures/rerun/` (новый)

Только читать: `harness/hooks/gate-failures.mjs` (Ticket 01), `harness/hooks/gate-paths.mjs` (`worktreeTag`),
`harness/bin/profile`, `harness/bin/tests/wave-gate-lock.test.sh`.
