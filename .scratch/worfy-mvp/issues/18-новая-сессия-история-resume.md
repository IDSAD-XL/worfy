# 18 — Сессии из worfy: новая Сессия — новый Узел, история Проекта, Resume завершённой

Type: task
Status: done — 2026-10-05, [PR #25](https://github.com/IDSAD-XL/worfy/pull/25)
Blocked by: 14
Source: [CONTEXT.md](../../../CONTEXT.md), термин «Сессия»; [spec.md](../spec.md), этап 3

## Что делаем

- «New session» в разделе «Sessions» sidebar и в контекстном меню Холста создаёт живой Узел
  Сессии в корне Проекта (движок из 07, тот же `SessionNode.tsx` из 14, теперь с полем ввода).
  Один разговор — один Узел: начать новый разговор значит создать новый Узел, старый остаётся.
- У Оркестратора «New conversation» в меню Узла: текущая Сессия уходит в историю, новая
  становится Оркестратором Проекта.
- История: `HistoryPopover.tsx` — все Сессии Проекта из реестра (тикет 13): заголовок, источник,
  время, ветка. «Show» кладёт Узел только для чтения. «Resume» продолжает Сессию в worfy
  (`resume: sessionId`) и делает Узел живым. `cwd` при Resume — записанный `cwd` Сессии (из
  реестра или транскрипта, тикет 13), а не корень Проекта: Сессия из worktree продолжается в том
  же worktree, иначе Claude Code не найдёт её транскрипт. Папки больше нет — Resume неактивен с
  подписью «Folder no longer exists».
- `src/main/agent/resume.ts` — правило: Resume только для завершённой Сессии. Сессия, у которой
  есть живой процесс в реестре (терминал, Claude desktop), не продолжается — кнопка неактивна с
  подписью «Still running in terminal». Иначе два процесса писали бы один транскрипт.
- Закрыть живой Узел (`agent.close`) можно только в `idle`; занятую — после «Interrupt».

## Готово, когда

- [x] «New session» создаёт новый живой Узел; две Сессии работают параллельно (fake-агент).
- [x] «New conversation» у Оркестратора: старая Сессия видна в истории, новая закреплена как Оркестратор.
- [x] Resume завершённой внешней Сессии делает её Узел живым, и новый ход дописывается в тот же транскрипт (fixture + fake-агент проверяет `resume` в опциях).
- [x] Resume Сессии с живым процессом недоступен, подпись объясняет почему.
- [x] Resume Сессии, начатой в `.claude/worktrees/07`, запускается с этим `cwd` (fake-агент записывает опции); Сессия из удалённого worktree — Resume неактивен.
- [x] Ручной прогон: Сессия, начатая `claude` в терминале и закрытая, продолжается в worfy; снимок в «Итог». (Проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07); ходы из терминала после Resume видны с Ticket-а 22 `worfy-daily`.)

## Тесты

- `test/unit/resume-rule.test.ts` — живой процесс, завершённая, неизвестная Сессия, `cwd` из записи, удалённая папка (новый).
- `test/e2e/new-session.spec.ts` — новая Сессия, история, Resume, запрет Resume (новый).
- Сначала падающий test: `resume-rule.test.ts` на Сессию с живым `pid`.

## Где в коде

- `src/renderer/canvas/nodes/SessionNode.tsx` (живой режим)
- `src/renderer/session/HistoryPopover.tsx`
- `src/renderer/shell/sidebar/SessionsSection.tsx` (кнопка «New session»)
- `src/main/agent/resume.ts`

## Итог

**Сделано.**

- «New session» — кнопка в заголовке раздела «Sessions» sidebar (`SessionsSection.tsx`). main
  ставит новый Узел вида `session` (340 × 220, место — `placeNewNode`, как у Оркестратора) и
  запускает в корне Проекта новую Сессию; Холст центрируется на Узле. Каждое нажатие — новый Узел
  и новая Сессия, старые остаются.
