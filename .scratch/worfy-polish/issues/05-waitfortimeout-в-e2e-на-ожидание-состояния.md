# 05 — 32 `waitForTimeout` в e2e: ожидание состояния или обоснованное окно «ничего не случилось»

Type: task
Status: done 2026-10-15
PR: #356
Blocked by: —
Source: [spec.md](../spec.md), кандидат R5; `HANDOFF.md`, «Риски и долги» (нестабильные e2e, ложные
таймауты под нагрузкой); [docs/lessons/agents.md](../../../docs/lessons/agents.md).

## Что происходит

- В `test/e2e` 32 вызова `waitForTimeout` в 18 файлах (`grep -rn waitForTimeout test/e2e`, main
  `fff11ba`): `card-runtime` и `ship-ticket` — по 5; `focus`, `terminal-ai-fix`, `linked-cards`,
  `handoff`, `external-session`, `epic-frame` — по 2; остальные десять — по 1.
- Пауза на время бывает двух видов. **Ожидание события** («подождать, пока отрисуется») под нагрузкой
  то коротка (test красный), то лишняя (test медленный). **Окно «ничего не случилось»** («за 500 ms
  файл не изменился») — законная пауза: доказать отсутствие события иначе нельзя.
- С Ticket-ом 04 общих файлов нет: три его файла (`edges`, `binding`, `autopilot`) `waitForTimeout` не
  зовут.

## Что делаем

1. Каждый из 32 вызовов — в одну из двух групп.
2. **Ожидание события** → ожидание состояния: `expect(locator).toBeVisible()` / `toHaveText` /
   `toHaveAttribute`, `expect.poll(...)`, `waitForFunction`, событие окна или файла.
3. **Окно «ничего не случилось»** остаётся, но (а) по возможности короче за счёт «маяка»: после
   проверяемого действия сделать второе, которое точно даёт событие, дождаться его и тогда проверить, что
   первого не было; (б) если маяка нет — комментарий над вызовом: что доказывает пауза и почему её
   длина достаточна.
4. Таблица «файл:строка → группа → что стало» — в «Итог».

## Готово, когда

- [x] `grep -rn waitForTimeout test/e2e` — только вызовы с комментарием-обоснованием над ними; их число
      и список — в «Итог».
- [x] Каждый изменённый файл зелёный 5 из 5 под нагрузкой (половина ядер `yes > /dev/null`, как в
      Ticket-е 04); вывод с exit code — в «Итог». Кроме `packaged.spec.ts`: в нём только комментарий,
      не прогонялся (см. «Итог»).
- [ ] (не проверено целиком: только 17 spec-ов) Общее время `pnpm test:e2e` не выросло (до и после — в «Итог»). Замер — по 17 изменённым spec-ам,
      не по всему `pnpm test:e2e`: целиком его implementer-ам Wave запускать нельзя.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный. lint, typecheck, test и gate fast — exit 0; gate full —
      шаг оркестратора; CI — в PR.

## Тесты

- Сами e2e. «Сначала красный» здесь — замер: прогон под нагрузкой до правки, сколько красных
  (допустимо «0 из 5» — тогда правка только убирает лишнее время).
- Мутант на группу «окно»: убрать паузу у одного окна — test должен остаться осмысленным (проверка
  «не было» после маяка) или стать красным, если маяка нет; что вышло — в «Итог».

## Где в коде

- `test/e2e/card-runtime.spec.ts`
- `test/e2e/epic-frame-undo.spec.ts`
- `test/e2e/wheel-over-nodes.spec.ts`
- `test/e2e/focus.spec.ts`
- `test/e2e/done-stack.spec.ts`
- `test/e2e/terminal-ai-fix.spec.ts`
- `test/e2e/terminal-ai-suggest.spec.ts`
- `test/e2e/terminal-ai-next-command.spec.ts`
- `test/e2e/card-drag.spec.ts`
- `test/e2e/linked-cards.spec.ts`
- `test/e2e/handoff.spec.ts`
- `test/e2e/terminal-ai-request.spec.ts`
- `test/e2e/external-session.spec.ts`
- `test/e2e/ship-ticket.spec.ts`
- `test/e2e/subagent-tree.spec.ts`
- `test/e2e/packaged.spec.ts`
- `test/e2e/session-controls.spec.ts`
- `test/e2e/epic-frame.spec.ts`
- `test/e2e/wait.ts` (новый: общие helper-ы ожидания состояния; дописан при claim)

