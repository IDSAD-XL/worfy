# 04 — Вход по token-у: Bearer, Basic, свой заголовок, переменные-секреты stdio и token `gh` в `SecretStore`, проверка `initialize`, Sign out

Type: task
Status: claimed 2026-11-20T19:16Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Волны», Wave 2; «Решение», 3; «Факты», 5 и 7; «Решения по реализации»
→ Вход по token-у, Где лежит; «Решения по test-ам»; «Риски» (admin клиента запретил); «Вопросы владельцу», Q3 и Q10;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражение 3

Кто: агент.

Не платформенный Ticket (`src/main/`; stdio-процесс здесь не запускается — только хранение его секретов). Глубина ревью
— `high`: секреты.

## Что происходит

- Q10 (а), ответ владельца 2026-11-20: первая рабочая Integration — по token-у; две Jira в двух Project-ах работают
  после Ticket-ов 03, 04, 06 и 08 (конец Wave 4). OAuth — Ticket 05.
- Token покрывает Linear (API key Bearer), GitHub (PAT в `Authorization: Bearer`), Notion (MCP token на Business и
  Enterprise) и Atlassian (Basic e-mail:API token, у service account — Bearer); token Atlassian не привязан к site
  (Факты 5 и 7).
- Оговорка Факта 5: Atlassian API token работает, только если admin организации клиента включил вход по token-у
  (Admin → Rovo → Rovo MCP server → Authentication); без этого Jira клиента входит только по OAuth.
- Хранилище и ключи `<id>:access`, `<id>:env:<NAME>` — Ticket 03 (`src/main/integrations/store.ts`, `FileSecretStore`).
- Token аккаунта `gh` worfy уже знает для Project-а (`accountAuth`, `src/main/github/prs.ts`).

## Что делаем

1. `src/main/integrations/auth/tokens.ts` (новый): Bearer (Linear API key, GitHub PAT, Notion MCP token, Atlassian
   service account), Basic (Atlassian e-mail и API token), свой заголовок (Custom server), переменные-секреты stdio — в
   `SecretStore` под ключами Ticket-а 03. Функция заголовка входа для proxy (Ticket 06) читает `SecretStore` при каждом
   соединении.
2. Проверка: `initialize` сервиса с этим заголовком (`Client` пакета `@modelcontextprotocol/sdk` или прямой `POST`); 401
   и 403 → статус `needs-sign-in` или `error` с текстом сервиса без token-а; у Atlassian — текст отказа и ссылка на
   страницу admin-а, а не «error».
3. GitHub: предложение token-а аккаунта `gh` Project-а с предупреждением о его scope-ах. Как proxy получает этот
   token — через `accountAuth` при каждом соединении или копией в `SecretStore` — решает implementer по коду
   `accountAuth`; выбор и причина — в «Итог».
4. Sign out для token-а: удаление ключей `<id>:*` из `SecretStore`, статус `needs-sign-in`.
5. Каталог (`src/shared/integrations/catalogue.ts`): у Atlassian API token — пометка «works only if your organization
   admin turned on API token sign-in» и ссылка на страницу token-ов.
6. Канал `integrations.setSecret` (`'local'`, Ticket 03) пишет секрет и запускает проверку; ответ — статус, не секрет.
7. Stub-ы `test/fixtures/integrations/` (новые, общие для Epic-а): streamable HTTP на `127.0.0.1`, проверяет Bearer,
   Basic и свой заголовок; stdio-сервер, который читает секрет из окружения.

## Готово, когда

- [ ] Unit `test/unit/integrations-auth-headers.test.ts` (новый): Bearer, Basic (base64 e-mail:token), свой заголовок,
      переменные-секреты stdio — в окружении, не в `args`. Красный до правки — в «Итог».
  - evidence: test-run pass · `pnpm test test/unit/integrations-auth-headers.test.ts` exit 0 · mac - · 4d9e700c21965ab5415b10c974e3534cb2335635
  - evidence: test-run pass · `pnpm test test/unit/integrations-auth-headers.test.ts` exit 0 · mac - · c682407014956b3a46d259f67b568affb5a97421
  - evidence: test-run pass · `pnpm test test/unit/integrations-auth-headers.test.ts` exit 0 · mac - · 849ecfffb5dd4e723767e567dbdf1a23b10582be