- Живой режим `SessionNode.tsx`: заголовок (из истории, иначе «New session»), статус Сессии,
  строка «worfy · <cwd>», последний ответ Сессии, поле ввода; кнопки Interrupt (во время хода),
  Close (только в `idle`, во время хода неактивна с подсказкой), Resume (у остановленной Сессии),
  Hide, Remove (неактивна, пока Сессия идёт). Сообщение остановленному Узлу сначала продолжает его
  Сессию. Двойной щелчок — Session view этой Сессии (`SessionView.tsx`: заголовок «Session»
  вместо «Orchestrator», стоимость «—»). Узел только для чтения из тикета 14 не изменился.
- Сессии Узлов в main — `src/main/agent/node-sessions.ts` (класс `NodeSessions`), канал
  `sessions.*` — `src/shared/ipc/sessions.ts` и `src/main/ipc/sessions.ts`, вид в renderer —
  `src/renderer/session/node-sessions.ts`. Как и Оркестратор, эти Сессии принадлежат приложению,
  а не окну: события идут во все окна, закрываются они вместе с приложением.
- История — `src/renderer/session/HistoryPopover.tsx` (кнопка «History» в разделе «Sessions»):
  все Сессии Проекта из транскриптов — заголовок, источник (terminal / desktop / worfy), время,
  ветка. При открытии история читается заново (`refreshClaudeHome` в `useClaudeHome.ts`), иначе
  Сессии, закончившиеся после запуска приложения, в ней не появлялись. «Show» кладёт Узел только
  для чтения (или ведёт к уже существующему), «Resume» — `sessions.resume`.
- Правило Resume — `src/main/agent/resume.ts` (`resumeVerdict`): отказ, если Сессию уже ведёт
  worfy («Already open in worfy»), если у неё живой процесс в реестре («Still running in terminal»,
  для Claude desktop — «Still running in Claude desktop»), если у Проекта нет её транскрипта
  («No transcript of this Session»), если записанной папки больше нет («Folder no longer exists»).
  Иначе `cwd` — записанный в транскрипте (`cwd` первой записи), а не корень Проекта. main
  применяет правило и при `sessions.resume`/`sessions.start`, а не только для подписи кнопки.
- Resume Узла только для чтения превращает его в живой на месте: тот же id `session:<id>`, то же
  место, размер не меньше живого. Иначе Resume ставит новый Узел.
- «New conversation» у Оркестратора — кнопка в заголовке его Узла и канал
  `orchestrator.newConversation`: текущая Сессия закрывается (её транскрипт остаётся в истории),
  `sessionId` и `costUsd` в `data` обнуляются, новая Сессия становится Оркестратором. Во время хода
  — отказ.
- `agent.close` во время хода отказывает («Interrupt it before closing»); закрытие вместе с окном
  или приложением не затронуто (оно идёт мимо обработчика). То же правило — `closeRefusal` в
  `resume.ts` — у `sessions.close` и «New conversation».
- В записи истории (`historySessionSchema`) добавлено поле `entrypoint` — из первой записи
  транскрипта, для колонки «источник».

**Сначала падающий test.** `test/unit/resume-rule.test.ts` (Сессия с живым `pid` и остальные
случаи правила) упал на импорте: «Failed to resolve import "../../src/shared/ipc/sessions"» —
модулей `sessions.ts` и `resume.ts` ещё не было; после реализации 9 из 9 зелёные.

**Неочевидные решения.**

- `data` живого Узла Сессии — только `{ origin: 'worfy', sessionId }`, `sessionId` появляется после
  первого `system/init` (ADR-0010: в Раскладке у Узлов Сессий только идентификаторы). Модель,
  `cwd`, состояние — в памяти main (вид Узла, `sessions.changed`) и в транскрипте. После
  перезапуска приложения Узел показывает «finished» и предлагает Resume; `cwd` берётся из
  транскрипта.
- Новая Сессия до первого сообщения не имеет SDK id (Claude Code сообщает его в `system/init`
  первого хода), поэтому в `data` нового Узла только `origin`. Опция SDK `sessionId` (задать id
  заранее) не использована: она требует правки `session.ts`, который параллельно меняет тикет 19.
- Сессии Узлов, как Оркестратор, принадлежат приложению, а не окну, — чтобы вид Узла пережил
  перезагрузку окна. Сессии `agent.start` (окна) не тронуты.
