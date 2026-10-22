# 08 — Autopilot: агенты Wave проверяют acceptance criteria в Browser под Browser profile-ами «доступен Autopilot»

Type: task
Status: claimed 2026-10-22T23:17Z
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

- [x] Contract `test/contract/browser-tools.test.ts`: в Autopilot список Browser profile-ов — только с
      флажком; «открыть» под Browser profile без флажка — ошибка; вне Autopilot видны все.
- [x] e2e `test/e2e/browser-autopilot.spec.ts` проверяет ответ инструмента `worfy-browser`, не отчёт
      Harness: Session в Autopilot открывает Browser под «user» с флажком — успех; под «admin» без
      флажка — ответ-ошибка, её текст называет Browser profile «admin» (код ошибки — как задаст
      Ticket 04); на fixture-странице входа поле пароля пустое — ни один вызов инструмента его не
      заполнил; Browser — в Family Ticket-а.
- [ ] Строка «нужен вход под user» в отчёте implementer-а и в отчёте Wave проверяется отдельно:
      shell-тестом Harness на формат отчёта (пункт ниже) и вручную — одним прогоном Wave на
      fixture-странице входа; итог прогона — в «Итог» Ticket-а.
- [x] Harness: бриф `epic-wave` и отчёт implementer-а описывают проверку в Browser и поле «нужен вход
      под <роль>»; `pnpm test` гоняет shell-тесты Harness (`harness/README.md`, раздел Tests) — exit 0.
- [x] Мутант красный: фильтр по флажку снят в Autopilot.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

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

### Ответы владельца 2026-10-23

1. **Роли** — из явного поля шапки Ticket-а `Roles: admin, user`; имена ролей — имена Browser
   profile-ов с флажком «доступен Autopilot». Нет поля — одна проверка под Browser profile по
   умолчанию (`Default`). Агент никогда не угадывает роли по «Готово, когда».
2. **Вход протух** — только два признака: страница ушла на sign-in URL Browser profile-а (из его
   настроек) или цель ответила 401. Тогда агент останавливается и пишет в отчёт «вход протух в
   профиле X». По тексту страницы не гадать.
3. **Очередь** — никакой отдельной очереди «один агент за раз» для проверок в Browser; предел —
   предел Live (Ticket 05).
4. (Факт, не вопрос) PR правит skill и agent Harness — перед мержем нужен платный eval; его
   спрашивает у владельца и запускает Orchestrator, не исполнитель. Нужна ли проверка на Windows —
   ответ `node scripts/windows-verdict-scope.mjs origin/main HEAD` в PR.

## Итог

Ветка `worfy-browser/08`.

**Сделано.**

- **Фильтр в server-е** (`src/main/mcp/browser-server.ts`). Server Session-а в Autopilot (`autopilot`
  в контексте) видит в `browser_list` только Browser profile-ы с флажком и только Browser-ы под ними.
  `browser_open` под Browser profile без флажка и любой вызов на Browser под ним — ошибка с id и
  именем Browser profile-а (`… ("admin") is not available to Autopilot …`), до того как что-то
  создано, разбужено или взято под управление. Вне Autopilot всё как было.
- **Autopilot получает server.** До этого Ticket-а Session без человека (`unattended`) не получала
  `worfy-browser` вовсе (`src/main/agent/app-registry.ts`); теперь получает, в режиме Autopilot.
  Fake agent в e2e узнаёт режим по launch Session-а в registry.
- **Предел и Family** — без нового кода: Browser Autopilot открывается тем же `browser_open`, в
  пределе Live (Ticket 05), с `openedBy` = Session (Ticket 06).