- [ ] Contract `test/contract/integrations-token-auth.test.ts` (новый) на stub-е: верный token → `signed-in` и
      `initialize` прошёл; неверный → `needs-sign-in`; 403 с текстом → `error` с этим текстом; две Integration-ы на
      одном адресе stub-а с разными token-ами проверяются каждая своим token-ом; Sign out удаляет ключи `<id>:*`.
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 4d9e700c21965ab5415b10c974e3534cb2335635
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · c682407014956b3a46d259f67b568affb5a97421
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 849ecfffb5dd4e723767e567dbdf1a23b10582be
- [ ] Тот же contract: token не появляется в `integrations.json`, в ответе канала, в логе main и в Journal (поиск
      значения token-а — пусто).
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 4d9e700c21965ab5415b10c974e3534cb2335635
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · c682407014956b3a46d259f67b568affb5a97421
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 849ecfffb5dd4e723767e567dbdf1a23b10582be
- [ ] Тот же contract: `integrations.setSecret` с Linked machine (любой уровень доступа) — отказ.
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 4d9e700c21965ab5415b10c974e3534cb2335635
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · c682407014956b3a46d259f67b568affb5a97421
  - evidence: test-run pass · `pnpm test test/contract/integrations-token-auth.test.ts` exit 0 · mac - · 849ecfffb5dd4e723767e567dbdf1a23b10582be
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4d9e700c21965ab5415b10c974e3534cb2335635
  - evidence: gate pass · `gate fast` exit 0 · mac - · c682407014956b3a46d259f67b568affb5a97421
  - evidence: gate pass · `gate fast` exit 0 · mac - · 849ecfffb5dd4e723767e567dbdf1a23b10582be

## Где в коде

- `src/main/integrations/auth/tokens.ts` (новый)
- `src/shared/integrations/catalogue.ts`, `src/main/ipc/integrations.ts`
- `test/fixtures/integrations/` (новые stub-ы)
- `test/unit/integrations-auth-headers.test.ts`, `test/contract/integrations-token-auth.test.ts` (новые)

Только читать: `src/main/integrations/store.ts` (Ticket 03), `src/main/link/secrets.ts`, `src/main/github/prs.ts`
(`accountAuth`), `src/shared/terminal-ai/redact.ts` (`redactSecrets`).

## Вне скоупа

- OAuth — Ticket 05; соединение proxy с сервисом — 06; поле ввода token-а на экране — 08. Slack-token-ы любого вида —
  никогда (Q6).

## Итог

Вход по token-у — `src/main/integrations/auth/tokens.ts`: `signInHeaders` (Bearer, Basic base64 e-mail:token, свой
заголовок; `oauth` и `none` — без заголовка), `connectionHeaders` (читает `SecretStore` при каждом вызове — для proxy
Ticket-а 06), `stdioLaunch` (секреты stdio — в `env`, не в `args`), `checkSignIn` (`POST initialize` с заголовком
входа: ответ MCP — `signed-in`, 401 — `needs-sign-in`, 403 и прочее — `error` с текстом сервиса без token-а; открытая
сервером session закрывается `DELETE`), `verifyTokenSignIn`, `signOut` (все ключи `<id>:*` и `signIn: null`),
`offerGhToken` и `signInWithGhToken`. `integrations.setSecret` с `part: 'access'` у Integration-а с token-ом по http
запускает проверку и отвечает статусом; `integrations.status` показывает `signed-in` такой Integration-ы только после
удачной проверки. Каталог: у Atlassian — `tokenNote` («Works only if your organization admin turned on API token
sign-in…» и ссылка на страницу Atlassian) и `tokenUrl` (страница token-ов); у GitHub — `tokenUrl`. Stub-ы:
`test/fixtures/integrations/http-stub.ts` (streamable HTTP на `127.0.0.1`: Bearer, Basic, свой заголовок, 403 с
текстом, журнал без token-ов) и `test/fixtures/integrations/stdio-stub.mjs` (секрет из окружения).

