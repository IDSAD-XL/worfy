# Autopilot

> Перевод [английской версии](../autopilot.md), commit `same-pr`.

Autopilot ведёт Wave-ы одного Epic-а одну за другой, без человека у Orchestrator-а. Он отправляет Wave, ждёт её конца,
отправляет следующую готовую Wave и останавливается, когда готовой Wave нет или что-то пошло не так. Один такой проход
по Epic-у называется **run**. Если термины незнакомы, начните с [Concepts](concepts.md).

## Autopilot

### Behaviour

#### Запуск run-а

На рамке Epic-а на Canvas есть кнопка **Autopilot**. Кнопки нет, только когда все Ticket-ы Epic-а в `done` и у Epic-а нет
идущего run-а, строки состояния прошлого run-а, остановки в пути и отказа «running on <Machine>». Поэтому после оконченного
run-а она остаётся неактивной, пока приложение не перезапустят или Project не запустит другой Epic. Она активна, когда мог бы
сработать «Run wave» и шаблон «Run wave» Project-а называет Ticket-ы Wave через `{tickets}`. Её tooltip говорит, что она делает,
что экран останется включённым до конца run-а и сколько недели обычно занимает такая Wave:

> A Wave like this usually takes about 6% of the week. Used now: 41%, resets in 2 d 5 h

Если прошлых Wave со свежими числами Limits меньше трёх, tooltip говорит, что оценки пока нет.

Старт получает отказ, с причиной на кнопке, в таких случаях:

- У Project-а уже есть run. У Project-а не больше одного run-а одновременно.
- Orchestrator в turn-е, у него живые background task-и или сообщения в очереди.
- Шаблон «Run wave» пуст или в нём нет `{tickets}`.
- У Project-а нет такого Epic-а, или workflow не читается.
- Project — это собственный репозиторий worfy, а сборка development. Считается любой checkout этого репозитория, worktree
  тоже.
- Тот же Epic того же репозитория идёт или стартует на Linked machine либо в другом Project-е этой Machine. Под кнопкой
  появляется chip «running on <Machine>», а рядом кнопка **Start anyway**.

Старт с отказом не пишет journal и не держит экран включённым. «Start anyway» запускает run, хотя оба run-а будут брать
одни и те же Ticket-ы. Другого пути мимо этого отказа нет. Linked machine, которая не подключена или не ответила за
3 секунды, старт не блокирует: chip «on <Machine>» называет её в своём tooltip. Project без remote `origin` никого не
спрашивает.

Сам по себе run не стартует, и после перезапуска приложения тоже.

#### Во время run-а

Строка над кнопкой показывает состояние run-а:

| Строка состояния | Значение |
|---|---|
| `starting` | Run начался, Wave ещё не ушла. |
| `Wave 2 · running` | Run отправил вторую Wave. Wave считаются внутри run-а с 1, это не номер Wave в плане Epic-а. |
| `Wave 2 · 4 background tasks` | То же, и у Orchestrator-а четыре живых background task-а. |
| `waiting for limits · resumes 14:20` | Limits отказали turn-у. Run продолжит в это время. |
| `today's share used · resumes 00:00` | Бюджет остановил следующую Wave. |
| `5-hour limits full · resumes 02:12` | Бюджет остановил следующую Wave: доля дня осталась, окно на 5 часов заполнено. |
| `stopping · 2 tickets in work` | Пришёл Stop. Два Ticket-а текущей Wave в работе. Если таких нет, строка говорит `stopping`. |
| `stopped: no ready wave` | Run окончен, с причиной (см. ниже). |

Пока идёт run:

- Orchestrator работает **unattended**. Он идёт в режиме `bypassPermissions`, какой бы режим ни был сохранён в Node. В смене
  режима разрешений отказано. Когда run кончается, Node получает свои настройки обратно.
- Запрос разрешения, вопрос с вариантами ответа и `session.ask` от Card сразу получают отказ: отвечать некому. Каждый отказ
  идёт в journal. Если Claude Code назвал причину запроса разрешения, модель получает эту причину и может изменить команду.