- **Вход протух** (ответ владельца 2). У Browser profile-а новое необязательное поле «Sign-in page»:
  http(s)-адрес на одном из его origins, хранится как данные, не шаблон; адрес вне origins или смена
  origins, после которой он вне их, — отказ. Совпадение — тот же origin и путь (query не
  сравнивается: `?next=`). Второй признак — 401 основного документа страницы (`documentStatus` в
  `src/main/browser/cdp.ts`, только main frame и тип `Document`). Browser profile без sign-in page
  полагается только на 401. После `browser_navigate`, `browser_click`, `browser_type`: в Autopilot
  вызов — ошибка `Sign-in expired in Browser profile "<имя>"`, вне Autopilot — обычный ответ с полем
  `signIn` (просьба позвать пользователя).
- **Инструкции server-а** — правило «не входить самому» для любой Session, оба признака и две строки
  отчёта.
- **Harness.** `harness/agents/implementer.md`: раздел «Browser checks» и поле отчёта
  `sign_in_needed` в двух формах — `sign-in needed as <role>` и
  `sign-in expired in Browser profile <name>`. `harness/skills/epic-wave/SKILL.md`: строка брифа
  `Browser roles` (из поля `Roles:`, без поля — `Default`), правило без очереди, перенос каждой
  записи `sign_in_needed` в отчёт Wave строкой `<NN>: <запись>`. Shell-тест
  `harness/bin/tests/agents-text.test.sh` проверяет формат; contract-тест сверяет слова server-а,
  его инструкций и отчёта implementer-а.

**Вне следа** (с согласия Orchestrator-а 2026-10-23): `src/main/agent/app-registry.ts` (меняет, что
доступно Session без человека — отметить в ревью как security-relevant), `src/main/browser/cdp.ts`,
`src/shared/browser/profiles.ts`, `src/shared/browser/tools.ts`, `src/shared/ipc/browser.ts`,
`src/main/ipc/browser.ts`, `src/main/browser/profiles.ts`, `src/renderer/browser/BrowserProfiles.tsx`,
`test/contract/browser-profiles.test.ts`, `test/e2e/browser-profile.spec.ts`,
`harness/bin/tests/agents-text.test.sh`.

**Тесты.** Contract `test/contract/browser-tools.test.ts` (10 новых, 1 переписан: unattended Session
теперь получает server), `test/contract/browser-profiles.test.ts` (1 новый), e2e
`test/e2e/browser-autopilot.spec.ts` (новый: настоящий Autopilot на fake agent; «user» — успех,
«admin» — ошибка с именем, redirect на sign-in page — «Sign-in expired…», поле пароля пустое, Browser
в Family Ticket-а 01), `test/e2e/browser-profile.spec.ts` (поле «Sign-in page»). Мутанты — все
красные: фильтр снят, проверка `browser_open` снята, registry не передаёт Autopilot, сравнение с
sign-in page снято, 401 любого frame-а, протухший вход не отказ в Autopilot, store принимает адрес вне
origins, поле отчёта убрано из implementer-а, строка брифа убрана из epic-wave; e2e — fake path не
видит Autopilot.

Снимки окна «Browser profiles…» с полем «Sign-in page»:
[светлая](../evidence/08-browser-profile-sign-in-light.png), [тёмная](../evidence/08-browser-profile-sign-in-dark.png).

**Не сделано и почему.**

- Ручной прогон Wave на fixture-странице входа (пункт «Готово, когда» про отчёт Wave) — не сделан:
  нужен настоящий Autopilot с моделью и установленный новый plugin; формат отчёта проверен
  shell-тестом. Ждёт владельца.
- Family Ticket-а в Autopilot: `openedBy` — Session (Ticket 06, вопрос 3). Orchestrator Wave привязан к
  Epic, а implementer — Subagent; Subagent, привязанный к Ticket-у, приносит в Family Ticket-а себя и
  свою Session, но не её Browser-ы (`src/renderer/canvas/family.ts`). Поэтому Browser, открытый для
  implementer-а, виден в Family Epic frame-а и Orchestrator-а, а в Family Ticket-а — только когда
  Session привязана к самому Ticket-у (так e2e и проверяет). Точная привязка к Subagent-у требует
  знать, какой Subagent сделал вызов MCP; этого вызов не несёт.
- Правка Harness действует после установки plugin-а из Stable copy (вопрос 3 тикета).