Красный до правки: `pnpm test test/unit/integrations-auth-headers.test.ts test/contract/integrations-token-auth.test.ts`
— exit 1 (модуля `src/main/integrations/auth/tokens.ts` нет, оба файла падают на импорте). Ревью, раунд 2: новые случаи
contract-а (две проверки одной Integration-ы сразу, Sign out во время проверки, 503 после входа, 307 на другой адрес,
копия token-а `gh` для OAuth) — exit 1 до правки (8 из 22 красные), exit 0 после; mutant без `scrubServiceText` в тексте
отказа и в «Could not reach» — exit 1 (по одному красному test-у на каждый). Раунд 3: 503 и 429 при новом и при том же
token-е, Basic под token-ом `gh` — exit 1 до правки (4 из 25), exit 0 после; mutant, который не скрывает значение
своего заголовка, — exit 1. После правки — exit 0
(вместе с `integrations-store` и `integrations-catalogue`: 48 test-ов). `pnpm lint`, `pnpm typecheck` — exit 0;
`gate fast` — exit 0 (lint, typecheck, весь `pnpm test`).

Решено без владельца:
1. Token аккаунта `gh` для GitHub — копия в `SecretStore` при входе (`signInWithGhToken`), а не `accountAuth` при
   каждом соединении. Integration принадлежит Machine, а аккаунт `gh` — Profile-ю Project-а: чтение при соединении
   привязало бы proxy к папке Project-а и запуску `gh` на каждое соединение. С копией у proxy один путь — `SecretStore`.
   Цена: после `gh auth refresh` или logout у Integration-ы старый token до нового входа; предупреждение
   `offerGhToken` называет аккаунт и его scope-ы (`gh auth status --json hosts`; старый `gh` — «scope-ы неизвестны»).
2. Basic: `<id>:access` хранит `<e-mail>:<token>` целиком (`basicSecret`); e-mail становится аккаунтом входа.
3. Отказ Atlassian (401 и 403) — `error` с текстом сервиса и ссылкой на страницу про включение входа admin-ом, а не
   `needs-sign-in`: верный token, который запретил admin, не отличить от неверного.
4. Проверка — прямой `POST initialize`, без `Client` MCP SDK: пакет ещё не прямая зависимость worfy (её добавит
   Ticket 06).
5. Статус `error` держится в памяти обработчиков (`shortcut:` в `src/main/ipc/integrations.ts`). Вход (`signIn`)
   стирает отказ сервиса (401, 403, ответ не MCP, redirect). Сбой по дороге — нет ответа, timeout, 429, 5xx — оставляет
   прежний вход только при повторной проверке того же token-а; новый token (`changed`) его не наследует (ревью, раунд
   3): до перезапуска статус — `error` с текстом сбоя, после — `needs-sign-in`, и Health check это видит. Отвергнутый
   token (401) остаётся в `SecretStore`, статус — `needs-sign-in`.
9. Ревью, раунд 3: token `gh` копируется только Integration-е с Bearer — пара `<e-mail>:<token>` Basic не
   перезаписывается.
8. Ревью, раунд 2: ответ проверки, пока шла которой token сменился (второй `setSecret` или Sign out), ничего не
   записывает — ни вход, ни ошибку (`isCurrentToken`). Redirect не выполняется (`redirect: 'manual'`): заголовок входа
   не уходит на другой адрес, 3xx — `error`. `signInWithGhToken` не кладёт копию token-а `gh` Integration-е, которая
   не входит по token-у по http.
6. Новых каналов нет: Sign out, предложение token-а `gh` и вход им — функции main; каналы для экрана — Ticket 08 (его
   «Где в коде» называет `src/shared/ipc/integrations.ts`). Stdio-сервер не проверяется (процесс здесь не запускается).
7. Вне «Где в коде»: `IntegrationStore.deleteSecrets` в `src/main/integrations/store.ts` (у хранилища было только
   `remove` вместе с Integration-ой), `test/fixtures/integrations/**/*.ts` в `tsconfig.test.node.json`, stand-in проверки
   в `test/contract/integrations-store.test.ts` (иначе его `setSecret` Linear пошёл бы на настоящий адрес).
