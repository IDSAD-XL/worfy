# Что Harness делает без приложения и где ему нужно приложение

- **Дата:** 2026-11-09, main `b41c83c13`, Claude Code 2.1.319 на Mac.
- **Ticket:** [05](issues/05-что-harness-делает-без-приложения.md) темы `roadmap-worfy`; карта — [map.md](map.md).
  Вопросы владельцу по итогам — [Ticket 06](issues/06-что-значит-полноценно-без-приложения.md).
- **Статус:** исследование, не решение.
- **Вопрос.** Что из Harness (plugin `worfy` для Claude Code: правила, skills, agents, hooks, скрипты `bin/`, Gate) уже
  работает в обычном Claude Code без приложения worfy? Где он опирается на приложение? Чего не хватает и сколько это
  Ticket-ов?
- **Как проверено.** Прочитаны код и документы репозитория, установленный Harness в `~/.claude/worfy-harness/`, записи
  Claude Code в `~/.claude/plugins/` и `~/.claude/settings.json`. `ps` показал, откуда берут plugin живые Session-ы.
  Справка `claude plugin … --help` и страницы code.claude.com о plugin-ах прочитаны 2026-11-09. Четыре read-only агента
  прочесали Harness, код приложения, `docs/features` и ход одной Wave. Каждую их строку `file:line`, на которую здесь
  ссылка, я перечитал. Ничего не ставилось; кроме `--help` запускался только `claude plugin validate` (он только читает).
- **Термины.** Harness home — папка состояния Harness, `~/.claude/worfy-harness`. Profile — настройки Project-а для
  Harness (`projects/<name>/profile.json` и `rules.md` в Harness home). Реестр Gate — `gate/config.json` там же. Wave —
  Ticket-ы одного Epic-а, которые идут параллельно. Autopilot — часть приложения, которая шлёт Wave-ы без человека.

## 1. Вердикт

- **Ядро уже работает без приложения.** Ни один hook или скрипт Harness не говорит с приложением: нет socket, HTTP или
  IPC. Состояние лежит в Harness home, а не в папке данных приложения: «`claude` в терминале про неё не знает» (ADR-0040
  о доставке Harness, `docs/adr/0040-harness-delivery-local-marketplace.md:133-134`). Терминальный `claude` здесь уже
  работает на plugin-е: у него запущен `node ~/.claude/worfy-harness/plugin/bin/qmd-mcp`.
- **Главный пробел — установка и обновление.** Ставит, обновляет и проверяет plugin только приложение. Из публичного
  репозитория на GitHub одной командой не поставить: в корне нет `.claude-plugin/marketplace.json`. Из клона — две
  команды, но без версии, без qmd и без инструкции.
- **Второй — настройка машины.** qmd (локальный поиск по документам), согласие на его модели и проверки First run есть
  только в приложении. Без qmd Harness работает, поиск уходит в grep.
- **Третий — мелкие пробелы в skills.** connect-project в терминале просит вставить вывод `project-connect --facts`.
  Ticket-ы от `/worfy:to-tickets` не проходят `ticket evidence` (нет секции «Done when»), и в приложении тоже.
- **Без приложения нет Autopilot.** Одна Wave в терминале проходит целиком, но следующую Wave человек отправляет сам.
  Только в приложении: notifications, Flight recorder, Mind map, Cards, Browser, Linked machines.
- **Оценка:** 15–20 Ticket-ов. Ядро (установка, настройка, подключение, тесты, приёмка) — 11–12.

## 2. Установка и обновление сегодня

**Как ставит приложение.** Каждая сборка несёт копию Harness и ставит её как plugin `worfy` в область пользователя
(`docs/features/harness.md:12-15`). Копия ложится в `~/.claude/worfy-harness/plugin`, затем идут команды
(`src/main/harness/install.ts:894-898`): первый раз `claude plugin marketplace add ~/.claude/worfy-harness/plugin` и
`claude plugin install worfy@worfy-harness --scope user`, при другой версии `claude plugin update worfy@worfy-harness
--scope user`. Их выполняет бинарник Claude Code из SDK приложения, не `claude` пользователя
(`src/main/ipc/harness.ts:123`). Папка `plugin` — сразу и marketplace, и plugin: источник `"./"`
(`harness/.claude-plugin/marketplace.json:5`, `:10`). Зависимостей из `claude-plugins-official` сейчас нет: skills из
`mattpocock-skills` лежат в самом plugin-е (`docs/features/harness.md:49-51`). Новая Stable copy (установленная сборка
приложения) ставит свой Harness при первом старте (`docs/features/harness.md:104-111`). Dev-сборка ставить не может:
она «would replace the Harness that the terminal and the Stable copy work on» (`docs/features/harness.md:40-42`).

