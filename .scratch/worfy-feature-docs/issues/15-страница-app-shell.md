# 15 — Страница App shell

Type: task
Status: done 2026-10-30T23:41Z
PR: #1077
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/app-shell.md` и
  `docs/features/ru/app-shell.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/app-shell.md` на английском, по разделу на каждый Feature:
- Command palette.
- Shortcuts.
- Menu.
- Settings.
- Theme.
- Уведомления.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/app-shell.md`: перевод с шапкой `> Перевод [английской версии](../app-shell.md), commit `same-pr`.`
   под заголовком. Термины и названия UI остаются на английском.
7. Индекс не правит (Q22).

## Готово, когда

- [ ] Обе страницы в `main`, заготовки заменены, разделы соответствуют списку или отличия объяснены в
      `## Итог`.
- [ ] Страница на английском, это не ошибка: для `docs/features/` действует исключение ADR-0088.
- [ ] Review: один агент уровня `low` сверяет каждое утверждение с кодом и проверяет, что на странице нет
      номеров строк. Merge блокирует только неверное утверждение (Q21; исключение из правила о PR только с
      документами, раздел «Исключения» spec-а). Отчёт review называет уровень и потраченные токены.
- [ ] `ci-ok` зелёный. Gate full не нужен: код не меняется.
- [ ] `## Итог` называет утверждения, которые не подтвердились. Токены на страницу записывает Orchestrator
      при закрытии Ticket-а, не implementer.

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 читает английскую страницу.

## Где в коде

Папки выведены из имён, код при составлении Ticket-а не читался. Автор проверяет список при claim и дополняет:

- `src/main/actions`
- `src/shared/actions`
- `src/renderer/palette`
- `src/shared/shortcuts.ts`
- `src/renderer/shortcuts`
- `src/main/menu.ts`
- `src/main/settings`
- `src/shared/settings`
- `src/renderer/settings`
- `src/renderer/theme`
- `src/main/notify.ts`
- `src/renderer/toast`
- `src/renderer/shell`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

**Разделение страницы.** Шесть разделов дали 550 строк. Раздел «Уведомления» вынесен в `docs/features/notifications.md`, перевод
в `docs/features/ru/notifications.md`. `docs/features/app-shell.md` теперь держит Command palette, Shortcuts, Menu, Settings и Theme и
ссылается на новую страницу. Индекс `docs/features/README.md` и таблица spec-а не правились: новую страницу в них добавляет отдельный PR.

**Утверждения, которые не подтвердились и на страницу не пошли.**

- Комментарий `src/main/app-id.ts`: dev-запуску на Windows нужно закрепить `electron.exe` в меню Start, иначе уведомлений нет. Это
  ссылка на документацию Electron, код и test-ы показывают только выбор id. На странице оставлен только выбор id.
- Комментарий `src/renderer/theme/tokens.css` говорит о настройке macOS. Что `prefers-color-scheme` следует теме Windows, код и test-ы
  отдельно не показывают. На странице раздел Windows описывает только рамку и цвет фона, общее поведение описано без платформы.
- `.w-mono`: «Every id, path, number, branch, model and cost» — правило в комментарии CSS, по всем местам не сверялось. Убрано.
- Комментарий `EmptyPalette` «only the view commands are left» неточен: без Project-а есть ещё строки Project и строки машин. На странице
  написано по коду.

**Возможные баги продукта (код не менялся, приложение не запускалось).**

- Windows: при открытых Settings клавиша Ctrl+/ ничего не делает. Меню её не забирает (`rendererCatchesOn`), а модальный guard
  `src/renderer/settings/settings-window.ts` останавливает её до обработчика `src/renderer/shortcuts/ShortcutsOverlay.tsx`. На macOS то же
  сочетание показывает раздел Shortcuts через меню. `test/e2e/shortcuts.spec.ts` проверяет только клик по пункту меню.
- В палитре нет команды перехода на вид Pipeline: есть Switch to Canvas и Switch to Session, а Pipeline открывается только другими путями.

**Сверка папок из «Где в коде».** Все 13 путей существуют. `src/main/actions` и `src/shared/actions` относятся к запуску Ship ticket и Run
wave: на этой странице это только то, что вызывает палитра, основное описание — дело страницы Workflow. Список стоит дополнить:
`src/renderer/find/search-index.ts`, `src/main/claude-home/search.ts`, `src/renderer/platform.ts`, `src/renderer/menu-command.ts`, `src/main/ipc/menu.ts`,
`src/main/ipc/view.ts`, `src/main/window-frame.ts`, `src/main/foreground.ts`, `src/main/app-id.ts`, `src/main/notify-pending.ts`,
`src/main/workflow/waits-notify.ts`, `src/main/link/notes.ts`, `src/renderer/canvas/overlays/NotificationTarget.tsx`.

