# Integrations

> Перевод [английской версии](../integrations.md), commit `same-pr`.

Один Feature. **Integration** — один аккаунт одного сервиса (Jira and Confluence, Linear, Notion, Sentry, GitHub, Figma
или свой сервер MCP) с меткой, например «Jira — client A». worfy добавляет его, входит в него и хранит вход на этой
Machine; Project включает Integration, и Session-ы этого Project-а получают её tool-ы как сервер worfy, ни разу не видя
token. У одного сервиса может быть несколько Integration-ов, по одной на аккаунт, поэтому два site-а Jira двух клиентов
работают рядом. Эта страница описывает раздел Integrations в Project settings, Add integration, два способа входа,
фильтр Tools и его цену, Settings → Integrations, Autopilot, Health check и Linked machine. Chip «MCP n/m», в котором
видна строка Integration работающей Session, — на странице [MCP servers of a Session](mcp-servers.md); там же серверы
MCP, которые пользователь сам добавил в Claude Code. Если термины незнакомы, начните с [Concepts](concepts.md).

## Integrations

### Behaviour

#### Каталог

Add integration показывает сервисы каталога, у каждого — способы входа («Sign in», «API token»):

| Сервис | Вход | Примечание |
|---|---|---|
| Jira and Confluence | страница входа Atlassian; API token (e-mail и token); token service account | Один site на вход: на каждый site — своя Integration. Token работает, только если admin организации включил вход по token-у (Admin → Rovo → Rovo MCP server → Authentication); форма говорит это и даёт ссылку на страницу token-ов. |
| Linear | страница входа; personal API key | |
| Notion | страница входа; Notion MCP token | |
| Sentry | страница входа; user auth token | |
| GitHub | personal access token или token аккаунта `gh` Project-а | Страница входа закрыта для клиента вроде worfy, поэтому её нет. |
| Figma | только страница входа | С пометкой: Figma принимает только клиентов своего каталога и может отказать worfy. |
| Custom server | страница входа сервера, token, свой заголовок или без входа | Адрес `https://` (`http://` — только на этом компьютере) или команда, которую worfy запускает на этой Machine. |

Slack в каталоге нет. Сервер Slack пускает только приложение Slack, зарегистрированное со своим secret-ом, а workspace-ы
клиентов владельца таких приложений не разрешают; Slack работает через connector claude.ai — один workspace на аккаунт
claude.ai, — и он виден в группе «From Claude Code» со своим Allow. Cookie token-ы Slack из браузера worfy не использует
никогда.

#### Как добавить Integration

- **Project settings → Integrations** — вкладка рядом с General. Её изменения сразу уходят в main: у вкладки Close, а
  не Save. Новый Project показывает «No Integrations in <Project> yet».
- **Add integration** открывает каталог. Integration этой Machine, которую Project ещё не использует, стоит сверху, под
  «Already on this Machine», с кнопкой «Use in this Project»: она включается здесь без второго входа.
- **Форма сервиса** принимает **Label**, уникальную на Machine без учёта регистра («Jira — client A»), и способ входа.
  При открытии формы выбран token; страница входа сервиса — второй вариант, а у Figma — единственный.
- **С token-ом** форма принимает token (для API token Atlassian — ещё и e-mail). Для GitHub она предлагает и «The token
  of the gh account <account>» со scope-ами, которые `gh` для него называет; worfy хранит копию, поэтому после `gh auth
  refresh` или выхода Integration живёт со старым token-ом, пока ей не дадут новый. Сохранение проверяет token у сервиса
  и затем показывает tool-ы: отвергнутый token — «Sign-in needed», любой другой ответ — ошибка с текстом сервиса, token-ы
  скрыты. Отказ Atlassian — ошибка со ссылкой на переключатель admin-а: верный token, который admin выключил, не отличить
  от неверного.
- **Со страницей входа** («Sign in with Atlassian», «Sign in with Linear»…) поля token-а нет: сохранение добавляет
  Integration и открывает страницу входа сервиса в окне worfy с заголовком «Sign in — <метка>». Пользователь входит там;
  окно закрывается само, как только сервис выдал вход. Экран открывает вход только в окне worfy: кнопки для системного
  браузера нет.
