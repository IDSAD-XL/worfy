# 04 — Hooks Harness на Node; `hooks.json` зовёт каждый скрипт через `node`

Type: task
Status: open
Blocked by: 03
Source: решения владельца 2026-10-07: Q19 (скрипты Harness, которые зовут hooks и worfy, — на Node; bash только в test-ах) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0041](../../../docs/adr/0041-harness-rules-via-session-hooks.md) — правила через hooks `SessionStart` и `SubagentStart`; evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

- **Hooks на bash** — четыре скрипта в `harness/hooks`. Gate к этому времени уже на Node (Ticket 03).
  - `inject-rules.sh` (46 строк) отдаёт часть правил `rules/<часть>.md` как `additionalContext` и
    подставляет в текст путь plugin вместо `${CLAUDE_PLUGIN_ROOT}` (`:31-45`). Без `jq` он ничего не
    внедряет и пишет одну строку в stderr (`:29`).
  - `session-start.sh` (109 строк) подмешивает в Session правила Profile, индекс уроков, карту Epic-а
    и напоминание о `/retro`. `session-end.sh` (37 строк) дописывает строку в
    `<Profile>/state/pending-retro.log`. Оба зовут `bin/profile` по shebang (`session-start.sh:37`,
    `:44`; `session-end.sh:23`, `:30`) и разбирают ответ `jq` (`session-start.sh:41`, `:45-46`,
    `:108`; `session-end.sh:27`, `:31-32`). Домашняя папка — из `HOME` (`session-start.sh:55`).
    Переменные для test-ов: `CLAUDE_PROFILE_BIN`, `CLAUDE_GATE_CONFIG`, `CLAUDE_PROFILES_DIR`,
    `CLAUDE_SESSION_SECTION_CAP`.
  - `stop.sh` (197 строк) держит конец хода кодом 2, пока у worktree красный маркер Gate
    (`:156-183`), и один раз за Session говорит модели о «не проверено». Тег worktree — `shasum`
    (`:73`, `:75`). Время рождения транскрипта — `stat` в синтаксисе BSD или GNU по `uname`
    (`:77-85`); время 0 значит «не известно» (`:99-100`). Путь репозитория для реестра —
    `cd … && pwd` (`:43`), в Git Bash это `/c/…`.
  - Все, кроме `inject-rules.sh`, ищут node в nvm и `/opt/homebrew/bin` (`session-start.sh:28-34`,
    `session-end.sh:14-20`, `stop.sh:29-35`).
- **`harness/hooks/hooks.json`** зовёт скрипты по shebang: `inject-rules.sh` (`:9`, `:18`, `:47`),
  `session-start.sh` (`:27`), `stop.sh` (`:80`), `session-end.sh` (`:100`), `bin/worktree-lock`
  (`:36`, `:89`, `:109`), `guard.mjs` (`:121`). Gate (`:58`, `:69`) Ticket 03 уже перевёл на `node`.
- **Hooks на Windows** (docs hooks Claude Code): команда hook-а идёт в Git Bash, а без Git Bash — в
  PowerShell. Git for Windows обязателен (Q18), так что команда `node "${CLAUDE_PLUGIN_ROOT}/…"`
  идёт в Git Bash. Работает ли там вызов по shebang и в каком виде приходят `cwd` и
  `${CLAUDE_PLUGIN_ROOT}` — evidence Ticket-а 01, раздел 13.
- **`harness/package.json`** нарочно без `"type"` (`:2`): у скриптов `bin` без расширения Node сам
  определяет, CommonJS это или ES-модуль. Файл с расширением `.mjs` — ES-модуль при любом
  `package.json`.
- **Hooks, которые добавит E3** (worfy-harness): `harness/hooks/gh-token-env.sh` (E3 Ticket 18, hook
  `SessionStart`, пишет `GH_TOKEN` в `CLAUDE_ENV_FILE`) и другие — по описи Ticket-а 01.
