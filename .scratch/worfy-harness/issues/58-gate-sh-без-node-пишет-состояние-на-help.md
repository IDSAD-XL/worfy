# 58 — `gate.sh` без node пишет marker и verdict на `--help` и неизвестный профиль

Type: bug
Status: done 2026-10-21T01:35Z
PR: #636
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

PR [#636](https://github.com/IDSAD-XL/worfy/pull/636), merge 03d8c856. Gate full Mac на main cd6d4f30 зелёный; Windows verdict
(check/windows) на e2ae41ed зелёный, включая gate-shim через vitest. Платформенный PR. Ревью: три круга (круг 1 high —
корректность и тесты PASS с low; круг 2 medium — PASS с двумя low; круг 3 их исправил).

- **gate.sh без node** разбирает аргументы до записи состояния так же, как `gate.mjs`: `--help`/`-h` — usage, exit 0;
  неизвестный профиль — usage на stderr, exit 2. Известный профиль — `fast`, `full` или ключ `root`/`workspace` любой
  записи реестра.
- **Реестр без node** читает строгий разборщик JSON на POSIX awk (`registry_names`, `LC_ALL=C`, имя через `ENVIRON`).
  Он отказывает имени только при корректном JSON без такого профиля; не JSON, нет реестра, нечитаемый файл, байт NUL
  (проверка `LC_ALL=C tr -d '\000'` + `wc -c`), нет awk — имя проходит, как в `gate.mjs`. Путь реестра — как в
  `gateConfigFile` (CLAUDE_GATE_CONFIG, HARNESS_HOME, EVAL_HARNESS_HOME, старый путь). Ревьюер сверил 22 случая на BSD awk,
  mawk 1.3.4, busybox и gawk 5.2.1 — совпадают; Windows (awk Git Bash) — первый настоящий прогон, зелёный.
- **Текст usage** — две копии (gate.sh и gate.mjs); test сверяет вывод побайтно.
- **Test-ы** (`gate-shim.test.sh`, раздел 8): сравнение с `node gate.mjs` по коду выхода, stdout и stderr; таблица решений
  реестра (ключи с escape-ами, суррогаты, CRLF, повторы ключей, вне git); старые marker и verdict переживают `--help`.
  Все мутанты ревьюеров красные.
- **Красный gate full на первом head** (вне кода gate.sh): под UTF-8 локалью vitest-electron BSD `tr` самого test-а
  останавливался на байтах lone surrogate («Illegal byte sequence»). Правка — обёртка `tr` test-а в `LC_ALL=C` и `type -P`
  в подборе инструментов PATH без node; gate-shim зелёный при LANG не задан и en_US.UTF-8.
- **Предел (`shortcut:` в gate.sh):** байты не UTF-8 сравниваются как байты, а node читает U+FFFD.
- **Вне diff (low, не делали):** `EVAL_HARNESS_HOME` вида `\abs` на Windows gate.sh считает относительным, node — абсолютным.
