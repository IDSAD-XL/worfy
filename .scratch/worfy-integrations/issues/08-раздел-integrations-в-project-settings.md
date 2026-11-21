# 08 — Раздел Integrations в Project settings и Settings → Integrations: Add integration, ввод token-а, фильтр tools, Available to Autopilot, «From Claude Code»

Type: task
Status: claimed 2026-11-21T01:51Z
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
- [ ] `test/unit/add-integration-dialog.test.tsx` (новый): каталог без Slack (Q6), строка «Use in this Project», Label
      уникальна, поля token-а, Custom server http и stdio с флажком Secret.
- [ ] `test/unit/project-settings-shell.test.tsx`: раздел Integrations в Project settings; Settings → Integrations
      показывает Integration-ы Machine и где они используются.
- [ ] e2e `test/e2e/integrations.spec.ts` (новый): Add integration — Custom server на stub-е `test/fixtures/integrations/`
      с token-ом → строка `signed-in` с числом tools; новая Session Project-а — строка Integration в chip-е «MCP n/m»
      (fake query); вторая Integration на том же адресе во втором Project-е — каждая отвечает своими данными.
- [ ] Linked machine Read only: Add integration и галочки неактивны (тот же unit-test раздела).
- [ ] Снимок экрана раздела в светлой и тёмной теме — в «Итог» (scratchpad, не в репозитории).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e test/e2e/integrations.spec.ts` — exit 0; `ci-ok`
      зелёный на head PR.

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

Пусто до завершения Ticket-а.
