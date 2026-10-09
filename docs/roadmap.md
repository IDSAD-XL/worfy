# Дорожная карта worfy: E2–E4

Status: принята владельцем 2026-10-06; раздел E3 переписан по решениям владельца 2026-10-07; разделы
`worfy-link` и `worfy-windows` добавлены по решениям владельца 2026-10-07, их «Готово, когда»
подтверждены 2026-10-08; разделы `worfy-review` и `worfy-terminal-ai` добавлены по решениям владельца 2026-10-09.
Source: итог проектирования 2026-10-06; [CONTEXT.md](../CONTEXT.md); ADR
[0017](adr/0017-english-canonical-terms.md)–[0021](adr/0021-mcp-servers-allowlist-in-profile.md), 0040–0047 (E3);
0052–0056 (`worfy-link` и `worfy-windows`); 0058 (`worfy-terminal-ai`).

## Куда идёт worfy

worfy становится самостоятельным сервисом: любой человек ставит его на свою машину, и вместе с ним
ставится весь Harness — правила, skills, агенты, скрипты и hooks, по которым агенты ведут работу над
Project. Путь туда — E2 → E3 → E4. Между E3 и E4 параллельно идут два Epic-а: `worfy-link` —
Machine-ы одного пользователя работают с Project-ами друг друга по локальной сети, и `worfy-windows` —
полный порт worfy под Windows. До первого внешнего пользователя worfy собирается из исходников.
Подпись Developer ID и нотаризация Apple, как и подпись установщика Windows, появляются только в E4.

## E2 — worfy-daily: worfy каждый день и Autopilot

**Цель.** Владелец ведёт работу из worfy каждый день. Wave-ы Epic-а идут в Autopilot — без человека:
worfy не даёт Mac уснуть, ждёт сброса Limits и продолжает с того же места.

**Готово, когда:**

- минимум две Wave-ы подряд прошли через worfy без человека;
- каждое вмешательство человека стало Ticket-ом;
- владелец неделю работает из worfy.

**Темы по порядку:**

- A — Autopilot.
- B — устойчивость и цена.
- C — UI-баги.
- D — наблюдаемость.
- E — качество test-ов.
- F — процесс ревью UI.

Первые Wave-ы содержат только тему A. Их ведёт Orchestrator из CLI. Дальше Wave-ы ведёт
Orchestrator worfy в Autopilot на стабильной копии приложения. Внешний агент наблюдает за ним через
computer use.

Ticket-ы — в [.scratch/worfy-daily/](../.scratch/worfy-daily/spec.md).

Неделя работы владельца из worfy идёт Epic-ом `worfy-week` (решение владельца 2026-10-07):
дефекты недели — его Ticket-ы, Wave-ы ведёт Autopilot. Ticket-ы — в
[.scratch/worfy-week/](../.scratch/worfy-week/spec.md).

## E3 — worfy-harness: Harness как часть worfy

Спроектирован 2026-10-07 (решения владельца). Epic `worfy-harness`, 26 Ticket-ов — в
[.scratch/worfy-harness/](../.scratch/worfy-harness/spec.md). Решения — ADR 0040–0047 в
[docs/adr/](adr/).

**Цель.** worfy версии X ставит и обновляет Harness версии X. Project подключается к worfy без
ручной правки `~/.claude` — в Full mode, как worfy и Auction, или в Silent mode, когда в
репозитории не должно остаться следов workflow.

**Готово, когда** (песочница — отдельные `HOME` и `CLAUDE_CONFIG_DIR` во временной папке):

1. В песочнице без файлов в `~/.claude` worfy ставит Harness своей версии. Первый запуск показывает
   проверки, qmd ставится с согласия пользователя.
2. Silent Project (тестовый репозиторий) подключается, и Wave на нём проходит. После неё в
   репозитории нет файлов workflow, а в ветках, коммитах и PR — номеров Ticket-ов.
3. На машине владельца в `~/.claude` осталось только личное. Одна Wave в Autopilot прошла на plugin
   без человека.
4. Auction остаётся в Full mode: его Profile перенесён, worfy показывает его Epic-и. Проверка только
   на чтение: писать в `/Users/alexey/Work/*` нельзя.
5. Ручной прогон под вторым пользователем macOS — шаг владельца.

**Решения.** ADR 0018, 0019 и 0021 остаются в силе. ADR-0020 (Profile из двух частей, общая часть —
PR-ом в репозиторий) заменён ADR-0042.

