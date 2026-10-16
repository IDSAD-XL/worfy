# 04 — Suggestion от Haiku, когда история молчит: после паузы, с отменой при наборе

Type: task
Status: done — 2026-10-14, [PR #310](https://github.com/IDSAD-XL/worfy/pull/310)
Blocked by: 02, 03
Source: решения владельца 2026-10-09: пункт 1(a) (если история молчит — после паузы Haiku с выключенным thinking; ответ может прийти через 1,5–5 с и отменяется или отбрасывается, если пользователь печатает дальше), пункт 2 (автоматическая функция — только после паузы, выключается сама по Limits), пункт 3 (контекст без вывода и переменных окружения, redaction, не во время команды, не для строки с пробелом в начале) ([spec.md](../spec.md)); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункты 3–5; [evidence spike-а](../evidence/spike-задержки-2026-10-09.md)

## Что происходит

- После Ticket-а 03 Suggestion приходит только из истории. Протокол shell ↔ main, маршрут `ask` по
  функциям (`src/main/terminal-ai/features/*.ts`) и общие функции widget-а описаны в «Итог»
  Ticket-а 03.
- После Ticket-а 02 у main есть `request('suggest', …)`: Haiku с выключенным thinking, тайм-аут
  5 с, отказ по Limits и Settings, redaction, отмена закрывает процесс запроса.
- Spike 2026-10-09 ([evidence](../evidence/spike-задержки-2026-10-09.md)): Haiku без thinking — 16
  запросов (`results.jsonl`, строки 7–9 и 39–47 с `thinking: {type: 'disabled'}`, 22–26 после
  `setMaxThinkingTokens(0)`): первый текст 682–5421 ms, медиана ~1,3 с; один из 16 — дольше 5 с,
  тайм-аута Suggestion. Ответ — 4–11 токенов.
- Там же два прогона просили вернуть только текст после курсора. С просьбой в системном prompt-е
  (8 строк) Haiku в 6 случаях из 8 потерял пробел перед новым словом: `npm run` → `dev`,
  `kubectl get pods -n` → `default`, `ssh -i ~/.ssh/id_ed25519` → `user@hostname`,
  `tar -czf backup.tar.gz` → `.`; дописанное к строке, это сломанные команды (`npm rundev`). С
  просьбой в сообщении пользователя пробел сохранён во всех 7 нужных случаях. Верно в обоих —
  `grep -rn "TODO" --include` → `="*.ts"`; на `git log --one` с системным prompt-ом — неверно
  (`line-format=%h %s`), с просьбой в сообщении — верно (`line`).
- После Ticket-а 01 main знает папку, код выхода, последние 20 команд и идёт ли команда.

## Что делаем

1. **Widget** — `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh` (новый).
   - История молчит, строка не пустая и не начинается с пробела — через 600 ms без нажатий
     `ask <id> suggest <строка>` (spec, «Решено без владельца», пункт 2).
   - Новое нажатие до ответа — `cancel <id>`.
   - `show` с текущим id: строка та же — серый текст. Пользователь допечатал начало ответа — серым
     остаётся остаток. Иначе ответ отбрасывается.
   - Пока ждём — ничего не показывается: серый текст появляется только с ответом.
2. **Обработчик** — `src/main/terminal-ai/features/suggest.ts` (новый).
   - Собирает контекст: строка, папка, последние 20 команд, ветка, код выхода последней команды;
     признаки «идёт команда» и «альтернативный экран» — из состояния Ticket-а 01.
   - Зовёт `request('suggest', …)`. Модель возвращает **всю командную строку**, а не хвост (spec,
     «Решено без владельца», пункт 11): так пробел между набранным и новым словом не теряется.
     Серым показывается остаток — ответ без набранного. Ответ не начинается с набранного — не
     показывается. Пустой ответ, отказ или тайм-аут — тоже.
3. **Отказ молча.** Limits выше порога, функция выключена в Settings, процесс не стартовал —
   Suggestion из истории работает дальше, в Terminal ничего не печатается.

**Не входит:** Next command (Ticket 05) — Suggestion на пустой строке после команды.

## Готово, когда

- [ ] Contract `test/contract/terminal-ai-suggest.test.ts` (новый), остаток по ответу: строки spike-а — `npm run` и ответ `npm run dev` дают серый ` dev` (с пробелом); ответ `npm rundev` или `dev` не показывается; `grep -rn "TODO" --include` и ответ `grep -rn "TODO" --include="*.ts"` дают `="*.ts"`.
- [x] Тот же contract, настоящий zsh, assist — поддельный, ответ с задержкой: ввод `docker run --rm -it ub` без истории, ответ fake `docker run --rm -it ubuntu bash` — через паузу серый `untu bash`; ввод во время ожидания — `cancel`, старый ответ не показан; допечатанное `un` совпало с началом ответа — серым остался `tu bash`; набор быстрее паузы — ни одного запроса.
- [x] Тот же contract: в журнале запросов — строка, папка, не больше 20 команд, ветка, код выхода; вывода команд и переменных окружения нет; в истории `export GITHUB_TOKEN=ghp_…` — в журнале `[redacted]`.
- [x] Тот же contract: Limits `five_hour` 0,85 — запросов нет, Suggestion из истории работает; «Ask Claude when history has nothing» выключен — запросов нет; строка с пробелом в начале — запросов нет.
- [x] Тот же contract: `cat` ждёт ввода (идёт команда), набрано `ab` — запросов нет.
- [x] e2e `test/e2e/terminal-ai-suggest.spec.ts` (новый), fake с ответом: строка, которой нет в истории (уникальная метка), — серый ответ виден в буфере xterm; → принимает; в журнале fake один запрос `suggest`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально — exit 0.

## Тесты

Сначала падающий test — contract «без истории через паузу приходит серый ответ модели»: обработчика
`suggest` ещё нет. Поддельный assist — параметром сервиса (Ticket 02), подписка не тратится. Паузы в
contract — короткие, через параметр; в «Итог» — итоговые числа паузы и тайм-аута и как падал первый
test.

## Где в коде

- `src/main/terminal-ai/features/suggest.ts` (новый)
- `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh` (новый)
- `test/contract/terminal-ai-suggest.test.ts` (новый)
- `test/e2e/terminal-ai-suggest.spec.ts` (новый)

## Итог

2026-10-14. Ветка `worfy-terminal-ai/04`.

### Как падал первый test

`test/contract/terminal-ai-suggest.test.ts`, «without history, after the pause, the answer of the model is shown
in grey; → takes it»:

1. Без обработчика: файл не загрузился — `Cannot find module '/src/main/terminal-ai/features/suggest'`.
2. С обработчиком, но без widget-а: `AssertionError: expected [] to include 'docker run --rm -it ub'` — shell ни
   о чём не спросил main за 10 с. После `20-suggest-ai.zsh` — зелёный.

### Числа

- Пауза — **600 ms** без нажатий (как в spec, «Решено без владельца», п. 2), считается от последнего изменения
  строки. Test на паузе самого widget-а: запрос пришёл не раньше чем через 600 ms после последней клавиши.
- Тайм-аут — **5 с**: `FEATURE_TIMEOUT_MS.suggest` Ticket-а 02, не менял.
- В contract пауза короче: 150 ms (отдельные test-ы — 400, 1000, 1500, 2000, 3000 ms). Её задаёт тестовый файл
  `rc.d/15-test-pause.zsh` (переменная `__worfy_suggest_pause_ms`), который читается раньше widget-а.

### Как устроено

- **Widget** `src/main/terminal/zsh/rc.d/20-suggest-ai.zsh`. Функция `_worfy_suggest_line` стоит в
  `__worfy_assist_line_hooks` Ticket-а 03. История промолчала (`$1` пустой) — сдвигает момент запроса на
  «сейчас + пауза» и заводит таймер, если он ещё не идёт.
- **Таймер.** Один на shell: subshell `<(print $sysparams[pid]; zselect -t …)` на pipe, его ждёт `zle -F`.
  Внешняя программа не запускается. Клавиши во время паузы только сдвигают момент. Таймер кончился раньше
  момента — следующий ждёт остаток. Enter (`line-finish`), Ctrl+C, пустая строка и строка, о которой не
  спрашивают, сразу закрывают pipe и завершают subshell (`kill -TERM`). Запущенная команда не получает ни pipe,
  ни живого subshell-а (test). Таймер, который дождался своего момента, тоже закрывает свой pipe (test).
- **Esc** (второй круг, по вердикту gate-а). `10-assist.zsh` вешает Esc в keymap emacs и viins на widget-ы,
  которые зовут функцию `_worfy_assist_escape` по имени. Widget 04 оборачивает эту функцию: сначала
  `_worfy_suggest_stop`, потом прежнее тело, сохранённое как `_worfy_suggest_escape_was`. Обёртка ставится один
  раз, даже если скрипт прочитан повторно. Сам `10-assist.zsh` не менялся. Что проверено test-ами:
  - Esc во время паузы: таймера больше нет, модель не спрашивают, серого текста нет. Следующая клавиша,
    которая меняет строку, снова заводит паузу.
  - То же в `bindkey -v`, и Esc по-прежнему переводит в режим команд: `x` удаляет символ под курсором.
  - Esc при показанном ответе модели скрывает его, как раньше, и новых запросов нет.
  - Esc после паузы, пока модель отвечает: `ask` отменяется (`cancel`), поздний ответ не показывается, в журнале
    fake запрос `cancelled: true`.
  - Сочетание: zsh запускает widget Esc только через KEYTIMEOUT (по умолчанию 400 ms). Если пауза кончается
    внутри этого окна, `ask` уходит до Esc. Модель отвечает медленно — Esc его отменяет, как в предыдущем случае.
    Модель отвечает быстрее (verifier второго круга: ответ за 0–150 ms) — запрос не отменён, ответ на миг
    рисуется серым и исчезает, когда срабатывает widget Esc; серый текст на экране не остаётся.
- **Не спрашивает:** пустую строку; строку с пробелом в начале; строку `# …`; строку, которую дала не клавиатура
  (см. ниже); строку, для которой история дала Suggestion; строку, которая продолжает уже показанный
  Suggestion (`kept`). Пока ждём — ничего не рисуется. Ответ рисует `_worfy_assist_on_show` Ticket-а 03, если
  строка та же; любое её изменение отменяет `ask` там же.
- **Обработчик** `src/main/terminal-ai/features/suggest.ts`. Вход запроса — `terminalAiInput()`
  (`src/main/terminal-ai/input.ts`), затем `assist.request('suggest', input, ask.signal)`. Серым показывается
  `suggestionRest(набранное, ответ)`: ответ длиннее набранного и начинается с него — остаток; иначе ничего.
  Пустую строку и строку из нескольких строк main не спрашивает. Отказ сервиса (Limits, Settings, идёт команда,
  альтернативный экран, процесс не стартовал, тайм-аут, пустой ответ) — тишина: ни `status`, ни строки в лог.

### Что заложено для Ticket-ов 05 и 06

- `src/main/terminal-ai/input.ts`:
  `terminalAiInput(state: ShellState, line: string, extra?: TerminalAiInputExtra): TerminalAiInput | null`,
  где `TerminalAiInputExtra = Partial<Pick<TerminalAiInput, 'request' | 'output'>>`. Возвращает папку,
  копию команд, код выхода, `commandRunning` и `alternateScreen` (из `altScreen`). Если папка неизвестна
  (`cwd === null`) — `null`, и запроса нет. Ветку не кладёт: её находит assist. Вывод команды кладёт, только
  если его передал вызывающий. Unit — `test/unit/terminal-ai-input.test.ts`.
- `test/e2e/terminal-ai-helpers.ts`:
  - `terminalAiSandbox()` → `{ scratch, dataDir, root, home, env, answers(list), requests(), remove() }`:
    временный `HOME` с `.zshrc`, Project `alpha`, файлы ответов и журнала fake; `env` передаётся в
    `launchApp({ env })`;
  - `openTerminal(window)` — новый Terminal Node с первым prompt-ом `e2e% `, в фокусе;
  - `screenText(node)`, `editedLine(node)`, `greyText(node)` → `{ text, color }`, `typedColor(node)`;
  - константы `ZSH`, `TERMINAL_AI_PROJECT`, `TERMINAL_AI_PROMPT`.

  `greyText` берёт цвет с серой ячейки не под курсором. В окне с фокусом xterm.js мигает блочным курсором, и
  полсекунды из каждой секунды ячейка под ним окрашена цветом курсора, то есть цветом текста. Мой e2e на этом
  упал в первом прогоне.
- **Признак вставленной строки** (для 06): переменная `__worfy_suggest_given` — строка, которую дала не
  клавиатура, пока она стоит без изменений. Widget ставит её сам, если строка изменилась внутри
  `_worfy_assist_on_insert` (сообщение `insert`), `_worfy_assist_take` (→) или `_worfy_assist_take_word`
  (Alt+→). Проверка — по `funcstack`. Скрипту 06 ничего делать не нужно, если строку ставит main через
  `insert`. Если скрипт ставит строку сам, он присваивает `__worfy_suggest_given=$BUFFER` до
  `_worfy_assist_changed` (test «a line main put there with insert…», клавиша Ctrl+X p тестового скрипта).
- Строка, которая начинается с `# `, модель Suggestion не спрашивает (test).

### Правки test-ов вне «Где в коде» (по brief-у)

- `test/contract/terminal-ai-zle.test.ts`: тестовый скрипт `withAskingScript` теперь спрашивает под именем
  `probe`. Такого имени нет ни у одной функции Terminal AI. Его обработчик — `./features/probe.ts`. Настройки
  этих test-ов включают из настоящих функций только Suggestion из истории, а после подключения test шлёт shell-у
  `config history probe`. Так скрипты функций (`20-suggest-ai.zsh`, будущие `30-…`, `40-…`) в этих test-ах
  молчат и не отменяют `ask` тестового скрипта. Ни одно ожидание не ослаблено: test-ы проверяют то же,
  только под другим именем функции.
  - Риск был настоящим: исходный файл Ticket-а 03 вместе с моим widget-ом дал 1 красный из 36 — «status is a
    grey note that → does not take…», `expected false to be true`. Через 600 ms widget спросил `suggest`, и
    `ask` теста отменился.
  - Test-ы :749 и :888 (свой скрипт спрашивает `suggest`) не менял: они проверяют только `toContain` и
    предупреждение, лишние `ask` от скриптов функций их не задевают.
- `test/contract/terminal-shell-integration.test.ts:438`: список `rc.d` в `ZDOTDIR` теперь сравнивается со
  списком `*.zsh` в `src/main/terminal/zsh/rc.d`, прочитанным в test-е. Изменена только эта строка.

### Решено без владельца, подтверждено владельцем 2026-10-16

1. **Первый пункт «Готово, когда» выполнен не целиком — оставлен `[ ]`.** Ответ `npm rundev` на набранное
   `npm run` показывается: серым `dev`.
   - Почему: по двум строкам его не отличить от `docker run --rm -it ub` → `docker run --rm -it ubuntu bash`
     (второй пункт) и `git log --one` → `git log --oneline` (spike). Там тоже буква продолжает букву, а ответ
     верный. Правило, которое отбросит `npm rundev`, отбросит и их.
   - Модель возвращает всю строку, хвост к набранному не приклеивается никогда. Поэтому `npm rundev` здесь —
     собственная строка модели, а не склейка.
   - Решение Orchestrator-а 2026-10-14 — вариант «простое правило». Остальное из пункта проверено test-ом: ответ
     `dev` не показывается, `npm run dev` даёт ` dev`, `grep … --include` даёт `="*.ts"`. `npm rundev` → `dev`
     закреплён отдельным test-ом с объяснением.
   - Правило — одна чистая функция `suggestionRest` (`src/main/terminal-ai/features/suggest.ts`); менять его там.
2. Строку, принятую из Suggestion целиком (→ или Alt+→ до конца), модель повторно не спрашивает: это уже её
   ответ или команда из истории. Иначе каждое → тратило бы ещё один запрос.
3. Строку из нескольких строк main не отправляет: ответ — одна строка, начинаться с такой строки он не может.
4. Паузу можно задать переменной `__worfy_suggest_pause_ms` до widget-а. Это делают test-ы, но может и
   `.zshrc` пользователя: он читается раньше `rc.d`.

### Долги Ticket-а 03 и что они задевают

- `config` позже первого prompt-а: пока настроек нет, `suggest` выключен, и таймер не заводится. Когда `config`
  приходит, `_worfy_assist_on_config` зовёт хуки, и строка, которая уже стоит, получает свою паузу (test «with
  "Ask Claude…" off… turned on, it asks about the line that stands»).
- Программа в Terminal-е наследует соединение shell-а: не чинил. Свой pipe таймера widget закрывает до запуска
  команды (test).

### Mutation testing

Скрипт `/tmp/worfy-tai-w3/impl-04/mut/run.mjs` — свой worktree, файл восстанавливается из копии, в конце
сверяются контрольные суммы. 48 мутантов: `suggest.ts` — 11, `input.ts` — 11, `20-suggest-ai.zsh` — 26.

- Убиты 47. Суммы всех трёх файлов после прогонов совпали с копиями.
- S7 («cancel не доходит до запроса») сначала выжил: ответ fake с задержкой 5 с совпадал с тайм-аутом. Задержка
  в test-е — 1,5 с, мутант убит.
- Z7 («таймер для пустой строки») не убить: при пустой строке `__worfy_suggest_given` тоже пустая, и проверка
  `$BUFFER != "$__worfy_suggest_given"` уже не пускает её. Мутант эквивалентный, проверку `-n $BUFFER`
  оставил для ясности.
- Второй круг (Esc), скрипт `/tmp/worfy-tai-w3/impl-04/mut2/run.sh`, 3 мутанта обёртки, все убиты; сумма
  файла после прогона совпала с копией:
  - E1 — обёртка не останавливает таймер (2 красных test-а);
  - E2 — обёртки нет совсем (2 красных);
  - E3 — обёртка не зовёт прежнее тело Esc (3 красных).
  Мутант «без проверки, что обёртка уже стоит» test-ом не покрыт: скрипт читается один раз на shell. Проверка
  нужна только при повторном `source` — без неё был бы бесконечный вызов.

### Проверки

Числа — с итогового head ветки (после rebase на `975de42a` и правки Esc):

- `pnpm lint` — exit 0, `pnpm typecheck` — exit 0, `pnpm test` — exit 0: 236 файлов (6 пропущено), 4986
  test-ов (66 пропущено).
- Contract `test/contract/terminal-ai-suggest.test.ts` — 35 test-ов, три прогона подряд, все exit 0, около 54 с
  каждый.
- `test/contract/terminal-ai-zle.test.ts` вместе с `test/contract/terminal-shell-integration.test.ts` — exit 0,
  56 test-ов.
- Новые test-ы Esc до правки: 2 красных — «Esc while the line waits…» (`timer` не пустой) и «Esc in the vi
  keymap…» (`expected [ 'echo worfy-vi-esc' ] to deeply equal []`). После правки — 4 из 4 зелёные.
- `gate.sh fast` — в отчёте implementer-а.
- e2e под `/tmp/worfy-e2e.lock`, консоль у `alexey`:
  `playwright test test/e2e/terminal-ai-suggest.spec.ts test/e2e/terminal-ai-history.spec.ts` — exit 0, 2 passed.
  - Первый прогон был красным: «grey is another colour than what was typed». Цвет брался с ячейки под
    мигающим курсором; исправлен helper `greyText`.
- `GATE_SCOPE=all` gate full — не запускал: его запускает Orchestrator.

### Не проверено

- Пауза, которая кончается внутри KEYTIMEOUT после Esc, test-ом не воспроизведена: test-а на это нет. Итог
  такого случая — см. «Esc» выше: при быстрой модели ответ мелькает серым до срабатывания Esc.
- zsh старше 5.9 и zsh без модуля `zsh/zselect`: без модуля widget молча не включается, test-а на это нет.
- Настоящий Haiku — только fake; вживую — Ticket 09.

### Gate оркестратора (2026-10-14)

- Wave Epic-а под Autopilot (Ticket-ы 04, 05, 06, 08); 04 шёл первым вместе с 08: он заложил общее для 05 и 06 — `src/main/terminal-ai/input.ts`, `test/e2e/terminal-ai-helpers.ts`, ожидание `rc.d` без имён файлов и test-ы Ticket-а 03, не зависящие от скриптов функций.
- Гейт — два круга. Круг 1 — `REJECTED` на `2b5803f` ([комментарий в PR #310](https://github.com/IDSAD-XL/worfy/pull/310#issuecomment-6161497913)): Esc во время паузы не останавливал таймер — модель спрашивали и после того, как Esc скрыл серый текст, в режиме vi почти на каждой строке. Круг 2, только диф доработки `de97c01..a745a67`, — `VERIFIED; debt` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/310#issuecomment-6161913575)): обёртка `_worfy_assist_escape` в `20-suggest-ai.zsh`; три мутанта обёртки verifier-а красные; повторный `source` оставляет одну обёртку.
- Мерж: база main `975de42` (с Ticket-ом 08), head `a745a67`; `GATE_SCOPE=all gate full` — один запуск под замком e2e, код 0, не из кэша, строка `[gate] зелено (full)` с `test:e2e` и `test:package`; предупреждение gate: `test/contract/terminal-ai-suggest.test.ts` — 1066 строк при пороге 1000; CI зелёный, CLEAN; влит `68f323c`.
- **Решено без владельца, подтверждено владельцем 2026-10-16:** первый пункт «Готово, когда» оставлен `[ ]` — ответ `npm rundev` на набранное `npm run` показывается серым `dev`: по двум строкам его не отличить от `ub` → `ubuntu bash` из второго пункта; правило — одна чистая функция `suggestionRest` в `src/main/terminal-ai/features/suggest.ts`.
- Долги (Noted, [low]): окно KEYTIMEOUT — при быстрой модели ответ мелькает серым после Esc (см. «Esc» выше); нет test-а на повторный `source` скрипта; test отмены (`test/contract/terminal-ai-suggest.test.ts:602-628`) не доказывает, что `cancel` шлёт сам набор — код держит test Ticket-а 03; `terminalAiInput` не знает, что последняя команда начиналась с пробела (`src/main/terminal/osc.ts:74-77`) — Ticket 05 решил это в скрипте zsh.

Решение владельца 2026-10-16: все пункты «Решено без владельца» этого Ticket-а приняты пакетом.
