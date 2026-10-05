# 20 — Поле ввода: slash-команды и skills с автодополнением, файлы и картинки во вложениях

Type: task
Status: open
Blocked by: 19
Source: [BRIEF.md](../../../docs/design/BRIEF.md), Screen 2 (slash autocomplete); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md), вложения; [F-SPEC.md](../../../docs/design/F-SPEC.md), «macOS popovers (slash autocomplete)»

## Что делаем

- `/` в начале поля открывает popover в стиле macOS (`SlashMenu.tsx`): slash-команды и skills
  Сессии. Источник — `slash_commands` из `init` и `supportedCommands()` (`src/main/agent/commands.ts`),
  значит, там и skills пользователя из `~/.claude` (`/ship-ticket`, `/epic-wave`, `/retro`).
  Фильтр по набранному, ↑/↓ — выбор, Tab или Enter — подставить, Esc — закрыть. У пункта —
  описание, если SDK его даёт.
- Вложения (`src/main/agent/attachments.ts`):
  - «+» — системный выбор файлов; перетаскивание файлов на Узел или Session view; вставка
    картинки из буфера;
  - картинки (png, jpeg, gif, webp, до 5 МБ) уходят блоком изображения в сообщении пользователя;
  - прочие файлы — путями в конце сообщения строкой «Attached files: …»; файл вне Проекта
    копируется в `<папка Проекта>/attachments/`, в репозиторий ничего не пишется;
  - вложения видны chip-ами до отправки, каждое можно убрать.
- Слишком большой файл или неподдержанный тип — сообщение у поля ввода, отправка не ломается.
- Fake-агент (`fake-query.ts` из 07) учится записывать сообщение пользователя целиком, с блоками
  изображений, и отдавать список команд из сценария.

## Готово, когда

- [ ] `/sh` показывает `/ship-ticket` (fake-агент отдаёт список команд, как в fixture `init`); Tab подставляет.
- [ ] Вставленная из буфера картинка уходит блоком изображения (fake-агент записывает сообщение).
- [ ] Перетащенный файл вне Проекта копируется в `attachments/` и уходит путём; `git status --porcelain` Проекта пуст.
- [ ] Файл больше лимита отклоняется с сообщением.
- [ ] Ручной прогон с настоящим SDK: `/ship-ticket` и `/epic-wave` есть в меню на репозитории worfy.

## Тесты

- `test/unit/attachments.test.ts` — сборка сообщения с картинкой и путями, лимиты, копирование (новый).
- `test/e2e/message-input-slash.spec.ts` — меню, фильтр, Tab, вставка картинки (новый).
- Сначала падающий test: `attachments.test.ts` на картинку больше лимита.

## Где в коде

- `src/renderer/session/MessageInput.tsx`, `src/renderer/session/SlashMenu.tsx`
- `src/main/agent/commands.ts`
- `src/main/agent/attachments.ts`
- `src/main/agent/fake-query.ts` — запись блоков изображений, список команд