- ADR-0040 — доставка: worfy копирует `harness/` своей версии в `~/.claude/worfy-harness/plugin/` и
  ставит оттуда plugin `worfy` в область пользователя; Session-ы самого worfy грузят его inline;
  состояние машины — в `~/.claude/worfy-harness/`; версия `<semver>+<SHA>`.
- ADR-0041 — правила Harness доходят до Session и Subagent-а через hooks plugin-а `SessionStart` и
  `SubagentStart`, а не через `CLAUDE.md` пользователя.
- ADR-0042 — Profile целиком на машине; Full mode и Silent mode; Workflow folder; worktree новых
  Project-ов вне репозитория; в Silent mode ветки, коммиты и PR без следов workflow; поле
  `attribution`.
- ADR-0043 — qmd — часть Harness: worfy ставит его через npm, модели — с согласия, коллекции — по
  Profile.
- ADR-0044 — Harness на английском; язык отчётов и документов Project — из Profile; машинные строки
  без языка (вердикт Gate — JSON).
- ADR-0045 — один Ticket — один репозиторий; Project над несколькими репозиториями — всегда Silent
  mode; без прав на `origin` — локальный финиш.
- ADR-0046 — Autopilot при заблокированном Ticket-е на критическом пути делает один узкий круг ревью
  без владельца, если у находок уровень только med или low.
- ADR-0047 — развитие Harness: урок — PR в `harness/` и пересборка Stable copy; `~/.claude`
  заморожен после импорта; машина владельца переходит на plugin рано; во время Autopilot Stable copy
  не пересобирается.
- ADR-0048 зарезервирован за итогом spike Ticket-а 01: доходят ли hooks до Subagent-ов
  workflow-скриптов, выдаётся ли `GH_TOKEN` аккаунта Project-а через `CLAUDE_ENV_FILE`, как ставится
  plugin. Глобальный `gh` по-прежнему не переключается.

**Этапы плана** (номера Ticket-ов `worfy-harness`; Wave вычисляется по Blocked by, план Wave-ов —
в [spec.md](../.scratch/worfy-harness/spec.md)):

1. Без блокеров: spike (01), импорт Harness из `~/.claude` в `harness/` с историей git (02), раздел
   Autopilot в F-SPEC (03), worfy понимает префикс `worfy:` и новый формат команды Autopilot (10).
2. Harness по группам файлов: версия (04), правила для hooks (05), skills `epic-wave` и `ship-ticket`
   (06), agents (07), остальные skills и скрипты (08), вердикт Gate JSON-файлом (09).
3. Plugin в worfy: Profile schema 2 на машине (11), worfy находит Harness в plugin (12), установщик
   (13), перенос файлов из `~/.claude` (14), мост Limits из `.app` (15).
4. Шаг владельца — переход машины (16).
5. На plugin: qmd (17), `GH_TOKEN` у Session-ов агентов (18), экран первого запуска (19), узкий круг
   ревью в Autopilot (20), пометка «Harness в main новее, чем в Stable copy» (21), Silent mode в
   Harness и в worfy (22, 23), подключение Project (24), аккаунт GitHub Project-а (25).
6. Приёмка по пяти пунктам «Готово, когда» (26).

**Шаг владельца — Ticket 16.** Wave-ы до установщика и переноса проходит Autopilot на замороженном
`~/.claude`. Перед Ticket-ом 16 Autopilot останавливается: переход машины владельца на plugin
делает сам владелец — кнопка в worfy и подтверждение списка «уберу / оставлю». После перехода все
Wave-ы E3 идут на plugin. Откат — восстановление из резервной копии одной командой. Ещё два шага
владельца: один `/login` в песочнице для приёмки (Ticket 26) и второй пользователь macOS для
ручного прогона.

**Перенесено из E2 и чем закрыто:**

- Раздел Autopilot в [docs/design/F-SPEC.md](design/F-SPEC.md) — кнопка «Autopilot» и строка
  состояния прогона, как они сделаны в Ticket-е 29 `worfy-daily` — Ticket 03 `worfy-harness`.
- Известный предел Autopilot: при заблокированном Ticket-е на критическом пути он не доходит до
  конца Epic-а сам (так было с Ticket-ом 15 `worfy-daily`) — решение ADR-0046, реализация — Ticket
  20 `worfy-harness`.

**Не в E3:** смена режима Project на ходу; PR из форка, когда нет прав на `origin`; eval-кейсы
перевода Harness (`claude plugin eval`) — в E4.

## worfy-link — Linked machines

Спроектирован 2026-10-07 (решения владельца). Epic `worfy-link`, Ticket-ы — в
[.scratch/worfy-link/](../.scratch/worfy-link/spec.md). Решения — ADR-0052 и ADR-0053 в [docs/adr/](adr/).

