# worfy-failures: записи о падениях test-ов и отчёт по многим run-ам

Status: принят владельцем 2026-11-04 («Со всем согласен» — все рекомендованные ответы на Q1–Q6, раздел «Вопросы владельцу»).
Source: PR #1314 (`docs/proposals/eight-autonomy-features.md`, идея 5 «Failure Intelligence»), оценка Orchestrator-а
2026-11-04, принятая владельцем вместе с этим решением (MVP сужен: записи gate, отчёт CLI, предложения карантина;
LLM-классификация и dashboard — вне MVP); [CONTEXT.md](../../CONTEXT.md), термины Gate, Gate full, Machine,
Quarantine, Windows exception, Silent mode, Wave, Run;
[ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy читает факт, а не копирует),
[ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние — вне репозитория),
[ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md) (скрипты Harness — на Node),
[ADR-0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md) (Harness не знает языка и проекта),
[ADR-0086](../../docs/adr/0086-pc-gate-full-once-per-wave.md) (gate full на ПК после Wave, повтор упавших
test-ов поодиночке, issue `pc-main-red`).
Ticket-ы: Epic `worfy-failures`, 9 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`, как у worfy-flight-recorder.

## Цель и что видит пользователь

Сейчас красный gate full на ПК — это текст. Session на ПК пишет «19 failures, all green alone» или «60 failed in 15
files under a game», bridge-Session (Session на Mac, которая передаёт сообщения между Orchestrator-ом и Session на ПК)
пересказывает его Orchestrator-у, и тот по памяти решает, что flaky, а что регрессия. Маркеры gate знают только
«красно» и «не удалось проверить» (`src/main/gate/state.ts:135-139`), а не почему.

С этим Epic-ом:

1. Красный gate (fast или full, на любой машине) оставляет одну запись на каждый упавший test: какой test, в каком
   шаге gate, на каком SHA, на какой машине и платформе, сколько шёл, первая строка ошибки, номер попытки и команда
   повтора этого test-а поодиночке. Записи лежат в папке состояния gate, вне репозитория.
2. `gate-failures rerun` гоняет каждый упавший test поодиночке на том же SHA и записывает итог. Так ручной повтор
   ADR-0086, пункт 3 становится командой с записью.
3. `gate-failures report` по записям многих run-ов и обеих машин печатает: flaky test-ы (красный в run-е, зелёный
   поодиночке на том же SHA), стабильно красные (красный и поодиночке), неподтверждённые (повтора не было) — с
   числом раз, машинами и последней ошибкой.
4. `node scripts/quarantine-suggest.mjs` превращает кандидатов отчёта в готовые записи формата `test/quarantine/<id>.json`
   — печатает, никогда не пишет.
5. Записи ПК попадают на Mac командой `gate-failures import`, а не пересказом.

Ни одна команда не правит test-ы, Harness или карантин сама: решение остаётся за человеком или Orchestrator-ом.

## Модель

**Файл run-а** — `<Harness home>/gate/state/failures/<tag>--<run>.json`, где `<tag>` и `<run>` — те же, что у папки
логов run-а (`harness/hooks/gate-log.mjs:29-32`, `runLogDir`). Пишется только run-ом, в котором упал хоть один
script. Поля (версия 1):

| Поле | Что |
| --- | --- |
| `version`, `kind` | `1`, `"run"` |
| `run` | `<tag>/<run>` — тот же id, что у run-а gate во Flight Recorder (`src/main/flight-recorder/gate-logs.ts:104`) |
| `at`, `key`, `profile`, `head`, `outcome` | как в verdict-файле gate (`harness/hooks/gate.mjs:44-61`) |
| `computer` | `{ id, name, platform }` — компьютер, на котором шёл gate (см. ниже); не hostname |
| `dirty` | `true`, если `git status --porcelain` перед script-ами был не пуст: run шёл не по `head`. Отчёт и кандидаты такие run-ы пропускают |
| `failures[]` | по записи на упавший test или на упавший script без test-ов |

**Запись о падении** (`failures[]`): `step` (метка шага gate, `worfy/.:test`), `runner` (`vitest`, `playwright` или
`null`), `file` (от корня репозитория, `/`), `line`, `name` (describe-блоки и test через « > », как в
`test/flaky.ts:24-31`), `test` (id для сравнения между run-ами: `<runner> <file> > <name>`, без строки — строка
меняется от commit-а к commit-у), `ms`, `error` (первая строка ошибки после очистки, не длиннее 200 символов),
`attempt` (локально всегда 1: повторы есть только в CI, `test/flaky.ts:20`), `rerun` (argv повтора поодиночке или
`null`). Упавший script без записей test-ов (lint, typecheck, сборка, упавший до test-ов процесс) даёт одну запись с
`runner`/`file`/`name` = `null` и первой строкой ошибки из своего вывода.

**Файл повтора** — `<tag>--<run>.rerun-<stamp>.json`: `kind: "rerun"`, `of` (id run-а), `head`, `computer`,
`results[]` — `{ test, exit, ms, error }` на каждый повторённый test.

**Классы в отчёте** — по паре (test, SHA):

- **flaky** — красный в run-е, зелёный в повторе поодиночке на том же SHA (ADR-0086, пункт 3: «Зелёные
  поодиночке test-ы — flaky test под нагрузкой»);
- **стабильно красный** — красный и в повторе;
- **без повтора** — повтора не было (или test нельзя повторить: `rerun` = `null`).

Run, в котором больше половины упавших test-ов зелёные поодиночке, отчёт помечает «под нагрузкой»: это случай «19
failures, all green alone».

**Компьютер.** `<Harness home>/gate/machine.json` — `{ id, name }`: `id` — 8 случайных hex-цифр, созданных один раз;
`name` по умолчанию — `mac`, `windows` или `linux` по платформе, меняется `gate-failures machine --name PC`. Hostname
и имя пользователя в записи не попадают никогда. Это не Machine из CONTEXT.md (та привязана к папке данных
worfy, ADR-0052): dev-сборка и Stable copy на одном компьютере пишут в одну Harness home и дают один `computer`.

**Очистка текста.** Поля `error`, `name` и `file` каждой записи проходят `scrub` до записи на диск — и строки
reporter-а тоже: их очищает gate, не доверяя проекту. `scrub` стоит на `harness/lib/privacy.cjs` Epic-а
`worfy-evidence` (Ticket 02 того Epic-а: шаблоны, `findLeaks`, разрешённые заглушки, маскирование) и добавляет
замены этого Epic-а: путь корня worktree → `<repo>`, домашняя папка → `~`, имя пользователя → `<user>`, hostname →
`<host>`; остальное (UUID, email, токены) маскирует `privacy.cjs`. Export проверяет текст ещё раз `findLeaks` и
отказывает (exit 2) при остатке.

**Импортированные записи** — `<state>/failures/imported/<computer.id>/<те же имена файлов>`; `listRuns` и
`pruneFailures` (Ticket 01) читают и чистят их вместе со своими, с полем `imported: true`.

**Срок хранения** — 60 дней по `at` в файле; старые файлы удаляет сам gate после записи нового, как `pruneLogs`
удаляет логи (`harness/hooks/gate-log.mjs:51-76`). Логи gate живут 10 run-ов на worktree (`LOG_RUNS_KEPT`,
`gate-log.mjs:24`), записи — дольше: отчёту нужны недели, а не последние 10 run-ов.

## Источники и что меняется в них

- **Gate не знает test-ов.** Он гоняет script-ы реестра (`pnpm run test`, `test:e2e`…) и видит только их код выхода и
  вывод (`harness/hooks/gate.mjs:727-745`, `runScript`; цикл — `gate.mjs:1012-1039`). Разбирать текст вывода он уже
  умеет только для отчёта (`playwrightFailures`, `gate-log.mjs:152-172`), и это вид, а не данные. Поэтому записи о
  test-ах пишет сам проект: gate даёт каждому script-у переменную `GATE_FAILURES_FILE` (путь временного файла
  `.run-<tag>-<pid>-<NN>.failures.jsonl` в папке состояния), reporter-ы проекта дописывают туда по строке JSON на
  упавший test. Gate читает и удаляет этот файл сразу после `runScript`, в `finally`, как `captured` удаляет свой
  файл вывода (`gate.mjs:711-716`), и держит строки в памяти до `settle`; после исхода пишет файл run-а с `step`,
  `computer`, SHA. Полагаться на `removeOld` нельзя: он удаляет только файлы старше 8 дней (`gate.mjs:394-406`), а
  обработчик сигнала выходит без уборки (`gate.mjs:825-829`). Так остановленный run не оставляет ни файла run-а, ни
  временного файла дольше одного script-а — как логи (`gate.mjs:1055-1056`).
- **worfy: reporter-ы.** У vitest per-test JSON нет: свой reporter пишет только время файлов
  (`test/timings-reporter.ts:5-8`), встроенный json не взят из-за отсутствия project. У Playwright JSON-отчёт есть
  (`playwright.config.ts:34-43`, `:85`), но его путь — знание проекта, а не gate. Новые reporter-ы — рядом с
  FLAKY-reporter-ами (`test/flaky-reporter.ts`, `test/e2e/flaky-reporter.ts`), в списки `reporters`
  (`vitest.config.ts:46`, `playwright.config.ts:85`). Без `GATE_FAILURES_FILE` (CI, ручной `pnpm test`) они молчат.
- **Повтор поодиночке.** Команду повтора пишет reporter: проект знает, как запустить себя на один test, а Profile
  worfy такой команды не задаёт (`rules.md` Profile-а: «Прицельного запуска одного теста (`test_one`) профиль не
  задаёт»). vitest — `node scripts/vitest-electron.mjs <file> -t <имя>` (`scripts/vitest-electron.mjs:2-4`),
  Playwright — `node <cli Playwright> test <file>:<line>`; первое слово `node` CLI заменяет своим `process.execPath`,
  shell не нужен — одинаково на macOS и Windows.
- **Карантин.** Формат записи — `QuarantineEntry` (`test/quarantine.ts:88-102`), пределы — `MAX_ENTRIES` 15,
  `MAX_DAYS` 14, Windows exception — 30 записей, 45 дней, владелец `worfy-windows 117` (`test/quarantine.ts:57-64`).
  Это правила worfy, а не Harness: предложения записей печатает скрипт worfy, а Harness-отчёт выдаёт только
  кандидатов в общем виде (`--json`).
- **Не меняется:** verdict-файл, маркеры, cache, строки `[gate] …` и коды выхода gate; `timings.json`; CI и его
  повторы; FLAKY-строки; Journal Autopilot.

## Windows

- Gate на Windows запускает script-ы через `cmd.exe` с `env: { ...process.env, … }` (`gate.mjs:648-650`), напрямую — с
  наследованием окружения (`gate.mjs:679`); `GATE_FAILURES_FILE` доходит до reporter-а в обоих путях. Ticket 02
  проверяет оба.
- Пути в записях — от корня репозитория с `/`; очистка знает `C:\Users\<user>`, `C:/Users/<user>`, `/c/Users/<user>`
  и 8.3-имена вида `RUNNER~1`.
- Harness home на ПК — `%USERPROFILE%\.claude\worfy-harness`, не `%APPDATA%`: Bash Session на ПК её видит (приватная
  папка пакета подменяет только AppData).
- Повтор Playwright идёт по собранному `out/` того же SHA. Замок e2e — одно правило для обеих машин: `rerun` берёт
  его всегда, когда в Profile-е задан `workflow.e2e_lock`; сейчас он задан только на Mac.

## Решено без владельца

- **Записи о test-ах пишет проект, gate только собирает** (раздел «Источники»). Вариант «gate читает JSON-отчёты
  vitest и Playwright по путям из реестра» отвергнут: Harness стал бы знать раннеры проекта (ADR-0074).
- **CLI — `harness/bin/gate-failures`** с подкомандами в `harness/lib/gate-failures/<sub>.mjs`: точка входа находит
  модуль по имени подкоманды (`export.mjs`, `import.mjs`…), так что Ticket-ы 04–06 не правят общий файл. Формат и
  очистка — `harness/hooks/gate-failures.mjs` с объявлениями `gate-failures.d.mts` (иначе `pnpm typecheck` не
  примет импорт из test-ов), рядом с `gate-log.mjs`; bin импортирует его как `../hooks/…`, как другие bin
  (`harness/bin/profile`).
- **`rerun` запускает только свои записи**: run из `imported/` или с чужим `computer.id` — отказ (exit 3). argv из
  публичного комментария не исполняется никогда.
- **Срок записей — 60 дней**, `computer.id` — случайный, без hostname (раздел «Модель»).
- **Красный отчёт gate** получает одну строку `--- failure records: <файл> (<n> tests, <m> steps without tests)`
  после «full output»; verdict-файл не меняется.
- **Test-ы CLI — vitest contract** (`test/contract/gate-failures-*.test.ts`): bash только в test-ах (ADR-0055,
  пункт 4), но новые `.test.sh` удлиняют job-ы `harness-scripts`; gate.mjs проверяется `.test.sh` рядом с
  `gate-timings.test.sh`, как сейчас.
- **Документация** — новый раздел «Failure records» на странице `docs/features/gate-and-github.md` (она уже
  описывает Gate и Gate full), не новая страница.
- **Очистка текста** — `scrub` в `gate-failures.mjs` поверх `harness/lib/privacy.cjs` Epic-а `worfy-evidence`
  (его Ticket 02); шаблоны второй раз не пишутся. Ticket 01 ждёт merge того Ticket-а: это сказано в его «Что происходит» и в Wave 1
  ниже. В `Blocked by` чужой Epic не пишется: `epic-status` и `waves.ts` читают там только номера своего Epic-а, и
  «worfy-evidence 02» сделал бы Ticket «unparsed» (`harness/bin/epic-status:306-314`,
  `src/shared/workflow/waves.ts:14-16`).

## Вопросы владельцу

**Q1. Как записи ПК попадают на Mac.**
- А. Блок `gate-failures export` в комментарии GitHub: при красном `main` — в issue `pc-main-red` (ADR-0086, пункт 4,
  там уже упавшие test-ы `file:line`), при зелёном с flaky — в PR, чей merge-коммит проверял gate full. Mac:
  `gate-failures import --gh IDSAD-XL/worfy --issue N` / `--pr N`. Минус: репозиторий публичный.
- Б. Через Linked machine (worfy Link): worfy на Mac читает записи ПК. Не публично, но нужен новый вызов Link и код
  worfy; Harness CLI сам Link не умеет.
- В. Текст export в сообщении между Session-ами, Mac — `gate-failures import -`. Следа в репозитории нет, доставка не
  подтверждается.
- **Рекомендую А, и В — как запасной путь** (формат один, `import` принимает оба). Очистка до записи и проверка при
  export обязательны (Ticket-ы 01, 06).
- **Владелец 2026-11-04: А, и В — как запасной путь.**

**Q2. Где повтор поодиночке.**
- А. Отдельная команда `gate-failures rerun` после красного gate; вердикт gate не меняется.
- Б. Gate сам повторяет упавшие test-ы в конце красного run-а; вердикт остаётся красным, run дольше.
- В. Gate зеленеет, если все зелёные поодиночке — против решения владельца 2026-10-28 (повтора внутри run-а нет,
  ADR-0086, пункт 3).
- **Рекомендую А.**
- **Владелец 2026-11-04: А.**

**Q3. Поправка ADR-0086 и правил Profile.** Session на ПК после красного gate full зовёт `gate-failures rerun` вместо
ручного повтора, отчёт несёт блок export; Orchestrator на Mac делает `import` и кладёт три строки `report` в отчёт
Wave. Правка — новый ADR-поправка, текст skill `epic-wave` (`harness/skills/epic-wave/SKILL.md:973-978`) и
`rules.md` Profile-а на обеих машинах (правится только по слову владельца). Да / нет / только ПК, без отчёта Wave.
**Рекомендую да.**
**Владелец 2026-11-04: да.**

**Q4. Когда test — кандидат в карантин.**
- А. Flaky в двух разных run-ах (другой SHA или другой компьютер) за 14 дней — «повторяется» ADR-0086, пункт 3.
- Б. С первого раза.
- В. С третьего раза.
- **Рекомендую А.**
- **Владелец 2026-11-04: А.**

**Q5. Кандидаты в Windows exception.** Стабильно красный только на `win32` при зелёном (или отсутствующем в записях)
том же test-е на Mac того же SHA → предложение записи `kind: "windows-exception"`. Да / только карантин.
**Рекомендую да** — правило владельца «Windows acceptance = исправить или win32 exception».
**Владелец 2026-11-04: да.**

**Q6. Текст ошибки в export.**
- А. Первая строка ошибки после очистки, до 200 символов.
- Б. Без текста ошибки: в export только test, SHA, класс; текст — только на своей машине.
- **Рекомендую А**: без текста на Mac снова пересказ; остаток после очистки export не выпустит.
- **Владелец 2026-11-04: А.**

## Ticket-ы

Не UI: снимков нет. Test-ы — внутри Ticket-ов. Платформенный ли PR, решает `scripts/windows-verdict-scope.mjs`
(ADR-0086); пути и процессы есть в 02, 04, 06.

- **01 — Формат записи, очистка и каркас `gate-failures`.** Модуль формата, `testId`, очистка, `machine.json`,
  чтение и запись файлов (свои и `imported/`), срок хранения, `.d.mts`; bin с подкомандами `list` и `machine`.
  Blocked by: —; ждёт merge `worfy-evidence` 02 (`harness/lib/privacy.cjs`; в теле Ticket-а, не в шапке).
- **02 — Gate пишет записи.** `GATE_FAILURES_FILE` каждому script-у, сбор строк, запись script-а без test-ов, строка
  в красном отчёте, срок хранения. Blocked by: 01. Платформенный.
- **03 — Reporter-ы vitest и Playwright.** Строка на упавший test и падение файла, команда повтора. Blocked by: 01.
- **04 — `gate-failures rerun`.** Повтор поодиночке на том же SHA, только свои записи, замок e2e с проверкой экрана
  и снятием по сигналу, файл повтора. Blocked by: 01.
  Платформенный.
- **05 — `gate-failures report` и `scripts/quarantine-suggest.mjs`.** Классы, ранжирование, «под нагрузкой»,
  кандидаты, записи карантина и Windows exception в формате `test/quarantine/`. Blocked by: 01.
- **06 — Export и import.** Блок для комментария (части до предела комментария GitHub), проверка очистки, import из
  файла, stdin и комментариев GitHub.
  Blocked by: 01. Платформенный.
- **07 — Порядок ПК → Mac: ADR и skill.** Новый ADR «меняет ADR-0086, пункты 2–4», запись в `## Amendments`
  ADR-0086, текст `epic-wave`, правила Profile обеих машин. Blocked
  by: 02, 03, 04, 05, 06.
