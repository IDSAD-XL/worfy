# 88 — Flaky test: в `e3-sandbox.test.ts` два run-а `lock-run` держат lock одновременно

Type: bug
Status: open
Blocked by: —
Source: CI run 42741932918 (PR #1763, ветка `worfy-multi-repo-ticket/06`, job `linux-tests (4/4)`, 2026-11-10T02:23Z).
Изменения PR-а этого test-а и `scripts/e3-sandbox.sh` не касались. Раньше тот же test дал строку FLAKY (упал, прошёл
на retry) в CI run 42711434694 (ветка `worfy-multi-repo-ticket/04`, `linux-tests (4/4)`, 2026-11-09T22:26Z). Строки
перечитаны по main `100acec94`.

## Что происходит

`test/contract/e3-sandbox.test.ts:1114` — test «two runs that find the same abandoned lock do not both take it: the
one that removed it pauses first». Два `lock-run` (`first` и `second`) находят один брошенный lock (папка с mtime
31 минуту назад, :1191). Stand-in-ы `rmdir` (:1138) и `sleep` (:1149) ждут друг друга через файлы-метки в
`<scratch>/race`, так что порядок шагов не зависит от скорости машины. Команда под lock-ом (`under-lock.sh`, :1164)
пишет `enter <run>` и `exit <run>` в общий log.

В CI упали обе попытки (первая и retry). Проверка на :1202:

```
AssertionError: expected [ [ 'enter first', …(3) ], …(1) ] to deep equally contain [ 'enter first', 'enter second', …(2) ]
AssertionError: expected [ [ 'enter first', …(3) ], …(1) ] to deep equally contain [ 'enter second', 'enter first', …(2) ]
```

То есть log был `enter first, enter second, exit second, exit first` (во второй попытке — наоборот): второй run
вошёл под lock, пока первый его держал. Файла `stuck` не было (проверка на :1194 прошла), оба run-а вышли с
exit code 0. Это ровно тот случай, от которого test охраняет: `lock_run` в `scripts/e3-sandbox.sh:376` берёт lock
через `mkdir`, а брошенный lock снимает `rmdir` с паузой перед новой попыткой (:379–387). Пока неизвестно, где
дыра: в самом `lock_run` (тогда это настоящая ошибка lock-а e2e-песочницы, а не flaky test) или в порядке
stand-in-ов test-а.

## Что делаем

- Сначала воспроизвести и понять: прогнать один этот test много раз (например, 200) под нагрузкой, похожей на
  `linux-tests` (параллельный полный `pnpm test` или `stress`), на Linux и на Mac. Сохранить при падении весь
  `<scratch>/race` (метки, `log`, `*.pauses`) и порядок событий. Счёт падений и найденная последовательность — в
  «Итог».
- По найденной последовательности решить, чья ошибка:
  - дыра в `lock_run` — исправить скрипт так, чтобы два run-а не держали lock одновременно; test остаётся как есть
    и должен ловить старую версию скрипта;
  - дыра в stand-in-ах — закрыть её в порядке меток test-а так, чтобы test по-прежнему краснел без паузы в
    `lock_run` (проверить, убрав паузу: test должен упасть).
- Пределы времени test-а (`ms(120_000)`, 90 s на run) не поднимаем: test падает не по времени.

## Готово, когда

- [ ] Причина названа одной последовательностью шагов двух run-ов; она и счёт падений до исправления — в «Итог».
- [ ] `node scripts/vitest-electron.mjs test/contract/e3-sandbox.test.ts -t "abandoned lock"` 200 раз подряд под
      нагрузкой — 0 падений; команда и счёт — в «Итог».
- [ ] С `lock_run` без паузы после `rmdir` брошенного lock-а test красный (mutation-проверка, результат — в «Итог»).
- [ ] Пределы времени test-а не изменены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `test/contract/e3-sandbox.test.ts:1114` — test; :1138 — stand-in `rmdir`; :1149 — stand-in `sleep`;
  :1164 — `under-lock.sh`; :1191 — брошенный lock; :1202 — проверка порядка в log.
- `scripts/e3-sandbox.sh:376` — `lock_run`; :379–387 — цикл `mkdir`, снятие брошенного lock-а и пауза;
  :372 — `mtime_of`.

## Вне скоупа

- Остальные test-ы `e3-sandbox.test.ts` и heartbeat lock-а.
- Остальные flaky test-ы из таблицы `worfy-polish` 66.
