# 63 — `land` и `epic-wave` сливают PR без rebase ради свежей базы

Type: task
Status: claimed 2026-11-09T09:58Z
Branch: worfy-throughput/63
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
  - evidence: commit pass · land merges a PR behind main without a rebase for a fresh base (worfy-throughput 63) · - - · aeccb8b05
- [ ] `land` вливает PR в `BEHIND` с зелёным `ci-ok` и `review`; на `CONFLICTING` и `DIRTY` ждёт — shell test.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · aeccb8b05
- [ ] В `harness/skills/epic-wave/SKILL.md` нет rebase ради свежей базы; rebase — только на конфликт.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 · mac - · aeccb8b05
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR (в нём job Windows).
  - evidence: gate pass · `gate fast` exit 0 · mac - · aeccb8b05

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

## Итог

Проверено 2026-11-09. Настройки репозитория и branch protection не менялись, `gh pr merge` на настоящих PR не вызывался;
все вызовы GitHub API — только чтение.

### 1. Что GitHub сообщает о PR, который отстал от `main`, при `strict: false`

- `gh api repos/IDSAD-XL/worfy/branches/main/protection --jq '{strict: .required_status_checks.strict, contexts: .required_status_checks.contexts}'`
  → `{"contexts":["ci-ok"],"strict":false}`, exit 0.
- **`BEHIND` при `strict: false` GitHub не сообщает.** Доказательство — журналы `land` (149 файлов `land*.log` в
  `/private/tmp` с 2026-11-01): `land` влил 140 PR (#1319…#1725), и у 97 из них head в момент merge отставал от
  `main` (родитель squash-commit-а не предок head-а: `git merge-base --is-ancestor <sha>^1 <head>` → 1; отставание —
  медиана 3, max 32 commit-а). Старый `land` проверял `mergeStateStatus` под замком прямо перед
  `gh pr merge --squash --match-head-commit <head>` и на `BEHIND` ждал — а строка `waits: BEHIND` не встретилась ни
  разу. Значит, GitHub отдавал этим 97 PR не `BEHIND`, и `gh pr merge` их вливал (exit 0, строки `#N: merged at`).
  Сама ветка `BEHIND` в `land` до этого Ticket-а была мёртвой: она сработала бы только при `strict: true`.
- Прямого снимка «отставший PR с зелёным `ci-ok` → `CLEAN`» в этот день нет: открытые #1727, #1726, #1724 отстают от
  `main` на 1–3 commit-а, `mergeable` `MERGEABLE`, `mergeStateStatus` `BLOCKED` — `ci-ok` на их head ещё нет
  (`gh pr view <N> --json mergeStateStatus,mergeable`, `gh api repos/IDSAD-XL/worfy/compare/main...<head>`, exit 0).

### 2. Что изменено

- `harness/bin/land`, `mergeOne`: `CONFLICTING` или `DIRTY` — ждёт с причиной `conflict: rebase — the PR conflicts
  with its base (…)`; `BEHIND` без конфликта — merge, как `CLEAN`, с записью в журнал. Для `strict: true`: GitHub
  сам откажет в merge `BEHIND`, и PR ждёт с причиной `BEHIND: the base branch requires an up-to-date branch, rebase —
  gh pr merge exit …`. Проверка head-а (тот, что проверен) и повторное чтение `ci-ok` и отметок под замком не
  менялись. Exit codes 0/2/3/1 и формат строк — прежние. Комментарий в начале файла — так же.
- `harness/bin/tests/land.test.sh`: `BEHIND` + зелёный `ci-ok` вливается без rebase; `BEHIND` + красный `ci-ok` —
  красный, без merge; `BEHIND` + сдвинутый head — ждёт, без `gh pr merge`; `BEHIND`, от которого GitHub отказался
  (`strict: true`), — ждёт rebase, замок снят; `DIRTY` и `CONFLICTING` — ждут с `conflict: rebase`. На старом `land`
  5 из этих проверок красные.
- `harness/skills/epic-wave/SKILL.md`: блок статуса (`CLEAN, BEHIND — merge`), абзац «Merge in turn across
  machines» (сдвинутая база — не причина для rebase; rebase только на `CONFLICTING`/`DIRTY`, и на `BEHIND` только
  при защите `strict: true`), комментарий в блоке замка, абзац о замке на другой машине, описание `land` и разбор
  его вывода. Правило общее, поле Profile-а не нужно: при `strict: false` GitHub `BEHIND` не сообщает, при
  `strict: true` сам не даёт влить.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`: проверки текста о rebase на `BEHIND` заменены проверками нового
  правила.
- `harness/bin/wave-gate` — прочитан, правка не нужна: `check` и `merge` не смотрят `mergeStateStatus`.
- В `ship-ticket` правила «rebase на сдвинутую базу» нет: rebase там только на конфликт (`step-8`, `implementer-finish`)
  и для `local-green` (`step-11`, fast-forward требует ветку поверх `main`) — не тронуто.
