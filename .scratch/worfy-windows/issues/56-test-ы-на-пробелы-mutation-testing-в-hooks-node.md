# 56 — Test-ы на четыре пробела, которые mutation testing нашёл в hooks на Node

Type: task
Status: done 2026-10-19T07:50Z
PR: #504
Blocked by: —
Source: ревью PR #453 (Ticket 04, hooks Harness на Node) на Mac, круг 1, глубина high:
[комментарий ревью](https://github.com/IDSAD-XL/worfy/pull/453#issuecomment-6242822528). Mutation
testing убил 10 мутантов из 14. Четыре выживших — пробелы в test-ах; сам код ведёт себя верно.

## Что происходит

Mutation testing меняет одну строку кода и гоняет test-ы. Мутант, которого ни один test не
краснит, показывает строку без защиты. В hooks на Node таких строк четыре (main `9d21c3d6`):

- **[med] `harness/hooks/stop.mjs:97-100`.** Stop hook разбирает stdin через `JSON.parse` внутри
  `try`. Нет test-а на «красный маркер gate + stdin не JSON → exit code 2». Мутант, который здесь
  падает, выходит с кодом 0 и даёт закончить ход при красном gate. Прежний `stop.sh` такой stdin
  принимал.
- **[med] `harness/hooks/session-start.mjs:183`.** Hook выбрасывает из `rules.md` Profile-а раздел
  `## Sources` или `## Источники`. Ни один синтетический test не проверяет `## Источники`.
  `session-hooks.test.sh:70` проверяет только `## Sources`, и этот блок пропускается на машине без
  `~/.claude/gate/config.json`.
- **[low] `harness/hooks/session-end.mjs:79`.** Hook дописывает строку в
  `<Profile>/state/pending-retro.log`. Нет синтетического test-а, что два запуска дают две строки.
  Мутант, который перезаписывает файл, выживает.
- **[low] `harness/hooks/gh-token-env.mjs:56-59`.** Если stdin не JSON, hook берёт текущую папку.
  Нет test-а на этот случай и на то, что строка `export` всё равно пишется.

## Что делаем

1. `harness/hooks/tests/gate-notverified.test.sh`: случай с красным маркером gate у worktree и
   stdin не JSON (например, `not json`). Ожидание — exit code 2 и текст «The quality gate is red».
2. `harness/hooks/tests/session-hooks.test.sh`: синтетический Profile, как в случае рядом с
   `session-hooks.test.sh:183` (свои `CLAUDE_GATE_CONFIG` и `CLAUDE_PROFILES_DIR`). В его
   `rules.md` есть раздел `## Источники`. Ожидание — правила в контексте, текста `## Источники`
   нет. Случай не зависит от `~/.claude/gate/config.json`.
3. `harness/hooks/tests/session-hooks.test.sh`: синтетический случай — SessionEnd hook дважды, в
   `pending-retro.log` две строки.
4. `harness/hooks/tests/gh-token-env.test.sh`: stdin не JSON, запуск из папки, у Profile-а которой
   есть учётная запись GitHub. Ожидание — строка `export` в `CLAUDE_ENV_FILE`.

Только test-ы, код hooks не меняется. Это не платформенный Ticket в смысле ADR-0056: shell test-ы
уже идут на обеих системах.

## Готово, когда

- [ ] Каждый новый случай красный на мутанте названной строки и зелёный на коде. PR называет
      каждый мутант и его красный результат.
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh`, `bash harness/hooks/tests/session-hooks.test.sh`
      и `bash harness/hooks/tests/gh-token-env.test.sh` — exit code 0 на macOS и в Git Bash на Windows.
- [ ] Новые случаи не зовут `jq` (в Git Bash ПК его нет) и не читают настоящий
      `~/.claude/gate/config.json`.
- [ ] gate fast на Mac — exit code 0 и строка `[gate] зелено (fast)`.

## Тесты

- Мутанты, по одному на случай:
  - `stop.mjs:97-100`: без `try` вокруг `JSON.parse` — stdin не JSON бросает исключение;
  - `session-start.mjs:183`: шаблон ловит только `## Sources`;
  - `session-end.mjs:79`: `writeFileSync` вместо `appendFileSync`;
  - `gh-token-env.mjs:56-59`: без `try` вокруг `JSON.parse` — stdin не JSON бросает исключение.

## Где в коде

- `harness/hooks/tests/gate-notverified.test.sh`
- `harness/hooks/tests/session-hooks.test.sh`
- `harness/hooks/tests/gh-token-env.test.sh`

## Итог

PR #504 добавил test-ы на четыре строки, которые не сторожил ни один test: в
`harness/hooks/tests/gate-notverified.test.sh`, `harness/hooks/tests/gh-token-env.test.sh` и
`harness/hooks/tests/session-hooks.test.sh` (код hooks не менялся).

PR #504 влит 2026-10-18, merge commit `74455f70`. Head `71a53bec`: gate full на Mac — зелёный; на ПК (Git Bash) —
зелёный; `check/windows` — `success`.
