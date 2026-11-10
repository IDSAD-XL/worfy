# Аудит безопасности 2026-11-07 — линза security

Status: ready-for-agent
Коммит аудита: `b9abc6a7dfcec294360427521571040cca137856`
Линза: `security`, один прогон по решению владельца 2026-11-07 («один прогон continuous-audit с темой безопасности;
high и medium находки — в Ticket-ы аудита; low в Ticket-ы не идут»). В Profile в `audit_lenses` только `documentation`;
Profile не правили, набор частей линзы задан в брифе Orchestrator-а.

## Что проверено

Четыре агента `worfy:scout` (только чтение), по одному на часть линзы:

1. **Electron и доверие к renderer-у**: `src/main/window.ts`, attach policy `<webview>`, Browser Node (ADR-0078), Card
   runtime и `window.worfy`, CSP, обработчики навигации и новых окон, `shell.openExternal`, MCP-сервер по HTTP.
2. **IPC и границы процессов**: проверка отправителя в `src/main/ipc/index.ts`, классы каналов
   (`src/shared/ipc/channels.ts`), zod, обработчики main, которые запускают процессы, пишут и удаляют файлы по путям из
   renderer-а, terminal и pty.
3. **Machine Link**: TLS pinning, SPAKE2 pairing, хэши token-ов, проверка Origin и Host, файл секретов с правами 0600,
   уровни доступа read-only и full (ADR-0052, ADR-0066, ADR-0070), `src/main/link/`.
4. **Автоматизация агентов и supply chain**: auto-approval (ADR-0098), hook-и Harness, которые читают GitHub token,
   `.github/workflows`, секреты в репозитории, install scripts зависимостей.

Каждую находку перепроверил агент `worfy:reviewer`, который её не писал. Находки части 1 и части 3 проверял один
агент, части 2 и части 4 — другой. Orchestrator сам перечитал строки обеих находок MED.

Ни одна часть не нашла HIGH. Обе находки MED подняты из LOW на перекрёстной проверке: авторы недооценили путь атаки, а не
завысили его (в прошлом аудите другого проекта было наоборот).

## Что подтверждено как защищённое

- `wrap()` в `src/main/ipc/index.ts:136-141` отказывает вызову из любого frame-а, кроме `index.html` приложения или dev
  server. Card (`worfy-card://`) и страница Browser IPC не вызывают. `ipcMain.on` в `src` нет, только `handle`.
- Окно: `contextIsolation`, `sandbox`, без `nodeIntegration`. `<webview>` подключается только без preload, в sandbox и
  только на partition Browser-а (`src/main/browser/attach-policy.ts`). Session Browser-а отказывает во всех permissions.
