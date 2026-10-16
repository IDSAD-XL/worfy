# 09 — Skill `retro`: шаг «классифицировать сбой» (В3, Harness)

Type: task
Status: open
Blocked by: 06
Source: решение владельца 2026-10-16 по Ticket-у [03](03-сбой-инцидент-и-регрессионный-test-предложение-процесса.md)
(«Итог», пункт 3: сначала В1 и В2, затем В3): кандидат 5 раздела «Follow-up Ticket-ы» документа
[docs/research/2026-10-15-сбой-инцидент-test.md](../../../docs/research/2026-10-15-сбой-инцидент-test.md),
строка В3 таблицы «Куда встроить».

## Что происходит

- Skill `retro` (`harness/skills/retro/SKILL.md`) отбирает уроки: шаг 2 «Filter hard» отсеивает
  «one-off slips, environment hiccups» (`:57-61`), шаг 3 ищет дубликаты (`:63-66`). Куда идёт сбой
  окружения, если не в урок, skill не говорит; класса причины и строки `Проверка:` в нём нет.
- В режиме репозитория skill пишет урок в формате `<path>/README.md` (`:81`) — у worfy это
  `docs/lessons/README.md`, его классы и строку `Проверка:` даёт Ticket 06.
- Skill общий для всех Project-ов Harness (и Atakama): формулировки — без путей worfy.
- Правки `harness/` — PR в `harness/`; после мержа — `pnpm install:stable`, иначе Stable copy
  работает со старым skill-ом (ADR-0047, `HANDOFF.md`, «Риски и долги»).

## Что делаем

1. **Шаг «Classify»** между «Filter hard» и «Check for duplicates»: для сбоя — класс по README уроков
   Project-а (если README классы задаёт), подтверждение класса и вывод: проверка (test, hook,
   eval-кейс) или «no lesson: <reason>».
2. **Сбой окружения не исчезает молча**: вместо отсева — запись в раздел рисков Project-а (у worfy —
   «Риски и долги» `HANDOFF.md`) или урок «как распознать», если сбой повторяется.
3. **Шаг «Write the entry»** в режиме репозитория пишет строку `Проверка:` (или её аналог из README
   Project-а), если README её требует.
4. **Test текста skill-а**: contract test проверяет, что шаг классификации есть и стоит между отбором и
   дубликатами, и что в тексте нет путей worfy (`docs/lessons`, `HANDOFF.md`, `.scratch`).

## Готово, когда

- [ ] Test пункта 4 красный на main и зелёный с правкой.
- [ ] `harness/skills/retro/SKILL.md` — шаги пунктов 1–3; формулировки без путей worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast с `GATE_SCOPE=all` — exit 0 (PR
      только в `harness/`, `HANDOFF.md`, «Риски и долги»); gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный.
- [ ] После мержа — `pnpm install:stable` (Orchestrator, вне прогона Autopilot).
- [ ] (вручную) Первый `retro` после мержа на настоящем сбое — класс и вывод в уроке или «no lesson».
      Шаг Orchestrator-а или владельца; поведение модели eval-ом проверяется только после
      `worfy-harness` 27–29.

## Тесты

- `test/contract/harness-retro-skill.test.ts` — текст skill-а: шаг есть, порядок шагов, нет путей
  worfy.

## Где в коде

- `harness/skills/retro/SKILL.md`
- `test/contract/harness-retro-skill.test.ts`

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `docs/lessons/README.md`,
`test/contract/harness-plugin.test.ts`.

## Вне скоупа

- Правило Orchestrator-а (В4) — только если инциденты продолжат теряться после В1–В3.
- Eval-кейс на поведение skill-а — после `worfy-harness` 27–29.

## Итог

—
