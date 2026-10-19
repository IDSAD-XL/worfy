# 08 — Autopilot: агенты Wave проверяют acceptance criteria в Browser под Browser profile-ами «доступен Autopilot»

Type: task
Status: open
Blocked by: 05, 06
Source: [spec.md](../spec.md); [ADR-0078](../../../docs/adr/0078-browser-node.md) (Browser Node), пункт 10
(Autopilot — только Browser profile-ы с флажком «доступен Autopilot»; Browser в пределе Live и в Family
Ticket-а; без входа — «нужен вход под <роль>»), пункт 1 (итог проверки — найденные проблемы и
Playwright-тесты), пункт 5 (агент не входит сам). Термины Autopilot, Wave — `CONTEXT.md`. Код
перечитан по main `dd6b0afb`.

## Что происходит

- Main знает, что Session идёт в Autopilot: поле `launch` Orchestrator-а
  (`src/main/agent/orchestrator.ts:153`, «unattended while Autopilot has the Orchestrator»).
- Бриф агента Wave — skill `epic-wave` Harness plugin-а; строка «GUI checks: yours | not yours»
  (`harness/skills/epic-wave/SKILL.md:345`) — ручные проверки GUI, не больше одного агента за раз.
  Отчёт implementer-а — JSON (`harness/agents/implementer.md:246`).
- После Ticket-а 03 у Browser profile есть флажок «доступен Autopilot», после Ticket-а 04 — server
  `worfy-browser`, после Ticket-а 06 — Browser Session-ы в её Family.

## Что делаем

1. **Фильтр в server-е.** Session в Autopilot видит в списке Browser profile-ов и открывает Browser
   только под Browser profile-ами с флажком «доступен Autopilot». Остальные для неё не существуют:
   «открыть» под ними — ошибка с именем Browser profile.
2. **Предел и Family.** Browser Autopilot — обычный Browser: считается в пределе Live (Ticket 05) и
   входит в Family Ticket-а через Session или Subagent, который его открыл (Ticket 06, вопрос 3).
3. **Нет входа.** Нужного Browser profile нет или вход протух (страница ведёт на форму входа) —
   агент не входит сам. В отчёт — «нужен вход под <роль>», работа продолжается без UI-проверки.
4. **Harness plugin.** Бриф `epic-wave` говорит агенту Wave: acceptance criteria с UI проверять в
   Browser через `worfy-browser`, итог — найденные проблемы и Playwright-тесты по ним, а не прогон
   Browser в CI (ADR-0078, п. 1). Отчёт implementer-а получает поле для «нужен вход под <роль>»;
   Orchestrator переносит его в отчёт Wave. Текст plugin-а — английский (plugin нейтрален к языку).
5. **Инструкции server-а** (`src/main/mcp/browser-instructions.md`) — то же правило «не входить
   самому» для любой Session.

## Готово, когда

- [ ] Contract `test/contract/browser-tools.test.ts`: в Autopilot список Browser profile-ов — только с
      флажком; «открыть» под Browser profile без флажка — ошибка; вне Autopilot видны все.
- [ ] e2e `test/e2e/browser-autopilot.spec.ts` проверяет ответ инструмента `worfy-browser`, не отчёт
      Harness: Session в Autopilot открывает Browser под «user» с флажком — успех; под «admin» без
      флажка — ответ-ошибка, её текст называет Browser profile «admin» (код ошибки — как задаст
      Ticket 04); на fixture-странице входа поле пароля пустое — ни один вызов инструмента его не
      заполнил; Browser — в Family Ticket-а.
- [ ] Строка «нужен вход под user» в отчёте implementer-а и в отчёте Wave проверяется отдельно:
      shell-тестом Harness на формат отчёта (пункт ниже) и вручную — одним прогоном Wave на
      fixture-странице входа; итог прогона — в «Итог» Ticket-а.
- [ ] Harness: бриф `epic-wave` и отчёт implementer-а описывают проверку в Browser и поле «нужен вход
      под <роль>»; `pnpm test` гоняет shell-тесты Harness (`harness/README.md`, раздел Tests) — exit 0.
- [ ] Мутант красный: фильтр по флажку снят в Autopilot.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- Сначала падающий: contract «в Autopilot Browser profile без флажка не виден».
- Contract `test/contract/browser-tools.test.ts`; e2e `test/e2e/browser-autopilot.spec.ts` (новый).

## Где в коде

- `src/main/mcp/browser-server.ts` (фильтр в Autopilot)
- `src/main/mcp/browser-instructions.md`
- `harness/skills/epic-wave/SKILL.md` (бриф агента, `:345`)
- `harness/agents/implementer.md` (отчёт, `:246`)
- `test/contract/browser-tools.test.ts`
- `test/e2e/browser-autopilot.spec.ts` (новый)

Только чтение: `src/main/agent/orchestrator.ts` (`launch` `:153`), `src/main/browser/profiles.ts`.

## Вне скоупа

- Вход Browser profile в Playwright-тесты (`storageState`) — не в v1 (ADR-0078, п. 17).
- Browser как регрессионный набор в CI (п. 1).

## Открытые вопросы

1. **Какие роли нужны Ticket-у.** Откуда агент знает, что проверять под «admin» и «user», — поле
   шапки Ticket-а, слова в «Готово, когда» или выбор агента. ADR не решает. Решает владелец до claim.
2. **Как агент узнаёт, что вход протух** — redirect на форму входа, ответ 401, текст страницы. ADR
   говорит только «вход протух».
3. **Когда правка Harness начинает действовать.** Plugin ставится из Stable copy; агенты Wave этого
   Epic-а работают на старом plugin-е до установки. Здесь правятся skill и agent, без скриптов
   Harness; ждёт ли PR проверки на Windows (ADR-0056, пункт 2) — по списку путей при PR.
4. **«GUI checks: yours»** — проверка в Browser идёт без экрана человека; нужна ли ей очередь «не
   больше одного агента за раз» — ADR не говорит. Предел Live (Ticket 05) уже ограничивает их число.

## Итог

Заполняется при закрытии.
