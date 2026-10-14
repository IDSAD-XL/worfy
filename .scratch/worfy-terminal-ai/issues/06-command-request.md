# 06 — Command request: строка `# …` + Enter и панель Cmd+I вставляют команду, не запуская её

Type: task
Status: done — 2026-10-14, [PR #314](https://github.com/IDSAD-XL/worfy/pull/314)
Branch: worfy-terminal-ai/06
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(c) (строка, которая начинается с `# `, и Enter, или Cmd/Ctrl+I — маленькая панель над Terminal-ом; Sonnet возвращает команду, она вставляется в строку и никогда не запускается сама), пункт 2 (функция по требованию доступна до `rejected`), пункт 3 (контекст, redaction), пункт 4 (сначала zsh) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 6 — ничего не запускается само; пометки доступа каналов — `src/shared/ipc/channels.ts:20-34`, [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6

## Что происходит

- После Ticket-а 03 main умеет заменить строку shell-а: `insert <текст>` — widget ставит `BUFFER`,
  курсор в конец, Enter не нажимает. `status <текст>` показывает короткую серую строку. Это работает
  только у Terminal-а, чей zsh подключился к socket-у: у другого shell-а (bash, PowerShell на Windows)
  вставлять некуда.
- После Ticket-а 02 у main есть `request('request', …)`: Sonnet с `effort: 'low'`, тайм-аут 30 с,
  отказ только при `rejected`.
- Без `setopt INTERACTIVE_COMMENTS` zsh на строку `# найди файлы` отвечает «command not found: #»;
  с ним — молча пропускает.
- Terminal Node: xterm создаётся в `src/renderer/canvas/nodes/TerminalNode.tsx:86`, шапка — `:241-263`,
  экран — `:270`. Cmd+I и Ctrl+I сейчас нигде в worfy не заняты (grep `src`). В терминале Ctrl+I — это
  Tab: отнимать его у shell-а нельзя.
- Сочетания в renderer слушают `metaKey`. Ticket 11 `worfy-windows` (открыт) создаёт
  `src/renderer/platform.ts` с `isPrimary(event)` — ⌘ на Mac, Ctrl на Windows — и подписями сочетаний.
  Terminal AI в этом Epic-е работает только с zsh, на Windows его нет, поэтому Ctrl-ветка панели
  сейчас не нужна.
- Пометки доступа (`src/shared/ipc/channels.ts:20-34`): `project` — работа с Project-ами этой
  Machine, Linked machine-у открыт при включённом доступе; `local` — состояние машины экрана. По
  ADR-0052, пункт 6, Linked machine может в Project-ах всё, кроме действий рабочего стола машины
  Project-а. Окно на Project-е Linked machine-а шлёт каналы `project` на Machine окна
  (`src/renderer/ipc.ts:141-146`).
- Spike 2026-10-09: Sonnet по описанию словами — `find . -type f -size +100M -mtime -7`,
  `lsof -ti tcp:3000 -sTCP:LISTEN | xargs kill`; ответ 1,4–1,9 с.

## Что делаем

1. **Строка `# …`** — `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый), обёртка
   `accept-line`.
   - Строка начинается с `# ` (решётка и пробел) — не исполняется: `ask <id> request <текст>`, серым
     `status` «asking Claude…».
   - Ответ — `insert <команда>`: строка заменяется командой, курсор в конце (spec, «Решено без
     владельца», пункт 5). Enter нажимает пользователь.
   - Любое нажатие до ответа — `cancel <id>`, строка остаётся `# …`.
   - Отказ — серым `status` с причиной («Limits reached until 14:20», «Terminal AI is off»).
   - Строка `# …` в историю zsh не попадает. Без `# ` в начале — `accept-line` как обычно.
2. **Где есть панель.** Только у Terminal-а, чей zsh подключён к socket-у Ticket-а 03 (spec, «Решено
   без владельца», пункт 12). Состояние — канал `terminalAi.request.state {projectId, nodeId}` →
   `{available, busy}` и событие `terminalAi.request.changed`: `available` — zsh подключён и Command
   request включён в Settings, `busy` — идёт команда. В остальных Terminal-ах Cmd+I и Ctrl+I уходят в
   shell, как сейчас.
3. **Панель Cmd+I** — `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый).
   - Terminal в фокусе, `available`, нажато ⌘I без Ctrl — xterm клавишу не получает
     (`attachCustomKeyEventHandler` в `TerminalNode.tsx`), над экраном Terminal-а открывается панель:
     поле, Enter — запрос, Esc — закрыть. Если к claim `src/renderer/platform.ts` Ticket-а 11
     `worfy-windows` уже на main — проверка и подпись `⌘I` берутся из него; иначе — `metaKey`, как у
     остальных сочетаний renderer.
   - Запрос — канал `terminalAi.request {projectId, nodeId, text}`. Main зовёт assist и шлёт
     `insert` в shell этого Terminal-а.
   - Ответ пришёл — панель закрывается, фокус возвращается в Terminal.
   - `busy` — панель пишет «Terminal is busy» и не шлёт. Отказ по Limits — текст в панели.
   - **Реестр сочетаний** `src/shared/shortcuts.ts` — Ticket 11 Epic-а
     [worfy-ui](../../worfy-ui/issues/11-реестр-сочетаний-и-окно-keyboard-shortcuts.md). Решается в
     момент мержа: перед мержем этот Ticket перебазируется на свежий main; если Ticket 11 `worfy-ui`
     уже там, этот вносит ⌘I в реестр в том же PR. Кто вливается последним, тот отвечает за запись.
     Запись — только для Mac (на Windows записи нет — Ctrl+I остаётся Tab-ом оболочки), область —
     Terminal Node с интеграцией zsh; проверка в `TerminalNode.tsx` — через `matches` реестра
     (`src/renderer/shortcuts/match.ts`). То же правило — в Ticket-е 11 `worfy-ui` (spec, примечание
     docs-PR `worfy-ui` после «Решено без владельца»).
4. **Каналы** — `src/shared/ipc/terminal-ai-request.ts`, `src/main/ipc/terminal-ai-request.ts`
   (новые), пометка `project`: панель работает с Terminal-ом Project-а, рабочий стол ей не нужен. С
   экрана Linked machine-а при включённом доступе она работает так же, как строка `# …`, и тратит
   подписку Machine Project-а (решение владельца 8(a)).
5. **Обработчик** — `src/main/terminal-ai/features/command-request.ts` (новый): `ask request` из shell-а
   и вызов из канала. Контекст: текст просьбы, текущая строка (если не пустая), папка, ветка, код
   выхода, последние 20 команд.

**Не входит:** запуск команды — никогда; Fix (Ticket 07); Ctrl+I на Windows — вместе с Terminal AI для
PowerShell, позже.

## Готово, когда

- [x] Contract `test/contract/terminal-ai-request.test.ts` (новый), настоящий zsh, assist — поддельный: `# list big files` + Enter — строка стала ответом fake (`find . -size +100M`), команда не запущена (файла-метки, который она создала бы, нет; main не писал в pty `\r`); в журнале — функция `request`, модель `sonnet`, текст просьбы.
- [x] Тот же contract: нажатие до ответа — `cancel`, строка осталась `# list big files`; `#comment` без пробела — обычный `accept-line`; в `history` строки `# list big files` нет; Limits `rejected` — серым причина со временем сброса, запроса нет; Limits 0,9 окна 5 часов — запрос уходит (функция по требованию).
- [x] Тот же contract: `terminalAi.request.state` — `available` у zsh с интеграцией, не `available` у Terminal-а на `/bin/sh` и при выключенном Command request; `busy` во время `sleep 1`; `terminalAi.request` к Terminal-у без интеграции — ошибка без запроса к assist; каналы помечены `project`.
- [x] Unit (jsdom) `test/unit/terminal-ai-request.test.tsx` (новый): `available` — ⌘I в Terminal открывает панель, Ctrl+I — нет (уходит в xterm); не `available` — ⌘I уходит в xterm, панели нет; Esc закрывает; `busy` — «Terminal is busy».
- [x] e2e `test/e2e/terminal-ai-request.spec.ts` (новый), fake с ответом: `Meta+I` в Terminal Node — панель, текст, Enter — в строке xterm ответ fake, панель закрыта; вывода команды нет, пока test не нажал Enter.
- [ ] (вручную) `WORFY_AGENT=fake pnpm dev`: панель Cmd+I над Terminal-ом в светлой и тёмной теме — `../evidence/06-request-panel-light.png`, `../evidence/06-request-panel-dark.png`. Как проверить: окно worfy. — не проверено: `pnpm dev` с настоящим HOME не запускался; снимки по этим путям сделаны Playwright-ом на собранном приложении с временным HOME.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «`# list big files` + Enter вставляет ответ и ничего не запускает»:
сейчас zsh пытается исполнить `#`. Потом состояние панели, unit панели, e2e. В «Итог» — как падал
первый test и откуда взята проверка ⌘ (`platform.ts` или `metaKey`).

## Где в коде

- `src/main/terminal-ai/features/command-request.ts` (новый)
- `src/main/terminal/zsh/rc.d/40-command-request.zsh` (новый)
- `src/shared/ipc/terminal-ai-request.ts` (новый)
- `src/main/ipc/terminal-ai-request.ts` (новый)
- `src/renderer/canvas/nodes/TerminalNode.tsx`
- `src/renderer/canvas/nodes/TerminalNode.css`
- `src/renderer/canvas/nodes/TerminalAiRequest.tsx` (новый)
- `src/shared/shortcuts.ts` (только если к мержу Ticket 11 worfy-ui уже в main: запись ⌘I)
- `test/contract/terminal-ai-request.test.ts` (новый)
- `test/unit/terminal-ai-request.test.tsx` (новый)
- `test/e2e/terminal-ai-request.spec.ts` (новый)

Только чтение: `src/renderer/platform.ts` Ticket-а 11 `worfy-windows` и `src/renderer/shortcuts/match.ts`
Ticket-а 11 `worfy-ui`, если они к claim влиты.

## Итог

**Первый test.** Contract «`# list big files` + Enter вставляет ответ и ничего не запускает» до
кода падал так: вместо серого «asking Claude…» zsh исполнил строку — в выводе
`zsh: command not found: #`, код выхода 127 (`AssertionError: expected '#\b# list big files…' to match
/…asking Claude…/`, test/contract/terminal-ai-request.test.ts).

**Проверка ⌘.** `src/renderer/platform.ts` (Ticket 11 `worfy-windows`) к claim уже был на main, но
проверка взята из `metaKey`: ⌘I без Ctrl и Alt (и без Shift), подпись «⌘I» — текстом. Так решил
orchestrator в brief-е: Terminal AI сейчас только для zsh, Ctrl-ветка не нужна, а `isPrimary` на
Windows отдал бы Ctrl+I (это Tab оболочки). Текст Ticket-а («если `platform.ts` уже на main — из
него») этим не выполнен — **решено без владельца, подтвердить.** `src/shared/shortcuts.ts` на main
нет — записи ⌘I в реестре нет, её внесёт тот, кто вливается последним (пункт 3 «Что делаем»).

**Как сделано.**

- zsh (`rc.d/40-command-request.zsh`): обёртка `accept-line`; пользовательский widget `accept-line`,
  если он был, вызывается как прежде для всех строк, кроме `# …`. Запросом считается строка `# ` +
  хотя бы один не пробельный символ, в одну строку; `#comment`, `#   ` и вставленный текст из
  нескольких строк уходят в обычный `accept-line`. Строка `# …` в историю не попадает (Enter её не
  принимает, `history` не трогается).
- «Любое нажатие до ответа — `cancel`» сделано hook-ом `line-pre-redraw`: он срабатывает после
  каждого widget-а клавиши и не срабатывает после асинхронных обработчиков socket-а (проверено
  отдельным опытом с `zle -F`), так что `status` и `insert` от main запрос не отменяют.
- **Протокол Ticket-а 03 не менялся.** У `insert` нет id, поэтому ответ, пришедший после `cancel`,
  нельзя было бы отличить от нового. Решение: обработчик main шлёт подряд пустой `status <id>` и
  `insert <команда>` (оба или ни одного), а zsh выбрасывает `insert`, который идёт за пустым
  `status` своего уже закрытого запроса. Ответ панели (`insert` без парного `status` запроса строки)
  принимается всегда.
- Панель: каналы `terminalAi.request.state` / `.changed` / `terminalAi.request` /
  `terminalAi.request.cancel`, все с пометкой `project`. `available` = zsh подключён к socket-у
  Terminal AI и Command request включён в Settings; `busy` = идёт команда. Main слышит подключение
  zsh через новое событие `ShellLink.onConnection` (`src/main/terminal-ai/shell-link.ts`).
- Ни текст просьбы, ни строка, ни ответ модели в журнал и ошибки main не попадают — проверяет
  contract (последний test файла).
- Регрессия, найденная своим прогоном e2e: `position: relative` на `.w-terminal` вместе с его
  `overflow: hidden` обрезал ручки изменения размера Node (`test/e2e/terminal.spec.ts`, изменение
  размера). Панель теперь висит от якоря нулевой высоты между шапкой и экраном, `.w-terminal` не
  тронут.

**Решено без владельца, подтвердить:**

1. Проверка ⌘ — `metaKey`, не `platform.ts` (см. выше).
2. Панель отправляет контекст без текущей строки shell-а: main не может прочитать `BUFFER` zsh. Строка
   `# …` отправляет слова, контекст строки пустой (строкой была сама просьба).
3. Добавлен канал `terminalAi.request.cancel`: Esc в панели во время ожидания и закрытие Node
   отменяют запрос, ответ в строку не приходит («Cancelled»).
4. Command request выключен в Settings или zsh не подключён — `# …` + Enter работает как обычный
   `accept-line` (zsh молча пропускает комментарий или пишет «command not found: #», как было), а не
   пишет «Terminal AI is off». Этот текст показывается, только если main ответил отказом `off`.
5. Тексты отказов (англ.): «Limits reached until 14:20» (другой день — «Oct 15, 14:20»), «Terminal AI
   is off», «Terminal is busy», «Claude did not answer in time», «Claude had no command for that»,
   «Claude could not answer», «The shell is not ready yet».
6. Панель накрывает верх экрана (первую строку shell-а) — она закрывается, как только ответ пришёл.

**Проверки (head после rebase на 1c1beadd):**

- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, `pnpm test` — exit 0 (238 файлов, 5059 tests
  прошли, 66 пропущены); gate fast — exit 0, «зелено (fast)».
- Свой contract три раза подряд: 26/26 каждый раз, 14,35 / 14,36 / 14,46 с, exit 0.
- e2e на собранном приложении, по одному под общей блокировкой: свой spec вместе с
  `terminal-ai-history`, `terminal-ai-suggest`, `terminal` — 12 passed; раньше на том же коде, кроме
  удалённой лишней строки zsh, — ещё `focus`, `wheel-over-nodes` (22 passed) и `first-run`,
  `linked-machines`, `focus-sidebar` (19 passed): они меряют экран, а Node получил панель.
- Mutation testing: 43 мутанта на копиях в своём каталоге, контрольные суммы файлов после прогона
  совпали. Первый круг — 37 убиты, 6 выжили. Под 4 выживших дописаны tests (поздний отказ и
  вставка панели сразу после выброшенного ответа; ответ модели, пришедший после отмены панелью;
  zsh, подключившийся позже окна). Мутант «Settings не спрашиваются» оказался эквивалентным:
  `_worfy_assist_ask` сам не шлёт `ask` при выключенной функции — лишняя строка удалена. Мутант
  «ушедшее окно не удаляется из подписчиков» эквивалентен по отдельности: второй guard
  (`isDestroyed()` перед отправкой) закрывает то же; оба вместе ломают test состояния (проверено).
  Итог: из 42 мутантов, оставшихся применимыми, убит 41; выжил один, эквивалентный.
- Ticket-ы 03/04 (`terminal-ai-zle`, `terminal-ai-suggest`, `terminal-shell-integration`, e2e
  `terminal-ai-history`, `terminal-ai-suggest`) зелёные без правок.

Снимки панели — `../evidence/06-request-panel-light.png`, `../evidence/06-request-panel-dark.png`:
Playwright на собранном приложении с временным HOME (`WORFY_EVIDENCE_DIR`, только свой spec), обе
просмотрены. Контраст текста панели к фону ≥ 4,5:1 в обеих темах проверяет сам e2e.

Ручной пункт (`WORFY_AGENT=fake pnpm dev`) — не проверено: `pnpm dev` с настоящим HOME по brief-у
не запускался; снимки сделаны Playwright-ом, не в `pnpm dev`. `GATE_SCOPE=all` gate full — за
orchestrator-ом.

### Gate оркестратора (2026-10-14)

- Wave Epic-а под Autopilot; 06 роздан после мержа 04 и шёл параллельно с 05. Решения Orchestrator-а: проверка ⌘I — голый `metaKey` без Ctrl, Alt и Shift, не `isPrimary`/`isMac()` из `src/renderer/platform.ts` (`isPrimary` на Windows — Ctrl, а Ctrl+I в терминале — Tab; ветка `isMac()` сделала бы PR платформенным, ADR-0056, пункт 2) — расходится с текстом Ticket-а, **решено без владельца, подтвердить**; `src/main/terminal-ai/shell-link.ts` в этой Wave правил только этот Ticket; записи ⌘I в `src/shared/shortcuts.ts` нет — файла на main нет (Ticket 11 `worfy-ui` не влит).
- Гейт — один круг: `VERIFIED` на `75a2fcc` ([комментарий в PR #314](https://github.com/IDSAD-XL/worfy/pull/314#issuecomment-6163535632)). Verifier сам: gate fast из кэша, поэтому `pnpm lint`, `pnpm typecheck`, `pnpm test` отдельно — код 0; свой contract-файл дважды — 26 из 26; unit панели — код 0; contract-test-ы Ticket-ов 03 и 04 без правок — код 0; e2e `terminal-ai-request`, `terminal`, `focus` под замком — 14 passed; 11 мутантов — все красные; на настоящем zsh запрос не отменяют изменение размера pty, конец фоновой задачи, `zle -R` от main, часы в prompt-е, чужой async-обработчик, а ← отменяет; повторный `source` оставляет одну обёртку; выбрасывается только `insert` сразу за пустым `status` закрытого запроса; веток по платформе нет; снимки в обеих темах (панель, отказ по Limits, «Terminal is busy»).
- Мерж: база main `1f479d9` (с Ticket-ом 05 — скрипты 05 и 06 впервые вместе), head `17d6a0b`; `GATE_SCOPE=all gate full` — один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `fcaa18e`.
- На решение владельца (Consider, [low]):
  - панель ⌘I не отправляет модели текущую строку shell-а (`src/main/ipc/terminal-ai-request.ts:120` передаёт пустую строку), хотя Ticket (пункт 5) и spec её требуют: main видит строку только в `ask`; исправить можно расширением протокола Ticket-а 03 или чтением буфера xterm в renderer;
  - при выключенном Command request строка `# слова` + Enter — обычный `accept-line` (`40-command-request.zsh:32-34`): zsh может написать «command not found: #», слова попадают в историю; Ticket ждал серое «Terminal AI is off»; так сохраняются обычные строки-комментарии;
  - открытая панель закрывает первую строку Terminal-а (`TerminalNode.css:113`): в «Terminal is busy» не видно, какая команда идёт.