**Цель.** Владелец работает с Project-ом одной своей Machine с другой: например, Project живёт на
Mac, а его Canvas, Session-ы и Terminal открыты на Windows-ПК. Работа выполняется на Machine
Project-а, оба экрана видят её вживую. Связь — только по локальной сети.

**Готово, когда:**

1. Два worfy связываются по коду — сначала dev-сборка и Stable copy на одном Mac, потом Mac и
   Windows; отзыв работает.
2. С другой Machine можно открыть Canvas Project-а, править его, писать в Session, печатать в
   Terminal, запускать и останавливать Autopilot — всё выполняется на Machine Project-а, оба экрана
   обновляются вживую, камера и ⌘Z у каждого свои.
3. Session, запущенная удалённо, переживает закрытие окна; «Add Project» на Linked machine — через
   просмотр её папок.
4. Уведомления приходят на подключённые Machine; Machine Project-а не засыпает, пока подключены; второй
   Autopilot на тот же Epic не стартует.
5. По умолчанию доступ выключен; проверка Origin/Host покрыта test-ами; токены не логируются.

Здесь «камера» — положение и масштаб Canvas на экране. Origin и Host — заголовки HTTP-запроса; их
проверка не даёт чужой веб-странице подключиться к worfy.

**Решения.**

- [ADR-0052](adr/0052-machines-and-linking.md) «Machines and linking» — Machine и Linked machine; у
  Project ровно одна Machine; host и client — роли соединения, а не виды Machine. «Link a machine»
  находит worfy в сети (Bonjour) или берёт адрес; вторая Machine показывает код из 6 цифр. Связь
  двусторонняя, по TLS с запомненным сертификатом. Переключатель «Linked machines can work with my
  Projects» по умолчанию выключен. Только LAN, проверка Origin и Host, отзыв с любой стороны. Список
  Project-ов слева сгруппирован по Machine, у каждой состояние: «в сети», «спит», «недоступна».
  «Add Project» — выбор Machine, затем папка через просмотр её файлов внутри worfy.
- [ADR-0053](adr/0053-several-screens-on-one-project.md) «Several screens on one Project» — общее
  состояние Project-а приходит на все экраны вживую. Камера Canvas своя у каждого экрана и уходит из
  общего Layout. ⌘Z отменяет только свои правки. Session живёт на Machine Project-а и не зависит от
  окна. Размер Terminal задаёт экран, где последним печатали. Системные диалоги открываются в UI
  Machine, откуда вызваны. Уведомления получают Machine Project-а и подключённые к нему Linked
  machine. Machine Project-а не засыпает, пока к ней подключены. Один Autopilot на пару Epic и
  `origin` (адрес репозитория на GitHub) на все Machine. Wake-on-LAN — позже.

**Порядок.** Начинается после закрытия E3, параллельно с `worfy-windows`. Ведёт Session на Mac
владельца. Связь сначала проверяется на одном Mac — dev-сборка и Stable copy. Пара Mac и Windows из
пункта 1 требует worfy на Windows из `worfy-windows`. Мерж в main — по очереди с `worfy-windows`
([ADR-0056](adr/0056-windows-checks-and-two-sessions.md)).

**Не в `worfy-link`:** работа вне локальной сети; Wake-on-LAN; браузерный клиент (отвергнут,
[ADR-0054](adr/0054-full-windows-port.md)).

## worfy-windows — Windows-порт

Спроектирован 2026-10-07 (решения владельца). Epic `worfy-windows`, Ticket-ы — в
[.scratch/worfy-windows/](../.scratch/worfy-windows/spec.md). Решения — ADR-0054, ADR-0055 и ADR-0056 в
[docs/adr/](adr/).

**Цель.** worfy работает на Windows целиком, а не как экран к Mac: Project, Canvas, агенты,
Session-ы, Terminal, Gate и Autopilot идут на самой Windows-машине. Пользователь, у которого есть
только Windows, тоже работает в worfy.

**Готово, когда:**

1. На чистой Windows 11 с Git for Windows, node и gh неподписанный установщик ставит worfy; первый
   запуск проходит проверки, установщик E3 ставит Harness plugin.
2. На Windows работают Project worfy, Canvas, Session-ы, Terminal на PowerShell, Gate, epic-status;
   одна Wave Autopilot проходит целиком (implementer, gate full на Windows, PR, мерж).
3. Скрипты Harness на Node работают на обеих системах, bash — только в test-ах, .gitattributes держит
   LF в скриптах.