qmd — часть Harness (ADR-0043), но его ставит First run приложения: `npm install -g @tobilu/qmd@2.8.3`, затем `qmd pull`
после согласия; ответ пишется в `~/.claude/worfy-harness/qmd-models` (`src/main/harness/qmd.ts:10-11`, `:18-24`). Без
строки `downloaded` в этом файле сервер qmd не стартует, и агенты ищут grep-ом (`harness/bin/qmd-mcp:10-17`).

**Где лежит plugin.** На машине три копии:

| Копия | Где | Кто её грузит |
|---|---|---|
| В bundle приложения | `<app>/Contents/Resources/harness` (`src/main/harness/bundled.ts:18`) | Session-ы, которые запускает worfy: копия идёт inline (`src/main/vendors/claude/options.ts:676`) и молча заменяет установленный plugin |
| Локальный marketplace | `~/.claude/worfy-harness/plugin` | терминальный `claude`. Plugin из локальной папки Claude Code грузит на месте, без копии (docs: plugins/loading, «In-place and copied plugins»); `ps` это подтверждает |
| Кэш Claude Code | `~/.claude/plugins/cache/worfy-harness/worfy/<версия>/` | на неё указывает `installPath` в `installed_plugins.json`, но по `ps` ни один сервер qmd оттуда не запущен |

**Без приложения plugin остаётся.** Plugin-папка, Harness home и `enabledPlugins` лежат вне bundle; перестанут приходить
обновления. Сломается одно: приложение с согласия пользователя пишет в `~/.claude/settings.json` `statusLine`, который
запускает `<app>/Contents/Resources/statusline-bridge.sh` (`src/main/harness/status-line.ts:1-11`; на этом Mac так и
записано). Пока `.app` на месте, этот скрипт status line не ломает (`scripts/statusline-bridge.sh:20-21`); после
удаления `.app` команда указывает на файл, которого нет.

**Руками из клона — по документации должно работать, не запускалось.**

```sh
git clone <URL из README.md:35> ~/src/worfy
claude plugin marketplace add ~/src/worfy/harness
claude plugin install worfy@worfy-harness --scope user
# одной командой: claude plugin install worfy --marketplace ~/src/worfy/harness
# на одну Session, без установки: claude --plugin-dir ~/src/worfy/harness
```

`claude plugin validate` по `harness/` проходит с предупреждениями: нет LICENSE и иконки. Где ломается:

- **Нет версии.** В исходнике `plugin.json` без `version`, её пишет сборка (`docs/features/harness.md:421-422`). Claude
  Code грузит plugin из локальной папки «whatever its version string says». Но приложение «не версию сборки» не
  заменяет: это отказ на шаге `copy` (`docs/features/harness.md:99`).
- **Одно имя marketplace.** У пользователя может быть только один marketplace с именем `worfy-harness` (docs:
  plugins/marketplace-reference). Если человек потом поставит приложение, оно найдёт это имя на клоне. Что сделает
  installer — не проверено.
- **Ветка клона и есть Harness.** Plugin грузится из клона на месте: `git checkout` другой ветки меняет Harness со
  следующей Session, нужен отдельный клон. Заодно грузятся `bin/tests`, `hooks/tests`, `evals`, которые сборка
  выкидывает (`electron.vite.config.ts:15`); вреда не видно.
- **qmd руками.** Инструкции для человека нет: команды и файл `qmd-models` знает только код приложения.

**Прямо из GitHub — не работает.** `claude plugin marketplace add <owner>/worfy` ищет `.claude-plugin/marketplace.json` в
корне репозитория, а он лежит в `harness/`. По документации файл в другом месте объявляют только в
`extraKnownMarketplaces` с полем `path`, «because `claude plugin marketplace add` has no option for it»
(plugins/marketplace-reference, «Marketplace file»). ADR-0040 отверг marketplace на GitHub, потому что «нужны сеть и
доступ к private-репозиторию» (`docs/adr/0040-harness-delivery-local-marketplace.md:122-123`). Репозиторий теперь
публичный, этот довод ушёл.

## 3. Подключение Project-а без приложения

