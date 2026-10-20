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

## Готово, когда

- [ ] `wave-gate`, убитый на Windows (`taskkill /F` или `kill` из Git Bash), не задерживает следующий запуск
      дольше одного опроса замка (`WAVE_GATE_LOCK_POLL_S`).
- [ ] `wave-gate.test.sh` — exit 0 в Git Bash на ПК и на Mac; новый случай красный до правки.
- [ ] Mac gate (ADR-0056) зелёный.

## Где в коде

- `harness/bin/wave-gate:108-109`, `:114`, `:190-205` (возраст замка), `:326-385` (pid-файл), `:842-850`
- `harness/bin/tests/wave-gate.test.sh` — блок «e2e lock on signal»

## Итог

Заполняется при закрытии.
