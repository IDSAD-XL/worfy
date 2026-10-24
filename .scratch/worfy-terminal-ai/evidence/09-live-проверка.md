# 09 — live-проверка Terminal AI на подписке, 2026-10-19 и 2026-10-24

Две проверки. Первая — 2026-10-19, разделы ниже до «Чего здесь нет». Вторая — 2026-10-24, раздел
«2026-10-24: замеры на Stable copy 46d53eb3» в конце файла.

Stable copy, собранная из `main` `e61cb1fe`, pid main process 51064, запуск ~17:50 (время местное,
EEST, UTC+3). Подписка владельца, без `WORFY_AGENT=fake`. Лог — stdout Stable copy (в репозиторий не
кладётся: в нём пути машины и отпечатки ключей gate). Здесь — только подсчёты и выводы.

## Слова владельца

«Проверил терминал, все впорядке» — про ручные пункты: Suggestion из истории и от Haiku, второе окно,
история и `$HISTFILE`, Next command, Command request и панель ⌘I, Fix, `LimitsMeter`, переключатели
Settings. Время до серого текста в 10 попытках и пункт о thinking у Sonnet владелец не сообщал —
**не измерено**.

## Лог Stable copy (снимок до 18:00:37)

| Что | Сколько |
| --- | --- |
| строк `[terminal-ai] assist process: …` (init assist-процесса) | 17 |
| из них модель `claude-haiku-4-5-20251001` | 8 |
| из них модель `claude-sonnet-5-5` | 9 |
| запросов `suggest: model haiku` | 8 |
| запросов `next: model sonnet` | 5 |
| запросов `request: model sonnet` | 4 |
| запросов `fix: …` | 0 |
| `option_not_applied`, `claim refused`, `did not start`, `failed` | 0 |

- Каждая строка init: Claude Code 2.1.289, `apiKeySource none`, plugin-ы — только встроенные в Claude
  Code `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`; plugin-ов
  пользователя нет (worfy, mattpocock и другие не грузятся); `hooks: not reported by init`.
  `claude --debug` для hooks встроенных plugin-ов не запускали.
- Строк `fix:` в логе нет: Fix, о котором говорит владелец, в этот снимок лога не попал (либо был
  позже 18:00:37, либо в другой копии). Расхождение записано, не разобрано.

## Процессы (`ps`, дети pid 51064)

- ~17:57: два процесса `claude`: 52480 (RSS 314 MB, 6:35) и 60702 (RSS 218 MB, 1:51).
- 18:30 и 18:36: один — 52480 (RSS 234 MB, 45:58). 60702 и 73885 закрылись.
- **52480 — не assist-процесс, а Session worfy.** Его argv: `--model opus`, `--effort high`,
  `--resume=<id Session-а>`, `--add-dir <папка cards worfy>`, `--plugin-dir-no-mcp <harness>`,
  `--settings {"autoCompactWindow":400000}` — опции Session-а (`src/main/agent/options.ts`: `resume`,
  `autoCompactWindow`). Assist-процесс стартует с `settingSources: []`, без MCP, моделью haiku или
  sonnet (`src/main/terminal-ai/options.ts`). Запущен через 3 с после старта приложения — по
  всей видимости, Session Card-ы, которую Stable copy продолжила при запуске (не проверялось).
- Значит, assist-процесс в каждый момент был один: 60702 (RSS 218 MB) — по времени, spare после
  последнего запроса (его argv не снят); после 10 минут без запросов его нет (18:30 — только Session). Пункт ADR-0058, 2
  выполняется.

## `~/.claude`

- `~/.claude/projects`: список папок до (17:41) и после (17:57) одинаковый — транскриптов нет.
- `~/.claude/sessions` до и после:
  - новые `52480.json` и `52480.<hash>.key` — запись Session-а 52480 (`cwd` — корень Project-а,
    `kind: interactive`, `entrypoint: sdk-ts`, `messagingSocketPath: /tmp/cc-socks/52480.sock`).
    Для Session-а это ожидаемо: worfy и находит живые Session-ы по этим файлам.
  - новый `60702.<hash>.key` без `60702.json` — spare assist-а публикует ключ своего messaging socket,
    пока жив; после его выхода файла нет.
  - `<pid>.json` assist-процесса в снимки не попал. По коду Claude Code 2.1.289 он пишется в момент
    claim и удаляется на выходе процесса, `cwd` — `<WORFY_DATA_DIR>/terminal-ai` (не Project).
    Разбор и план — Ticket [16](../issues/16-assist-процесс-в-списке-сессий-claude-code.md).
- `shasum ~/.zshrc` до и после одинаковый.

## Чего здесь нет