- «Run wave» и «Process gate queue» вручную и «New conversation» у Orchestrator-а получают отказ.
- Человек по-прежнему может написать Orchestrator-у. То, что человек делает с его Session через worfy, идёт в journal как
  `human-input`: сообщение, сообщение от Card, Interrupt, «Send queued», удаление сообщения из очереди, смена настроек, в том
  числе та, в которой отказано. «Run wave», «Process gate queue» и «New conversation», получившие отказ, строки не пишут, и
  действия в других Session тоже.
- Interrupt turn-а Wave завершает run с причиной `interrupted`.
- Session использует только Browser profile с отметкой «Available to Autopilot», при открытии Browser обязана назвать Ticket
  этого Epic-а и никогда не входит в аккаунт. Подробности — на [странице Browser](browser.md).
- worfy просит систему держать экран включённым от начала run-а до конца, в том числе во время ожиданий, описанных ниже.
- Если есть Linked machines, chip «on <Machine>» под кнопкой говорит, какая Machine ведёт run. Linked machine с полным доступом
  может запускать и останавливать run. С доступом read-only она видит состояние, а её кнопки неактивны. Run всегда выполняется
  на Machine Project-а.
- Когда в `main` собственного репозитория worfy в Harness есть изменения, которых нет в этой сборке, под кнопкой стоит chip
  «Harness in main is newer than the Stable copy», с run-ом и без него. Run продолжается как есть.

#### Когда Wave окончена

Wave окончена, когда верно всё это:

1. Turn Wave закончился без ошибки и без прерывания.
2. Session простаивает, и у неё нет живых background task-ов.
3. В свежем чтении workflow ни один Ticket Wave не в работе (`claimed`).

Затем run заново вычисляет готовую Wave. Если это тот же набор Ticket-ов, что и у только что оконченной Wave, run
останавливается с `no-progress`. Ticket Wave, который после turn-а остался открытым, Wave не держит.

Если после turn-а Ticket ещё в работе, run ждёт до 10 минут. Каждое изменение workflow проверяет заново, а новый turn
Orchestrator-а ждёт своего результата. После этого run останавливается с `wave-unfinished`.

Живые background task-и заставляют run ждать до одного часа без единого их события. Каждое событие task-а начинает этот
срок заново. Когда последний task закончился, run ждёт до 2 минут turn, который запускает его task-notification, а затем
оценивает Wave без этого turn-а.

Каждая Wave после первой в run-е идёт в новую SDK session Orchestrator-а, чтобы контекст не рос от Wave к Wave. Её первый
prompt ещё и велит Orchestrator-у выполнить `wave-brief <epic>`. Wave остаётся в текущей session, когда Orchestrator не
свободен (turn, живой task или сообщение в очереди), когда вышло время ожидания последнего turn-а, и со старым Harness, где
нет `wave-brief`.

#### Ожидание Limits

Когда Limits отказывают turn-у Wave, Wave не заканчивается. Run ждёт, пока сбросится отказавшее окно, плюс 2 минуты. Если
время сброса неизвестно, он пробует снова каждые 30 минут. Если ожидание превысило бы 24 часа от первого отказа, run
останавливается с `limits-timeout`.

Когда время приходит, Orchestrator получает одно сообщение: продолжить с места остановки и сначала добавить запись о паузе в
HANDOFF. Сам worfy эту запись не пишет.

#### Бюджет Limits

Бюджет не даёт Autopilot потратить всю неделю, пока владелец не сел работать вручную. Он находится в Settings → Autopilot и по
умолчанию выключен:

- **Daily budget of the Limits** включает его. Preset Pro в Settings → Plan тоже его включает.
- **Reserve for your own work** — доля недели, которую Autopilot оставляет, от 0 до 50 %, по умолчанию 15 %.

