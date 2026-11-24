# Acceptance

> Перевод [английской версии](../acceptance.md), commit `same-pr`.

**Acceptance** — список проверок, которые ждут владельца во всех Project-ах Machine: ручные пункты Ticket-ов, которые ещё
никто не доказал, и Ticket-ы, которые ждут решения владельца. worfy держит эту очередь в main process, по группам, с Evidence
каждого пункта, строкой о том, есть ли изменение в Stable copy владельца, и отметкой «Sent» для решения, которое в пути.
Вкладка **Acceptance** окна её показывает, и владелец там ставит каждому пункту Pass или Fail. Решение уходит
Orchestrator-у Project-а текстом «Record owner check»; skill `owner-check` Harness-а пишет строку Evidence `owner-check`,
при Pass отмечает пункт, при Fail заводит Ticket доработки ([Evidence](evidence.md), «Кто пишет какую строку»). Сам worfy в
Ticket ничего не пишет ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Acceptance — не Stage Human review
[Pipeline](workflow.md): та Stage ждёт ревью на GitHub до merge, а Acceptance читает Evidence ручных пунктов, обычно после
него. Термины объяснены в [Concepts](concepts.md).

## Вид

### Behaviour

**Где открывается.**

- **Acceptance** — шестая вкладка toolbar-а, после Pull requests. На ней счёт пунктов Ready to check без отметки Sent
  (пункт, чьё решение «Not recorded yet», снова считается), а её tooltip — «Checks that wait for you». Она работает и без
  открытого Project-а: вид — по всем Project-ам Machine.
