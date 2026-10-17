# 05 — Next command: после команды Sonnet предлагает следующую серым текстом на пустой строке

Type: task
Status: done 2026-10-14
PR: #312
Branch: worfy-terminal-ai/05
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(b) (после конца команды Sonnet с `effort: 'low'` предлагает следующую; переключатель в Settings даёт выбрать Haiku), пункт 2 (автоматическая функция — в фоне и только после паузы, выключается сама по Limits), пункт 3 (контекст: строка, папка, ~20 команд, ветка, код выхода; без вывода; redaction) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункты 3–6

## Что происходит

- После Ticket-а 01 main знает, когда команда кончилась (OSC 633 D с кодом выхода) и когда shell
  снова показал prompt (B). События — у registry Terminal Node-ов, функция доступа — в «Итог»
  Ticket-а 01.
- После Ticket-а 03 main шлёт в shell `show <id> <текст>` без запроса shell-а (`push` в
  `src/main/terminal-ai/shell-link.ts`), а widget показывает серый текст.
- После Ticket-а 02 у main есть `request('next', …)`: Sonnet с `effort: 'low'` или Haiku без thinking
  по Settings, тайм-аут 8 с, отказ по Limits.
- Spike 2026-10-09: тёплый Sonnet — первый токен 795–2768 ms, медиана 830; ответ 1364–3802 ms.
- Warp делает так же: Next command из истории, ветки, кода выхода и папки
  (https://docs.warp.dev/agents/active-ai). В отличие от Warp, вывод команды сюда не уходит
  (решение 3).

## Что делаем

1. **Когда спрашивать** — `src/main/terminal-ai/features/next-command.ts` (новый).
   - Команда кончилась, shell показал prompt, строка пустая, 800 ms нет ввода (spec, «Решено без
     владельца», пункт 2) — `request('next', …)`.
   - Не больше одного запроса на prompt. Не после команды с пробелом в начале: её текста у main нет.
   - Ввод до ответа — запрос отменяется: widget при первом нажатии после prompt-а шлёт `cancel`
     для Next command этого prompt-а.
   - Контекст: последняя команда и её код выхода, папка, ветка, последние 20 команд. Вывода нет.
2. **Показ** — `src/main/terminal/zsh/rc.d/30-next-command.zsh` (новый).
   - `show` от Next command — только на пустой строке.
   - Пользователь печатает начало предложенной команды — серым остаётся остаток. Иное — серый текст
     скрыт.
   - → принимает, Esc скрывает — общие функции Ticket-а 03.
   - Enter на пустой строке с серым текстом ничего не запускает: серый текст — не часть строки.
3. **Отказ молча.** Limits, Settings, тайм-аут — серого текста нет, в Terminal ничего не печатается.

**Не входит:** вывод команды в контексте (решение 3: только для Fix); предложение после ошибки —
это Fix (Ticket 07), Next command при этом работает как обычно.

## Готово, когда

- [x] Contract `test/contract/terminal-ai-next-command.test.ts` (новый), настоящий zsh, assist — поддельный: в временном git-репозитории `git status` — через паузу на пустой строке серый ответ fake; в журнале — `git status`, код 0, ветка, папка, функция `next`, модель `sonnet`; вывода `git status` в журнале нет.
- [x] Тот же contract: Enter на пустой строке с серым текстом — команда не запущена (вывода ответа fake нет); ввод `x` — серый текст скрыт; ввод до ответа — запрос отменён, ответ не показан.
- [x] Тот же contract: модель Next command в Settings — Haiku — в журнале `haiku`; Next command выключен — запросов нет; Limits со статусом `allowed_warning` — запросов нет; команда с пробелом в начале — запроса нет.
- [x] e2e `test/e2e/terminal-ai-next-command.spec.ts` (новый), fake с ответом: после `echo` с уникальной меткой на пустой строке виден серый ответ; → вставляет его в строку; запуска нет, пока test не нажал Enter.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «после `git status` на пустой строке серый ответ»: обработчика ещё
нет. Assist поддельный, подписка не тратится. В «Итог» — итоговая пауза и как падал первый test.

## Где в коде

- `src/main/terminal-ai/features/next-command.ts` (новый)
- `src/main/terminal/zsh/rc.d/30-next-command.zsh` (новый)
- `test/contract/terminal-ai-next-command.test.ts` (новый)
- `test/e2e/terminal-ai-next-command.spec.ts` (новый)

## Итог

2026-10-14. Ветка `worfy-terminal-ai/05`.

### Как падал первый test

`test/contract/terminal-ai-next-command.test.ts` до кода: файл не загрузился — `Cannot find module
'/src/main/terminal-ai/features/next-command'`. С обработчиком и скриптом, но с ошибкой в скрипте (`autoload -Uz +X
add-zsh-hook` возвращает 1, если функция уже загружена интеграцией Ticket-а 01, и скрипт выходил сразу) —
11 красных из 21, первый — «after `git status`…»: `expected 0 to be greater than or equal to 1`, shell ни разу не
спросил `next`. После правки — зелёный.

### Числа

- Пауза — **800 ms** (`NEXT_COMMAND_PAUSE_MS`, как в spec, «Решено без владельца», п. 2). Test на собственной паузе
  обработчика: запрос к модели — не раньше чем через 800 ms после `ask`.
- Тайм-аут — **8 с**: `FEATURE_TIMEOUT_MS.next` Ticket-а 02, не менял.
- В contract пауза короче, через параметр `nextCommandFeature({ pauseMs })`: 100 ms (отдельные test-ы — 1000,
  1500, 3000 ms).

### Как устроено

- **Где пауза — у main** (`src/main/terminal-ai/features/next-command.ts`). Почему не у скрипта:
  - отмена уже есть: `_worfy_assist_changed` Ticket-а 03 шлёт `cancel` на первое изменение строки, обработчик ждёт
    паузу на `signal` запроса и выходит сразу по отмене (test: отмена во время паузы заканчивает обработчик меньше
    чем за секунду, модель не спрошена);
  - в zsh не нужен второй таймер (subshell и pipe, как у Ticket-а 04) — меньше кода в shell-е, ничего не
    наследует запущенная команда;
  - паузу test задаёт параметром фабрики, без файла `rc.d/15-test-pause.zsh`.
  Цена: `ask` открыт в main 800 ms. Он ничего не занимает у assist: `request('next', …)` зовётся только после паузы.
- **Скрипт** `src/main/terminal/zsh/rc.d/30-next-command.zsh`. `preexec` ставит отметку «команда запущена»
  (`__worfy_next_ran`), кроме строки с пробелом или TAB в начале. Функция в `__worfy_assist_line_hooks` берёт
  отметку при первом вызове после команды — это вызов из `line-init` нового prompt-а — и, если строка пуста, шлёт
  `_worfy_assist_ask next ''`. Дальнейшие изменения строки на этом prompt-е отметки не находят: не больше одного
  запроса на prompt.
- **Не спрашивает:** на первом prompt-е shell-а; после пустого Enter и Ctrl+C (команды не было); после команды с
  пробелом в начале; если prompt пришёл с готовой строкой (`print -z`, push-line); когда строку стёрли до пустой;
  без socket-а и без `next` в `config` (`_worfy_assist_ask` отказывает молча).
- **Показ** — общие функции Ticket-а 03: `show` рисуется, только пока `ask` открыт, а любое изменение строки его
  закрывает, поэтому ответ появляется только на пустой строке. Набранное начало ответа оставляет остаток серым
  (ветка `kept`), другое — скрывает; → принимает, Esc скрывает; Enter на пустой строке ничего не запускает.
  История главнее ответа модели: если набранное начало совпало с командой из истории, серым показывается история
  (правило Ticket-а 03).
- **Обработчик**: строка не пустая — ничего; после паузы `terminalAiInput(state, '')` (папка, команды, код выхода;
  ветку находит assist; вывода нет), `assist.request('next', input, signal)`, `reply.show(ответ)`. Отказ (Settings,
  Limits, идёт команда, альтернативный экран, тайм-аут, пустой ответ, ошибка) — тишина, в лог ничего не пишется.

### Правка test-а вне «Где в коде» (решение Orchestrator-а)

`test/e2e/terminal-ai-suggest.spec.ts`, одна строка (57): `sandbox.requests().filter((r) => r.feature ===
'suggest')`. Без неё test красный из-за нового поведения: он принимает ответ модели, жмёт Enter, команда
выполняется, и на пустом prompt-е после неё Next command спрашивает модель. Прогон spec-а без правки (под замком
e2e): `Expected length: 1, Received length: 2`, вторая запись — `{"feature": "next", "model": "sonnet", "context":
{"line": "", "commands": ["echo worfy-tai-… second third"], "exitCode": 0, …}}`. Строки 58–59 (`toHaveLength(1)` и
`toMatchObject({ feature: 'suggest', … })`) не менялись: test проверяет то же — модель Suggestion спросили один раз.
Остальные test-ы Ticket-ов 03 и 04 не менялись и зелёные.

### Mutation testing

Скрипты `/tmp/worfy-tai-w3/impl-05/mut/run.sh` и `run2.sh`: файл меняется на месте, восстанавливается из копии, в
конце суммы обоих файлов сверяются (совпали оба раза). 15 мутантов (7 скрипта, 8 обработчика):

- убиты с первого прогона 11: без сброса отметки, `preexec` без проверки пробела, без проверки пустой строки, без
  проверки отметки, без `preexec`, `ask` под другим именем функции, без паузы, без проверки пустой строки в main,
  пауза 100 вместо 800, `request` без `signal`, другое имя функции;
- выжили 4, разобраны:
  - проверка `funcstack` на `line-init` в скрипте — эквивалентна: отметку команды забирает первый вызов hook-а, а
    первый вызов после команды всегда из `line-init`. Проверку убрал;
  - отмена паузы по `signal`, проверка уже отменённого `signal`, пауза из параметра — без них результат тот же
    (assist отказывает по отменённому `signal`), но обработчик висит всю паузу. Добавлены проверки времени в test
    паузы — все три мутанта убиты повторным прогоном.

### Проверки

С итогового head (после rebase на `1c1beadd`):

- `pnpm lint && pnpm typecheck && pnpm test` — exit 0: 237 файлов (6 пропущено), 5045 test-ов (66 пропущено).
- `gate.sh fast` — exit 0, `[gate] зелено (fast): lint typecheck test`, не из кэша.
- Contract `test/contract/terminal-ai-next-command.test.ts` — 22 test-а, три прогона подряд, все exit 0, около 25 с
  каждый.
- `test/contract/terminal-ai-zle.test.ts`, `terminal-ai-suggest.test.ts`, `terminal-shell-integration.test.ts` —
  exit 0, 91 test, без правок.
- e2e под `/tmp/worfy-e2e.lock`, консоль у `alexey`: `playwright test` для `terminal-ai-next-command`, `terminal-ai-suggest`, `terminal-ai-history`, `terminal-ai-settings` — exit 0, 6 passed; `WORFY_EVIDENCE_DIR` не задан.
- `GATE_SCOPE=all` gate full — не запускал: его запускает Orchestrator.

### Не проверено

- Настоящий Sonnet и Haiku — только fake; вживую — Ticket 09.
- Строка `# …` Ticket-а 06: если его обёртка `accept-line` не запускает строку, `preexec` нет и Next command не
  спрашивает; если запускает — спросит, как после любой команды. Совместно не проверялось: 06 идёт параллельно.
- Долги Ticket-а 03 не чинил: `config` позже первого prompt-а — на этом prompt-е `next` не спрашивается; клавиши
  привязаны независимо от Settings; программа в Terminal-е наследует соединение shell-а.

### Gate оркестратора (2026-10-14)

- Wave Epic-а под Autopilot; 05 и 06 розданы после мержа 04 (общие файлы с ним) и шли параллельно. Решение Orchestrator-а: «спросить Next command» решает скрипт zsh (`ask next` с пустой строкой на первом prompt-е после команды) — widget Ticket-а 03 не принимает `show` без своего `ask` (`10-assist.zsh:199-203`); `shell-link.ts` в этой Wave правил только Ticket 06.
- Гейт — один круг: `VERIFIED` на `5686d0b` ([комментарий в PR #312](https://github.com/IDSAD-XL/worfy/pull/312#issuecomment-6163154648)). Verifier сам: gate fast — код 0, не из кэша; свой contract-файл дважды — 22 из 22; contract-test-ы Ticket-ов 03 и 04 без правок — 91 из 91; e2e четырёх spec-ов Terminal AI под замком — 6 passed; семь своих test-ов на настоящем zsh (команда с TAB, секрет в команде, команда идёт, Enter и Ctrl+C во время паузы, пауза 800 ms); 10 мутантов — 8 красные, один эквивалентный; снимки в обеих темах.
- Правка вне «Где в коде» с разрешения Orchestrator-а: `test/e2e/terminal-ai-suggest.spec.ts:57` — журнал fake фильтруется по `suggest` (без правки test Ticket-а 04 краснел: после принятой команды Ticket 05 спрашивает `next`); строки 58–59 не тронуты.
- Мерж: база main `8ddf434`, head `e12d291`; `GATE_SCOPE=all gate full` — один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `1f479d9`.
- Долги (Noted, [low]): ветку «команда начиналась с TAB» (`src/main/terminal/zsh/rc.d/30-next-command.zsh:32`) не держит ни один test — поведение верное; Ticket («Что делаем», пункт 1) говорит «отменять при первом нажатии», код отменяет при первом изменении строки (`10-assist.zsh:253`) — Ctrl+L во время паузы запрос не отменяет, строка остаётся пустой.
- Suggestion из истории главнее ответа Next command (правило Ticket-а 03) — если первая набранная буква совпала с командой из истории, серым показывается история, остаток предложенной команды теряется (`10-assist.zsh:255-262`). **Решение владельца 2026-10-16:** так и остаётся — Suggestion из истории мгновенный, локальный и состоит из собственных команд владельца. Ticket-а нет.
- Каждая команда в zsh-Terminal-е, после которой 800 ms ничего не набирают, тратит один запрос к Sonnet (Next command включён по умолчанию).
