# 25 — Пикеры, диалог подтверждения и slash-меню по capabilities

Type: task
Status: done 2026-11-03T10:55Z
PR: #1282
Blocked by: 22, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 4–6, 11, «Модель» (Capabilities); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md), «Как показывать то, чего Vendor не умеет»)

## Что происходит

- Пикеры Model, effort и permission — `src/renderer/session/composer/Pickers.tsx`; списки — постоянные
  (`PERMISSION_MODES`, `EFFORT_LEVELS`, `src/shared/agent/settings.ts:8`, `:13`).
- Диалог подтверждения — `src/renderer/session/PermissionCard.tsx`; после Ticket-а 14 варианты приходят в событии.
- Slash-меню — `src/renderer/session/SlashMenu.tsx`, строки — `src/main/agent/commands.ts`.

## Что делаем

1. Пикеры читают capabilities Vendor-а Session: Model — список Vendor-а, effort — `effortLevels`, permission —
   `permissionPresets` с подписью и описанием Vendor-а.
   - Модель Vendor-а по умолчанию пикер передаёт как `setModel(null)`; свою строку `'default'` driver Claude
     переводит в `null` (Ticket 14).
   - Список `models` Vendor-а пуст (живого запроса нет) — пикер Model оставляет нынешнюю строку с моделью из
     `system/init` (`src/main/agent/session.ts:445-446`).
   - Подписи presets Claude в `src/shared/vendors/capabilities.ts:95-98` повторяют `MODE_LABELS`
     (`src/renderer/session/composer/Pickers.tsx:21-25`). Ticket оставляет один источник: пикер берёт подписи из
     `permissionPresets`, `MODE_LABELS` удаляется.

   Три решения выше — решено Orchestrator-ом 2026-11-02 по поручению владельца, подтверждено владельцем 2026-11-05.
2. Недоступное — недоступным с tooltip причины из capabilities («Codex does not support …»); скрыто только то, что
   для Vendor-а смысла не имеет.
