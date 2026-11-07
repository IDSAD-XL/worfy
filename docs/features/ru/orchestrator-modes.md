# Orchestrator modes

> Перевод [английской версии](../orchestrator-modes.md), commit `same-pr`.

Один Feature. **Orchestrator modes** — три настройки Project-а, которые меняют то, как работает его Orchestrator: Eco
mode, Auto-approval и Auto-continue. Они собраны в одной кнопке под полем ввода Orchestrator-а, «Modes». Эта страница
описывает меню, три его пункта, продолжение ручного turn-а Orchestrator-а после ошибки API или отказа Limits и обратный
отсчёт в его чате. Сам Orchestrator — на странице [Sessions](sessions.md). Что Auto-approval отвечает в run-е — на
странице [Auto-approval](auto-approval.md), а как run ждёт и повторяет — на странице
[Autopilot faults and recovery](autopilot-faults.md). Если термины незнакомы, начните с [Concepts](concepts.md).

## Orchestrator modes

### Behaviour

#### Меню Modes

- Кнопка стоит только под полем ввода Orchestrator-а; у обычной Session её нет. Она всегда показывает по иконке на режим
  в постоянном порядке — Eco mode, Auto-approval, потом Auto-continue: яркую, когда режим включён, приглушённую, когда
  выключен, контур для Auto-approval Shadow, бледную, пока состояние неизвестно. Ширина кнопки от состояний не меняется;
  когда в строке тесно, первой пропадает её подпись.
- Клик, Enter, Space или ArrowDown открывают меню над ней: Eco mode (вкл. или выкл.), Auto-approval с тремя положениями
  Off, Shadow и On, потом Auto-continue (вкл. или выкл.), у каждого строка рядом и tooltip. Стрелки, Home и End ходят по
  пунктам, Enter и Space выбирают, Esc закрывает меню и возвращает фокус на кнопку, Tab закрывает. Выбор пункта меню не
  закрывает: в нём видно новое состояние.
- Пункт, состояние которого ещё читается, недоступен, и его tooltip говорит «Reading …»; пункт, состояние которого
  прочитать не удалось, недоступен с причиной. Если запись не прошла, toast называет причину, а пункт читает состояние
  заново.

#### Eco mode

Eco mode пишет два поля Profile Project-а: `workflow.agents` со значением `eco` и `agents`, то есть Sonnet с effort medium
для каждой роли агента. Выключение убирает оба поля, а прежние модели ролей не возвращаются. Действует со следующего
Ticket-а. Если Profile изменили вне worfy после того, как меню его прочитало, ничего не пишется: toast говорит об этом, а
пункт показывает Profile таким, какой он сейчас.

#### Auto-approval

- Auto-approval стоит в Off, пока его не задали. Mode хранится по Project-у в собственных настройках worfy на этой Machine
  (`app-settings.json` в папке данных worfy), не в Profile, и пишет его только меню Modes. worfy читает этот файл один раз
  при старте: правка, сделанная вне worfy, видна после следующего старта, а следующая смена любой настройки Machine
  записывает поверх неё собственное состояние worfy.
- Пока worfy запущен с открытым debugging port или pipe (`--remote-debugging-port`, `--remote-debugging-pipe`) или Node
  inspector (`--inspect`), Auto-approval в Off, что бы ни было сохранено: любая программа на Machine могла бы тогда
  управлять окном worfy. Меню показывает Off, три положения недоступны, а их tooltip называет причину и сохранённый mode,
  который снова действует после старта без них. Сохранённый mode из меню в это время не меняется. В собранном worfy
  Electron fuses RunAsNode и EnableNodeCliInspectArguments выключены (`electronFuses` в `electron-builder.yml`): он
  игнорирует `--inspect` и родственные флаги, `kill -USR1` не открывает inspector (сигнал завершает worfy), а
  `ELECTRON_RUN_AS_NODE=1` запускает worfy, а не Node. Запуск для разработки (`pnpm dev`) — обычный Electron, и в нём
  оба остаются.
- В run-е Autopilot mode решает ответ на запрос разрешения: Off отказывает, Shadow отказывает и записывает, что сделала бы
  approval policy, On отвечает по policy ([Auto-approval](auto-approval.md)).

#### Auto-continue

