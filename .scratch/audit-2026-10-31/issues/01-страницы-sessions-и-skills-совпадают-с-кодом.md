# 01 — Страницы Sessions и Skills называют оба поля Eco mode и линзу documentation

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), раздел «Находки», находки documentation-1, documentation-2

## Что делаем

- `docs/features/sessions.md:130`: Eco mode пишет `workflow.agents` и `agents`; выключение убирает оба поля и не возвращает
  прежние модели ролей. В таблице файлов появляются `src/main/ipc/eco-mode.ts` и `src/renderer/session/composer/EcoMode.tsx`.
- `docs/features/skills-agents-and-hooks.md:133`: линз с записанными правилами три; поле `docs.feature_pages` в списке того,
  что меняет Profile.
- Переводы тем же PR.

## Готово, когда

- [x] `grep -n 'eco-mode' docs/features/sessions.md` находит строку таблицы, страница называет оба поля.
- [x] `grep -n 'feature_pages' docs/features/skills-agents-and-hooks.md` находит поле и линзу.
- [x] `node scripts/check-feature-docs.mjs` и `node scripts/feature-docs-lag.mjs` — exit code 0.

## Тесты

Новых test-ов нет: только документы.

## Где в коде

- `docs/features/sessions.md`, `docs/features/skills-agents-and-hooks.md` и их переводы в `docs/features/ru/`.
