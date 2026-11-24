# 08 — Раздел Integrations в Project settings и Settings → Integrations: Add integration, ввод token-а, фильтр tools, Available to Autopilot, «From Claude Code»

Type: task
Status: done 2026-11-21T20:35Z
PR: #2133
Blocked by: 02, 03, 04, 06
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Волны», Wave 4; «Решение», 2, 4 и 5; «Как пользователь идёт по
экранам», 1–3 и 5–10; «Экран (набросок)»; «Решения по реализации» → Серверы Claude Code рядом, Цена tools, Linked
machine; «Решения по test-ам» (e2e); «Вопросы владельцу», Q2, Q7, Q9 и Q10; «Решено без владельца», 2, 3 и 5;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 3

Кто: агент.

Не платформенный Ticket (renderer и каналы main). Глубина ревью — `medium`; снимок экрана.

## Что происходит

- Q10 (а): после этого Ticket-а две Jira по token-у работают в двух Project-ах — первая рабочая Integration (Ticket-ы
  03, 04, 06 и 08, конец Wave 4). Кнопка Sign in через OAuth появляется в Ticket-е 09.
- Окно Project settings — `src/renderer/shell/ProjectSettings.tsx` с разделами (шаблоны действий, Pull requests, Code
  stories, Team reviewer). Окно Settings — `src/renderer/settings/` (разделы `*Section.tsx`).
- Список серверов Claude Code с Allow и статусом уже есть в Edit profile (`src/renderer/projects/EditProfile.tsx:404-407`);
  правка `mcp.allowed` — через `bin/profile-set --field mcp.allowed` (Q9 (а): список остаётся, переноса нет).
- Прототип — Card Ticket-а 02 (id — в его «Итог»).
- Q2 (а): Integration заводят из Project settings, она сразу включена там; другой Project той же Machine включает её
  галочкой, без второго входа. Q7 (а): «Available to Autopilot» по умолчанию выключена.
- «Решено без владельца», 2: фильтр tools по умолчанию — All, число и размер tools на виду, Read only одним щелчком.
- «Решено без владельца», 3: Add integration и ввод token-а — только на Machine Project-а (каналы `'local'`, Ticket 03).

## Что делаем

1. Раздел **Integrations** в `src/renderer/shell/ProjectSettings.tsx` (компоненты — `src/renderer/integrations/`, новая
   папка): группа «worfy integrations» — строка на Integration: метка, site и аккаунт, статус (`signed-in`,
   `needs-sign-in`, `error` с текстом сервиса, `checking`), «41 tools · ~9k tokens», фильтр Tools (All, Read only,
   Choose…; Read only недоступен у сервиса без `readOnlyHint`, с причиной), галочки Enabled in this Project и
   Available to Autopilot, меню «…» — Test, Rename, Sign out, Disable in this Project, Remove from Machine (с
   подтверждением, если Integration включена в других Project-ах).
2. Окно **Add integration**: каталог (`src/shared/integrations/catalogue.ts`) со способом входа у каждого сервиса;
   строка «Use in this Project: <метка> (used in N Projects)» для Integration-ов Machine из других Project-ов; поля
   Label (по умолчанию из каталога, уникальна на Machine) и API token (e-mail и token у Atlassian, пометка про admin
   организации, ссылка на страницу token-ов); Custom server — адрес `https://…` или stdio (command, args, env, флажок
   Secret у переменной). После ввода — проверка (Ticket 04) и число tools (Ticket 06).
3. Группа **From Claude Code**: тот же список, что Edit profile, с Allow и статусом. Если connector или сервер
   пользователя имеет адрес из каталога, а Integration того же сервиса включена, — предупреждение «two Jira tool sets»
   и предложение выключить connector в этом Project-е; действие «Add as integration» создаёт Integration с тем же
   адресом и просит вход; `mcp.allowed` само не меняется.
4. **Settings → Integrations** (`src/renderer/settings/IntegrationsSection.tsx`, новый): все Integration-ы Machine,
   где каждая используется, Sign out, Remove.