Эти настройки принадлежат Machine. Они читаются перед каждой Wave и никогда не обрывают Wave в работе. Когда бюджет
останавливает следующую Wave, run находится в `waiting` до времени в строке состояния, а затем проверка идёт снова. Wave не
стартует, когда:

- от доли дня ничего не осталось, либо осталось меньше оценки Wave, когда из доли дня что-то уже потрачено. Run продолжит в
  начале следующего местного дня или при сбросе окна на 7 дней, если это раньше;
- доля дня осталась, а окно на 5 часов заполнено. Run продолжит при сбросе окна на 5 часов или в начале следующего дня, если
  это раньше.

Первая Wave дня идёт всегда, когда у дня есть доля, поэтому Wave с оценкой больше всей доли не ждёт вечно. Неизвестное или
старше 30 минут число окна на 7 дней ничего не останавливает. Жёстким пределом остаётся отказ Limits внутри Wave.

#### Остановка

**Stop autopilot** — graceful Stop: run не отправляет новых Wave. Клик до отправки «Run wave» не даёт этой Wave уйти. Клик, пока
«Run wave» в пути, этого не делает: Wave уходит, а за ней сообщение об остановке, если только Wave ещё не ждёт в очереди Session
(первый случай ниже).

- Если Wave не в работе, run сразу заканчивается с `user-stop`. Сюда входят время до первой Wave, Wave, которая ещё ждёт в
  очереди Session (её убирают оттуда), ожидание бюджета и ожидание, пока Ticket-ы выйдут из работы после turn-а.
- Во время turn-а Wave или её background task-ов кнопка говорит **Stopping…** и не принимает клик. Orchestrator получает
  сообщение: новых Ticket-ов не брать, начатые закончить, затем закончить turn. Run заканчивается с первым концом turn-а, после
  которого Session простаивает и живых task-ов нет. Он не ждёт файлов Ticket-ов и не проверяет, послушался ли Orchestrator,
  поэтому Ticket может остаться в `claimed`.
- Во время ожидания Limits то же сообщение уходит вместе с продолжением, в момент сброса. До этого run остаётся в `waiting`.

**Force stop** — единственный пункт меню «⋯» справа от кнопки, доступный и во время graceful Stop. Он не ждёт. Он прерывает
turn (до 15 секунд), закрывает процесс Claude Code, а с ним все background task-и, отменяет любое ожидание и возвращает
Orchestrator человеку. Worktree и ветки остаются. Сообщение, которое человек поставил в очередь, остаётся и удерживается в
очереди новой Session. Wave и сообщение об остановке из очереди уходят.

Следующий run того же Epic-а берёт Ticket-ы, прерванные Force stop, в свою первую Wave, если они ещё в работе, даже когда больше
ничего не готово. После graceful Stop он их не берёт. worfy хранит этот список только в памяти, поэтому перезапуск приложения
его стирает.

**Выход из приложения** останавливает каждый run с `app-quit`. Выход ждёт до 3 секунд, пока run запишет свой конец. Orchestrator
заново не запускается, а background task-и заканчиваются вместе с приложением.

#### После любой другой остановки

Orchestrator сразу возвращается к человеку, когда ничего не идёт. Если turn или background task ещё живы, состояние уже говорит
`stopped`, но Orchestrator остаётся unattended, экран остаётся включённым, пока они не закончатся, а новый старт получает отказ.
Task-и в это время могут продолжать работу. После последнего task-а Orchestrator ждёт 30 секунд turn, который запускает его
task-notification, а затем возвращается.

#### Почему run останавливается

