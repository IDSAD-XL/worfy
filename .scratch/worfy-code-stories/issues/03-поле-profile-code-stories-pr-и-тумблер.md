# 03 — Поле Profile `code_stories.pr` и тумблер в Project settings

Type: feature
Status: claimed 2026-11-15T23:45Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 03; «Решения владельца» 14, 25 (строки 113, 129–131);
«Решения по реализации» → Harness: «Настройка» (строки 234–235); история 26

Кто: агент.

## Что происходит

- Harness читает только поля Profile. Настройки worfy (`settings.json` Project-а) до него не доходят. Поэтому
  выключатель story PR — поле Profile, а не настройка worfy (решение 25).
- Поля Profile описаны в `harness/profiles/draft.schema.json` и `harness/profiles/README.md`; читает их `harness/bin/profile`,
  пишет `harness/bin/profile-set --field`.
- worfy уже пишет поля Profile через `profile-set --field` — так устроены переключатель Eco
  (`src/main/ipc/eco-mode.ts`, ADR-0073) и Settings → Plan (`src/main/ipc/plan-preset.ts`). Каждая запись несёт
  `--expect` с fingerprint-ом, который окно прочитало. worfy сам Profile не пишет (ADR-0002, ADR-0005).
- По этому полю Ticket 05 решает, писать ли story PR и включать ли guard.

## Что делаем

1. Поле `code_stories.pr` в `draft.schema.json` и строка в `profiles/README.md`. Значения включено и выключено. Нет поля —
   включено (решение 14: «Включена, с выключателем»).
2. `bin/profile --field code_stories.pr` печатает значение с учётом значения по умолчанию.
3. `bin/profile-set --field code_stories.pr` пишет поле и не трогает остальные.
4. Тумблер «Code stories for PRs» (текст UI — на английском) в Project settings (`src/renderer/shell/ProjectSettings.tsx`).
   Он показывает текущее значение и пишет его через `profile-set` — по образцу Eco: `--expect`, ошибка `profile-set`
   видна в окне. Окно Linked machine с доступом только на чтение показывает тумблер неактивным.

## Готово, когда

- [ ] `harness/bin/tests/profile.test.sh`: без поля `--field code_stories.pr` печатает включённое значение; с
      выключенным — выключенное.
- [ ] `harness/bin/tests/profile-set.test.sh`: `--field code_stories.pr` пишет поле, остальные поля Profile те же
      байт в байт; неверное значение — отказ с exit code не 0.
- [ ] Contract test канала (по образцу `test/contract/eco-mode.test.ts`): запись идёт через `profile-set` с
      `--expect`; Profile, изменённый между чтением и записью, не пишется.
- [ ] Unit test `test/unit/project-settings-shell.test.tsx`: тумблер показывает значение Profile; клик шлёт
      выключение; ошибка `profile-set` видна; на Linked machine только для чтения тумблер неактивен.
- [ ] lint, typecheck, test-ы модуля, все `harness/bin/tests/*.test.sh` и gate fast — exit 0.

## Тесты

- Shell-test-ы Harness-а и contract/unit test-ы worfy из пунктов выше; каждый сначала красный.

## Где в коде

- `harness/profiles/draft.schema.json`
- `harness/profiles/README.md`
- `harness/bin/profile`
- `harness/bin/profile-set`
- `harness/bin/tests/profile.test.sh`, `harness/bin/tests/profile-set.test.sh`
- `src/main/ipc/code-stories-setting.ts` (новый; или раздел в `src/main/ipc/eco-mode.ts`, если общий код короче)
- `src/shared/ipc/` — канал домена (новый файл или `src/shared/ipc/eco-mode.ts`)
- `src/renderer/shell/ProjectSettings.tsx`
- `test/contract/code-stories-setting.test.ts` (новый)
- `test/unit/project-settings-shell.test.tsx`

Только читать: `src/main/ipc/eco-mode.ts`, `src/main/ipc/plan-preset.ts`, `test/contract/eco-mode.test.ts`.

## Вне скоупа

- Что делает поле: шаг implementer-а и guard — Ticket 05.