У skill-а `worfy:connect-project` есть ветка для терминала: `/worfy:connect-project <folder> <full|silent>` без
`--draft-only` (`harness/skills/connect-project/SKILL.md:110-128`). Он показывает черновик `{ profile, rules, gate }`,
проверяет его `project-connect --check` и только после явного «да» пишет через `bin/project-connect` (`:112-123`). Тот
пишет в Harness home (`HARNESS_HOME`, по умолчанию `~/.claude/worfy-harness`, `harness/bin/project-connect:75`):
`projects/<name>/profile.json` и `rules.md`, записи реестра Gate в `gate/config.json`, папку Workflow для Silent mode и
один commit в git Harness home (`git init`, если его нет). Потом qmd collections, если qmd стоит и модели скачаны, иначе
`skipped` с причиной (`:13-21`). В репозиторий Project-а он пишет только строку `.claude/worktrees/` в
`.git/info/exclude`, и только в Silent mode (`:48-49`).

В терминале это работает end to end. Пробелы:

1. **Факты руками.** Черновик делается «with Read, Glob and Grep only — never Bash» (`SKILL.md:32`). Ветки и remotes
   даёт `project-connect --facts`. В приложении его запускает worfy, в терминале skill просит человека «run that one
   command and paste its output» (`:37-39`).
2. **Нет аккаунта GitHub.** `github.account` остаётся `null` (`:76`), и hook `gh-token-env.mjs` ничего не делает
   (`harness/hooks/gh-token-env.mjs:16-17`): `gh` работает под своим активным аккаунтом. В приложении аккаунт выбирают в
   форме (`src/main/projects/connect.ts:28-30`). `bin/profile-set` это поле не пишет, так что при нескольких аккаунтах
   gh — правка `profile.json` руками.
3. **Поля, которые ставит приложение.** `language.reports` worfy берёт из языка системы (`SKILL.md:71`). Без него
   `bin/profile` берёт `user.json`, потом Profile, потом `en` (`harness/profiles/README.md:150`). `mcp.allowed` по
   умолчанию `["plugin_worfy_qmd", "worfy-canvas"]` (`SKILL.md:73`), но это поле читает только приложение для своих
   Session-ов (`harness/profiles/README.md:215`).
4. **Проверок меньше.** Приложение ещё проверяет, что plugin стоит и включён, сверяет ответ со схемой (`--schema-only`) и
   добавляет Project в свой список (`src/main/projects/connect.ts:11-25`). Skill в терминале этого не делает.

## 4. Где Harness опирается на приложение

| Что даёт приложение | Кто в Harness это использует | Без приложения |
|---|---|---|
| Установка и обновление plugin-а | весь plugin | только руками (§2), инструкции нет |
| MCP `worfy-browser`: в процессе приложения, только его Session-ам (`src/main/vendors/claude/options.ts:661-670`) | Browser-проверки implementer-а (`harness/skills/ship-ticket/implementer-browser-checks.md:3`) | критерии уходят в `not_verified` (`:20-21`) |
| MCP `worfy-mind-map`: `mind_map_*`, `product_save` | правила Product Session (`harness/hooks/rules/product.md:21`, `:43-44`, `:84`), skill `product-ideas` | `product-ideas` отдаёт идеи в ответе (`SKILL.md:78`). У `product.md` запасного пути нет, а commit он запрещает (`:79`) |
| MCP `worfy-canvas`: Cards, `autopilot_start` | никто, кроме значения по умолчанию в `mcp.allowed` | ничего не меняется |
| Переменная `WORFY_SESSION_KIND=product` | `harness/hooks/inject-rules.mjs:13-16`, `harness/hooks/stage-lines.mjs:150` | Session обычная; правила Product Session в терминал не попадают |
| `HARNESS_HOME` для скриптов, которые запускает само приложение (`src/main/harness/locate.ts:98`) | все скрипты и hooks | по умолчанию `~/.claude/worfy-harness` (`harness/hooks/eval-env.cjs:37-38`): приложение и терминал делят одну папку |
| Установка qmd и файл `qmd-models` | MCP `qmd`, `qmd-refresh`, `project-connect` (`harness/bin/qmd-mcp:12`, `harness/skills/qmd/SKILL.md:50-51`) | сервер не стартует (exit 3 или 127), поиск идёт grep-ом |
| Autopilot шлёт следующую Wave и `/worfy:gate-queue` | `harness/skills/epic-wave/SKILL.md:1765`, `harness/skills/gate-queue/SKILL.md:12-13` | человек набирает ту же команду |
| Экран Mac не спит между командами Wave только в run-е Autopilot (`epic-wave/SKILL.md:1276-1277`) | `wave-gate` | Gate full ждёт, пока экран разблокируют; `caffeinate` руками |
| Кнопка Build и месячное напоминание | skill `human-review-setup` (`SKILL.md:3`) | `--refresh` руками |
| Читатели вывода: файл verdict Gate (`harness/hooks/gate.mjs:45`), `epic-status --json`, `decisions.tsv` | — | вывод пишется всё равно; hooks и агенты читают exit code и строку `[gate]` |
| `statusLine` в `~/.claude/settings.json` ведёт в bundle | не Harness: все Session-ы пользователя | без `.app` status line теряет команду |
| Codex: plugin, `.codex-plugin/plugin.json`, agent TOML (`docs/features/harness.md:155-162`) | Session-ы Codex | пути установки без приложения нет |

