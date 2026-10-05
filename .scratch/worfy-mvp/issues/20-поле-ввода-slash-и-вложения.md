# 20 — Поле ввода: slash-команды и skills с автодополнением, файлы и картинки во вложениях

Type: task
Status: claimed — 2026-10-05
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

- [x] `/sh` показывает `/ship-ticket` (fake-агент отдаёт список команд, как в fixture `init`); Tab подставляет.
- [x] Вставленная из буфера картинка уходит блоком изображения (fake-агент записывает сообщение).
- [x] Перетащенный файл вне Проекта копируется в `attachments/` и уходит путём; `git status --porcelain` Проекта пуст.
- [x] Файл больше лимита отклоняется с сообщением.
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

## Итог

Сделано: slash-меню (`src/renderer/session/SlashMenu.tsx`) над полем ввода; список команд — канал
`agent.commands`, в main `src/main/agent/commands.ts` (`supportedCommands()` живого query, затем
последний `system/commands_changed`, затем имена `slash_commands`/`skills` последнего
`system/init`). Вложения: `src/main/agent/attachments.ts` (проверка, копирование, сборка сообщения),
общие схемы и лимиты — `src/shared/agent/attachments.ts`, каналы `agent.attach`,
`agent.attachPick` («+», диалог main), `agent.send` с `attachments`. Chip-ы, «+», вставка картинки,
перетаскивание файла на поле ввода — `src/renderer/session/MessageInput.tsx`. Очередь (`queue.ts`)
хранит вложения сообщения. Fake-агент записывает сообщение целиком (`content`, с блоками
изображений) и отвечает `supportedCommands()` из строки `{"fake":"commands"}` или из
`slash_commands` первого `system/init` сценария; директивы разбираются таблицей `DIRECTIVES` —
тикет 21 добавляет свою одной записью.

Проверено: `test/unit/attachments.test.ts`, `test/unit/slash-commands.test.ts`,
`test/unit/message-input-slash.test.tsx`, `test/contract/agent-attachments.test.ts` (отказ на
неверном типе и вырезание лишних ключей на `agent.send`/`agent.attach`; Проект и копия Claude home
не меняются, `git status --porcelain` пуст), `test/e2e/message-input-slash.spec.ts` (снимки
`slash-menu-{light,dark}.png`, `attachments.png` в выводе Playwright).

Падающий первым test: `attachments.test.ts` на картинку больше лимита — на реализации без проверки
лимита упали два test-а («refuses an image larger than 5 MB…», «refuses a pasted image larger than
5 MB»: `expected { ok: true, … } to deeply equal { ok: false, name: 'big.png', … }`), exit code 1;
после проверки лимита — 29 из 29.

Решения, которые не очевидны из кода:

- **Перетаскивание без пути файла.** ADR-0006 запрещает менять preload, а путь перетащенного
  `File` даёт только `webUtils.getPathForFile` в preload. Поэтому renderer читает байты
  перетащенного файла и шлёт их в main (`kind: 'dropped'`): картинка уходит блоком изображения,
  остальное main записывает копией в `<папка данных Проекта>/attachments/`. Цена: перетащенный файл
  из самого Проекта тоже копируется, а не уходит своим путём, и ограничен 20 МБ. Файл, выбранный
  через «+», идёт по пути: внутри Проекта — своим путём, снаружи — копией.
- **Перетаскивание на Узел не сделано.** `SessionNode.tsx` вне следа тикета; файлы принимает поле
  ввода Session view. Узел Сессии — отдельная правка.
- **Лимиты.** Картинка — до 5 МБ (лимит Messages API), тип определяется по первым байтам, а не по
  имени (png, jpeg, gif, webp). Прочий файл, который worfy копирует или несёт через IPC, — до 20 МБ;
  файл внутри Проекта (корень или cwd Сессии) уходит путём при любом размере, его байты не читаются.
  Вставленное из буфера не-изображение отклоняется («not a supported image»).
- **Куда копии.** `<папка данных Проекта>/attachments/<uuid>/<имя>`: отдельный каталог на копию,
  чтобы файлы с одним именем не перезаписывали друг друга. Сессия вне всех Проектов копирует в
  `<WORFY_DATA_DIR>/attachments/`. Очистки старых копий нет.
- **Что видно в транскрипте.** Событие `prompt` и пункт очереди показывают текст сообщения, строку
  `Attached files: …` и строку `Attached images: <имена>`; байты картинок в renderer не уходят.
  Claude Code получает текст и `Attached files: …`, без строки с именами картинок.
- **Пустой текст.** `agent.send` принимает пустой текст, если есть вложения.
- **Вид команды.** Пометка `skill` берётся из `skills` в `system/init`; до первого хода (init
  приходит с первым сообщением) все строки помечены `command`.

не проверено: ручной прогон с настоящим SDK (`/ship-ticket` и `/epic-wave` в меню на репозитории
worfy) — исполнитель работает ночью без владельца, запуск Claude Code с настоящим логином не
делался; пункт остаётся `[ ]`.
