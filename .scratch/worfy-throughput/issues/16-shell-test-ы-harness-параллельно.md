# 16 — Shell test-ы Harness идут параллельно: `harness-scripts.test.ts` больше не держит весь `pnpm test`

Type: task
Status: claimed 2026-10-20T18:35Z
Branch: worfy-throughput/16
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов»; замер
Ticket-а [10](10-время-шагов-gate-и-test-файлов.md) (PR #620): на Mac gate fast шёл 531,8 s, из них
`test` — 519 s, а `test/contract/harness-scripts.test.ts` — 517 s, то есть весь wall time `pnpm test`.
Решение владельца 2026-10-20 — «да» на отдельный Ticket до 11–13.

## Что происходит

- `test/contract/harness-scripts.test.ts` (108 строк) находит все `harness/{bin,hooks}/tests/*.test.sh`
  (38 файлов на `f6d9d7da`, 39 после PR #620) и запускает их внутри одного vitest-файла через `spawnSync`, один за другим.
- vitest распараллеливает только между файлами. Остальные 347 файлов заканчиваются раньше, и
  `pnpm test` ждёт этот один файл: wall 517,2 s при сумме по файлам 1443,6 s.
- Следующий по длине файл — `test/contract/harness-evals.test.ts`, 108,5 s. Если shell test-ы идут
  параллельно, `pnpm test` упирается в него: оценка — около 110–150 s вместо 520 s. Оценка не проверена.

## Что делаем

1. Замер: время каждого `*.test.sh` по отдельности (под `nice -n 10`, по одному файлу). Записать в «Итог».
2. Shell test-ы идут параллельно, а не один за другим. Способ выбирает implementer и пишет причину в PR:
   - несколько vitest-файлов (`harness-scripts-1.test.ts` … `-N`) с общим helper-ом, файлы `.test.sh`
     раскладываются по ним с балансом по времени из пункта 1 или по стабильному правилу;
   - или async `spawn` + `it.concurrent` с ограничением `maxConcurrency`.
   Новый `.test.sh` подхватывается сам, без правки списка руками.
3. Всё, что сейчас делает файл, сохраняется: пустой временный `HOME`/`USERPROFILE`, Git Bash на Windows
   (`test/git-bash.ts`), пропуск zsh-test-ов на Windows, проверка команд на PATH, `MIN_TESTS`, timeout на
   файл, хвост вывода в сообщении об ошибке.

## Готово, когда

- [ ] Каждый `harness/{bin,hooks}/tests/*.test.sh` запускается ровно один раз за `pnpm test`; test проверяет,
  что ни один файл не потерян и не запущен дважды при раскладке.
- [ ] Самый длинный vitest-файл с shell test-ами идёт не дольше 150 s на Mac, по отчёту
  `scripts/test-timings.mjs` (Ticket 10); если Ticket 10 ещё не влит — по выводу vitest.
- [ ] Wall time `pnpm test` на Mac записан до и после в «Итог»; замер «после» — на Mac, когда
  параллельно не идёт другой `pnpm test` или gate.
- [ ] Под нагрузкой полного `pnpm test` нет новых timeout-ов shell test-ов: один полный run green, и в нём
  нет повторов. Число параллельных shell test-ов ограничено, чтобы не повторить worfy-polish 32
  (`wave-gate.test.sh` дольше предела под нагрузкой).
- [ ] Windows: на ПК `pnpm test` green для этих файлов (вердикт Windows, ADR-0056); timeout на файл 300 s
  остаётся.

## Где в коде

- `test/contract/harness-scripts.test.ts` — сейчас весь запуск.
- `test/git-bash.ts`, `test/remove.ts` — helper-ы, которыми он пользуется.
- `harness/bin/tests/*.test.sh`, `harness/hooks/tests/*.test.sh` — сами shell test-ы (не правим, кроме
  явной поломки при параллельном запуске).
- `vitest.config.ts` — проект `contract`, если нужен свой `maxConcurrency` или pool.

## Вне скоупа

- Ускорение самих shell test-ов и `harness-evals.test.ts` — после замера, отдельно.
- Выбор test-ов по diff (Ticket 11) и shard-ы CI (Ticket 12).

## Итог

**Замер до (пункт 1).** Каждый `*.test.sh` отдельно, по одному, под `nice -n 10`, на Mac 2026-10-20, с тем же
окружением, что даёт vitest-файл (пустой `HOME`/`USERPROFILE`, git identity из env). Все 38 — exit 0, сумма
478,1 s. Файлов 38, а не 48: 48 — число cases в vitest-файле (38 файлов и 10 проверок вокруг).

| s | файл |
| ---: | --- |
| 80,1 | bin/tests/wave-gate.test.sh |
| 58,8 | hooks/tests/guard-silent.test.sh |
| 54,2 | bin/tests/skill-blocks.test.sh |
| 44,9 | bin/tests/profile.test.sh |
| 36,7 | hooks/tests/gate-verdict.test.sh |
| 27,3 | bin/tests/silent-mode.test.sh |
| 25,5 | bin/tests/qmd-collections.test.sh |
| 22,6 | bin/tests/preflight.test.sh |
| 18,7 | bin/tests/project-connect.test.sh |
| 13,7 | bin/tests/profile-set.test.sh |
| 11,7 | bin/tests/harness-home.test.sh |
| 9,7 | bin/tests/qmd.test.sh |
| 9,0 | bin/tests/eval-env.test.sh |
| 7,1 | hooks/tests/gate-shim.test.sh |
| 5,9 | bin/tests/wave-gate-heartbeat.test.sh |

Остальные 23 файла — от 0,05 до 5,2 s.

**Способ — async `spawn` + `it.concurrent`, `maxConcurrency: 5` в проекте `contract`** (не несколько vitest-файлов):

- один список файлов: каждый файл — ровно один case по построению, без таблицы раскладки по shard-ам и без
  правила, куда класть новый файл; новый `.test.sh` подхватывается сам;
- число одновременных shell test-ов задано одним числом и не зависит от числа worker-ов vitest (на CI
  `ubuntu-latest` их мало, shard-файлы ждали бы в очереди);
- vitest 5.0.3 ставит case в очередь до начала test-а (`limitTestConcurrency` вокруг `runTest`), поэтому
  timeout файла считается от его собственного старта;
- порядок: восемь файлов дольше 20 s идут первыми (`RUN_FIRST`, с проверкой, что каждое имя существует),
  остальные — по имени. Модель по замеру: 5 сразу в этом порядке — около 98 s, по имени — около 120 s; 4 сразу —
  121 s, 6 — 82 s.

Проверки в `test/contract/harness-scripts.test.ts`: «gives every shell test file exactly one case» (список cases
— перестановка найденных файлов), «orders files without losing or repeating one» (чистая функция порядка),
«lists in RUN_FIRST only files that exist», `afterAll` падает, если файл стартовал дважды за run (retry тоже
считается повтором). Мутанты (потеря файла, повтор файла, `--retry=1`) — красные; 5 файлов по `sleep 3` — 3,1 s,
6 — 6,1 s (предел 5 работает); падающий файл показывает код выхода и хвост вывода; зависший — «was killed after».

**Круг 2 (ревью #626).** На timeout SIGKILL получал только bash; case ждал `close`, а его держал любой потомок
(`sleep`, node), и case падал на общем timeout vitest без хвоста и без удаления временного `HOME`. Теперь на
macOS и Linux bash ведёт свою process group (`detached`), и kill идёт в группу; на Windows — `taskkill /T /F`.
Если после выхода bash вывод держит оставленный потомок, через 2 s (`CLOSE_GRACE_MS`) группа убивается и case
возвращается. Новые cases: «kills a file past its limit…» (зависший `sleep` под пределом 1 s: возврат около
1 s, сообщение «was killed after 1 s», `HOME` удалён, `process.kill(-pgid, 0)` бросает) и «returns soon after a
file exits that left a child…» (около 2 s, exit 0, потомок убит). Мутанты: kill только bash, без своей группы,
старое поведение, grace без kill — все красные.

**Ждёт слота тяжёлого run-а:** wall time `pnpm test` до и после, длина vitest-файла с shell test-ами в полном run,
gate fast. Ссылка «до» из Ticket-а 10: gate fast 531,8 s, `test` 519 s, этот файл 517 s.