## 5. Функции только приложения

| Функция | Что делает | Форма в обычном Claude Code |
|---|---|---|
| Autopilot и очередь | шлёт Wave за Wave-ой, ждёт сброса Limits, повторяет после ошибки API (`docs/features/autopilot.md:3-4`, `docs/features/autopilot-faults.md:3`) | **разумна**: цикл вокруг `claude -p "/worfy:epic-wave …"`. «Next wave» уже даёт `bin/wave-brief` (`harness/bin/wave-brief:23`), но ready Wave приложения строже: учитывает пересечение файлов и ветки worktree (`docs/features/workflow.md:75-84`) |
| Auto-continue | продолжает run после временной ошибки API (`docs/features/autopilot-faults.md:39-42`) | только вместе с терминальным Autopilot |
| Eco mode | пишет `workflow.agents: eco` и `agents` в Profile (`docs/features/orchestrator-modes.md:30-31`) | **уже есть**: `bin/profile-set --field workflow.agents` (`harness/bin/profile-set:14-19`) |
| Pipeline editor | порядок шагов Ticket-а в Profile (`docs/features/workflow.md:307`) | **уже есть**: `bin/profile-set` |
| Auto-approval | отвечает на запросы разрешений в run-е; хранится в `app-settings.json` (`docs/features/auto-approval.md:15`) | не нужна: у Claude Code свои режимы разрешений |
| Flight recorder | timeline одного run-а Autopilot (`docs/features/flight-recorder.md:3`) | нет без Autopilot; логи Gate и `decisions.tsv` уже лежат в Harness home |
| Notifications | системные уведомления, в том числе «Finished its turn» терминальной Session (`docs/features/notifications.md:17`) | **разумна**: hook на `Notification` или `Stop` с уведомлением ОС; у Harness таких hooks нет (`harness/hooks/hooks.json`) |
| First run и Health | проверки машины с действиями (`docs/features/onboarding.md:45-57`) | **разумна**: скрипт с теми же строками |
| Stable copy и Update | собирает `main` и меняет копию вместе с Harness (`docs/features/updates.md:3`) | для Harness хватит `git pull` клона или `claude plugin marketplace update` и `claude plugin update` |
| Limits | показывает Limits в toolbar (`docs/features/transcripts-and-usage.md:179`) | не нужна: Claude Code отдаёт `rate_limits` своей status line (`:203-204`) |
| Mind map и Product Session | Session-советник записывает разговор в Mind map (`docs/features/product-session.md:3-4`) | **частично**: `WORFY_SESSION_KIND=product claude` даёт правила, но не tools |
| Cards, Browser, Canvas, Focus mode | узлы и экраны окна приложения | нет: без окна им нечего показывать |
| Linked machines | связь двух worfy по 6-значному коду (`docs/features/link.md:4`) | нет. Проверка PR на второй машине через labels GitHub уже работает skill-ом `/worfy:gate-queue` |

## 6. Gate без приложения

Gate работает без приложения. Нужны bash, node 18+, git и запись в реестре.

- Gate запускают hooks `TaskCompleted` и `TeammateIdle` через `hooks/gate.sh fast` (`harness/hooks/hooks.json:82-103`).
  `stop.mjs` на `Stop` Gate не запускает, а держит ход, пока последний run красный (`harness/hooks/stop.mjs:2-3`,
  `:29-30`). В Wave агенты зовут `node <plugin>/hooks/gate.mjs fast` или `full` сами.
- `gate.sh` ищет node 18+ в PATH, `/opt/homebrew/bin`, `/usr/local/bin` и nvm; без него — «not verified: node not
  found», exit 3 (`harness/hooks/gate.sh:4-15`).