- **Custom server** принимает адрес и способ входа или команду с аргументами (через пробел) и переменными окружения.
  Переменная с пометкой Secret уходит в хранилище секретов worfy, а не в список Integration-ов.

#### Раздел Project-а

Под «worfy integrations» у каждой Integration Project-а — строка:

- **Метка и где она**: site и аккаунт, если вход их называет, иначе адрес сервера (host) или команда stdio. Вход через
  страницу сервиса не называет ни аккаунта, ни site, поэтому его строка показывает адрес. У token-а Basic аккаунт —
  e-mail. «Also used in <Projects>» называет другие Project-ы, где она включена.
- **Статус**: `Signed in`, `Sign-in needed` (с Sign in), `Error` с ответом сервиса, `Checking`. У `Sign-in needed` есть
  пояснение: Session-ы получают от её tool-ов «Sign-in needed».
- **Tool-ы и их цена**: «41 tools · ~9k tokens», с фильтром — «12 of 41 tools · ~3k tokens». Цена считается после
  фильтра Tools Project-а: именно это Session-ы Project-а получают в каждом запросе к модели.
- **Фильтр Tools**: All (по умолчанию), Read only — tool-ы, которые сервис помечает как только для чтения, — и Choose…
  со списком имён. Read only не предлагается сервису, который не помечает ни одного tool-а ни так, ни иначе, и меню
  говорит почему.
- **Enabled** включает и выключает Integration только в этом Project-е; выключенная строка говорит «Off in this
  Project». **Autopilot** («Available to Autopilot») у новой Integration выключен.
- **«…»**: Test (заново спрашивает у сервиса tool-ы), Rename (метка меняется на всей Machine), Re-sign in (только у
  Integration со входом через страницу сервиса), Sign out, Disable или Enable in this Project и Remove from Machine…,
  который сначала спрашивает подтверждение, если Integration включена в другом Project-е, а потом убирает её из всех
  Project-ов Machine.

**Sign out** удаляет token-ы Integration; у Integration со входом через страницу сервиса он сначала просит сервис
отозвать их (если у сервиса есть адрес отзыва) и стирает cookie её окна входа. Remove сначала делает Sign out.

#### From Claude Code

Под Integration-ами группа «From Claude Code» показывает серверы и connector-ы claude.ai Claude Code со статусом,
источником и Allowed или Not allowed, как Edit profile; Allow пишет список `mcp.allowed` Profile-а, как раньше. Profile
без списка показывает список по умолчанию разрешённым, как его получают Session-ы.

- У сервера, чьё имя — имя сервиса каталога («claude.ai Atlassian», `linear`), есть **Add as integration**: открывает
  Add integration на этом сервисе с адресом каталога. Список Profile-а сам не меняется.
- Если такой сервер разрешён, а Integration того же сервиса включена в этом Project-е, строка предупреждает «Two
  <service> tool sets in this Project»: Session-ы получают оба набора и могут взять не тот аккаунт. Она предлагает «Turn
  off <server> in this Project» — убрать имя из списка Profile-а. Пока сервер не разрешён, строка предупреждает до Allow.

#### Settings → Integrations

Settings → Integrations показывает все Integration-ы Machine, их статус и Project-ы, которые их используют, с Sign out и
Remove; Remove спрашивает подтверждение, если Integration включена хоть в одном Project-е. У Integration со входом через
страницу сервиса, которой нужен вход, есть и Sign in — через первый Project, который её использует. Integration, которую
не использует ни один Project, показывает «Not used in any Project». Записи, которые Project ещё держит об Integration,
которой на Machine больше нет (прерванный Remove), названы одной строкой с Clean up. Если список Machine не прочитался
(файл повреждён или другой версии и отложен в сторону), строка называет отложенный файл и говорит, что Clean up ждёт:
иначе каждая запись выглядела бы удалённой.

#### В Session

- Session Project-а — его Orchestrator или Session Node, на Claude Code или Codex — получает включённые Integration-ы
  при старте, каждую как сервер с именем по метке. Session, для которой worfy не нашёл Project, их не получает.
  Terminal и Terminal AI запускают Claude Code с его собственными серверами и Integration-ов не получают.
- Описание каждого tool-а начинается с метки («[Jira — client A] …»), чтобы агент с двумя аккаунтами одного сервиса
  различал их.
