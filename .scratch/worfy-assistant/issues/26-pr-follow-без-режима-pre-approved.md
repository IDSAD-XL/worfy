# 26 — Действие `pr-follow` только `ask` или `hand-over`: режим `pre-approved` для него тоже запрещён

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-26, второй раунд (Q1–Q6, «все да»), Q1; поправка к Ticket-у 24 и к решению 2
[Ticket-а 09](09-mcp-сервер-worfy-app.md) («Решено без владельца»); ADR-0114, пункт 4 (сам Assistant делает только
действия закрытого списка). [spec.md](../spec.md), «Волны»: Wave 6, до приёмки (Ticket 20).

Кто: агент.

## Что происходит

`pr-follow` — действие обязанности «ждёт пользователя»: Assistant через `worfy-app` запускает слежение за PR
пользователя, то есть Session, которая чинит check-и, разрешает конфликты или отвечает на комментарии («Fix checks»,
«Resolve conflicts», «Address comments»). Это действие вне закрытого списка main.

Ticket 24 запретил для него `self`, но оставил `pre-approved`:

- список разрешённых режимов — `'pr-follow': ['pre-approved', 'ask', 'hand-over']`
  (`src/shared/assistant/duties.ts:43`); комментарий над ним говорит «`pre-approved` stays, for choosing it is the
  user's «yes» given in advance» (`duties.ts:33-34`);
- `action_run` сервера `worfy-app` запускает действие при `self` и `pre-approved` одинаково (решение 2 Ticket-а 09):
  `src/main/mcp/app-server.ts:452-453` отказывает только при `ask` и `hand-over`.

Значит, `pre-approved` у `pr-follow` работает ровно как `self`: Assistant сам, без вопроса, запускает Session над PR.
Потолок, который поставил Ticket 24, ничего не держит. Владелец решил: у `pr-follow` остаются только `ask` и
`hand-over`.

## Что строить

1. **Список режимов.** `DUTY_ACTION_ALLOWED_MODES['pr-follow']` — `ask`, `hand-over` (`src/shared/assistant/duties.ts:43`);
   комментарий над списком (`:30-36`) говорит, почему. Остальные действия, `autopilot-start` тоже, — как сейчас.
2. **Отказ при выборе.** `Duties.configure` с `pr-follow: pre-approved` бросает с причиной, и ничего не меняется — то
   же место, что для `self` (`src/main/assistant/duties/duties.ts:190`).
3. **Отказ при чтении.** Файл памяти, где у `pr-follow` записан `pre-approved` (выбран до этого Ticket-а), читается как
   `ask` — режим обязанности по умолчанию, одна строка в log, остальные записи файла как записаны
   (`src/main/assistant/duties/memory.ts:19-31`, `dutyModesSchema`). Следующая запись обязанностей убирает эту запись
   (решение 2 Ticket-а 24).
4. **Отказ при действии.** `action_run` с `pr-follow` при режиме `pre-approved` отказывает с причиной и строкой журнала
   (`src/main/mcp/app-server.ts:303-307`, `act`), main ничего не запускает.
5. **Settings не предлагает `pre-approved` для `pr-follow`.** Экран обязанностей Ticket-а 15
   (`src/renderer/settings/AssistantSection.tsx`, ветка `worfy-assistant/15`) берёт режимы из
   `DUTY_ACTION_ALLOWED_MODES`; карточка «было → станет» (`change` в `proposal_create`) отказывает режим, запрещённый
   действию. Если Ticket 15 уже влит, агент сверяет оба места и закрывает test-ом; если нет — пишет в «Итог», что их
   закроет Ticket 15 через тот же список.
6. **Тексты для модели.** Описание tool-а `action_run` (`src/shared/assistant/app-tools.ts:93`), правила Session
   Assistant-а (`src/main/mcp/agent-instructions-app.md:17-18`) и комментарий в начале `app-server.ts` (`:14-18`)
   говорят «self or pre-approved» для всех действий. Агент решает, нужно ли сказать, что `pr-follow` теперь всегда
   предложение, и пишет решение в «Решено без владельца».