- Реестр — `$HARNESS_HOME/gate/config.json` (`harness/hooks/gate.sh:269-276`), его пишет `project-connect`. Проект не в
  реестре — exit 3 (`harness/hooks/gate.mjs:30-31`); вне git — exit 0 (`harness/hooks/gate.sh:294-296`).
- Приложение только читает файл verdict (`harness/hooks/gate.mjs:45`); hooks и агенты решают по exit code и `[gate]`.

## 7. Платформы

- **Везде:** node 18+ для Gate и скриптов, 22.14+ для qmd (`harness/bin/qmd-mcp:15-17`); git; gh, кроме `local-green`;
  jq: `epic-wave` пишет `epic-status --json | jq` (`harness/skills/epic-wave/SKILL.md:169`). Harness home всегда
  `~/.claude/worfy-harness`, даже при своей Claude home в `CLAUDE_CONFIG_DIR` (`harness/hooks/eval-env.cjs:37-38`).
- **macOS:** основная платформа. `wave-gate` спрашивает `ioreg` о блокировке экрана и держит экран через `caffeinate`,
  если они есть в PATH (`harness/bin/wave-gate:69-71`, `harness/skills/epic-wave/SKILL.md:1274-1277`).
- **Windows:** нужен Git for Windows: «Claude Code and the Harness use its Git Bash» (`README.md:27`). Hooks зовут
  `node "…"`, кроме Gate: `gate.sh` — bash-скрипт (`harness/hooks/hooks.json:87`, `:98`). Без Git Bash hooks идут в
  PowerShell (docs: plugins/components), и `gate.sh`, видимо, не стартует; не проверено. Скрипты стартуют как
  `node <script>`: Windows не запускает файл по строке `#!` (`harness/hooks/session-start.mjs:26-27`).
- **Linux:** приложения нет: «Linux is not described: it has no package» (`docs/features/README.md:65`). Скрипты
  Harness знают Linux (`harness/bin/epic-board:82`, `xdg-open`), его shell-тесты идут в CI на Linux
  (`harness/README.md:92-94`). На Linux режим без приложения — единственный. Wave там никто не запускал.

## 8. Одна Wave в обычном Claude Code: по шагам

Метки: **работает**; **ломается** — не работает или нужен обход; **нужно приложение**.

1. **Поставить plugin** — команды из §2. **Ломается:** только руками из клона, без версии и без инструкции.
2. **qmd, по желанию** — `npm install -g @tobilu/qmd@2.8.3`, `qmd pull`, файл `~/.claude/worfy-harness/qmd-models` с
   первой строкой `downloaded`. **Нужно приложение** или знание его кода. Без qmd поиск идёт grep-ом.
3. **Подключить Project** — `/worfy:connect-project <repo> full` в `claude` из репозитория; по просьбе skill-а запустить
   `node ~/.claude/worfy-harness/plugin/bin/project-connect --facts <repo>` и вставить вывод. **Работает**, пробелы в §3.
4. **Spec и Ticket-ы** — набрать `/worfy:to-spec`, затем `/worfy:to-tickets`; модель сама их не вызывает
   (`harness/skills/to-spec/SKILL.md:4`). Ticket-ы ложатся в `.scratch/<epic>/issues/NN-<slug>.md`. **Ломается, и в
   приложении тоже:** в шаблоне нет секции «Done when» (`harness/skills/to-tickets/SKILL.md:69-82`), а `ticket evidence`
   в шаге 7 читает именно её (`harness/bin/TICKETS.md:63`) и падает (`harness/bin/ticket:749`). Обход — дописать секцию.
5. **Выбрать Ticket-ы Wave** — `node ~/.claude/worfy-harness/plugin/bin/wave-brief <epic>`, раздел «Next wave»
   (`harness/bin/wave-brief:23`). **Работает.** Форма «run wave N of epic X» требует таблицы Wave-ов в spec
   (`harness/skills/epic-wave/SKILL.md:230`); её не пишет ни один skill.
6. **Запустить Wave** — `/worfy:epic-wave tickets 01, 02 of epic <epic>`, та же команда, что шлёт Autopilot
   (`epic-wave/SKILL.md:223`). Дальше skill сам: Profile, `/worfy:gate-queue` на машине с `cross_machine_gate` роли
   `serve`, `preflight`, `epic-status | jq`, `gh pr list`, один поиск qmd. **Работает.**
