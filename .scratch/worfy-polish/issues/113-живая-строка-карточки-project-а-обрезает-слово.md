# 113 — Живая строка карточки Project-а обрезает слово

Type: bug
Status: claimed 2026-11-12T20:23Z
Branch: worfy-polish/113
Blocked by: none
Source: сообщение владельца со снимком экрана 2026-11-12, бриф Orchestrator-а.

## Что происходит

В разделе Projects sidebar-а при обычной ширине sidebar-а живая строка под карточкой Project-а читается
«● 1 busy · 3 PR need you · 20» у одного Project-а и «● 1 busy · 1 PR need you · 2 w» у другого. Третья часть —
«N waits» (`pulseParts`, `src/renderer/projects/useProjectPulse.ts`), её режет стиль `pulse` в
`src/renderer/shell/sidebar/ProjectsSection.tsx`: `overflow: hidden` и `white-space: nowrap` без многоточия, а высота
строки фиксирована (14 px), карточки — тоже (44 px). Владелец не понял, что значит «20»: обрезанное слово потеряно, и
даже полное слово «waits» не говорит, что именно ждёт.

## Что делаем

Правило владельца из похожего случая: слово никогда не режем, переносим; полный смысл — в tooltip.

- Часть строки не режется посреди слова: части, которые не помещаются, целиком уходят на следующую строку (flex-wrap,
  отступ между строками 2 px). Карточка растёт по высоте вместе со строкой (`min-height` 44 px вместо `height`).
- Разделитель « · » не начинает строку: каждая часть, кроме первой, несёт разделитель перед собой, а разделитель у
  начала строки уходит за левый край обрезающей обёртки (отрицательный отступ ряда на ширину разделителя). Обрезается
  только разделитель, текст части — никогда.
- У каждой части — tooltip kit-а (`theme/kit/Tooltip.tsx`), простыми словами, что она считает, в формулировках
  кнопок rail-а там, где они есть: busy — «N Sessions are in a turn» (1 — «1 Session is in a turn»); PR need you —
  «N pull requests need you: a review, an answer or a fix» (как бейдж rail-а Pull requests); waits — «N Tickets wait:
  blocked, or waiting for a person, not an agent» (как бейдж rail-а Pipeline, плюс правило `waitsForPerson`).
- Текст «N waits» не меняем: так его пишет прототип sidebar-а и `docs/features/app-shell.md`.

## Готово, когда

- [ ] Строка без обрезки: у живой строки нет пары `overflow: hidden` + `white-space: nowrap`, ряд частей переносится
      (`flex-wrap: wrap`), каждая часть — целиком в своём элементе, карточка не фиксирует высоту. Unit test
      `test/unit/project-pulse-line.test.tsx` (jsdom), красный до правки.
- [ ] У каждой части — tooltip с тем, что она считает, в единственном и множественном числе; экранный диктор слышит его
      как описание части. Тот же unit test.
- [ ] e2e `test/e2e/sidebar-rail.spec.ts`: у «harbor» — Ticket, который ждёт человека; в узком sidebar-е строка
      «1 busy · 1 waits» переносится, обе части целиком внутри карточки, разделитель перед второй частью не виден.
      Локально не запускается (правило владельца) — проверяет CI.
- [ ] lint, typecheck, unit test-ы sidebar-а и kit-а Tooltip, gate fast — exit 0.

## Где в коде

- `src/renderer/shell/sidebar/ProjectsSection.tsx` — `PulseLine`, `ProjectCard`, стили `styles`.
- `src/renderer/projects/useProjectPulse.ts` — `pulseParts`: текст tooltip-а каждой части.
- `test/unit/project-pulse-line.test.tsx`, `test/unit/sidebar-all-projects.test.tsx`.
- `test/e2e/sidebar-rail.spec.ts`.
- `docs/features/app-shell.md` — раздел Projects.

## Вне скоупа

- Слово «waits» и остальные слова строки: их пишет прототип sidebar-а.
