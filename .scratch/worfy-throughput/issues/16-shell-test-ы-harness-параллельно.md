# 16 — Shell test-ы Harness идут параллельно: `harness-scripts.test.ts` больше не держит весь `pnpm test`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-20: скорость test-ов»; замер
Ticket-а [10](10-время-шагов-gate-и-test-файлов.md) (PR #620): на Mac gate fast шёл 531,8 s, из них
`test` — 519 s, а `test/contract/harness-scripts.test.ts` — 517 s, то есть весь wall time `pnpm test`.
Решение владельца 2026-10-20 — «да» на отдельный Ticket до 11–13.

## Что происходит

- `test/contract/harness-scripts.test.ts` (108 строк) находит все `harness/{bin,hooks}/tests/*.test.sh`
  (48 файлов на `f6d9d7da`) и запускает их внутри одного vitest-файла через `spawnSync`, один за другим.
- vitest распараллеливает только между файлами. Остальные 340 файлов заканчиваются раньше, и
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

- Каждый `harness/{bin,hooks}/tests/*.test.sh` запускается ровно один раз за `pnpm test`; test проверяет,
  что ни один файл не потерян и не запущен дважды при раскладке.
- Самый длинный vitest-файл с shell test-ами идёт не дольше 150 s на Mac, по отчёту
  `scripts/test-timings.mjs` (Ticket 10); если Ticket 10 ещё не влит — по выводу vitest.
- Wall time `pnpm test` на Mac записан до и после в «Итог»; замер «после» — в слот тяжёлого run-а
  (на Mac один тяжёлый run за раз).
- Под нагрузкой полного `pnpm test` нет новых timeout-ов shell test-ов: один полный run green, и в нём
  нет повторов. Число параллельных shell test-ов ограничено, чтобы не повторить worfy-polish 32
  (`wave-gate.test.sh` дольше предела под нагрузкой).
- Windows: на ПК `pnpm test` green для этих файлов (вердикт Windows, ADR-0056); timeout на файл 300 s
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

(заполняет implementer)
