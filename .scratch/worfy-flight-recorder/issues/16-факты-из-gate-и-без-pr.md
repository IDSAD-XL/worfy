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
  читает `timings.json` версии 1 через zod; битый JSON, другая версия, `at` не дата — не читается. `gateRunFacts`:
  span `gate` (имя `gate <profile>`, `id` — `<tag>/<run>`) с `sha` = `head` и `worktree`, без `ticket` — Ticket
  находит модель; шаги — `script` с `parentWork` на запуск. Конец — `at` файла (gate пишет его в конце запуска),
  начало — `at − total_ms`; шаги стоят встык до `at` (записаны только длительности). `outcome`: `green` и `none` —
  `ok`, `red` — `failed` с упавшими шагами, `unverified` — `failed` «not verified: environment unavailable». `note`
  каждого запуска — `GREEN_CACHE_NOTE`: запуск целиком из green cache `timings.json` не пишет и на шкале не виден.
- Путь worktree — один helper `canonicalWorktree` (`src/main/flight-recorder/worktree-path.ts:24`):
  `realpath.native`, затем `comparablePath` (from-gate.ts:43): на Windows `/` вместо `\`, нижний регистр, без
  `\\?\`; везде без хвостового разделителя, кроме корня. Правило и требование звать этот helper записаны в
  контракте `facts.ts:69`; reader 14 импортирует его.
- `src/main/flight-recorder/gate-logs.ts` — `readGateLogs` (gate-logs.ts:67) читает все `<tag>/<run>/timings.json`,
  `tag` не вычисляет; оставляет запуски, которые пересекают окно Run (и на краях). Время — только `at`, mtime не
  читается. «gate logs deleted (10 runs or 8 days)»: полная папка worktree (`LOG_RUNS_KEPT` = 10, столько оставляет
  `pruneLogs` gate — contract test вызывает настоящий `pruneLogs`), самый старый запуск которой начат после старта
  Run, — от старта Run до этого запуска (gate-logs.ts:112); папка запуска внутри Run без читаемого `timings.json` —
  до следующего запуска этого worktree, иначе до конца Run (gate-logs.ts:109); Run старше 8 дней — `ticket: null`
  (gate-logs.ts:115).
- `src/main/flight-recorder/local-verdicts.ts` — `readLocalVerdicts` (local-verdicts.ts:92) для Ticket-ов без PR,
  у которых была ветка: файл отметок Silent mode через `SilentMarks` (если вызывающий говорит, что отметки там);
  reflog ветки — каждый новый head — `push`, commit `gate: VERIFIED` / `gate: REJECTED: …` (и после `NARROW:`) —
  отметка `review` на commit-е под ним, `gate: MAX-REVIEW: …` пропускается. Merge — только у ветки со своим
  commit-ом: первая запись reflog main, чей commit содержит head (двоичный поиск; самая старая оставшаяся запись не
  считается — reflog мог истечь), иначе merge commit с head среди родителей (local-verdicts.ts:84), иначе время
  commit-а head. Ветки нет — «branch deleted». Не git-папка — ни событий ветки, ни «branch deleted».
- Gate не изменён: в `harness/hooks/` правок нет. Ничего не пишется: contract test сравнивает файлы и папки Harness
  home и репозитория до и после чтения, с влитыми ветками (merge commit, fast-forward, истёкший reflog main).
- Tests: `test/unit/flight-recorder-gate.test.ts`, `test/contract/flight-recorder-gate-logs.test.ts` (17 tests, в т.ч.
  оба `timings.json` fixture ночного Run; git test-а без глобального config пользователя — `GIT_CONFIG_GLOBAL`).
  Mutation testing: 15 мутантов первого раунда и 16 мутантов доработки — все убиты.

Не проверено и решения:
- «Journal или Ticket говорит, что gate шёл»: reader gate видит только свои папки (один источник на reader), поэтому
  «известный запуск» — папка запуска без `timings.json`, полная папка worktree или Run старше 8 дней; ограничение до
  Ticket-ов, о которых знает Journal, делает модель.
- Полная папка (10 запусков) не отличается от папки, где запусков было ровно 10: метка говорит «могли пропасть».
- Папка worktree, где ни у одного запуска нет читаемого `timings.json`, не называет worktree — её запуски без метки
  (это может быть папка другого Project-а).
- «branch deleted» получает любой переданный Ticket без ветки: сервис 17 передаёт только Ticket-ы без PR, у которых
  ветка была.
- Без reflog ветки (истёк, `core.logAllRefUpdates=false`) нет ни push-ей, ни verdict-ов, ни merge.
- После rebase ветки с verdict-commit-ом head меняется, и модель видит новый commit после verdict-а.
- Путь Windows проверен на macOS через `platform: 'win32'` и подставной realpath; настоящий `realpath.native` и
  junction — в Windows job CI.