4. qmd работает на Windows или grep явно запасной путь.
5. На Mac ничего не сломалось — gate full на Mac зелёный.

Здесь установщик E3 — Ticket 13 `worfy-harness`: worfy ставит Harness своей версии как plugin.
`epic-status` — скрипт Harness, который печатает строку этапа Epic-а. `gate full` — полный прогон
Gate. `.gitattributes` — файл git с правилами концов строк: LF — перевод строки, как на macOS, без
`\r` из Windows.

**Решения.**

- [ADR-0054](adr/0054-full-windows-port.md) «Full Windows port» — Windows 10 21H2+ и Windows 11, x64;
  arm64 позже. Git for Windows обязателен: worfy проверяет его и предлагает
  `winget install Git.Git`. node ≥ 22. Terminal — PowerShell: `pwsh`, если его нет — Windows
  PowerShell; Git Bash выбирается в настройках. До E4 установщик NSIS (формат установщика, который
  собирает electron-builder) не подписан. Если на ПК включён Smart App Control (защита Windows 11,
  которая блокирует неподписанные программы), вопрос подписи встаёт сразу. qmd на Windows — последним
  Ticket-ом порта, до него поиск — grep. Браузерный клиент и тонкий клиент (окно к worfy на Mac)
  отвергнуты: нужен полный порт.
- [ADR-0055](adr/0055-harness-scripts-in-node.md) «Harness scripts in Node» — всё, что вызывают hooks и
  worfy, переписывается на Node; bash остаётся только в test-ах. Причины: в Git Bash утилиты GNU
  coreutils, и `stat -f` там значит другое, чем на macOS; вызов скрипта по shebang (первая строка
  `#!` с именем интерпретатора) в hooks на Windows считается ненадёжным, но на живой Windows не
  проверен — это делает Ticket 01 Epic-а `worfy-windows`; скрипты qmd написаны на zsh, а zsh в Git
  Bash нет.
