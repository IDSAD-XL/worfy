# 15 — Документация: `docs/features/code-stories.md` (en и ru), термины в `CONTEXT.md`

Type: task
Status: open
Blocked by: 05, 06, 07, 08, 09, 10, 11, 12, 13
Source: [spec.md](../spec.md), «Ticket-ы», строка 15; «Волны», Wave 6; «Решения владельца» 3, 10, 20 (строки 94, 103,
121–122); «Заметки» — термины для `CONTEXT.md` (строки 396–397); правила страниц Feature (`docs/features/README.md`)

Кто: агент.

## Что происходит

- Страницы Feature — `docs/features/*.md`, переводы — `docs/features/ru/*.md`, индекс — `docs/features/README.md` и
  `docs/features/ru/README.md`. Проверка — `scripts/check-feature-docs.mjs` в `pnpm lint`.
- Страница рядом по смыслу — `docs/features/evidence.md`: story PR лежит рядом с Evidence.
- Термины проекта — `CONTEXT.md`, раздел «Workflow». Термина Code story там нет.

## Что делаем

1. `docs/features/code-stories.md` и перевод `docs/features/ru/code-stories.md`:
   - что такое Code story и шаг; story PR, story Epic-а, story по кнопке;
   - кто пишет каждую и когда; где лежит в режимах Full и Silent;
   - вид Story и все входы; вопрос к строке; «Проверить себя» и отметки «прочитано»;
   - выключатель `code_stories.pr` в Project settings; guard на merge;
   - что видно на Linked machine; story Epic-а на GitHub с телефона в режиме Full;
   - чего нет: story правок без PR, «Спросить автора» — по итогу замера Ticket-а 16.
2. Таблицы модулей и test-ов страницы — новые файлы Epic-а.
3. `CONTEXT.md`, раздел «Workflow»: Code story — рассказ о готовом изменении для того, кто отвечает за код; шаг story
   (Story step); story PR; story Epic-а. Части story — не Card: Card — Node Canvas-а (решение 3).
4. Каждое утверждение — по коду, сверка в два раунда, как у Feature docs. Расхождения с текстом Ticket-ов и spec-а — в
   «Итог». Имена Project-ов и PR в примерах — придуманные.

## Готово, когда

- [ ] Страницы en и ru есть и совпадают по смыслу; имена UI — латиницей; строки индекса в обоих README.
- [ ] Каждое утверждение сверено с кодом в два раунда; расхождения — в «Итог».
- [ ] `CONTEXT.md` содержит четыре термина и правило «шаг — не Card».
- [ ] `pnpm lint` (в том числе `scripts/check-feature-docs.mjs`) — exit 0; `node scripts/check-personal.mjs` — exit 0.

## Тесты

- Только проверки документов `pnpm lint`.

## Где в коде

- `docs/features/code-stories.md` (новый), `docs/features/ru/code-stories.md` (новый)
- `docs/features/README.md`, `docs/features/ru/README.md`
- `docs/features/evidence.md`, `docs/features/ru/evidence.md` (ссылка на story PR)
- `CONTEXT.md`

Только читать: файлы «Где в коде» Ticket-ов 01–13.
