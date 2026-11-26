# 26 — Действие `pr-follow` только `ask` или `hand-over`: режим `pre-approved` для него тоже запрещён

Type: task
Status: claimed 2026-11-26T10:01Z
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
  user's «yes» given in advance» (`duties.ts:33`);
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
  - evidence: test-run pass · `pnpm test test/unit/assistant-duties.test.ts` exit 0 · mac - · 193eca821
- [ ] Unit test: `pre-approved` для `pr-follow` из файла памяти читается как `ask`.
  - evidence: test-run pass · `pnpm test test/unit/assistant-duties.test.ts test/unit/assistant-session.test.ts` exit 0 · mac - · 193eca821
- [ ] Contract test: `action_run` не запускает `pr-follow` в режиме `pre-approved`.
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 193eca821
- [ ] Settings не предлагает `pre-approved` для `pr-follow` (test, если Ticket 15 влит; иначе строка в «Итог»).
  - evidence: test-run pass · `pnpm test test/unit/assistant-settings-panel.test.ts test/unit/settings-assistant.test.tsx test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 193eca821
- [ ] «Итог»: все места, где `pre-approved` для `pr-follow` теперь отклоняется, с `file:line`.
  - evidence: commit pass · worfy-assistant/26: pr-follow is only ask or hand-over; action_run no longer runs it · - - · 193eca821
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 193eca821

## Итог

У `pr-follow` остались только `ask` и `hand-over`, а `action_run` сервера `worfy-app` больше не знает действия
`pr-follow`: Assistant его только предлагает, запускает пользователь. Все места отказа читают один список.

- **Список** — `DUTY_ACTION_ALLOWED_MODES['pr-follow']` = `ask`, `hand-over` (`src/shared/assistant/duties.ts:45`),
  комментарий над списком (`:30-38`) говорит, почему и `pre-approved` запрещён. `autopilot-start` и остальные
  действия — все четыре режима, как было.
- **Отказ при выборе** — `Duties.configure` (`src/main/assistant/duties/duties.ts:190`): `pr-follow: pre-approved`
  бросает «The action pr-follow may not be pre-approved: it may be ask, hand-over», ничего не меняется.
- **Отказ при чтении** — `dutyModesSchema` (`src/main/assistant/duties/memory.ts:28`): `pre-approved`, выбранный до
  этого Ticket-а, читается как не выбранный — действует `ask` по умолчанию, одна строка в log; следующая запись
  обязанностей убирает запись. Первое сообщение Session Assistant-а (`readMemoryView`) читает ту же схему и
  `pre-approved` не показывает.
- **Settings** — экран обязанностей Ticket-а 15 (влит, #2266) берёт режимы из списка: main отдаёт `allowed`
  (`src/main/assistant/settings/panel.ts:63`), экран рисует только их (`src/renderer/settings/AssistantSection.tsx:238`).
  Кнопки «Pre-approved» у `pr-follow` нет.
- **Карточка «было → станет»** — `dutyChangeProblems` (`src/shared/assistant/settings-change.ts:157`) отказывает режим,
  запрещённый действию, в двух местах: `proposal_create` с `change` (`src/main/mcp/app-server.ts:484`) и Apply
  (`src/main/assistant/settings/panel.ts:91`) — так и карточка, созданная до этого Ticket-а, на Apply ничего не меняет.
- **Действие** — `APP_ACTIONS` без `pr-follow` (`src/shared/assistant/app-tools.ts:23`), у `action_run` нет аргумента
  `follow` (`:50`): `action_run` с `pr-follow` в любом режиме — отказ схемы, main ничего не запускает. Ушли ветка
  `pr-follow` в `act`, `prOf` и зависимость `prFollow` сервера (`src/main/mcp/app-server.ts`).
- **Тексты для модели** — описание `action_run` (`src/shared/assistant/app-tools.ts:96-97`), правила Session
  (`src/main/mcp/agent-instructions-app.md:19-20`) и комментарий в начале `app-server.ts` (`:19-25`): `pr-follow` всегда
  предложение или дело пользователя.
- Не менялось, сверено: `src/main/assistant/actions/auto.ts:64` — main сам делает только действия закрытого списка
  (`isClosedAction`), `pr-follow` в нём нет.
- Test-ы: `test/unit/assistant-duties.test.ts` (список; `configure` отказывает `self` и `pre-approved`, принимает `ask`,
  `hand-over` и все режимы `autopilot-start`; файл памяти с `pre-approved`), `test/unit/assistant-session.test.ts`
  (первое сообщение без `self` и `pre-approved`), `test/unit/assistant-settings-panel.test.ts` (`allowed` у `pr-follow`;
  Apply отказывает `pre-approved`), `test/unit/settings-assistant.test.tsx` (кнопки «Pre-approved» нет),
  `test/contract/worfy-app-tools.test.ts` (`proposal_create` с `pr-follow: pre-approved` отказан; `action_run` с
  `pr-follow` в любом режиме, пришедшем в обход обязанностей, отказан, ничего не запущено, журнал пуст).

### Решено без владельца

1. **`pr-follow` убран из `action_run`, а не оставлен с одним отказом.** После этого Ticket-а ни один режим `pr-follow`
   не доходит до запуска: `ask` и `hand-over` `action_run` отказывает раньше. Оставленная ветка запуска была бы кодом,
   до которого не дойти и который не проверить test-ом; список действий в схеме tool-а сам говорит модели, что
   `pr-follow` она не делает. Цена: test-ы ветки `pr-follow` (отказ launcher-а, пока идёт Autopilot; строка журнала
   этого отказа) ушли вместе с ней; строку журнала и «журнал не записан — ответ остаётся» теперь проверяет
   `autopilot-start`. Отказ launcher-а при Autopilot проверяют его собственные test-ы. Если владелец снова разрешит
   `pre-approved`, ветку придётся вернуть (её прежний вид — в коде после PR #2260 Ticket-а 24).
2. **Проверка режима в `act` осталась** (Ticket 24): она общая для любого действия `action_run` и сработает, если список
   режимов сузят для `autopilot-start` или действия закрытого списка. Сегодня она не срабатывает: у оставшихся действий
   разрешены все четыре режима.
3. **Тексты для модели говорят про `pr-follow` прямо** — в описании `action_run` и в правилах Session: иначе модель,
   увидев у элемента `pr-follow` с режимом `ask`, могла бы попробовать `action_run` и получить только отказ схемы без
   объяснения.
4. **Test IPC `assistant.configureDuty`** (`test/contract/assistant-settings.test.ts`) теперь передаёт
   `pr-follow: hand-over`: схема IPC режимы не сужает (это делает `Duties.configure`), но пример запрещённого режима в
   test-е вводил бы в заблуждение.
