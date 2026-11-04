# 04 — Claude: политика в unattended canUseTool, Shadow, строка Journal

Type: task
Status: open
Blocked by: 03, 06, 12
Source: [spec.md](../spec.md), «Как работает», п. 1, 3, 7; «Решено без владельца», п. 4–6; «Безопасность», п. 5, 7

Глубина ревью: high (подключение решения к живому driver-у).

## Что происходит

- `unattendedCanUseTool` (`src/main/vendors/claude/session.ts:133-140`) отказывает на всё; выбор — `:391`.
- `SessionStart` (`src/main/vendors/session.ts:68-90`) не несёт ни режима, ни политики.
- `refused` → `Session.refuseDialog` (`src/main/agent/session.ts:199-202`, `:529`) → событие `refused_dialog` →
  строка `refused-dialog` (`src/main/autopilot/run.ts:1152-1154`).
- `TMPDIR` Session-у worfy не задаёт: `mktemp -d` уходит в общий системный temp.

## Что делаем

1. `SessionStart` получает `approval: { mode(): 'off' | 'shadow' | 'on'; judge(request): Decision }` (режим читается
   при каждом запросе, из настройки Ticket-а 06). `agent/session.ts` собирает `context` (корни Wave, папка Run-а,
   живые Session-ы из `SessionRegistry`) и передаёт его.
2. `unattendedCanUseTool` при `off` — как сегодня, ровно. При `shadow` — `judge`, событие решения с `would-*`, агенту
   прежний отказ. При `on`: allow → `{ behavior: 'allow', updatedInput: input }`; deny / hard-deny → `deny` с
   подсказкой правила (после `decisionReason`, как `unattendedDeniedMessage`); park → передаёт запрос Ticket-у 07
   (здесь — заготовка: park ведёт себя как deny, пока 07 не влит).
3. Новое событие `auto_approval` (`src/shared/agent/events.ts`) и строка Journal `auto-approval`
   (`src/shared/autopilot/journal.ts`, поля — spec, п. 7; очистка команды: `~` вместо домашней папки, `NAME=***` для
   секретных имён, не длиннее 200). `run.ts` пишет её на каждое событие; `run-started` получает поле `autoApproval`.
   Исходы `park-answered`, `park-expired` в схеме есть сразу (их пишет 07).
4. Папка Run-а `<WORFY_DATA_DIR>/autopilot-tmp/<run>/` создаётся при старте Run-а, уходит в `TMPDIR` окружения
   Claude Code (`options.ts`), удаляется при `run-stopped` (по буквальному пути). Проверить, меняет ли `TMPDIR` папку
   scratchpad Claude Code; результат — в «Итог».

## Готово, когда

- [ ] Contract test на fake agent: при `off` поток событий и Journal байт в байт как сегодня (сравнение с записью до
      правки).
- [ ] Contract test: `shadow` — агент получает прежний текст отказа, в Journal `would-allow` с правилом.
- [ ] Contract test: `on` — запрос внутри worktree Wave проходит; вне корня — deny с подсказкой; hard deny — отказ.
- [ ] Unit test очистки: домашняя папка, `GH_TOKEN=…`, длинная команда — в строке Journal нет ни секрета, ни пути дома.
- [ ] Переключение режима во время Run-а действует со следующего запроса; строка Journal называет режим.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/auto-approve-claude.test.ts` (новый); fake agent `WORFY_AGENT=fake` со скриптом, который
  зовёт `canUseTool` с `decisionReason`.
- Прогнать все test-ы модуля: `test/unit/autopilot-*.test.ts`, `test/contract/autopilot-*.test.ts`,
  `test/unit/permissions*.test.ts`, `test/unit/journal*.test.ts`.

## Где в коде

- `src/main/vendors/session.ts`, `src/main/vendors/claude/session.ts`, `src/main/vendors/claude/options.ts`
- `src/main/agent/session.ts`, `src/shared/agent/events.ts`
- `src/shared/autopilot/journal.ts`, `src/main/autopilot/run.ts` (общие с worfy-retry 04 / 05 — не параллельно)
- `test/contract/auto-approve-claude.test.ts` (новый)
