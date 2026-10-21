# 66 — `wave-gate`: `guardPid` на Windows не исключает вторую проверку

Type: bug
Status: open
Blocked by: —
Source: находка ПК 2026-10-21 при работе над `worfy-windows` 72 (PR #705, замок e2e в `wave-gate`).

## Что происходит

На Windows `fs.renameSync` одного и того же пути удаётся в ОБОИХ процессах, которые делают его одновременно: libuv
переименовывает через открытый handle. Замер ПК: папка — 30 из 30 раз, файл — 22 из 30. Значит «отложить в сторону
переименованием» (rename-aside) не даёт взаимного исключения.

`guardPid` в `harness/bin/wave-gate:352` (pid-файл `<git common dir>/worfy-wave-gate.pid`) снимает устаревший pid-файл
именно так: `renameSync(file, aside)` (`:372`), потом сравнивает прочитанный текст. Две `wave-gate check`, начатые
вместе над устаревшим pid-файлом, могут обе его взять и пойти дальше параллельно.

## Что делаем

1. Красный test (на Windows): две `wave-gate check` над устаревшим pid-файлом стартуют вместе — проходит ровно одна.
2. Правка, как в `worfy-windows` 72: исключительный `mkdir <pidfile>.takeover`, под ним перечитать pid-файл и снять
   его, затем удалить `.takeover`. Устаревший `.takeover` (процесс убит) — по возрасту, как замок e2e.

## Готово, когда

- [ ] Test красный на main под Windows, зелёный с правкой; `wave-gate.test.sh` на Mac и ПК — exit 0.

## Где в коде

- `harness/bin/wave-gate` (`guardPid` `:352`, rename-aside `:372`)
- `harness/bin/tests/wave-gate.test.sh`
- Как сделано для замка e2e — PR #705 (`worfy-windows` 72); брать после его merge, чтобы не было конфликта.

## Риски

- Платформенный PR (`harness/bin`, ADR-0056): нужен Windows verdict.

## Итог

Заполняется при закрытии.