Только читать (не в списке, чтобы не давать ложных пересечений Wave): `test/e2e/helpers.ts` — если
нужен общий helper ожидания, он пишется в своём файле `test/e2e/wait.ts` (исполнитель дописывает его в
список при claim), а не в `helpers.ts`: его правят Ticket-ы 04 и 06.

## Вне скоупа

- `test/e2e/edges.spec.ts`, `binding.spec.ts`, `autopilot.spec.ts` — Ticket 04.
- Паузы в `test/contract` — кандидат R7 отброшен (spec).
- `packaged.spec.ts` гоняется только с `@packaged`; его пауза правится, но прогон — по правилам этого test-а.

## Итог

Ветка `worfy-polish/05`. Общие helper-ы ожидания — новый `test/e2e/wait.ts`:

- `nextFrames(window, n)` — renderer нарисовал ещё `n` кадров;
- `settled(window)` — renderer догнал main: два кадра, запрос `app.version` в main, ещё два кадра.
  Сообщения между окном и main идут по порядку в обе стороны, поэтому ответ приходит после ответов
  на все прежние запросы renderer-а и после всех событий, отправленных main до него. Таймер в main,
  watcher файлов и другой процесс этим не покрыты — для них нужен свой маяк;
- `shellCaughtUp(window, node, line)` — shell Terminal-а прочёл всё, что ему записали: набранная
  `x` появляется в конце строки, затем стирается Backspace.

### Таблица: файл:строка (main `12b46d8`) → группа → что стало

