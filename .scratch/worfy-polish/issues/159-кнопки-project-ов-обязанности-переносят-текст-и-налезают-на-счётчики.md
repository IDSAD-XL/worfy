# 159 — Кнопки Project-ов обязанности переносят текст и налезают на счётчики

Type: bug
Status: claimed 2026-11-26T18:33Z
Branch: worfy-polish/159
Blocked by: —
Source: замечание владельца 2026-11-26 («вот еще небольшой недочет», снимок экрана Settings → Assistant → Duties).

Кто: агент.

## Что происходит

Settings → Assistant → Duties, обязанность «Work stands» (Session, Autopilot, Workflow, Limits; «After 15 min»). Строка
«Projects» держит кнопки «All Projects» и пять Project-ов этой машины, среди них «CanvasForAI», «worfy-demo» и «worfy-sandbox». Окно
обычного размера, колонка содержимого Settings — около 550 px.

- Кнопки сжаты: текст «All Projects», «worfy-demo» и «worfy-sandbox» переносится на вторую строку внутри кнопки.
- Кнопка высотой 24 px, а текст в две строки выше неё — он выходит за кнопку, за строку «Projects» и налезает на строку
  счётчиков ниже («Shown 2 Accepted 0 Dismissed 0 Ignored 0 Liked 0 Disliked 0»).

Причина в коде (origin/main cd41f4a6f): строка Project-ов (`DutyProjects`, `src/renderer/settings/AssistantSection.tsx`,
worfy-assistant 25, PR #2279) собрана из классов строки режима действия: `.w-asst-set__action` — `display: flex` без
переноса, а кнопки лежат в `.w-asst-set__days` — `inline-flex` без `flex-wrap`. Шести кнопкам не хватает ширины, flex
сжимает каждую, и текст переносится внутри кнопки.

## Что строить

1. Текст кнопки Project-а не переносится (`white-space: nowrap`), кнопка шириной по своему тексту и не сжимается.
2. Ряд кнопок переносится на столько строк, сколько нужно (`flex-wrap`, зазор между кнопками и строками); подпись
   «Projects» стоит у верхней строки кнопок.
3. Строка счётчиков всегда ниже кнопок, не под ними и не поверх.
4. Очень длинное имя Project-а обрезается многоточием на разумной ширине; полное имя — в tooltip (`title`).
5. Другие ряды кнопок раздела (режимы действий, дни недели, «Today / This week») проверить на тот же изъян и
   поправить так же, если он есть.
6. Стиль — существующие кнопки раздела (`.w-asst-set__day`), без нового вида.

## Где в коде

- `src/renderer/settings/AssistantSection.tsx` — `DutyProjects` и строки действий `DutyCard`.
- `src/renderer/settings/assistant-settings.css` — классы строк и кнопок.
- Test: `test/unit/settings-assistant.test.tsx`.
- `docs/features/assistant.md` — только если страница описывает вид этой строки.

## Test-ы

jsdom не раскладывает страницу, поэтому test проверяет строение и правила стилей, от которых зависит раскладка:

- обязанность с шестью Project-ами с длинными именами: кнопки — в отдельном контейнере, который переносит строки; у
  кнопок нет ширины в атрибуте `style`; у каждой — полное имя в `title`; строка счётчиков — отдельный блок после строки
  Project-ов, не внутри неё;
- правила `assistant-settings.css` (файл читается как текст): у контейнера кнопок `flex-wrap: wrap`; у кнопки
  `white-space: nowrap`, `flex: none`, многоточие и `max-width`, без фиксированной `width`; режимы действий тоже без
  переноса текста.
- test красный до правки.

## Готово, когда

- [ ] Кнопки Project-ов обязанности не переносят текст и не сжимаются; ряд переносится на новые строки; счётчики ниже
      ряда; длинное имя — с многоточием и полным именем в tooltip; режимы действий не переносят текст.
  - evidence: commit pass · worfy-polish/159: duty Project buttons keep one line and wrap as a row · - - · 511a6e8419e9521243737fc0a4e701e0a6b2ebd9
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/settings-assistant.test.tsx` exit 0 · mac - · 511a6e8419e9521243737fc0a4e701e0a6b2ebd9
- [ ] Unit test в `test/unit/settings-assistant.test.tsx` проверяет строение строки и правила стилей; красный до
      правки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/settings-assistant.test.tsx` exit 0 · mac - · 511a6e8419e9521243737fc0a4e701e0a6b2ebd9
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 511a6e8419e9521243737fc0a4e701e0a6b2ebd9
- [ ] (вручную) Владелец смотрит строку «Projects» обязанности «Work stands» в Stable copy: кнопки в одну строку текста,
      ряд переносится, счётчики ниже ряда.
  - needs: mac stable
