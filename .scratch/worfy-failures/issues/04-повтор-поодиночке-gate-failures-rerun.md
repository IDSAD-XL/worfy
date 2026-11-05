# 04 — Повтор поодиночке: `gate-failures rerun`

Type: task
Status: claimed 2026-11-04T23:32Z
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: все зелёные — exit 0.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: run из `imported/<id>/` и run с чужим `computer.id` — exit 3, stub-test не запущен (файл-след
      stub-а не появился).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: HEAD другой — exit 3 «HEAD is not the SHA of the run»; грязное дерево — exit 3; ни один test не
      запущен.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: `--dry-run` печатает список и оценку, ничего не запускает и не пишет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: повторы идут по одному (stub-test пишет время старта и конца — интервалы не пересекаются);
      после выхода нет живых дочерних процессов.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: при `workflow.e2e_lock` Playwright-повторы ждут чужой замок и снимают свой; vitest-повторы
      замка не берут; SIGTERM во время e2e-повтора снимает замок (папки замка после выхода нет).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Contract test: при заблокированном экране (stub `ioreg` в `PATH` отвечает `"IOConsoleLocked" = Yes`, потом
      `No`) повтор ждёт и стартует после разблокировки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-rerun.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Shell test-ы `wave-gate-lock*.test.sh`, `wave-gate-screen.test.sh`, `wave-gate.test.sh` зелёные после выноса.
  - evidence: test-run pass · `bash harness/bin/tests/wave-gate*.test.sh` (all six files) exit 0 · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
- [ ] Платформенный PR, если так скажет `scripts/windows-verdict-scope.mjs`.
  - evidence: test-run pass · `node scripts/windows-verdict-scope.mjs origin/main worfy-failures/04` exit 0, runner: not a platform PR · mac - · 248f422260d543d4ea35d6e204d4fc2f0e94cc5c
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

## Итог

Сделано в ветке `worfy-failures/04`.

- `harness/lib/gate-failures/rerun.mjs` — подкоманда `gate-failures rerun [--run <id> | --last] [--file <path>] [--limit N]
  [--dry-run]`. Run по умолчанию — самый новый красный run этого worktree (по `tag`). Отказ с exit 3 и строкой причины:
  run из `imported/` или с чужим `computer.id` («not a run of this computer»), HEAD не равен `head` («HEAD is not the SHA of
  the run»), грязное дерево («the worktree is not clean»), нечего повторять. До старта печатает список и оценку по `ms`
  записей; `--dry-run` на этом кончает. Каждый test — по одному, в корне worktree, без shell, `node` → `process.execPath`,
  без `GATE_FAILURES_FILE`; первая строка ошибки — после `scrub`. Файл повтора пишется после последнего test-а; сигнал
  завершает идущий test, снимает замок и пишет успевшее с `interrupted: true`, exit 128 + номер сигнала.
- `harness/lib/e2e-lock.cjs` — из `harness/bin/wave-gate` вынесены `lock` / `unlock`, `noteChild`, захват замка мёртвого
  держателя, `holderAlive` (он нужен и pid-файлу `wave-gate`), `screenLocked` / `screenWait` / `screenWatch` и снятие
  замков по сигналу (`onStopSignals`). Тексты, тайминги и переменные `WAVE_GATE_*` прежние; `wave-gate` берёт всё оттуда.
- Test-ы: `test/contract/gate-failures-rerun.test.ts` (9), fixture — `test/fixtures/gate-failures/rerun/` (run с тремя
  записями и stub-test). Временные git-репозиторий, Harness home, состояние gate и папка замка; настоящий
  `/tmp/worfy-e2e.lock` не берётся. Test-ы SIGTERM и заблокированного экрана на Windows пропускаются: там `kill` от другого
  процесса завершает node без обработчика, а stub `ioreg` — shell-скрипт.
- Первый падающий запуск: все 9 красные — подкоманды `rerun` ещё не было (unknown subcommand, файла повтора нет).
- Страницы `docs/features` не правились: раздел «Failure records» — Ticket 08.

Решено без владельца, подтвердить:

1. Test без `rerun` попадает в `results` файла повтора с `exit: null`, `ms: null` и `error: "cannot rerun: the record has no
   rerun argv"`: формат Ticket-а 01 это допускает, и отчёт (Ticket 05) видит такой test как «без повтора».
2. Exit 3, а не 0, когда красных нет, но хоть один test нельзя было повторить: «все зелёные поодиночке» тогда не доказано.
3. Записи шагов без test-а (lint, typecheck) печатаются строкой «step without tests, not rerun» и в файл не идут.
4. Playwright-повторы идут последними, все под одним замком; остальные — в порядке записей. В `holder.json` замка —
  `{ "what": "rerun", "run": <id> }` и обычные `pid`, `host`, `started`, `since`, `child`.
5. Поле `interrupted` есть в каждом файле повтора: `false` или `true`.
6. Строка ошибки угадывается по тексту: первая строка с `Error`, `assert` или `expected`, иначе с `fail`, `✗`, `×`, иначе
   первая непустая (stderr раньше stdout). Помечено `shortcut:` — взять строку у reporter-а проекта, когда он будет
   писать записи и при повторе.
7. Тайминги замка и опроса экрана — те же переменные `WAVE_GATE_LOCK_POLL_S`, `WAVE_GATE_LOCK_STALE_S`,
   `WAVE_GATE_HEARTBEAT_S`, `WAVE_GATE_SCREEN_POLL_S`, что у `wave-gate`.
8. Profile читается только если есть e2e-повторы; exit 3 и 4 у `profile` — замка нет, другой код — отказ с exit 3.
9. `--limit N` считает только test-ы с argv; остальные печатаются как «left out by --limit».
10. В `e2e-lock.cjs` пустой `catch` разрешён комментарием-настройкой eslint в самом файле, как правило для `harness/**/*.mjs`
   в `eslint.config`: `wave-gate` без расширения lint не проверял, а `.cjs` правило не покрывает.
