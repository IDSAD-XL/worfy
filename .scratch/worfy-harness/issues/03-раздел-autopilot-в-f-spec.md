# 03 — Раздел Autopilot в F-SPEC: кнопка и строка состояния прогона

Type: task
Status: done — 2026-10-07, [PR #103](https://github.com/IDSAD-XL/worfy/pull/103)
Blocked by: —
Source: решения владельца 2026-10-07 («Перенесено из E2»); [spec.md](../spec.md); [F-SPEC.md](../../../docs/design/F-SPEC.md); Ticket-ы 04, 05, 29, 32 `worfy-daily`; [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md); [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md); [ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md); [ADR-0034](../../../docs/adr/0034-autopilot-keeps-display-awake.md)

## Что происходит

- `docs/design/F-SPEC.md` — спецификация дизайна F (43 строки, по-английски): типографика, форма,
  токены светлой и тёмной темы. Слова «Autopilot» в нём нет. Действия названы только в строке
  токенов «primary action (Run wave, Ship ticket, Allow)» (`docs/design/F-SPEC.md:32`).
- Без макета сверяли снимки Ticket-ы `worfy-daily` 04 и 05: «Макета Autopilot в F-SPEC нет;
  сверено со стилем действий F-SPEC» (`.scratch/worfy-daily/issues/04-autopilot-на-epic.md:152`,
  `.scratch/worfy-daily/issues/05-ожидание-сброса-limits.md:176`). Владелец перенёс раздел из E2 в
  E3.
- Как сделано сейчас:
  - Кнопка — в шапке рамки Epic-а, в слоте действий после «Run wave» (`order` 30 против 20,
    `src/renderer/canvas/actions/AutopilotAction.tsx:25`, `EpicActions.tsx:12`). «Run wave» —
    основное действие (`primary`, `EpicActions.tsx:21`), «Autopilot» — обычная кнопка.
  - Подписи: «Autopilot» и «Stop autopilot» (`AutopilotAction.tsx:100-108`). Кнопка активна, когда
    активна бы была «Run wave» (тот же вердикт, `src/renderer/canvas/actions/gates.ts`) и у
    Project-а нет прогона. Подсказки: «Run the Waves of <epic> one after another, without a
    person. The display stays on until the run ends», «Stop Autopilot over <epic> after this step»,
    «Autopilot is running Epic <epic>» (прогон другого Epic-а), иначе причина неактивности.
    Отказ main — его причина в подсказке.
  - Вид кнопки — `.w-action` (`src/renderer/canvas/actions/actions.css:2-15`): высота 20 px, отступ
    8 px, рамка 1 px, радиус кнопки, фон «surface raised», текст 12 px. Неактивная — прозрачный
    фон, приглушённый текст (`actions.css:29-35`). После отказа — рамка цвета blocked
    (`actions.css:36-38`).
  - Строка состояния — над кнопкой, вне ряда шапки, по правому краю, на 2 px выше кнопки, внутри
    шапки высотой 56 px; 11 px, высота строки 14 px, цвет вторичного текста, одна строка, не шире
    220 px, обрезка многоточием (`AutopilotAction.tsx:111-138`). Подсказка строки — текст ошибки
    прогона или сама строка; пока прогон идёт или ждёт — с «The display stays on until the run
    ends» (`AutopilotAction.tsx:28`, `:123`; Ticket 32 `worfy-daily`, ADR-0034).
  - Тексты строки — `autopilotStatusLine` (`src/shared/ipc/autopilot.ts:61-78`): `starting`,
    `Wave 3 · running`, `Wave 3 · 4 background tasks` и `Wave 1 · 1 background task` (Ticket 29
    `worfy-daily`, ADR-0029), `waiting for limits` и `waiting for limits · resumes 14:20` (Ticket
    05), `stopped: <причина>` — причина из `AUTOPILOT_STOP_REASONS` с пробелами вместо дефисов
    (`src/shared/autopilot/cycle.ts:25-40`).
  - Когда видно: у Epic-а есть «Run wave» (не все Ticket-ы done, `gates.ts:13-16`), или его прогон
    идёт или ждёт, или у его последнего прогона есть причина остановки
    (`AutopilotAction.tsx:96`).
  - e2e `test/e2e/autopilot.spec.ts` снимает шапку в обеих темах: `autopilot-idle`,
    `autopilot-running`, `autopilot-stopped`, `autopilot-waiting`, `autopilot-background-tasks`
    (`:240`, `:255`, `:273`, `:332`, `:384`).

## Что делаем

1. **Раздел `## Autopilot (Epic frame)` в `docs/design/F-SPEC.md`** — по-английски, как весь файл,
   в его стиле: короткие пункты, роли токенов из таблицы «Tokens», без новых цветов. Раздел
   описывает то, что сделано, а не новый дизайн:
   - место: шапка рамки Epic-а, после «Run wave»; «Run wave» — primary, «Autopilot» —
     обычная кнопка;
   - кнопка: подписи, размеры, вид активной, неактивной и после отказа; когда активна; подсказки;
   - строка состояния: место, размер, цвет, ширина и обрезка; все формы текста с примерами; список
     причин остановки; подсказка, в том числе «The display stays on until the run ends»;
   - когда кнопка и строка видны;
   - обе темы: только токены таблицы; цвет состояния всегда с текстом (правило F-SPEC).
2. **Ссылка на снимки.** Раздел называет e2e `test/e2e/autopilot.spec.ts` и его пять снимков
   шапки как образец вида в обеих темах.
3. **Код не меняется.** Расхождение текста с кодом исправляется в тексте. Нашёл в коде ошибку —
   описывает в «Итог»; это отдельный Ticket.

## Готово, когда

- [x] В `docs/design/F-SPEC.md` ровно один раздел Autopilot: `[ "$(grep -c '^## Autopilot' docs/design/F-SPEC.md)" -eq 1 ]` — exit 0.
- [x] Раздел называет подписи, тексты строки и подсказку: `for s in 'Autopilot' 'Stop autopilot' 'starting' 'Wave 3 · running' 'Wave 3 · 4 background tasks' 'Wave 1 · 1 background task' 'waiting for limits' 'waiting for limits · resumes 14:20' 'The display stays on until the run ends' '220px' '11px' 'test/e2e/autopilot.spec.ts'; do grep -qF "$s" docs/design/F-SPEC.md || exit 1; done` — exit 0.
- [x] Каждая причина остановки названа в виде строки: `for r in $(sed -n '/AUTOPILOT_STOP_REASONS = \[/,/\]/p' src/shared/autopilot/cycle.ts | grep -oE "'[a-z-]+'" | tr -d "'"); do grep -qF "stopped: ${r//-/ }" docs/design/F-SPEC.md || exit 1; done` — exit 0.
- [x] Новых цветов нет: `git diff origin/main -- docs/design/F-SPEC.md | grep -E '^\+.*#[0-9A-Fa-f]{3,6}'` — exit 1.
- [x] Меняется только F-SPEC: `git diff --name-only origin/main` печатает `docs/design/F-SPEC.md` и файл этого Ticket-а.
- [x] Ревьюер сверил раздел с `AutopilotAction.tsx`, `actions.css`, `autopilot.ts` и снимками e2e `autopilot.spec.ts` в обеих темах; расхождений нет (вердикт ревью — в «Итог»).

PR только с документами: CI не запускается. Финиш — по правилам Project-а: Gate fast с кодом 0 и
комментарий в PR «CI skipped: docs-only change».

## Тесты

Test-ов нет: Ticket меняет только документ. Проверка — команды «Готово, когда» и ревью против кода.
Снимки для ревью даёт существующий e2e `test/e2e/autopilot.spec.ts` (`pnpm test:e2e` под замком e2e,
снимки — в выводе test-а, в репозиторий не кладутся).

## Где в коде

- `docs/design/F-SPEC.md`

Только чтение: `src/renderer/canvas/actions/AutopilotAction.tsx`,
`src/renderer/canvas/actions/action-button.ts`, `src/renderer/canvas/actions/actions.css`,
`src/renderer/canvas/actions/EpicActions.tsx`, `src/renderer/canvas/actions/gates.ts`,
`src/shared/ipc/autopilot.ts`, `src/shared/autopilot/cycle.ts`, `test/e2e/autopilot.spec.ts`. Общих
файлов с Ticket-ами 01, 02 и 10 (та же Wave) нет.

## Итог

- В `docs/design/F-SPEC.md` добавлен раздел `## Autopilot (Epic frame)` перед «Light/dark pairing rule»:
  место, подписи, вид кнопки (активная, неактивная, после отказа, на время клика), когда активна,
  четыре подсказки, строка состояния (место, 11px, 14px, вторичный текст, 220px, многоточие), все
  формы текста строки и 14 причин остановки в виде `stopped: …`, подсказка строки с «The display
  stays on until the run ends», когда кнопка и строка видны, обе темы через роли таблицы «Tokens».
  Раздел называет `test/e2e/autopilot.spec.ts` и пять снимков шапки (`-light` и `-dark`).
- Сверх тикета раздел уточняет по коду: `Wave N` — счёт Wave-ов этого прогона с 1, а не номер Wave
  в плане Epic-а (`src/shared/autopilot/cycle.ts:19-20`); при ошибке прогона подсказка строки —
  только её текст, без «The display stays on…» (`AutopilotAction.tsx:123`); Autopilot неактивен,
  если шаблон «Run wave» не называет Ticket-ы Wave-а (`{tickets}`, ADR-0033,
  `src/shared/actions/render-template.ts:134`); строка видна только у Epic-а своего прогона.
- Ошибок в коде при сверке не найдено. Код не менялся.
- Команды «Готово, когда» 1–4 — exit 0, 0, 0, 1 (как требуется). Ревью против кода и снимков e2e —
  за оркестратором; вердикт — следующий пункт.
- **Вердикт ревью** (последний пункт «Готово, когда»): VERIFIED с первого круга. Все 12 утверждений
  раздела совпали с `AutopilotAction.tsx`, `actions.css`, `autopilot.ts`; `autopilot.spec.ts` — 3 passed,
  все 10 снимков шапки (5 состояний × светлая и тёмная тема) совпали с разделом. Одна находка уровня low
  (`docs/design/F-SPEC.md:65`, видимость Epic-а без Ticket-ов) исправлена коммитом 97bf5da до мержа и
  перепроверена.

**Влито.** [PR #103](https://github.com/IDSAD-XL/worfy/pull/103) → squash-коммит `0e96488` в `main`.
Ревью — VERIFIED с первого круга. CI на PR с одними документами не запускался; `GATE_SCOPE=all gate fast` —
exit 0. После мержа команды «Готово, когда» 1–4 перепроверены на `main` (`0e96488`): exit 0, 0, 0, 1;
коммит меняет только `docs/design/F-SPEC.md` и файл этого Ticket-а.

**Долг.** Нет.
