# 13 — Страница Browser

Type: task
Status: done 2026-10-30T23:41Z
PR: #1076
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/browser.md` и
  `docs/features/ru/browser.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/browser.md` на английском, по разделу на каждый Feature:
- Browser.
- Browser profile.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/browser.md`: перевод с шапкой `> Перевод [английской версии](../browser.md), commit `same-pr`.`
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

- `src/main/browser`
- `src/renderer/browser`
- `src/shared/browser`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница `docs/features/browser.md`, 409 строк, разделы Browser и Browser profile, как в списке. Делить не стал: это
«примерно 400», как и 404 строки у Autopilot. Перевод `docs/features/ru/browser.md` в том же PR. Приложение не запускалось,
test-ы прочитаны, но не запускались.

Не подтвердилось кодом или test-ом, на страницу не пошло (3):

- ADR-0078: «каждый Live Browser — примерно 100–300 МБ». Константы и test-а нет.
- ADR-0087: `browser_screenshot` с viewport-ом снимает размер viewport-а, а не рамки. Вызов `Page.captureScreenshot` без
  размеров есть, test-а на размер снимка нет.
- Комментарий `src/main/browser/screencast.ts`: Chromium шлёт кадр «только когда страница изменилась». Это поведение Chromium,
  ни код, ни test этого не проверяют.

Отличия Windows: в модулях Browser одна ветка по платформе (`editingCommands`). Других отличий код не содержит; на Windows
страница не проверялась, это выведено только из кода.

Возможные баги продукта (код не менялся):

- `src/main/browser/live.ts`: запись `controls` не удаляется, когда Node Browser уходит из Layout вне ухода Session, в отличие
  от `lifes` и `calls`. `browser.control.list` продолжает её отдавать, пока Session на Canvas.
- `src/main/layout/store.ts`: заблокированный Browser Session, ушедшей с Canvas, остаётся с `openedBy`. Ушедшая Session его не
  ведёт, другие получают отказ «opened by another Session», поэтому вести его не может никто, пока Session не покажут снова.
- `src/shared/ipc/browser.ts`: `browser.profiles.list` — канал `read`, и Linked machine с read-only получает sign-in page вместе
  с query. `signInExpiry` в `src/main/mcp/browser-server.ts` query намеренно не показывает. ADR-0078 в поправке называет только
  origins, про sign-in page решения нет.
- `src/main/browser/cdp.ts`: отмеченный в комментарии shortcut. Debugger не отключается, поэтому обход service worker длится до
  закрытия страницы, также после конца управления Session.

Сверка папок «Где в коде»: три папки верны, но неполны. Feature также живёт в `src/main/ipc/browser.ts`,
`src/main/mcp/browser-server.ts`, `src/main/window.ts`, `src/main/layout/store.ts`, `src/renderer/canvas/nodes/`,
`src/renderer/canvas/overlays/`, `src/renderer/settings/BrowserSection.tsx`, `src/shared/ipc/browser.ts`.