- Tool, чей вход сервис отверг, отвечает «Sign-in needed: <метка>. Ask the user to sign in in worfy.», а не молчит.
  Обновлённый access token Restart Session не требует.
- В chip-е «MCP n/m» у строки Integration — метка и источник `worfy integration`; её Sign in открывает окно входа worfy,
  никогда не вход Claude Code или Codex. Integration, которую Project включил после старта Session, стоит в группе
  «Enabled in this Project after this Session started.» с Restart Session: он перезапускает Session с тем же разговором и
  даёт ей Integration. Этот Restart предлагается только Session с человеком. Подробно —
  [MCP servers of a Session](mcp-servers.md#integrations).

#### В Autopilot

Session без человека получает только Integration-ы с «Available to Autopilot», прочитанные при её старте: набор
фиксирован на Wave, изменение Project-а во время Wave до неё не доходит, и её строки не предлагают Restart. Autopilot
никогда не открывает окно входа: при отказе входа tool отвечает «Sign-in needed», в Health check появляется строка, а
Run идёт дальше по своим правилам ошибок.

#### Health check

В Health check — non-critical строка на каждую включённую Integration каждого Project-а, чей вход сервис отверг или
которая упала: «<метка>: sign-in needed» или «<метка>: <текст сервиса>», token-ы скрыты. У строки Integration со входом
через страницу сервиса есть Sign in; остальные говорят положить новый token в Project settings → Integrations.
Выключение Integration в Project-е сразу убирает строку этого Project-а, включение в другом — даёт строку ему. Вход,
который снова работает, или Remove убирают строки.

#### On a Linked machine

- С доступом только на чтение раздел показывает список и статус, все элементы управления неактивны.
- С полным доступом работают галочки Enabled и Autopilot, фильтр Tools, Rename и Sign in. Окно входа открывается на
  Machine Project-а, и входит человек там.
- Add integration, token, Sign out и Remove остаются на Machine Project-а: «On the Project's machine only: a token never
  crosses the link.»

### How it works

- **worfy стоит между Session и сервисом.** Integration — сервер MCP worfy, чьи tool-ы — tool-ы сервиса. worfy main
  держит соединение с сервисом — streamable HTTP или stdio процесса, который worfy запускает сам, — одно на Integration
  и Machine, общее для всех Session-ов, которые её используют. Session Claude Code получает сервер внутри процесса worfy,
  как `worfy-canvas`; Session Codex ходит к нему через endpoint worfy на `127.0.0.1` с token-ом Session. Token сервиса не
  доходит до процесса агента: ни в аргументы, ни в окружение, ни в файлы Claude Code или Codex. Два аккаунта на одном
  адресе — два сервера с двумя именами, поэтому предел «один connector на сервис и аккаунт» здесь не действует. Пока
  worfy закрыт, tool-ы Integration-ов не работают.
- **Владелец — Machine, включает — Project.** Один вход служит каждому Project-у Machine, который включил Integration.
  Какие Integration-ы использует Project, с фильтром и галочкой Autopilot, — собственная настройка worfy о Project-е, а не
  поле Profile-а.
- **Секреты остаются в папке данных worfy.** Token-ы, OAuth-клиент и секретные переменные stdio-сервера лежат в файле,
  который может читать только пользователь (0600, в папке 0700), как секреты связи; Keychain не используется: ad-hoc
  подпись каждой сборки заставляла бы его спрашивать после каждого обновления. worfy ничего не пишет ни в Profile, ни в
  репозиторий, ни в `~/.claude.json`, `.mcp.json` или `config.toml` Codex — в Full mode и в Silent mode одинаково.
- **Вход.** Token проверяется запросом `initialize` к сервису. Вход через страницу сервиса — OAuth 2.1 с PKCE клиентом
  MCP SDK: он находит сервер входа сервиса, регистрирует worfy клиентом один раз на Integration и просит scope-ы каталога
  или те, что называет сервер, если в каталоге их нет. У окна каждой Integration свой cookie partition, поэтому второй
  аккаунт того же сервиса не подхватывает вход первого. Redirect возвращается на `127.0.0.1`, и его перехватывает окно,
  без слушающего порта. Вход, не законченный за 10 минут, отказывает. Access token обновляется внутри соединения, по
  одному refresh за раз: оба проверенных сервиса меняют refresh token при каждом обновлении, и второй refresh со старым
  стоил бы входа.
- **Фильтр режет то, что получает агент.** Proxy режет `tools/list` фильтром Project-а, а вызов tool-а, который фильтр
  убрал, отказывает до сервиса. Так для Integration соблюдается цена tool-ов в каждом ходе — довод списка Profile-а
  ([ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md)). Цена — длина JSON имён, описаний и схем tool-ов,
  делённая на 4, как оценка token-ов. Для серверов Claude Code экран не обещает, что выключение сервера сэкономит
  контекст: предупреждение о двух наборах tool-ов — о чужом аккаунте.
- **Имена.** Имя сервера — slug метки: латиница, цифры и `-`, не длиннее 24 символов, чтобы полное имя tool-а
  `mcp__<сервер>__<tool>` укладывалось в 128 символов, которые хранит Claude Code. Имя, занятое другой Integration
  Project-а, сервером Claude Code или своим сервером worfy (`worfy-…`), получает `-2`. Tool, чьё полное имя всё равно
  длиннее 128 символов, не показывается. Сервер пользователя из `config.toml` Codex с тем же именем в этой Session
  заменяется, и строка chip-а говорит это.
- **Только tool-ы.** Proxy передаёт tool-ы — текст, картинки и ссылки на ресурсы, как их дал сервис; проверенные сервисы
  не объявляют ни `resources`, ни `prompts`.
- **Список Profile-а остаётся для серверов Claude Code.** Integration-ов нет в `mcp.allowed`, policy tier их не трогает,
  и ни одна запись списка сама не становится Integration
  ([ADR-0111](../../adr/0111-integrations-mcp-servers-worfy-runs.md), поправка 2026-11-20 к
  [ADR-0021](../../adr/0021-mcp-servers-allowlist-in-profile.md#amendments)).
- **Linked machine секрета не получает никогда.** Каналы, которые читают список и статус, — каналы чтения; те, что
  меняют использование Integration в Project-е, — каналы записи; добавление, token и удаление — только локальные.

### Implementation

#### Модули

| Что | Где |
| --- | --- |
| Модель и каталог | `src/shared/integrations/types.ts`, `src/shared/integrations/catalogue.ts` |
| Список Machine и хранилище секретов; поле `integrations` Project-а | `src/main/integrations/store.ts`, `src/main/link/secrets.ts`, `src/main/projects/settings.ts` |
| Вход по token-у, token аккаунта `gh` | `src/main/integrations/auth/tokens.ts` |
| Вход OAuth, его окно, Sign out | `src/main/integrations/auth/oauth.ts`, `src/main/sign-in-windows.ts`, `src/main/window.ts` |
| Proxy, имена серверов, фильтр, цена | `src/main/integrations/proxy.ts` |
| Integration-ы Session Claude Code | `src/main/vendors/claude/query.ts`, `src/main/vendors/claude/mcp.ts`, `src/main/vendors/mcp.ts` |
| Integration-ы Session Codex и endpoint worfy | `src/main/vendors/codex/mcp.ts`, `src/main/mcp/http-server.ts` |
| Строки Integration в chip-е | `src/main/integrations/rows.ts` |
| Строки Health check | `src/main/integrations/health.ts` |
| Каналы `integrations.*` | `src/shared/ipc/integrations.ts`, `src/main/ipc/integrations.ts` |
| Раздел, Add integration, From Claude Code, цена | `src/renderer/integrations/IntegrationsSection.tsx`, `src/renderer/integrations/AddIntegrationDialog.tsx`, `src/renderer/integrations/ClaudeServers.tsx`, `src/renderer/integrations/dialogs.tsx`, `src/renderer/integrations/model.ts`, `src/renderer/integrations/cost.ts` |
| Вкладка в Project settings; Settings → Integrations | `src/renderer/shell/ProjectSettings.tsx`, `src/renderer/settings/IntegrationsSection.tsx` |

**Поток данных.** Add integration вызывает `integrations.add` и `integrations.setSecret` (он проверяет token) или
`integrations.signIn` (он открывает окно). Список Machine уходит в `<WORFY_DATA_DIR>/integrations/integrations.json`,
секреты — в `integrations/secrets.json` под ключами `<id>:access`, `<id>:refresh`, `<id>:client` и `<id>:env:<NAME>`, а
запись Project-а `{ id, enabled, tools, autopilot }` — в поле `integrations` файла `<Project data folder>/settings.json`.
На старте Session query Vendor-а читает записи Project-а и просит у proxy по серверу на каждую включённую Integration.
Proxy сообщает каждую смену статуса строкам Health check и отвечает на `integrations.status` и `integrations.tools`.

#### Test-ы

| Test | Что проверяет |
|---|---|
| `test/unit/integrations-catalogue.test.ts` | Сервисы первой версии без Slack, GitHub только по token-у, пометка Figma, условие admin-а Atlassian. |
| `test/contract/integrations-store.test.ts` | Список без секретов, секреты 0600 в папке 0700, уникальная метка, Remove вместе с секретами, поле Project-а, ничего не записано вне папки данных worfy. |
| `test/unit/integrations-auth-headers.test.ts` | Заголовки Bearer, Basic и свой заголовок, ни одного token-а в ошибке. |
| `test/contract/integrations-token-auth.test.ts` | Проверка token-а через `initialize`: верный, отвергнутый, 403 с текстом сервиса, две Integration-ы на одном адресе, token аккаунта `gh`. |
| `test/contract/integrations-oauth.test.ts` | Discovery, одна регистрация на Integration, PKCE и resource, loopback системного браузера, refresh без Restart и один refresh на десять вызовов, Sign out. |
| `test/unit/integrations-oauth-redirect.test.ts` | Redirect своей Integration и своего state, окно на partition Integration. |
| `test/contract/web-policy.test.ts` | Окно входа может ходить по страницам сервиса; новые окна и разрешения остаются запрещены. |
| `test/unit/sign-in-windows.test.ts` | Каждый список окон в main обходит окна входа. |
| `test/unit/integration-server-name.test.ts` | Slug метки, `-2` при совпадении, занятое имя Claude Code. |
| `test/contract/integrations-proxy.test.ts` | Две Integration-ы на одном адресе, каждая со своими данными, одно общее соединение, секрет stdio-сервера в окружении, отменённые вызовы, сменённый секрет. |
| `test/contract/integrations-claude-session.test.ts` | Session Claude Code получает ровно свои включённые Integration-ы рядом с `worfy-canvas`, список Profile-а не тронут, Autopilot, Turn off for this Session, источник и метка строки. |
| `test/contract/integrations-codex.test.ts` | Integration-ы Session Codex на fake app-server, фильтр на endpoint-е, ни одного token-а там, где его видит Codex или лог. |
| `test/unit/integrations-section.test.tsx` | Строки каждого статуса, фильтр Tools и его цена, галочки, меню «…», подтверждение Remove, «two tool sets» и «Add as integration», Linked machine. |
| `test/unit/add-integration-dialog.test.tsx` | Каталог без Slack, «Use in this Project», уникальная Label, поля token-а, Custom server по http и stdio. |
| `test/contract/integrations-screen.test.ts` | Каналы экрана: tool-ы до фильтра и цена после него, Sign out, список Machine с сиротами и Clean up, Remove из Settings, token аккаунта `gh`. |
| `test/unit/settings-integrations.test.tsx` | Settings → Integrations: строка отложенного списка, Sign in через Project, который использует Integration. |
| `test/contract/integrations-autopilot.test.ts` | Autopilot получает только Integration-ы с «Available to Autopilot», набор фиксирован на Wave, окна входа нет. |
| `test/contract/integrations-health.test.ts` | Строки Health check: non-critical, по одной на Project, где Integration включена, Sign in у OAuth, без token-а, возврат в OK. |
| `test/contract/integrations-linked-machine.test.ts` | Только чтение, полный доступ с Sign in на Machine Project-а, каналы, которые Linked machine не открыты никогда. |
| `test/e2e/integrations.spec.ts` | Add integration на stub-сервере в собранном приложении, два Project-а на одном адресе, каждый со своими данными, Sign in через OAuth в окне worfy, Restart, который даёт Integration работающей Session, отвергнутый refresh как «Sign-in needed» в строке, chip-е и Settings → Health. |
