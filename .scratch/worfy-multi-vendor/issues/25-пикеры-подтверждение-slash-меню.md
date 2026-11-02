# 25 — Пикеры, диалог подтверждения и slash-меню по capabilities

Type: task
Status: open
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