- Секция **Acceptance** sidebar-а считает очередь по Project-ам, а её кнопка на rail несёт счёт Ready to check
  ([App shell](app-shell.md#sidebar)). Клик по строке открывает вид на первой строке этой группы у этого Project-а.
- В Command palette есть **Acceptance** в группе View. Строка Manual check палитры (находится только при вводе) открывает
  вид на своём пункте, когда пункт есть в очереди, иначе ведёт к своему Ticket-у.
- Клик по уведомлению «is waiting for you» открывает вид на этом Ticket-е, когда очередь его держит, иначе Pipeline board
  его Project-а ([Notifications](notifications.md)). Очередь, которая не ответила к тому времени, когда уведомление
  перестаёт ждать свою страницу, считается не держащей его.

**Две панели**, как в [Pull requests](pr-inbox.md). Слева — группы, в которых есть строка, у каждой её счёт; **In work** и
**Older** закрыты, пока владелец не откроет их по заголовку. Строка показывает:

- Ticket и номер пункта;
- справа — платформу, которую называет строка `needs:` пункта, или «Sent», пока решение ждёт своей строки, или «Not
  recorded», когда оно прождало 24 часа;
- начало текста пункта простым текстом, без ручной метки и разметки Markdown; у строки Failed вместо него — слова её
  последней строки `fail`; у строки Waits for you — её `Blocked reason:`;
- Project.

Клик выбирает строку. **↑** и **↓** двигают выбор по открытым группам из любого места вида, кроме текстового поля, меню или
диалога, и останавливаются на концах; с нажатой клавишей-модификатором они ничего не делают. Других новых клавиш нет. Пока
владелец не выбрал, выбрана первая строка открытых групп — первая в Ready to check, когда там есть строка. Когда выбранная
строка уходит из очереди, выбирается строка, которая теперь стоит на её месте. Пока очередь читается, вид пишет «Reading the
Tickets…»; когда ни в одной группе нет строки — «No check waits for you».

**Выбранный пункт**, справа:

- Project, Epic, Ticket и его заголовок; под ними «Item N of M · manual · needs <platform> <copy>», где M — пункты с
  флажком в разделе «готово, когда» Ticket-а («Item N», пока модель workflow Project-а не прочитана; без части `needs` у
  пункта без строки `needs:`);
- строка Stable copy у пункта Ready to check или Update first (см. [Stable copy](#stable-copy)), с **Update worfy**, когда
  изменение есть в Available update, или с фразой, которая говорит, почему его нет;
- у пункта, чья строка `needs:` называет не платформу этой Machine, — сборка Linked machine этой платформы (см.
  [On a Linked machine](#on-a-linked-machine));
- текст пункта, нарисованный как Markdown;
- Evidence пункта: матрица этого одного пункта, с миниатюрой снимка, который открывается поверх окна, и клипом, который
  играет на месте, с его contact sheet ([Evidence](evidence.md)). Вид — первое место вне focus mode, где они показываются;
- **Prepared by the Orchestrator · n of m verified**: пункты того же Ticket-а, которые не ручные, у каждого ✓ — verified,
  ✕ — failed, ○ — ещё нет;
- **Open Ticket** (карточка Ticket-а на Canvas его Project-а, который вид сначала выбирает) и **Open PR #N**, когда у
  Ticket-а есть строка `PR:` и страница репозитория известна.

**Строка решения**, под пунктом:

- поле комментария, «Comment (required for Fail)». Fail нужен комментарий: без него кнопка неактивна, и её tooltip говорит
  об этом. В Project-е в Full mode строка под полем говорит, что слова уходят в репозиторий вместе со строкой `owner-check`;
- **Checked in:** платформа и копия, каждая — выбор. Платформа начинается с платформы Machine окна; копия — с той, что
  называет строка `needs:` пункта, иначе `stable`, когда изменение есть в Stable copy, иначе `installed`. На платформе
  Linked machine (Machine окна или подключённой Machine выбранной платформы) решение несёт commit сборки, которую та
  Machine запускает (у сборки с незакоммиченными изменениями commit-а нет, `-`), и строка показывает эту сборку. Иначе, с копией `stable` на платформе этой Machine, оно несёт commit
  Stable copy этой Machine (тот, что читает её строка Stable copy и что main шлёт вместе с очередью), и строка показывает
  его версию, когда окно — эта копия, иначе его короткий commit. Во всех остальных случаях commit — `-`, и skill пишет
  строку без него;
- **Pass** и **Fail**. Клик отправляет «Record owner check» ([Projects](projects.md), «Project settings…»): шаблон
  Project-а с пунктом, вердиктом, платформой, копией и commit-ом, а после него — слова владельца, Orchestrator-у Project-а,
  в его очередь, пока идёт ход. Текст пункта, как его показывает вид, тоже уходит: main отклоняет решение по пункту, чей
  текст с тех пор изменился («… has changed since you looked at it: reload the Acceptance view»). Пока main не ответил, обе
  кнопки неактивны с tooltip-ом «Sending…». Когда ответил, строка пишет **Sent · waits for the line (pass)** (или `fail`), и
  выбирается следующая строка. Пока пункт Sent, его Pass и Fail остаются неактивными («Sent: the decision waits for its
  line in the Ticket»), так что второе решение по ошибке не уйдёт. Через 24 часа без строки строка пишет **Not recorded
  yet (pass)**, с **Send again**, и Pass и Fail снова активны. Отказ main остаётся под кнопками: пустой шаблон, Autopilot,
  пункт, который больше не ручной пункт, ждущий владельца, изменённый текст, Orchestrator без Session.
- Пока в Project-е пункта работает Autopilot, Pass и Fail неактивны, и строка говорит почему: «Autopilot is running in
  this Project: stop it to record an owner check». На экране только для чтения первым идёт tooltip экрана только для
  чтения.

**Ticket из Waits for you** показывает «Waits for you», свой `Blocked reason:`, **Open Ticket** и **Open Orchestrator**
(Session view Orchestrator-а Project-а); Pass и Fail у него нет: он ждёт решения, а не проверки.

#### On a Linked machine

Вкладка Acceptance окна на Linked machine показывает очередь Project-ов той Machine, как Pull requests показывает её pull
request-ы. При Read only Pass и Fail неактивны с tooltip-ом только для чтения, и та Machine всё равно отклонит решение. При
Full access решение уходит Orchestrator-у Project-а на той Machine. «Checked in» начинается с платформы той Machine, а
commit — commit сборки, которую она запускает, из её `hello`. Строка Stable copy — тоже её: в Update first она пишет «Update
worfy on <name>» вместо кнопки Update worfy, которая обновила бы эту Machine.

Пункт, чья строка `needs:` называет не платформу этой Machine, показывает сборку Linked machine этой платформы: `PC build:
<build> (<name>)` на Mac, пока ПК подключён (`Mac build: …` и `Linux machine build: …` так же), иначе `PC not connected` —
так же, пока соединение открыто, но его `hello` ещё не пришёл. worfy на той стороне без этого вида заставляет вид сказать
`Update worfy on <name>: its worfy has no Acceptance view yet`; окно, чья Machine в `hello` называет свою сборку, но не
платформу, пишет `Update worfy on <name>: it does not say its platform`. Другая Linked machine без платформы может
оказаться и Mac-ом и не считается. Снимки и клипы по связи не передаются, как на странице [Evidence](evidence.md). См.
[Link](link.md), «On a Linked machine».

### How it works

Окно читает очередь один раз через `acceptance.get`, а потом принимает каждое `acceptance.changed`; счёт вкладки и секция
sidebar-а читают ту же копию, поэтому окно спрашивает main один раз, что бы её ни показывало. Вид только рисует: группы,
строка Stable copy и отметки Sent приходят из main. Само окно держит выбор, какие группы открыты, решения, на которые main
ещё не ответил, и те, на которые он ответил раньше, чем очередь пометила их Sent. Работает ли Autopilot — из
`autopilot.state` и `autopilot.changed` для Project-а выбранной строки; режим Project-а — из `checks.repos`; ссылки и превью
Evidence берут модель workflow Project-а и папку файла Ticket-а, как focus mode. Вид открывает эту модель, только пока он на
экране, и держит её, пока выбор ходит по строкам одного Project-а: открытая модель делает fetch главной ветки Project-а
([ADR-0107](../../adr/0107-workflow-read-from-main-branch.md)). Фокус клавиатуры в списке следует за выбором. Текст пункта в
строке списка и в матрице Evidence — простой текст; панель рисует его как Markdown.

Окно на Linked machine отправляет `acceptance.get`, `acceptance.changed` и `actions.ownerCheck` той Machine по их отметкам
доступа, как любой другой канал ([Link](link.md)). Сборка и платформа каждой Linked machine приходят из её `hello`, которое
main держит, пока соединение открыто, и отдаёт окнам с `linked.state`. Значение платформы, которого эта сборка не знает,
отбрасывается, а остальное в `hello` сохраняется, так что такая Machine читается как Machine без платформы.

### Implementation

- `src/renderer/acceptance/AcceptanceView.tsx`: вид, две его панели и строка решения.
- `src/renderer/acceptance/useAcceptance.ts`: очередь в окне, выбор, `sendDecision`.
- `src/renderer/acceptance/open.ts`: открытие вида на строке, Open Ticket и Open Orchestrator.
- `src/renderer/acceptance/acceptance.css`; вкладка — в `src/renderer/shell/Toolbar.tsx`, вид смонтирован в
  `src/renderer/shell/AppShell.tsx`.
- Входы: `src/renderer/shell/sidebar/AcceptanceSection.tsx` (секция и badge её rail),
  `src/renderer/palette/commands.ts` (Acceptance и строки Manual check),
  `src/renderer/canvas/overlays/NotificationTarget.tsx` (клик по уведомлению «is waiting for you»).
- `src/shared/acceptance/linked-build.ts`: сборка Linked machine для пункта, commit решения, проверенного там, и «Update
  worfy on <name>».
- Решение в main: `actions.ownerCheck` (`src/shared/ipc/actions.ts`), его обрабатывает `ActionLauncher.ownerCheck`
  (`src/main/actions/launch.ts`), шаблон и его подстановки — в `src/shared/projects/action-templates.ts`.
- Test-ы: `test/unit/acceptance-view.test.tsx` (группы, вкладка, ↑ ↓, каждый вид строки Stable copy, Fail без комментария,
  Autopilot, Pass, Sent и Not recorded yet, отказ, Waits for you, окно на Linked machine),
  `test/unit/acceptance-section.test.tsx` (счёт по Project-ам, badge rail, клик), случаи «куда ведёт строка Manual check»
  в `test/unit/palette-manual-check-row.test.tsx`, `test/unit/notification-ticket-click.test.tsx` (клик по уведомлению «is
  waiting for you»), `test/unit/acceptance-linked-build.test.ts` (строка сборки и commit Linked machine);
  `test/e2e/acceptance.spec.ts` (собранное приложение на fake agent: пункт со снимком и клипом, Pass доходит до
  Orchestrator-а, строка, записанная в Ticket, убирает пункт, ↑ ↓, снимки на 1280 и 1600 px в обеих темах),
  `test/e2e/sidebar-rail.spec.ts` (badge на rail и вход в вид в собранном приложении), `test/e2e/linked-acceptance.spec.ts`
  (два собранных worfy: очередь другой Machine, Read only).

## Очередь

### Behaviour

**Что ждёт владельца.**

- Ручной пункт раздела «готово, когда» Ticket-а (пункт с ручной меткой Profile-а, `(manual)` или старой русской), у
  которого нет `[x]` и который не verified. «Verified» — состояние, которое пункту дают его строки Evidence: у ручного
  пункта — строка `owner-check`, `screenshot` или `video` с `pass` на платформе и копии, которые называет его строка
  `needs:`. Пункт, чья последняя строка Evidence — `fail`, всё ещё ждёт.
- Ticket, который сам ждёт владельца: `blocked` с `Waits: owner`. Проверка `Waits: owner` — та же, которой очередь Epic-ов
  Autopilot-а отличает Ticket-ы владельца, одна функция на обоих; Autopilot ещё оставляет владельцу Ticket без статуса, а
  очередь такой Ticket ждущим не показывает.
- Пункт, который не ручной, никогда не ждёт владельца. Он показывается рядом с ручными пунктами своего Ticket-а как то, что
  подготовили агенты и Orchestrator.

**Группы**, в этом порядке; у каждой счёт — число её строк:

| Группа | Что в ней |
|---|---|
| Ready to check | Пункт, который ждёт, и его изменение можно посмотреть: Ticket done в checkout-е (влит), или Ticket сам ждёт владельца (Orchestrator подготовил приёмку). |
| Update first | То же, но изменения ещё нет в Stable copy владельца (см. [Stable copy](#stable-copy) ниже). Stable copy есть только у Project-а, чей репозиторий — репозиторий самого worfy. |
| Waits for you | Ticket, который ждёт владельца, и у него нет ждущего пункта: решение, а не проверка. Строка показывает его `Blocked reason:`. |
| Failed | Ручной пункт, чья последняя строка Evidence — `fail`, в каком бы состоянии ни был его Ticket. |
| In work | Пункт, который ждёт, а его изменение не влито: Ticket open, claimed, заблокирован для кого-то другого или done только в ветке своего worktree. |
| Older | Пункт Ticket-а, закрытого больше 14 дней назад (время его строки `Status:`). Ticket, в Status которого время не читается, в Older не попадает. |

Внутри группы строки идут по Project-у, в порядке списка Project-ов, затем по Epic-у, номеру Ticket-а и номеру пункта.

**Sent.** Решение, которое владелец отправил по пункту (Pass или Fail), помечено на этом пункте «Sent», пока в файле
Ticket-а в checkout-е не появится новая строка `owner-check` с тем же вердиктом; тогда отметка уходит. Старая строка с тем же
вердиктом не считается: Fail, отправленный по пункту, который уже падал, ждёт новой строки fail. Через 24 часа после
отправки без строки отметка пишет «Not recorded yet». Второе решение по пункту заменяет первое. Отметка уходит и тогда,
когда пункт больше не ждёт владельца или его текст переписали. Перезапуск worfy отметки сохраняет.

### How it works

Очередь считается в main process над моделью workflow каждого Project-а — той же моделью, которую читают Canvas и
уведомления «is waiting for you» ([Notifications](notifications.md)). Модель поддерживается слежением за файлами Ticket-ов,
так что, пока ничего не меняется, ни одна команда Profile-а не запускается; сама очередь запускает gh и git только для
строки Stable copy (ниже). Очередь считается заново, когда меняется модель, список Project-ов или отметка Sent, когда
отметка становится «Not recorded yet», когда приходит ответ для строки Stable copy, и раз в минуту. «Влит» читается из одной
модели: список Ticket-ов читается с главной ветки Project-а
([ADR-0107](../../adr/0107-workflow-read-from-main-branch.md)), поэтому у Ticket-а, done там, изменение влито.

Один ответ покрывает все Project-ы Machine: окно спрашивает один раз, без Project-а в запросе, и после каждого изменения
снова получает всю очередь. Строка несёт всё, что нужно виду: пункт с его строками Evidence, пункты Ticket-а, которые не
ручные, отметку Sent и строку Stable copy у пункта Ready to check или Update first.

Отметки Sent — собственное состояние worfy, в папке данных Project-а
([ADR-0005](../../adr/0005-worfy-own-state-inventory.md)): Project, Epic, номера Ticket-а и пункта, hash текста пункта,
вердикт, время и число строк `owner-check` с этим вердиктом, которые были у пункта тогда; строка пришла, когда их стало
больше. Слов владельца и текста пункта там нет. Main ставит отметку только после того, как текст решения ушёл
Orchestrator-у, поэтому пункт никогда не пишет «Sent» для решения, которое не ушло. Ticket, которого в модели больше нет,
сохраняет свои отметки, а модель, которую не удалось прочитать, ни одну не снимает.

#### On a Linked machine

Linked machine читает очередь Project-ов этой Machine, пока включено «Linked machines can work with my Projects», так же,
как она читает остальное живое состояние Project-ов. Project, который держат только на этой Machine, исключается из ответа и
из каждого изменения, отправленного после него.

### Implementation

- `src/shared/acceptance/queue.ts`: правило (`itemWaitsForOwner` и `ownersOwn` из `src/shared/autopilot/epic-queue.ts`) и
  группы (`acceptanceQueue`), чистые функции над моделями.
- `src/main/acceptance/service.ts`: служба. Она следит за каждым Project-ом списка через workflow hub
  (`src/main/workflow/watch.ts`), держит отметки Sent и снимает те, чья строка пришла.
- `src/main/acceptance/sent-store.ts`: отметки Sent, `acceptance-sent.json` в папке данных Project-а.
- `src/shared/ipc/acceptance.ts` и `src/main/ipc/acceptance.ts`: вызов `acceptance.get` и событие `acceptance.changed`.
  Служба стартует вместе с приложением (`src/main/index.ts`).
- Test-ы: `test/unit/acceptance-queue.test.ts` (правило, группы и их порядок), `test/contract/acceptance-service.test.ts`
  (служба над двумя временными Project-ами: ответ, изменение после правки файла Ticket-а, отметки Sent через новый экземпляр
  службы), `test/contract/acceptance-linked.test.ts` (очередь и решение по связи, сборка из `hello`).

## Stable copy

### Behaviour

Каждый пункт Ready to check и Update first несёт одну строку, которая говорит, есть ли его изменение в Stable copy
владельца — копии worfy, в которой владелец проверяет:

- **In your Stable copy 0.4.N — the change is there since 0.4.M.** Пункт остаётся в Ready to check.
- **Not in your Stable copy yet: it runs 0.4.K, the change is in 0.4.M.** Пункт уходит в Update first. Когда изменение есть
  в Available update, строка предлагает **Update worfy**; иначе она говорит, что `main` ждёт зелёного CI. Копия, которая не
  проверяет обновления (dev-запуск: Update включён только в Stable copy), не может знать ни того, ни другого, и строка так и
  говорит: «This copy does not check for updates: update from your Stable copy».
- **Stable copy not checked**, с причиной: на этой Machine не найдена Stable copy, GitHub не ответил, не найден влитый PR,
  commit-а Stable copy или merge commit-а нет в этом checkout-е (worfy никогда не делает fetch репозитория Project-а ради
  этой строки) или git не ответил. Пункт остаётся в Ready to check, а строка спрашивается снова примерно через 5 минут.

Числа — номера сборок, как worfy показывает свою версию: `0.4.N` — major и minor из `package.json` commit-а и число
commit-ов до него. `0.4.M` — первая сборка с изменением; Ticket из нескольких merge-ей есть в копии, только когда есть все
они, начиная со сборки последнего. У shallow clone честного счёта нет, поэтому там строка называет commit-ы их коротким SHA.

Stable copy есть только у Project-а, чей репозиторий — репозиторий самого worfy (`origin` — `IDSAD-XL/worfy`). Строка любого
другого Project-а говорит только **merged #N** (или **merged** у Ticket-а, done без PR) или **not merged**.

### How it works

- Commit Stable copy: когда это окно — Stable copy, собственный commit этого запуска, прочитанный один раз (не тот, что
  сохранила последняя проверка обновлений: сразу после перезапуска в Update она ещё называет прежнюю копию); иначе, и пока
  этот commit не известен, — тот, что называет файл рядом с копией (`worfy-stable.json`, его пишет установка). Очередь
  называет и этот commit (`stableCommit`): commit решения, которое владелец проверил в Stable copy.
- Merge commit — commit строки `PR:` Ticket-а, иначе влитого PR его ветки; его спрашивают у gh под GitHub-аккаунтом
  Project-а. Ticket, который ждёт владельца без своего PR, берёт merge-и своих блокеров, которые done. gh спрашивается один
  раз на влитый PR, только для пунктов Ready to check и Update first, и ответ хранится до конца запуска: merge commit влитого
  PR не меняется. Ответ, который ещё может измениться (не влит, нет в checkout-е, отказ), спрашивается снова примерно через
  5 минут.
- Есть ли изменение: `git merge-base --is-ancestor <merge> <Stable copy commit>` в checkout-е Project-а. Номера версий — из
  `git rev-list --count` и `package.json` commit-а, в shallow clone — никаких.
- Есть ли изменение в Available update: по номерам сборок, когда оба известны, иначе через
  `git merge-base --is-ancestor <merge> <its commit>`; Update worfy предлагается, только когда одно из них говорит да. Когда
  этого commit-а нет в checkout-е, строка так и говорит: «The update's commit is not in this checkout: fetch to check».
- Ничего не пишется ни в Project, ни на GitHub, и ничего не ждут: строка, которая ещё не известна, пуста, и очередь
  отправляется снова, когда она приходит.

### Implementation

- `src/main/acceptance/stable-line.ts`: строка Stable copy (`StableLine`), её вопросы к gh и git и сохранённые ответы;
  `src/main/ipc/acceptance.ts` даёт ей gh трекера PR и Available update службы Update.
- Файл рядом со Stable copy: `src/main/update/stable-copy.ts`; текст версии — `src/shared/version-number.ts`.
- Test-ы: `test/unit/acceptance-stable-line.test.ts` (текст строки, версии, merge-и блокеров, один вызов gh на влитый PR),
  `test/contract/acceptance-stable-copy.test.ts` (временный репозиторий worfy и Stable copy: в копии, не в ней, commit не в
  checkout-е и нет второго вызова gh для более позднего снимка).