- Remove у живого Узла неактивна: иначе Сессия шла бы без Узла.
- Доработка по ревью (круг 1). Два одновременных `sessions.start`/`sessions.resume` одного Узла или
  одной Сессии (двойной щелчок по Resume, двойной Enter) больше не запускают второй процесс: пока
  первый запуск читает Claude home, второй получает его ответ (карта запусков в полёте по
  `node:<id>` и `session:<SDK id>` в `node-sessions.ts`). Если `registry.start` всё же отказал, вид
  Узла — `closed` с причиной в `error`, а не `error`: Сессии нет, и Узел можно удалить или
  запустить снова.
- Правило Resume видит Сессии worfy, которые продолжены, но ещё не прислали `system/init` (например,
  Оркестратор после перезапуска приложения): в `SessionInfo` реестра добавлено поле
  `sdkSessionId` (`src/main/agent/session.ts`, одна строка в `info()`), и `runningIds()` берёт его.
  Канал `agent.list` это поле не отдаёт: его выходная схема вырезает лишние ключи. `session.ts`
  параллельно меняет тикет 19 — возможен мелкий конфликт при мерже.
- Схема `data` живого Узла (`worfySessionNodeDataSchema`) перенесена в `src/shared/ipc/sessions.ts`:
  main пишет `data` через её тип, renderer читает ею же; `SESSION_KIND` в renderer теперь равен
  `SESSION_NODE_KIND` из shared, а не отдельной строке. Экземпляр `NodeSessions` приложения — в
  `src/main/agent/app-node-sessions.ts`, рассылка во все окна (`toEveryWindow`) — в
  `src/main/broadcast.ts`; `app-orchestrators.ts` больше ничего не экспортирует для `sessions`.

**Правки вне следа тикета** (без них «Готово, когда» не выполнить): новые `src/shared/ipc/sessions.ts`,
`src/main/ipc/sessions.ts`, `src/main/agent/node-sessions.ts`, `src/renderer/session/node-sessions.ts`;
`src/main/agent/orchestrator.ts`, `src/shared/ipc/orchestrator.ts`, `src/main/ipc/orchestrator.ts`,
`src/renderer/canvas/nodes/OrchestratorNode.tsx` («New conversation»); `src/main/ipc/agent.ts`
(отказ `agent.close` во время хода); `src/main/agent/app-orchestrators.ts` (`toEveryWindow` вынесен
в новый `src/main/broadcast.ts`); новый `src/main/agent/app-node-sessions.ts`; `src/main/agent/session.ts`
(поле `sdkSessionId` в `SessionInfo`);
`src/renderer/claude-home/session-nodes.ts` (операция «Show»; схема `data` живого Узла теперь из shared);
`src/renderer/claude-home/useClaudeHome.ts` (`refreshClaudeHome`); `src/renderer/session/SessionView.tsx`;
`src/shared/ipc/claude-home.ts` и `src/main/claude-home/registry.ts` (поле `entrypoint`).

