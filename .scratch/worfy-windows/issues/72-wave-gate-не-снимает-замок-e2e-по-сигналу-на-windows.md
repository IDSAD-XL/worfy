# 72 — `wave-gate` на Windows не снимает замок e2e, когда его останавливают сигналом

Type: bug
Status: open
Blocked by: —
Source: Ticket [71](71-harness-test-sh-на-windows.md) (PR #555), 2026-10-20 — найдено при переносе
`wave-gate.test.sh` на Git Bash; проверка «e2e lock on signal» на win32 пропущена с причиной. Правка `harness/` —
свой PR с Mac gate (ADR-0056).

Приоритет — low: на Windows Wave пока не гоняют; замок не вечный, а только до порога устаревания.

## Что происходит

- `harness/bin/wave-gate` снимает замки и pid-файл в обработчике сигналов: `SIGNALS = { SIGHUP, SIGINT,
  SIGTERM }` (`:114`), `process.on(sig, …)` (`:842-845`) — «A signal is a broken-off run: … the locks go».
- На Windows node не получает SIGTERM от другого процесса: `process.kill(pid, 'SIGTERM')` и `kill` из Git Bash
  завершают процесс сразу, обработчик не выполняется. Из названных сигналов на Windows приходят только SIGINT
  (Ctrl+C в консоли) и SIGHUP (закрытие окна консоли); ещё бывает SIGBREAK (Ctrl+Break), его в списке нет.
- Итог: остановленный так `wave-gate` оставляет каталог замка e2e (`workflow.e2e_lock`). Следующий запуск ждёт,
  пока замок не устареет по возрасту: `WAVE_GATE_LOCK_STALE_S`, по умолчанию 1800 s (`:108`, проверка `:199-200`).
  Замок main (`:109`) — так же, 5400 s.
- Test `wave-gate.test.sh` «e2e lock on signal: exit 3, lock gone» на win32 после Ticket-а 71 пропускается с
  этой причиной; на macOS и Linux идёт.

## Что делаем

1. Замок e2e (и main) хранит pid владельца, как pid-файл (`:326-385` — захват устаревшего по pid). Ждущий
   `wave-gate` считает замок брошенным сразу, если процесса с этим pid нет, а не только по возрасту.
2. На win32 добавить SIGBREAK в `SIGNALS` — Ctrl+Break тоже снимает замки.
3. Test: замок с pid несуществующего процесса снимается без ожидания `stale`, на всех системах; проверка «e2e
   lock on signal» на win32 заменяется этим случаем (или остаётся пропуском только для самого SIGTERM).
4. pid на Windows — это pid Windows, а не MSYS. `process.kill(pid, 0)` (`harness/bin/wave-gate:333`) на Windows не
   смотрит на два младших бита pid: на ПК pid живого node плюс 2 отвечает «жив». В Git Bash `$!` — pid MSYS, не
   Windows, и он может попасть рядом с живым процессом Windows. Отсюда flaky test `wave-gate.test.sh` «pid dead»
   (`:434-438`, `sleep 0 & dp=$!`): 1 красный из 125 в прогоне файла отдельно на 5835f33f, 2026-10-20, и зелёный в том
   же файле внутри `harness-scripts.test.ts`. Пункт 1 (pid владельца в замке) — та же проверка, поэтому и pid-файл, и
   замок берут pid Windows: в test-е — из `/proc/<pid>/winpid` или `ps -W`; `wave-gate` пишет свой `process.pid`, он
   уже pid Windows. Сначала test, красный до правки: pid-файл с pid, который на 1–3 больше pid живого процесса
   Windows, — `wave-gate` должен считать его мёртвым (или test берёт winpid завершённого `sleep`). Случай «pid live»
   (`:428-431`, `$sp`) проверить так же: он зелёный на ПК, но опирается на тот же pid MSYS.

## Готово, когда

- [ ] `wave-gate`, убитый на Windows (`taskkill /F` или `kill` из Git Bash), не задерживает следующий запуск
      дольше одного опроса замка (`WAVE_GATE_LOCK_POLL_S`).
- [ ] `wave-gate.test.sh` — exit 0 в Git Bash на ПК и на Mac; новый случай красный до правки.
- [ ] Mac gate (ADR-0056) зелёный.
- [ ] «pid dead» и «pid live» в `wave-gate.test.sh` берут pid Windows; 5 прогонов файла подряд в Git Bash — без
      красного.

## Где в коде

- `harness/bin/wave-gate:108-109`, `:114`, `:190-205` (возраст замка), `:326-385` (pid-файл), `:842-850`
- `harness/bin/tests/wave-gate.test.sh` — блок «e2e lock on signal»

## Итог

Заполняется при закрытии.
