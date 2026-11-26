# 24 — Действие `pr-follow` не выше `ask`/`pre-approved`: режим `self` для него запрещён

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25), Q2; поправка к решениям 1 и 2
[Ticket-а 09](09-mcp-сервер-worfy-app.md) («Решено без владельца»); ADR-0114, пункт 4 (сам Assistant делает только
действия закрытого списка). [spec.md](../spec.md), «Волны»: Wave 6, до или вместе с Ticket-ом 15.

Кто: агент.

## Что происходит

Ticket 09 добавил обязанностям два действия main: `pr-follow` («Fix checks», «Resolve conflicts», «Address comments»
на PR) и `autopilot-start` (диалог Start Autopilot), оба с режимом `ask` по умолчанию
(`src/shared/assistant/duties.ts:122`, `:136`). Режимы — общий список `DUTY_ACTION_MODES` = `self`, `pre-approved`,
`ask`, `hand-over` (`duties.ts:16`), и любой из них можно выбрать для любого действия:

- `Duties.configure` проверяет только, что режим из списка (`src/main/assistant/duties/duties.ts:173-179`);
- файл памяти обязанностей принимает любой режим для любого действия (`dutyStateSchema.modes`,
  `src/main/assistant/duties/memory.ts:13`), и выбранный режим перекрывает режим по умолчанию
  (`duties.ts:333`, `:350`);
- `action_run` сервера `worfy-app` отказывает только при `ask` и `hand-over` (`src/main/mcp/app-server.ts:367-368`);
  `self` и `pre-approved` запускают действие (решение 2 Ticket-а 09: `pre-approved` — как `self`).

С `self` у `pr-follow` Assistant сам, без вопроса, запускает слежение за PR — Session, которая чинит check-и, конфликты
или отвечает на комментарии. Это действие вне закрытого списка main, а ADR-0114 разрешает Assistant-у сам делать только
действия закрытого списка. У `autopilot-start` то же формально, но он только открывает диалог Start Autopilot, и диалог
и есть подтверждение пользователя, — его владелец оставил как есть.

## Что строить

1. **Один список разрешённых режимов по действию** в `src/shared/assistant/duties.ts`: для `pr-follow` — `pre-approved`,
   `ask`, `hand-over`; для остальных действий — как сейчас. Его читают main и будущие настройки (Ticket 15), чтобы
   экран не предлагал `self` для `pr-follow`.
2. **Отказ при выборе.** `Duties.configure` с `pr-follow: self` бросает с причиной, и ничего не меняется — как сейчас
   с неизвестным режимом (`duties.ts:173-179`).
3. **Отказ при чтении.** Файл памяти, где у `pr-follow` записан `self` (руками или будущей сборкой), не даёт `self`:
   режим читается как режим по умолчанию (`ask`), одна строка в log. Остальные записи файла читаются как обычно.
4. **Отказ при действии.** `action_run` с `pr-follow` при режиме `self` отказывает с причиной и строкой журнала, как при
   `ask` (`app-server.ts:367-368`), — вторая защита на случай, если режим пришёл в обход 2 и 3.
5. `autopilot-start` не меняется. `pre-approved` у `pr-follow` работает, как сейчас: выбор этого режима — заранее
   данное «да» пользователя (решение 2 Ticket-а 09).
6. Описание tool-а `action_run` (`src/shared/assistant/app-tools.ts:76`) и правила Session Assistant-а
   (`src/main/mcp/agent-instructions-app.md:17-19`) говорят, что `pr-follow` не бывает `self`, если агент найдёт, что
   без этого модель будет пробовать.

## Где в коде

- `src/shared/assistant/duties.ts:11-18` (`DUTY_ACTION_MODES`), `:20-28` (`DUTY_ACTIONS`), `:122`, `:136` (режимы по
  умолчанию).
- `src/main/assistant/duties/duties.ts:173-189` (`configure`), `:332-340` (`proposals`), `:342-352` (`status`).
- `src/main/assistant/duties/memory.ts:11-22` (`dutyStateSchema`).
- `src/main/mcp/app-server.ts:362-368` (`action_run`).
- Не меняется, только сверить: `src/main/assistant/actions/auto.ts:64` (сам main делает только действия закрытого
  списка; `pr-follow` в нём нет), `src/main/assistant/actions/closed-list.ts:89-95` (`modeAllows`).
- Test-ы: `test/unit/assistant-duties.test.ts`, `test/contract/worfy-app-tools.test.ts`.

## Решения

- ADR не меняется: решение владельца следует ADR-0114, а не меняет его. Поправку ADR, если агент найдёт её нужной,
  пишет Orchestrator.
- Где ещё мог бы прийти `self` для `pr-follow` (например, будущий tool, меняющий режимы), агент перечисляет в «Итог».

## Test-ы

- Unit test обязанностей: `configure` с `pr-follow: self` бросает, режимы не меняются; `pre-approved`, `ask`,
  `hand-over` принимаются; `autopilot-start: self` принимается, как сейчас. Сначала красный на нынешнем коде.
- Unit test: файл памяти с `pr-follow: self` читается, предложение `pr-follow` идёт с режимом `ask`.
- Contract test `worfy-app`: `action_run` с `pr-follow` при режиме `self` отказывает, ничего не запущено, строка журнала
  записана.

## Готово, когда

- [ ] Unit test: `self` для `pr-follow` нельзя выбрать; остальные режимы и `autopilot-start` — как сейчас.
- [ ] Unit test: `self` для `pr-follow` из файла памяти читается как `ask`.
- [ ] Contract test: `action_run` отказывает `pr-follow` в режиме `self`.
- [ ] «Итог»: все места, где режим `self` для `pr-follow` теперь отклоняется, с `file:line`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