5. Linked machine: Read only — список и статус; Full access — включить, выключить, фильтр, Autopilot; Add integration
   и поле token-а неактивны с подсказкой «on the Project's machine only».
6. Тексты UI — английские. Вид — по Card-у Ticket-а 02.

## Готово, когда

- [ ] `test/unit/integrations-section.test.tsx` (новый): строки во всех статусах, фильтр (Read only недоступен без
      `readOnlyHint`), галочки, меню «…», подтверждение Remove; предупреждение «two Jira tool sets» и «Add as
      integration». Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm exec vitest run test/unit/integrations-section.test.tsx` exit 0 · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `test/unit/add-integration-dialog.test.tsx` (новый): каталог без Slack (Q6), строка «Use in this Project», Label
      уникальна, поля token-а, Custom server http и stdio с флажком Secret.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/add-integration-dialog.test.tsx` exit 0 · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `test/unit/project-settings-shell.test.tsx`: раздел Integrations в Project settings; Settings → Integrations
      показывает Integration-ы Machine и где они используются.
  - evidence: test-run pass · `pnpm exec vitest run test/unit/project-settings-shell.test.tsx` exit 0 · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e `test/e2e/integrations.spec.ts` (новый): Add integration — Custom server на stub-е `test/fixtures/integrations/`
      с token-ом → строка `signed-in` с числом tools; новая Session Project-а — строка Integration в chip-е «MCP n/m»
      (fake query); вторая Integration на том же адресе во втором Project-е — каждая отвечает своими данными.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/integrations.spec.ts` exit 0 · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Linked machine Read only: Add integration и галочки неактивны (тот же unit-test раздела).
  - evidence: test-run pass · `pnpm exec vitest run test/unit/integrations-section.test.tsx` exit 0 · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Снимок экрана раздела в светлой и тёмной теме — в «Итог» (scratchpad, не в репозитории).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/integrations.spec.ts` exit 0 (shots in /tmp/worfy-integrations-08-shots) · mac - · 76dd3b85e
  - evidence: review pass · PR #2133 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e test/e2e/integrations.spec.ts` — exit 0; `ci-ok`
      зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 76dd3b85e
  - evidence: gate pass · `gate fast` exit 0 · mac - · 76dd3b85e
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44935146001/job/136950921848 · ci - · 06fbf929246660dd3096dabe00915ab08b5e4e15

## Где в коде

- `src/renderer/shell/ProjectSettings.tsx`
- `src/renderer/integrations/` (новая папка: раздел, строка, окно Add integration, фильтр Tools)
- `src/renderer/settings/IntegrationsSection.tsx` (новый) и список разделов окна Settings
- `src/shared/ipc/integrations.ts` (если экрану нужен канал, которого нет)
- `test/unit/integrations-section.test.tsx`, `test/unit/add-integration-dialog.test.tsx`,
  `test/e2e/integrations.spec.ts` (новые), `test/unit/project-settings-shell.test.tsx`

Только читать: `src/renderer/projects/EditProfile.tsx`, `src/shared/integrations/catalogue.ts` (03),
`src/main/integrations/proxy.ts` (06), Card Ticket-а 02, `docs/design/BRIEF.md`.

## Вне скоупа

- Кнопка Sign in (OAuth), Sign in в chip-е, Restart для Integration, включённой на ходу, Autopilot, Health check —
  Ticket 09. Slack в каталоге — нет (Q6); connector claude.ai любого сервиса виден в «From Claude Code» как раньше.

## Итог

Раздел — `src/renderer/integrations/` (`IntegrationsSection.tsx`, `AddIntegrationDialog.tsx`, `ClaudeServers.tsx`,
`dialogs.tsx`, `cost.ts`, `model.ts`, `integrations.css`); Project settings получил вкладки General | Integrations
(`src/renderer/shell/ProjectSettings.tsx`), Settings — раздел `src/renderer/settings/IntegrationsSection.tsx`. Новые
каналы в `src/shared/ipc/integrations.ts`: `integrations.tools` (весь список tools сервиса до фильтра, с `readOnly` и
размером каждого), `integrations.signOut`, `integrations.machine` (Integration-ы Machine, где каждая используется, и
сироты), `integrations.cleanUp`, `integrations.ghOffer`, `integrations.ghSignIn`; `integrations.remove` принимает
`projectId` необязательным (из Settings — подтверждение, если Integration включена хоть в одном Project-е).

