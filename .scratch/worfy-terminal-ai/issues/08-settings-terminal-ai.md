# 08 — Settings → «Terminal AI»: переключатели функций, модель Next command, состояние по Limits

Type: task
Status: open
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 2 (всё выключается в Settings → «Terminal AI»; окно Settings делает Epic worfy-ui), пункт 1(b) (переключатель модели Next command — Sonnet или Haiku), пункт 7 (Epic идёт параллельно с worfy-ui) ([spec.md](../spec.md)); [worfy-ui 02](../../worfy-ui/issues/02-окно-settings.md) (окно Settings, разделы по файлам) и [worfy-ui 08](../../worfy-ui/issues/08-общий-select.md) (общий Select); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 4; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34`

## Что происходит

- Окна Settings в worfy нет. Его делает Ticket 02 Epic-а `worfy-ui`: модальный диалог, раздел — файл
  `src/renderer/settings/<Name>Section.tsx` с компонентом по умолчанию, `order` и `title`; окно
  находит файлы само, его правка не нужна. Общие элементы разделов — `SettingRow` и `SettingSwitch`
  (`src/renderer/settings/controls.tsx`). Выбор из списка — общий `Select` Ticket-а 08 `worfy-ui`
  (`src/renderer/theme/Select.tsx`): native `<select>` в renderer после `worfy-ui` нет (его решение
  владельца 4). `Blocked by` держит только Ticket-ы своего Epic-а, поэтому ожидание — в `Status`.
- После Ticket-а 02 этого Epic-а Settings Terminal AI хранятся в `<WORFY_DATA_DIR>/terminal-ai.json`, схема —
  `src/shared/terminal-ai/settings.ts`. Каналы `terminalAi.state`, `terminalAi.setSettings` и событие
  `terminalAi.changed` — `local`: Settings и состояние — машины экрана, как Limits. Выключенная функция
  сразу перестаёт спрашивать модель.
- После Ticket-а 03 widget узнаёт о выключенном Suggestion сообщением `config`. Поэтому 03 — блокер:
  e2e этого Ticket-а проверяет серый текст из истории.
- Ticket 06 (строка `# …`) — не блокер. Если он к claim влит, e2e проверяет и её; если нет — эта
  проверка остаётся приёмке (Ticket 09).
- Переключатели (Ticket 02 этого Epic-а, пункт 7): «Terminal AI»; «Suggestion»; «Ask Claude when history has
  nothing»; «Next command» и его модель; «Command request»; «Fix». По умолчанию всё включено (решение
  владельца 8(b)), модель Next command — Sonnet.
- Terminal AI работает только в Terminal-ах на zsh (решение 4).
- Состояние Limits worfy показывает `LimitsMeter` в toolbar-е (`src/renderer/shell/toolbar/LimitsMeter.tsx`).

## Что делаем

1. Раздел «Terminal AI» окна Settings `worfy-ui` — `src/renderer/settings/TerminalAiSection.tsx`,
   `order` 50, `title` «Terminal AI»: переключатели Ticket-а 02 этого Epic-а — `SettingSwitch`, выбор модели Next
   command (Sonnet или Haiku) — `Select` Ticket-а 08 `worfy-ui` в `SettingRow`. Подчинённые
   переключатели неактивны, когда выключен «Terminal AI» или их функция.
2. Строка состояния по `terminalAi.state`: у функции, выключенной по Limits, — «Paused by Limits
   until 14:20». Рядом — «Works in zsh Terminals».
3. Изменение — `terminalAi.setSettings`; раздел обновляется по `terminalAi.changed`.
4. Окно на Project-е Linked machine-а показывает Settings своей Machine — каналы `local`.

**Не входит:** само окно Settings и его навигация — `worfy-ui`.

## Готово, когда

- [ ] Unit (jsdom) `test/unit/terminal-ai-settings.test.tsx` (новый): переключатели показывают значения из `terminalAi.state`; клик зовёт `terminalAi.setSettings` с одним изменённым полем; «Terminal AI» выключен — подчинённые неактивны; статус `paused` — строка «Paused by Limits until …» с временем сброса.
- [ ] e2e `test/e2e/terminal-ai-settings.spec.ts` (новый), fake: «Suggestion» выключен — после команды с уникальной меткой набран её префикс, серого текста нет; включён снова — есть. «Terminal AI» выключен — серого текста нет и из истории. Если Ticket 06 к claim влит: «Terminal AI» выключен — строка `# …` + Enter не даёт запроса (журнал fake пуст).
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: раздел «Terminal AI» в светлой и тёмной теме — `../evidence/08-settings-light.png`, `../evidence/08-settings-dark.png`. Как проверить: окно Settings worfy.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — unit «переключатели показывают значения из `terminalAi.state`»: раздела
ещё нет. Как test открывает окно Settings — из «Итог» Ticket-а 02 `worfy-ui` (e2e зовёт пункт меню
«Settings…» по id). В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/settings/TerminalAiSection.tsx` (новый; раздел окна Settings Ticket-а 02 worfy-ui)
- `test/unit/terminal-ai-settings.test.tsx` (новый)
- `test/e2e/terminal-ai-settings.spec.ts` (новый)

Окно Settings находит раздел по файлу (Ticket 02 `worfy-ui`): файлы окна этот Ticket не правит (риск
11 spec-а).

## Итог

Заполняется при закрытии.
