# 09: Assistant — карточка Schedule и карточка «было → станет» в чате

Type: task
Status: open
Blocked by: 05, 08
Source: [spec.md](../spec.md), «Ticket-ы», 09; «Решения по реализации» («Assistant»); «Набросок функции», шаги 1, 2, 7;
решения владельца Q3, Q7, Q9 grilling-а; «Волны», Wave 7

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Assistant предлагает Session через Proposal с Prepare (`proposal_create`, `src/shared/assistant/app-tools.ts`); карточка
  «было → станет» есть для настроек (`src/shared/assistant/settings-change.ts`).
- Q9: удаление только кнопкой; у Assistant-а нет tool-а, который удаляет. Граница 3 ADR-0114 с Amendment-ом Ticket-а 01.

## Что строить

- Tools `worfy-app`: `schedules_list` (чтение: поля, состояние, ближайшие даты, последние исходы); `schedule_propose` —
  карточка нового Schedule; `schedule_change_propose` — карточка «было → станет», в том числе Pause, Resume и Delete как
  предложенная правка. Tool-а, который пишет сам, нет.
- Поля правила Assistant заполняет; main проверяет их (Ticket 02) и сам считает три даты для карточки.
- Карточка Schedule в чате: те же поля, что редактор, с правкой в карточке; Accept, Edit… (редактор Ticket-а 08 с
  полями карточки), Dismiss. Правка четырёх полей на карточке «было → станет» — строка «Changing the model needs a new
  Accept» (или поле, которое меняется).
- Delete на карточке удаления — щелчок пользователя с тем же подтверждением, что в виде Schedules.

## Где в коде

- `src/shared/assistant/app-tools.ts`, `src/main/mcp/app-server.ts`
- `src/renderer/assistant/` — карточки (имена файлов — предложение)
- `test/unit/assistant-schedule-tools.test.ts`, `test/e2e/schedules-assistant.spec.ts` (новые), строка в
  `scripts/e2e-specs.table.json`

## Test-ы

- Unit: в списке tools нет пишущего tool-а Schedule-ов; форма обеих карточек; даты в карточке — от main.
- E2E: fake Assistant предлагает карточку → Accept → Schedule в виде Schedules; карточка смены модели → Needs Accept
  до Accept.
- Без модели: fake Session Assistant-а. Сначала падающий test.

## Готово, когда

- [ ] Assistant предлагает новый Schedule и правку карточками; применяет их только щелчок пользователя.
- [ ] `assistant-schedule-tools.test.ts` и `schedules-assistant.spec.ts` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
