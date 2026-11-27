# 153 — Шапка законченной worfy Session Node: кнопки уходят в меню раньше, чем имя становится нечитаемым

Type: bug
Status: claimed 2026-11-27T09:24Z
Branch: worfy-polish/153
Blocked by: —
Source: решение владельца 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25), Q8; замер review
worfy-product-session 37 (PR #2194, `test/e2e/session-archive.spec.ts:167-174`).

Кто: агент.

## Что происходит

В шапке законченной worfy Session Node стоят полоса и иконка вида, имя, chip статуса и четыре кнопки: Resume, Keep,
Hide, Remove (`src/renderer/canvas/nodes/SessionNode.tsx:509-567`; Keep — `KeepButton`, `:277-…`). Имя — единственная
часть шапки, которая сжимается (`styles.title`, `flex: 1, minWidth: 0`, ellipsis, `SessionNode.tsx:102`); кнопки
(`styles.tools`, `flex: 'none'`, `:135`) не сжимаются никогда.

На ширине Node по умолчанию 340 px (`LIVE_SESSION_WIDTH`, `src/shared/ipc/sessions.ts:68`) имени остаётся около 1/10
ширины Node: видно «Pl…». Замер review Ticket-а 37 — 0.09 ширины на Mac; test держит только «больше 0.05»
(`test/e2e/session-archive.spec.ts:167-174`). На минимальной ширине 240 px (`minWidth={240}`, `SessionNode.tsx:505`) имени
не остаётся вовсе, и test этот случай не проверяет (комментарий там же). Пользователь не может понять, какая это
Session, не открыв её.

## Что строить

1. **Минимум имени.** Агент выбирает читаемый минимум ширины имени (в px или в знаках шрифта шапки) и пишет его и
   довод в «Решено без владельца».
2. **Кнопки — в меню, а не имя — в ноль.** Когда ширины шапки не хватает, чтобы имя было не уже минимума, кнопки шапки
   уходят в одну кнопку-меню «⋯» (Menu кита, `src/renderer/theme/kit/Menu.tsx`) по одной, с конца, или все сразу —
   выбирает агент. Пункты меню — те же действия с теми же названиями, tooltip-ами, отключением и причиной отключения
   (`writeAction`, Remove неактивен, пока Session идёт).
3. **Что остаётся снаружи.** Главное действие состояния (Interrupt, Close, Continue или Resume) остаётся кнопкой в
   шапке, пока для него есть место; агент решает, уходит ли и оно в меню на 240 px, и пишет в «Решено без владельца».
4. **Ширина — от размера шапки**, а не от размера Node в Layout-е: измерять шапку (`useElementSize`,
   `src/renderer/canvas/use-element-size.ts:13`), чтобы масштаб Canvas-а и шрифт не обманывали расчёт. Без мигания:
   кнопки не прыгают туда-обратно на границе.
5. **Read-only и Codex Node** (`SessionNode.tsx:705-721`: Keep, Hide, Remove) — то же правило, если агент найдёт, что
   там имя тоже уходит ниже минимума на 240 px; иначе — запись в «Итог», что там не нужно.
6. Страница `docs/features/sessions.md` (английская, ADR-0088) говорит, где кнопки шапки на узкой Node.

## Где в коде

- `src/renderer/canvas/nodes/SessionNode.tsx:90-140` (стили шапки), `:277-…` (`KeepButton`), `:505` (`minWidth`),
  `:509-567` (шапка worfy Session Node), `:705-721` (шапка read-only и Codex Node).
- `src/renderer/theme/kit/Menu.tsx` — Menu кита (только использовать).
- `src/renderer/canvas/use-element-size.ts:13` — размер элемента.
- `docs/features/sessions.md`.
- Test-ы: `test/unit/session-node-product.test.tsx`, `test/unit/session-node-remove.test.tsx`,
  `test/e2e/session-archive.spec.ts:167-174`.

## Решения

- Действия и их названия не меняются (`docs/design/BRIEF.md`): меняется только место.
- Порог в e2e test-е поднимается до выбранного минимума и проверяет и 240 px — это не ослабление, а новая проверка.

## Test-ы

- Unit test (jsdom, ширина шапки подменена): на узкой шапке кнопки в меню, имя не уже минимума; на широкой — кнопки
  снаружи, меню нет; пункт меню Remove неактивен с причиной, пока Session идёт. Сначала красный на нынешнем коде.
- e2e `test/e2e/session-archive.spec.ts`: законченная worfy Node на 340 px и на 240 px — ширина имени не меньше
  минимума. Локально не запускать (правило владельца 2026-11-11): идёт в job-е `macos-e2e` PR.

## Готово, когда

- [ ] Unit test: узкая шапка — кнопки в меню «⋯», имя не уже минимума; пункты меню с теми же tooltip-ами и отключением.
  - evidence: test-run pass · `pnpm test` (test/unit/session-node-product.test.tsx, test/unit/session-node-remove.test.tsx) exit 0 · mac - · 7f86a025039654f45cbb92a1fbe7590739f8eade
- [ ] e2e: законченная worfy Session Node на 340 px и 240 px держит имя не уже минимума; зелёный в `macos-e2e`.
- [ ] Снимки шапки 340 px и 240 px в светлой и тёмной теме — в папке вывода test-а, в репозиторий не кладутся.
- [ ] `docs/features/sessions.md` говорит о меню кнопок на узкой Node.
  - evidence: commit pass · worfy-polish/153: Session Node header buttons go into a "⋯" menu before the title gets unreadable · - - · 7f86a025039654f45cbb92a1fbe7590739f8eade
- [ ] «Итог»: выбранный минимум и порядок ухода кнопок — в «Решено без владельца».
  - evidence: commit pass · worfy-polish/153: ticket result · - - · 7f86a025039654f45cbb92a1fbe7590739f8eade
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Итог

PR #PRNUM.

**Что изменилось.**
- Шапка Session Node — один компонент `SessionHeader` для live, read-only и Codex Node
  (`src/renderer/canvas/nodes/SessionNode.tsx`). Кнопки шапки — список `HeaderTool` (название, test id, tooltip,
  своё отключение, нажатость Keep); `HeaderTools` рисует первые снаружи, а последние — пунктами kit Menu «⋯»
  (`session-node-more`, меню «Session actions»). Пункт — то же действие с тем же названием и tooltip-ом; Remove
  неактивен, пока Session идёт, с той же причиной; на read-only экране каждый пункт неактивен с причиной (`writeItem`);
  Keep — `menuitemcheckbox`, отмечен, пока Node kept.
- Сколько кнопок уходит, решает `useHeaderFit`: шапка измеряется `useElementSize` (ширина в пикселях Layout-а, zoom
  Canvas-а не влияет), а до paint `useLayoutEffect` смотрит, переполнено ли содержимое шапки, когда имя держит
  минимум (`scrollWidth > clientWidth`). Пока переполнено — уходит ещё одна кнопка, а нужная ширина запоминается;
  кнопка возвращается, только когда шапка шире нужного на 8 px. Шрифт и chip меряются как есть, без констант ширины.
- Read-only и Codex Node (пункт 5): правило нужно и там — по замеру Ticket-а 37 имя read-only Node на 300 px
  получало около 42 px, на 240 px — меньше нуля. Правило то же: Remove, Hide, Keep.
- `docs/features/sessions.md`: абзац «The header of a Session Node».
- Test-ы: unit — `test/unit/session-node-product.test.tsx`, `test/unit/session-node-remove.test.tsx` с подменой
  Layout-а шапки (`test/unit/session-header-layout.tsx`); e2e — `test/e2e/session-archive.spec.ts` проверяет имя
  не уже 64 px на 300, 340 и 240 px и пункты меню на 240 px, снимки `37-session-nodes-archive` и
  `153-session-header-menu` в обеих темах. Спеки, которые жали кнопки шапки, ищут кнопку в шапке или в меню
  (`test/e2e/session-header.ts`, `headerAction`): `new-session`, `external-session`, `browser-family`,
  `session-restart`. `test/unit/canvas-zoom.test.tsx`: у SessionNode.tsx теперь одна размеченная шапка.

**Решено без владельца.**
- **Минимум имени — 64 px**, около девяти знаков 13 px semibold: «Session 1a2» по id, «Plan the ro…» по имени.
  31 px (замер Ticket-а 37) давали «Pl…», которое Session не называет.
- **Порядок ухода — по одной, с конца**: Remove, потом Hide, потом Keep, главное действие состояния (Interrupt и
  Close, Continue или Resume) — последним. Так снаружи остаётся больше кнопок, чем при «все сразу».
- **Главное действие на 240 px уходит в меню**, если иначе имени не хватает минимума: у законченной worfy Node на
  240 px в меню все четыре кнопки (Resume тоже). Широкий chip «Interrupted by restart» оставляет мало места и на
  340 px — там Continue может уйти в меню.
- Когда все кнопки уже в меню, имя теряет минимум (сжимается, как раньше), а не обрезает кнопку «⋯»: так бывает только
  при очень широком chip-е.
