# 58 — `gate.sh` без node пишет marker и verdict на `--help` и неизвестный профиль

Type: bug
Status: open
Blocked by: 55
Source: ревью PR #596 (worfy-harness 55), линза корректности, 2026-10-20 — находка вне diff-а.

## Что происходит

Ticket 55 научил `harness/hooks/gate.mjs` отвечать на `--help` / `-h` справкой (exit 0) и на
неизвестный профиль — exit 2, ничего не записывая в папку состояния. Но shim `harness/hooks/gate.sh`
проверяет node раньше, чем аргументы:

- без node (или со слишком старым node) `gate.sh --help` и `gate.sh <неизвестный профиль>` идут по
  ветке «не проверено» (`gate.sh:77`, `:167-180`): пишут marker `nokey-broken-*` и перезаписывают
  `verdict-<tag>.json` значениями «профиль `--help`, outcome unverified»;
- значит, gate.sh и gate.mjs для одних и тех же аргументов оставляют разные файлы, хотя
  `harness/hooks/tests/gate-shim.test.sh` проверяет, что их поведение совпадает.

На машине без node 18 Harness всё равно не работает, поэтому приоритет низкий; вред — лишний verdict,
который перекрывает настоящий.

## Что делаем

1. `gate.sh` разбирает `--help` / `-h` и проверяет имя профиля так же, как `gate.mjs` (fast, full или
   ключ записи реестра), до ветки «нет node»; при нечитаемом реестре — как `gate.mjs`.
2. `gate-shim.test.sh` — случаи без node: `--help` → exit 0, ничего в папке состояния; неизвестный
   профиль → exit 2, ничего в папке состояния; совпадение с `gate.mjs`.

## Готово, когда

- [ ] Без node `gate.sh --help` — exit 0 и справка; `gate.sh nosuch` — exit 2; в папке состояния нет
      новых файлов. Test-ы — в `gate-shim.test.sh`, красные на main.
- [ ] Мутант «проверка аргументов в gate.sh убрана» — красный.
- [ ] `bash harness/hooks/tests/gate-shim.test.sh`, `gate-args.test.sh`, `plugin-neutral.test.sh` —
      exit 0 с временными `HOME` и `HARNESS_HOME`.

## Где в коде

- `harness/hooks/gate.sh` — `:70`, `:77`, `:167-180`.
- `harness/hooks/gate.mjs` — проверка профиля (после PR #596).
- `harness/hooks/tests/gate-shim.test.sh`, `harness/hooks/tests/gate-args.test.sh`.

## Риски

- Платформенный PR (`harness/hooks`): после Mac gate нужен Windows verdict.

## Итог

Заполняется при закрытии.
