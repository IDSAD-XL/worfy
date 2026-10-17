# 03 — Gate на Node; worfy читает вердикт Gate на обеих системах

Type: task
Status: done 2026-10-14
PR: #298
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
  началом повторить `git grep -n 'gate\.sh'` на свежем main: E3 ещё открыт. Решение владельца
  2026-10-13: Ticket-ы 03–07 начинаются, не дожидаясь закрытия E3 — его код влит, остался
  приёмочный пункт 5.
- **Изоляция test-ов.** `test/contract/harness-scripts.test.ts:50-62` гоняет test-ы Harness с `HOME`
  во временной папке. Node `os.homedir()` на Mac читает `HOME`, а на Windows — `USERPROFILE`: на ПК
  `os.homedir()` — `C:\Users\Alexey` и в PowerShell (там `HOME` нет), и в Git Bash, и в hook-е
  (evidence Ticket-а 01, раздел 07). Без `USERPROFILE` скрипт на Node в test-е на Windows возьмёт
  настоящую папку пользователя.
- **Test-ы Gate на ПК сейчас.** `test/unit/gate-state.test.ts` — 12 упавших, `spawnSync /bin/sh
  ENOENT`; `harness-scripts.test.ts` — `bash is not installed`: `sh` нет в PATH процесса (evidence,
  разделы 04 и 17).

## Что делаем

1. **Gate на Node** (Q19, ADR-0055). `harness/hooks/gate.mjs` заменяет `gate.sh`. Код Gate из
   `gate.sh` удаляется; сам файл остаётся прокладкой из двух команд, которая запускает `gate.mjs`
   (решение владельца 2026-10-13, см. «Итог»; имя уходит совсем в
   [Ticket-е 46](46-имя-gate-sh-уходит-совсем.md) — отменено решением владельца 2026-10-14:
   `gate.sh` остаётся файлом запуска hook-а, Ticket 46 закрыт). Общие функции — тег worktree, путь репозитория для реестра, папка состояния — лежат в
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
   - После правки `git grep -n 'gate\.sh' -- harness` находит имя только в прокладке
     (`harness/hooks/gate.sh`), в её test-е (`harness/hooks/tests/gate-shim.test.sh`) и в двух
     строках о ней в `harness/README.md` и `harness/profiles/README.md`.
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

