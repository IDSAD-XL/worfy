# 16 — Факты из gate и без PR

Type: task
Status: claimed 2026-11-01T01:58Z
Branch: worfy-flight-recorder/16
Blocked by: 12
Source: [spec.md](../spec.md), «Источники и что меняется в них» (строки «Логи gate» и «Отметки и verdict без PR», ключ связи по `head` и `worktree`, «Хранение»), «Модель» («Неполная история» — «gate logs deleted», «branch deleted»), «Windows» (логи gate, время), «Ticket-ы» (16), «Риски», п. 2 и 6; решение 04, Q5 ([04-дыры-источников.md](04-дыры-источников.md)); решение 08, Q6 ([08-неполная-история.md](08-неполная-история.md)); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Gate пишет запуски в `<Harness home>/gate/state/logs/<tag>/<run>/timings.json` (`harness/hooks/gate-log.mjs`):
  время, `outcome`, `head`, `worktree`, шаги. Хранится 10 последних запусков на worktree (`LOG_RUNS_KEPT`), папка
  чужого worktree без изменений дольше 8 дней удаляется (`STALE_MS`).
- `tag` — sha1 пути worktree в той форме, какую видел gate (`worktreeTag`, `harness/hooks/gate-paths.mjs:66`).
- Запуск целиком из green cache `timings.json` не пишет (`harness/hooks/gate.mjs:1059`, `if (logs.length)`) — на
  шкале его не будет (риск 2). Gate не меняется (решение 04, Q5).
- Silent mode: отметки агентов — файл `<Harness home>/runs/<project>/marks/<epic>-<NN>.json`
  (`src/main/workflow/marks.ts`); `local-green` — commit-ы `gate: VERIFIED` в ветке Ticket-а.

## Что делаем

1. `src/shared/flight-recorder/from-gate.ts` — чистый разбор `timings.json` в span `gate` с шагами (`script`) и
   исходом; разбор отметок и commit-ов `gate: VERIFIED` в факты verdict модели Ticket-а 12.
2. `src/main/flight-recorder/gate-logs.ts` — читает все `timings.json`, `tag` не вычисляет. Запуск относится к
   Ticket-у по `head` (sha commit-а PR); без PR — по `worktree`, сравнивая пути без учёта регистра и с одним
   разделителем (буква диска, 8.3-имена вроде `RUNNER~1` — через `realpath`). Время — `at` внутри файла, не mtime.
3. `src/main/flight-recorder/local-verdicts.ts` — файл отметок Silent mode и commit-ы `gate: VERIFIED` в ветке.
4. Пометки потерянного: Journal или Ticket говорит, что gate шёл, а `timings.json` нет — «gate logs deleted
   (10 runs or 8 days)»; ветки Ticket-а нет — «branch deleted». Source span-а называет ограничение green cache.

## Готово, когда

- [ ] Unit test разбора: `timings.json` с тремя шагами — span `gate` с тремя `script`, `outcome` даёт исход.
- [ ] Contract test (временная `<Harness home>`): два запуска одного worktree с разными `head` — каждый у своего
      Ticket-а по `head`; запуск без PR — по `worktree`.
- [ ] Contract test путей Windows: `C:\Users\Ann\Repo\.claude\worktrees\05` и `c:/users/ann/repo/.claude/worktrees/05`
      — один worktree; 8.3-имя сводится через `realpath`.
- [ ] Contract test: время берётся из `at` внутри `timings.json`; mtime файла другой — результат тот же.
- [ ] Contract test: нет `timings.json` при известном запуске — «gate logs deleted (10 runs or 8 days)»; нет ветки —
      «branch deleted».
- [ ] Contract test Silent mode: файл отметок `<epic>-<NN>.json` и commit `gate: VERIFIED` в ветке дают verdict-ы
      Ticket-а без PR.