Времени ответа по функциям, Limits до и после, примеров ответов: владелец их не записывал
(время и примеры сняты 2026-10-24, раздел ниже). Сценарий
приватности с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG`, test-ы и gate full в этой проверке не
запускались (сделано 2026-10-24, раздел ниже).

## 2026-10-24: замеры на Stable copy 46d53eb3

Владелец 2026-10-24: «можешь замерять это сам». Замеры сделал Orchestrator на Stable copy владельца
(`~/Applications/worfy-stable.app`, commit `46d53eb3`), на подписке владельца, по его просьбе, без
`WORFY_AGENT=fake`. Project CanvasForAI, новый Terminal Node (zsh, cwd — корень репозитория), после
замеров закрыт. Время замеров — 04:00–04:17 по местному времени (EEST, UTC+3).

### Как мерили

- Лог Terminal AI в Stable — только `console.info` в stdout main process, без меток времени. Строк про
  thinking и первый токен в нём нет. Поэтому Stable запущен с `--remote-debugging-port` (renderer) и
  `--inspect` (main process), оба на 127.0.0.1.
- В main process через inspector поставлен наблюдатель только в памяти, на диск он ничего не писал:
  - метка времени на каждой строке `[terminal-ai] …`;
  - для каждого запущенного `claude` — только типы сообщений stream-json (`control_request` subtype,
    `user`, `stream_event` с типом блока, `assistant` с типами блоков, `result` с `duration_ms`,
    `duration_api_ms`, usage и началом ответа). Текст prompt-а не записывался.
- В renderer: время последней клавиши (`keydown`) и время, когда в `.xterm-rows` Terminal Node-а
  появился серый текст или изменилась строка. Часы обеих сторон — одной машины.
- Ввод — CDP `Input.dispatchKeyEvent` по символу, 45 мс между символами (Command request — 25 мс).
  Между попытками — Ctrl+U и пауза 2,5 с. Enter на предложенной команде не нажимался ни разу.
- Скрипты и сырые записи — в scratchpad Orchestrator-а, в репозиторий не кладутся (в них пути машины).
- После замеров Stable закрыт по pid и запущен обычным `open -a` без аргументов; порты закрыты,
  наблюдатель ушёл вместе с процессом. Фоновых процессов не осталось. Перезапуск дважды останавливал
  Session Card-ы (opus, `--resume`); перед первым закрытием она простаивала, Stable продолжает её при
  запуске.

### Suggestion (Haiku), 10 попыток

Префиксы проверены по `~/.zsh_history` (471 строка): ни один не встречается в истории ни как начало,
ни как подстрока. Перед замерами — одна разминка (`cal -y 20`): spare-а ещё не было, холодный старт,
2984 мс до серого текста.

Все времена — мс от последней клавиши.

| # | Префикс | Серый текст | запрос в main | первый токен | `result` | выход процесса | **серый текст** | `duration_api_ms` |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `find . -name "*.log" -mtime` | `+7 -delete` | 630 | 1322 | 1411 | 1948 | **1959** | 728 |
| 2 | `du -sh ~/Down` | `loads` | 637 | 1339 | 1374 | 1901 | **1906** | 676 |
| 3 | `tar -czf backup-` | `$(date +%Y%m%d-%H%M%S).tar.gz <корень Project-а>` | 634 | 2431 | 2626 | 3323 | **3330** | 1932 |
| 4 | `docker ps --filt` | `er` | 636 | 1349 | 1381 | 1905 | **1908** | 687 |
| 5 | `grep -rn "TODO" src/ren` | `der/` | 629 | 1277 | 1345 | 2028 | **2032** | 662 |
| 6 | `git log --oneline --since=` | `"2 weeks ago"` | 640 | 1393 | 1489 | 2175 | **2185** | 784 |
| 7 | `ps aux \| grep -i elec` | `tron` | 638 | 1436 | 1506 | 2199 | **2203** | 810 |
| 8 | `df -h /Vol` | `umes` | 634 | 1370 | 1471 | 1999 | **2011** | 777 |
| 9 | `networksetup -listall` | `networkservices` | 632 | 1238 | 1323 | 2021 | **2023** | 628 |
| 10 | `sed -n '1,20p' pack` | `age.json` | 630 | 1995 | 2127 | 2863 | **2866** | 1444 |

В попытке 3 Haiku дописал абсолютный путь к корню репозитория; здесь он заменён на `<корень Project-а>`.

- **До серого текста: медиана 2028 мс** (мин 1906, макс 3330).
- Первый токен: медиана 1360 мс от последней клавиши (spike 2026-10-09: ~1,3 с — совпадает). Из них
  ~634 мс (медиана) — пауза shell-а перед запросом (`__worfy_suggest_pause_ms=600`,
  `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`) плюс доставка в main.
- От сообщения `user` в stdin assist-процесса до первого токена: медиана 725 мс (605–1796).
- Thinking: 0 блоков во всех 10 ответах, только `text`. Модель `claude-haiku-4-5-20251001`.
- Набор во время ожидания ответа (старый ответ не должен появиться) в этих замерах не проверялся.

### Next command, Command request, Fix (Sonnet, `effort: 'low'`)

Модель во всех ответах — `claude-sonnet-5-5` (по `system/init` и `message_start`). Перед запросом
assist-процесс получает `claim_session`, `set_model`, `apply_flag_settings`. Строк `option_not_applied`
нет.

**Thinking: ни одного блока `thinking` или `redacted_thinking` и ни одного `thinking_delta` ни в одном из
9 ответов.** В каждом ответе один блок `text`. Влияния thinking на время ответа нет.

Времена — мс от Enter (Next command, Command request) или от нажатия кнопки «Fix».

| Функция | Ввод | Ответ | запрос в main | `user` → первый токен | `result` | **в строке / серым** | ожидание выхода после `result` |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next command | `git status` | `git diff` | 876 | 1367 | 2318 | **2891** | 573 |
| Next command | `pwd` | `git log --oneline -10` | 823 | 706 | 2005 | **2621** | 616 |
| Next command | `ls` | `git log --oneline -10` | 833 | 652 | 2138 | **2879** | 741 |
| Command request | `# find files bigger than 100 MB changed this week` | `find . -type f -size +100M -mtime -7 -exec ls -lh {} +` | 18 | 662 | 1438 | **2129** | 691 |
| Command request | `# show the 5 biggest folders in my home` | `du -hd 1 ~ 2>/dev/null \| sort -rh \| sed -n '2,6p'` | 27 | 708 | 1452 | **2174** | 722 |
| Command request | `# count lines of typescript under src` | `find src -type f \( -name '*.ts' -o -name '*.tsx' \) -not -path '*/node_modules/*' -print0 \| xargs -0 cat \| wc -l` | 16 | 685 | 1475 | **2173** | 698 |
| Fix | `ls /nonexistent` → «Fix» | `ls` | 25 | 1087 | 1175 | **1928** | 753 |
| Fix | `ls /nonexistent` → «Fix» | `ls` | 12 | 1074 | 1140 | **1895** | 755 |
| Fix | `ls /nonexistent` → «Fix» | `ls` | 12 | 1129 | 1197 | **1947** | 750 |