Красный до правки: новые `test/unit/integrations-section.test.tsx`, `test/unit/add-integration-dialog.test.tsx`,
`test/unit/project-settings-shell.test.tsx` и `test/contract/integrations-screen.test.ts` на `src` из `origin/main` —
exit 1 (модулей раздела нет). Новые test-ы gh-пути с 503/429 в `test/contract/integrations-token-auth.test.ts` на старом
коде зелёные: поведение — Ticket-а 04, test-ы его закрепляют; mutant-ы `changed` = true и `changed` = false ловятся ими.
После правки — exit 0. Mutant-ы (13), каждый — exit 1 своего test-а: `changed` true и false, цена без запятых и скобок,
Read only без фильтра, Read only без `readOnlyHint`, `integrations.tools` при `needs-sign-in`, Clean up всех записей,
Remove без подтверждения, раздел после неудачного чтения статусов, Add integration на Linked machine, Label с учётом
регистра, Settings без строки сирот, Remove в Settings без подтверждения.

Проверки: `pnpm test:e2e test/e2e/integrations.spec.ts` под `/tmp/worfy-e2e.lock` — exit 0; целиком под замком
`integrations`, `settings`, `edit-profile`, `session-mcp`, `projects`, `pr-inbox`, `vendor-picker`, `focus-sidebar`,
`autopilot`, `ship-ticket` (spec-и, что открывают Project settings или chip MCP) — exit 0, 52 test-а. Unit и contract
test-ы затронутых модулей (`integrations-*`, `add-integration-dialog`, `project-settings-shell`, `settings-*`, `ipc*`,
`main-ipc-wiring`, `linked-ipc`, `link-access`, `mcp-*`, `claude-mcp-*`, `integration-server-name`, `ci-workflow`)
входят в `pnpm test`. `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (886 файлов, 20278 test-ов). gate fast:
первый run — exit 2 на `test/unit/pr-search-view.test.tsx` («↓ and ↑ move along the results», вид Pull requests,
этот diff его не трогает; три отдельных run-а — exit 0, в полном `pnpm test` перед ним — зелёный; load average ~40),
повтор — exit 0, `[gate] green (fast)`. `ci-ok` — CI на PR.

Снимки раздела (e2e, собранное приложение, stub-сервер на 127.0.0.1, token-ов в кадре нет):
`/tmp/worfy-integrations-08-shots/08-integrations-section-light.png` и `…-dark.png` — вне репозитория.

Раунд 2 review (три низкие находки):
- Clean up против непрочитанного списка: `integrations.json` повреждён или другой версии (`readJsonFile` откладывает его
  в сторону, и список читается пустым), его нет, или рядом лежит отложенный — `integrations.machine` не называет сирот,
  `integrations.cleanUp` отвечает `removed: 0` и записи Project-ов остаются (`IntegrationStore.wholeList`, правка
  `src/main/integrations/store.ts` вне списка файлов). Пока отложенный файл лежит рядом, Clean up не предлагается и после
  новых Integration-ов: старый список ещё можно вернуть.
- Add integration и «From Claude Code» ходят через `call` раздела: в окне Linked machine с Project-ом этой Machine
  `integrations.setEnabled`, `integrations.add`, `integrations.tools`, `profileEdit.read` и `profileEdit.write` идут в
  мост этой Machine, не окна. `shell.openExternal` остался `invoke`.
- Profile без `mcp.allowed` показывает список по умолчанию (`plugin_worfy_qmd`, `worfy-canvas`) разрешённым, как его
  получают Session-ы, и Allow дописывает к нему; `DEFAULT_MCP_SERVERS` переехал в `src/shared/workflow/mcp-servers.ts`
  (`src/main/workflow/profile.ts` его реэкспортирует).
Красный до правки: 4 contract test-а и 2 unit test-а — exit 1; после — exit 0. Mutant-ы (6) — каждый exit 1 своего
test-а: сироты против непрочитанного списка, Clean up по `list()`, `wholeList` без проверки отложенного файла, диалог и
«From Claude Code» через Machine окна, нет списка — нет имён. Unit и contract test-ы модулей integrations, settings,
link, ipc, mcp и profile (90 файлов) — exit 0; `pnpm test:e2e test/e2e/integrations.spec.ts` под замком — exit 0;
`pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.

