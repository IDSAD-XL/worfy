# 139 — Esc в изменённом popover комментария к цитате не теряет текст

Type: bug
Status: open
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
- [ ] Mutation: без условия `changed` — test красный.
- [ ] Подсказка `onOutside` и `docs/features/sessions.md` не называют Esc способом выбросить изменённый комментарий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` зелёный на head PR.

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
