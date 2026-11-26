# 17 — Помощь по worfy: описания функций в сборке, поиск и чтение через `worfy-app`, ответ со ссылкой, язык Guide

Type: task
Status: done 2026-11-26T01:52Z
PR: #2244
Branch: worfy-assistant/17
Blocked by: 09
Source: [spec.md](../spec.md), «Ticket-ы», строка 17; «Решения владельца», 12; «Решения по реализации» → «MCP-сервер
`worfy-app`» («Чтение»), «Знакомство и помощь»; «Решения по test-ам», Б; истории 31, 32 и 38; «Волны», Wave 4

Кто: агент.

## Что строить

1. **Описания функций worfy** — `docs/features`, английские и русские — кладутся в сборку. Сейчас они в неё не входят.
2. **Поиск и чтение описаний** — tools `worfy-app` (Ticket 09).
3. **Ответы:** Assistant отвечает со ссылкой на страницу описания. Если страницы нет — говорит, что не знает. Может
   открыть тему Guide.
4. **Язык** — язык, выбранный для Guide.

## Где в коде

- Описания — `docs/features/*.md` (английские), `docs/features/ru/*.md` (русские).
- Сборка — `electron-builder.yml` (`extraResources`).
- Язык Guide — `src/renderer/guide/language.ts` (`guideLanguage` в настройках приложения).
- `worfy-app` — Ticket 09; contract test-ы tools — образцы `test/contract/canvas-tools.test.ts`,
  `test/contract/mind-map-tools.test.ts`.

## Решения

- К Assistant-у всегда можно обратиться за помощью разобраться в worfy (решение 12).
- Чтение `worfy-app` включает поиск и чтение описаний функций worfy (spec, «MCP-сервер `worfy-app`»).
- Описания в сборке, ответ со ссылкой или честное «не знаю», тема Guide, язык Guide (spec, «Знакомство и помощь»).

## Test-ы

Стык Б (spec, «Решения по test-ам»): contract test tools поиска и чтения описаний — запросы и ответы.

## Готово, когда

- [ ] Упакованная сборка содержит `docs/features` на английском и русском.
  - evidence: test-run pass · `pnpm test test/contract/feature-pages-in-build.test.ts` exit 0 · mac - · 849f153d5
  - evidence: review pass · PR #2244 · - - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
- [ ] Contract test: поиск по описаниям находит страницу; чтение отдаёт её текст и ссылку на неё.
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 849f153d5
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts test/contract/feature-pages-in-build.test.ts` exit 0 · mac - · 28cc6db26
  - evidence: review pass · PR #2244 · - - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
- [ ] Contract test: поиск без подходящей страницы отдаёт пустой ответ, а не чужую страницу.
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts test/contract/feature-pages-in-build.test.ts` exit 0 · mac - · 849f153d5
  - evidence: test-run pass · `pnpm test test/contract/feature-pages-in-build.test.ts test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 28cc6db26
  - evidence: review pass · PR #2244 · - - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
- [ ] Правила Session Assistant-а велят отвечать со ссылкой на страницу описания, а без страницы — говорить «не знаю».
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 849f153d5
  - evidence: review pass · PR #2244 · - - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
- [ ] Assistant говорит на языке, выбранном для Guide: при выборе RU — русские описания и ответы.
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts` exit 0 · mac - · 849f153d5
  - evidence: test-run pass · `pnpm test test/contract/worfy-app-tools.test.ts test/contract/feature-pages-in-build.test.ts` exit 0 · mac - · 28cc6db26
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45728314530/job/139637181421 · ci - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 849f153d5
  - evidence: gate pass · `gate fast` exit 0 · mac - · 28cc6db26
  - evidence: gate pass · `gate fast` exit 0 · mac - · afbe4c387
  - evidence: review pass · PR #2244 · - - · 62fa2f9a16218d97dbf2830b9f7389c83805c9d1

## Решено без владельца (подтвердить)

1. Страницы лежат в сборке файлами (`Contents/Resources/features/`, только `.md`), а не внутри бандла main: 2,9 МБ
   Markdown-а не грузятся при старте. В `pnpm dev` и в запусках `out/` main читает `docs/features` checkout-а.
2. Поиск — по словам, не по смыслу: страница находится, только если в одном её разделе (с заголовками выше и заголовком
   страницы) есть все слова вопроса, в английской версии или в переводе, а слова из текста раздела стоят не дальше 12
   слов друг от друга; вопрос из одного слова — слово в заголовках или дважды в тексте. Латинское слово совпадает
   только с тем же словом в единственном или множественном числе, кириллическое длиной от 4 букв — по основе без
   окончания; «ё» = «е». Индекс `README` в результаты не попадает. До 5 результатов, не больше 10. (Review раунда 1:
   правило «все слова где-то на странице» отдавало чужие страницы.)
3. Ссылка в ответе — страница на GitHub на commit сборки (без commit-а — на `main`), как «Full page» в Guide; рядом путь
   в репозитории.
4. «Может открыть тему Guide»: tool-а, который сам открывает Guide, нет — `features_read` называет темы Guide, чей
   `topic.json` проверен по этой странице, и правила велят указать путь Help ▸ worfy Guide. Кнопка в разговоре — дело
   экрана Assistant-а.
5. Страница без перевода отдаётся на английском (`language: en`, `guideLanguage: ru`). Длинная страница режется на
   40 000 символах (`truncated: true`), раздел читается параметром `section`.
6. Страницы — текст worfy, а не блок чужого текста; секреты из них убирает `redactSecrets`, как у всех ответов.
7. Язык: настройка `guideLanguage`, без выбора — первый язык системы (`app.getPreferredSystemLanguages()`), правило то
   же, что у Guide; язык берётся один раз при создании Session (новая на каждое пробуждение), и правила, и tool-ы
   держат его до конца Session.