- **08 — Документация.** Раздел «Failure records» в `docs/features/gate-and-github.md` и переводе. Blocked by: 07.
- **09 — Приёмка с владельцем на Mac и Windows-ПК.** Blocked by: 01–08.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/hooks/gate-failures.mjs`, `harness/hooks/gate-failures.d.mts`, `harness/bin/gate-failures`, `harness/lib/gate-failures/list.mjs`, `harness/lib/gate-failures/machine.mjs`, `harness/lib/README.md`, `test/unit/gate-failures-format.test.ts`, `test/contract/gate-failures-cli.test.ts` | 1 |
| 02 | `harness/hooks/gate.mjs`, `harness/hooks/tests/gate-failures.test.sh` | 2 |
| 03 | `test/failure-records.ts`, `test/failures-reporter.ts`, `test/e2e/failures-reporter.ts`, `vitest.config.ts`, `playwright.config.ts`, `test/unit/failures-reporter.test.ts`, `test/contract/failures-reporter-rerun.test.ts`, `test/fixtures/failures-reporter/` | 2 |
| 04 | `harness/lib/gate-failures/rerun.mjs`, `harness/lib/e2e-lock.cjs`, `harness/bin/wave-gate`, `harness/lib/README.md`, `test/contract/gate-failures-rerun.test.ts`, `test/fixtures/gate-failures/rerun/` | 2 |
| 05 | `harness/lib/gate-failures/report.mjs`, `scripts/quarantine-suggest.mjs`, `test/contract/gate-failures-report.test.ts`, `test/unit/quarantine-suggest.test.ts`, `test/fixtures/gate-failures/report/` | 2 |
| 06 | `harness/lib/gate-failures/export.mjs`, `harness/lib/gate-failures/import.mjs`, `harness/lib/gate-failures/transfer-common.mjs`, `test/contract/gate-failures-transfer.test.ts`, `test/fixtures/gate-failures/transfer/` | 2 |
| 07 | `docs/adr/<NNNN>-failure-records-and-solo-rerun.md`, `docs/adr/0086-pc-gate-full-once-per-wave.md`, `harness/skills/epic-wave/SKILL.md` | 3 |
| 08 | `docs/features/gate-and-github.md`, `docs/features/ru/gate-and-github.md` | 4 |
| 09 | `.scratch/worfy-failures/spec.md` | 5 |
| 10 | `harness/hooks/gate-failures.mjs`, `harness/lib/gate-failures/rerun.mjs`, `test/unit/gate-failures-format.test.ts` | 3 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01.** Формат и каркас: всё остальное его импортирует. Стартует после merge `worfy-evidence` 02 (Wave 1
  того Epic-а): `scrub` стоит на его `harness/lib/privacy.cjs`.
- **Wave 2 — 02, 03, 04, 05, 06.** Все ждут только 01. Общих файлов нет: 02 — gate, 03 — test-ы и конфиги worfy,
  04–06 — свои модули подкоманд и свои папки fixture; `harness/lib/README.md` правят 01 и 04 в разных Wave (папки разные, `filesOverlap`,
  `src/shared/workflow/waves.ts:158`, их не пересекает). Каждый проверяется на fixture-записях формата 01, без
  соседей.
- **Wave 3 — 07, 10.** Процесс описывается по готовым командам. 10 (пути Windows в `scrub()`) найден в Wave 2: Ticket 04 упал на Windows, у 07 общих файлов с ним нет.
- **Wave 4 — 08.** **Wave 5 — 09** — владелец.

## Не в этом Epic-е

- **LLM-классификация причин** (идея 5 PR #1314 целиком): группы по смыслу ошибки, «вероятная причина». Нужен
  платный eval и решение владельца с ценой; модель не судит записи.
- **Dashboard и UI в worfy**: экран flaky test-ов, причина красного в бейдже Gate. worfy пока только читает verdict;
  записи можно показать позже — их формат для этого и сделан машинным.
- **CI как источник**: job-ы CI печатают FLAKY-строки (`test/flaky.ts:8-16`) и хранят свои artifacts; копировать их
  в записи — дублировать CI.
- **Авто-правка**: ни одна команда не пишет `test/quarantine/`, test-ы, Harness, Profile или issue сама.
- **Связь с Flight Recorder** (записи на шкале Run) и с Journal Autopilot.
- **История FR 06 и 28** (прошлые Run, вкладка «Runs») — это история Run-ов, не группировка падений; не трогается.

## Риски

1. **Проект без reporter-ов** даёт только записи шагов: «`test` упал, первая строка — …». Отчёт для него беднее, но
   честный; `docs` это называет.
2. **Повтор e2e долгий.** 60 упавших e2e test-ов по 10–60 с — до часа. `rerun` принимает `--file`, `--limit` и
   печатает оценку по `ms` записей до старта.
3. **`out/` не того SHA.** Повтор Playwright идёт по собранному приложению; `rerun` отказывает (exit 3), если HEAD не
   равен `head` записи или дерево грязное, но `out/` от другой сборки он не видит. Порядок 07: повтор сразу после
   gate full, в том же worktree.
4. **Утечка в публичный репозиторий** (случай docs PR #1306: имя пользователя, hostname, UUID в путях). Защита в
   два слоя: очистка при записи и проверка при export; test приватности — в 01 и 06. Что не ловится: имя, которое
   test сам печатает в своём сообщении без пути (например, имя ветки), — `docs` это называет.
5. **Переименованный test** начинает новую историю: id — файл и имя без строки.
6. **«Зелёный поодиночке» не значит «здоров»**: под нагрузкой он снова упадёт. Это и есть flaky по ADR-0086; лечит
   причину Ticket карантина, не этот Epic.
7. **Зависимость от `worfy-evidence` 02** (`harness/lib/privacy.cjs`): пока он не влит, Ticket 01 не стартует. Если
   тот Epic отложат, 01 выносит шаблоны в `privacy.cjs` сам — по решению Orchestrator-а, не молча.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-failures/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина ревью — по общему правилу; 02 (gate) —
  `high`: gate читают все проекты и hooks.
- Сначала падающий test. Без токенов: ни один test не запускает настоящий Claude или Codex; `gh` — stand-in через
  `WORFY_GH`/`PATH`; состояние gate — временная папка через `CLAUDE_GATE_STATE`, Harness home — `HARNESS_HOME` во
  временной папке; настоящая `~/.claude` не пишется.
- Скрипты Harness — Node, без shell-утилит, одинаково на macOS, Linux и Windows (ADR-0054, ADR-0055). Код и текст
  Harness — только по-английски (ADR-0074); русский — только здесь, в документах Epic-а.
- worfy и Harness ничего не пишут в репозиторий Project-а (ADR-0005): записи — в папке состояния gate. Silent mode: в
  записях и в блоке export нет номеров Ticket-ов, имён Epic-ов и путей Workflow folder.
- Репозиторий публичный: в workflow нет секретов и `pull_request_target`, runner-ы только бесплатные. CI: медиана PR ≤
  15 мин; e2e — по таблице путей `scripts/ci-scope.mjs`; правка `playwright.config.ts` (03) включает полный e2e один
  раз — это допустимо.
- Timeout-ы test-ов не подстраиваются по одному (`rules.md` Profile-а); flaky test лечат причиной.
- Агенты не оставляют фоновых процессов: contract test-ы `rerun` ждут конца каждого дочернего процесса.
- Низкие находки ревью не становятся Ticket-ами. Карантин — только с владельцем Ticket-а и сроком (`test/quarantine.ts`).
- ADR (07) — номер выдаёт Orchestrator при claim по `rules-adr.md` Profile-а. PR в `harness/` — после merge `pnpm
  install:stable` и Replace Harness, как у других Ticket-ов Harness.

## Новые термины (предложение для CONTEXT.md)

- **Failure record** — запись о падении одного test-а (или script-а без test-ов) в одном run-е gate: test, шаг, SHA,
  компьютер, платформа, время, первая строка ошибки, команда повтора. _Avoid_: лог ошибки, failure log.
- **Solo rerun** — повтор одного упавшего test-а поодиночке на том же SHA, чтобы отличить flaky test от стабильно
  красного. _Avoid_: перепрогон, retry (retry — повтор внутри run-а в CI).

## Готово, когда

- [ ] Красный gate fast и gate full на worfy оставляют файл run-а с записью на каждый упавший test vitest и
      Playwright и записью на упавший script без test-ов; остановленный run не оставляет ничего; verdict, маркеры и
      коды выхода gate не изменились.
- [ ] `gate-failures rerun` повторяет упавшие test-ы поодиночке на том же SHA и пишет файл повтора; на другом SHA или
      грязном дереве — отказ с кодом 3.
- [ ] `gate-failures report` печатает flaky, стабильно красные и без повтора по run-ам обеих машин, с «под
      нагрузкой»; `scripts/quarantine-suggest.mjs` печатает записи в формате `test/quarantine/` и ничего не пишет.
- [ ] Записи ПК доходят до Mac `export` → `import` без пересказа; в блоке export нет путей домашней папки, имён
      пользователя, hostname, UUID, email и токенов (test приватности).
- [ ] Порядок ПК → Mac записан в ADR и skill `epic-wave`; правила Profile обеих машин поправлены (по решению Q3).
- [ ] Раздел «Failure records» в `docs/features/gate-and-github.md` и переводе.
- [ ] Приёмка владельца на Mac и Windows-ПК (09).
