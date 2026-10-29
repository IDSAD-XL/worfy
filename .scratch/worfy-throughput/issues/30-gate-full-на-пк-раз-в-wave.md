# 30 — gate full на Windows-ПК раз в Wave на `main`, а не на каждый PR со scope `pc`

Type: task
Status: open 2026-10-29T12:07Z
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 1, решение 7;
ADR-0056 (Windows-проверки и две Session), пункт 2 —
платформенный PR вливается после gate full на ПК; аналитика 2026-10-27: Windows-Ticket до merge 2,5 h.

## Что происходит

- PR, для которого `scripts/windows-verdict-scope.mjs` печатает `pc` (Terminal, окна, меню, уведомления,
  `test/e2e/**`, упаковка — список `PC_ONLY`, `:30-100`), ждёт gate full на ПК на своём head. ПК гоняет gate full
  на каждый такой PR по очереди, и каждый ждёт.
- Run `windows-full` на `main` после Wave уже есть для runner-а (ADR-0071); для ПК такого шага нет.

## Что делаем

1. Новый ADR (ADR-0056 не правится; в его конец — `## Amendments` со ссылкой): PR со scope `pc` вливается после
   зелёного автоматического run-а `full` на Windows-runner-е на head PR (Ticket 24) и зелёного `ci-ok` (Ticket 35; до него — gate full на Mac); ПК
   гоняет `GATE_SCOPE=all gate full` на `main` один раз после Wave, где был такой PR. Красный — один повтор
   упавших test-ов Session-ом на ПК (проверка на flaky test; автоматического повтора в run-е нет — решение
   владельца 2026-10-28 о карантине); снова красный — исправление
   вперёд Session на ПК; пока `main` красный на ПК, новые PR со scope `pc` не вливаются.
2. Skill `epic-wave`, раздел 4: метка `check/windows` для `pc` — `success` по run-у runner-а с пометкой
   «ПК — после Wave»; после Wave — запрос gate full на ПК на SHA `main` (так же, как сейчас запрос на head PR).
3. `rules.md` Profile-а (Orchestrator после merge): то же правило.

Нужен ПК: **да** — для приёмки на настоящей Wave; текст и ADR можно писать на Mac. **Трогает Harness: да** —
skill `epic-wave`, `rules.md` Profile-а; слово владельца дано 2026-10-28 (решение 1); новый ADR.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): основа Ticket-а — `ci-ok` на runner-ах вместо gate full на Mac. Ticket
остаётся: ни один runner не проверяет Terminal, окна, меню и уведомления Windows — это по-прежнему ПК; цель —
не держать PR со scope `pc` в очереди ПК, а проверять `main` раз в Wave.

## Готово, когда

- [ ] ADR и `## Amendments` в ADR-0056.
- [ ] Текст skill-а; `harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0.
- [ ] (вручную, ПК) Первая Wave с PR со scope `pc`: PR влит до gate full на ПК; gate full на ПК на `main` после
      Wave — код и строка `[gate] green (full)` в «Итог»; время Windows-Ticket-а до merge — по Ticket-у 14.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` — раздел 4
- `docs/adr/<новый>`, `docs/adr/0056-windows-checks-and-two-sessions.md` — только `## Amendments`
- Только читать: `scripts/windows-verdict-scope.mjs`

Вне репозитория (Orchestrator после merge): `rules.md` Profile-а worfy, пункт «Gate перед мержем PR с кодом».

## Вне скоупа

- Автоматический revert по красному gate full на ПК — нет (решение 7).

## Итог