- **Имена hooks стоят ещё в:** `harness/README.md:15`, `:19`; `harness/profiles/README.md:40`,
  `:157-159`, `:270`; `harness/skills/retro/SKILL.md:35`; `harness/skills/tickets-to-tasks/SKILL.md:116`;
  комментарий `test/contract/harness-plugin.test.ts:82`; комментарии `harness/hooks/gate-resolve.mjs:37-38`
  и шапка Gate — `gate.mjs` Ticket-а 03 наследует упоминания `stop.sh` из `gate.sh:26`, `:35`,
  `:172-176`. Test-ы зовут hooks через `bash`:
  `harness/hooks/tests/rules-hooks.test.sh` (`:11`, `:58` — проверка бита исполнения, ожидаемые
  команды `hooks.json` — `:250-262`), `session-hooks.test.sh:15-17`, `gate-notverified.test.sh:15`,
  `gate-unregistered.test.sh:11`, `harness/bin/tests/harness-home.test.sh` (`:98`, `:147`, `:170`,
  `:183-184`, `:193`, `:242`).

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
6. **`hooks.json`.** Каждая команда — явный `node` и путь к скрипту, как велит ADR-0055 (пункт 2) и
   как Ticket 03 сделал для Gate: `node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"`. Это четыре новых
   hooks, `bin/worktree-lock` (`:36`, `:89`, `:109`) и `guard.mjs` (`:121`). События, matcher-ы и
   timeout-ы не меняются.
7. **Hooks E3 на bash** — `gh-token-env.sh` и остальные по описи Ticket-а 01 — переводятся так же,
   вместе со своими test-ами.
8. **Ссылки на имена** — список в «Что происходит». После правки
   `git grep -nE '(inject-rules|session-start|session-end|stop)\.sh' -- harness src` пуст.

Не входит: Gate (Ticket 03); код внутри `bin/worktree-lock` — его `HOME` (`:39`) правит Ticket 05;
код `guard.mjs` не меняется, меняется только его вызов.

## Готово, когда

- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` и `bash harness/hooks/tests/session-hooks.test.sh` — код 0 на Mac и в Git Bash на Windows-ПК. `rules-hooks.test.sh` проверяет новые команды `hooks.json`: у каждой — `node` и путь к скрипту plugin.
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh` и `bash harness/hooks/tests/gate-unregistered.test.sh` (гоняют Stop hook) — код 0 на Mac и в Git Bash на Windows-ПК.
- [ ] `bash harness/bin/tests/harness-home.test.sh` — код 0 на Mac.
- [ ] `git ls-files harness/hooks | grep -v /tests/ | grep '\.sh$'` пуст: в `harness/hooks` нет скриптов на bash вне test-ов.
- [ ] Mac, упакованная сборка этой ветки (`pnpm package`), открытая через `open` — с окружением, как из Finder. Её Session получает копию Harness этой сборки (ADR-0049, E3 Ticket 12). В транскрипте Session есть `additionalContext` hook-а `SessionStart` с текстом `rules/orchestrator.md` и `rules/common.md`. После красного Gate в worktree (временная ошибка lint) Stop возвращает 2, и модель получает текст «The quality gate is red».
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
- В test-ах `jq` остаётся, если по evidence Ticket-а 01 он есть в Git Bash ПК (winget `jqlang.jq`).
  Иначе проверки JSON в test-ах идут через `node -e`.
- Случай «нет node» у Stop (`gate-notverified.test.sh:95`) уходит с той же причиной, что у Gate в
  Ticket-е 03.
- В Git Bash на Windows `session-hooks.test.sh` получает случай с `cwd` в виде, в каком его шлёт
  Claude Code на Windows (evidence Ticket-а 01, раздел 13).

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
- `harness/hooks/gh-token-env.sh` (из E3 Ticket 18, удаляется; список hooks E3 уточняет Ticket 01)
- `harness/hooks/gh-token-env.mjs` (новый)
- `harness/hooks/tests/gh-token-env.test.sh` (из E3 Ticket 18)
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

Заполняется при закрытии.
