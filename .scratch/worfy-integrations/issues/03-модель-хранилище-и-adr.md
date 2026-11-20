# 03 — Модель, каталог, хранилище Integration-ов и секретов, поле `integrations` Project-а, каналы `integrations.*`, новый ADR и Amendment ADR-0021

Type: task
Status: claimed 2026-11-20T17:17Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Волны», Wave 1; «Решение», 2–4; «Решения по реализации» → Модель, Где
лежит, Статус, Linked machine, ADR; «Вопросы владельцу», Q2, Q3, Q6, Q9; «Решено без владельца», 1, 3 и 5

Кто: агент.

Не платформенный Ticket (`src/shared/`, `src/main/`, ADR; секреты — через существующий `SecretStore`). Глубина ревью —
`high`: хранилище секретов и правило «секрет не идёт по связи».

## Что происходит

- Integration — один подключённый аккаунт одного сервиса с меткой («Jira — client A»); термин уже в `CONTEXT.md`
  (раздел Integration). Её нет в коде: MCP-серверы Session-ов worfy знает только из `mcp.allowed` Profile-а
  (`src/main/workflow/profile.ts:37`, `:567-578`; ADR-0021).
- Q2 (а): Integration живёт на Machine и включается в Project галочкой. Q3 (а): секреты — файл 0600 в папке 0700 за
  `SecretStore`, как секреты связи (`src/main/link/secrets.ts:1-11`, `:17-23`, `FileSecretStore`); `safeStorage`
  отвергнут из-за ad-hoc подписи worfy.
- Настройки worfy о Project-е — `<Project data folder>/settings.json` (`src/main/projects/settings.ts:1`, `:25`), не
  Profile. Q9 (а): `mcp.allowed` остаётся для серверов Claude Code как есть; Integration-ы в нём не живут.
- Каталог первой версии («Решено без владельца», 5): Jira and Confluence, Linear, Notion, Sentry (OAuth worfy и
  token-ы), GitHub (PAT или token `gh`), Figma (с пометкой «may refuse worfy»), Custom server (http и stdio). Slack в
  каталоге нет (Q6, ответ владельца 2026-11-20).
- Уровни доступа каналов для Linked machine — `src/shared/ipc/channels.ts:20-45` (`link`, `project` с `read` /
  `write`, `desktop`, `local`; ADR-0052, ADR-0066).

## Что делаем

1. `src/shared/integrations/types.ts` (новый): `Integration` — `id` (случайный), `service` (ключ каталога или
   `custom`), `label`, `transport` (`http` с `url` или `stdio` с `command`, `args`, `env` без секретов), `auth`
   (`oauth`, `bearer`, `basic`, `header`, `none`), видимые данные входа (аккаунт, site, когда вход) — без секретов;
   `IntegrationStatus`: `signed-in`, `needs-sign-in`, `error` (текст сервиса без token-ов), `checking`; запись
   Project-а `{ id, enabled, tools: 'all' | 'read-only' | string[], autopilot }`.
2. `src/shared/integrations/catalogue.ts` (новый): шаблоны-данные — адрес, способы входа, scope-ы, подсказка, где взять
   token, имя по умолчанию; Atlassian (`https://mcp.atlassian.com/v2/mcp`), Linear, Notion, Sentry, GitHub
   (`https://api.githubcopilot.com/mcp/`, только token), Figma с пометкой, Custom server. Если записка spike-а 01
   назвала сервис, которому tools-only proxy мало, — пометка и у него. Новый сервис — строка каталога, не код.
3. `src/main/integrations/store.ts` (новый): `<WORFY_DATA_DIR>/integrations/integrations.json` (список, без секретов,
   запись через временный файл и rename) и `integrations/secrets.json` — `FileSecretStore` со своим файлом (0600 в
   0700), ключи `<id>:access`, `<id>:refresh`, `<id>:client`, `<id>:env:<NAME>`. Метка уникальна на Machine.