- [ ] Опись скриптов `harness/bin` и `harness/hooks` снята заново на main к началу этого Ticket-а (решение владельца 2026-10-13: закрытия E3 не ждём) командой описи из шага 4 Ticket-а 01. Раздел 18 evidence Ticket-а 01 обновлён; каждый скрипт на bash и zsh приписан ровно к одному из Ticket-ов 03, 04, 05, 06 или 15. Перенесено из Ticket-а 01 при мерже PR #172.
- [ ] `bash harness/hooks/tests/gate-verdict.test.sh` — код 0 на Mac и в Git Bash на Windows-ПК. Test зовёт `node "$HOOKS/gate.mjs"`. Ожидания строк `[gate] …`, кодов выхода и полей `verdict-<tag>.json` — прежние; убран только случай «нет node».
- [ ] `bash harness/hooks/tests/gate-file-size.test.sh` (предупреждение о файле длиннее 1000 строк, `worfy-review` 03, PR #221) — код 0 на Mac и в Git Bash на Windows-ПК: при запуске на Windows-ПК 2026-10-10 Gate на bash останавливался на реестре с кодом 3, и предупреждение там не проверено.
- [ ] `bash harness/hooks/tests/gate-notverified.test.sh` и `bash harness/hooks/tests/gate-unregistered.test.sh` — код 0 на Mac. Они гоняют и `stop.sh`; в Git Bash это пункт «Готово, когда» Ticket-а 04.
- [ ] `rules-hooks.test.sh`, `agents-text.test.sh`, `epic-wave-ship-ticket.test.sh`, `harness-home.test.sh` — код 0 на Mac.
- [ ] Unit `test/unit/gate-state.test.ts`: `gateTag` даёт один тег для `C:\a\b` и `C:/a/b` (написание git, evidence Ticket-а 01, раздел 06), а для пути Mac — прежний тег; `gateRunDir` узнаёт `node "C:\Users\x\plugin\hooks\gate.mjs" fast`, `cd /c/x && node ./hooks/gate.mjs full` и старое `bash ~/.claude/hooks/gate.sh fast`; `gateKey` находит запись реестра с `match` `C:\Users\x\worfy` для корня `C:/Users/x/worfy` и для worktree под ним; файл вердикта с `worktree` в написании git принят для того же worktree в написании `realpath.native`; test слов вердикта (`:94-97`) читает `gate.mjs`.
- [ ] Unit: схема канала `checks` принимает `C:\a`, `C:/a` и `\\srv\share\a` и отвергает `a\b` и `C:a`.
- [ ] `git grep -n 'gate\.sh' -- harness` находит имя только в прокладке `harness/hooks/gate.sh`, в её test-е `harness/hooks/tests/gate-shim.test.sh` и в двух строках о ней в `harness/README.md` и `harness/profiles/README.md`. В `src` имя `gate.sh` осталось только в распознавании старых вызовов (`src/main/gate/state.ts`).
- [ ] `bash harness/hooks/tests/gate-shim.test.sh` — код 0 на Mac и в Git Bash на Windows-ПК: `bash gate.sh` и `node gate.mjs` дают один код выхода и одни строки `[gate] …`, аргументы и stdin доходят до Gate.
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
- `harness/hooks/gate.sh` (код Gate удаляется; остаётся прокладка)
- `harness/hooks/tests/gate-shim.test.sh` (новый)
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

Session на Windows-ПК, 2026-10-13 и 14. Windows 11 Pro 10.0.26200; системный Node 24.21.0, pnpm 11.22.0; `pnpm test` идёт под Node 24.21.0 из Electron 44.5.1. Ветка `worfy-windows/03`, в ней main `4658e39`. **На macOS и Linux с ПК ничего не запускалось.**

**Коротко.** Gate — теперь `harness/hooks/gate.mjs` на Node; `gate.sh` остался по решению владельца и после первого круга ревью стал файлом запуска hook-а: находит node, а без node сам отвечает «проверить не удалось» (см. «Первый круг ревью» ниже). На ПК `gate.mjs fast` и `gate.mjs full` идут до конца, тег worktree у Gate и у worfy один. worfy читает вердикт Gate на путях Windows. Часть работы сделана subagent-ами этой Session и проверена ею: перенос `gate.sh`, сторона worfy, опись скриптов; затем три subagent-а только читали diff, запускали и искали ошибки. Запуск через `cmd.exe` переделан дважды по замечаниям третьего.

### Первый круг ревью PR #298 — что изменено

Session на Windows-ПК, 2026-10-14. Ревью Session на Mac, глубина `high`: три замечания high, одно medium, мелкие. Правки сделал subagent этой Session; diff прочитан ею целиком, проверки на ПК запущены ею. **Всё, что ниже помечено «только POSIX», на ПК не запускалось ни разу: Windows эти проверки пропускает. Первым их запустит Linux CI.** Разделы ниже описывают состояние до этого круга; где круг их меняет, сказано здесь.

1. **Остановленный прогон не может кончиться «зелёным» или «красным» (high).** До правки сигнал, пришедший Gate во время скрипта, обрабатывался после записи вердикта: Linux CI показал «зелено» у прогона, которому скрипт послал SIGTERM. После скрипта цикл событий теперь отпускается дважды, сразу после возврата `runScript` и до того, как Gate смотрит на результат. Один оборот не хватает: замер `%TEMP%\worfy-01\t03-turn-probe.cjs` — обработчик сигнала выполнился в 0 запусках из 5 с одним оборотом и в 5 из 5 с двумя. Новые проверки в `gate-verdict.test.sh` (только POSIX): SIGTERM и SIGINT группе процессов Gate, пока идёт скрипт; скрипт, который на сигнале выходит с кодом 0, и скрипт, который выходит с кодом 1; stdin — строка JSON от hook-а и `/dev/null`; профиль из двух скриптов — второй не стартует. Ожидание везде одно: код 143 или 130, ни строки вердикта, ни красного маркера, ни файла вердикта, кэш прежний.
2. **Скрипт, завершённый сигналом, — упавший скрипт (high).** Решение прошлого круга («скрипт, завершённый сигналом, останавливает прогон без вердикта») отменено: так `SIGKILL` от нехватки памяти или падение нативного кода оставляли работу без вердикта. Теперь прогон «красный»: код 2, красный маркер, файл вердикта `red`; отчёт сохраняет вывод скрипта и называет сигнал (`gate: pnpm: ended by the signal SIGKILL`). «Остановлен, ничего не записано» — только когда сигнал получил сам Gate и выполнился его обработчик; Ctrl+C приходит и Gate, и скрипту, обработчик Gate выполняется раньше, чем Gate смотрит на результат скрипта. Проверки (только POSIX): скрипт шлёт себе SIGTERM и SIGKILL — «красно», вывод до сигнала в отчёте.
3. **Без node вердикт прошлого прогона не остаётся (high) — `gate.sh` стал файлом запуска hook-а.** Команда hook-а `node …/gate.mjs` там, где node нет на `PATH`, падала с кодом 127 раньше, чем что-либо могло заменить файл вердикта, и worfy продолжал показывать исход прошлого прогона, в том числе «зелено». **Решение владельца 2026-10-14** (дано в чате Session на Mac и подтверждено в чате этой Session): hook-и `TaskCompleted` и `TeammateIdle` зовут `"${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast`, без слова `bash`. Это отступление от пунктов 5 и 8 этого Ticket-а («способ без bash вне test-ов», `git grep 'gate\.sh'` пуст) и от ADR-0055, пункт 2; ADR не правился.
   - Файл ищет node: сначала `PATH`; если там нет — `/opt/homebrew/bin`, затем `/usr/local/bin`, затем версия nvm с последним по сортировке именем (`~/.nvm/versions/node/*/bin`). Нашёл — `exec` в `gate.mjs` с теми же аргументами и stdin.
   - Не нашёл — отвечает сам, как отвечал bash-Gate на main: строка «[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден», код 3, маркер `nokey-broken-<tag>-<session>` для `stop.sh` и файл вердикта `unverified` с причиной `node not found` на месте прежнего. Вне git — молчит, код 0. Без `sha1sum` и `shasum` тег посчитать нечем: остаются строка и код 3, прежний файл вердикта не заменяется.
   - `node …/gate.mjs`, как его запускают правила, skills и агенты, без node по-прежнему кончается кодом 127 и ничего не пишет. Это записано в шапке `gate.mjs`.
   - Проверки в `gate-shim.test.sh`: node не на `PATH`, а под `~/.nvm`; команда из `hooks.json` без node после зелёного прогона (код 3, файл вердикта с полями main, маркер, без временных файлов); тишина вне git; файл запуска и `gate.mjs` оставляют одни и те же имена файлов для пути с пробелом и пути с кириллицей; в git у `gate.sh` режим 100755. Путь через symlink — только POSIX.
   - **Сторона Windows, показано на ПК** (Git Bash, `CLAUDE_PLUGIN_ROOT=C:/Users/Alexey/worfy/harness`, JSON на stdin, временный репозиторий): с node — `[gate] зелено (fast): demo/.:check`, код 0; без node — `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден`, код 3, файл вердикта `unverified`, маркер `nokey-broken-3dd3287a-demo-1`. Скрипт выполнял `C:\Program Files\Git\usr\bin\bash.exe`. Из родителя, который не Git Bash, команда не запускалась.
4. **Test переноса запускает `gate.mjs` тем node, что на `PATH` (medium).** `test/contract/harness-migrate.test.ts` брал `process.execPath` — под `pnpm test` это Electron, и в закрытом окружении test-а он стартовал как приложение, а не как node: на Linux CI test не проходил. Теперь `findNode()` и предел 60 s на запуск.
5. **Мелкие.** Фраза `cmd.exe` об отсутствующем инструменте — признак «окружение недоступно» только на Windows; на macOS и Linux скрипт, который её напечатал и упал, «красный». Пять проверок на правки Gate, которых не замечал ни один test: красный прогон, повторённый без изменений, не берётся из кэша; второй скрипт профиля и второй пакет плана запускаются; менеджер пакетов, который нельзя запустить, — «красно», а не «прошёл»; правка отслеживаемого файла после зелёного прогона мимо кэша. Две строки в `test/unit/gate-state.test.ts` для macOS и Linux: путь, отличающийся только регистром, и папка, имя которой только начинается как имя worktree, — другой worktree. Правила (`harness/hooks/rules/common.md`) и агент `implementer` называют коды 130 и 143: Gate остановлен, работа не проверена.

**Проверки на ПК после круга** (клон, head с правками круга; Git Bash):

| Команда | Результат |
|---|---|
| `pnpm lint`, `pnpm typecheck` | exit 0 каждая |
| `bash harness/hooks/tests/gate-verdict.test.sh` | exit 0: 63 ok (было 51); пропущены проверки сигналов и удалённой папки |
| `bash harness/hooks/tests/gate-shim.test.sh` | exit 0: 18 ok (было 7); пропущены две проверки через symlink |
| `bash harness/hooks/tests/gate-notverified.test.sh` | exit 1: 32 ok (было 28), 1 FAIL — тот же, что раньше: `stop.sh` без node на красном маркере (Ticket 04) |
| `bash harness/hooks/tests/gate-unregistered.test.sh` | exit 0: 11 ok |
| `bash harness/hooks/tests/gate-file-size.test.sh` | exit 0: 54 ok |
| `pnpm test` на четырёх файлах: `gate-state.test.ts`, `harness-migrate.test.ts`, `harness-scripts.test.ts`, `harness-plugin.test.ts` | exit 1: 178 test-ов, 136 прошли, 42 упали. По именам против прогона main `ff61b06`: ни один test не перешёл из прошедших в упавшие; `gate-shim.test.sh` внутри `harness-scripts.test.ts` проходит; четыре новые строки `gate-state.test.ts` проходят |

- **Мутанты круга** (копии Gate под `%TEMP%`, `gate-verdict.test.sh` на Windows). Красные шесть: красный прогон пишет кэш; запускается только первый скрипт; только первый пакет; незапустившийся менеджер пакетов считается прошедшим; отпечаток не видит правку отслеживаемого файла; фраза `cmd.exe` не признак ни на одной системе. **Три на Windows выживают, потому что их проверки — только POSIX:** скрипт, завершённый сигналом, считается прошедшим; нет оборотов цикла событий после скрипта; фраза `cmd.exe` — признак на любой системе.
- Все 13 изменённых файлов в git — с окончаниями строк LF (`git ls-files --eol`: `i/lf`); `gate.sh` и `gate.mjs` — режим 100755.

**Не сделано и не проверено в этом круге:**

- **Только POSIX, не запускалось ни разу:** все проверки сигналов пунктов 1 и 2 (около 26 запусков Gate; уложатся ли они в предел 120 s у `harness-scripts.test.ts` — не замерено), путь через symlink у файла запуска, ветка «node есть в `/opt/homebrew/bin` или `/usr/local/bin`» (там test берёт копию `gate.sh` без этих двух папок), строка `cmd.exe` как «красно» вне Windows, bash 3.2 macOS для нового кода `gate.sh`.
- **Hook в живой Session** по-прежнему не проверялся: показан запуск команды из `hooks.json` руками в Git Bash. Как Claude Code на Windows запускает команду hook-а, если его оболочка не Git Bash, не проверено; `#!/usr/bin/env bash` там мог бы найти `C:\Windows\System32\bash.exe` (WSL).
- `harness/hooks/tests/rules-hooks.test.sh` на ПК — exit 1: 129 ok, 14 FAIL, те же 14, что на head до круга (сверено по строкам). Десять — `inject-rules.sh` и `orchestrator.md`; четыре — проверки `hooks.json`: `jq.exe` на Windows кончает строки CR LF. С `jq`, у которого CR убран, проверка «`hooks.json` называет эти команды» с новой командой Gate проходит (запущено subagent-ом). `agents-text.test.sh` не запускался.
- Упавшие test-ы четырёх файлов vitest падают и на main: `harness-migrate.test.ts`, «Profiles: schema 2 …» — по-прежнему на `expected 'silent' to be 'full'` (строка 283), до вызова Gate с `findNode()` дело не доходит. **Значит, правка пункта 4 на ПК проверена только typecheck-ом; запуском её проверит Linux CI.**
- Мутантов для двух новых строк `gate-state.test.ts` нет: в каждой есть контрольное утверждение (тот же путь в том же регистре читается; подпапка worktree считается).
- Пункт «Готово, когда» про `git grep 'gate\.sh'` больше не выполняется: имя есть в `hooks.json`. Текст пункта ведёт Session на Mac.

### Второй круг ревью PR #298 — что изменено (Mac)

Session на Mac, 2026-10-14; правки сделал subagent этой Session в отдельном worktree от head `ffba8f2`. **Push в ветку `worfy-windows/03` сделан с Mac по решению владельца 2026-10-14**: ПК выключен, а это последний круг ревью из трёх. macOS 26 (Darwin 25.6.0), Node из `PATH`, системный bash 3.2. **На Windows и Linux с Mac ничего не запускалось.**

Ревью второго круга (глубина `medium`) нашло одну причину с двумя следствиями. Сигнал, пришедший, пока Gate ждал в `spawnSync` git-а или резолвера, а не скрипта, читался как ответ этого процесса. Убитый `git diff HEAD` давал пустой вывод, отпечаток совпадал с отпечатком чистого дерева, и кэш отвечал «зелено» (high). Убитый резолвер давал `unverified` с кодом 3 и маркером, убитый `git status --porcelain` — «ничего не прогналось» с кодом 0 (medium). Правило круга: **Gate, получивший сигнал, не пишет вердикта, где бы сигнал ни пришёл.**

**Что изменено** (`harness/hooks/gate.mjs`, `harness/hooks/gate-paths.mjs`):

1. **Git, завершённый сигналом, — не ответ.** `git()` в `gate.mjs` и `gitLine()` в `gate-paths.mjs` бросают ошибку `git … was ended by the signal SIGx`, если `spawnSync` вернул `signal`. Ошибка идёт в общий путь ошибок Gate.
2. **Gate ищет свой сигнал везде, где ждал.** Функция `stopIfTold` отпускает цикл событий два оборота; обработчик сигнала, если сигнал был, выполняется там и кончает прогон кодом 143 или 130. Вызовы: после резолвера (оба вызова), после скрипта, перед ответом кэша и перед запуском скрипта, в пути ошибок. Если процесс-потомок завершён сигналом, Gate сначала ждёт 0,5 s: сигнал группе процессов доходит до них по очереди, и своя копия у Gate может прийти позже.
3. **Перед записью исхода — последняя проверка.** Функция `settle` читает HEAD для файла вердикта, отпускает цикл событий и ставит флаг «исход записывается». Она вызывается перед каждым исходом: «зелено» и «красно» в конце, `unverified` (`notVerified`), две ветки `none` (нет изменений, план пуст) и ветка упавшего резолвера. После `settle` никакой процесс-потомок не стартует, а сигнал только обрывает вывод: Gate выходит с кодом записанного исхода.
4. **Кэш пишется вместе с исходом.** Записи кэша для зелёных пакетов копятся в цикле и пишутся после `settle`. У прогона без сигнала записи те же; остановленный прогон не оставляет ни одной, даже если первый из двух пакетов прошёл.
5. **Тексты.** Шапка `gate.mjs`, правила `harness/hooks/rules/common.md` и агент `harness/agents/implementer.md`: на 130 и 143 этот прогон ничего не записал; сигнал в первые десятки миллисекунд или за те до 2 s, что Gate ждёт открытый пустой stdin, может оставить вердикт прошлого прогона; код 127 — node нет на `PATH`, Gate не запускался. Тесты, которые закрепляют эти фразы дословно, не нашлись; `rules-hooks.test.sh` и `agents-text.test.sh` после правки зелёные.
6. **Ожидание фикстур** `wait0` и `wait1` в `gate-verdict.test.sh` — 10 s вместо 30.

**Исход для git-а, убитого в одиночку (пункт D задания).** Код 3 и строка «[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: git … was ended by the signal SIGTERM», без файла вердикта и без маркера. Почему так: убитый git оставляет неизвестным весь взгляд на дерево — область проверки, изменённые пути, отпечаток, HEAD, — а не только ответ кэша. Одна проверка в `git()` и `gitLine()` закрывает все вызовы git. Резолвер, убитый в одиночку, ведёт себя как раньше (код 3, маркер `nokey-broken-…`, `unverified`), только на 0,5 s позже; скрипт, убитый в одиночку, — «красно», как раньше.

**Проверки** — новый раздел 9e в `harness/hooks/tests/gate-verdict.test.sh`, только POSIX. Медленный `git` первым на `PATH` (обёртка ждёт, когда аргументы совпали, и затем через `exec` становится настоящим git) и медленный резолвер через `CLAUDE_GATE_RESOLVE`. Сигнал — группе процессов, только Gate или только потомку. «Ничего не записано» — код 143 или 130, нет строки вердикта и файла вердикта, сумма папки состояния (маркеры, кэш) прежняя, скрипт не стартовал.

| Пункт | Проверка |
|---|---|
| A — сигнал группе во время `git diff HEAD` отпечатка | TERM и INT при закэшированном зелёном чистом дереве и правке `package.json`: ничего не записано, красный маркер прошлого прогона на месте, скрипт не стартовал; то же через `gate.sh` с JSON hook-а на stdin; два пакета — TERM и INT во время `git diff HEAD -- packages/a`, когда первый пакет уже прошёл |
| B — сигнал группе во время резолвера | TERM во время `which` и во время `plan`; потомок, затем Gate через 0,1 s — для обоих вызовов |
| C — сигнал группе во время `git status --porcelain` | TERM без `GATE_SCOPE`: ничего не записано, нет `none` |
| D — потомок убит в одиночку | `git diff HEAD`, `git status --porcelain`, `git rev-parse --show-toplevel` (`gate-paths.mjs`): код 3, строка с именем команды и сигнала, ничего не записано; резолвер (`which`) — код 3, прежняя строка и маркер `nokey-broken` |
| E — сигнал до запуска скрипта и между пакетами | TERM только Gate во время `git diff HEAD`: скрипт не стартовал; в проекте из двух пакетов второй не стартовал |
| `settle` | TERM только Gate во время `git rev-parse -q --verify HEAD` у каждого исхода: «красно» в конце, упавший резолвер, пустой план, нет изменений, проект не зарегистрирован |
| после записи исхода | проект не зарегистрирован, stderr Gate — заранее заполненный FIFO: TERM после появления файла вердикта даёт код 3, `unverified` и маркер, а не 143 |
| F — прогон без сигнала | все 80 прежних проверок файла без изменений |

- **Сначала красные.** Новые проверки на Gate `ffba8f2` (`HOOKS_DIR` на копию `git archive`): 90 ok, 26 FAIL. Среди них «зелено» из кэша с кодом 0 (TERM и INT группе, форма hook-а, два пакета), `none` с кодом 0, `unverified` с кодом 3 от убитого резолвера, скрипт стартовал после сигнала.
- **После правки:** 116 ok, 0 FAIL, 28–36 s (до правки — 80 ok, 14–17 s).

**Мутанты** (копии `gate.mjs` и `gate-paths.mjs` в песочнице, весь `gate-verdict.test.sh`). Красные 18 из 19:

| Мутант | Первая красная проверка |
|---|---|
| `git()` не бросает на сигнале | `git diff HEAD` убит в одиночку: «зелено», код 0 |
| `gitLine()` не бросает | `git rev-parse --show-toplevel` убит в одиночку |
| путь ошибок не ждёт сигнал | TERM группе во время `git diff HEAD`: код 3 |
| нет ожидания 0,5 s | git, затем Gate через 0,1 s: код 3; то же для `which` и `plan` |
| нет проверки после `which` | `which`, затем Gate: код 3 |
| нет проверки после `plan` | `plan`, затем Gate: код 3 |
| нет проверки перед скриптом | скрипт стартовал (один пакет и два) |
| сигнал скрипта не передаётся | скрипт и Gate: код 2 |
| `notVerified` без `settle` | незарегистрированный проект: код 3 |
| ветка «нет изменений» без `settle` | код 0 |
| ветка упавшего резолвера без `settle` | код 3 |
| ветка пустого плана без `settle` | код 0 |
| конец без `settle` | зелёный прогон без `head` в файле вердикта |
| `settle` без оборотов цикла | «красно», код 2 |
| HEAD читается после оборотов | «красно», код 2 |
| обработчик всегда даёт 143 | после записи исхода: код 143 |
| кэш пишется в цикле | два пакета: папка состояния изменилась |
| `settle` не ставит флаг | после записи исхода: код 143 |
| **один оборот вместо двух — выживает** | — |

Последний мутант эквивалентен в этих проверках: все места проверки теперь выполняются из immediate, и одного оборота хватает; если какое-то место его пропустит, сигнал поймает следующее до любой записи. Два оборота оставлены как запас: замер первого круга на ПК (`t03-turn-probe.cjs`) показал, что одного оборота бывает мало.

**Сигналы по таймеру с настоящими git и резолвером** (песочница со своими `HOME`, `HARNESS_HOME`, папкой состояния и реестром; TERM и INT группе через 40–180 ms после старта с шагом 10 ms; перед каждым — контрольный красный прогон):

| Gate | Сигналов | Остановлен, ничего не записано | Сигнал до обработчиков, остался вердикт контрольного прогона | Плохие исходы |
|---|---|---|---|---|
| после правки, кэш есть | 120 | 115 | 5 (40 и 60 ms) | 0 |
| после правки, без кэша | 120 | 102 | 18 (40–60 ms) | 0 |
| `ffba8f2`, кэш есть | 60 | 39 | 2 | 18: код 3 `unverified`; 1 дошёл до «красно» |
| `ffba8f2`, без кэша | 60 | 34 | 2 | 5: код 0 `none`; 19: код 3 `unverified` |

После правки 240 сигналов: ни одного «зелено», ни одного кода 3, ни одного `none`. «Зелено» из кэша по таймеру на `ffba8f2` в этих 120 не выпало; его показывают проверки с медленным git (выше) и замеры ревью.

**Проверки на Mac после круга:**

| Команда | Результат |
|---|---|
| `bash harness/hooks/tests/gate-verdict.test.sh` | exit 0: 116 ok, 28 s |
| `bash harness/hooks/tests/gate-shim.test.sh` | exit 0: 19 ok |
| `bash harness/hooks/tests/gate-notverified.test.sh` | exit 0: 33 ok |
| `bash harness/hooks/tests/gate-unregistered.test.sh` | exit 0: 11 ok |
| `bash harness/hooks/tests/gate-file-size.test.sh` | exit 0: 55 ok |
| `LC_ALL=en_US.UTF-8 bash harness/hooks/tests/rules-hooks.test.sh` | exit 0: 143 ok |
| `LC_ALL=en_US.UTF-8 bash harness/bin/tests/agents-text.test.sh` | exit 0: 118 ok |
| `pnpm lint`, `pnpm typecheck` | exit 0 каждая |
| `pnpm test` | exit 0: 227 файлов, 4767 test-ов прошли, 66 пропущены |
| установленный Gate `gate.sh fast` с новой пустой папкой состояния | exit 0, `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test` |

**Не сделано и не проверено в этом круге:**

- **Windows не запускался.** Новые проверки — только POSIX, на Windows они пропускаются. Путь кода общий (без вызовов только для POSIX); обработчик SIGBREAK и запуск через `cmd.exe` не менялись. Linux — только через CI этого push-а.
- Как Claude Code останавливает hook, у которого кончилось время, или прерванный вызов Bash — всей группе процессов или одному pid — по-прежнему не проверено.
- Окно до установки обработчиков (первые десятки миллисекунд и до 2 s ожидания открытого пустого stdin) не закрыто: там сигнал кончает процесс действием по умолчанию, и файл вердикта прошлого прогона остаётся. Теперь это написано в шапке `gate.mjs`, в правилах и у агента `implementer`.
- Не менялись: порядок поиска node в `gate.sh` и какую версию он берёт, проверки поиска в `gate-shim.test.sh`, предел 60 s test-а переноса (`test/contract/harness-migrate-harness.ts:57`).

### Круги ревью 2 и 3, merge (Session на Mac, 2026-10-14)

- **Круг 2** (глубина `medium`, head `ffba8f2`): одно замечание high и одно medium с одной причиной — разбор и правка в разделе выше. Сигнал группе процессов Gate, пока он ждал git, а не скрипт, кончал прогон «зелено» из кэша с кодом 0: 12 из 12 с медленным git первым на `PATH`, 7 из 150 и 9 из 99 сигналов по таймеру с настоящим git. bash-Gate main в тех же замерах ни разу. Правку по решению владельца 2026-10-14 сделал implementer-agent на Mac: ПК был выключен.
- **Круг 3** (глубина `medium`, последний по пределу в три круга, head `f395842`): выше low ничего, 10 замечаний low (R3-S1…R3-S4, R3-REST-1…R3-REST-6). Остановленные прогоны на своих fixture ревьюера: на head 130 из 130 верные, на base 86 из 86 неверные. Сигналы группе по таймеру с настоящими git и резолвером: на head 520, плохих исходов 0; на base 60, плохих 53. Выживают мутанты M19, M21, M24.
- **Ручной job «Windows tests»** на шести test-файлах: ветка `f395842` — 70 упали, 155 прошли (запуск 38516704389); main `975de42` — 73 упали, 116 прошли (запуск 38516717750). Упавшие имена те же, кроме одного test-а, переименованного с `gate.sh` на `gate.mjs`: он падает с обеих сторон. Новых падений нет, три test-а main на ветке проходят. Linux CI — зелёный (запуск 38515732819).
- **gate full на Mac** на слиянии `5333650` (main `68f323c` и head `f395842`), дважды — установленный Gate и `harness/hooks/gate.sh full` самого PR: exit 0, `[gate] зелено (full)`. Squash merge — main `1c1beadd`.
- **Остатки** — замечания low круга 3 и замечания круга 2 о файле запуска — [Ticket 48](48-остатки-ревью-pr-298.md). Одно из них (R3-REST-4) — о тексте этого раздела: фраза о выжившем мутанте «один оборот вместо двух» выше неверна. С одним оборотом сигнал, пришедший во время `which`, замечается только после того, как отработал резолвер плана: вердикт тот же, но запускается лишний процесс. Два оборота нужны.
- **`gate.sh` остаётся файлом запуска hook-а** (решение владельца 2026-10-14). [Ticket 46](46-имя-gate-sh-уходит-совсем.md) закрыт этим решением. Пункт «Готово, когда» про `git grep -n 'gate\.sh' -- harness` поэтому буквально не выполняется: на main `1c1beadd` имя есть ещё в `hooks.json` (`:67`, `:78`), в комментариях `gate.mjs` и в test-ах `gate-notverified`, `gate-verdict`, `rules-hooks`. В `src` — только `src/main/gate/state.ts`.
- **Долг Session на Windows-ПК:** проверки этого Ticket-а на настоящем ПК после правок второго круга — когда ПК снова включён (сначала `git pull` main: ветка влита). Hook в живой Session по-прежнему не проверялся (разделы выше).

### Что сделано, по пунктам «Что делаем»

1. **Gate на Node.** `harness/hooks/gate.mjs` (966 строк на main `1c1beadd`) и общие функции в `harness/hooks/gate-paths.mjs`: тег worktree, путь репозитория для реестра, папка состояния, файл реестра, сравнение путей. CLI, переменные окружения, строки `[gate] …`, коды 0, 2, 3, имена и содержимое маркеров, поля `verdict-<tag>.json` — прежние. Сверено чтением блок за блоком со старым `gate.sh` (ревьюер-subagent): русские тексты `[gate]` совпадают побайтно, кроме ушедшего «node не найден».
   - Файл вердикта пишется через временный файл и rename; прогон, который его не записал, удаляет файл прошлого прогона.
   - Предупреждение о файле длиннее 1000 строк перенесено вместе с `gate-file-size.test.sh`.
   - stdin: не дольше 2 s тишины (замер: 2,8 s с открытым пустым stdin против 0,9 s с закрытым).
   - Соседние файлы ищутся от настоящего файла скрипта, через symlink тоже.
2. **Без зашитых путей.** Дочерние процессы получают PATH процесса плюс папку `process.execPath` и `PNPM_HOME`, если он задан.
3. **Тег и пути.** SHA-1 — `node:crypto`; тег — от пути, как его печатает `git rev-parse --show-toplevel`; путь для реестра — от `--git-common-dir` средствами Node. `gateTag` в worfy на Windows приводит путь к написанию git (`\` → `/`, буква диска заглавная); путь macOS даёт прежний тег.
4. **Запуск `pnpm.cmd` на Windows — через `cmd.exe`, с проверкой слов.** Подробно ниже, в «Решениях».
5. **Как hook находит node.** *Изменено первым кругом ревью: команда hook-а теперь `"${CLAUDE_PLUGIN_ROOT}/hooks/gate.sh" fast`, node ищет файл запуска (пункт 3 раздела выше).* До круга: команда — `node "${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs" fast`, node берётся из PATH процесса Claude Code. Без node hook падает с кодом 127, вердикта и маркеров нет; это отступление от `gate.sh` записано в шапке `gate.mjs`. **Из трёх случаев Ticket-а живым hook-ом не проверен ни один** (см. «Не сделано»).
6. **`gate-resolve.mjs`.** Домашняя папка — `os.homedir()`; порядок поиска реестра прежний; `match` и пути сравниваются при любом разделителе, на Windows без учёта регистра.
7. **Изоляция test-ов.** Test-ы Gate и `harness-scripts.test.ts`, которые подменяют `HOME`, задают тем же путём `USERPROFILE`. Во время прогонов в настоящей папке `~/.claude/worfy-harness/gate` не изменился ни один файл. Вне этого Ticket-а `HOME` без `USERPROFILE` ставят ещё девять shell-test-ов `harness/bin/tests` и `guard-silent.test.sh` — они достаются Ticket-ам 04 и 05.
8. **Новое имя во всех ссылках.** `hooks.json`, тексты для модели, skills, agents, README, `CONTEXT.md`, test-ы. `git grep -n 'gate\.sh' -- harness` находит имя только в прокладке и её test-е (см. решение ниже; после первого круга ревью — ещё в `hooks.json` и в test-ах, которые проверяют файл запуска); в `src` — только в распознавании старых вызовов.
9. **worfy узнаёт вызов Gate** по `gate.mjs` и по старому `gate.sh`. `\` перед именем — разделитель только на Windows: на macOS bash читает `my\gate.sh` как `mygate.sh`.
10. **Пути Windows в worfy.** `cd` на `C:\…`, `C:/…`, `/c/…`; `cwd` записи транскрипта `C:\…`; `gateKey` и сравнение `worktree` файла вердикта — при любом разделителе и без учёта регистра на Windows. `absolutePath` канала `checks` — общий helper Ticket-а 08 (`src/shared/paths.ts`), он уже в main.
    - **Сверх списка Ticket-а: `worktreeOfCwd`** (`src/shared/ipc/checks.ts`). Он сравнивал только через `/`: git пишет worktree как `C:/x`, Claude Code пишет папку Session как `C:\x`, и Session на Windows не получала бейдж Gate. Без этого пункт 10 для Session не работал.
    - **`cd` с `\` без кавычек на Windows — «папку узнать нельзя».** Git Bash читает `\` как экранирование: `cd C:\a\b` уходит в `C:ab` и падает (запущено ревьюером).

### Решения

- **`gate.sh` остаётся прокладкой — решение владельца 2026-10-13.** Оно дано в чате Session на Mac и пришло сюда её сообщением; на main записано в `HANDOFF.md` и в [Ticket-е 46](46-имя-gate-sh-уходит-совсем.md). Причина: профиль, который записал перенос старого Harness, называет `…/plugin/hooks/gate.sh` в `commands.verify` (на Mac владельца — профиль `atakama`) и в `rules.md`, и агенты запускают эту команду как написано.
  - В файле две команды: проверка, что node есть на `PATH`, и `exec node …/gate.mjs "$@"`. Путь к `gate.mjs` в Git Bash берётся через `pwd -W` (`C:/…`): с `MSYS_NO_PATHCONV=1` путь вида `/c/…` node не находил (нашёл ревьюер, код выхода был 1). Аргументы и stdin идут дальше как есть, код выхода — от `gate.mjs`. Без node — прежние строка «ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден» и код 3.
  - Ничто в самом Harness файл не зовёт. Новый профиль называет `node <plugin>/hooks/gate.mjs` — строка об этом в `harness/profiles/README.md`.
  - Test — `harness/hooks/tests/gate-shim.test.sh`: один и тот же прогон через `node gate.mjs` и через `bash gate.sh` даёт один код выхода, одни строки `[gate] …` и одни имена файлов в папке состояния — для «зелено», «красно» (`full`) и «не зарегистрирован»; session из stdin доходит до имени маркера.
  - Это отступление от ADR-0055 (скрипты Harness — на Node, bash только в test-ах; пункт 4). ADR не правился. Имя уходит совсем в Ticket-е 46 — после приёмки E3 (отменено решением владельца 2026-10-14: `gate.sh` — файл запуска hook-а; Ticket 46 закрыт). `src/main/harness/migrate` и `install.ts` здесь не тронуты.
- **`harness/hooks/worktree-create.sh` на Node не переносится** — решение владельца того же дня: его ничто не запускает. Новая опись (ниже) нашла, что он не был приписан ни к одному Ticket-у.
- **Запуск менеджера пакетов на Windows.**
  - Gate сам находит программу: папки `PATH`, расширения `PATHEXT`, текущая папка не ищется. Отсутствующий менеджер пакетов известен до запуска.
  - Командная строка идёт через `<SystemRoot>\System32\cmd.exe /d /s /c`, каждое слово в двойных кавычках. `ComSpec` не читается: с `ComSpec`, указывающим на powershell.exe, менеджер пакетов не запускался вовсе (запущено ревьюером).
  - Слово с `"`, `%`, `!`, `^`, переводом строки или `\` в конце и репозиторий на сетевом пути через `cmd.exe` не запускаются: `.exe` стартует напрямую, `.cmd` не стартует, исход — «проверить не удалось». Причина: Node не запускает `.cmd` без оболочки (CVE-2024-27980), а безопасного экранирования этих символов для любого batch-файла нет.
  - Слова с `&`, `|`, `<`, `>`, скобками, пробелом, кириллицей доходят целыми (запущено ревьюером).
- **Язык `cmd.exe`: скрипт идёт в своей скрытой консоли, переключённой на UTF-8 до старта `cmd.exe`, который читает командную строку.** `cmd.exe` называет отсутствующий инструмент на языке системы и в кодовой странице консоли: на ПК владельца — по-русски в 866. Признак «окружение недоступно» на таком тексте не срабатывал, исход был «красно». `cmd.exe`, который стартовал в консоли с кодовой страницей 65001, отвечает `'tool' is not recognized as an internal or external command,`; вывод node в UTF-8 не меняется. Код выхода 9009 вместо текста не годится: `pnpm run` и `npm run` с отсутствующим инструментом выходят с кодом 1.
  - **Это третья версия; первые две были неверны.**
  - **Первая** ставила `chcp 65001 &` в начало командной строки и полагалась на `windowsHide: true`: дочерний процесс якобы получает свою консоль. Замер, на котором это стояло, запускал дочерний процесс с pipe-ами. Gate же отдавал ему открытый файл для вывода, а тогда Node запускает его в консоли родителя. Нашла новая проверка, которую просил оркестратор.

    | Как дочерний процесс получает stdio (везде `windowsHide: true`) | Консоль родителя до | После `chcp 65001` в дочернем |
    |---|---|---|
    | pipe-ы | 437 | 437 |
    | всё `ignore` | 437 | 437 |
    | открытый файл для stdout и stderr | 437 | 65001 |
    | унаследованный stdin | 437 | 65001 |

    Итог первой версии: после ручного запуска Gate окно человека оставалось в кодовой странице 65001.
  - **`chcp 65001 &` в начале строки не хватает** ни в общей консоли, ни в своей: `cmd.exe`, который читает строку, выбрал язык раньше.

    | Менеджер пакетов | Без `chcp` | `chcp 65001 &` в начале строки | Консоль в 65001 до старта `cmd.exe` |
    |---|---|---|---|
    | `.cmd`, который сам зовёт отсутствующий инструмент | по-русски | по-русски | по-английски |
    | `.cmd`, который запускает для скрипта новый `cmd.exe` (так делает pnpm) | по-русски | по-английски | по-английски |

    Проверка «`cmd.exe` сам называет отсутствующий инструмент» в первой версии проходила, потому что предыдущие запуски Gate в том же test-е уже оставили консоль в 65001.
  - **Вторая** спрашивала кодовую страницу консоли Gate, ставила 65001 до запуска `cmd.exe` и возвращала прежнюю после. Ревьюер-subagent запуском показал три дефекта. `chcp` читает страницу ввода, а ставит обе: окно, где страница вывода отличается от страницы ввода (PowerShell с `OutputEncoding` в UTF-8), теряло свою страницу вывода. Два Gate в одной консоли: первый, закончив, возвращал старую страницу под вторым. Gate без консоли переключал консоль, которая тут же выбрасывалась.
  - **Как сейчас.** Дочерний процесс получает pipe-ы и `windowsHide: true` — у него своя скрытая консоль, консоль Gate не трогается вовсе. В этой консоли первый `cmd.exe` выполняет `chcp 65001` и запускает второй `cmd.exe`, который читает командную строку. Строка приходит второму через переменную окружения `WORFY_GATE_LINE` с поздней подстановкой (`/v:on`, `!ИМЯ!`): первый `cmd.exe` передаёт её не читая, с `&`, `|`, `<`, `>` и скобками как есть. stderr вливается в stdout внутри строки (`2>&1`), порядок вывода сохраняется.

    | Замер в своей консоли дочернего процесса | Результат |
    |---|---|
    | `.cmd`, который сам зовёт отсутствующий инструмент; `.cmd`, который запускает новый `cmd.exe` | по-английски в обоих случаях |
    | слова `x&y`, `a b`, `(c)`, `d\|e`, `<f>`, `проверка` | дошли до `.cmd` целыми |
    | код выхода `.cmd` 7 | `result.status` 7 |
    | `chcp` внутри | `Active code page: 65001` |

  - **Ctrl+C и сигналы.** Ctrl+C в окне Gate не доходит до процессов чужой консоли. Поэтому Gate ждёт `cmd.exe` без блокировки, а обработчик сигнала сам завершает `cmd.exe` со всем, что под ним (`taskkill /t /f`), и только потом выходит с кодом 128 + номер сигнала. Замер стендом ревьюера (`GenerateConsoleCtrlEvent`): Gate выходит через 0,35–0,41 s после Ctrl+C с кодом 130, без файла вердикта и красного маркера; через 2 s не жив ни один процесс скрипта — и у скрипта, который пишет в вывод, и у молчащего. До правки скрипт доходил до конца, и Gate сообщал его исход. Gate, завершённый без сигнала (`TerminateProcess`), обработчик не выполняет: пишущий скрипт заканчивается на следующей записи в pipe (замер: 0,28 s), молчащий идёт дальше.
  - **Gate ждёт скрипт, а не pipe.** Процесс, который скрипт оставил после себя, держит pipe открытым; Gate дочитывает pipe не дольше полусекунды после конца скрипта. Замер ревьюера до правки: возврат через 8,2 s вместо 0,07 s.
  - **Строка длиннее, чем принимает `cmd.exe`, не запускается** (предел в коде — 8000 символов; замер: до 8144 строка доходит целой, от 8192 второй `cmd.exe` получает пустую строку и выходит с кодом 0 — скрипт считался бы «зелёным», не запустившись). Исход — «проверить не удалось».
  - **Вывод скрипта держится в памяти Gate целиком.** Проверка: скрипт с 2 МБ вывода — «зелено».
  - **Что закреплено проверками на Windows** (`gate-verdict.test.sh`): (a) `cmd.exe` сам называет отсутствующий инструмент — «проверить не удалось» с английским признаком; (f) консоль в 437, запуск Gate, после него 437; (g) порядок stdout и stderr, `!OS!` в `.cmd` остаётся как написано; (h) процесс, оставленный скриптом на 10 s, не держит Gate; (i) слишком длинная строка. На Windows, где `cmd.exe` и так говорит по-английски, проверка (a) упасть не может. Завершение скрипта по сигналу test-ом не закреплено: оно проверено стендом ревьюера (`GenerateConsoleCtrlEvent`).

### Что нашло ревью и что с этим сделано

Три subagent-а только читали и запускали. Первый сверял `gate.mjs` с `gate.sh`, второй искал ошибки в коде для Windows. Третий в три прохода проверял запуск через `cmd.exe` и прокладку: его замечания — причина второй и третьей версии запуска (раздел «Язык `cmd.exe`» выше), обработки Ctrl+Break, предела длины строки и `pwd -W` в прокладке.

- **Исправлено:** язык `cmd.exe` (выше); rename на `verdict-<tag>.json`, пока файл открыт читателем, — на Windows он падал с EPERM, и прогон оставался без файла вердикта или со старым файлом; теперь rename и удаление повторяются десять раз через 50 ms. Файл, который держат дольше полусекунды, остаётся как есть — записано в шапке. `\r` в конце вывода скрипта на Windows. Сигналы: скрипт, завершённый сигналом, останавливает прогон с кодом 128 + номер сигнала, без маркеров и вердикта (отменено первым кругом ревью: такой скрипт теперь «красный»); между скриптами цикл отдаёт управление. Исключение не выходит кодом 1: удалённая текущая папка — код 0, как у `gate.sh`; пустой менеджер пакетов — «окружение недоступно»; остальное — одна строка «ПРОВЕРИТЬ НЕ УДАЛОСЬ» и код 3. Имя файла кэша собирается из безопасных символов: с `\` в пути пакета кэш не писался, а с `..\` файл уходил за папку состояния. `worktreeOfCwd`, `cd` без кавычек, `\` перед именем только на Windows (выше).
- **Записано и не исправлено (low):**
  - формулировка при отсутствии менеджера пакетов — `gate: pnpm: command not found` вместо строки bash с номером строки;
  - скрипт, который оставляет фоновый процесс: `gate.sh` ждал, пока все закроют pipe; `gate.mjs` на macOS и Linux читает файл, как только завершился прямой потомок, на Windows дочитывает pipe не дольше полусекунды;
  - `endRunning` (`taskkill`) идёт без предела по времени; зависший или отсутствующий `taskkill` воспроизвести не удалось;
  - переменная `WORFY_GATE_LINE` видна скрипту в его окружении;
  - порядок изменённых путей — по кодам символов, а не по locale;
  - нецелые `GATE_MAX_AHEAD`/`GATE_MAX_BEHIND` (`1.5`) теперь применяются;
  - одиночный `\r` внутри строки: признаки с `.*` его не проходят;
  - слово, которое `cmd.exe` принять нельзя, даёт «проверить не удалось» с кодом 0, как и прочее «окружение недоступно», а не 3;
  - `match` реестра с разделителем в конце ничему не соответствует, `C:` как `match` соответствует всему диску — как и на main;
  - команда, которая только называет скрипт (`cat harness/hooks/gate.mjs`, `echo gate.mjs`), принимается за вызов Gate — так было и с `gate.sh`; закреплено test-ом как известный предел;
  - вызов из PowerShell его словами (`Set-Location C:\other; node …\gate.mjs fast`) читается по правилам bash: папкой считается папка Session. Имя инструмента в транскрипте не проверяется;
  - на Windows процесс, убитый жёстко, не выполняет обработчик выхода: остаётся прежний файл вердикта и, возможно, `.run-<tag>-<pid>.out` (чистится через неделю).

### Опись скриптов Harness

Снята заново на main `5ee66a7` командой шага 4 Ticket-а 01 (файлы и первые строки читались из commit-а). Она в отдельном файле evidence: [03-опись-скриптов-harness.md](../evidence/03-опись-скриптов-harness.md); раздел 18 первого файла получил ссылку. Вне `tests` — 22 скрипта: Node 10, bash 9, zsh 3. Против `08e8256` добавились два скрипта на Node (`decision-log`, `project-connect`), язык не сменил ни один. Из 12 скриптов на bash и zsh 11 приписаны к одному из Ticket-ов 03, 04, 05, 06, 15; двенадцатый — `worktree-create.sh` (решение выше).

### Падающие первыми

- `harness/hooks/tests/gate-verdict.test.sh` с вызовом `node "$HOOKS/gate.mjs"` до появления файла: EXIT=1, 2 ok и 21 FAIL, `Cannot find module '…\gate.mjs'`.
- `test/unit/gate-state.test.ts` на коде main: `gateTag` для `C:\a\b` и `C:/a/b` — `expected '29c46c4b' to be '6499f282'`; `gateKey` с `match` через `\` — `expected null to be 'worfy'`; файл вердикта в написании git — отвергнут; 11 из 12 строк `gateRunDir` для Windows — `expected undefined to be '…'`.
- Схема канала `checks`: `C:\a` — `expected false to be true`.
- Правки по ревью — так же: `worktreeOfCwd` — `expected undefined to be 'C:/Users/x/worfy'`; `cd` без кавычек — `expected 'C:\Users\x\worfy' to be null`; `\` перед именем на macOS — `expected '/Users/test/projects/demo' to be undefined`.

### Windows-ПК: Gate на Node

Реестр и папка состояния — под `%TEMP%`; настоящая `~/.claude` не тронута. Реестр для worfy на ПК — свой: `fast` — `lint`, `typecheck`; `full` — `lint`, `typecheck`, `test`. Реестра worfy с Mac в репозитории нет.

Запуск из корня клона, head `864b3e1` (итоговый код Gate; в нём main `6033e14`): `node harness/hooks/gate.mjs fast </dev/null; echo "EXIT=$?"`, затем то же с `full`.

| Профиль | Код | Строки Gate |
|---|---|---|
| `fast` | 0 | `[gate] scope (fast): narrowed by the diff from merge-base 6033e145 with origin/main (branch ahead by 18, behind by 0; files changed: 38) — .. Full scope: GATE_SCOPE=all`; `[gate] зелено (fast): worfy/.:lint worfy/.:typecheck` |
| `full` | 2 | `[gate] красно (full): worfy/.:test (прошло: worfy/.:lint worfy/.:typecheck)`; в выводе скрипта — `Tests  612 failed \| 4088 passed \| 43 skipped (4743)` |

- Каждый скрипт профиля запущен; `command not found` и `is not recognized` в выводе нет. Красный `full` ожидаем: test-ы, которые на Windows падают и на main (Ticket 14).
- **Тег.** В папке состояния появились `verdict-efb3d1c9.json` и `red-worfy-efb3d1c9`. `gateTag` worfy для `realpathSync.native('C:\Users\Alexey\worfy')` — `efb3d1c9` (unit-test-проба над `src/main/gate/state.ts` под Node из Electron, после запуска удалена).
- Файл вердикта: `{"version":1,"outcome":"red","profile":"full","worktree":"C:/Users/Alexey/worfy","key":"worfy","head":"864b3e11…","exit":2,"at":"2026-10-13T21:48:45Z","reason":null}`.
- После этого в ветку влит main `4658e39` (документы и четыре файла renderer с их test-ами; файлов ветки среди них нет). На получившемся head `gate fast` — код 0, «зелено»; `full` заново не запускался.
- Это запуск из Git Bash инструмента Bash в Session Claude Code, в основной рабочей копии, не hook-ом.

### Мутанты

**55 из 55 красные.** 26 в `gate.mjs`, 4 в `gate-paths.mjs` (shell-test-ы Gate), 4 в прокладке `gate.sh` (`gate-shim.test.sh`), 17 в `src/main/gate/state.ts` и 4 в `src/shared/ipc/checks.ts` (`test/unit/gate-state.test.ts`).

- **Три сначала выжили:** красный прогон не оставляет красный маркер; зелёный прогон его не снимает; строка «окружение недоступно» побеждает отчёт об упавшем test-е. Проверок на это не было и на main: test-ы клали красный маркер руками для `stop.sh`. Добавлены три проверки в `gate-verdict.test.sh`, после них все три мутанта красные.
- Мутанты запуска через `cmd.exe`: без `chcp`; строку читает первый `cmd.exe`; скрипт в консоли Gate; stderr отдельно от stdout; Gate ждёт закрытия pipe; ранняя подстановка `%ИМЯ%`; `/v:on` у второго `cmd.exe`; слишком длинная строка запускается; из pipe читается только начало.
- Мутанты `state.ts` и `checks.ts` гонялись до переделки запуска через `cmd.exe`; эти два файла с тех пор не менялись.
- **Не закреплено мутантом и test-ом:** завершение дерева процессов по сигналу (`endRunning`). Копия Gate, где `endRunning` ничего не делает, проходит все shell-test-ы; поведение замерено стендом ревьюера.

### Проверки на ПК

| Команда | Результат |
|---|---|
| `pnpm lint`, `pnpm typecheck` | exit 0 каждая |
| `bash harness/hooks/tests/gate-verdict.test.sh` | exit 0: 51 ok; на Windows пропущены проверки сигналов и удалённой папки |
| `bash harness/hooks/tests/gate-file-size.test.sh` | exit 0: 54 ok |
| `bash harness/hooks/tests/gate-unregistered.test.sh` | exit 0: 11 ok |
| `bash harness/hooks/tests/gate-shim.test.sh` | exit 0: 7 ok; проверка через symlink на Windows пропущена |
| `bash harness/hooks/tests/gate-notverified.test.sh` | exit 1: 28 ok, 1 FAIL — `stop.sh` с `PATH=/usr/bin:/bin` (Ticket 04) |
| `pnpm test`, main `6033e14` (эталон; отдельная рабочая копия под `%TEMP%`) | exit 1: 4710 test-ов, 4026 прошли, 641 упал, 43 пропущены |
| `pnpm test`, ветка на `864b3e1` | exit 1: 4743 test-а, 4065 прошли, 635 упали, 43 пропущены |

- **По именам на ветке падают и не падают в эталоне шесть test-ов; по вине ветки — ни один.**
  - `test/contract/harness-migrate.test.ts`, «Profiles: schema 2 … `bin/profile` and `gate.mjs` find them» — переименованный test. В эталоне он под именем с `gate.sh` падает на той же проверке: `expected 'silent' to be 'full'`, до вызова Gate дело не доходит.
  - Четыре timeout-а: один test в `test/unit/check-handoff.test.ts`, два в `test/contract/harness-evals.test.ts`, один в `test/contract/windows-tests-workflow.test.ts`. Эти три файла, запущенные отдельно: новых по именам падений нет.
  - `test/contract/startup-failure.test.ts`, «a packaged app ignores an ELECTRON_RENDERER_URL that is not a URL and starts». Файл запущен отдельно три раза на ветке и три раза на main `6033e14`: во всех шести прогонах этот test проходит, а падают одни и те же десять test-ов файла.
- **В эталоне падают, на ветке не падают 13 имён.** Два из них — следы сравнения (прежнее имя переименованного test-а и файл, который падает целиком в обоих прогонах). По делу Ticket-а: `gate-verdict.test.sh`, `gate-file-size.test.sh`, `gate-unregistered.test.sh` в `test/contract/harness-scripts.test.ts` и три test-а `GateReader` в `gate-state.test.ts` (один переименован: читает файл, который пишет `gate.mjs`). Остальные — test-ы с пределом по времени, которые плавают от прогона к прогону.
- **Полные прогоны на этом ПК шумят.** Shell-test-ы `silent-mode`, `skill-blocks`, `tickets-root` оставляют зависшие процессы bash (зависает `epic-status`, Ticket 05). Пока они живы, test-ы с пределом по времени падают: в трёх парах «эталон — ветка» за эту работу таких было от 1 до 33. Первый итоговый прогон шёл при процессах от трёх прежних прогонов, дал 35 новых по именам падений (33 по времени) и отброшен. Перед каждым прогоном, который вошёл в таблицу, процессы остановлены по pid.
- Эталон, запущенный из PowerShell, не годится: там `harness-scripts.test.ts` не находит bash и jq. Оба сравниваемых прогона запущены из Git Bash.

### Не сделано и не проверено

- **macOS и Linux:** ничего не запускалось, включая ветку запуска без оболочки, bash 3.2 и BSD sed в изменённых shell-test-ах. Запуск через `cmd.exe` стал асинхронным только на Windows; на macOS и Linux `start` возвращает тот же объект того же синхронного вызова (прочитано ревьюером, не запущено).
- **Проверки, которые на Windows пропускаются и не запускались ни разу:** скрипт, завершённый сигналом (код 143, без маркера и вердикта), и запуск Gate из удалённой папки. На ПК они проверены только руками с подменённым `spawnSync` и `process.cwd`.
- **Сигналы на Windows:** Ctrl+C замерен стендом ревьюера, test-ом не закреплён. Не замерены: закрытие окна консоли (SIGHUP), Ctrl+Break после правки (до правки Gate выходил сразу и молчащий скрипт оставался жить), и то, как Claude Code завершает Gate, запущенный hook-ом, — сигналом или `TerminateProcess`. Во втором случае обработчик не выполняется.
- **Прокладка `gate.sh` на Mac не запускалась:** ни её test (на Windows в нём пропущена проверка через symlink), ни команда профиля `atakama`.
- **Hook в живой Session** не проверялся ни в одном из трёх случаев пункта 5: Session worfy, Claude Code из терминала на Mac, Claude Code на Windows-ПК. Строка `[gate] …` от hook-а `TaskCompleted` в транскрипте — пункт «Готово, когда» для Mac.
- **`harness/bin/tests/silent-mode.test.sh`** не запускался: на этом ПК он зависает на `epic-status` (Ticket 05). В нём сменено имя Gate и добавлен `USERPROFILE`.
- **`gate-notverified.test.sh`** на ПК красный одной проверкой: она гоняет `stop.sh` с `PATH=/usr/bin:/bin`, где на ПК нет git. Это Ticket 04.
- **Репозиторий на сетевом пути, подставном диске (`subst`), с коротким именем 8.3** — не проверялось.
- **`test/e2e`** (`packaged.spec.ts`, `checks-badges.spec.ts`) на ПК не запускались.
- **Замечания ревью уровня low** — список выше, не исправлены.