| Причина | Значение |
|---|---|
| `no-ready-wave` | Ничего не готово, и ни у одного Ticket-а в `blocked` или без статуса не закрыты все блокеры. Так заканчивается run, который завершил Epic. |
| `blocked-tickets` | Ничего открытого не готово, а у Ticket-ов в `blocked` или без статуса все блокеры закрыты. |
| `no-progress` | Следующая готовая Wave — тот же набор Ticket-ов, что и только что оконченная. |
| `wave-unfinished` | Ticket Wave остался в работе дольше 10 минут после turn-а. |
| `background-stalled` | Background task-и не дали ни одного события за час. |
| `limits-timeout` | Ожидание Limits превысило бы 24 часа. |
| `interrupted` | Turn Wave прервали, или прервали turn человека, и Wave осталась удержанной в очереди. |
| `turn-error` | Turn Wave закончился ошибкой, которая не является отказом Limits. |
| `session-error` | Session Orchestrator-а упала. |
| `session-closed` | Session Orchestrator-а закрылась. |
| `send-failed` | «Run wave» не удалось отправить. |
| `workflow-error` | Workflow не прочитался, когда run должен был оценить Wave. |
| `user-stop` | Stop autopilot. |
| `user-force-stop` | Force stop. |
| `app-quit` | Выход из приложения. |

Tooltip строки состояния называет ошибку словами, когда она есть.

На Machine с ролью `serve` межмашинного gate перед остановкой с `no-ready-wave` или `blocked-tickets` run отправляет
Orchestrator-у шаблон «Process gate queue», один раз за run. Он следит за этим turn-ом как за turn-ом Wave, а затем останавливается
с той же причиной, даже если turn сделал какой-то Ticket готовым. Stop до этого момента отменяет шаг.

#### Journal

Каждый run пишет journal: один текстовый файл, в каждой строке один объект JSON. Это запись того, что произошло: каждая Wave с
отправленным текстом, пропущенные Ticket-ы, диалоги с отказом, действия человека с Session, ожидания, background task-и и причина
остановки. Экрана для него в приложении нет, файл читают напрямую. Наблюдатель вне worfy может дописать строку `human-input` через
`>>`, если человек сделал что-то видимое только на экране, например ответил на системный диалог.

### How it works

