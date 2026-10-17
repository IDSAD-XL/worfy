# 04 — Hooks Harness на Node; `hooks.json` зовёт каждый скрипт через `node`

Type: task
Status: done 2026-10-17T23:21Z
PR: #453
Blocked by: 03
Source: решения владельца 2026-10-07: Q19 (скрипты Harness, которые зовут hooks и worfy, — на Node; bash только в test-ах) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) — правила через hooks `SessionStart` и `SubagentStart`; evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

- **Hooks на bash** — четыре скрипта в `harness/hooks`. Gate к этому времени уже на Node (Ticket 03).
  - `inject-rules.sh` (46 строк) отдаёт часть правил `rules/<часть>.md` как `additionalContext` и
    подставляет в текст путь plugin вместо `${CLAUDE_PLUGIN_ROOT}` (`:31-45`). Без `jq` он ничего не
    внедряет и пишет одну строку в stderr (`:29`).
  - `session-start.sh` (126 строк на main `08e8256`, после PR #150) подмешивает в Session режим
    работы Project-а (Silent mode и `attribution: off`, `:88-98` — добавил PR #150), правила Profile,
    индекс уроков, карту Epic-а и напоминание о `/retro`. Зовёт `bin/profile` по shebang (`:40`,
    `:47`) и разбирает JSON `jq` (`:44` — `cwd` из stdin, `:48-49` — поля Profile, `:125` — ответ
    hook-а). Домашняя папка — из `HOME` (`:60`).
  - `session-end.sh` (37 строк, PR #150 его не менял) дописывает строку в
    `<Profile>/state/pending-retro.log`; зовёт `bin/profile` по shebang (`:23`, `:30`) и разбирает
    ответ `jq` (`:27`, `:31-32`).
  - Переменные для test-ов обоих: `CLAUDE_PROFILE_BIN`, `CLAUDE_GATE_CONFIG`, `CLAUDE_PROFILES_DIR`;
    `CLAUDE_SESSION_SECTION_CAP` читает только `session-start.sh` (`:65`).
  - `stop.sh` (197 строк) держит конец хода кодом 2, пока у worktree красный маркер Gate
    (`:156-183`), и один раз за Session говорит модели о «не проверено». Тег worktree — `shasum`
    (`:73`, `:75`). Время рождения транскрипта — `stat` в синтаксисе BSD или GNU по `uname`
    (`:77-85`); время 0 значит «не известно» (`:99-100`). Путь репозитория для реестра —
    `cd … && pwd` (`:43`), в Git Bash это `/c/…`.
  - Все, кроме `inject-rules.sh`, ищут node в nvm и `/opt/homebrew/bin` (`session-start.sh:31-37`,
    `session-end.sh:14-20`, `stop.sh:29-35`).
- **`harness/hooks/hooks.json`** (строки — main `08e8256`; PR #150 файл не менял) зовёт скрипты по shebang:
  `inject-rules.sh` (`:9`, `:18`, `:56`), `session-start.sh` (`:27`), `gh-token-env.sh` (`:36`),
  `stop.sh` (`:89`), `session-end.sh` (`:118`), `bin/worktree-lock` (`:45`, `:98`, `:127`),
  `bin/qmd-refresh` (`:107`, его переводит Ticket 15), `guard.mjs` (`:139`). Gate (`:67`, `:78`)
  Ticket 03 уже перевёл на `node`.
- **Hooks на Windows** (docs hooks Claude Code): команда hook-а идёт в Git Bash, а без Git Bash — в
  PowerShell. Git for Windows обязателен (Q18), так что команда `node "${CLAUDE_PLUGIN_ROOT}/…"`
  идёт в Git Bash. Проверено в песочнице на ПК владельца, Claude Code 2.1.233 (evidence Ticket-а 01,
  раздел 13):
  - команда hook-а идёт в `/usr/bin/bash` Git for Windows (MINGW64); вызов по shebang работает и у
    `.sh`, и у `.mjs` с `#!/usr/bin/env node`; форма `node "${CLAUDE_PLUGIN_ROOT}/…"` находит node;
  - `${CLAUDE_PLUGIN_ROOT}` (в команде и в окружении) и `CLAUDE_PROJECT_DIR` — `C:/…`; `cwd`,
    `transcript_path`, `tool_input.file_path` в stdin и `CLAUDE_ENV_FILE` — `C:\…`;
  - `HOME` у hook-а: в bash — `/c/Users/…`, в node-процессе — `C:\Users\…`; `os.homedir()` —
    `C:\Users\…` (раздел 07);
  - переменная, которую hook `SessionStart` пишет в `CLAUDE_ENV_FILE`, доходит до Bash tool, но не до
    окружения других hook-ов (на этом стоит `gh-token-env`).
- **jq в Git Bash ПК нет** (evidence, раздел 05): `inject-rules.sh` на Windows сейчас ничего не
  внедряет (`:29`), а `session-start.sh` и `session-end.sh` не разбирают ответы `profile`.
  `gh-token-env.sh` зовёт `jq` один раз (`:34`): читает `.cwd` из stdin hook-а; без `jq` берёт
  `$PWD`, а Profile читает `profile --field github.account` (`:37`) без `jq`. `stop.sh` не зовёт ни
  `jq`, ни `profile`, ему нужен `shasum` из `/usr/bin/core_perl` (evidence, разделы 05 и 18).
- **`harness/package.json`** нарочно без `"type"` (`:2`): у скриптов `bin` без расширения Node сам
  определяет, CommonJS это или ES-модуль. Файл с расширением `.mjs` — ES-модуль при любом
  `package.json`.
- **Hooks E3** (worfy-harness). На main `08e8256` есть `harness/hooks/gh-token-env.sh` (E3 Ticket
  18, hook `SessionStart`, пишет `GH_TOKEN` в `CLAUDE_ENV_FILE`; `hooks.json:36`) и его test
  `harness/hooks/tests/gh-token-env.test.sh`. PR #150 (E3 Ticket 22) влит как `3837558` и принёс
  bash-скрипт `harness/hooks/worktree-create.sh`; в `hooks.json` он не зарегистрирован, его никто не
  зовёт (evidence Ticket-а 01, раздел 18). По решению владельца 2026-10-09 скрипт и его проверки оставлены как
  документация для E3 Ticket-а 24 (подключение Project-а; закрыт 2026-10-09, PR #176 — worktree остался
  внутри репозитория). Решение владельца 2026-10-13: на Node скрипт не переносится — его ничто не
  запускает. Скрипт и его проверки в test-ах остаются как есть: семь в
  `harness/bin/tests/silent-mode.test.sh:215-243` и проверки текста в
  `harness/bin/tests/epic-wave-ship-ticket.test.sh:172`, `:213-214`. Удалять его или оставить, решается,
  когда дойдёт до worktree вне репозитория.
- **`worktree-create.sh` на Windows** (срез 05c Ticket-а 05, PR #437; Git Bash, main `9337e77`). В
  `silent-mode.test.sh` падают 3 случая: «WorktreeCreate outside», «hook tree», «WorktreeCreate
  default». Это дефект скрипта, не fixture-а: строка 65, `[ "${root#/}" != "$root" ]`, считает
  абсолютным только путь от `/`, и `worktree.root` вида `C:\…`, который `profile` печатает на
  Windows, считается относительным — дерево ложится внутрь репозитория; строки 56 и 89 (`pwd -P`)
  печатают путь POSIX `/tmp/…/.claude/worktrees/<имя>`, которым родной Claude Code на Windows не
  воспользуется. Test не менялся: fixture с `/tmp/…` спрятал бы дефект. Решение владельца
  2026-10-13 (пункт 7 «Что делаем»: скрипт не портируется) это не меняет; факты — для того, кто
  будет решать судьбу скрипта.
- **PR #150 правил и файлы этого Ticket-а:** `session-start.sh`, `guard.mjs`,
  `harness/hooks/tests/rules-hooks.test.sh`, `session-hooks.test.sh`,
  `harness/bin/tests/harness-home.test.sh`, `harness/profiles/README.md`, `harness/skills/retro/SKILL.md`
  (`git show --stat 3837558`). Строки ниже — main `08e8256`; перед началом перечитать эти файлы.
- **Имена hooks стоят ещё в** (main `08e8256`): `harness/README.md:15`, `:19`;
  `harness/profiles/README.md:40`, `:162-165`, `:321`, `:325`, `:408`; `harness/skills/retro/SKILL.md:35`;
  `harness/skills/tickets-to-tasks/SKILL.md:116`; комментарий `test/contract/harness-plugin.test.ts:82`;
  комментарии `harness/hooks/gate-resolve.mjs:37-38` и шапка Gate — `gate.mjs` Ticket-а 03 наследует
  упоминания `stop.sh` из `gate.sh:26`, `:35`, `:172-176`. Test-ы зовут hooks через `bash`:
  `harness/hooks/tests/rules-hooks.test.sh` (`:11`, `:58` — проверка бита исполнения, ожидаемые
  команды `hooks.json` — `:252-268`), `session-hooks.test.sh:15-16`, `gate-notverified.test.sh:15`,
  `gate-unregistered.test.sh:11`, `harness/bin/tests/harness-home.test.sh` (`:98-99`, `:147-148`,
  `:170`, `:183-184`, `:193`, `:243`).

## Что делаем

1. **Четыре hooks на Node** (Q19, ADR-0055): `inject-rules.mjs`, `session-start.mjs`,
   `session-end.mjs`, `stop.mjs` в `harness/hooks` вместо `.sh`; файлы `.sh` удаляются.
   - Поведение прежнее: тот же JSON на stdout, те же коды выхода (у Stop — 2 при красном маркере),
     те же тексты для модели, те же переменные для test-ов.
   - JSON разбирается и собирается `JSON.parse` и `JSON.stringify`, без `jq`.
   - Сбой внутри hook-а — одна строка в stderr и код 0, как сейчас: сломанный hook не ломает Session.
2. **Домашняя папка** — из `os.homedir()`, а не из `HOME`; `HARNESS_HOME` по-прежнему главнее. На
   Windows `os.homedir()` читает `USERPROFILE`, поэтому test-ы, которые подменяют `HOME`, задают тем
   же путём и `USERPROFILE` (как в Ticket-е 03).
3. **`bin/profile`** зовётся как `process.execPath` и путь к скрипту (`CLAUDE_PROFILE_BIN` или
   соседний `bin/profile`), не по shebang.
4. **Stop.** Тег worktree и путь репозитория для реестра — функции из `harness/hooks/gate-paths.mjs`
   (Ticket 03), без второй копии. Время рождения транскрипта — `birthtimeMs` из `fs.stat`. Если оно
   0 — правило прежнее (`stop.sh:99-100`): маркеры без Session не берутся.
5. **Поиск node в nvm и `/opt/homebrew/bin` уходит:** hook запускает сам node. Как node попадает в
   PATH Claude Code, решил Ticket 03 для Gate; hooks этого Ticket-а держатся того же решения. Без node
   в PATH Claude Code hook не запустит и покажет ошибку без блокировки. Session-ы, которые запускает
   worfy, получают PATH из login shell (`src/main/agent/env.ts`) — это проверяет пункт «Готово,
   когда» про Session на Mac.
6. **`hooks.json`.** Каждая команда — явный `node` и путь к скрипту, как велит ADR-0055 (пункт 2):
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"`. Ticket 03 для Gate сделал иначе: hook Gate зовёт
   файл запуска `gate.sh`, который без node отвечает сам (решение владельца 2026-10-14). Это четыре новых
   hooks, `gh-token-env`, `bin/worktree-lock` (`:45`, `:98`, `:127`) и `guard.mjs` (`:139`). События, matcher-ы и
   timeout-ы не меняются.
7. **Hook E3 на bash** — `gh-token-env.sh` — переводится так же, вместе со своим test-ом.
   `worktree-create.sh` не портируется (решение владельца 2026-10-13; не зарегистрирован в
   `hooks.json`, evidence Ticket-а 01, раздел 18); проверка «нет `.sh` в `harness/hooks`» ниже не
   считает его и `gate.sh` — файл запуска Gate: находит node и без node сам отвечает «проверить
   не удалось» (Ticket 03, PR #298; остаётся по решению владельца 2026-10-14, Ticket 46 закрыт).
8. **Ссылки на имена** — список в «Что происходит». После правки
   `git grep -nE '(inject-rules|session-start|session-end|stop)\.sh' -- harness src` пуст.

Не входит: Gate (Ticket 03); код внутри `bin/worktree-lock` — его `HOME` (`:39`) правит Ticket 05;
код `guard.mjs` не меняется, меняется только его вызов.

## Готово, когда

- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/hooks/tests/session-hooks.test.sh` — код 0 на Mac и в Git Bash на Windows-ПК. `rules-hooks.test.sh` проверяет новые команды `hooks.json`: у каждой — `node` и путь к скрипту plugin.
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh` и `bash harness/hooks/tests/gate-unregistered.test.sh` (гоняют Stop hook) — код 0 на Mac и в Git Bash на Windows-ПК.
- [ ] `bash harness/bin/tests/harness-home.test.sh` — код 0 на Mac.
- [ ] `git ls-files harness/hooks | grep -v /tests/ | grep '\.sh$' | grep -v -e '/worktree-create\.sh$' -e '/gate\.sh$'` пуст: в `harness/hooks` нет скриптов на bash вне test-ов, кроме двух — незарегистрированного `worktree-create.sh` (не переносится, решение владельца 2026-10-13) и `gate.sh`, файла запуска, который находит node и запускает `gate.mjs` (Ticket 03; остаётся точкой входа hook-а по решению владельца 2026-10-14).
- [ ] Mac, упакованная сборка этой ветки (`pnpm package`), открытая настоящим двойным щелчком в Finder. Запуск через `open` из терминала окружения Finder не даёт: `open` отдаёт приложению окружение терминала (прогон приёмки E3 2026-10-14; Ticket [37 Epic-а `worfy-harness`](../../worfy-harness/issues/37-скрипты-harness-из-главного-процесса-без-окружения-login-shell.md), «Риски»). Её Session получает копию Harness этой сборки (ADR-0049, E3 Ticket 12). В транскрипте Session есть `additionalContext` hook-а `SessionStart` с текстом `rules/orchestrator.md` и `rules/common.md`. После красного Gate в worktree (временная ошибка lint) Stop возвращает 2, и модель получает текст «The quality gate is red» (через раздел Mac checks PR, Q33).
- [ ] То же на Windows-ПК в Session Claude Code с plugin `worfy`: правила внедряются, Stop при красном Gate держит ход, `/hooks` показывает команды с `node`. Вывод — в Итог.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Mac — exit 0 (`pnpm test` гоняет test-ы Harness через `test/contract/harness-scripts.test.ts`). gate full на Mac зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac): `test/e2e/packaged.spec.ts` сверяет копию Harness в сборке с `harness`.

## Тесты

Сначала падающие test-ы, в Итог — как они падали:

- `rules-hooks.test.sh` с ожиданием новых команд `hooks.json` (`node` и `.mjs`) — на нынешнем main
  красный;
- `session-hooks.test.sh`, который зовёт `node "$HOOKS/session-start.mjs"` — на нынешнем main файла
  нет.

Остальное:

- Ожидания вывода в test-ах не меняются, кроме имён и команд: тот же JSON, те же коды выхода.
- В Git Bash ПК `jq` нет (evidence Ticket-а 01, раздел 05), поэтому проверки JSON в test-ах этого
  Ticket-а идут через `node -e`, а не `jq`.
- Случай «нет node» у Stop (`gate-notverified.test.sh:95`) уходит с той же причиной, что у Gate в
  Ticket-е 03.
- В Git Bash на Windows `session-hooks.test.sh` получает случай с `cwd` в виде, в каком его шлёт
  Claude Code на Windows: `C:\…` с `\`, а `CLAUDE_PLUGIN_ROOT` — `C:/…` (evidence Ticket-а 01,
  раздел 13).

## Где в коде

- `harness/hooks/inject-rules.mjs` (новый)
- `harness/hooks/session-start.mjs` (новый)
- `harness/hooks/session-end.mjs` (новый)
- `harness/hooks/stop.mjs` (новый)
- `harness/hooks/inject-rules.sh` (удаляется)
- `harness/hooks/session-start.sh` (удаляется)
- `harness/hooks/session-end.sh` (удаляется)
- `harness/hooks/stop.sh` (удаляется)
- `harness/hooks/hooks.json`
- `harness/hooks/gate.mjs`
- `harness/hooks/gate-resolve.mjs`
- `harness/hooks/gh-token-env.sh` (из E3 Ticket 18, на main; удаляется)
- `harness/hooks/gh-token-env.mjs` (новый)
- `harness/hooks/tests/gh-token-env.test.sh` (из E3 Ticket 18, на main)
- `harness/hooks/tests/rules-hooks.test.sh`
- `harness/hooks/tests/session-hooks.test.sh`
- `harness/hooks/tests/gate-notverified.test.sh`
- `harness/hooks/tests/gate-unregistered.test.sh`
- `harness/bin/tests/harness-home.test.sh`
- `harness/README.md`
- `harness/profiles/README.md`
- `harness/skills/retro/SKILL.md`
- `harness/skills/tickets-to-tasks/SKILL.md`
- `test/contract/harness-plugin.test.ts`

Модуль gate-paths.mjs из Ticket-а 03 только импортируется. В gate.mjs и gate-resolve.mjs меняются
только комментарии с именем Stop hook. Код bin/worktree-lock и guard.mjs не меняется. Общие файлы с Ticket-ом 03 (hooks.json, test-ы Gate, harness-home.test.sh, README) — он
идёт раньше, этот Ticket делает rebase на него. Ticket 05 (скрипты bin на Node) тоже правит
harness-home.test.sh и не ждёт этот Ticket: worfy не поставит их в одну Wave из-за общего файла,
второй делает rebase.

## Итог

### Hooks на Node (ветка `worfy-windows/04-hooks-node`, ПК с Windows)

- **Пять hooks на Node:** `inject-rules.mjs`, `session-start.mjs`, `session-end.mjs`, `stop.mjs`, `gh-token-env.mjs`; файлы `.sh` удалены. `worktree-create.sh` не тронут (решение владельца 2026-10-13), `gate.sh` остаётся файлом запуска Gate.
  - JSON — `JSON.parse`/`JSON.stringify`, без `jq`. `session-start` печатает JSON в одну строку вместо форматированного вывода `jq`; содержимое то же.
  - Домашняя папка — `HARNESS_HOME`, иначе `os.homedir()`; `profile` и resolver Gate запускаются через `process.execPath`.
  - Stop: тег worktree, путь репозитория и папка состояния — из `gate-paths.mjs`; время рождения транскрипта — `birthtimeMs`, при 0 маркеры без Session не берутся (`stop.mjs:30`, `:245`, `:269`).
  - `inject-rules` подставляет путь plugin буквально: путь с `Заполняется при закрытии.
` и `$1` проверен (`inject-rules.mjs:61`).
  - Сбой внутри hook-а — одна строка в stderr и код 0.
  - На Windows пути для модели пишутся через `/` (`C:/…`, `~/…`), в том числе вне домашней папки; сокращение до `~` требует границы пути (`/Users/xy` больше не сокращается до `~y`).
  - Поиск node в nvm и `/opt/homebrew/bin` ушёл: без node в PATH Claude Code hooks не запустит.
- **`hooks.json`:** каждая команда — `node "${CLAUDE_PLUGIN_ROOT}/…"` для пяти hooks, `bin/worktree-lock` и `guard.mjs`; hook Gate по-прежнему зовёт `gate.sh`. События, matcher-ы и timeout-ы те же. `rules-hooks.test.sh:363`: команда, которая называет скрипт Node, обязана начинаться с `node`.
- **Ссылки на имена:** READMEs, skills `retro`, `tickets-to-tasks`, а также устаревшие `gh-token-env.sh` в `epic-wave`, `ship-ticket`, `overnight-fix-loop`; комментарии `gate.mjs`, `gate-resolve.mjs`, `gate.sh`, `harness-plugin.test.ts`, `gate-verdict.test.sh`. `git grep -nE '(inject-rules|session-start|session-end|stop)\.sh' -- harness src` пуст; в `harness/hooks` вне test-ов из `.sh` остались только `worktree-create.sh` и `gate.sh`.
- **Вне трассы Ticket-а — миграция старого Harness** (`src/main/harness/migrate/plan.ts:295-297`). План переноса считал файл «в plugin» по тому же имени, и `~/.claude/hooks/stop.sh`, `session-start.sh`, `session-end.sh` перестали бы удаляться — только «оставить», а их записи в `settings.json` — «not in the plugin». Теперь старый `hooks/<имя>.sh` — это `hooks/<имя>.mjs` plugin-а. Новый unit test `test/unit/harness-migrate-renamed-hooks.test.ts` (идёт и на Windows): `stop.sh` и его запись удаляемы, `foo.sh` без пары — только «оставить» с пометкой. Мутант без сопоставления — красный. Случаи `harness-migrate.test.ts:102`, `:355-369`, `:571-573` на Windows не доходят до дела (файл падает раньше, на `:92`, путь `~\`, и на main тоже) — их подтверждает Mac.
- **Сначала падающие test-ы** (новые test-ы против кода main `90c5e72`): `rules-hooks.test.sh` — 104 ok / 43 FAIL («Cannot find module …inject-rules.mjs», `hooks.json` не совпадает, 4 × «a Node script without node», «0 inject-rules.mjs commands, not 3»); `session-hooks.test.sh` — 1 / 17 (node не находит `session-start.mjs`, rc=1 везде, в том числе в новых случаях Windows: `cwd` как `C:\…`, `CLAUDE_PLUGIN_ROOT` как `C:/…`).
- **Мутанты, все красные:** Stop выходит 0 при красном маркере — 4 FAIL; время рождения 0 принято — 1; `HOME` вместо `os.homedir()` — 1; без подстановки `${CLAUDE_PLUGIN_ROOT}` — 11; Stop в `hooks.json` без `node` — 2; путь вне домашней папки без `/` — 1; миграция без сопоставления — 1.
- **Попутно в `rules-hooks.test.sh`:** `grep -iF` в Git Bash падал с кодом 134, и проверка «части правил не упоминают Telegram» проходила, ничего не проверив (мутант со словом Telegram теперь красный); скобка с тире в проверке status line под локалью C падала и на main.
- **Удалено:** в `gate-notverified.test.sh` два случая «stop without node …» — уходят по той же причине, что у Gate в Ticket-е 03; проверка доставки маркера осталась, теперь с node.

| Shell test, Git Bash | main `90c5e72` | ветка |
|---|---|---|
| `rules-hooks.test.sh` | exit 1, 129 ok / 14 FAIL | exit 0, 160 / 0 |
| `session-hooks.test.sh` | exit 1, 9 / 5 | exit 0, 18 / 0 |
| `gate-notverified.test.sh` | exit 1, 32 / 1 | exit 0, 33 / 0 |
| `gate-unregistered.test.sh` | exit 0, 11 / 0 | exit 0, 11 / 0 |
| `gh-token-env.test.sh` | exit 1, 101 / 2 | exit 0, 103 / 0 |
| `gate-verdict` / `gate-shim` / `gate-file-size` | exit 0 | exit 0 |
| `harness-home.test.sh` | exit 0, 42 / 0 | exit 0, 42 / 0 |
| `epic-wave-ship-ticket.test.sh` | exit 0, 215 / 0 | exit 0, 215 / 0 |
| `guard-silent.test.sh` | exit 1, 27 / 28 | exit 1, 27 / 28 |
| `silent-mode.test.sh` | exit 1, 85 / 3 | exit 1, 85 / 3 |

- Сверка по именам: ни один случай, проходящий на main, на ветке не падает. На main `rules-hooks` и `session-hooks` были красными на Windows, потому что `jq` из WinGet печатает CRLF. `silent-mode` — три случая `worktree-create.sh` (известный дефект скрипта, см. выше); `guard-silent` на ветке и на main одинаков, не разбирался.
- Ревью на ПК (subagent; линзы: то же поведение, что у скриптов bash на macOS/Linux, и Windows): по первой — ничего; по второй — один low, исправлен (пути вне домашней папки на Windows печатались с `\`).
- `pnpm lint`, `pnpm typecheck` — exit 0. Полный `pnpm test` (Electron Node 24.21.0): main `90c5e72` — exit 1, 253 failed / 5392 passed / 151 skipped; ветка `6f8899e` — exit 1, 238 / 5408 / 151. По именам: ни одного нового падающего test-а; 4 случая, прошедшие на main, упали на ветке под нагрузкой (`check-lessons`, `critical-path` «refuses wrong arguments», 2 в `harness-install`) — отдельно, два прогона подряд, проходят; 19 случаев, падавших на main, на ветке проходят.

**Не проверено:** всё на macOS и Linux (в том числе `birthtimeMs` там); ручные проверки владельца — упакованная сборка на Mac и Session Claude Code с plugin `worfy` на ПК.

### Mac review and merge (PR #453, squash `9d21c3d6`, 2026-10-18)

- Mac review, round 1, depth high: approved, no code findings ([review](https://github.com/IDSAD-XL/worfy/pull/453#issuecomment-6242822528)). Correctness against main and security found nothing. The Stop hook started from a repo subfolder now holds a red turn; on main it did not.
- The three `harness-migrate.test.ts` cases the PC could not run pass on the Mac.
- Mutation testing: 10 of 14 mutants killed. The four survivors are test gaps, not code defects. They go to Ticket 56.
- Mac `gate full` green. The Windows PC found no new failures by name against main `90c5e72`.
- Still not checked: Linux, and the owner's manual checks (packaged build on the Mac, a Claude Code Session with the `worfy` plugin on the PC).
