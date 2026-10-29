# 30 — gate full на Windows-ПК раз в Wave на `main`, а не на каждый PR со scope `pc`

Type: task
Status: claimed 2026-10-29T12:19Z
Branch: worfy-throughput/30-pc-gate-once-per-wave
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
3. `rules.md` Profile-а worfy на обеих машинах после merge (у каждой свой, ADR-0042): на Mac — Orchestrator, на
   ПК — Session на ПК; то же правило.

Нужен ПК: **да** — для приёмки на настоящей Wave; текст и ADR можно писать на Mac. **Трогает Harness: да** —
skill `epic-wave`, `rules.md` Profile-а; слово владельца дано 2026-10-28 (решение 1); новый ADR.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): основа Ticket-а — `ci-ok` на runner-ах вместо gate full на Mac. Ticket
остаётся: ни один runner не проверяет Terminal, окна, меню и уведомления Windows — это по-прежнему ПК; цель —
не держать PR со scope `pc` в очереди ПК, а проверять `main` раз в Wave.

## Готово, когда

- [x] ADR и `## Amendments` в ADR-0056.
- [x] Текст skill-а; `harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0.
- [ ] После merge: правило ADR-0086 в `rules.md` Profile-а worfy на обеих машинах (ADR-0042) — на Mac правит
      Orchestrator, на ПК — Session на ПК; Session на ПК открывает и закрывает issue `pc-main-red`.
- [ ] (вручную, ПК) Первая Wave с PR со scope `pc`: PR влит до gate full на ПК; gate full на ПК на `main` после
      Wave — код и строка `[gate] green (full)` в «Итог»; время Windows-Ticket-а до merge — по Ticket-у 14.

## Где в коде

- `harness/skills/epic-wave/SKILL.md` — раздел 4
- `docs/adr/<новый>`, `docs/adr/0056-windows-checks-and-two-sessions.md` — только `## Amendments`
- Только читать: `scripts/windows-verdict-scope.mjs`

Вне репозитория (после merge): `rules.md` Profile-а worfy, пункт «Gate перед мержем PR с кодом», — на Mac
(Orchestrator) и на ПК (Session на ПК).

## Вне скоупа

- Автоматический revert по красному gate full на ПК — нет (решение 7).

## Итог

PR #989, после двух раундов ревью Orchestrator-а.

- ADR-0086 (`docs/adr/0086-pc-gate-full-once-per-wave.md`), восемь пунктов:
  - PR со scope `pc` вливается по зелёному `ci-ok` и отметке `review`, если `main` не красный на ПК;
    `check/windows` — `success` на таком head, в отчёте Wave пометка «ПК — после Wave».
  - ПК гоняет `GATE_SCOPE=all` gate full на `main`: в Wave — раз после Wave с таким PR, на SHA её последнего
    merge (просит Orchestrator); вне Wave — сразу после merge, на merge-коммите (просит Session, которая
    вливала). Запрос без отчёта заменяется более новым.
  - Красный — один повтор упавших test-ов поодиночке на том же SHA. Зелёный повтор — flaky test: `main` не
    красный, повторяется — карантин. Снова красный — `main` красный на ПК.
  - Состояние — открытый issue с меткой `pc-main-red` в `IDSAD-XL/worfy`. Его открывает и закрывает Session
    на ПК; перед `gh issue create` она выполняет `gh label create pc-main-red --force …`, чтобы метка была
    всегда: issue без метки `gh issue list --label pc-main-red --state open` не находит и читает как зелёный.
    Этот список читают перед merge любого PR со scope `pc`, в Wave и без неё.
  - Исключение — PR-исправление (вперёд или revert): называет issue без закрывающего слова GitHub (`Fixes`,
    `Closes`, `Resolves`) и вливается по `ci-ok`, `review` и прицельной проверке ПК упавших test-ов на своём
    head. `main` снова зелёный — зелёный gate full на merge-коммите исправления или более позднем SHA.
  - 1 h на исправление вперёд, потом Orchestrator вливает revert руками; автоматического revert нет.
  - «Последствия»: пока ПК занят или на паузе при красном `main`, issue никто не закрывает и PR со scope
    `pc` стоят до возвращения ПК — не хуже прежнего, но этим ADR не решено. Раздел Considered Options.
  - После merge `rules.md` Profile-а worfy правится на обеих машинах (ADR-0042): на Mac — Orchestrator, на ПК —
    Session на ПК.
- `## Amendments` одной датированной строкой: ADR-0056 (пункт 2), ADR-0071 (пункт 4), ADR-0083 (пункт 6); у
  ADR-0072 раздел `## Amendments` новый. В `CONTEXT.md` — предложение со ссылкой на ADR-0086.
- Skill `epic-wave`, раздел 4, «Checks before merge»: пункт «A check that answers on the main branch after
  the merge» — когда просить, отчёт, повтор, запись красного (с `gh label create` перед `gh issue create`),
  чтение перед merge, исключение, конец красного, срок revert-а. Имена worfy — только в примерах: что этот
  Check — `windows` для scope `pc`, говорят `rules.md`. Пометка «ПК — после Wave» — в отчёте Wave: `ticket
  mark` описания не принимает. Skill `ship-ticket`, шаг 9 (`step-9-merge.md`): Check читают перед merge, и
  вне Wave его просит на merge-коммите тот, кто вливал.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`: 19 проверок пункта раздела 4 и 2 проверки шага 9; на ПК
  `HOME=$(mktemp -d) bash harness/bin/tests/epic-wave-ship-ticket.test.sh` — exit 0, `passed 544, failed 0`.
  Мутанты текста (удалить или переиначить одно правило) — каждый даёт exit 1.
- `harness/skills/epic-wave/SKILL.md` с этим PR — 133 722 байта, больше предела Linux на
  один аргумент argv (`MAX_ARG_STRLEN`, 131 072 байта): любая проверка читает его из файла и никогда не
  передаёт одним аргументом (проверки 1 test.sh пишут текст во временный файл).
- Не сделано здесь: правило в `rules.md` на обеих машинах (после merge) и приёмка на первой Wave с PR со scope
  `pc` (последние пункты «Готово, когда»).