**Run — это view над workflow.** worfy не пишет статус Ticket-а, это делают агенты через скрипт `ticket`
([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Конец Wave не приходит событием, поэтому run вычисляет его по
событиям Session Orchestrator-а и свежим чтениям workflow
([ADR-0024](../../adr/0024-autopilot-wave-end-and-keep-awake.md)). Run отправляет текст того же шаблона, что и «Run wave», и не знает
протокола skill-а. Сообщение об остановке — просьба, а не протокол.

**Цикл.** Чистая функция получает состояние run-а и одно событие и отвечает следующим состоянием и списком эффектов. Фазы такие:

| Фаза | Значение |
|---|---|
| `starting` | Ещё ничего не отправлено. |
| `sending` | «Run wave» в пути, или run ждёт бюджет перед отправкой. |
| `turn` | Wave отправлена, идёт turn. |
| `tasks` | Turn закончился, background task-и живы. |
| `settling` | Turn закончился, Ticket-ы Wave ещё в работе. |
| `stopped` | Run окончен. |

Все шаги run-а идут через одну очередь на run, поэтому события обрабатываются по порядку, а клик по Stop отмечается раньше, чем его
шаг встанет в эту очередь. Идущий шаг читает эту отметку прямо перед отправкой «Run wave», поэтому клик до этого момента не даёт Wave уйти.
Более поздний клик отправку не отменит: цикл отмечает остановку в фазе `sending`, а сообщение об остановке идёт за Wave.

**Какой turn принадлежит Wave.** Wave может ждать в очереди Session за сообщением человека. Закончить Wave может только turn, который
начался с prompt-а этой Wave, или более поздний. Результат более раннего turn-а не может.

**Background task-и.** Skill `/epic-wave` запускает implementer-ов в фоне и заканчивает turn, пока Ticket-ы ещё открыты, поэтому конец
turn-а сам по себе ничего не значит. Их task-notification запускают новые turn-ы той же Wave
([ADR-0029](../../adr/0029-autopilot-waits-for-background-tasks.md)).

**Wave называет свои Ticket-ы.** Текст run-а называет Ticket-ы из одного чтения workflow, а journal хранит ровно то, что ушло, потому
что номер Wave из плана однажды отправил Orchestrator-а в закрытую Wave
([ADR-0033](../../adr/0033-autopilot-names-wave-tickets.md)).

**Unattended.** В любом режиме, кроме `bypassPermissions`, Claude Code спросил бы перед tool, и никто бы не ответил. Поэтому смена режима
получает отказ, а не применяется, а запуск не сохраняется вместе с Node
([ADR-0022](../../adr/0022-unattended-session-refuses-permission-mode-change.md)). В этом режиме Claude Code всё равно спрашивает о
некоторых своих проверках, поэтому отказы вообще и существуют.

**Две остановки.** Graceful Stop не бросает implementer-а посреди merge
([ADR-0051](../../adr/0051-autopilot-graceful-stop-force-stop-in-menu.md)). Force stop — крайняя мера: background task-и заканчивает именно
закрытие процесса ([ADR-0050](../../adr/0050-autopilot-user-stop-interrupts-orchestrator.md)). Новый процесс стартует только после выхода
старого, которого после предела убивают, поэтому два процесса никогда не продолжают одну SDK session
([ADR-0064](../../adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md)).

**Ожидание идёт по wall clock.** Таймер ожидания сверяет время как минимум раз в минуту вместо одного длинного timeout, поэтому Machine,
которая уснула, не продолжит позже на время сна.

**Что считается отказом.** Turn, закончившийся ошибкой, считается отказом Limits, когда Session сообщила `rejected` во время этого turn-а или
когда текст ошибки говорит о Limits. Claude Code сообщает статус только при его изменении, поэтому старый `rejected` не превращает более
позднюю ошибку другого рода в отказ.

**Бюджет.** Всё считается по окну на 7 дней:

- Доля дня = (1 − резерв − доля окна на 7 дней в начале дня) / дни до сброса этого окна, включая сегодняшний.
- Потрачено сегодня = доля окна на 7 дней сейчас − доля окна на 7 дней в начале дня.
- Начало дня — первое число за сегодня в journal-ах Project-а для того же окна на 7 дней. Поэтому доля весь день одна и та же, а сброс окна
  начинает её заново. То, что потрачено вручную до первой Wave дня, поэтому не считается сегодняшним.

**Оценка.** Образец Wave — рост доли окна на 7 дней между её строками `wave-started` и `wave-finished`, поделённый на её Ticket-ы. Оценка —
медиана последних 10 образцов, нужно не меньше 3. Wave, у которой число старше 30 минут на любом конце или внутри которой окно сбросилось,
образца не даёт. Числа — это доли недели, без цен. Перед этими двумя строками run один раз спрашивает расход, если его число старше 5 минут.
Токенов модели это не тратит.

**Один run на Epic и репозиторий.** Один репозиторий на двух Machine — это два Project-а, поэтому ключ run-а — Epic и нормализованный адрес
remote `origin` ([ADR-0053](../../adr/0053-several-screens-on-one-project.md)). Старт считает себя среди run-ов этой Machine раньше, чем
спрашивает. Поэтому, пока обе Machine отвечают, два одновременных старта одного ключа могут оба получить отказ, но оба не пойдут. Machine, которая
не подключена или не ответила за 3 секунды, считается `unasked`, и тогда оба run-а могут идти. Вопрос идёт независимо от того, включён ли доступ
для Linked machines: ответ несёт только Epic и ключ каждого run-а.

**worfy над самим собой.** Агенты Wave над worfy пересобирают приложение, поэтому development-сборка там получает отказ. Harness в работающей сборке
не меняется во время run-а. worfy только показывает, что он отстал, а Stable copy пересобирают между run-ами
([ADR-0047](../../adr/0047-harness-lessons-by-pr-early-owner-switch.md)).

**Экран.** Run просит систему через power save blocker держать включённым не только систему, но и экран: e2e test-ам агентов нужно окно
([ADR-0034](../../adr/0034-autopilot-keeps-display-awake.md)). Настройки системы worfy не меняет.

**Узкий круг исправления (narrow fix round).** Skill `/epic-wave` пишет свои вердикты комментариями `NARROW: …` в PR Ticket-а
([ADR-0046](../../adr/0046-autopilot-narrow-round-without-owner.md)). Run только переносит их в journal. Он читает их через тот же PR tracker, что и
PR badges. Tracker ограничивает `gh` для них вместе: один список PR на Project в минуту и один поиск за 5 минут для ветки, которой нет в этом списке.
Badges опрашивают, только пока окно в фокусе, поэтому без фокуса `gh` запускает собственное чтение run-а.

### Implementation

#### Модули

| Путь | Что там |
|---|---|
| `src/main/autopilot/run.ts` | Класс `Autopilot` и один `Run`: проверки старта, события Session, эффекты цикла, остановки, возврат Orchestrator-а. |
| `src/shared/autopilot/cycle.ts` | Цикл: фазы, события, эффекты, причины остановки и их сроки. Чистые функции. |
| `src/main/ipc/autopilot.ts` | Обработчики IPC и `sharedAutopilot`, который связывает с run-ом Project-ы, Orchestrator-ы, Session-ы, watch и journal приложения. |
| `src/shared/ipc/autopilot.ts` | Каналы IPC `autopilot`, состояние run-а и текст строки состояния. |
| `src/main/actions/launch.ts` | `autopilotWave`, `autopilotRefusal`, `autopilotGateQueue`: текст из шаблона, отправленный Orchestrator-у. |
| `src/shared/actions/render-template.ts` | `runWaveState`: решение и текст, общие с кнопкой. |
| `src/shared/workflow/waves.ts` | `readyWave`: готовая Wave и пропущенные Ticket-ы. |
| `src/main/agent/orchestrator.ts` | `setUnattended`, `giveBackNow`, `newUnattendedSession` и отказы из-за turn-а, task-ов или очереди. |
| `src/main/agent/session-settings.ts` | Запуск Session и принудительный режим разрешений. |
| `src/main/agent/permissions.ts` | `unattendedCanUseTool`: отказ на каждый запрос. |
| `src/main/agent/session.ts` | `halt` для Force stop, `refuseDialog`. |
| `src/main/autopilot/limits-wait.ts` | Ожидание Limits, таймер по wall clock, текст продолжения. |
| `src/shared/autopilot/resume-at.ts` | Когда run продолжает после отказа. Чистые функции. |
| `src/shared/autopilot/budget.ts` | Бюджет и его решение перед Wave. Чистые функции. |
| `src/shared/autopilot/limits-estimate.ts` | Оценка Wave и строка tooltip. Чистые функции. |
| `src/shared/autopilot/journal.ts` | Формат journal, описанный в комментарии в начале файла, с разбором и записью строки. Чистые функции. |
| `src/main/autopilot/journal.ts` | Файлы journal: открыть, дописать, перечислить, прочитать. |
| `src/main/autopilot/power.ts` | `KeepAwake` поверх `powerSaveBlocker` из Electron. |
| `src/main/autopilot/origin.ts` | Ключ remote `origin`. |
| `src/main/link/autopilot-runs.ts` | Вопрос о run-ах между Linked machines, два служебных сообщения link. |
| `src/main/autopilot/harness-drift.ts` | Новее ли Harness в `main`, чем в этой сборке. Только чтение, без `git fetch`. Только packaged-сборки. |
| `src/main/mcp/browser-server.ts` | Что Session в Autopilot может делать с Browser. |
| `src/main/ipc/card-api.ts` | Отказ `session.ask` от Card для unattended Session. |
| `src/renderer/canvas/actions/AutopilotAction.tsx` | Кнопка, меню «⋯», строка состояния и chip-ы. |
| `src/renderer/settings/AutopilotSection.tsx` | Settings → Autopilot. |
| `src/shared/settings/app-settings.ts` | `autopilotBudget` и значения по умолчанию. |
| `scripts/install-stable.mjs` | `pnpm install:stable`: Stable copy. |

#### Поток данных

1. Кнопка вызывает `autopilot.start`. `Autopilot.start` выполняет проверки по порядку: у Project-а нет run-а, отказ для собственного репозитория и
   шаблон, workflow и Epic, затем ключ origin и вопрос к Linked machines.
2. `setUnattended` заново запускает Session Orchestrator-а как unattended, продолжая её SDK session, или отказывает. Затем run открывает journal
   (`run-started`), включает keep-awake, подписывается на события Session и открывает watch workflow, который сообщает только об изменениях полей
   Ticket-ов.
3. Событие `start` идёт в цикл. Его эффект `send-wave` запускает `sendWave` в run-е: тот спрашивает расход, проверяет бюджет, запускает новую SDK session
   для Wave после первой и вызывает `autopilotWave`. Launcher читает workflow один раз и берёт из этого чтения текст, Ticket-ы и пропущенные Ticket-ы.
   Он отправляет текст через Session, которая начинает turn или ставит его в очередь, и привязывает Session к Epic-у.
4. События Session (`prompt`, `result`, `state`, `background_tasks`, `refused_dialog`) и изменения workflow становятся событиями цикла, каждое со свежим
   чтением workflow, где циклу оно нужно. Каждый эффект идёт в journal или в Session.
5. `end` пишет `run-stopped`, убирает сообщения run-а из очереди и возвращает Orchestrator через `setUnattended`. Если turn или task живы, это ждёт их
   конца, а `linger` следит за этим для journal. Force stop идёт через `interruptAndGiveBack`.
6. Каждое новое состояние идёт во все окна как `autopilot.changed`. Клиент оставляет состояние с наибольшей revision.

Остальные каналы — `autopilot.stop`, `autopilot.forceStop`, `autopilot.state` и `autopilot.estimate`. Запрос состояния ещё и заново спрашивает, не чаще раза
в минуту, не отстал ли Harness.

#### Файл journal

Файл — `<data folder>/autopilot/<run>.jsonl`, один на run, без ротации. На macOS папка данных packaged-приложения — `~/Library/Application Support/worfy`,
development-сборки — `~/Library/Application Support/worfy-dev`, а `WORFY_DATA_DIR` заменяет обе. Вне её ничего не пишется
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)). Id run-а — время старта в UTC и шесть шестнадцатеричных цифр, поэтому имена файлов сортируются по
времени старта. В каждой строке есть `at`, `run`, `project`, `epic` и `kind`. Читатель пропускает и считает строку, которую не может прочитать.