- Медианы до ответа в строке: **Next command 2879 мс** (из них ~800 мс — пауза `NEXT_COMMAND_PAUSE_MS`,
  `src/main/terminal-ai/features/next-command.ts`), **Command request 2173 мс**, **Fix 1928 мс**.
- `duration_api_ms` у Sonnet: 1066–1392 мс; out-токенов 4–62.
- Next command: серый текст на пустой строке, Enter не нажимался. Command request: команда в строке, не
  запущена (стёрта Ctrl+U). Fix: в строке `ls`, не запущена.
- Fix во всех трёх попытках предложил ровно `ls` — убрал путь. worfy дорисовал серым `/nonexistent` из
  истории. Формально это исправление, по сути слабое: замечание о качестве ответа, не о работе функции.
- Кнопка «Fix» исчезает после одного нажатия, поэтому три замера Fix — три запуска `ls /nonexistent`.

### Находка: ответ ждёт выхода процесса `claude`

Серый текст и ответ в строке появляются только после выхода вспомогательного процесса `claude`, через
527–755 мс после сообщения `result`. Suggestion, по 10 попыткам: 548, 532, 704, 527, 687, 696, 697, 540,
700, 739. Sonnet — последняя колонка таблицы выше.

Ответ готов уже на `result`. Но цикл в `attempt()` (`src/main/terminal-ai/assist.ts`, `for (;;)` по
`iterator.next()`) кончается только на `done`, а `done` приходит, когда процесс закончил работу. Если
брать ответ на `result`, медиана Suggestion была бы ~1,44 с вместо ~2,03 с. Код не менялся; решение
владельца не принято.

### Процесс, лог, `~/.claude`, Canvas

- Assist-процесс в каждый момент один — spare (`claude` без `--resume`). После замеров RSS 216 MB.
  Второй ребёнок worfy — Session с `--model opus --resume`, которую Stable продолжила при запуске, не
  assist. 24 запуска `claude` за время наблюдения, все вышли с кодом 0.
