# 14 — Страница Link

Type: task
Status: open
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/link.md` и
  `docs/features/ru/link.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/link.md` на английском, по разделу на каждый Feature:
- Machine.
- Linked machine.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/link.md`: перевод с шапкой `> Перевод [английской версии](../link.md), commit `same-pr`.`
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

- `src/main/link`
- `src/main/remote-links.ts`
- `src/renderer/machines`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница `docs/features/link.md` и перевод `docs/features/ru/link.md` написаны. Разделы соответствуют списку: Machine, Linked machine. Страница на 418 строк, это в пределах «примерно 400», на две не делил. Windows описан по коду, приложение не запускалось.

**Не подтвердилось, на страницу не попало:**

- TTL объявления Bonjour 8 часов: число есть только в комментариях, исходник библиотеки не проверен (в worktree нет `node_modules`).
- «С закрытой крышкой Mac всё равно засыпает»: только комментарий в коде.
- Дают ли права 0600 и 0700 защиту на Windows: кода для Windows нет, поведение не проверено.
- Настоящее поведение mDNS и firewall на Windows: на странице только то, что делает код и текст подсказки.

**Написано по ADR-0053 и состоянию renderer, без запуска приложения:** что selection, Find и открытые панели свои у каждого экрана.

**Возможные баги продукта, код не менял:**

- После 10 неудач подряд без часовой паузы (неудачи растянуты больше чем на час) окно «Link a machine» остаётся на «Opening…» с текстом ошибки, пока его не откроют заново: `LinkMachineDialog` вызывает открытие только при mount.
- Диалог Remove говорит, что другая сторона забудет эту Machine при следующем соединении, а подключённая сторона узнаёт сразу через сообщение `revoked`.
- Комментарий в `src/main/link/connections.ts` говорит, что новое соединение на другой стороне снимает «Certificate changed». `checkPeerId` отказывает новому соединению с другим сертификатом, пока Machine не удалена.
- `PAIRING_MAX_FAILURES` и `PAIRING_HOURLY_FAILURES` оба равны 10, поэтому лимит «подряд» почти никогда не виден отдельно.
- Подсказка «Work already started keeps running» не упоминает исключение для Terminal, которое задумано в ADR-0060.
- Раздел Projects показывает «Unavailable», а раздел Machines для того же состояния показывает «Offline» или «Sleeping».
- Комментарий в начале `src/main/link/service.ts` говорит, что код соединения не попадает в ответ IPC, а `link.state` передаёт его в окна этой Machine.

**Сверка «Где в коде».** Список был неполным и с одной лишней строкой:

- `src/main/remote-links.ts` не относится к Link. Это проверка символических ссылок, ведущих за пределы машины (worfy-windows), её используют чтение workflow, Cards, Layout и другие модули. На странице её нет.
- Не хватало: `src/main/ipc/link.ts`, `src/main/ipc/linked.ts`, `src/shared/ipc/link.ts`, `src/shared/ipc/linked.ts`, `src/shared/ipc/channels.ts`, `src/renderer/ipc.ts`, `src/renderer/projects/useProjects.ts`, `src/renderer/projects/read-only.ts`, `src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/settings/MachinesSection.tsx`, `src/renderer/palette/commands.ts`, `src/renderer/canvas/ReadOnlyTerminal.tsx`, `src/renderer/canvas/overlays/ReadOnlyCanvas.tsx`, `src/renderer/canvas/read-only-nodes.ts`, `src/main/projects/holds.ts`, `src/main/projects/browse.ts`, `src/main/layout/viewports.ts`.