| Kind | Когда пишется |
|---|---|
| `run-started` | Run начался. Есть `origin`, а также `override` или `unasked`, когда они применимы. |
| `harness-behind` | Harness в `main` новее: после `run-started` и перед `wave-started`, когда счётчик изменился. |
| `wave-started`, `wave-finished` | Wave ушла или окончена. В `wave-started` есть отправленный текст и пропущенные Ticket-ы. В обеих может быть `limits`. |
| `narrow-round` | Состояние узкого круга исправления в PR Ticket-а Wave, один раз на Ticket и исход. |
| `budget-stop` | Бюджет остановил следующую Wave. Дальше идёт `waiting-until`. |
| `limits-hit` | Limits отказали turn-у. |
| `waiting-until`, `resumed` | Ожидание началось или кончилось. |
| `session-error` | Session упала. |
| `refused-dialog` | Unattended Session отказала запросу. Есть Subagent и причина, если они известны, и никогда нет команды. Домашняя папка пишется как `~`. |
| `human-input` | Вмешался человек. `source` — `worfy` или `observer`. |
| `background-tasks` | Изменился набор живых background task-ов. |
| `run-stopping` | Graceful Stop пришёл во время turn-а или task-ов. |
| `gate-queue` | Run отправил «Process gate queue». |
| `run-stopped` | Run окончен, с причиной. `tickets` — для `blocked-tickets` и `user-force-stop`. `lastText` — для остановки из-за отсутствия Wave. |
| `orchestrator-returned` | Orchestrator снова Session человека, после остановки, которой пришлось ждать, или после Force stop. |
| `tasks-killed` | Task-и, которых ждал run, закончились вместе с процессом, при выходе или Force stop. |