- Лог за время наблюдения: `suggest: model haiku` 11, `next: model sonnet` 6 (3 замера + 3 после
  `ls /nonexistent`), `request: model sonnet` 3, `fix: model sonnet` 3, init assist-процесса 23. Во
  всех init `apiKeySource none`, plugin-ы только встроенные `cc-plugin-agents-md`,
  `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`, `hooks: not reported by init`.
  `option_not_applied`, `claim refused`, `did not start`, `failed` — 0.
- `~/.claude/projects` до и после — тот же список, 61 папка. Транскриптов нет.
- `~/.claude/sessions` до и после: сменилась только запись Session-а, который Stable продолжает при
  запуске (`--resume`, модель opus, `cwd` — Project): pid 45300 → 81881 (`<pid>.json` и `<pid>.<hash>.key`).
  Записи assist-процесса нет.
- Canvas CanvasForAI после закрытия временного Terminal Node-а: те же узлы (orchestrator 1, handoff 1,
  epic-frame 5, card 1, session 37, note 2, epic-arrangement 1), viewport тот же. Нового Session Node-а
  нет.
- История: в `~/.zsh_history` добавились выполненные команды `git status`, `pwd`, `ls`,
  `ls /nonexistent` ×3 — обычная запись shell-ом. Префиксы Suggestion и строки `# …` в историю не
  попали.
- `shasum ~/.zshrc` до и после одинаковый.
- Limits: показания `LimitsMeter` до и после в этот раз не снимались.

### zsh-autosuggestions

Не установлен и не загружается: `zsh -ic 'print $+functions[_zsh_autosuggest_start]'` → `0`. В
`~/.zshrc` (nvm, PATH, fpath) и `~/.zprofile` упоминаний нет; папок plugin-а в Homebrew и `~/.oh-my-zsh`
нет. Проверка «Suggestion worfy и zsh-autosuggestions не мешают друг другу» на этом Mac **не применима**
— не выполнена. Ничего не ставилось.

### Test-ы и gate

- Limits: `test/unit/terminal-ai-limits-gate.test.ts` и `test/contract/terminal-ai-assist.test.ts`
  отдельно (vitest 5.0.3) — `Test Files 2 passed (2)`, `Tests 52 passed (52)`, exit 0.
- gate full с `GATE_SCOPE=all` на `main` `a3f95bbf` — green: lint, typecheck, test, test:e2e,
  test:package; exit 0. Запусков настоящего Claude Code в выводе test-ов нет.

### Приватность (`WORFY_AGENT=fake`)

Отдельная сборка `a3f95bbf` с `WORFY_AGENT=fake` и `WORFY_TERMINAL_AI_LOG` (журнал контекста, который
fake backend получает вместо модели). Временные `HOME` и `HISTFILE`; в историю заранее положена строка
`export GITHUB_TOKEN=ghp_…` с ненастоящим токеном. Сценарий: строка для Suggestion, `ls
/nonexistent-ta09` и Fix, затем `export GITHUB_TOKEN=…`, `sudo -k; sudo true`, запрос пароля через
`getpass`, `less notes.txt`, ` echo secret` (пробел в начале).

Журнал — 7 записей (`cwd` у всех — временная папка `…/alpha`, `branch null`, `cancelled false`):

| # | feature | model | что в `commands` / `line` |
| --- | --- | --- | --- |
| 1 | suggest | haiku | `line`: `echo worfy-ord se`; `commands` пуст |
| 2 | next | sonnet | `echo worfy-ord second third` |
| 3 | fix | sonnet | + `ls /nonexistent-ta09`; `exitCode 1`, `output` — строка ошибки `ls` |
| 4 | next | sonnet | + `export GITHUB_TOKEN=[redacted]` |
| 5 | next | sonnet | + `sudo -k; sudo true` |
| 6 | next | sonnet | + `python3 -c "import getpass; getpass.getpass('Password: ')"`; `exitCode 130` (ввод прерван Ctrl+C) |
| 7 | next | sonnet | + `less notes.txt` |

1. Переменных окружения в журнале нет: в записи только `line`, `request`, `cwd`, `commands`, `branch`,
   `exitCode`, `output`.
2. Токен — только `[redacted]` (запись 4 и дальше); самого значения в журнале нет.
3. Запрос пароля. `sudo -k; sudo true` на этом Mac пароля не спросил — по всей видимости, Touch ID или
   настройка sudo. Поэтому запрос пароля проверен заменой: `getpass` из Python ждал ввода «Password:».
   Пока он ждал, запросов не было: запись 6 — Next command после выхода программы.
4. Внутри `less` запросов нет: запись 7 — после выхода из `less`.
5. Для ` echo secret` запросов нет, в `commands` этой строки нет.

`shasum` у `~/.zshrc` и `~/.zsh_history` владельца до и после одинаковый.
