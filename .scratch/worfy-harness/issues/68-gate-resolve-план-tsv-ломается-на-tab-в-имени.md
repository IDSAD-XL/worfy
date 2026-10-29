# 68 — Вывод плана `gate-resolve` — текст с tab-ами: ломается на имени папки с tab или переводом строки

Type: bug
Status: done 2026-10-29T03:49Z
PR: #945
Blocked by: —
Source: заметки PR #711 (`worfy-harness` 64), 2026-10-21.

## Что происходит

Ticket 64 сделал вход `gate-resolve.mjs` NUL-разделённым. Выход плана остался строками, разделёнными tab-ами
(`harness/hooks/gate-resolve.mjs:4-7`, печать `:221`, `:236`). Папка workspace, в имени которой есть tab или перевод
строки, ломает разбор плана в `gate.mjs`. Предупреждение «changes outside workspaces» (`:244`) печатает путь с переводом
строки на двух строках — это только вид.

## Что делаем

1. Красный test: workspace в папке с tab и с переводом строки в имени получает свой scope.
2. Выход плана — JSON (или NUL-разделённые поля); предупреждение показывает путь в кавычках с экранированием.

## Готово, когда

- [ ] Test красный на main, зелёный с правкой; test-ы gate по файлам, `plugin-neutral.test.sh` — exit 0.

## Где в коде

- `harness/hooks/gate-resolve.mjs`, разбор плана в `harness/hooks/gate.mjs`.

## Риски

- Платформенный PR (`harness/hooks`): нужен Windows verdict.

## Итог

PR [#945](https://github.com/IDSAD-XL/worfy/pull/945), ветка `worfy-harness/68`. Что изменилось:

- `harness/hooks/gate-resolve.mjs` печатает план как JSON: одна строка — один объект на пакет, поля `dir`, `name`,
  `scripts`, `fingerprint` (пути), `addedFrom`; последние три — массивы. JSON экранирует tab и перевод строки, и
  папка остаётся целой. Раньше tab резал `packages/a<tab>tab` на папку `packages/a` и пакет `tab`, и gate запускал
  `npm run pkg-axtab --workspace tab` — не тот script не в том пакете, с зелёным итогом.
- `harness/hooks/gate.mjs` читает этот план (`readPlan`). План, который gate прочитать не может (строки с tab-ами
  от старого resolver-а или JSON другой формы), — «not verified», exit 3: «printed a plan the gate cannot read».
- Папку с управляющим символом gate называет в кавычках, экранированной как JSON, — в строке scope и в label-ах
  шагов (`[gate] green (fast): x/"packages/a\ttab":check`): каждая строка gate остаётся одной строкой. Обычные папки
  печатаются как раньше.
- Предупреждение «changes outside workspaces» показывает каждый путь в кавычках, с экранированием.
- Ключ cache и вход fingerprint не изменились: старые зелёные записи cache остаются в силе.
- `--which` по-прежнему печатает `key<TAB>match<TAB>pm`: его читают `stop.mjs` и `bin/profile`, вне этого Ticket-а.

Красный → зелёный (`harness/hooks/tests/gate-scope.test.sh`, новые случаи 9 и 10):

- на `gate.mjs` и `gate-resolve.mjs` из `origin/main` a491ef2d (копия hooks через `HOOKS_DIR`): exit 1, failed 8,
  passed 21 — tab-папка вне scope и не тот script, перевод строки рвёт строку scope и строку green, предупреждение
  на двух строках, план с tab-ами и JSON другой формы дают exit 0;
- с правкой: exit 0, passed 29.
- Mutation testing тех же случаев (копия hooks): предупреждение без кавычек, `shown` без экранирования, `readPlan`
  без проверки формы, `readPlan`, который отдаёт пустой план на ошибке разбора, — каждый ловится (exit 1).

Test-ы и их exit code:

- `harness/hooks/tests/gate-args.test.sh` — 0; `gate-file-size.test.sh` — 0; `gate-log.test.sh` — 0;
  `gate-notverified.test.sh` — 0; `gate-scope.test.sh` — 0; `gate-shim.test.sh` — 0; `gate-timings.test.sh` — 0;
  `gate-unregistered.test.sh` — 0; `gate-verdict-inside.test.sh` — 0; `gate-verdict-signals.test.sh` — 0;
  `gate-verdict.test.sh` — 0 (первый run — 1: его fake resolver печатал план с tab-ами; теперь печатает JSON).
- `harness/bin/tests/profile.test.sh`, `preflight.test.sh`, `silent-mode.test.sh`, `tickets-root.test.sh`,
  `harness-home.test.sh`, `gh-override.test.sh`, `eval-env.test.sh`, `wave-gate.test.sh`,
  `plugin-neutral.test.sh` — 0.
- `pnpm lint && pnpm typecheck && pnpm test` — 0; `node harness/hooks/gate.mjs fast` — 0, `[gate] green (fast)`.
- `node scripts/windows-verdict-scope.mjs a491ef2d HEAD` — `runner`, exit 0. Случаи с tab и переводом строки на
  Windows пропускаются: имя файла там их не держит.

Review моста (корректность): одна низкая находка, исправлена в том же PR (head `b599829c`). `readPlan` принимал запись
workspace без поля `name`; пустое имя запускало его скрипты в корне репозитория и клало результат в cache как green
этого пакета. Теперь пустое имя допустимо только у корня (`dir` `"."`), `harness/hooks/gate.mjs:192-194`; новый случай
в `gate-scope.test.sh` — план без имени даёт exit 3. После правки: `gate-scope.test.sh` — 30 passed, `gate-verdict.test.sh`
— exit 0, gate fast — green. Вне скоупа: `--which` по-прежнему печатает `key<TAB>match<TAB>pm`; `match` с tab сдвинет поле
`pm` (`gate-resolve.mjs:4`, `gate.mjs:868`, `stop.mjs:138`, `bin/profile:224`).