#### Windows

В модулях Autopilot нет ветвлений по платформе. Различия лежат в том, на что они опираются:

- `src/main/storage/paths.ts` даёт папку данных `%APPDATA%\worfy`, а для development-сборки `%APPDATA%\worfy-dev`, поэтому journal лежит в `autopilot` внутри неё.
- Stable copy — папка `%LOCALAPPDATA%\worfy-stable`, скопированная из `dist\win-unpacked`. Скрипт установки отказывает для цели внутри папки установщика
  `%LOCALAPPDATA%\Programs\worfy`.

На Windows важны две вещи в коде, общем для всех платформ. `refused-dialog` пишет домашнюю папку как `~` в любой форме пути, включая формы с диском и MSYS.
Ключ origin у run-а читает букву диска в пути Windows как хост: `C:/repos/x.git` даёт `c/repos/x`. Локальным путём диск считает только `remoteHasHost`, его вызывает
ключ совпадения Project-а.

#### Test-ы

Эти test-ы не вызывают модель. Contract test-ы используют настоящие Session registry, Orchestrators, launcher, journal и цикл поверх fake agent, который проигрывает
скрипты из `test/fixtures/agent-scripts/`. Test-ы проверяют, что blocker берётся и освобождается, поверх fake или подменённого `powerSaveBlocker`, но не то, что делает экран.

