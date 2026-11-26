# 24 — Действие `pr-follow` не выше `ask`/`pre-approved`: режим `self` для него запрещён

Type: task
Status: claimed 2026-11-26T03:53Z
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant- test/contract/assistant- test/contract/worfy-app test/unit/worfy-app` exit 0 · mac - · 7f1c88660686b8069baf638b5ee86961c9b90aa9
- [ ] Unit test: `self` для `pr-follow` из файла памяти читается как `ask`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant- test/contract/assistant- test/contract/worfy-app test/unit/worfy-app` exit 0 · mac - · 7f1c88660686b8069baf638b5ee86961c9b90aa9
- [ ] Contract test: `action_run` отказывает `pr-follow` в режиме `self`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant- test/contract/assistant- test/contract/worfy-app test/unit/worfy-app` exit 0 · mac - · 7f1c88660686b8069baf638b5ee86961c9b90aa9
- [ ] «Итог»: все места, где режим `self` для `pr-follow` теперь отклоняется, с `file:line`.
  - evidence: commit pass · worfy-assistant/24: pr-follow is never self — refused when chosen, when read from the memory file and in action_run · - - · 7f1c88660686b8069baf638b5ee86961c9b90aa9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 7f1c88660686b8069baf638b5ee86961c9b90aa9

## Итог

Один список и три места отказа; `autopilot-start` и `pre-approved` у `pr-follow` не менялись.

- **Список** — `DUTY_ACTION_ALLOWED_MODES` и `dutyActionModeAllowed` (`src/shared/assistant/duties.ts:38-48`): у
  `pr-follow` — `pre-approved`, `ask`, `hand-over`, у остальных действий — все четыре режима. Test проверяет, что
  каждый режим по умолчанию встроенных обязанностей в этом списке.
- **Отказ при выборе** — `Duties.configure` (`src/main/assistant/duties/duties.ts:184`): `pr-follow: self` бросает
  «The action pr-follow may not be self: it may be pre-approved, ask, hand-over», и ничего не меняется (проверка идёт
  до `change()`).
- **Отказ при чтении** — схема файла памяти (`src/main/assistant/duties/memory.ts:19-31`, `dutyModesSchema`): режим,
  которого у действия быть не может, читается как не выбранный (действует режим обязанности по умолчанию, `ask`), одна
  строка `console.warn` на чтение; остальные записи файла читаются как записаны. Схему читают оба читателя файла —
  обязанности (`memoryFileStore`) и первое сообщение Session Assistant-а (`readMemoryView`,
  `src/main/assistant/session/memory.ts:107-108`), — так что `self` не попадает и в память, которую видит модель.
- **Отказ при действии** — `act` сервера `worfy-app` (`src/main/mcp/app-server.ts:303-307`): `pr-follow` с режимом
  `self`, пришедшим в обход двух защит выше, отказывает с причиной и строкой журнала (`outcome: 'refused'`), main ничего
  не запускает.
- Не менялось, сверено: `src/main/assistant/actions/auto.ts:64` — main сам делает только действия закрытого списка
  (`isClosedAction`), `pr-follow` в нём нет; `src/main/assistant/actions/closed-list.ts:89-95` (`modeAllows`) — только
  для закрытого списка.
- Где ещё мог бы прийти `self` для `pr-follow`: экран настроек Ticket-а 15 (идёт через `Duties.configure` и должен
  предлагать только `DUTY_ACTION_ALLOWED_MODES`); будущий tool `worfy-app`, меняющий режимы (такого нет — сейчас агент
  режимов не меняет); файл памяти, записанный руками или старой сборкой (закрыто схемой); подмена `duties.look` в
  `worfy-app` (закрыто проверкой в `act`).
- Test-ы: `test/unit/assistant-duties.test.ts` (список, `configure`, файл памяти с `self`),
  `test/unit/assistant-session.test.ts` (первое сообщение не показывает `self`), `test/contract/worfy-app-tools.test.ts`
  (`action_run` при `self`). Test-ы, которые выбирали `pr-follow: self` как способ разрешить действие, теперь выбирают
  `pre-approved`: путь тот же (решение 2 Ticket-а 09).

### Решено без владельца

1. **Файл памяти с `self` у `pr-follow` не отбрасывается целиком.** Схема с отказом сделала бы весь файл нечитаемым:
   `readJsonFile` отложил бы его в сторону, и пользователь потерял бы счётчики, паузы, правила и обязательства. Поэтому
   отказ — только этой записи: она читается как не выбранная, и действует режим по умолчанию (`ask`).
2. **Следующая запись обязанностей убирает эту запись из файла.** Обязанности пишут то, что прочитали, а прочитали они
   без `self`; так файл снова совпадает с тем, что действует, и строка в log перестаёт повторяться. До первой записи
   строка пишется на каждое чтение файла (обязанности, первое сообщение Session), а не один раз за запуск: так в log
   не нужно держать память о том, что уже сказано.
3. **Строка журнала при отказе в `action_run` пишется с режимом `self`** — тем, который отказан, — чтобы по журналу было
   видно, что режим пришёл в обход двух защит.
4. **Описание tool-а `action_run` и правила Session Assistant-а не менялись** (пункт 6 «Что строить»): модель видит
   режимы только в `items_list`, и `self` у `pr-follow` там больше не бывает; tool-а, который меняет режимы, у неё нет.
   Лишняя фраза об исключении расходовала бы контекст каждой Session и не меняла бы поведения.
5. **Страница `docs/features`** не правилась: режимы обязанностей Assistant-а ни одна страница пока не описывает.
