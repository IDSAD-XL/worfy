# 03 — `project-connect --remove <name>` и `--no-qmd`

Type: task
Status: done 2026-10-28T06:22Z
PR: #862
Blocked by: —
Source: решения владельца 2026-10-26, пункт 7 (удаление убирает папку, Profile и запись registry); [spec.md](../spec.md), «Решено без владельца», Р12 и Р13 (решено без владельца, подтверждено владельцем 2026-10-26); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) — скрипты Harness на Node

## Что происходит

- `harness/bin/project-connect` (Node, шапка `:1-40`) умеет только добавлять: пишет
  `$HARNESS_HOME/projects/<name>/profile.json` и `rules.md`, дописывает записи в gate registry
  `$HARNESS_HOME/gate/config.json`, делает commit в git-репозитории `$HARNESS_HOME`. При сбое на
  середине откатывает написанное.
- После записи он подключает qmd-коллекции, если qmd установлен и модели скачаны (шапка, `:16-19`).
  Отключить это нельзя.
- Удалить Project из Harness сегодня нечем: worfy убирает Project только из своего списка
  (`ProjectStore.remove`, `src/main/projects/store.ts:291-299`), Profile и записи gate registry
  остаются.
- worfy пишет в Harness только через его скрипты (ADR-0002), поэтому удаление Demo project
  (Ticket 10) нуждается в команде Harness.

## Что делаем

1. `project-connect --remove <name>`: удаляет `projects/<name>/`, все записи gate registry с
   `profile: <name>`, папку `runs/<name>/` (отметки Ticket 01), qmd-коллекции из поля `qmd` Profile-а
   (если qmd есть), одним commit-ом в `$HARNESS_HOME`. Профиля нет — exit 1 с причиной, ничего не
   тронуто. Сбой на середине откатывает, как запись.
2. Флаг `--no-qmd` к записи: шаг qmd пропускается с причиной «skipped: --no-qmd» в выводе.
3. Вывод — JSON, как у записи: `{ name, removed: { profileDir, gateKeys, runs, qmd } }`.
4. Шапка файла описывает оба режима.

## Готово, когда

- [ ] `--remove` после записи: `bin/profile -C <repo>` больше не знает репозиторий, в
      `gate/config.json` нет записей Profile-а, `projects/<name>/` и `runs/<name>/` нет, в git
      `$HARNESS_HOME` — один новый commit.
- [ ] `--remove` неизвестного имени — exit 1, файлы не тронуты; имя с `/` или `..` — exit 2.
- [ ] Сбой на шаге (по образцу `PROJECT_CONNECT_FAIL_AT`) — откат, `bin/profile` знает репозиторий, как
      до команды.
- [ ] `--no-qmd`: при установленном qmd коллекции не создаются, поле `qmd` не пишется.
- [ ] Платформенный PR (ADR-0056, пункт 2; скрипт Harness): вердикт Windows — по ADR-0071 (PR без
      окон и e2e) или gate full на ПК, код 0 и строка `[gate] green (full)`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- `harness/bin/tests/project-connect.test.sh` (песочница HOME/HARNESS_HOME, `:5-8`): запись, затем
  `--remove`; неизвестное имя; откат по `PROJECT_CONNECT_FAIL_AT`; `--no-qmd` с подменой qmd
  (`PROJECT_CONNECT_QMD`).
- Сначала падающий: `--remove` — сейчас exit 2 (неизвестный флаг).

## Где в коде

- `harness/bin/project-connect`
- `harness/bin/tests/project-connect.test.sh`

Только читать: `harness/bin/qmd-collections`, `harness/profiles/README.md`, `src/main/projects/connect.ts`
(`connectScriptRunner`, `:138`).

## Итог

- PR #862, влит 2026-10-28, второй круг — VERIFIED. `harness/bin/project-connect --remove <name>` убирает
  `projects/<name>/`, записи gate registry с `profile: <name>` и `runs/<name>/` одним commit-ом в git-репозитории
  Harness home; до commit-а папки лежат в staging-папке, сбой на полпути всё возвращает. После commit-а удаляются
  коллекции qmd Profile-а, кроме тех, что называет и другой Profile; сбой qmd ничего не откатывает. Нет такого
  Profile-а — exit 1, имя с `/` или `..` — exit 2. `--no-qmd` пропускает шаг qmd и при записи, и при `--remove`.
  Test-ы — `harness/bin/tests/project-connect.test.sh`.
- Долг (low, из VERIFIED-комментария): `harness/bin/project-connect:419` — фраза «what was not put back is kept in
  <staging>» неверна, когда не удался откат шага gate: прежний gate registry живёт только в памяти — писать его в
  `staging/gate.config.json` или убрать обещание из текста.
- **Решено без владельца (ревью #862, круг 1; подтверждено владельцем 2026-10-27):** `--remove` отказывает с exit 1 и
  ничего не трогает, если папка Workflow по умолчанию у Project-а в Silent mode
  (`projects/<name>/workflow/`) содержит что-то, кроме пустого `git init`: файлы или commit-ы. Это свой
  git-репозиторий Project-а с его Ticket-ами, история Harness его не хранит (`.gitignore`), и удалить его
  значило бы потерять их безвозвратно. Пользователь сначала переносит папку сам. Demo project работает в
  Full mode, поэтому отказ его не касается.