## Где в коде

- `src/shared/assistant/duties.ts:30-36` (комментарий), `:37-45` (`DUTY_ACTION_ALLOWED_MODES`), `:43` (`pr-follow`),
  `:48` (`dutyActionModeAllowed`), `:156` (режим по умолчанию `pr-follow: 'ask'`).
- Места Ticket-а 24 (PR #2260), все читают один список:
  - `src/main/assistant/duties/duties.ts:181-191` (`configure`);
  - `src/main/assistant/duties/memory.ts:19-31` (`dutyModesSchema`); его читают обязанности (`memoryFileStore`) и
    первое сообщение Session Assistant-а (`readMemoryView`, `src/main/assistant/session/memory.ts`);
  - `src/main/mcp/app-server.ts:298-307` (`act`) и `:447-453` (`action_run`).
- Не меняется, только сверить: `src/main/assistant/actions/auto.ts:64` (main сам делает только действия закрытого
  списка, `pr-follow` в нём нет).
- Test-ы: `test/unit/assistant-duties.test.ts` (`:432-445`: список и `configure`), `test/unit/assistant-session.test.ts`
  (`:270`, `:312`), `test/contract/worfy-app-tools.test.ts` (`:470-560`, `:874`). Эти test-ы выбирают
  `pr-follow: pre-approved` как способ разрешить действие (так их перевёл Ticket 24) — теперь этот путь закрыт.

## Решения

- ADR не меняется: решение владельца следует ADR-0114 (сам Assistant делает только действия закрытого списка), а не
  меняет его. Поправку ADR, если агент найдёт её нужной, пишет Orchestrator.
- `autopilot-start` не меняется: он только открывает диалог Start Autopilot, и диалог и есть подтверждение
  пользователя (решение владельца 2026-11-26, первый раунд, Q2).
- После этого Ticket-а `action_run` не запускает `pr-follow` ни в каком режиме. Оставить ли `pr-follow` в
  `APP_ACTIONS` (`src/shared/assistant/app-tools.ts:22`) с одним отказом или убрать его из `action_run` вместе с
  веткой `act` и зависимостью `prFollow`, агент решает сам и пишет в «Решено без владельца». Test-ы, которые проверяют
  ветку `pr-follow` (отказ main, пока идёт Autopilot; строка журнала), остаются или уходят вместе с ней.

## Test-ы

- Unit test обязанностей: `configure` с `pr-follow: pre-approved` и `pr-follow: self` бросает, режимы не меняются;
  `ask` и `hand-over` принимаются; `autopilot-start: pre-approved` и `autopilot-start: self` принимаются, как сейчас.
  Сначала красный на нынешнем коде.
- Unit test: файл памяти с `pr-follow: pre-approved` читается, предложение `pr-follow` идёт с режимом `ask`; первое
  сообщение Session Assistant-а не показывает `pre-approved`.
- Contract test `worfy-app`: `action_run` с `pr-follow` при режиме `pre-approved`, пришедшем в обход `configure` и
  файла памяти, отказывает, ничего не запущено, строка журнала записана (или, если агент убрал `pr-follow` из
  `action_run`, — отказ неизвестного действия).

## Готово, когда

- [ ] Unit test: `pre-approved` и `self` для `pr-follow` нельзя выбрать в `Duties.configure`; `ask`, `hand-over` и
      режимы остальных действий — как сейчас.
- [ ] Unit test: `pre-approved` для `pr-follow` из файла памяти читается как `ask`.
- [ ] Contract test: `action_run` не запускает `pr-follow` в режиме `pre-approved`.
- [ ] Settings не предлагает `pre-approved` для `pr-follow` (test, если Ticket 15 влит; иначе строка в «Итог»).
- [ ] «Итог»: все места, где `pre-approved` для `pr-follow` теперь отклоняется, с `file:line`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
