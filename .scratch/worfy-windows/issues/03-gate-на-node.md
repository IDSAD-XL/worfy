# 03 — Gate на Node; worfy читает вердикт Gate на обеих системах

Type: task
Status: open
Blocked by: 02
Source: решения владельца 2026-10-07: Q19 (скрипты Harness, которые зовут hooks и worfy, — на Node; bash только в test-ах), Q23 (Windows-раннера на PR нет; gate full на ПК владельца перед мержем платформенных PR) ([spec.md](../spec.md)); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md) «Harness scripts in Node»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions»; [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) — файл вердикта без языка; evidence Ticket-а 01 (`.scratch/worfy-windows/evidence/01-факты-windows.md`, файл создаёт Ticket 01)

## Что происходит

- **Gate сейчас** — `harness/hooks/gate.sh`, 465 строк bash. Его зовут hooks `TaskCompleted` и
  `TeammateIdle` (`harness/hooks/hooks.json:67`, `:78` на main `08e8256`; evidence Ticket-а 01,
  раздел 18), а агенты и skills — командой
  `bash "${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast`. Gate:
  - выбирает пакеты по diff от merge-base с origin/main (`gate.sh:246-290`);
  - запускает скрипты профиля `fast` или `full` из записи реестра Gate (`gate/config.json`, поля
    `root` и `workspace`) через менеджер пакетов: `pnpm run <скрипт>` (`:309-320`). Строки
    `commands.*` из Profile Gate не исполняет: их исполняют агенты в Bash tool, а на Windows Bash
    tool — это Git Bash;
  - печатает строку `[gate] зелено|красно|ничего не прогналось|ПРОВЕРИТЬ НЕ УДАЛОСЬ …`, выходит с
    кодом 0, 2 (красно) или 3 (не проверено);
  - оставляет маркеры `red-<key>-<tag>`, `unverified-<key>-<tag>`, `nokey-<kind>-<tag>-<session>`,
    кэш зелёных прогонов и файл вердикта `verdict-<tag>.json` (формат — шапка `gate.sh:31-47`).
- **Что в `gate.sh` не работает на Windows:**
  - PATH зашит под Mac: nvm, `/opt/homebrew/bin`, `~/.local/share/pnpm` (`:95-102`);
  - `shasum` считает тег worktree (`:113`) и отпечатки кэша (`:305`, `:306`, `:390`). В Git Bash
    ПК владельца `shasum` есть в PATH Bash tool (`/usr/bin/core_perl/shasum`), а в PATH node-процесса
    hook-а `core_perl` нет (для bash-hook-а не проверено); `jq` — нет (evidence Ticket-а 01,
    раздел 05);
  - путь репозитория для реестра (`canon`, `:112`) берётся через `cd … && pwd`. В Git Bash `pwd`
    печатает `/c/Users/…` (evidence, раздел 06). Node на Windows такого пути не понимает, и
    `gate-resolve.mjs --which` (`:196`) не найдёт Project;
  - признаки «окружение недоступно» (`:324-326`) — сообщения bash, например `command not found`.
    cmd.exe пишет `is not recognized as an internal or external command` (так на ПК, evidence,
    разделы 08 и 10);
  - на ПК `bash harness/hooks/gate.sh` без реестра Gate — EXIT=3, `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ:
    резолвер gate-resolve.mjs завершился с кодом 4` (evidence, раздел 18);
  - менеджер пакетов на Windows — `pnpm.cmd`. Node с апреля 2024 года (CVE-2024-27980) не запускает
    `.cmd` и `.bat` без `shell: true`. Это касается Gate на Node.
- **`harness/hooks/gate-resolve.mjs`** (Node) берёт домашнюю папку из `HOME` (`:28`). Путь Project-а
  сравнивает с `match` реестра через `path.sep` (`:85`), а файлы с папками пакетов — через `/`
  (`:165`).