**Тесты.** `test/unit/resume-rule.test.ts` (правило); `test/contract/node-sessions.test.ts` —
New session, две Сессии параллельно, Resume Узла только для чтения в `cwd` worktree, отказы,
перезапуск, Close во время хода, `agent.close` во время хода, «New conversation», каналы
`sessions.*` (отказ на неверном типе и на id с `/`, вырезание лишних ключей входа и ответа);
`test/contract/claude-home-registry.test.ts` — `entrypoint`; `test/e2e/new-session.spec.ts` —
весь сценарий в собранном приложении на fake-агенте, в конце — проверка, что под
`WORFY_CLAUDE_HOME` worfy ничего не записал. Fake-агент отвечает `system/init` с тем
`session_id` и `cwd`, с которыми его запустили (`{{session}}` — это `resume`), поэтому совпадение
id и `cwd` Узла после хода подтверждает, что в опции ушли `resume` и записанный `cwd`. Два мутанта
(`cwd` корня вместо записанного; пропуск проверки живого процесса) — красные.
Круг доработки 1 добавил: в `node-sessions.test.ts` — два одновременных Start одного Узла, Start и
Resume одной Сессии, два Resume Сессии без Узла (один процесс, один Узел), Сессия, продолженная
вне Узлов и ещё без своего id («Already open in worfy», Узел не создаётся), отказ `registry.start`
(вид `closed` с причиной, Close отвечает «No live Session»), сохранение `pinned` и `tags` при Resume
Узла только для чтения; в `new-session.spec.ts` — отдельный test на скрипте `interrupt`: во время
хода Close и Remove неактивны, после Interrupt Close активна, после Close активна Remove; и снимок
папки Проекта (папки и файлы) до запуска и в конце (ADR 0005). Мутанты, все красные: без карты
запусков в `start` и в `resume`; без SDK id в `runningIds`; `error` вместо `closed`; без очистки
карты; без строк `hidden`/`pinned`/`tags` (M8); `disabled={false}` у Close; `disabled={false}` у
Close и Remove; запись файла в корень Проекта при New session.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test` — код 0 (839 test-ов);
`gate.sh fast` — код 0, «[gate] зелено (fast)» (первый прогон — код 2: test
`limits.test.ts › is followed while watched` не дождался события файловой системы за 10 с; тикет
его не трогает, отдельно и при повторе он зелёный); `pnpm test:e2e` — код 0, 41 passed.
Первые два CI run-а PR красные на `new-session.spec.ts`: на меньшем экране runner-а заголовок
первого Узла уходил под toolbar, а Узел Оркестратора — за край Холста (Холст рисует только видимые
Узлы). Test теперь двигает Холст колесом, пока кнопка «New conversation» не окажется внутри
Холста, и шлёт щелчок Close самому элементу; локально зелёный при окне 800 × 600, 1024 × 640,
1280 × 720 и 1400 × 900.
Ревью нашло, что и этот цикл иногда не доходит до кнопки (1 из 13 прогонов): он двигал Холст только
по вертикали и искал кнопку по её элементу, которого нет, пока Узел за краем. Теперь helper
`panTo` ждёт, пока viewport перестанет двигаться (центрирование после «New session» закончилось),
и ведёт Холст колесом по обеим осям по сохранённому месту Узла и transform viewport, пока центр
Узла не окажется в центре Холста; колесо крутится только над пустым Холстом. После правок:
`new-session.spec.ts` — 16 из 16 при 1400 × 900, по 10 из 10 при 1024 × 640 и 800 × 600.
Круг 1: `pnpm lint && pnpm typecheck && pnpm test` — код 0 (844 test-а; первый прогон — код 1 на
том же `limits.test.ts › is followed while watched`, тикет его не трогает); `gate.sh fast` — код 0,
«[gate] зелено (fast)»; `pnpm test:e2e` — код 0, 42 passed (два предыдущих прогона — код 1 на
`epic-frame.spec.ts` и `canvas-layout.spec.ts`, которые тикет не трогает; отдельно оба зелёные
по 3 раза из 3).

**Не сделано / не проверено.**

- «New session» в контекстном меню Холста: на `origin/main` контекстного меню Холста нет — его
  заводит тикет 27 (`CanvasMenu.tsx`, PR #17 не влит). Сейчас «New session» только в sidebar;
  пункт меню — после 27.
- «Новый ход дописывается в тот же транскрипт»: fake-агент транскриптов не пишет; проверено, что
  Сессия продолжается под тем же id и в том же `cwd`, то есть настоящий Claude Code открыл бы тот
  же файл.
- проверено 2026-10-06 ночью, не прошло: Session из терминала продолжается в worfy, ход дописан в тот
  же транскрипт, но Session view после Resume показывает только новые ходы — подраздел
  [«Ручная проверка 2026-10-06, ночь»](#ручная-проверка-2026-10-06-ночь). Пункт «Готово, когда» оставлен открытым.
- Двойной щелчок по остановленному живому Узлу открывает транскрипт в режиме только для
  чтения (`ExternalSessionPanel.tsx`) с подписью «started in terminal» — подпись для Сессии worfy
  неточна.

### Ручная проверка 2026-10-06, ночь

Сборка `main` @ 92c00a5, проверял агент. Режим Б: собранный `worfy.app`, запущенный через
LaunchServices с окружением launchd, настоящий Claude Code с входом владельца. Session — транскрипт
`a5e24075-….jsonl` из проверки 18 гайда: начат `claude` в терминале и закрыт `/exit`. Снимки лежат в scratchpad Session оркестратора, в репозиторий не положены.

**Resume Session из терминала — не прошло (проверка 19 гайда).** Session продолжается и пишет в тот же
транскрипт, но Session view показывает только ходы после Resume.

- History: строка с подписью terminal, Resume активна. Заголовок — ai-title Claude Code «Проверка файлов
  docs/adr», а не текст первого промпта, как ждал гайд.
- Resume: chip starting → idle за 0,6 с, источник Node-а «worfy · …», появилось поле ввода. В реестре тот
  же sessionId, `entrypoint: sdk-ts`.
- Ход «проверка 18, второй ход»: busy → idle за 5,4 с, ответ ссылается на первый ход.
- Транскрипт вырос с 400796 до 434304 байт, первые 400796 байт совпали побайтно — запись только
  дописана. Другого файла с этим ходом нет; у новой записи тот же sessionId и cwd.
- Шаг 6 не прошёл: в Session view только хук `SessionStart:resume`, второй ход и ответ. Первого хода из
  терминала нет ни в DOM, ни при прокрутке.
- Дефекты:
  - Session view берёт события только из живого потока (`src/renderer/session/SessionView.tsx:101`,
    `useSessionLog`); прошлые ходы из транскрипта store не подгружает — «after a restart the view starts
    empty» (`src/renderer/session/store.ts:17`);
  - по той же причине Node сразу после Resume показывает «No answer yet» вместо последнего ответа
    (`src/renderer/canvas/nodes/SessionNode.tsx:252`).
- `git status --porcelain` основного checkout пуст до и после. Возобновлённая Session оставлена idle.
- Снимки: `19-01-history.png`, `19-03-after-resume-4s.png`, `19-06-step4-idle.png`,
  `19-07-step6-session-view.png`.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M12 второго круга ручных проверок). Stable copy из 5060858
(pid 74430, CDP 9351), настоящий Claude Code.

- В терминале два хода `claude -p --model sonnet` в одной Session 859ee605: «alpha», затем
  `--resume` → «beta». Оба хода в одном `.jsonl`, `entrypoint: sdk-cli`.
- В worfy: History → Resume у этой строки (щелчок мышью ОС, 05:50:52Z). Появился живой Node
  `session:859ee605`, Claude Code (pid 87874) запущен с `--resume`. Node сразу показывает «beta»,
  а не «No answer yet».
- Session view открыт двойным щелчком до нового хода: промпты alpha и beta и ответы alpha и beta —
  каждый ровно один раз.
- Ход «gamma» дописан в тот же транскрипт (`sdk-ts`, `claude-sonnet-5-5`). После него alpha, beta и
  gamma — по одному разу, Node показывает «gamma».
- Замечание [low], вне критериев: History подписывает Session, начатую `claude -p` в терминале
  (`entrypoint: sdk-cli`), как «worfy». Причина — `src/renderer/session/HistoryPopover.tsx:64`
  (`if (entrypoint.startsWith('sdk')) return 'worfy'`). Это расходится с
  `src/renderer/claude-home/session-nodes.ts:171`: «`sdk-ts` alone does not make a Session worfy's».
  Интерактивный `claude` (`entrypoint: cli`) подписан верно — «terminal».
- Наблюдение, не проверено: один запуск hook-а SessionStart виден в Session view дважды —
  «SessionStart:resume success» из транскрипта и «SessionStart:resume exit 0» из живого потока. У
  новой Session без Resume так же («startup success» и «startup exit 0»). Ходы не задвоены.
- Вердикт: проверено.
- Снимок Session view после хода gamma: [18-resume-terminal-session.png](../evidence/18-resume-terminal-session.png).
  Остальное — в scratchpad Session Orchestrator-а: `M12-before.png`, `M12-history-popover.png`,
  `M12-after-resume-canvas.png`, `M12-before-turn.png`, `M12-transcript.txt`, `M12-dom.json`.
