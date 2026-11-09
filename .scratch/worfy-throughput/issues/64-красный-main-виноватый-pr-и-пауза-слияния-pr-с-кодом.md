# 64 — Красный `main`: виноватый PR по первому красному push-run и пауза слияния PR с кодом

Type: task
Status: claimed 2026-11-09T10:37Z
Branch: worfy-throughput/64
Blocked by: 62
Source: решение владельца 2026-11-09, Q5 (ответ на «Итог» Ticket-а [62](62-merge-queue-или-ci-пачками.md));
[ADR-0103](../../../docs/adr/0103-merge-without-rebase-for-a-fresh-base.md), пункт 3; продолжение 3 из «Итог», часть 5,
Ticket-а 62.

## Что происходит

- Без rebase ради свежей базы (ADR-0103) сочетание PR проверяет только push-run на `main` (CI run на push в
  `main`). По замеру Ticket-а 62 он идёт долго: медиана 36,5, p90 241,6 min wall; к его концу сверху уже влиты
  другие PR.
- Правило красного `main` записано только текстом skill-а `epic-wave` («A red push run on the main branch»): пока
  последний push-run красный, PR с кодом не вливаются; исправление вперёд за 1 h, потом revert виноватого PR.
- `harness/bin/land` push-run-ы `main` не читает: он проверяет `ci-ok` только на head PR. Пауза держится на памяти
  Orchestrator-а, а виноватого он ищет руками.
- Push-run есть на каждом commit-е `main`: в `ci.yml` группа `concurrency` для push включает SHA, и такие run-ы не
  отменяются.

## Что делаем

1. Перед merge каждого PR с кодом `land` читает `ci-ok` push-run-ов `main` и находит последний завершённый.
   Красный — PR с кодом ждёт с причиной, которая называет run (URL), commit и виноватый PR: первый по порядку
   commit-ов `main` красный push-run после последнего зелёного. PR только с документами вливается (то же деление
   «документы или код», что у `scripts/ci-scope.mjs`, `isDocument`). Push-run ещё идёт — PR с кодом не ждёт его
   ради этого правила (иначе каждый merge ждал бы 36 min).
2. Flaky: если красный push-run после одного повтора упавших job-ов (`gh run rerun --failed`, один повтор на head)
   зелёный, `main` зелёный. Повтор делает Orchestrator по skill-у, а не `land`; `land` читает последнюю попытку
   run-а.
3. Skill `epic-wave`, раздел «A red push run on the main branch»: шаг поиска виноватого, причина ожидания `land`,
   повтор упавших job-ов как граница flaky и вины PR; строка в отчёт Wave.
4. Shell test-ы в `harness/bin/tests/land.test.sh`: красный последний push-run — PR с кодом ждёт и причина называет
   виноватый PR; PR только с документами вливается; зелёный после повтора — PR с кодом вливается.

Платформенный PR (ADR-0056): правит скрипт Harness. Windows verdict — job Windows в составе `ci-ok` на head PR.

## Готово, когда

- [ ] `land` не вливает PR с кодом, пока последний завершённый push-run `main` красный; причина называет run, commit
      и виноватый PR — shell test.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 5a9fee64a8eeea8993c788c41fbe71e16da14adf
- [ ] PR только с документами при красном `main` вливается — shell test.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 5a9fee64a8eeea8993c788c41fbe71e16da14adf
- [ ] Push-run, зелёный после одного повтора упавших job-ов, не держит merge — shell test.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 5a9fee64a8eeea8993c788c41fbe71e16da14adf
- [ ] Раздел skill-а `epic-wave` о красном `main` описывает поиск виноватого и повтор; без деления пополам.
  - evidence: test-run pass · `bash harness/bin/tests/epic-wave-ship-ticket.test.sh` exit 0 · mac - · 5a9fee64a8eeea8993c788c41fbe71e16da14adf
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR (в нём job Windows).

## Где в коде

- `harness/bin/land:265-277` — `ciGreen`: читает только run-ы и `ci-ok` head PR.
- `harness/bin/land:375-392` — `mergeOne`: место проверки `main` под замком перед `gh pr merge`.
- `harness/bin/land:51-52` — поля state-файла `ci_check` и `ci_workflow`.
- `harness/skills/epic-wave/SKILL.md:1378-1386` — «A red push run on the main branch».
- `scripts/ci-scope.mjs:62-64` — `isDocument`: что считается документом.
- `.github/workflows/ci.yml:122-124` — `concurrency`: push-run на каждый SHA, без отмены.
- `harness/bin/tests/land.test.sh` — shell test-ы `land`.

## Вне скоупа

- Красный `main` на ПК (issue `pc-main-red`, ADR-0086) — своё правило, не меняется.
- Автоматический revert — решение остаётся за Orchestrator-ом.
- Повтор job-ов из `land` — нет: повтор один на head, и его делает Orchestrator.