- [ADR-0056](adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions» — Windows-runner
  на PR в CI не добавляется. Перед мержем PR, который трогает платформенный код, `gate full` идёт на
  Windows-ПК владельца. Job «Windows» в CI запускается только вручную. Session на Mac
  (`worfy-link`) и Session на Windows (`worfy-windows`) общаются через репозиторий. Перед Wave каждая
  проверяет открытые PR второго Epic-а на общие файлы; мерж в main — по очереди.

**Порядок.** Начинается после закрытия E3, параллельно с `worfy-link`. Ведёт отдельная Session на
Windows-ПК владельца; неподписанный установщик собирает она же. Факты для Ticket-ов собраны чтением
кода и документации, на Windows ничего не запускалось. Поэтому первый Ticket — проверка фактов на
живой Windows и правка Ticket-ов порта.

**Не установлено** (проверяет первый Ticket `worfy-windows`): кодирует ли Claude Code на Windows путь
Project-а в имя папки так же, как worfy ожидает на Mac; нужна ли на Windows пересборка `node-pty`
(библиотека Terminal); работает ли qmd на Windows; хватит ли лимита длины пути Windows (260 символов)
для `.claude/worktrees/…/node_modules`.

**Не в `worfy-windows`:** Windows на arm64; подпись установщика — в E4.

## worfy-review — ревью и минимальные изменения в Harness

Заведён 2026-10-09 по решению владельца: взять в Harness приёмы трёх внешних проектов — ponytail
(prompt «минимальное изменение»), pstack (набор skills Lauren Tan для Cursor) и Thermos («thermo
nuclear code review» из `cursor/plugins`). Plugin-ы целиком не ставятся, берутся идеи и формулировки.
Разбор — [исследование 2026-10-09](research/2026-10-09-ponytail-pstack-thermos.md). Epic
`worfy-review`, Ticket-ы — в [.scratch/worfy-review/](../.scratch/worfy-review/spec.md).

**Цель.** Reviewer-ы ловят больше реальных дефектов и лишнего кода, а не больше шума; implementer
пишет минимальное изменение; зависание Electron-приложения оставляет stack trace как evidence.

**Темы:** проверки correctness из Thermos и сортировка находок по группам; линза «упрощение»;
предупреждение gate о файле больше 1000 строк; лестница минимального изменения и комментарии
`shortcut:`; диагностика зависаний Electron; журнал решений для Autopilot; режим max review по
запросу или по пометке риска у Ticket-а.

**Порядок.** Не блокирует E3 и `worfy-link`. Правки `harness/` действуют после `pnpm install:stable`
(ADR-0047: Harness ставится из Stable copy), линзы живут в Profile вне репозитория.

## worfy-terminal-ai — Terminal AI в Terminal-ах

Спроектирован 2026-10-09 (решения владельца). Epic `worfy-terminal-ai`, Ticket-ы — в
[.scratch/worfy-terminal-ai/](../.scratch/worfy-terminal-ai/spec.md). Решение —
[ADR-0058](adr/0058-terminal-ai-assist-process.md).

**Цель.** Модель Claude помогает владельцу набирать команды в Terminal-е worfy — на его подписке, как
Session-ы. Ничего не запускается само: команду запускает пользователь.

**Готово, когда** (подтверждено владельцем 2026-10-09):

1. В Terminal-е на zsh серый Suggestion появляется сразу из истории команд, а если история молчит —
   от модели после паузы; → принимает, Option/Alt+→ — по словам, Esc скрывает; его видят все экраны
   этого Terminal-а; история пользователя пишется как раньше.
2. После команды появляется Next command; строка `# …` и панель Cmd+I вставляют команду по
   просьбе словами; «Fix» после ошибки вставляет исправленную. Сама ни одна команда не запускается.
3. Модель зовёт один общий процесс Claude Code на подписке без MCP, tools, настроек пользователя и
   транскриптов, hooks встроенных plugin-ов проверены; его запросы видны в Limits; автоматические
   функции выключаются сами выше 80 % окна 5 часов и при `allowed_warning` или `rejected`.
4. В модель уходит только перечисленный контекст, секреты заменены; запросов нет во время команды, на
   альтернативном экране и для строки с пробелом в начале; `~/.zshrc` не меняется.
5. Всё выключается в Settings → «Terminal AI»; test-ы не тратят подписку; live-проверка владельца
   пройдена.

**Решения.** [ADR-0058](adr/0058-terminal-ai-assist-process.md) «Terminal AI: свой процесс Claude Code
на подписке» — Terminal AI не Session: отдельный процесс Claude Code без MCP-серверов, tools,
настроек пользователя и транскриптов, один на все Terminal-ы, каждый запрос самостоятельный.
Suggestion — Haiku без thinking, Next command, Command request и Fix — Sonnet. Это исключение из
правила «Session-ам haiku нельзя»: у assist-процесса нет 634 tools MCP, из-за которых правило
появилось. Подписка, а не ключ API, — решение владельца с риском: support-статья разрешает Agent SDK
на лимитах подписки, а страница legal советует разработчикам продуктов ключ API (ADR-0058, пункт 7).
Серый текст рисует сам zsh (ZLE), а не renderer поверх xterm, поэтому его видят все экраны.

**Порядок.** Идёт на Mac параллельно с Epic-ом `worfy-ui` (его spec на 2026-10-09 ещё не влит).
Раздел Settings ждёт окно Settings из `worfy-ui`. Приёмку с live-проверкой на подписке проводит
владелец.

**Не в `worfy-terminal-ai`:** bash и fish — позже; PowerShell на Windows — позже, через предикторы
PSReadLine; ключ API.

## E4 — Для других людей

**Цель.** Любой человек ставит worfy вместе с Harness на свою машину и работает без помощи
владельца.

**Готово, когда** (черновик, уточняется при проектировании E4): первый внешний пользователь
поставил подписанную и нотаризованную сборку и подключил свой Project.

**Темы:** подпись Developer ID и нотаризация; подпись установщика Windows — до E4 он не подписан
([ADR-0054](adr/0054-full-windows-port.md)). Делаются только при первом внешнем пользователе. E4 идёт после
`worfy-link` и `worfy-windows`.

## Сознательно вне E2–E4

- Подпись и нотаризация до появления первого внешнего пользователя. До тех пор на Mac достаточно
  сборки из исходников и ad-hoc подписи, на Windows — неподписанного установщика NSIS (ADR-0054).
- Личные skills, MCP-серверы и память пользователя. Они не входят в Harness, и worfy их не ставит и
  не переносит. Исключение — qmd: он часть Harness (ADR-0043).
- Переключение глобального `gh`.
- Прямая запись worfy в репозиторий Project. Profile в репозиторий не попадает совсем: он целиком
  лежит на машине (ADR-0042).
- Всё, что было вне worfy-mvp и не названо выше:
  - Dock со встроенным браузером;
  - управление с телефона;
  - другие провайдеры моделей;
  - несколько окон;
  - синхронизация состояния worfy (Card-ы, Layout) с облаком (решение владельца 2026-10-07).
    Состояние Project-а живёт на его Machine; Linked machine работает с ним по локальной сети
    (ADR-0052).