4. Поле `integrations` в `<Project data folder>/settings.json` (`src/main/projects/settings.ts`): чтение, запись,
   пустой список у старых файлов. Ни Profile, ни репозиторий, ни `~/.claude.json`, `.mcp.json`, `config.toml` не
   пишутся; Silent mode и Full mode одинаковы.
5. Каналы в `src/shared/ipc/integrations.ts` и `src/main/ipc/integrations.ts` (новые): `integrations.list`,
   `integrations.status` — `'project', 'read'`; `integrations.setEnabled`, `integrations.setTools`,
   `integrations.setAutopilot`, `integrations.rename` — `'project', 'write'`; `integrations.add`,
   `integrations.setSecret`, `integrations.remove` — `'local'` (секрет и Add integration не идут по связи, «Решено без
   владельца», 3). Remove Integration, включённой в других Project-ах, требует подтверждения (флаг в запросе).
6. Новый ADR «Integrations — MCP-серверы, которые ведёт worfy» (номер — при claim): proxy, хранение, вход, включение по
   Project-у, Autopilot, Linked machine, Slack вне каталога; Amendment ADR-0021 отдельной строкой Amendments: список
   `mcp.allowed` остаётся для серверов Claude Code, Integration-ы — вне него.

## Готово, когда

- [ ] Unit `test/unit/integrations-catalogue.test.ts` (новый): у каждой строки каталога — адрес `https://` или stdio,
      хотя бы один способ входа, имя по умолчанию; GitHub — только token; Figma помечен; ключа `slack` нет (Q6). Красный
      до правки — в «Итог».
- [ ] Contract `test/contract/integrations-store.test.ts` (новый): `integrations.json` без секретов (поиск значений
      секретов в файле — пусто); `secrets.json` 0600 в папке 0700 (на Windows — как `test/unit/link-secrets-write.test.ts`);
      ключи `<id>:…`; метка уникальна на Machine; запись переживает прерванную запись (временный файл).
- [ ] Тот же contract: поле `integrations` в `settings.json` Project-а; старый `settings.json` без поля читается; Profile
      и файлы репозитория после записи не изменились.
- [ ] Тот же contract: каналы `integrations.*` с Linked machine Read only — `list` и `status` разрешены, `setEnabled`
      — отказ; Full access — `setEnabled` разрешён, `add`, `setSecret`, `remove` — отказ; Remove включённой в другом
      Project-е без подтверждения — отказ.
