# 09 — Вид Story в подаче «Stories»: шаг на экран, полоска сегментов, блок кода, схема стыков, Esc

Type: feature
Status: claimed 2026-11-16T03:36Z
Branch: worfy-code-stories/09
Blocked by: 08
Source: [spec.md](../spec.md), «Ticket-ы», строка 09; «Решения владельца» 20, 26, 27 (строки 121–122, 132–136);
«Решения по реализации» → worfy: «Вид Story» (строки 244–252); «Решения по test-ам», А и Б (строки 279–284); прототип
[prototype-story-ui-variants.html](../../../docs/product/code-stories/prototype-story-ui-variants.html), вариант B;
истории 5–11, 23, 24, 35

Кто: агент.

## Что происходит

- Run history — вид оболочки на всю основную область, Esc возвращает на Canvas (`src/renderer/flight-recorder/RunHistoryView.tsx`,
  `src/renderer/flight-recorder/open.ts`). Вид Story встаёт рядом с ним.
- Markdown-рендерер переопределяет `pre`, там уже живёт блок `suggestion` (`src/renderer/markdown/Markdown.tsx:199`).
  Это точка расширения для блока кода story.
- Библиотеки подсветки синтаксиса в worfy нет; первой версии она не нужна (spec, строка 252).
- Story приходит из reader-а Ticket-а 08.

## Что делаем

1. Вид Story — ещё один вид оболочки рядом с Run history, на всю основную область; Esc — назад на Canvas.
2. Подача «Stories» (вариант B прототипа):
   - один шаг на экран;
   - сверху полоска сегментов по числу шагов, прочитанные сегменты отмечены;
   - клик по правой или левой половине и стрелки листают вперёд и назад;
   - на широком экране код слева, текст справа, на узком — одна колонка;
   - в story Epic-а главы-PR сверху, между ними экраны «Начало», «Итог» и «Проверка»;
   - последний экран — «Проверить себя», если в story есть вопросы (сам экран — Ticket 13).
3. Шаг показывает поля формата. «Не записано» показано как есть, без замены.
4. Блок кода story — свой блок в `pre` Markdown-рендерера: номера строк и подсветка главных строк. Код — из git по
   reader-у Ticket-а 08.
5. Шаг «Стыки между Ticket-ами» — маленькая схема по списку передач: два-три Ticket-а и стрелки между ними, брошенная
   передача — красная пунктирная. Без панорамы, масштаба и пути по файлам (решение 27).
6. Тексты UI — на английском; текст story — на языке story.
7. Решить правило: цитируют ли frame-шаги фрагменты. `TICKETS.md` сейчас говорит и то и другое: в разделе «Code story»
   (поле Fields) любой frame-шаг может цитировать фрагмент, в разделе «Story anchor» `Start`, `Seams between tickets`,
   `Summary`, `Check` не цитируют ни одного. Выбор Ticket-а: frame-шаги фрагментов не цитируют; PR правит формулировку
   `TICKETS.md`.

   **Исключение — шаг «What review found and what remains» (решено без владельца, 2026-11-16, PR #1906).** Он цитирует
   строки head-а, который проверил review: этого требуют `TICKETS.md`, «Story anchor», п. 2, Ticket 06, п. 3, и общий
   fixture `pr-ru.md`. Без исключения пришлось бы переписать fixture-ы Ticket-а 01 и отменить п. 3 Ticket-а 06. Правило
   держат три места одной формулировкой: `TICKETS.md`, схема `src/shared/stories/schema.ts` и `harness/bin/story-check`.

## Готово, когда

- [ ] Unit test вида: story PR fixture-а — экранов столько, сколько шагов; сегменты отмечаются по мере листания; клик по
      правой половине и стрелка вправо — вперёд, по левой и стрелка влево — назад.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-view.test.tsx test/unit/markdown.test.tsx` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] Unit test: story Epic-а — главы-PR сверху; экраны «Начало», «Итог», «Проверка» на месте.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-view.test.tsx test/unit/markdown.test.tsx` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] Unit test: узкая ширина — одна колонка; широкая — код слева, текст справа.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-view.test.tsx test/unit/markdown.test.tsx` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] Unit test блока кода (`test/unit/markdown.test.tsx`): номера строк от `from`; главные строки подсвечены; блок
      `suggestion` работает как раньше.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/markdown.test.tsx test/unit/markdown-github.test.tsx` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] Unit test схемы стыков: по списку передач fixture-а — узлы Ticket-ов и стрелки; брошенная передача — красная
      пунктирная; у схемы нет масштаба и панорамы.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-view.test.tsx test/unit/markdown.test.tsx` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] `TICKETS.md` в разделах «Code story» и «Story anchor» говорит одно: frame-шаги фрагментов не цитируют. Unit test:
      frame-шаг показывается без блока кода.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/story-view.test.tsx test/contract/story-one-shot.test.ts` exit 0; in `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
- [ ] e2e `test/e2e/code-story.spec.ts` на fixture-Epic-е: вид открывается, шаги листаются, Esc возвращает на Canvas.
- [ ] `test/e2e/a11y.spec.ts`: axe на виде Story без нарушений (как на основных экранах, worfy-ui-kit 18).
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · eb770856843310dcb4efeb70560bebfc736e5146
  - evidence: gate pass · `gate fast` exit 0 (after the look fix and a rebase) · mac - · 145f1392d29c78f4d0d6e9a91a2c0f39661b3249

## Тесты

- Unit test-ы вида, блока кода и схемы; e2e на fixture-Epic-е из fixture-ов Ticket-а 01. Каждый test сначала красный.

## Где в коде

- `harness/bin/TICKETS.md` (формулировка о frame-шагах)
- `src/renderer/stories/StoryView.tsx` (новый)
- `src/renderer/stories/JunctionsDiagram.tsx` (новый: схема шага «Стыки между Ticket-ами»)
- `src/renderer/stories/stories.css` (новый)
- `src/renderer/stories/open.ts` (новый, по образцу `src/renderer/flight-recorder/open.ts`)
- `src/renderer/markdown/Markdown.tsx`, `src/renderer/markdown/markdown.css`
- `src/renderer/main.tsx` (вид рядом с Run history)
- `test/e2e/a11y.spec.ts` (вид Story в списке экранов axe)
- `test/unit/story-view.test.tsx` (новый), `test/unit/markdown.test.tsx`
- `test/e2e/code-story.spec.ts` (новый)

Только читать: `src/renderer/flight-recorder/RunHistoryView.tsx`, `src/renderer/flight-recorder/open.ts`,
`docs/product/code-stories/prototype-story-ui-variants.html`.

## Вне скоупа

- Входы в вид — Ticket 10. Вопрос к строке — Ticket 12. «Проверить себя» и отметки «прочитано» — Ticket 13.