| Место | Группа | Что стало |
| --- | --- | --- |
| card-runtime:118 | ожидание события (watch Card готов) | маяк: первая перезапись `index.html`, ожидание её текста; вторая перезапись засекается, как раньше |
| card-runtime:165 | окно (навигация в чужую Card) | оставлено 300 ms, комментарий: main отказывает в `will-frame-navigate` и ничего не шлёт обратно |
| card-runtime:181 | ожидание события (отказ навигаций https и file://) | ожидание: Card c1 ушла на error page; сообщение Chromium в console «Not allowed to load local resource: file:///etc/hosts» для c2 (c2 остаётся на своей странице — проверено прогоном) |
| card-runtime:199 | окно (окно, открытое `window.open`) | состояние main: число `webContents` сразу после `window.open` не выросло (main отвечает внутри вызова) |
| card-runtime:207 | ожидание уже наступившего | пауза убрана: `top.location` бросил `SecurityError`, навигация не начиналась |
| wheel-over-nodes:333 | окно (стрелки от колеса) | маяк: Terminal активен, набранная метка `MARK` дошла до `cat` после всего, что колесо послало раньше |
| terminal-ai-fix:94 | окно (команда не запустилась) | маяк `shellCaughtUp` |
| terminal-ai-fix:108 | окно (кнопка Fix не вернулась) | ожидание нового prompt (shell сообщает о конце команды до него) + `settled` |
| epic-frame-undo:152 | окно (второго undo не было) | `settled` |
| epic-frame:422 | окно (drag Ticket-а ничего не сохранил) | `settled` |
| epic-frame:557 | окно (Node-ы не сдвинуты) | `settled`: frame уже поставлен, сдвиг ушёл бы в том же проходе |
| focus:95 | ожидание события (запись `layout.json` после старта) | main пишет файл только после операции или сразу при upgrade; при `revision > 0` — ожидание, пока файл совпадёт с Layout main |
| focus:208 | окно (ничего не записано) | `settled` + `revision` не изменился: без операции записи нет; константа `SAVE_SETTLE_MS` удалена |
| done-stack:213 | окно (⌘Z не свернул стопку) | `settled` |
| terminal-ai-suggest:56 | окно (лишнего запроса к модели нет) | маяк: вторая строка `true <метка> be` со своим ответом; после её серого текста запросов ровно два — о набранной строке и о маяке |
| linked-cards:216 | ожидание события (watch Card на B готов) | маяк: первая перезапись, ожидание её `#title` |
| linked-cards:263 | окно (навигация из Card B) | оставлено 300 ms, комментарий; слабое место — ниже |
| handoff:63 | опрос с паузой 16 ms | `expect.poll` с `intervals: [16]` |
| handoff:89 | окно (settle-чтения watcher-а прошли) | оставлено, комментарий дополнен: чтения неизменённого файла ничего не меняют, знака их конца нет |
| terminal-ai-request:122 | окно (команда не запустилась) | маяк `shellCaughtUp`; проверка запросов к модели — до маяка |
| external-session:213 | окно (Node своей Session не появился) | маяк уже был (Node OTHER из того же изменения registry) + `settled` |
| external-session:241 | окно 2,5 s (удалённый Node не вернулся) | маяк: ещё одна Session `LATER`; её Node — новый план по всем живым Session; затем `settled`, `3 live` |
| card-drag:140 | не ожидание: темп жеста M23 | оставлено, комментарий |
| terminal-ai-next-command:52 | окно 1,5 s (команда не запустилась) | маяк `shellCaughtUp` |
| subagent-tree:270 | окно (drop ничего не сохранил) | `settled` |
| packaged:525 | окно 3 s (chip-а нет) | оставлено, комментарий: `autopilot.state` отвечает `null` и до сравнения, и после |
| ship-ticket:213 | окно (второй запуск 07 отказан) | `settled` |
| ship-ticket:247 | окно (пустой шаблон — запуска нет) | `settled` |
| ship-ticket:275 | окно (адрес GitLab не открыт) | `settled`: `shell.openExternal` записал бы адрес внутри обработчика |
| ship-ticket:366 | окно (колонка не сдвинулась) | `settled` |
| ship-ticket:371 | ожидание события (смена темы) | `screenshot({ animations: 'disabled' })`, как в `snapshots.ts` |
| session-controls:188 | окно (очередь держится) | `settled`, затем `queue-chip` «2 queued»: main решает о следующем сообщении в том же шаге, что делает Session idle |

### Что осталось: 5 вызовов, у каждого комментарий над ним

`grep -rn waitForTimeout test/e2e`:

- `card-runtime.spec.ts:170` — 300 ms, навигация в чужую Card;
- `linked-cards.spec.ts:269` — 300 ms, навигация из Card B;
- `handoff.spec.ts:89` — `max(SETTLE_READS_MS) + 200` ms;
- `card-drag.spec.ts:142` — `STEP_MS` (25 ms), темп жеста;
- `packaged.spec.ts:527` — 3 s, сравнение Harness второго clone.

Слабое место (владелец 2026-10-15: правка — Ticket 15, ждать отказ навигации, а не время): окно `linked-cards:269` для чужой Card B короче
загрузки по link под нагрузкой (около 0,2 s в покое, `FIRST_FRAME_MS`); при нагрузке ошибочная
навигация может не успеть показаться — ложный зелёный, не красный. Удлинять не стал: время spec-а.

### Прогоны (Playwright, сборка `electron-vite build`, временный HOME, замок `/tmp/worfy-e2e.lock`)

«До» — копия main `12b46d8` (worktree `pol-05-base`), «после» — эта ветка до rebase (`9fa56b4`).
Под нагрузкой: 9 процессов `yes > /dev/null` из 18 ядер, `--repeat-each=5`, три группы spec-ов.

| Прогон | Тестов × 5 | Exit | Красных | Время, s |
| --- | --- | --- | --- | --- |
| до, группа A (card-runtime, epic-frame-undo, wheel-over-nodes, focus, done-stack, card-drag) | 115 | 0 | 0 | 218,3 |
| после, группа A | 115 | 0 | 0 | 212,6 |
| до, группа B (4 × terminal-ai, session-controls) | 40 | 0 | 0 | 108,3 |
| после, группа B | 40 | 0 | 0 | 103,3 |
| до, группа C (linked-cards, handoff, external-session, ship-ticket, subagent-tree, epic-frame) | 85 | 0 | 0 | 288,1 |
| после, группа C | 85 | 0 | 0 | 261,8 |

«Сначала красный» — замер: до правки 0 красных из 5 в каждом файле, правка убирает лишнее время.
Под нагрузкой 17 spec-ов × 5: 614,7 s до, 577,7 s после (−37 s, около −7 s на прогон).
Без нагрузки, один прогон 17 spec-ов (сумма длительностей test-ов): 134,3 s до, около 129,3 s после
(первый прогон «после» упал на card-runtime:181 — c2 не уходит на error page; исправлено ожиданием
сообщения console, card-runtime перепрогнан отдельно: 5 passed, 6,2 s против 10,9 s у упавшего).
Весь `pnpm test:e2e` не запускался (правило Wave) — время по нему не замерено.
`packaged.spec.ts` не прогонялся: правка в нём — только текст комментария, нужна сборка `.app`
(`pnpm test:package`).

### Мутанты

Мутанты приложения в отдельном worktree `pol-05-mut`, рядом — старые версии spec-ов:

- `SessionNodes.tsx`: список «уже были» очищается, когда меняется число живых Session (удалённый
  Node возвращается при следующем плане). Старый `external-session` (окно 2,5 s) — зелёный, мутант
  пропущен; новый — красный на `expect(other).toHaveCount(0)` после маяка `LATER`.
- `session.ts`: Interrupt не держит очередь. Красные и старый, и новый `session-controls`: Session
  сразу уходит в `busy`, раньше окна; мутант не различает окно и `settled`.
- Первый прогон «после» сам был мутантом ожидания: card-runtime:181 без нужного знака стал красным
  по таймауту, а не зелёным.

### Проверки

`pnpm lint` — exit 0, `pnpm typecheck` — exit 0, gate fast — exit 0, `[gate] зелено (fast): worfy/.:lint
worfy/.:typecheck worfy/.:test`. gate full — шаг оркестратора перед merge.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — один круг: `VERIFIED` на `19f15fb`, глубина medium — PR только с test-ами ([комментарий в PR #356](https://github.com/IDSAD-XL/worfy/pull/356#issuecomment-6192109001)). Verifier сам: `pnpm build` — код 0; 16 изменённых spec-ов без `packaged` и `epic-frame` под e2e-замком — 41 passed; `epic-frame.spec.ts` — 7; мутант `SessionNodes.tsx` — новый spec красный на `:251`, старый зелёный; каждая проверка «X не случилось» разобрана по одной.
- Мерж: база `338079c`, head `f55f28f`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `30157ab`.
- Act on, Dismissed — нет.
- Consider ([low]): `test/e2e/terminal-ai-request.spec.ts:121-124` — проверка «модель спросили один раз» перенесена до маяка `shellCaughtUp`, повторный `request` после ответа больше не ловится; `test/e2e/wait.ts:29-31` — комментарий обещает порядок ответов, а `ipcMain.handle` идут параллельно (`src/main/ipc/index.ts:136-163`): обработчик с fs, spawn или git ответит позже `app.version`; сейчас все `settled()` стоят после синхронных обработчиков.
- Noted: пункт «Общее время `pnpm test:e2e` не выросло» снят — замерены только 17 spec-ов; `linked-cards.spec.ts:269` (окно 300 ms) под нагрузкой может дать ложный зелёный, как и до правки — **владелец 2026-10-15: правка — Ticket 15, ждать отказ навигации, а не время**.