3. Диалог подтверждения у Codex: `subject` — команда (с `cwd`) или список файлов; кнопки — варианты Codex.
4. Slash-меню берёт строки части commands driver-а Session (`src/main/agent/commands.ts` зовёт driver).
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/25/`.

## Готово, когда

- [ ] e2e (фейк Codex): presets «Read only», «Auto», «Full access»; approval команды — диалог с четырьмя
      вариантами, ответ уходит в фейк; slash-меню — skills сценария и `/compact`.
- [ ] Unit test: недоступная возможность — элемент недоступен, tooltip — причина из capabilities.
- [ ] Claude Session: пикеры, диалог и slash-меню — как до Epic-а (существующие test-ы без правок ожиданий).
- [ ] Снимки обеих тем в `evidence/25/`.
- [ ] `pnpm typecheck`, `pnpm lint`, unit test-ы renderer-а Session и e2e spec — exit 0.

## Где в коде

- `src/renderer/session/composer/Pickers.tsx`
- `src/renderer/session/PermissionCard.tsx`
- `src/renderer/session/SlashMenu.tsx`
- `src/main/agent/commands.ts`
- Test-ы: `test/unit/pickers-captions.test.tsx`, `test/unit/permission-card.test.tsx`,
  `test/unit/message-input-slash.test.tsx`, `test/e2e/codex-session.spec.ts` (новый), `scripts/e2e-specs.table.json`

## Итог

- Пикеры (`src/renderer/session/composer/Pickers.tsx`) читают capabilities Vendor-а Session через новый канал
  `agent.capabilities` (`src/shared/ipc/agent.ts`, `src/main/ipc/agent.ts` → `Session.capabilities()` → `capabilities(handle)`
  driver-а). Permission — `permissionPresets` с подписью Vendor-а, описание preset-а — tooltip строки списка (новое поле
  `title` у `SelectOption`, `src/renderer/theme/Select.tsx`); `MODE_LABELS` удалён, подписи Claude — только в
  `CLAUDE_CAPABILITIES`. Effort — отметки в порядке `effortLevels` Vendor-а; пустой список моделей — все уровни Vendor-а.
  Model — строки `agent.models` (у Claude — supportedModels(), у Codex — `model/list` с «Default (…)» = `setModel(null)`);
  пустой список — строка с моделью из `system/init`, как раньше.
- Недоступное: Vendor без `modelSwitchStable` — пикер Model неактивен, tooltip — причина из `unsupported`. Slash-меню
  Vendor-а без `commandsComplete` (Codex) — последняя неактивная строка «Not every command is listed», tooltip — причина.
  Session, чьи capabilities main не дал, считается Session Claude Code (как Node без Vendor-а) — решено без владельца,
  подтверждено владельцем 2026-11-05.
- Настройки Session несут id preset-а и уровень effort Vendor-а (`src/shared/agent/settings.ts`): схема принимает id,
  которые даёт хоть один Vendor (режимы Claude, `read-only` / `auto` / `full-access`, уровни Claude и `none` / `minimal`),
  чужое по-прежнему отказывается на входе IPC. Session отказывает в preset-е и уровне, которых нет у её Vendor-а
  (`offeredRefusal` в `src/main/agent/session.ts`). Новая Session Codex переводит настройки в термины Codex
  (`SessionPart.settingsFor`, `codexSettings`): `bypassPermissions` по умолчанию → «Full access», `acceptEdits` → «Auto»,
  `default` и `plan` → «Read only», `max` → default. Shortcut-ы тикетов 20 и 23 (`PRESET_OF_CLAUDE_MODE` как единственный
  путь, `pickerEfforts` только с уровнями Claude) сняты. Решено без владельца, подтверждено владельцем 2026-11-05: схема перечисляет id всех
  Vendor-ов (`OTHER_VENDOR_PRESETS`, `OTHER_VENDOR_EFFORTS`, сверка с driver-ом — `test/unit/codex-capabilities.test.ts`),
  а не принимает любую строку — так старые test-ы Claude держат свои ожидания.
- Claude Code с сохранённым чужим id (не дойдёт через пикер, только из файла) стартует в `default` и без effort
  (`claudeMode`, `claudeEffort` в `src/main/vendors/claude/options.ts`) — решено без владельца, подтверждено владельцем 2026-11-05.
- Диалог подтверждения (`src/renderer/session/PermissionCard.tsx`) читает input по форме, без имени Vendor-а: команда с
  `cwd` — команда целиком и строка `in <cwd>`; `changes` с `path` — файлы по строке. Кнопки — варианты Vendor-а в его
  порядке (у Codex четыре).
- Slash-меню берёт строки из части commands driver-а: `Session.commands()` зовёт `commands.list(handle)` (а не handle
  напрямую). `src/main/agent/commands.ts` остался каталогом Claude, который зовёт commands Claude-driver-а.
- e2e `test/e2e/codex-session.spec.ts` (фейк, сценарий `test/fixtures/codex-scripts/session-controls.jsonl`): presets «Read
  only», «Auto», «Full access»; выбор «Auto» уходит в `turn/start` (`on-request` + `workspaceWrite`); slash-меню —
  `/compact`, `/review`, skills сценария `release-notes`, `triage` и строка о неполном списке; approval команды — диалог с
  четырьмя вариантами, `accept` доходит до фейка (`WORFY_CODEX_LOG`). Правило в `scripts/e2e-specs.table.json` —
  `src/main/vendors/codex/approvals.ts` → этот spec.
- Снимки обеих тем (только Session view: боковая панель показывает временную папку машины):
  [presets](../evidence/25/25-presets-light.png) ([тёмная](../evidence/25/25-presets-dark.png)),
  [slash-меню](../evidence/25/25-slash-menu-light.png) ([тёмная](../evidence/25/25-slash-menu-dark.png)),
  [approval](../evidence/25/25-approval-light.png) ([тёмная](../evidence/25/25-approval-dark.png)).
- Не сделано здесь: шапка Session view показывает режим из `init` как есть (`Permissions auto`, а не «Auto»;
  `src/renderer/session/SessionView.tsx`, `permissionLabel`); tooltip кнопки Effort говорит о Claude Code и у Session Codex.
