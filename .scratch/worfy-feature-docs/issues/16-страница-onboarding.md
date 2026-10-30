# 16 — Страница Onboarding

Type: task
Status: open
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/onboarding.md` и
  `docs/features/ru/onboarding.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/onboarding.md` на английском, по разделу на каждый Feature:
- First run.
- Getting started.
- Demo project.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/onboarding.md`: перевод с шапкой `> Перевод [английской версии](../onboarding.md), commit `same-pr`.`
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

- `src/main/first-run`
- `src/main/getting-started`
- `src/renderer/getting-started`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница написана по коду ветки: разделы First run, Getting started, Demo project. Приложение не запускалось, платных запросов к
Claude не было. Деления страницы нет: меньше 400 строк.

**Не подтвердилось и на страницу не пошло:**

- Высота раздела 720 px и 144 px из комментария `GettingStartedSection.tsx`: в самом файле есть только высота строки 48 px. Предел
  с кодом не сверялся, число на страницу не пошло.
- `docs/features/concepts.md` говорит о Demo project «one command deletes it». Команды нет: это кнопка «Remove the demo project»
  на экране Done, она появляется только после шага 6. `concepts.md` вне этого Ticket-а и не правился.

**Возможные баги продукта (найдены чтением кода, не воспроизводились):**

- Demo project убран из списка Project-ов или его папка удалена руками при уже отмеченном шаге 2. Шаг не снимается, кнопки «Create
  demo project» больше нет, это единственный вызов `gettingStarted.createDemo`. Поэтому ветки `reopen` и `forget` в `demo.ts` из UI
  недостижимы. Кнопки шагов 3 и 4 в первом случае показывают ошибку `projects.select`.
- Убрать demo можно только после шага 6: кто бросил demo раньше, получает лишь удаление строки из списка, папка и Profile остаются.
- «Sign in…» в окне, которое показывает Linked machine: `firstRun.*` идут на эту Machine (`local`), а `terminal.open` и `layout.apply`
  на Machine окна (`project`). Строка проверяет gh этой Machine, а `gh auth login` запускается на другой.
- Кнопки шагов 3 и 4 в окне на Linked machine: `openProject(null, …)` перезагружает окно, а следом `orchestrator.open` (`project`)
  идёт на Linked machine с id локального demo; готовый текст теряется.
- На Windows, если node нет или он старше 22, строка qmd предлагает `brew install node`: `qmdRows` берёт `NODE_INSTALL_HINT` без учёта
  системы. Test «says nothing of brew anywhere» этого не ловит, если node в его окружении находится.
- Комментарий `notice.ts` сам называет shortcut: два окна, открытые вместе, показывают уведомление оба, пока одно не закроют. На странице
  сказано лишь, что оно не возвращается в следующем окне или при запуске.

**Сверка папок «Где в коде».** Все три папки есть, но списка мало. Ещё нужны: `src/renderer/shell/FirstRun.tsx`,
`src/renderer/shell/FirstRunChecks.tsx`, `src/renderer/shell/FirstRunConcepts.tsx`, `src/renderer/shell/first-run-store.ts`,
`src/renderer/shell/sidebar/GettingStartedSection.tsx`, `src/renderer/settings/HealthSection.tsx`, `src/main/ipc/first-run.ts`,
`src/main/ipc/getting-started.ts`, `src/shared/ipc/first-run.ts`, `src/shared/ipc/getting-started.ts`.