- [ ] Gate не изменён: в `harness/hooks/` правок нет.
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): пути и файлы — до merge нужен вердикт Windows.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-gate.test.ts` (новый): разбор `timings.json`, отметок и commit-ов.
- Contract `test/contract/flight-recorder-gate-logs.test.ts` (новый): временные папки Harness home и git-репозиторий
  с веткой Ticket-а; `timings.json` ночного Run (обезличенные).
- Сначала падающий: два запуска одного worktree с разными `head` — оба достаются одному Ticket-у.
- Прогнать `test/unit/flight-recorder-*.test.ts` и `test/contract/workflow-stages.test.ts` (читает `marks.ts`).

## Где в коде

- `src/shared/flight-recorder/from-gate.ts` (новый)
- `src/main/flight-recorder/gate-logs.ts` (новый)
- `src/main/flight-recorder/local-verdicts.ts` (новый)
- `test/unit/flight-recorder-gate.test.ts` (новый)
- `test/contract/flight-recorder-gate-logs.test.ts` (новый)

Только читать: `harness/hooks/gate-log.mjs` (`LOG_RUNS_KEPT`, `STALE_MS`, `writeTimings`),
`harness/hooks/gate-paths.mjs` (`worktreeTag`), `harness/hooks/gate.mjs:1059`, `src/main/workflow/marks.ts`,
`src/main/workflow/stages.ts` (`local-green`), `src/shared/flight-recorder/spans.ts`.

## Итог

- `src/shared/flight-recorder/from-gate.ts` — чистый разбор, без Node и DOM (test на импорты). `parseTimings`
  (from-gate.ts:85) читает `timings.json` версии 1 через zod; битый JSON, другая версия, `at` не дата — не читается.
  `gateRunFacts` (from-gate.ts:106): span `gate` (имя `gate <profile>`, `id` — `<tag>/<run>`) с `sha` = `head`,
  `worktree`, без `ticket` — Ticket находит модель; шаги — `script` с `parentWork` на запуск. Конец — `at` файла (gate
  пишет его в конце запуска), начало — `at − total_ms`; шаги шли подряд, а записаны только их длительности, поэтому
  они стоят встык до `at`. `outcome`: `green` и `none` — `ok`, `red` — `failed` с упавшими шагами в причине,
  `unverified` — `failed` «not verified: environment unavailable». `note` каждого запуска — `GREEN_CACHE_NOTE`
  (from-gate.ts:31): запуск целиком из green cache `timings.json` не пишет и на шкале не виден; шаги из cache
  перечислены там же.
- Каноническая форма worktree — `comparablePath` (from-gate.ts:42): на win32 один разделитель `/`, нижний регистр,
  без `\\?\` и без хвостового `/`; на других ОС путь как есть. `canonicalWorktree` (gate-logs.ts:43) перед ней
  делает `realpath.native` (8.3-имя `RUNNER~1`, ссылки, регистр буквы диска); путь, которого уже нет, остаётся как
  записан. Ту же форму должен отдавать reader 14 — это договорённость двух reader-ов, в facts.ts она описана только
  как «realpath; case-folded on Windows», без разделителя.
- `src/main/flight-recorder/gate-logs.ts` — `readGateLogs` (gate-logs.ts:84) читает все `<tag>/<run>/timings.json`,
  `tag` не вычисляет; запуски вне окна Run (`since`…`until`) отбрасывает. Время — только `at`, mtime не читается
  (contract test меняет mtime файла и папки — результат тот же). Потерянное — «gate logs deleted (10 runs or 8
  days)»: папка worktree с 10 запусками, начатыми после начала Run (gate-logs.ts:123, worktree — у модели по
  `worktree`); папка запуска времени Run без читаемого `timings.json` (gate-logs.ts:121, со временем из имени папки);
  Run, кончившийся больше 8 дней назад (gate-logs.ts:125, `ticket: null` — модель метит каждый Ticket без span
  `gate`).
- `src/main/flight-recorder/local-verdicts.ts` — `readLocalVerdicts` (local-verdicts.ts:72) для Ticket-ов без PR:
  файл отметок Silent mode через `SilentMarks` из `marks.ts` (только если вызывающий говорит, что отметки там —
  `marksInFile`); reflog ветки Ticket-а — каждый новый head — `push` (источник `git`), commit `gate: VERIFIED` /
  `gate: REJECTED: …` (и после `NARROW:`), сделанный на ветке, — отметка `review` на commit-е под ним;
  `gate: MAX-REVIEW: …` пропускается. Локальный merge (local-verdicts.ts:53): head ветки в main — время, когда reflog
  main дошёл до этого head, иначе merge commit над ним, иначе время commit-а head. Ветки нет — «branch deleted»
  (`kind: 'script'`, имя `branch <branch>`).
- Gate не изменён: в `harness/hooks/` правок нет. Ничего не пишется — contract test сравнивает Harness home и
  репозиторий до и после чтения.
- Tests: `test/unit/flight-recorder-gate.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` (12 tests, в т.ч.
  оба `timings.json` fixture ночного Run). Mutation testing: 15 мутантов кода, все убиты.

Не проверено и решения:
- «Journal или Ticket говорит, что gate шёл»: reader gate видит только свои папки (контракт facts.ts — один
  источник на reader), поэтому «известный запуск» — это папка запуска без `timings.json`, переполненная папка
  worktree или Run старше 8 дней; ограничение до Ticket-ов, о которых знает Journal, делает модель.
- «branch deleted» ставится любому переданному Ticket-у без ветки, в том числе тому, кто ветку так и не завёл:
  сервис (17) должен передавать только Ticket-ы без PR, которые были в работе.
- Reflog ветки нужен для `push` и verdict-ов; без reflog (истёк, `core.logAllRefUpdates=false`) событий ветки нет.
- После rebase на ветке с verdict-commit-ом head меняется, и модель видит новый commit после verdict-а.
- Путь Windows проверен на macOS через `platform: 'win32'` и подставной realpath; настоящий `realpath.native` на
  Windows (`RUNNER~1` во временной папке runner-а) — только в Windows job CI.
