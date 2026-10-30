# 07 — Раздел Getting started в боковой панели и команда Command palette

Type: task
Status: done 2026-10-30T09:08Z
PR: #1044
Blocked by: 06
Source: решения владельца 2026-10-26, пункт 2 (раздел вверху боковой панели, шесть шагов, «Connect your own project» ниже и не в «готово», пропуск в любой момент, команда Command palette «Getting started»); [spec.md](../spec.md), «Тексты (черновик)», «Раздел Getting started», «Command palette»; «Решено без владельца», Р4 (решено без владельца, подтверждено владельцем 2026-10-26)

## Что происходит

- Разделы боковой панели — файлы `src/renderer/shell/sidebar/<Name>Section.tsx` с `export const order`;
  `Sidebar.tsx` находит их сам (`src/renderer/shell/Sidebar.tsx:8`), порядок — по `order`
  (`src/renderer/shell/registry.ts:38-51`). Сверху сейчас Projects (`order = 10`,
  `ProjectsSection.tsx:20`), Machines — 15, Epics — 20. Рамка раздела — `SidebarSection.tsx`.
- После Ticket-а 06 main отдаёт состояние Getting started (`gettingStarted.state`, событие
  `gettingStarted.changed`) и принимает `gettingStarted.setSection`; создание demo —
  `gettingStarted.createDemo` (Ticket 05).
- «Add project» живёт внутри `ProjectsSection` (`addProject`, `:401`; кнопка «+», `:447`). Снаружи его
  не вызвать.
- Orchestrator открывается так же, как в `FirstEpic` (`src/renderer/canvas/overlays/FirstEpic.tsx:99-101`):
  `orchestrator.open`, потом `openSession`. Текст поля ввода Session — локальное состояние
  `MessageInput` (`src/renderer/session/MessageInput.tsx:126`); положить туда готовый текст снаружи
  нельзя.
- Command palette: команды — `src/renderer/palette/commands.ts`, «First-run checks» — `:288-299`.
- Модальных окон в разделе нет (пункт 3 владельца).

## Что делаем

1. `src/renderer/shell/sidebar/GettingStartedSection.tsx` (новый), `order = 5`. Виден, когда
   `section: 'shown'`. Шесть шагов: отметка, заголовок, строка — тексты из spec-а. Отмеченный шаг —
   галочка и время в tooltip; текущий — первый неотмеченный, у него кнопка:
   1. «Open checks» — `openFirstRun()` (`src/renderer/shell/first-run-store.ts:38`);
   2. «Create demo project» — `gettingStarted.createDemo`, ход создания строкой, ошибка — текстом
      spec-а;
   3. «Open the Orchestrator» — открыть Orchestrator Demo project и положить в поле ввода «What is
      planned in this project?»; отправляет пользователь (Р4);
   4. «Ship the ticket» — то же с «/worfy:ship-ticket todo 01».
   Шаги 5 и 6 кнопок не имеют. Кнопка не блокирует шаги ниже: любой шаг можно сделать в обход.
2. Ниже, отдельно, «Connect your own project» с кнопкой «Connect…» — тот же «Add project», что «+».
   Для этого `src/renderer/projects/add-project.ts` (новый) — `requestAddProject()`, `ProjectsSection`
   на него подписан.
3. Готовый текст поля ввода: `src/renderer/session/pending-input.ts` (новый) — текст по id Node-а;
   `MessageInput` при открытии берёт его один раз, если поле пустое, и не отправляет.
4. «Skip» внизу — `gettingStarted.setSection { section: 'hidden' }` и toast `info` с текстом spec-а.
5. Команда Command palette «Getting started» (группа View, ключи `getting started`, `demo`, `tour`) —
   `setSection { section: 'shown' }`, раздел прокручен в видимую часть, фокус на нём.
6. `src/renderer/getting-started/store.ts` (новый) — состояние из main и `openGettingStarted()` для
   Ticket-ов 08 и 09.
7. Доступность: список шагов — `ol`, отметка шага — текст для screen reader («done»), кнопки —
   по Tab.

## Готово, когда

- [ ] Unit test раздела: состояние с шагами 1–2 — отмечены два, кнопка у шага 3; `section: 'hidden'` —
      раздела нет; «Skip» зовёт `setSection hidden`.
- [ ] Unit test: команда «Getting started» есть в Command palette с Project-ом и без и зовёт
      `setSection shown`.
- [ ] e2e: свежая папка данных, `WORFY_GETTING_STARTED_AUTO=1` — раздел первым в боковой панели;
      «Create demo project» (fake agent, временная домашняя папка) — шаг 2 отмечен, Project demo в
      списке; «Open the Orchestrator» — открыт Orchestrator, в поле ввода готовый вопрос, ничего не
      отправлено; «Skip» — раздела нет; Command palette «Getting started» — раздел снова, шаги
      отмечены.
- [ ] e2e: «Connect…» открывает тот же диалог, что «+» Projects.
- [ ] Снимки раздела в светлой и тёмной теме: шаги 1–2 отмечены; все шесть отмечены.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/getting-started-section.test.tsx` (новый), `test/unit/palette-commands.test.tsx`.
- e2e `test/e2e/getting-started.spec.ts` (новый).
- Сначала падающий: unit test, где раздел ждут в боковой панели при `section: 'shown'`.

## Где в коде

- `src/renderer/shell/sidebar/GettingStartedSection.tsx` (новый)
- `src/renderer/getting-started/store.ts` (новый)
- `src/renderer/projects/add-project.ts` (новый)
- `src/renderer/session/pending-input.ts` (новый)
- `src/renderer/session/MessageInput.tsx` (`:126`)
- `src/renderer/shell/sidebar/ProjectsSection.tsx` (`addProject` `:401`)
- `src/renderer/palette/commands.ts` (`:288-299`)
- `test/unit/getting-started-section.test.tsx` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/e2e/getting-started.spec.ts` (новый)

Только читать: `src/renderer/shell/SidebarSection.tsx`, `src/renderer/canvas/overlays/FirstEpic.tsx`,
`src/renderer/session/navigation.ts`, `src/renderer/toast/toasts.ts`.

## Итог

PR #1044 (merge e33b1f22). Раздел `GettingStartedSection.tsx` (`order = 5`, первый в боковой панели), шесть шагов с
кнопкой у текущего, «Connect your own project» через общий `requestAddProject()`, «Skip» с toast-ом, команда Command
palette «Getting started»; готовый текст поля ввода (`pending-input.ts`) кладётся один раз в пустое поле и не
отправляется (Р4). Снимки раздела в светлой и тёмной теме сверены с дизайном.

- Вне следа: `SessionView.tsx` передаёт `nodeId` в `MessageInput`; новый e2e spec — в `scripts/e2e-specs.table.json`.
- Gate, круг 1 — VERIFIED; CI красный из-за PR: `sidebar-sections.spec.ts:208` (пустая обёртка скрытого раздела — законна,
  ожидание обновлено, нарисованный по ошибке раздел test по-прежнему ловит) и `getting-started.spec.ts:120` на Windows
  (окружение test-а: HOMEDRIVE+HOMEPATH вели git в пустой профиль, нет автора commit-а; исправлено `windowsProfileEnv`).
  Круг 2 — VERIFIED, CI зелёный, в том числе Windows.
- Debt (low): тексты spec-а не закреплены test-ами; `disabled` кнопок шагов 3–4 без demo и фокус поля после вставки
  текста без test-ов.
- Windows: scope `pc` (e2e spec-ы) — gate full ПК после merge (ADR-0086).
