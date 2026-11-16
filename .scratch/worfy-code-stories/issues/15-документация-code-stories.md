# 15 — Документация: `docs/features/code-stories.md` (en и ru), термины в `CONTEXT.md`

Type: task
Status: done 2026-11-16T22:44Z
PR: #1932
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
  - evidence: commit pass · Feature page Code stories (en, ru) and four Code story terms in CONTEXT.md · - - · 740fecf7c
- [ ] Каждое утверждение сверено с кодом в два раунда; расхождения — в «Итог».
  - evidence: commit pass · two rounds of claim checks against the code; differences in the result section · - - · 8adc8b630
- [ ] `CONTEXT.md` содержит четыре термина и правило «шаг — не Card».
  - evidence: commit pass · Feature page Code stories (en, ru) and four Code story terms in CONTEXT.md · - - · 740fecf7c
- [ ] `pnpm lint` (в том числе `scripts/check-feature-docs.mjs`) — exit 0; `node scripts/check-personal.mjs` — exit 0.
  - evidence: test-run pass · `pnpm lint` exit 0 · mac - · 8adc8b630
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0 · mac - · 8adc8b630

## Тесты

- Только проверки документов `pnpm lint`.

## Где в коде

- `docs/features/code-stories.md` (новый), `docs/features/ru/code-stories.md` (новый)
- `docs/features/README.md`, `docs/features/ru/README.md`
- `docs/features/evidence.md`, `docs/features/ru/evidence.md` (ссылка на story PR)
- `CONTEXT.md`

Только читать: файлы «Где в коде» Ticket-ов 01–13.

## Итог

- Страница [Code stories](../../../docs/features/code-stories.md) и перевод
  [docs/features/ru/code-stories.md](../../../docs/features/ru/code-stories.md); строки индекса в обоих README, ссылка со
  страницы Evidence (en, ru); в `CONTEXT.md`, раздел «Workflow», — Code story, Story step, PR story, Epic story и
  правило «шаг — не Card». Термины в словаре английские, как остальные: PR story и Epic story; в русском тексте — story PR
  и story Epic-а.
- Сверка в два раунда. Раунд 1: три разведчика собрали факты с `file:line` (Harness, main/shared, renderer), страница
  написана по ним, ключевые строки перечитаны. Раунд 2: три свежие проверки готового текста по частям, утверждение за
  утверждением; нашли 2 неверных или неподтверждённых утверждения и 11 неточных, все исправлены (пример файла без `- `
  у полей, лишняя фраза «уведомлений о story PR нет», текст сообщения guard-а и Silent-вариант, кэш зелёной story только в Full mode, exit 3 у `--epic-story`,
  кто считается автором PR, вердикты логина Pull requests, карточка без PR и story, ⌘↩ или Ctrl+↩, чтение агента вне
  checkout-а — ещё и его папка, ADR-0105 о текстах коллег).
- Расхождения кода со spec-ом и Ticket-ами (страница описывает код):
  - Все кнопки входа называются «Code story», не «Story»; команда Command palette — «Open code story»; действие toast-а —
    «Open», не «Открыть» (spec, «Входы», решение 20).
  - На рамке Epic-а кнопка стоит рядом с кнопкой архивных Session-ов, а не рядом с «History»: «History» — ссылка у
    строки остановленного run-а Autopilot.
  - В Pull requests вход — в самом виде Pull requests; раздел sidebar (`PullRequestsSection.tsx`, след Ticket-а 10) story
    не касается.
  - «Один toast на Epic» хранится в local storage окна, а не в данных Project-а; первая модель Project-а только
    запоминает уже готовые story.
  - Story по кнопке и вопрос к строкам на Project-е с Codex недоступны: у Codex нет `oneShot` (spec: «`oneShot` есть и у
    Claude, и у Codex»; решение 25 — «на Vendor-е Project-а»). Вопрос владельцу из «Итог» Ticket-а 04 закрыт: отказ Codex с причиной
    подтверждён владельцем 2026-11-17.
  - Размеры story (1–3 и до 10 шагов у PR, 5–10 у Epic-а) — ориентир: `story-check` их не проверяет. Схема шага «Стыки
    между Ticket-ами» рисует любое число Ticket-ов, а не «два-три».
  - У story по кнопке в шапке есть `Commit:` (head PR); «commit-а в шапке нет» (spec, «Формат») верно только для
    закоммиченной story.
  - Guard проверяет только PR state-файла `land` с Epic-ом и Ticket-ом: PR без Ticket-а и documents PR — нет; у checkout-а
    без Profile (exit 3) story не нужна, при нечитаемом Profile PR ждёт.
  - Story PR коллеги: текст PR уходит агенту в запросе, но не хранится; заголовок заменяется на `PR #<N>`. Фрагменты
    кода коллеги в сохранённой story есть.
  - Head глав story Epic-а по кнопке читается только из первого репозитория Project-а.
- Не правилось (вне следа Ticket-а): `harness/profiles/README.md` всё ещё говорит, что шаг story и guard «not built yet»;
  страницы Workflow, Projects и Vendors подробно описывают свои части Code stories и могут сократиться до ссылки на новую
  страницу.
