# 10 — Страница Workflow

Type: task
Status: done 2026-10-30T23:41Z
PR: #1081
Blocked by: 06
Source: «Как устроено» и Q9 [spec.md](../spec.md); решения владельца 2026-10-30, Q2, Q3, Q7, Q9, Q10, Q20, Q21, Q22; [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- Описания этих Feature в репозитории нет. После Ticket-а 01 `docs/features/workflow.md` и
  `docs/features/ru/workflow.md` — заготовки в одну строку.

## Что делаем

1. Читает код и test-ы из свежего `origin/main`. Это источник страницы (Q7). Ticket-ы и ADR нужны только
   для «почему так» и как подсказка, где искать.
2. Пишет `docs/features/workflow.md` на английском, по разделу на каждый Feature:
- Ticket и Epic на Canvas.
- Pipeline.
- Binding.
3. В каждом разделе — три блока шаблона: **Behaviour** (без путей), **How it works** («почему так» — одна-две
   фразы и ссылка на ADR), **Implementation** (модули и точки входа с путями, поток данных, главные test-ы;
   без номеров строк и без копий сигнатур). Отличия платформ и работа на Linked machine — подзаголовком внутри нужного блока (`On a Linked machine`). Для Feature с многими состояниями внутри Behaviour разрешены подзаголовки и таблицы. Конкретные числа на странице остаются. Linux не описывается: пакета для него нет. Скриншотов
   нет. Только настоящее: без changelog и без пересказа ADR. Пути — в форме из индекса
   `docs/features/README.md`.
4. Утверждение, которое не подтверждается кодом или test-ом, на страницу не попадает. Оно уходит в раздел
   `## Итог` этого Ticket-а (Q20). Запускать приложение не нужно, платных запросов к Claude нет.
5. Страница вышла больше примерно 400 строк — делит её на две и пишет об этом в `## Итог`, таблица spec-а и
   индекс правятся отдельным PR (Q9).
6. Пишет `docs/features/ru/workflow.md`: перевод с шапкой `> Перевод [английской версии](../workflow.md), commit `same-pr`.`
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

- `src/main/workflow`
- `src/renderer/workflow`
- `src/shared/workflow`
- `src/renderer/pipeline`
- `src/renderer/binding`
- `src/shared/binding`

## Вне скоупа

- Исправление найденных багов продукта: такая находка — в `## Итог`.
- Feature, которых нет в `main`.

## Итог

Страница одна, 426 строк: это считаю «примерно 400», поэтому не делил. Если Orchestrator считает иначе, граница деления — раздел Binding
(105 строк). Разделы — Ticket и Epic на Canvas, Pipeline, Binding, как в списке. Английский здесь намеренно (ADR-0088).

**Не подтвердившиеся утверждения.** На странице их нет. При самопроверке 13 формулировок черновика разошлись с кодом и исправлены до
PR, например порог stuck на Done и то, что `test/contract/workflow-reader.test.ts` запускает stub, а не настоящий `epic-status`.
Режим прав новой Session оставлен странице Sessions.

**Возможные баги продукта (код не менялся).**

- Ticket, завершённый только в невлитой ветке worktree: `applyBranches` даёт `state: done` и `fromBranch`, `stageOf` ставит его на Done
  при всё ещё открытом PR, а ready Wave и Ship ticket считают его незакрытым. Test-а на это нет.
- Кнопка «Remove binding» в Session rail (`BindingRail`) не проверяет экран только для чтения: она активна, а клик лишь пишет подсказку
  в console. Пункт меню Node-а при этом неактивен и объясняет почему.
- Секция Epics пишет «No epics in .scratch/» и в Silent mode, где Ticket-ы лежат в Workflow folder.
- Ожидание, начатое при окне worfy в фокусе, теряется навсегда: `WaitsNotices` в `src/main/workflow/waits-notify.ts` помечает его seen
  до решения display, а `NoteDisplay` в `src/main/notify.ts` при фокусе ничего не показывает и не откладывает. Когда фокус уйдёт,
  уведомления не будет.
- Ship ticket из Command palette ставит Session не рядом с Ticket-ом: строка в `src/renderer/palette/commands.ts` не передаёт `near`,
  а кнопка в `src/renderer/canvas/actions/TicketActions.tsx` передаёт. Node попадает туда, куда и любой новый Node, даже когда frame-ы
  есть на Canvas.

**Расхождения комментариев и кода (страница следует коду).**

- Комментарий `stuckAfterMs` говорит, что у Queued, Check, Deploy и Closing нет порога, а `Waits: owner` или `team` даёт им 24 часа.
- Комментарий в `stages.ts` говорит, что git не запускается в корне-папке, а `rev-parse` запускается, когда Profile нельзя прочитать.
- Строка `PR:` шапки читается в модель, но Stage-ы находят PR по ветке.

**Правка «Где в коде».** Шесть папок существуют, но Feature живёт ещё здесь: `src/renderer/canvas/sources/epics.ts`,
`src/renderer/canvas/sources/workflow-bindings.ts`, `src/renderer/canvas/epic-layout.ts`, `src/renderer/canvas/ticket-card.ts`,
`src/renderer/canvas/nodes/` (Ticket, frame Epic-а), `src/renderer/canvas/edges/`, `src/renderer/canvas/actions/`,
`src/renderer/canvas/overlays/BindingDrop.tsx`, `src/renderer/session/rail/BindingRail.tsx`, `src/renderer/settings/PipelineSection.tsx`,
`src/renderer/shell/sidebar/`, `src/main/layout/bindings.ts`, `src/main/claude-home/binding-signals.ts`, `src/main/actions/launch.ts`,
`src/main/github/`, `src/main/ipc/`, `src/shared/ipc/`, `src/shared/actions/`.