Раунд 3 review: `integrations.machine` снова строит `items` из `list()`, `wholeList()` — только для сирот и Clean up:
после отложенного файла новая Integration видна в Settings → Integrations и в «Use in this Project» (test exit 1 до
правки, exit 0 после; mutant `items` из `wholeList()` — exit 1). Test окна Linked machine нажимает Allow: повторное
чтение и запись Profile-а идут в мост этой Machine (mutant с `invoke` в повторном чтении — exit 1).

Решено без владельца:
1. Цена tools («41 tools · ~9k tokens», с фильтром «12 of 41 tools · ~3k tokens») считается после фильтра Tools
   Project-а: proxy режет `tools/list` тем же фильтром, это и получает Session в каждом запросе. Префикс метки в
   описании в цену не входит. Contract test сверяет её с `toolsCost` proxy.
2. Ни один текст не обещает экономию контекста от выключения сервера Claude Code (факт 3г spec-а неверен:
   `disallowedTools` MCP-tool из контекста не убирает). «Two tool sets» говорит о риске чужого аккаунта.
3. Сироты: запись Project-а без Integration-ы Machine показана в Settings → Integrations строкой с Clean up;
   Integration без Project-ов — «Not used in any Project» с Remove. Секрет без Integration-ы не показан: `SecretStore` не
   перечисляет ключи.
4. Project settings — вкладки General | Integrations, как в прототипе; на вкладке Integrations окно 820 px, Close без
   Save, изменения уходят в main сразу; каналы раздела читаются только при открытии вкладки.
5. Sign in через OAuth показан неактивным «— not available yet» (Ticket 09); Sign in строки `needs-sign-in` открывает
   ввод token-а только у Integration-ов не на OAuth.
6. Сервер Claude Code сопоставляется с сервисом каталога по имени («claude.ai Atlassian», «linear»), не по адресу:
   строки MCP в renderer адресов не несут. «Add as integration» открывает Add integration на этом сервисе с адресом
   каталога.
7. «From Claude Code» — список `mcp.allowed` Profile-а (`profileEdit.read`) и строки последней Session Project-а; Allow
   и «Turn off X in this Project» пишут через `profileEdit.write` с fingerprint и одним повтором при конфликте. Без
   списка в Profile кнопки неактивны с подсказкой «set one in Edit profile».
8. Linked machine: Read only — всё неактивно; Full access — галочки, фильтр и Rename; Add integration, token, Sign out и
   Remove — «On the Project's machine only: a token never crosses the link.»
9. Custom server: `https://`, `http://` только на 127.0.0.1, localhost и [::1]; аргументы stdio делятся пробелами.
10. Способ входа по bearer у сервисов без своего названия — «Token» (у Atlassian «Service account token», у GitHub
    «Personal access token»).

Вне списка файлов Ticket-а: `src/main/integrations/proxy.ts` (публичный `serviceToolsOf` — весь список на общем
соединении; Ticket отмечает файл «только читать»), `src/main/agent/fake-query.ts` и `src/main/vendors/claude/query.ts`
(fake agent перечисляет Integration-ы Project-а для e2e chip-а), `tsconfig.test.node.json` (contract test читает
`src/renderer/integrations/cost.ts`), `docs/features/mcp-servers.md` (раздел Integrations).
e2e «каждая отвечает своими данными» проверяет `tools/list` stub-а по dataset-ам (alpha и beta), не `tools/call`.
