# Аудит кодовой базы 2026-10-31 — линза documentation

Status: ready-for-agent
Коммит аудита: `6f24b0a5b214b3c8b40554ef97e731096414e402`
Линзы: `documentation` (Profile, `audit_lenses`). Запуск: Ticket 19 Epic-а `worfy-feature-docs`.

## Что проверено

Одна линза, один агент `worfy:scout`, 44 664 токена. Он прочёл 0 страниц целиком, выборочно 12: sessions, onboarding,
browser, canvas, autopilot, projects, notifications, terminal, app-shell, skills-agents-and-hooks, gate-and-github, README.
Не читал: cards, epic-frames, focus-mode, harness, link, storage-and-diagnostics, transcripts-and-usage, workflow, concepts.
Страницы с `CONTEXT.md` он не сравнивал.

Поэтому Orchestrator дополнил проход отбором по изменениям: для каждой страницы из 21 `git log <последний коммит страницы>..main`
по путям, которые она называет. Изменение нашлось одно, `2a5a2754` (PR #1084), оно дало находку documentation-2.

Все страницы прошли сверку каждого утверждения с кодом за последние двое суток. Этот аудит такой сверки не повторяет.

## Находки

| № | Severity | Адрес | Что расходится | Проверка | Исправление |
|---|---|---|---|---|---|
| documentation-1 | MED | `docs/features/sessions.md:130` | Страница говорит, что Eco mode пишет `workflow.agents`. Код пишет ещё `agents`, а выключение убирает оба поля без возврата прежних моделей: `src/main/ipc/eco-mode.ts:6-8`, `:23`; значения — `src/shared/agent/plan-preset.ts:57-58` | `sed -n 1,35p src/main/ipc/eco-mode.ts`, Orchestrator перечитал | Ticket 01 |
| documentation-2 | MED | `docs/features/skills-agents-and-hooks.md:133` | «Two lenses have written rules» и нет `docs.feature_pages`. PR #1084 добавил линзу в `harness/agents/reviewer.md` и шаг в `harness/skills/ship-ticket/SKILL.md:201`; страница написана на базе до него | `grep -n 'Lens: documentation' harness/agents/reviewer.md`, Orchestrator перечитал | Ticket 01 |

Находок HIGH и `regressed` нет, фаза перекрёстной проверки пуста. Находки LOW отброшены по правилу владельца от 2026-10-22;
агент их не вернул.

| Линза | Проверено | Подтверждено | Отброшено | Доля ложных |
|---|---|---|---|---|
| documentation | 2 | 2 | 0 | 0 |

## Дубликаты

| Находка | Вердикт | Где |
|---|---|---|
| documentation-1 | new | `worfy-throughput/60` закрыт и страницу не правил |
| documentation-2 | new | — |

## Что не проверено

Прохода по dev stack нет: Profile без `dev_stack`. Утверждения о Windows и о Linked machine агент не проверял.
