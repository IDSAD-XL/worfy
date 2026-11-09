# 65 — Status `review` ставится в момент вердикта ревью, а не перед merge; потом `critical-path` читает его как Gate

Type: task
Status: open
Blocked by: 62
Source: «Итог» Ticket-а [62](62-merge-queue-или-ci-пачками.md), часть 6 и продолжение 5 из части 5; решение
владельца 2026-11-09 (Q1–Q6 «да», вариант B).

## Что происходит

- Skill-ы велят ставить commit status `review` в момент вердикта: `review pending` перед ревью, `review success` или
  `review failure`, когда вердикт записан (`epic-wave`, «The review mark»; `ship-ticket`, шаг 7).
- На деле, по замеру Ticket-а 62, `review` ставится за 10–15 s до merge: у 67 PR от `review` до merge медиана
  0,2 min. Время самого вердикта нигде, кроме комментария `VERIFIED`, не записано.
- `scripts/critical-path.mjs` берёт Gate из последнего комментария `VERIFIED`. У 60 из 222 PR такого комментария нет:
  для них шаг Gate пустой. Читать `review` как Gate сейчас нельзя: Gate → merge и Green → merge схлопнулись бы в 0
  («Итог» Ticket-а 62, часть 6; правка первого круга в PR #1725 отозвана ревью).

## Что делаем

1. Найти, почему `review` ставится перед merge, а не в момент вердикта: кто вызывает `ticket mark … review success`
   и в какой момент (транскрипты Orchestrator-а последних Wave, порядок действий в `epic-wave`). Ответ — в «Итог».
2. Исправить источник: `review success` или `review failure` ставится тем же шагом, что записывает вердикт. Если
   нужен скрипт — он, если только текст skill-а — текст.
3. После того как `review` ставится в момент вердикта: `critical-path` читает время status `review` `success` на head
   как отметку Gate, когда нет комментария `VERIFIED` (или вместо него — решить по данным и записать в «Итог»).
   Unit test на fixture PR с `review` и без `VERIFIED`.
4. Шаг без данных — по-прежнему пустая ячейка с причиной: `review`, поставленный позже вердикта, Gate не даёт.

## Готово, когда

- [ ] «Итог»: кто и когда ставит `review` сейчас — с примерами PR и временем.
- [ ] `review` ставится в момент вердикта: на PR после правки от `review` до merge — не секунды (пример в «Итог»).
- [ ] `critical-path` берёт Gate из status `review` — unit test в `test/unit/critical-path.test.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `harness/skills/epic-wave/SKILL.md:534-550` — «The review mark» и блок `ticket mark … review`.
- `harness/skills/ship-ticket/step-7-review.md:100-115` — то же для `ship-ticket`.
- `harness/bin/ticket:948` — `mark()`: запись отметки.
- `harness/bin/land:305-321` — `reviewed`: перенос `review` на новый head (не постановка вердикта).
- `scripts/critical-path.mjs:336-341` — `measure`: Gate из `verdicts(pr)`, то есть из комментария `VERIFIED`.
- `scripts/critical-path.mjs:302-318` — `budgetOf`: `headMarks` (`review`, `check/windows`) делят время после green.
- `src/shared/flight-recorder/pr-facts.mjs:91` — `headMarks`; `:137` — `verdicts`.
- `test/unit/critical-path.test.ts`, `test/fixtures/critical-path/`.

## Вне скоупа

- Обязательный status `review` в branch protection GitHub — не меняется (условие Harness-а, не GitHub).
