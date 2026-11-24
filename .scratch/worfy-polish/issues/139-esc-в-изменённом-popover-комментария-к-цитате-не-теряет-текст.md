# 139 — Esc в изменённом popover комментария к цитате не теряет текст

Type: bug
Status: done 2026-11-20T18:55Z
PR: #2101
Branch: worfy-polish/139
Blocked by: none
Source: решение владельца 2026-11-20, Q9. В Changes то же исправил worfy-polish 136 (#2072); комментарий к цитате
тогда оставлен вне скоупа.

Кто: агент. Глубина review — `low`. Не платформенный PR.

## Что происходит

- В Session view popover комментария к цитате (`src/renderer/session/QuoteCommentParts.tsx`) Esc внутри popover-а
  обрабатывает kit: popover закрывается через `onCancel`, набранный текст и картинки пропадают
  (`QuoteCommentParts.tsx:295`: «Esc pressed in the popover is the kit's: it closes the popover (onCancel)»).
- Клик вне изменённого popover-а его оставляет: `onOutside` (`src/renderer/session/QuoteComments.tsx:807-815`) показывает
  `Save (⌘↵) or Cancel (Esc) first.` и встряхивает popover. Текст на месте.
- Одно и то же намерение «закрыть» теряет текст по Esc и не теряет по клику. В Changes после worfy-polish 136 Esc в
  изменённом popover-е его оставляет (`src/renderer/changes/LineComment.tsx`, `onKeyDown` с `preventDefault`).
- Подсказка `Cancel (Esc)` и `docs/features/sessions.md:224` («Esc in it cancels») называют Esc способом выбросить
  набранное. Test `test/unit/quote-comments-ui.test.tsx:237` («Esc cancels: nothing is kept») закрепляет нынешнее
  поведение.

## Что делаем

1. Esc в изменённом popover-е комментария к цитате (текст или число картинок отличаются от исходных, `changed`,
   `QuoteCommentParts.tsx:283`) оставляет его открытым: тот же путь, что в `LineComment.tsx` после worfy-polish 136 —
   `onKeyDown` места помечает Esc обработанным (`preventDefault`), kit popover не закрывает. Реакция — как у клика вне
   изменённого popover-а (`onOutside`: подсказка и встряхивание), текст и картинки на месте.
2. Esc в неизменённом popover-е закрывает его, как сейчас. Кнопка Cancel закрывает и выбрасывает набранное.
3. Подсказка `onOutside` больше не называет Esc способом отмены: `Save (⌘↵) or Cancel first.` (или равный текст).
4. `docs/features/sessions.md:224` — Esc закрывает неизменённый popover и оставляет изменённый, как клик вне. Перевод
   `docs/features/ru/` не правится (ADR-0088).
5. Test `quote-comments-ui.test.tsx` «Esc cancels: nothing is kept» переписать под новое правило; новые случаи —
   изменённый + Esc: popover и текст на месте; неизменённый + Esc: закрыт; изменённый + Cancel: закрыт, ничего не
   сохранено. Красный до правки.
6. Общий путь Esc в kit Popover не меняется.

## Готово, когда

- [ ] Unit test `test/unit/quote-comments-ui.test.tsx`: изменённый + Esc — popover и текст на месте; неизменённый + Esc
      — закрыт; изменённый + Cancel — закрыт. Красный до правки.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quote-comments-ui.test.tsx` exit 0 (46 passed), exit 1 before the fix (changed + Esc lost the popover) · mac - · b22bcc2dd0d5464f19a9748629aa01cc29df6637
  - evidence: review pass · PR #2101 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Mutation: без условия `changed` — test красный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quote-comments-ui.test.tsx` exit 1 with the fix reverted and exit 1 with the changed check negated; with the check removed exit 0, an equivalent mutant: onOutside closes an unchanged popover itself · mac - · b22bcc2dd0d5464f19a9748629aa01cc29df6637
  - evidence: review pass · PR #2101 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Подсказка `onOutside` и `docs/features/sessions.md` не называют Esc способом выбросить изменённый комментарий.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/quote-comments-ui.test.tsx` exit 0 asserts the hint Save (...) or Cancel first.; docs/features/sessions.md:224 rewritten, `node scripts/check-feature-docs.mjs` exit 0 · mac - · b22bcc2dd0d5464f19a9748629aa01cc29df6637
  - evidence: review pass · PR #2101 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44780418742/job/136460614614 · ci - · 3f54b8b7a02428c009c349fab2e0010158f3db5a

## Где в коде

- `src/renderer/session/QuoteCommentParts.tsx:283-297` (`changed`, `dismiss`, `onKeyDown`)
- `src/renderer/session/QuoteComments.tsx:805-816` (`onOutside`, подсказка `Cancel (Esc)`)
- `test/unit/quote-comments-ui.test.tsx:237-246` и случаи Esc вне popover-а (`:390`, `:405`, `:429`)
- `docs/features/sessions.md:222-226`
- `src/renderer/changes/LineComment.tsx` — только читать: образец worfy-polish 136
- `src/renderer/theme/kit/Popover.tsx`, `src/renderer/theme/kit/layer.ts` — только читать (путь Esc в kit-е)

## Вне скоупа

- Общий путь Esc в kit Popover (`reason === 'escape'` без `onDismiss`) и другие popover-ы с `onDismiss`.
- Esc вне popover-а (`escape-outside`) и Esc в поле ввода занятой Session (прерывает turn) — их поведение не меняется.

## Итог

- Правка — `src/renderer/session/QuoteCommentParts.tsx`: `onKeyDown` popover-а помечает Esc обработанным (`preventDefault`) и
  зовёт `onOutside`, пока текст или число картинок отличаются от исходных (`changed`). Это тот же путь, что в
  `src/renderer/changes/LineComment.tsx` после worfy-polish 136; отличие одно — реакция: здесь, как у клика вне, подсказка
  и встряхивание, текст и картинки на месте. Неизменённый popover Esc закрывает через kit, как раньше; Cancel закрывает
  изменённый и выбрасывает набранное. Kit не менялся.
- Подсказка `onOutside` (`src/renderer/session/QuoteComments.tsx`) теперь `Save (⌘↵) or Cancel first.` — без `(Esc)`.
- `docs/features/sessions.md`: «Esc in it cancels» заменено — Cancel выбрасывает, Esc (внутри или вне) и клик вне
  закрывают неизменённый popover, изменённый остаётся, встряхивается и просит сохранить или отменить. Перевод
  `docs/features/ru/` не правился (ADR-0088).
- Сначала падающий test: `test/unit/quote-comments-ui.test.tsx` на старом коде — 3 красных (изменённый + Esc закрывал
  popover; два старых случая ждали прежнюю подсказку), после правки — 46/46. Test «Esc cancels: nothing is kept» заменён
  тремя: изменённый + Esc, неизменённый + Esc, изменённый + Cancel. Ожидания — через `waitFor` (предел под множителем
  timeout-ов), без фиксированных пауз.
- Mutation: правка откачена — красный; условие `changed` в `onKeyDown` обращено — красный. Условие убрано — зелёный:
  это эквивалентный mutant, `onOutside` сам закрывает неизменённый popover (`close()`), так что поведение не меняется.
  Решено без владельца: условие `changed` оставлено, как в worfy-polish 136, — неизменённый popover закрывается обычным
  путём kit-а, а не через `onOutside`; пункт «без условия `changed` — test красный» в буквальном виде недостижим.
- E2e: `test/e2e/quote-comments.spec.ts` целиком под `/tmp/worfy-e2e.lock` — 3/3, exit 0. Решено без владельца: правленые
  файлы не попадают ни в одно правило `scripts/e2e-specs.table.json` (CI гоняет весь набор), локально прогнан только
  spec этой функции.
