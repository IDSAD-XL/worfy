# 09 — Skill `retro`: шаг «классифицировать сбой» (В3, Harness)

Type: task
Status: claimed 2026-10-17T10:43Z
Branch: worfy-reliability/09
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

- `harness/skills/retro/SKILL.md`: новый шаг 3 «Classify» между «Filter hard» (2) и «Check for
  duplicates» (4); дальше шаги перенумерованы (5–8). Класс — по классам из `<path>/README.md` или
  `rules.md` Profile-а, по корневой причине и с подтверждением; без подтверждения — «cause not
  found», класс не угадывается. Вывод — проверка (test, hook, eval case, `file:line`) или
  `no lesson: <reason>`.
- «Filter hard» больше не отсеивает «environment hiccups»: сбой идёт в шаг 3. Сбой окружения
  записывается в раздел рисков Project-а (тот, что называет README уроков или `rules.md`, обычно в
  файле состояния из `docs.handoff.path`); раздела нет — спросить пользователя; повторился — ещё и
  урок «how to recognize». «Check for duplicates» для такого сбоя читает и раздел рисков.
- «Write the entry»: в режиме репозитория — строка проверки под меткой из README Project-а (у worfy
  — `Проверка:`), с выводом шага 3; в режиме Profile-а — поле `**Check:**`. Слово `Проверка:` в
  skill не попало: shell test `harness/bin/tests/harness-home.test.sh` (раздел 6) не пускает
  кириллицу в текст skill-ов вне списка разрешённых строк.
- Пример `Auction: docs/lessons/<topic>.md` заменён на `<path>/<topic>.md` — в тексте нет путей
  worfy.
- Test: `test/contract/harness-retro-skill.test.ts` (6 test-ов). На тексте skill-а с `origin/main`
  cc8d382e — exit 1, 5 из 6 красные; с правкой — exit 0. Мутанты: Classify после «Check for
  duplicates» — красный test порядка; «environment hiccups» снова в «Filter hard» и `HANDOFF.md` в
  тексте — красные 2 test-а; без строки проверки в «Write the entry» — красный 1 test.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (274 файла); `GATE_SCOPE=all` gate fast —
  exit 0, `[gate] зелено (fast)`. Первый полный `pnpm test` под нагрузкой соседних агентов
  (load average 10) дал красные timeout-ы в test-ах, не связанных с правкой; они зелёные отдельно и
  в повторном полном прогоне.
- После мержа — `pnpm install:stable` (Orchestrator) и ручной пункт «первый `retro` на настоящем
  сбое».
