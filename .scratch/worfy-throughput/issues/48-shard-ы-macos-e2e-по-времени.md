# 48 — Shard-ы macOS e2e по измеренному времени spec-файлов, а не по числу test-ов

Type: task
Status: claimed 2026-10-29T01:17Z
Branch: worfy-throughput/48
Blocked by: 35
Source: договорённость моста и Orchestrator-а 2026-10-29: делить по замеру нескольких run-ов `main`, а не одного;
Ticket 15 (PR #935) правит `linked-reconnect.spec.ts` и `no-overlap.spec.ts` и немного сдвинет их вес — таблицу
после него можно обновить, на разбиение это почти не влияет. Замер scout-а по run-ам 40770425114, 40774924657,
40779578337, 40784795223, 40788089367 (push в `main`, все зелёные).

## Что происходит

Job `macos-e2e` (`.github/workflows/ci.yml`) идёт в 2 shard-ах через `pnpm test:e2e --shard=<i>/2`. Это встроенное
разбиение Playwright: по числу test-ов (170 и 167), не по времени. В CI один worker (`playwright.config.ts`,
`fullyParallel: false`), spec-файл идёт целиком в одном worker-е.

Тяжёлые файлы почти все попали в shard 1: `linked-machines` 66,7 s (медиана), `linked-reconnect` 54,3, `epic-frame`
54,2, `browser` 53,4, `terminal` 47,3. За 5 run-ов `main` shard 1 шёл 900–1121 s, shard 2 — 696–925 s. Сумма медиан по
112 файлам — 1686 s; постоянная часть job-а (install, сборка) — около 50–90 s на shard. Самый долгий shard держит
каждый push в `main` и каждый PR, который трогает приложение.

## Что делаем

1. **Таблица времени** `test/e2e/timings.json`: spec-файл → медиана секунд по 5 run-ам выше (сумма длительностей
   test-ов файла, как их печатает list reporter). Run-ы — в поле `runs`.
2. **Скрипт** `scripts/e2e-shard.mjs <i>/<n> [<spec-файлы> …]`: печатает файлы shard-а i. Жадное разбиение: файлы по
   убыванию секунд (при равенстве — по имени), каждый — в самый лёгкий shard (при равенстве — в младший). Файл, которого
   нет в таблице, получает медиану таблицы; запись таблицы без файла не учитывается. Пустой shard — ошибка (код 1):
   `pnpm test:e2e` без файлов запустил бы все.
3. **Выбор файлов PR из #927.** #927 (`scripts/ci-scope.mjs`) решает только, нужен ли `macos-e2e` PR-у; подмножества
   e2e-файлов он не передаёт. Поэтому в CI делится полный список. Скрипт принимает подмножество аргументами: когда
   CI начнёт передавать его, делиться будет оно.
4. **CI:** шаг `Pick the spec files of this shard` пишет `files` в `GITHUB_OUTPUT`, шаг `Run the e2e tests, one shard`
   запускает `pnpm test:e2e $FILES`. Shard-ов по-прежнему 2. `scripts/e2e-shard.mjs` добавлен в `APP_FILES`
   `ci-scope.mjs`: его правка запускает `macos-e2e` на PR.
5. **Unit test** `test/unit/e2e-shard.test.ts`.

Нужен ПК: нет. Трогает Harness: нет. Вердикт Windows: в diff есть `test/e2e/timings.json`, то есть `test/e2e/**` —
`scripts/windows-verdict-scope.mjs` относит такой PR к `pc`; кода e2e в нём нет, решение — за Orchestrator-ом.

## Готово, когда

- [ ] `test/e2e/timings.json` — медианы по 5 run-ам, run-ы записаны в файле.
- [ ] `node scripts/e2e-shard.mjs 1/2` и `2/2` печатают по 56 файлов, ожидаемо по 843 s test-ов из 1686.
- [ ] Unit test: каждый spec-файл ровно в одном shard-е при n = 1, 2, 3; результат детерминирован; неизвестный файл
      получает медиану; два shard-а текущей таблицы расходятся меньше чем на 10 % суммы; подмножество делится само,
      а не полный список.
- [ ] `ci.yml` передаёт каждому shard-у его список; `pull_request_target` нет, secrets нет, `persist-credentials:
      false`, сторонние action-ы по sha, как сейчас.
- [ ] Время двух shard-ов `macos-e2e` в CI run-е PR — в «Итог».

## Где в коде

- `.github/workflows/ci.yml` — job `macos-e2e`.
- `scripts/e2e-shard.mjs` — новый.
- `test/e2e/timings.json` — новый.
- `scripts/ci-scope.mjs` — `APP_FILES`.
- `test/unit/e2e-shard.test.ts` — новый; `test/contract/ci-workflow.test.ts` — команды `macos-e2e` и пути, которые
  запускают его на PR.

## Вне скоупа

- Третий shard macOS e2e (третий macOS job на PR): решение владельца — бесплатный план даёт 5 macOS job-ов сразу.
- Windows e2e (`windows-e2e`, 4 shard-а через `--shard`): не трогаем.
- Режим `--write-timings` в `scripts/test-timings.mjs`: отчёт `e2e-report.json` в CI сохраняется только при падении
  (`upload-artifact` с `if: failure()`), а локальный run на Mac идёт в 3 worker-а и даёт другие секунды. Как обновить
  таблицу — в «Итог».

## Итог