- Auto-continue выключен для Project-а, пока его не включили. Его строка в меню — «Retry after API errors and Limits», а
  tooltip говорит, что он делает: после временной ошибки API worfy шлёт Orchestrator-у «continue» до 5 раз с растущими
  паузами, после отказа Limits ждёт сброса и продолжает, и никогда не шлёт заново сообщение человека или команду Wave.
- Он хранится по Project-у в том же `app-settings.json`, и пишет его только меню Modes: включение добавляет запись
  Project-а, выключение её убирает, записи других Project-ов остаются. Смена сразу видна в меню Modes каждого окна, и на
  Linked machine тоже. Debugging port его не выключает.
- Он действует только на Orchestrator, в двух местах. Run Autopilot читает его перед каждым повтором после временной
  ошибки API и когда ожидание Limits превысило бы 24 часа
  ([Autopilot faults and recovery](autopilot-faults.md#ожидание-limits)). Turn Orchestrator-а вне run-а продолжается, как
  сказано в следующем разделе. Обычная Session никогда не продолжается.

#### Продолжение ручного turn-а

- С включённым Auto-continue turn Orchestrator-а вне run-а, который закончился временной ошибкой API (500, 502, 503, 504,
  529, потерянное соединение, timeout запроса, оборванный поток ответа), продолжается так же, как в run-е: через 1, 5, 15,
  30 и 60 минут (±20 %), не больше пяти раз подряд, worfy шлёт Orchestrator-у новое сообщение, которое просит продолжить и
  называет, что упавший turn уже сделал за пределами Session, — никогда не сообщение человека повторно. Вызов, который
  выходит наружу и не получил результата (оборванный `git push`), не повторяется. Каждый turn судится по его собственным
  вызовам и его собственному статусу Limits, и turn, который начало уведомление background task-а, тоже.
- Отказ Limits ждёт сброса окна, которое назвал Vendor, плюс 2 минуты, как бы далеко он ни был; без времени сброса он
  пробует снова каждые 30 минут, не дольше 24 часов. Потом он шлёт то же продолжение, что run шлёт после Limits. На Codex
  окна сначала читаются заново, как их читает run (бесплатно, без токенов модели): пока какое-то ещё исчерпано, ничего не
  уходит, и ожидание длится до нового сброса этого окна. Turn, который прервал человек, никогда не продолжается.
- На Orchestrator-е Codex вид ошибки — собственный вид Codex: `serverOverloaded`, `internalServerError`, упавшее соединение
  или поток ответа и `responseTooManyFailedAttempts` временные; любая из них с HTTP status 429 — нет (Codex уже потратил
  свои повторы на rate limit). Ошибку, которую Codex повторяет сам (её строка кончается на «It tries again»), worfy
  оставляет Codex: ничего не ждёт и ничего не шлёт. Вызов Subagent-а Codex (`collabAgentToolCall`) считается вызовом,
  который выходит наружу: без его результата turn не повторяется.
- Каждый шаг — собственная строка worfy в transcript-е, под строкой, о которой она говорит; модель её не получает:
  `worfy: API error 529, retry 2 of 5 at 14:20`, `worfy: sent "continue" (retry 2 of 5)`, ``worfy: not retried: `git
  push origin main` may or may not have run``, `worfy: not retried: gave up after 5 retries`, `worfy: waiting for the
  Limits, resumes 14:20` (без времени сброса `…, no reset time reported, next try at 14:20`), `worfy: sent "continue"
  after the Limits wait`, `worfy: not continued: …` (квота или 24 часа без времени сброса), `worfy: Auto-continue is
  off; nothing was sent` и `worfy: a turn is under way; nothing was sent, its end decides`. Время местное; время другого
  дня идёт с датой. Эти строки живут, только пока работает приложение: worfy не пишет их в файл transcript-а, и после
  перезапуска их нет.
- Сообщение человека во время ожидания занимает место продолжения; сообщение, поставленное в очередь во время turn-а,
  уходит сразу после него, так что ожидание не начинается и строки о нём нет. Turn, который идёт, когда приходит время
  (уведомление background task-а), тоже занимает его место, и решает его конец. Выключенный Auto-continue, закрытая
  Session или выход из приложения отменяют ожидание, и ничего не уходит. Пока Orchestrator-ом владеет run Autopilot,
  повторяет только run. Вне run-а worfy не держит Mac бодрствующим ради ожидания: Mac, проспавший время, продолжает,
  когда проснётся. С выключенным Auto-continue turn вне run-а останавливается на ошибке API или Limits, как раньше.

#### Обратный отсчёт

- Пока Orchestrator ждёт продолжения — от своего run-а Autopilot, когда тот ждёт, иначе после ручного turn-а, — строка над
  его полем ввода отсчитывает время по секундам: `API error 529 (overloaded) · retry 2 of 5 in 4:12` с **Retry now** и
  **Cancel**, `Limits: 7-day window · resumes 14:20 (in 2:13:05)` или `Limits: no reset time reported · next try in
  27:40` только с **Cancel**. Окно названо меткой, которая есть у окна Vendor-а (`5-hour`, `7-day`, собственная у Codex);
  время местное, на другой день — с датой. У обычной Session такой строки нет.
- Retry now сразу отправляет продолжение того же повтора, и его таймер после этого ничего не шлёт. Cancel заканчивает
  ожидание, и ничего не уходит, даже когда его время прошло: ручной turn остаётся таким, каким закончился, со строкой
  `worfy: the wait was cancelled; nothing was sent`; run останавливается так, как остановился бы без Auto-continue
  ([Autopilot faults and recovery, повтор после ошибки API](autopilot-faults.md#повтор-после-ошибки-api)). Tooltip Cancel
  говорит, что будет: «Stop waiting: the run stops» или «Stop waiting: nothing is sent». Если клик не прошёл, toast
  называет причину.

#### On a Linked machine

- Меню Modes показывает режимы Project-а на той Machine, где он живёт. С полным доступом пункты меняют их там: Eco mode
  пишет Profile той Machine, Auto-approval и Auto-continue — её `app-settings.json`; на Machine окна ничего не пишется. С
  read-only доступом иконки и меню показывают состояния, каждый пункт недоступен с подсказкой read-only; Machine Project-а
  такую запись тоже отклоняет. Смена на одной Machine сразу видна в открытом меню другой. Если ответ на запись не пришёл,
  toast называет причину, а пункт читает состояние заново; пока чтение не удаётся, пункт недоступен с причиной.
- Пока worfy на Machine окна запущен с debugging port или Node inspector, Auto-approval там недоступен с причиной, и с этой
  Machine уходит только Off; Eco mode и Auto-continue меняются.
- Обратный отсчёт показывает ожидание Orchestrator-а Project-а на его Machine. В окне с read-only доступом его кнопки
  видны и ничего не делают.

### How it works

- **Режимы Orchestrator-а, а не Autopilot.** Auto-continue действует и на turn-ы, которые начал человек, а Eco mode — на
  раздачу любого Ticket-а, поэтому все три живут при Orchestrator-е, а окно Start Autopilot их только показывает.
- **Где хранится каждый режим.** Eco mode — в Profile, потому что его читает Harness, когда раздаёт Ticket. Auto-approval и
  Auto-continue — собственное состояние worfy на Machine, в его папке данных
  ([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)): по ним действует только worfy, и агент, который меняет Profile
  обычной командой, не может их включить ([ADR-0098](../../adr/0098-approval-policy.md)).
- **Продолжение, а не повтор.** Единственный способ не сделать заново то, что упавший turn уже сделал, — дать модели её же
  историю и попросить продолжить, поэтому продолжение — новое сообщение в той же Session, а исходное сообщение второй раз
  не уходит. То, что вышло наружу, оно называет собственной сводкой worfy — программа, подкоманда и короткая цель вроде
  ветки или номера PR, — и никогда текстом, который написала модель: он не должен вернуться к модели как инструкция.
- **У ожидания один владелец.** Пока Orchestrator-ом владеет run, повторяет и ждёт только run; ручной Auto-continue молчит.
  Обратный отсчёт спрашивает сначала ожидание run-а, потом ручное, а Retry now и Cancel идут тому, кто ждёт.
- **Ожидание идёт по wall clock**, как у run-а: Mac, который спал, не продолжает с опозданием на время сна. Ручное
  ожидание не держит Mac бодрствующим, в отличие от run-а
  ([ADR-0034](../../adr/0034-autopilot-keeps-display-awake.md)).

### Implementation

#### Модули

| Что | Где |
| ---- | ----- |
| Кнопка и меню Modes | `src/renderer/session/composer/Modes.tsx` |
| Eco mode | `src/main/ipc/eco-mode.ts`, `src/shared/ipc/eco-mode.ts`, `src/shared/agent/plan-preset.ts`, `src/renderer/session/modes/eco-mode.ts` |
| Auto-approval | `src/main/ipc/auto-approve.ts`, `src/shared/ipc/auto-approve.ts`, `src/main/settings/store.ts`, `src/renderer/session/modes/auto-approval.ts` |
| Auto-continue, настройка и каналы ожидания | `src/main/ipc/auto-continue.ts`, `src/shared/ipc/auto-continue.ts`, `src/main/settings/store.ts`, `src/shared/settings/app-settings.ts`, `src/renderer/session/modes/auto-continue.ts` |
| Продолжение ручного turn-а | `src/main/agent/orchestrator-continue.ts`, подключён в `src/main/agent/app-orchestrators.ts` |
| План повтора и какая ошибка временная (общие с run-ом) | `src/shared/agent/continue-plan.ts`, `src/shared/agent/turn-failure.ts`, `src/main/autopilot/turn-retry.ts`, `src/main/autopilot/limits-wait.ts` |
| Обратный отсчёт | `src/renderer/session/composer/ContinueCountdown.tsx` |

**Поток данных.** Меню читает каждый режим по его каналу (`ecoMode`, `autoApproval`, `autoContinue`) и по клику пишет другое
значение; main отвечает состоянием после записи и шлёт событие о смене каждому клиенту, включая Linked machine с доступом.
Продолжение ручного turn-а следит за событиями Session Orchestrator-а каждого Project-а; в конце turn-а оно сначала
спрашивает Limits, потом вид ошибки, и ждёт теми же частями, что и run. Обратный отсчёт читает `autoContinue.wait` и
перечитывает его по `autoContinue.waitChanged` и при каждой смене состояния run-а.

#### Test-ы

| Test | Что покрывает |
|---|---|
| `test/unit/modes-menu.test.tsx` | Кнопка и меню Modes: только у Orchestrator-а, иконки в постоянном порядке и постоянной ширины, клавиатура, пункты Eco mode, Auto-approval и Auto-continue, их чтение, запись, toast-ы и недоступные состояния. |
| `test/contract/auto-continue-setting.test.ts` | Настройка в `app-settings.json` и каналы обратного отсчёта: ожидание run-а раньше ручного, метка окна, Retry now и Cancel тому, кто ждёт, read-only доступ. |
| `test/contract/orchestrator-continue.test.ts` | Ручной turn: 529 и одно продолжение с его строками, выключенный переключатель, сообщение человека во время ожидания, переключатель, выключенный во время него, и закрытая Session, push без результата (и через разрешение, отвеченное посреди turn-а), turn, который прервал человек, сообщение, поставленное в очередь во время turn-а, отказ Limits, два Project-а, подключение в приложении, run Autopilot на той же Session и Retry now обратного отсчёта (одно продолжение, и после двойного клика, и после таймера) и Cancel (ничего не отправлено, и когда срабатывает таймер). |
| `test/contract/app-orchestrators-continue.test.ts` | Подключение в приложении на Codex: окна, как их прочитали последний раз, и бесплатное чтение Limits доходят до ручного продолжения. |
| `test/contract/codex-auto-continue.test.ts` | Auto-continue на Orchestrator-е Codex поверх fake app-server, в run-е и в ручном turn-е: `serverOverloaded` и одно продолжение, ошибка, которую Codex повторяет сам, квота, вызов Subagent-а без результата и окна, прочитанные заново при сбросе (ещё исчерпано, потом открыто). |
| `test/unit/continue-countdown.test.tsx` | Три вида строки и формат обратного отсчёта. |
| `test/contract/modes-linked.test.ts` | Три режима с Linked machine: полный доступ пишет на Machine Project-а, read-only доступ получает отказ, смена видна на другой Machine, обрыв link-а или смена уровня доступа посреди записи, обе Machine пишут одновременно, debugging port на любой из Machine. |
| `test/contract/auto-approve-setting.test.ts` | Mode Auto-approval в `app-settings.json` (перечислено на странице [Auto-approval](auto-approval.md#test-ы)). |
| `test/e2e/auto-continue.spec.ts` | Обратный отсчёт в собранном приложении: строка после 529, Retry now и Cancel. |
| `test/e2e/linked-modes.spec.ts` | Меню Modes в окне на Linked machine, два собранных worfy: полный доступ пишет Eco mode и Auto-continue на другой Machine, смена там видна сразу, read-only доступ только показывает состояния. |
