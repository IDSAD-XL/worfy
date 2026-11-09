# 63 — `land` и `epic-wave` сливают PR без rebase ради свежей базы

Type: task
Status: open
Blocked by: 62
Source: решение владельца 2026-11-09, Q1 и Q4 (ответ на «Итог» Ticket-а [62](62-merge-queue-или-ci-пачками.md));
[ADR-0103](../../../docs/adr/0103-merge-without-rebase-for-a-fresh-base.md), пункты 1 и 2; продолжение 2 из «Итог»,
часть 5, Ticket-а 62.

## Что происходит

- ADR-0103: PR с зелёным `ci-ok` и отметкой `review` `success` на своём head и без конфликта вливается, даже если
  `main` ушёл вперёд кодом. Rebase — только когда GitHub сообщает конфликт (`mergeable` `CONFLICTING` или
  `mergeStateStatus` `DIRTY`).
- `harness/bin/land` на `BEHIND` не вливает, а ждёт с причиной «BEHIND: the base moved, rebase the PR».
- Skill `epic-wave` велит rebase на `BEHIND` и на любую сдвинутую базу («Merge in turn across machines»), а в разборе
  вывода `land` — «`DIRTY` or `BEHIND` — the implementer rebases».
- Branch protection `main` — `strict: false`, поэтому GitHub, по-видимому, принимает merge PR в `BEHIND`. Это не
  проверено: замер Ticket-а 62 видел только, что `BEHIND` приходит редко.

## Что делаем

1. Проверить на GitHub, что `gh pr merge --squash --match-head-commit <head>` вливает PR в состоянии `BEHIND` при
   `strict: false`, и что `mergeStateStatus` у такого PR при зелёном `ci-ok` — `BEHIND`, а не `BLOCKED`. Факт и
   команды с exit code — в «Итог». Если GitHub не вливает — остановиться и спросить Orchestrator-а.
2. `harness/bin/land`: `BEHIND` без конфликта — merge, как `CLEAN`; ждать только на `CONFLICTING` и `DIRTY`.
   Комментарий в начале файла — так же. Shell test в `harness/bin/tests/land.test.sh`: `BEHIND` вливается, `DIRTY`
   ждёт.
3. Skill `epic-wave`: убрать rebase ради свежей базы — строку `mergeStateStatus` в блоке merge, абзац «Merge in turn
   across machines», описание `land` и разбор его вывода. Rebase остаётся только на конфликт. Если правило зависит
   от проекта — поле Profile-а и строка в `harness/profiles/README.md`; иначе — общее правило.
4. `harness/bin/wave-gate` — только прочитать: `mergeStateStatus` он не смотрит (комментарий в начале файла), правка
   не нужна; если окажется нужна — сказать в «Итог».

Платформенный PR (ADR-0056): правит скрипт Harness. Windows verdict — job Windows в составе `ci-ok` на head PR.

## Готово, когда

- [ ] «Итог»: GitHub вливает PR в `BEHIND` при `strict: false` — команда, ответ и exit code.
- [ ] `land` вливает PR в `BEHIND` с зелёным `ci-ok` и `review`; на `CONFLICTING` и `DIRTY` ждёт — shell test.
- [ ] В `harness/skills/epic-wave/SKILL.md` нет rebase ради свежей базы; rebase — только на конфликт.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR (в нём job Windows).

## Где в коде

- `harness/bin/land:25` — комментарий «CONFLICTING, DIRTY or BEHIND — the PR waits».
- `harness/bin/land:389-390` — `mergeOne`: `DIRTY` и `BEHIND` бросают `Wait`; `:392` — `gh pr merge … --match-head-commit`.
- `harness/bin/tests/land.test.sh:351-372` — test «BEHIND and DIRTY wait».
- `harness/skills/epic-wave/SKILL.md:884` — «BEHIND — rebase (below)».
- `harness/skills/epic-wave/SKILL.md:888-896` — «Merge in turn across machines»: rebase на `BEHIND` и на сдвинутую базу.
- `harness/skills/epic-wave/SKILL.md:1183` — описание `land`: «`CONFLICTING`, `DIRTY` or `BEHIND` — the PR waits».
- `harness/skills/epic-wave/SKILL.md:1251` — «`DIRTY` or `BEHIND` — the implementer rebases».
- `harness/bin/wave-gate:19` — только чтение: `mergeStateStatus` не смотрит.

## Вне скоупа

- `rules-merge.md` Profile-а worfy — правит Orchestrator после merge ADR-0103 (Profile вне репозитория).
- Красный `main` и пауза merge — Ticket 64.