| Test | Что покрывает |
|---|---|
| `test/unit/autopilot-cycle.test.ts` | Цикл: когда Wave считается оконченной и каждая причина остановки. |
| `test/unit/autopilot-run.test.ts` | Run над скриптованной Session: какой результат заканчивает Wave, обе остановки, узкий круг исправления, gate queue, новая session на Wave, один run на Epic и origin. |
| `test/unit/autopilot-budget.test.ts` | Бюджет и его решение. |
| `test/unit/autopilot-limits-estimate.test.ts` | Оценка. |
| `test/unit/autopilot-resume-at.test.ts` | Когда run продолжает после отказа. |
| `test/unit/autopilot-journal.test.ts` | Формат journal. |
| `test/unit/autopilot-origin.test.ts` | Ключ origin. |
| `test/unit/autopilot-power.test.ts` | Keep-awake. |
| `test/unit/canvas-actions.test.tsx` | Кнопка, строка состояния и меню «⋯». |
| `test/unit/settings-autopilot.test.tsx` | Settings → Autopilot. |
| `test/unit/install-stable.test.ts` | Скрипт установки Stable copy. |
| `test/contract/autopilot.test.ts` | Весь run: unattended и обратно, отказы, `human-input`, отказ для собственного репозитория, каналы IPC. |
| `test/contract/autopilot-background.test.ts` | Background task-и и остановки при живых task-ах. |
| `test/contract/autopilot-limits.test.ts` | Ожидание Limits и бюджет, с часами, которые двигает test. |
| `test/contract/autopilot-journal.test.ts` | Файлы journal, строка, дописанная снаружи, отсутствие записи вне папки данных. |
| `test/contract/autopilot-wiring.test.ts` | Связка новой session на Wave в `sharedAutopilot`. |
| `test/e2e/autopilot.spec.ts` | Собранное приложение: run, ожидание Limits, бюджет, background task-и, Force stop, узкий круг исправления. |
| `test/e2e/linked-autopilot.spec.ts` | Два связанных приложения: отказ, Start anyway, Stop на двух экранах. |
| `test/e2e/browser-autopilot.spec.ts` | Что Session run-а может делать с Browser. |