7. **Implementer-ы** — по agent-у на Ticket в своём worktree: `ticket claim`, test, `gate.mjs fast`, `ticket evidence`,
   `gh pr create`. **Работает.** Browser-проверки уходят в `not_verified` (**нужно приложение**).
8. **CI, review, merge** — `gh run watch`, verifier, `ticket mark`, затем `bin/land --watch` в фоне мержит PR и открывает
   documents PR с `ticket done` (`epic-wave/SKILL.md:1242-1245`). **Работает** с gh. Если merge идёт через `wave-gate` на
   Mac, экран должен быть разблокирован (**нужно приложение** или `caffeinate`).
9. **Отчёт и стоп** — skill сохраняет brief и останавливается: «The next wave comes from worfy Autopilot or the» owner
   (`epic-wave/SKILL.md:1765`). Цепочку Wave-ов без человека даёт только приложение; в терминале — снова шаги 5–6.

## 9. Пробелы и размер

| # | Пробел | Что нужно | Ticket-ов |
|---|---|---|---|
| 1 | Plugin не ставится из GitHub | ADR о канале без приложения; `.claude-plugin/marketplace.json` в корне (`./harness` или `git-subdir`), версия без сборки, имя marketplace рядом с приложением | 2 |
| 2 | Нет инструкции «без приложения» | раздел в `README.md` и `docs/features/harness.md` (и `ru`): установка, `--plugin-dir`, обновление, удаление | 1 |
| 3 | Ручная установка и приложение не знают друг о друге | installer приложения узнаёт чужой marketplace `worfy-harness` и говорит, что делать; test | 1 |
| 4 | qmd ставит только приложение | скрипт Harness: pinned qmd, вопрос о моделях, `qmd pull`, файл `qmd-models`, collections | 1 |
| 5 | Проверки First run только в приложении | скрипт `doctor` со строками First run (`docs/features/onboarding.md:45-57`) | 1 |
| 6 | connect-project в терминале | skill сам запускает `--facts` (только чтение) и спрашивает аккаунт gh; `profile-set` пишет `github.account` | 1 |
| 7 | Ticket-ы от `/worfy:to-tickets` без «Done when»; нет таблицы Wave-ов | шаблон с секциями Profile; `to-spec` пишет таблицу Wave-ов. С приложением не связано | 1 |
| 8 | Status line ведёт в bundle | без приложения не трогать `statusLine`; при удалении вернуть команду пользователя | 1 |
| 9 | Режим без приложения ничем не проверен | CI job: plugin из папки во временную Claude home, connect, Gate, `epic-status` на Linux, macOS, Windows | 1–2 |
| 10 | Нет Autopilot в терминале | правила ready Wave в Harness, цикл `claude -p`, ожидание Limits, повтор после ошибки API, журнал, экран Mac | 3–5 |
| 11 | Нет notifications | hook с уведомлением ОС на трёх платформах | 1 |
| 12 | Product Session без Mind map | решение владельца: запись `mind-map.json` скриптом или только приложение | 0–2 |
| 13 | Приёмка Epic-а | владелец ставит Harness на чистую машину по инструкции и проводит одну Wave | 1 |
| — | Codex без приложения, если нужен | скрипт пишет `.codex-plugin/plugin.json` и agent TOML | 1–2 |

**Итого:** 15–20 Ticket-ов без Codex, 16–22 с ним. Ядро — строки 1–9 и 13 — 11–12 Ticket-ов. Autopilot, notifications и
Mind map — ещё 4–8; это вопрос Ticket-а 06: что из них должно быть в терминале.

## 10. Что не проверено

- Ни одна установка не запускалась: ни из клона, ни через `extraKnownMarketplaces` с `path` (где тогда корень marketplace
  и разрешится ли `./`). Неизвестно, что сделает installer приложения, если marketplace `worfy-harness` указывает на клон.
- Срабатывают ли `TaskCompleted` и `TeammateIdle` для subagent-ов в терминале. Wave на них не опирается: агенты зовут
  Gate сами.
- Есть ли `SendMessage` в терминальной Session (skill зовёт его: `harness/skills/epic-wave/SKILL.md:476`, `:683`,
  `:742-746`) и хватит ли фоновой команды на `land --watch` до 110 минут (`:1245`).
- Как Wave без приложения ждёт Stage `check`, на который отвечает Session другой машины (`epic-wave/SKILL.md:964-965`).
- Windows без Git Bash и Linux целиком: Wave там не запускалась. Codex без приложения разобран только по документам.
- Число Ticket-ов — оценка по аналогии с прошлыми Ticket-ами Harness, не план.