- **worfy читает Gate** в `src/main/gate/state.ts`:
  - тег worktree — первые 8 hex SHA-1 пути (`gateTag`, `:40`). worfy хеширует путь от
    `realpath.native` (`:457`, `:460`), а Gate и `stop.sh` — вывод `git rev-parse --show-toplevel`
    (`gate.sh:105`, `:113`; `harness/hooks/stop.sh:36`, `:73`). На Mac строки совпадают. На Windows
    `realpath.native` даёт `C:\…`, а git и в PowerShell, и в Git Bash печатает `C:/Users/Alexey/worfy`
    — буква диска заглавная, разделитель `/`; в worktree `--git-common-dir` — абсолютный
    `C:/…/.git` (evidence Ticket-а 01, раздел 06). Написания расходятся разделителем: теги
    разойдутся, и worfy не найдёт ни маркер, ни файл вердикта;
  - ключ реестра: `match` сравнивается с корнем через `/` (`gateKey`, `:82`). Поле `worktree` файла
    вердикта сравнивается с путём worktree как строка (`:150`);
  - вызов Gate в транскрипте узнаётся по слову `gate.sh` (`GATE_SH`, `:180`; отбор строк — `:345`).
    Перед именем допускаются пробел, `;&|(/'"` и обратная кавычка, но не `\`;
  - `cd` в команде Bash: абсолютным считается только путь с `/` в начале (`:197`); `cwd` записи
    транскрипта — тоже (`:229`).
- **`src/shared/ipc/checks.ts:11-14`.** Путь в канале `checks` (IPC — обмен окна с main-процессом
  worfy) считается абсолютным, только если начинается с `/`.
- **Имя `gate.sh` стоит ещё в:** `harness/hooks/stop.sh:182` (текст для модели),
  `harness/hooks/rules/common.md:57`, `harness/agents/implementer.md:118`,
  `harness/skills/ship-ticket/SKILL.md:167`, `harness/skills/epic-wave/SKILL.md:208`,
  `harness/skills/overnight-fix-loop/SKILL.md:206`, `:216`; комментарии `harness/bin/profile:17`,
  `:115`, `harness/bin/preflight:165`, `harness/hooks/gate-resolve.mjs:16`, `:37`, `:95`;
  `harness/README.md:19`, `harness/profiles/README.md:54`, `:70`, `CONTEXT.md:68`. Test-ы:
  `harness/hooks/tests/gate-notverified.test.sh`, `gate-unregistered.test.sh`,
  `gate-verdict.test.sh`; `harness/hooks/tests/rules-hooks.test.sh:256-257`;
  `harness/bin/tests/agents-text.test.sh:46-47`, `epic-wave-ship-ticket.test.sh:51`,
  `harness-home.test.sh` (`:80`, `:105`, `:170`, `:192`, `:199-201`, `:242`);
  `test/unit/gate-state.test.ts:94-97` (читает исходник `gate.sh`, чтобы узнать слова вердикта);
  `test/contract/harness-plugin.test.ts:68`; `test/e2e/packaged.spec.ts:173`. Строки — на
  `4f983ef`; опись скриптов Harness на main `08e8256` — evidence Ticket-а 01, раздел 18. Перед
  началом повторить `git grep -n 'gate\.sh'` на свежем main: E3 ещё открыт.
- **Изоляция test-ов.** `test/contract/harness-scripts.test.ts:50-62` гоняет test-ы Harness с `HOME`
  во временной папке. Node `os.homedir()` на Mac читает `HOME`, а на Windows — `USERPROFILE`: на ПК
  `os.homedir()` — `C:\Users\Alexey` и в PowerShell (там `HOME` нет), и в Git Bash, и в hook-е
  (evidence Ticket-а 01, раздел 07). Без `USERPROFILE` скрипт на Node в test-е на Windows возьмёт
  настоящую папку пользователя.
- **Test-ы Gate на ПК сейчас.** `test/unit/gate-state.test.ts` — 12 упавших, `spawnSync /bin/sh
  ENOENT`; `harness-scripts.test.ts` — `bash is not installed`: `sh` нет в PATH процесса (evidence,
  разделы 04 и 17).

## Что делаем

1. **Gate на Node** (Q19, ADR-0055). `harness/hooks/gate.mjs` заменяет `gate.sh`; `gate.sh`
   удаляется. Общие функции — тег worktree, путь репозитория для реестра, папка состояния — лежат в
   `harness/hooks/gate-paths.mjs`. Их же берёт Stop hook на Node в Ticket-е 04 и не копирует.
   - CLI прежний: первый аргумент — профиль, по умолчанию `fast`. Прежние и переменные для настройки
     и test-ов: `HARNESS_HOME`, `CLAUDE_GATE_CONFIG`, `CLAUDE_GATE_STATE`, `CLAUDE_GATE_RESOLVE`,
     `GATE_SCOPE`, `GATE_MAX_AHEAD`, `GATE_MAX_BEHIND`.
   - Выход прежний: строки `[gate] …`, коды 0, 2 и 3, имена и содержимое маркеров, поля
     `verdict-<tag>.json`. Время в файле вердикта — UTC без долей секунды (`2026-10-07T12:00:00Z`).
     Файл пишется целиком через временный файл и rename или не пишется вовсе; неудачный прогон
     удаляет файл прошлого прогона (как `gate.sh:116-121`).
   - Если в main уже есть предупреждение о файле длиннее 1000 строк (Ticket 03 Epic-а worfy-review),
     `gate.mjs` переносит его вместе с test-ом `harness/hooks/tests/gate-file-size.test.sh`.
   - Кэш может вести отпечаток по-новому. После перехода первый прогон просто идёт заново.
   - Hook JSON читается со stdin. Запуск руками с открытым пустым stdin не висит: не дольше 2 s
     тишины, как `gate.sh:69-83`.
   - Соседние файлы (`gate-resolve.mjs`, `gate-paths.mjs`) ищутся от настоящего файла скрипта, и
     через symlink тоже (`harness-home.test.sh:199-201`).
2. **Без зашитых путей.** Ни nvm, ни `/opt/homebrew/bin`, ни `~/.local/share/pnpm`
   (`gate.sh:95-102`). Дочерние процессы получают PATH процесса плюс папку того node, что исполняет
   Gate (`process.execPath`), и `PNPM_HOME`, если он задан. На Mac Session-ы worfy получают PATH из
   login shell (`src/main/agent/env.ts`); что Gate там находит pnpm, проверяет gate full.
3. **Тег и пути.** SHA-1 считает `node:crypto`, а не `shasum`. Тег — от пути в написании
   `git rev-parse --show-toplevel`, как сейчас. Путь для реестра — от `git rev-parse --git-common-dir`
   средствами Node, без `pwd`. worfy (`gateTag`) на Windows приводит путь к тому же написанию перед
   хешем: git печатает `C:/…` — `\` заменяется на `/`, буква диска заглавная (evidence Ticket-а 01,
   раздел 06). На Mac тег не меняется.
4. **Запуск скриптов профиля на Windows.** Ticket выбирает способ запустить `pnpm.cmd`: через cmd.exe
   (`shell: true`) с экранированием имён пакетов и скриптов или без оболочки. Способ и причина — в
   Итог. Признаки «окружение недоступно» получают и сообщение cmd.exe
   `is not recognized as an internal or external command`.
5. **Как hook находит node.** ADR-0055 оставил этот выбор Ticket-у Gate (раздел «Последствия»).
   С командой `node …` node должен быть в PATH процесса Claude Code ещё до запуска скрипта; сейчас
   `gate.sh` дописывает nvm и `/opt/homebrew/bin` сам (`:95-102`). Ticket проверяет три случая:
   Session, которую запустил worfy (PATH из login shell, `src/main/agent/env.ts`); Claude Code из
   терминала на Mac; Claude Code на Windows-ПК. Третий случай на ПК владельца проверен: hook
   `node "${CLAUDE_PLUGIN_ROOT}/…"` нашёл `C:\Program Files\nodejs\node.exe` (там symlink nvm-windows;
   evidence Ticket-а 01, раздел 13). Если в каком-то из случаев node в PATH нет, Ticket выбирает
   способ без bash вне test-ов и пишет его в Итог.
   - Без node Gate не запустится: hook упадёт с кодом 127, Claude Code покажет ошибку, которая не
     блокирует. Вердикта нет — worfy показывает исход `none`, как у worktree без прогонов. Наличие
     node ≥22 проверяет экран первого запуска (Ticket 13).
   - `gate.sh` сам писал «node не найден» с кодом 3 (`:191-194`), а его шапка (`:47`) так и
     объясняет, почему файл вердикта пишет bash. Это отступление записывается в шапку `gate.mjs` и
     в Итог. Случаи «нет node» в test-ах (`gate-notverified.test.sh:95`,
     `gate-verdict.test.sh:136-140`) уходят с той же причиной.
6. **`gate-resolve.mjs`.** Домашняя папка — из `os.homedir()`, а не из `HOME` (`:28`). Порядок
   поиска реестра прежний: `CLAUDE_GATE_CONFIG`, затем `HARNESS_HOME`, затем старое место
   `~/.claude/gate/config.json`. `match` реестра и пути файлов сравниваются при любом разделителе,
   `\` или `/`; на Windows — без учёта регистра букв (NTFS их не различает).
7. **Изоляция test-ов** (`os.homedir()` на Windows читает `USERPROFILE`). Каждый test, который
   подменяет `HOME`, задаёт тем же путём и `USERPROFILE`: `harness-scripts.test.ts` и test-ы Gate.
   Ни один test не пишет в настоящую папку пользователя ни на Mac, ни на Windows.
8. **Новое имя во всех ссылках, одним PR** — список в «Что происходит».
   - `hooks.json:67`, `:78` — `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast`, как велит ADR-0055
     (пункт 2). Остальные hooks к той же форме приводит Ticket 04.
   - Skills, agents и правила: `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast </dev/null; echo
     "EXIT=$?"`. Bash tool исполняет это и на Mac, и в Git Bash.
   - После правки `git grep -n 'gate\.sh' -- harness` пуст.
9. **worfy узнаёт вызов Gate** и по новому имени (`gate.mjs`), и по старому (`gate.sh` — в старых
   транскриптах и у старого Harness в `~/.claude`). Перед именем допускается `\` (путь Windows).
   Отбор строк (`state.ts:345`) пропускает оба имени. Строки `[gate] …` не меняются, их разбор —
   тоже.
10. **Пути Windows в worfy.** `cd` в команде Bash (`state.ts:197`): абсолютные — `C:\…`, `C:/…` и
    `/c/…` (так пути пишет Git Bash). `cwd` записи транскрипта (`:229`) — `C:\…`. `gateKey` (`:82`)
    и сравнение `worktree` файла вердикта (`:150`) — при любом разделителе. `absolutePath` в
    `src/shared/ipc/checks.ts:11-14` принимает `C:\…`, `C:/…` и `\\server\share\…`.
    - Логика путей Windows живёт в функциях, которые берут платформу параметром или явно зовут
      `path.win32`. Так её проверяют unit-test-ы на Mac и в CI на Linux.
    - Общий helper абсолютных путей для `claude-home.ts`, `bindings.ts` и `links.ts` заводит Ticket 08
      (пути и папки на Windows). Этот Ticket правит только `checks.ts`, у себя в файле. Если helper
      Ticket-а 08 уже в main — берёт его.

## Готово, когда

- [ ] Опись скриптов `harness/bin` и `harness/hooks` снята заново на main после закрытия E3 командой описи из шага 4 Ticket-а 01. Раздел 18 evidence Ticket-а 01 обновлён; каждый скрипт на bash и zsh приписан ровно к одному из Ticket-ов 03, 04, 05, 06 или 15. Перенесено из Ticket-а 01 при мерже PR #172.
- [ ] `bash harness/hooks/tests/gate-verdict.test.sh` — код 0 на Mac и в Git Bash на Windows-ПК. Test зовёт `node "$HOOKS/gate.mjs"`. Ожидания строк `[gate] …`, кодов выхода и полей `verdict-<tag>.json` — прежние; убран только случай «нет node».
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh` и `bash harness/hooks/tests/gate-unregistered.test.sh` — код 0 на Mac. Они гоняют и `stop.sh`; в Git Bash это пункт «Готово, когда» Ticket-а 04.
- [ ] `rules-hooks.test.sh`, `agents-text.test.sh`, `epic-wave-ship-ticket.test.sh`, `harness-home.test.sh` — код 0 на Mac.
- [ ] Unit `test/unit/gate-state.test.ts`: `gateTag` даёт один тег для `C:\a\b` и `C:/a/b` (написание git, evidence Ticket-а 01, раздел 06), а для пути Mac — прежний тег; `gateRunDir` узнаёт `node "C:\Users\x\plugin\hooks\gate.mjs" fast`, `cd /c/x && node ./hooks/gate.mjs full` и старое `bash ~/.claude/hooks/gate.sh fast`; `gateKey` находит запись реестра с `match` `C:\Users\x\worfy` для корня `C:/Users/x/worfy` и для worktree под ним; файл вердикта с `worktree` в написании git принят для того же worktree в написании `realpath.native`; test слов вердикта (`:94-97`) читает `gate.mjs`.
- [ ] Unit: схема канала `checks` принимает `C:\a`, `C:/a` и `\\srv\share\a` и отвергает `a\b` и `C:a`.
- [ ] `git grep -n 'gate\.sh' -- harness` пуст. В `src` имя `gate.sh` осталось только в распознавании старых вызовов (`src/main/gate/state.ts`).
- [ ] Windows-ПК, Session Claude Code в worktree worfy: `node "<папка plugin>/hooks/gate.mjs" fast </dev/null; echo "EXIT=$?"`, затем то же с `full`. Оба прогона идут до конца: каждый скрипт профиля запущен, строка `[gate] …` и код соответствуют исходам скриптов, в выводе нет `command not found` и `is not recognized`. Красный исход из-за test-ов, которые чинит Ticket 14, ожидаем. Имя появившегося `verdict-<tag>.json` совпадает с тегом, который даёт `gateTag` worfy для этого worktree. Вывод — в Итог.
- [ ] Mac: gate full через `gate.mjs` зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac). В него входят e2e бейджей Gate (`test/e2e/checks-badges.spec.ts`) и проверка копии Harness в сборке (`test/e2e/packaged.spec.ts`). В Session worfy hook `TaskCompleted` зовёт `gate.mjs`: в транскрипте — строка `[gate] …` от hook-а.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` на Mac — exit 0; CI на PR зелёный.

## Тесты

Сначала падающие test-ы, в Итог — как они падали:

- `harness/hooks/tests/gate-verdict.test.sh`, который зовёт `node "$HOOKS/gate.mjs"`. На нынешнем
  main файла нет — test красный.
- Unit `gateTag` и `gateKey` на путях Windows в `test/unit/gate-state.test.ts`. На нынешнем main теги
  `C:\a\b` и `C:/a/b` разные, а `gateKey` не находит `match` с `\`.

Остальное:

- Helper тега в test-ах Gate (`tag()`, `gate-notverified.test.sh:27`, `gate-unregistered.test.sh:26`,
  `gate-verdict.test.sh:28`) считает SHA-1 через `node -e`, а не `shasum`. Так test-ы идут и в Git
  Bash без `shasum`.
- Test-ы с подменой `HOME` задают тем же путём и `USERPROFILE` (пункт 7).
- Сверка тега на ПК: тег, который печатает `gateTag` worfy для пути worktree (одна строка
  `node -e` над собранным `out/main` или над функцией из unit-test-а), сравнивается с именем
  `verdict-*.json` в папке состояния Gate. Команда и вывод — в Итог.

## Где в коде

- `harness/hooks/gate.mjs` (новый)
- `harness/hooks/gate-paths.mjs` (новый)
- `harness/hooks/gate.sh` (удаляется)
- `harness/hooks/gate-resolve.mjs`
- `harness/hooks/hooks.json`
- `harness/hooks/stop.sh`
- `harness/hooks/rules/common.md`
- `harness/agents/implementer.md`
- `harness/skills/ship-ticket/SKILL.md`
- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/overnight-fix-loop/SKILL.md`
- `harness/bin/profile`
- `harness/bin/preflight`
- `harness/README.md`
- `harness/profiles/README.md`
- `harness/hooks/tests/gate-notverified.test.sh`
- `harness/hooks/tests/gate-unregistered.test.sh`
- `harness/hooks/tests/gate-verdict.test.sh`
- `harness/hooks/tests/rules-hooks.test.sh`
- `harness/bin/tests/agents-text.test.sh`
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`
- `harness/bin/tests/harness-home.test.sh`
- `src/main/gate/state.ts`
- `src/shared/ipc/checks.ts`
- `test/unit/gate-state.test.ts`
- `test/contract/harness-plugin.test.ts`
- `test/contract/harness-scripts.test.ts`
- `test/e2e/packaged.spec.ts`
- `CONTEXT.md`

В stop.sh, profile и preflight меняются только имя Gate в тексте и комментариях: сами эти скрипты
переводят на Node Ticket-ы 04, 05 и 06, они идут после этого. С Ticket-ом 08 (может идти в той же
Wave) общих файлов нет: он правит claude-home.ts, bindings.ts и links.ts, а этот Ticket — checks.ts.
Старый Harness владельца в ~/.claude не меняется.

## Итог

Заполняется при закрытии.
