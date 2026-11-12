# MCP servers of a Session

> Перевод [английской версии](../mcp-servers.md), commit `same-pr`.

Один Feature. **MCP servers of a Session** — серверы, чьи tool-ы получает агент работающей Session: собственные серверы
пользователя (из его конфигурации, из `.mcp.json` Project-а или connector-ы claude.ai) и серверы worfy (`worfy-canvas`,
`worfy-browser`, `worfy-mind-map` и сервер plugin-а Harness). Эта страница описывает chip «MCP n/m» в строке под полем ввода Session,
его popover, действия над сервером, подхват сервера, добавленного во время работы Session, серверы, которые Project не
разрешает, и тот же статус в Project settings. Какие серверы Session получает при старте — на странице
[Sessions](sessions.md#how-it-works); Claude Code и Codex — на странице [Vendors](vendors.md). Если термины незнакомы,
начните с [Concepts](concepts.md).

## MCP servers of a Session

### Behaviour

#### Chip и его popover

- Chip «MCP n/m» стоит в строке под полем ввода Session view, в строке подсказки, сразу слева от context meter, одинаково
  у Session Claude Code и Session Codex, у Orchestrator-а и у Session Node. Он переехал туда из шапки Session, где стало
  тесно. n — серверы со
  статусом connected, m — все серверы Session, кроме не разрешённых в Project. Пока какой-то сервер упал или ждёт входа,
  chip берёт цвета blocked и значок предупреждения. Его нет, пока у main нет данных, у Session без серверов и у Product
  Session. Его tooltip называет счёт словами, затем сколько серверов упало или ждёт входа, затем сколько ещё не разрешено:
  «3 of 4 MCP servers connected: 1 failed. 2 more not allowed in this Project».
- Клик открывает popover над chip-ом, поверх поля ввода, с заголовком «MCP servers» и строкой «n/m connected». Popover
  остаётся в окне: его высота не больше места над chip-ом, строки сверх неё прокручиваются. У каждого сервера своя
  строка: имя, статус (connected, failed, needs auth, pending, disabled, not allowed), число tool-ов, если Vendor его
  сообщил, ошибка словами Vendor-а и источник: claude.ai, user config, Project или worfy. Источник, которого worfy не знает
  по имени (`managed`, `enterprise`, `agent` или новый), показан как user config, а слово Vendor-а стоит в tooltip-е.
  Серверы, не разрешённые в Project, стоят ниже отдельной группой «Not allowed in this Project».
- Пока в этой группе две строки с Allow или больше, справа в её заголовке стоит «Allow all». При одной такой строке «Allow
  all» нет: то же делает Allow самой строки.
- У строки по кнопке на каждое действие, которое предлагает для неё main; своих кнопок окно не добавляет. У строки
  собственного сервера worfy или сервера plugin-а (источник worfy) кнопок нет: только статус. Пока действие идёт, кнопки
  его строки ждут, и «Allow all» тоже ждёт. Отказ показывается toast-ом с названием действия, именем сервера и причиной; строки после
  действия приходят в его ответе.
- Esc закрывает popover и не прерывает ход. Нажатие вне его, изменение размера окна и потеря окном фокуса тоже его
  закрывают.

#### Действия

| Кнопка | У какой строки | Что делает |
|---|---|---|
| Reconnect | failed; needs auth у Claude Code, а у Codex — где нет Sign in | Переподключает сервер в работающем процессе. У needs auth — после входа, сделанного в другом месте. |
| Sign in | needs auth, если Vendor может начать вход | Открывает страницу входа сервера в системном браузере и ждёт входа. |
| Turn off for this Session | connected, Claude Code, Session, за которой человек, сервер пользователя (не источник worfy) | Перезапускает Session с тем же разговором без сервера. Строка остаётся, disabled, с Turn on. |
| Turn on | выключенный для этой Session | Перезапускает Session с тем же разговором, вернув сервер. |
| Allow | not allowed, Claude Code | Пишет сервер в список Profile и перезапускает Session с тем же разговором. |
| Allow all | заголовок «Not allowed in this Project», пока строк с Allow две или больше | Пишет все серверы группы в список Profile одной записью и перезапускает Session один раз. |

- **Перезапуск с тем же разговором.** Turn off, Turn on, Allow и Allow all завершают процесс Session и запускают новый, который
  продолжает тот же разговор, в той же Session. Идущий ход сначала прерывается, как Interrupt, и очередь придерживается.
  Session тем временем в `starting`, и то, что ей отправили, ждёт нового процесса. Если ход уже был, у Session тот же id;
  до первого хода продолжать нечего, и новый процесс начинает новый разговор под новым id. Отдельной кнопки Restart нет
  ни у одной строки.
- **Turn off for this Session** не меняет ни Profile, ни конфигурацию пользователя: новая Session снова получит сервер.
  Собственные серверы worfy и серверы plugin-ов (источник worfy) не выключаются никогда: у их строк нет Turn off, а
  Turn off такого сервера, если его всё же попросили, main отклоняет, ничего не перезапуская.
- **Allow** пишет Profile через Harness, как окно Edit profile. Profile без списка получает список по умолчанию плюс это
  имя. Если запись отклонена (например, Profile изменился после чтения, занят или Harness слишком старый), toast называет
  причину, и Session остаётся как была. После перезапуска ответ ждёт, не дольше 10 секунд, пока сервер выйдет из pending,
  поэтому popover показывает его без нового хода.
- **Allow all** отправляет одним вызовом имена строк группы, у которых есть Allow. main пишет их одной записью Profile, в
  той же очереди Project-а, что и Allow, добавляя имена, которых нет в списке, по порядку; затем один раз перезапускает
  Session, сколько бы имён ни было, и ждёт серверы, как Allow. Пока он идёт, кнопки Allow строк ждут. Отклонённая запись
  даёт причину в toast-е и в строке под заголовком группы («Allow all failed: …»), которая остаётся и после новых строк,
  до ответа следующего Allow all; Session остаётся как была. Если новому процессу недостаёт части серверов, ошибка
  называет их. В Session Autopilot он пишет Profile без перезапуска.
- **Sign in** в Session Claude Code открывает страницу, которую дал Claude Code, только http или https; callback на
  localhost и токен принимает сам Claude Code, worfy токена не видит. Действие кончается, когда сервер вышел из needs
  auth, не дольше 10 минут; сервер, который после входа упал, переподключается один раз. Connector claude.ai входит на
  claude.ai: действие кончается, как только страница открыта, а Reconnect нажимают после входа. Claude Code, который не
  умеет начать вход, предлагает только Reconnect, и строка, если у неё нет своей ошибки, говорит, где войти: «Sign in
  with /mcp in Claude Code in a terminal (a claude.ai connector: in its settings on claude.ai), then press Reconnect.».

#### Сервер, добавленный во время работы Session

Пользователь добавляет сервер в свою конфигурацию (`claude mcp add`), пока работает Session Claude Code. Открытие
popover-а даёт main подхватить сервер, который разрешает список Profile, в том же процессе, без перезапуска. Это бывает
только между ходами и только в Session, за которой человек: никогда во время хода, никогда в Session Autopilot и никогда
само после хода. Сервер, которого список не называет, вместо этого показывается в группе «Not allowed in this Project».
Подхватывает ли тот же шаг connector claude.ai, подключённый во время работы Session, пока не проверено: это ждёт живой
проверки владельца.

#### Серверы, не разрешённые в Project

- Session Claude Code в Project получает только серверы списка своего Profile
  ([ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md)), а отсечённые Claude Code не называет. worfy находит их
  своим query, query инвентаря MCP: Claude Code с настройками пользователя, но без списка Profile и без серверов worfy, и
  без единого сообщения, поэтому модель не вызывается. Он идёт при старте Session и при каждом открытии popover-а, в
  Session Autopilot тоже.
- Строка «not allowed» — сервер пользователя, не worfy и не plugin-а, которого список не называет, которого нет в Session
  и который не выключен для этой Session. Она предлагает Allow, а её число tool-ов, если инвентарь его знал, говорит, что
  Allow добавит к каждому ходу.
- Группа кончается строкой «A claude.ai connector missing here: add its name to MCP servers in Project settings (Edit
  profile).». Инвентарь может не перечислять connector-ы claude.ai, поэтому connector, которого в группе нет, разрешают,
  вписав его имя в список.
- У Session вне всех Project-ов списка нет: она не запускает инвентарь, и таких строк у неё нет.

#### В Autopilot

Набор серверов Session Autopilot фиксируется при старте Session, на Wave. Новых серверов она не подхватывает, Turn off у
её строк нет; Turn off, Turn on и перезапуск отклоняются. Reconnect и Sign in работают: они не меняют набор. Allow и
Allow all пишут Profile без перезапуска, и серверы появляются со следующей Wave. В popover-е Orchestrator-а, пока идёт Autopilot его
Project-а, строка с Allow говорит «Allow takes effect from the next Wave».

#### Codex

У Session Codex тот же chip и тот же popover, с такими отличиями:

- Codex показывает серверы пользователя как есть: ни одна строка не «not allowed», и Allow нет ни у одной, потому что
  список Profile к серверам пользователя в Codex не применяется. Сервер, который worfy отдал Session, — worfy, любой
  другой — user config, а сервер plugin-а Codex — user config со словом `plugin` в tooltip-е.
- Reconnect у упавшего сервера просит Codex перезагрузить его MCP-серверы. Sign in у сервера, которому нужен вход, — для
  HTTP-сервера: его страница открывается в системном браузере, и действие кончается, когда Codex говорит, что вход
  закончен. Неудачный вход показывает слова Codex; вход, не законченный за 10 минут, кончается ошибкой. Сервер, которому
  нужен вход и который не HTTP, получает Reconnect.
- Turn off и Turn on нет: у Codex нет способа выключить сервер только для одного thread-а. Открытие popover-а только
  читает список; worfy ничего не подхватывает.

#### В Project settings

Edit profile показывает под полем «MCP servers» каждое имя списка с его статусом в той Session Project-а на этой
Machine, его Orchestrator-е или Session Node, чьи строки пришли в это окно последними. Имя, которого в этой Session нет,
показано без статуса; без Session не показано ничего. Сама форма — на странице [Projects](projects.md).

#### On a Linked machine

- При read-only доступе chip и popover показывают строки Machine, на которой работает Session, а каждая кнопка действия
  неактивна, с tooltip-ом, который объясняет почему; та Machine тоже отклоняет действие. Открытие popover-а всё равно
  просит строки так, как просит человек: на Machine Session main может подхватить новый сервер и запускает инвентарь.
- Sign in открывает страницу входа в браузере той Machine, на которой работает Session.
- Edit profile Project-а Linked machine не показывает статуса рядом с именами.

### How it works

- **Строки строит main, окно их рисует.** Driver каждого Vendor-а сводит свой ответ к одной общей строке и решает, какие
  действия она предлагает; окно ничего не знает о Vendor-е и рисует по кнопке на действие, так что своего правила для
  Codex у него нет.
- **Когда читается статус.** Session Claude Code спрашивает Claude Code после `system/init`, после `result` каждого хода,
  после каждого действия и когда спрашивает окно. Session Codex берёт старт каждого сервера из уведомления Codex сразу, а
  полный список, с tool-ами и состоянием входа, спрашивает, когда ни один сервер больше не стартует, затем когда
  спрашивает окно и после каждого действия. Неудачное чтение — «нет данных»: ход идёт дальше, chip пропадает.
- **Turn off — перезапуск, а не собственный выключатель Claude Code.** `toggleMcpServer` Claude Code пишет `.claude.json`
  пользователя и выключил бы сервер и вне этой Session, поэтому worfy его не зовёт. Каждый процесс Session стартует без
  выключенных серверов: их имена убраны из списка Profile, который он передаёт, свои серверы worfy не передаются совсем, а
  без списка policy tier запрещает их по имени.
- **Один процесс на разговор.** Новый процесс перезапуска стартует только после выхода старого, как любой relaunch
  ([ADR-0064](../../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)). Два перезапуска сразу, а также закрытие
  или Stop Autopilot, пока перезапуск ждёт прерванного хода, второго процесса не запускают.
- **Один инвентарь на Project и Machine.** Session в worktree спрашивает инвентарь своего Project-а так же, как Session в
  main checkout, поэтому Wave Session-ов в нескольких worktree запускает один Claude Code, а вопрос, пока он идёт,
  получает идущий. Инвентарь ждёт до 10 секунд, пока его серверы выйдут из pending, затем читает их как есть и сдаётся,
  если Claude Code не ответил через 40 секунд после старта. На эти секунды серверы пользователя запускаются ещё раз,
  stdio-сервер — отдельным процессом. Ответ хранится в памяти main до следующего запуска, на диск не пишется.
- **Серверы пользователя остаются на его экране.** В строке нет конфигурации: URL и заголовки сервера остаются в
  driver-е. Когда Claude Code не смог сообщить статус, подхватить сервер или выполнить инвентарь, в log попадает только
  вид ошибки, без имени сервера, а адрес страницы входа попадает только в браузер. Запись решения о всём Feature —
  поправка к [ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md#amendments).

### Implementation

#### Модули

| Что | Где |
| ---- | ----- |
| Строка: статусы, источники, действия | `src/shared/agent/mcp-status.ts` |
| Seam driver-а Vendor-а: `status`, `act`, `restarts` | `src/main/vendors/mcp.ts` |
| Claude Code: статус, подхват, Reconnect, Sign in | `src/main/vendors/claude/mcp.ts`, `src/main/vendors/claude/session.ts`, `src/shared/vendors/claude/events.ts` |
| Инвентарь MCP и строки «not allowed» | `src/main/vendors/claude/mcp-inventory.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts` |
| Codex: строки, Reconnect, Sign in | `src/main/vendors/codex/mcp.ts`, `src/main/vendors/codex/session.ts` |
| Перезапуск, Turn off, Turn on, Allow | `src/main/agent/session.ts`, `src/main/vendors/claude/options.ts` |
| Запись Profile для Allow | `src/main/ipc/profile-edit.ts` |
| Каналы `agent.mcp`, `agent.mcpAction`, `agent.mcpAllowAll` и их handler-ы | `src/shared/ipc/agent.ts`, `src/main/ipc/agent.ts` |
| Chip, popover, статус в Edit profile | `src/renderer/session/McpChip.tsx`, `src/renderer/session/mcp-chip.css`, `src/renderer/session/header-facts.ts`, `src/renderer/session/store.ts`, `src/renderer/projects/EditProfile.tsx` |
| Место chip-а в строке под полем ввода | `src/renderer/session/composer/McpServers.tsx`, `src/renderer/session/product-session.ts` |
| Ответы MCP test-агента | `src/main/agent/fake-query.ts` |

**Поток данных.** Driver Vendor-а Session шлёт свои строки событием `mcp`. Session добавляет строки серверов, выключенных
для неё, и шлёт по `agent.event` только изменение; store renderer-а держит последние строки каждой Session отдельно от
transcript-а. Chip один раз спрашивает `agent.mcp`, пока строк у него нет, и с `pickUp` — при каждом открытии popover-а.
Кнопка зовёт `agent.mcpAction`, который отвечает строками после действия или ошибкой Vendor-а; «Allow all» зовёт
`agent.mcpAllowAll` с именами, ответ тот же. `agent.mcp` — канал чтения, `agent.mcpAction` и `agent.mcpAllowAll` — каналы
записи, поэтому read-only доступ на Linked machine может читать, но не действовать.

#### Test-ы

| Test | Что проверяет |
|---|---|
| `test/unit/mcp-status-row.test.ts` | Источник каждого слова SDK и строки записанного ответа. |
| `test/unit/mcp-chip.test.tsx` | Счёт chip-а, его предупреждение, строки и группа popover-а, кнопки, «Allow all», popover вверх, вопрос с `pickUp` при открытии. |
| `test/unit/session-view.test.tsx` | Chip в строке под полем ввода, не в шапке, и его нет у Product Session. |
| `test/unit/edit-profile.test.tsx` | Статус рядом с каждым именем списка MCP servers в Edit profile, его нет без Session и у Project-а Linked machine. |
| `test/unit/codex-mcp-row.test.ts` | Строки Codex: каждый статус, Sign in только для HTTP-сервера, tool-ы, источник, никогда не «not allowed». |
| `test/contract/claude-mcp-status.test.ts` | Событие `mcp` Session Claude Code над fake agent-ом, `agent.mcp`, Reconnect и порядок ответов. |
| `test/contract/claude-mcp-pickup.test.ts` | Подхват нового сервера только между ходами и ничего в Session Autopilot. |
| `test/contract/claude-mcp-turn-off.test.ts` | Перезапуск с тем же разговором после выхода старого процесса, Turn off и Turn on, нет Turn off у сервера worfy, перезапуск до первого хода. |
| `test/contract/claude-mcp-inventory.test.ts` | Query инвентаря и строки «not allowed». |
| `test/contract/claude-mcp-allow.test.ts` | Allow и Allow all через stub `bin/profile-set`, отклонённая запись, ключ очереди worktree-а, отказ Turn off у worfy-canvas через IPC. |
| `test/contract/claude-mcp-sign-in.test.ts` | Sign in, connector claude.ai, ничего в log-е, Claude Code без входа. |
| `test/contract/codex-mcp-status.test.ts` | Session Codex на fake app-server: уведомления, список, Reconnect, Sign in, отклонённые действия. |
| `test/contract/sdk-compat.test.ts` | В SDK всё ещё есть метод входа, который зовёт worfy. |
| `test/e2e/session-mcp.spec.ts` | Chip под полем ввода и popover над ним в собранном приложении, Reconnect, Allow в той же Session. |