- [ ] Новый ADR и Amendment ADR-0021 влиты в этом PR.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/shared/integrations/types.ts`, `src/shared/integrations/catalogue.ts` (новые)
- `src/main/integrations/store.ts` (новый)
- `src/main/projects/settings.ts`
- `src/shared/ipc/integrations.ts`, `src/main/ipc/integrations.ts` (новые)
- `docs/adr/<NNNN>-integrations-mcp-servers-worfy-runs.md` (новый), `docs/adr/0021-mcp-servers-allowlist-in-profile.md`
- `test/unit/integrations-catalogue.test.ts`, `test/contract/integrations-store.test.ts` (новые)

Только читать: `src/main/link/secrets.ts`, `src/shared/ipc/channels.ts`, `src/main/workflow/profile.ts`,
`docs/adr/0052-machines-and-linking.md`, `docs/adr/0066-read-only-access-for-a-linked-machine.md`,
`docs/adr/0078-browser-node.md` (пункт 10), `.scratch/worfy-integrations/spike-integrations.md` (если 01 влит).

## Вне скоупа

- Вход — Ticket-ы 04 и 05; proxy и Session — 06; экран — 08. Перенос записей `mcp.allowed` в Integration-ы — никогда
  автоматически (Q9). Slack — вне каталога (Q6).

## Итог

- Сначала падающий: `test/unit/integrations-catalogue.test.ts` и `test/contract/integrations-store.test.ts` красные до
  правки — модулей `src/shared/integrations/catalogue.ts`, `src/main/integrations/store.ts` и `src/main/ipc/integrations.ts`
  нет (импорт не находится, 0 test-ов, exit 1). После правки — 7 и 14 test-ов зелёные.
- Модель — `src/shared/integrations/types.ts`: `Integration` (`id`, `service`, `label`, `transport` http или stdio, `auth`,
  `headerName`, `signIn`), `IntegrationStatus`, запись Project-а `{ id, enabled, tools, autopilot }`. Каталог —
  `src/shared/integrations/catalogue.ts`, семь строк данных, Slack нет. Хранилище — `IntegrationStore`
  (`src/main/integrations/store.ts`): `integrations.json` через `json-file.ts` (временный файл и rename) и свой
  `FileSecretStore` в `integrations/secrets.json`. Поле `integrations` Project-а — `readProjectIntegrations` и
  `writeProjectIntegrations` в `src/main/projects/settings.ts`. Каналы — `src/shared/ipc/integrations.ts` и
  `src/main/ipc/integrations.ts`. ADR-0111 и Amendment ADR-0021 2026-11-20 — в этом PR.
- **Решено без владельца:** поле `integrations` добавлено в `projectSettingsSchema` (`src/shared/projects/action-templates.ts`,
  файла нет в «Где в коде»). Без этого любой Save окна Project settings стирал бы поле: `writeJsonFile` отбрасывает ключи,
  которых схема не знает. `writeProjectSettings` поле из входа не пишет никогда, оставляет сохранённое; меняет его только
  `writeProjectIntegrations`. Поле, которое не читается, читается как пустой список, остальные настройки остаются.
- **Решено без владельца:** у stdio-транспорта есть `secretEnv` — имена секретных переменных (значения — в `SecretStore`
  под `<id>:env:<NAME>`). Без списка имён `SecretStore` не перечисляет ключи, и Remove не нашёл бы, что удалить;
  `setSecret` отказывает имени, которого нет в списке. У способа `header` — видимое имя заголовка `headerName`.
- **Решено без владельца:** статус до proxy (Ticket 06) — только то, что worfy знает без запроса к сервису: все нужные
  секреты есть (token при `auth` не `none` и каждая переменная `secretEnv`) — `signed-in`, иначе — `needs-sign-in`.
  `error` и `checking` пишет proxy.
- **Решено без владельца:** Remove спрашивает подтверждение, только когда Integration включена (`enabled: true`) в другом
  Project-е; выключенная запись не считается. После Remove запись уходит из `settings.json` всех Project-ов Machine. Секреты
  удаляются раньше записи списка: прерванное удаление оставляет Integration без входа, но не секрет без Integration.
- **Решено без владельца:** папка `integrations/` — 0700 с первой записи списка, а не только `secrets.json`.
  `integrations.rename` принимает `projectId` (окно, из которого переименовали; так связь узнаёт Project, local к
  Machine), метка меняется на всей Machine. `integrations.add` для сервиса каталога берёт адрес каталога и отказывает
  другому. `scopes` в каталоге пусты: scope-ы назовут метаданные сервера (Ticket 05). Figma — только OAuth.
- Каналы Linked machine: `list`, `status` — `project` `read`; `setEnabled`, `setTools`, `setAutopilot`, `rename` —
  `project` `write`; `add`, `setSecret`, `remove` — `local`. Contract test идёт через `createLinkIpc` с доступом read и all.
- Ничего вне `<WORFY_DATA_DIR>` не пишется: contract test сравнивает sha256 всех файлов папки репозитория (с `.mcp.json`) и
  Claude home (Profile, `.claude.json`) до и после всех каналов.
- Spike 01 ещё не влит (`spike-integrations.md` нет): пометки «tools-only proxy мало» в каталоге нет ни у кого, кроме
  Figma.
