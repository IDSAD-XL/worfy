# 49 — `harness-scripts.test.ts` отдельным job-ом Windows: shard 3/3 перестаёт быть самым долгим

Type: task
Status: open
Blocked by: 35
Source: разбор моста 2026-10-29 после #942 (Ticket 47): shard 3/3 Windows шёл 825 s в run-е 40805903962, хотя #942
срезал ожидания в двух его shell test-ах.

## Что происходит

Job `windows / full-suite` (`.github/workflows/windows-tests.yml`) идёт в 3 shard-ах через `pnpm test --shard=<i>/3`.
Это встроенное разбиение vitest — по hash пути файла, не по времени. В shard 3/3 всегда попадает
`test/contract/harness-scripts.test.ts`: он запускает 49–52 shell test-а Harness через Git Bash, по 5 сразу
(`maxConcurrency: 5`, `vitest.config.ts:76`), и в каждом run-е — самый долгий файл: 354 s в быстром run-е
(40788089367), 552–617 s в медленных (40804392460, 40805903962). Рядом с ним в том же shard-е идут ещё два тяжёлых
файла: `harness-evals-outcome` (128–208 s) и `projects-connect` (58–91 s).

С 2026-10-28 у shard-а 3/3 две скорости — 436–528 s и 704–825 s, при том же списке файлов; в медленном run-е каждый
файл идёт в 1,3–2 раза дольше (вероятно, более медленный runner: однопроцессная проверка lockfile перед test-ами —
4,6–5,5 s против 6,3–9,6 s). Shard 3/3 нагружен сильнее других: три worker-а vitest и пять Git Bash сразу на runner-е
с 4 CPU, поэтому медленный runner бьёт по нему больше всего. Shard-ы 1/3 и 2/3 — 216–605 s.

Это самый долгий job у PR без macOS-job-ов (после #927 — PR только с unit-test-ами или Harness).

## Что делаем

1. **Отдельный job** для `test/contract/harness-scripts.test.ts` в `windows-tests.yml`: ещё одна запись matrix (или
   отдельный job) запускает только этот файл; shard-ы `full-suite` его исключают (`--exclude` vitest или список
   файлов). Имя job-а — по образцу существующих, `ci-ok` учитывает его так же, как три shard-а (`needs.windows.result`).
2. **Проверка, что файл не потерян:** contract test (`test/contract/ci-workflow.test.ts`) — каждый файл
   `test/unit` и `test/contract` идёт ровно в одном Windows job-е: в одном из shard-ов или в отдельном.
3. **Замер** в CI run-е PR-а: время каждого Windows job-а; ожидаемо shard 3/3 — около 300 s без этого файла, отдельный
   job — около времени самого файла.

## Готово, когда

- [ ] `harness-scripts.test.ts` идёт в своём Windows job-е, в shard-ах `full-suite` его нет.
- [ ] Contract test ловит файл, который не попал ни в один Windows job, и файл, который попал в два.
- [ ] `pull_request_target` нет, secrets нет, `persist-credentials: false`, сторонние action-ы по sha.
- [ ] Время Windows job-ов CI run-а PR-а — в «Итог», вместе со скоростью runner-а (быстрый или медленный run).

## Где в коде

- `.github/workflows/windows-tests.yml` — job `full-suite`, matrix shard-ов.
- `.github/workflows/ci.yml` — job `windows`, `ci-ok`.
- `test/contract/ci-workflow.test.ts`.
- `vitest.config.ts` — `maxConcurrency` не трогаем.

## Вне скоупа

- Разбиение Windows shard-ов по измеренному времени, как Ticket 48 для macOS e2e: отдельный Ticket, если после этого
  shard-ы разойдутся.
- `harness/bin/tests/land.test.sh` (230–317 s, 26 `sleep`): сократить его ожидания, как #942 для guard-silent —
  следующий шаг после замера этого Ticket-а.
- Linux и macOS: не трогаем.

## Итог

Заполняется при закрытии.