- `shell.openExternal` из renderer-а пускает только https (`src/main/ipc/shell.ts:292-297`).
  - Поправка 2026-11-10 (worfy-polish 101, PR #1788): `shell.openExternal` пускает `http:` и `https:`, функция
    `webUrl()` вместо `httpsUrl()`; `file:`, `javascript:`, `data:` и прочие схемы по-прежнему отказаны.
- MCP-сервер по HTTP слушает 127.0.0.1, требует bearer token Session-а (хранится SHA-256) и отвечает 403 на запрос с
  заголовком `Origin`.
- Link: fingerprint сервера сверяется до отправки token-а; token хранится как SHA-256 и сравнивается `timingSafeEqual`;
  код pairing из `randomInt`, сгорает на первом сообщении, живёт 2 минуты; новый Linked machine стартует с уровнем
  `off`; `Origin` и `Sec-WebSocket-Origin` отклоняются; файл секретов пишется с `mode: 0o600` и переименованием; канал
  `write` для машины с уровнем `read` отклоняется до разбора ввода.
- Auto-approval: при ошибке открытия политики все запросы отклоняются (fail closed); push не одобряется никогда; при
  открытом debug port режим принудительно Off.
- CI: нет `pull_request_target`, права token-а `contents: read`, нет `secrets.*`, `persist-credentials: false`.
- Совпадения с шаблонами секретов (`ghp_`, `sk-ant-`, `AKIA`) — fixture-ы и test-ы redaction. Install scripts
  зависимостей ограничены `allowBuilds` в `pnpm-workspace.yaml` (electron, esbuild, node-pty).

## Находки

| № | Severity | Адрес | Атакующий и что он получает | Проверка | Вердикт фазы 2 | Куда |
|---|---|---|---|---|---|---|
| security-1 | MED | `src/main/cards/protocol.ts:59`, `src/renderer/canvas/card-bridge.ts:115-120` | Злонамеренная Card (её написал prompt-injected агент через Card MCP или пользователь принёс чужой HTML) без вопроса читает `workflow.get` — Epic-и, заголовки и состояния Ticket-ов, результат gate, номер и URL PR — и отправляет на любой https-хост: CSP разрешает `connect-src https:` и `img-src https:`. Для приватного репозитория это утечка метаданных проекта | `sed -n 52,62p src/main/cards/protocol.ts; grep -n "CARD_OPS" src/shared/cards/bridge.ts; sed -n 105,120p src/renderer/canvas/card-bridge.ts` | confirmed, поднято LOW→MED. Каждая половина решена отдельно: ADR-0015 (чтение без вопроса), `worfy-mvp/25` (`fetch('https://…')` разрешён); вместе их никто не взвешивал | Ticket 01 (grilling), done 2026-11-07: вариант а, оставить и записать |
| security-2 | MED | `src/main/cards/protocol.ts:345`, `src/main/window.ts:377-380` | Главный frame окна приложения уходит на любой адрес, кроме Card: `allowFrameNavigation` отвечает `true`, allow-list по `isAppUrl` нет. Путь: пользователь перетаскивает ссылку злонамеренной страницы (например, из Browser Node) на окно; `src/renderer/drop-guard.ts:6` останавливает только drop с файлами. Чужая страница получает preload, а `emit()` (`src/main/ipc/index.ts:209-216`) шлёт события окну без проверки URL: страница читает `agent.event` (содержимое Session) и другие события. Вызвать IPC она не может | `sed -n 343,346p src/main/cards/protocol.ts; sed -n 377,381p src/main/window.ts; sed -n 209,217p src/main/ipc/index.ts; sed -n 6,20p src/renderer/drop-guard.ts` | confirmed, поднято LOW→MED. Переход по drop ссылки во время работы не проверен: бриф запрещает запуск worfy | Ticket 02 |
| security-3 | LOW | `src/main/vendors/codex/account.ts:200` | `authUrl` от Codex app-server идёт в `shell.openExternal` без `httpsUrl()`. Атакующий — подменённый бинарник Codex, у которого и так права пользователя: выигрыша нет | `sed -n 141,144p src/main/vendors/codex/account.ts; sed -n 196,201p src/main/vendors/codex/account.ts` | confirmed, LOW | только таблица |
| security-4 | LOW | `src/main/link/autopilot-runs.ts:60`, `src/main/link/service.ts:854` | Linked machine с уровнем `off` получает имена Epic-ов и git origin key запущенных Autopilot run-ов: service messages идут без проверки уровня. Так решено в вопросе 2 `worfy-link/15` | `sed -n 1,12p src/main/link/autopilot-runs.ts; grep -n "messages.dispatch" src/main/link/service.ts` | confirmed, LOW, решение принято | только таблица |
| security-5 | LOW | `src/main/link/notes.ts:84-86`, `src/main/notify.ts:285-286` | Linked machine с уровнем `off` показывает здесь системное уведомление со своим текстом. Клик открывает Session на машине отправителя, `projectRoot` локально не читается. Максимум — фишинговый текст | `sed -n 84,94p src/main/link/notes.ts; sed -n 283,287p src/main/notify.ts` | confirmed, LOW | только таблица |
| security-6 | LOW | `src/main/link/server.ts:141-147`, `src/main/link/pairing.ts:166-171` | Peer в LAN без pairing: у https-сервера нет `maxConnections` и своих timeout-ов (остаются значения Node по умолчанию); лимит неудачных pairing общий на все адреса (так решено в ADR-0070, пункт 6) и на час закрывает «Link a machine». Только отказ в обслуживании | `sed -n 139,150p src/main/link/server.ts; sed -n 164,172p src/main/link/pairing.ts` | частично confirmed, LOW | только таблица |
| security-7 | LOW | `src/main/workflow/stages.ts:275`, `src/main/github/deployments.ts:41` | sha из GitHub Deployments API идёт в `git merge-base --is-ancestor` без проверки формата и без `--end-of-options`. Вызов через `execFile` без shell; опции `merge-base` только читают. Deployment создаёт только тот, у кого есть право записи в репозиторий | `sed -n 268,276p src/main/workflow/stages.ts; sed -n 41p src/main/github/deployments.ts` | confirmed, LOW | только таблица |
| security-8 | LOW | `.github/workflows/ci.yml:122` | `actions/checkout`, `setup-node`, `upload-artifact` закреплены изменяемым тегом `@v7`, по SHA — только `pnpm/action-setup`. Нужен взлом организации `actions`; token только на чтение, секретов нет | `grep -n 'uses:' .github/workflows/*.yml` | confirmed, LOW | только таблица |
| security-9 | LOW | `harness/bin/qmd-sync-main:113` (ещё `harness/bin/qmd-refresh:255`, `harness/bin/qmd-collections:227`) | `github.account` из Profile подставляется в shell-фрагмент `credential.helper` без проверки формата, в отличие от `harness/hooks/gh-token-env.mjs:36`. Profile лежит в домашней папке пользователя; кто может его записать, и так выполняет команды | `sed -n 105,115p harness/bin/qmd-sync-main` | moved с `:111` на `:113`, LOW | только таблица |

> Поправка 2026-11-10 (worfy-polish 101, PR #1788): к security-3 — функция `httpsUrl()` переименована в `webUrl()`
> (`src/main/ipc/shell.ts`) и пускает `http:` и `https:`; остальные схемы по-прежнему отказаны.

Находка части 2 про CSP Card совпала с security-1 и влилась в неё. Её утверждение «данных проекта в этом пути нет»
проверка опровергла: `workflow.get` есть в `CARD_OPS` (`src/shared/cards/bridge.ts:28`).

| Часть линзы | Проверено | Подтверждено | Отброшено | Доля ложных |
|---|---|---|---|---|
| 1 — Electron и renderer | 3 | 3 | 0 | 0 |
| 2 — IPC и процессы | 2 | 2 (одна влилась в security-1) | 0 | 0 |
| 3 — Machine Link | 3 | 3 | 0 | 0 |
| 4 — автоматизация и supply chain | 2 | 2 | 0 | 0 |

Для брифа следующего аудита: части 1 и 2 занизили severity двух находок; в бриф добавить вопрос «что ещё получает
страница или Card, когда защита на этом пути пропускает её».

## Дубликаты

| Находка | Вердикт | Где |
|---|---|---|
| security-1 | new; решения по половинам есть, вместе не взвешены | ADR-0015, `worfy-mvp/25` |
| security-2 | new | `worfy-browser/02` говорит о навигации guest-страницы, не окна приложения; `worfy-ui/28` (drop файлов) закрыт и ссылки не трогал |

Находки LOW по правилу владельца в Ticket-ы не идут, дубликаты для них не искали.

## Waves

| Ticket | Файлы (раздел «Где в коде») | Migration | Wave |
|---|---|---|---|
| 01 | `src/main/cards/protocol.ts`, `src/renderer/canvas/card-bridge.ts`, `src/shared/cards/bridge.ts`, `docs/adr/0015-card-api-window-worfy-postmessage.md` | no | 1 (done 2026-11-07, вариант а, только документы) |
| 02 | `src/main/window.ts`, `test/unit/window-options.test.ts`, `src/renderer/drop-guard.ts` | no | 1 |

## Что не проверено

- Прохода по dev stack нет: в Profile нет `dev_stack`; бриф запрещал запуск worfy. Переход окна по drop ссылки
  (security-2) во время работы не воспроизведён.
- Разбор shell-команд auto-approval (`shell.ts`, `policy.ts`, около 2600 строк) на обходы парсера: прочитаны только
  устройство, правила allow и путь ошибки.
- `harness/hooks/guard.mjs` и другие hook-и на injection; `scripts/ci-scope.mjs` против враждебных имён файлов в PR.
- Транзитивные зависимости на известные CVE (`pnpm audit` не запускали); Electron fuses и конфиг `electron-builder`
  (Electron fuses уже в работе: `worfy-auto-approve/12`).
- Тела всех 61 канала `read` Linked machine: проверены только те, что принимают путь; flood кадров от авторизованного
  peer (`connection.ts`, `connections.ts`); ACL файла секретов на Windows.
- Windows-пути: `windows-pty.ts`, UNC и junction, `storage/remove.ts`; поведение git на враждебном `.git/config` в
  папке, добавленной как Project; сборка update и `harness/install.ts`.
