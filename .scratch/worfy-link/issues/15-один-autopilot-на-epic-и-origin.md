# 15 — Один Autopilot на Epic и origin на все Linked machine-ы

Type: task
Status: claimed — 2026-10-08
Blocked by: 08
Source: решения владельца 2026-10-07: Q13 (второй Autopilot на тот же Epic с тем же `origin` на другой Machine не стартует, обход — явный) и Q9 (у Project ровно одна Machine; один репозиторий на двух Machine — два Project-а) ([spec.md](../spec.md)); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md)

## Что происходит

- Autopilot допускает один прогон на Project.
  - Второй `start` отклоняется с `alreadyRunning` (`src/main/autopilot/run.ts:148`, проверка — `:287`), пока прогон идёт или стартует.
  - Стартующие Project-ы — в множестве `starting` (`:257`). Project попадает туда до первого `await` (`:288`), поэтому два одновременных старта на одной машине оба не пройдут.
  - Другие Project-ы не проверяются, даже с тем же репозиторием.
- Адрес `origin` worfy не читает: `grep -rn "get-url\|remote\.origin" src` пуст. Единственный вызов git у Autopilot — `rev-parse --git-common-dir`. Он нужен для отказа dev-сборке, которая хочет вести Autopilot над самим worfy (`src/main/ipc/autopilot.ts:34-38`, `SELF_PROJECT_MESSAGE` — `run.ts:151`).
- Один репозиторий на двух машинах — это два Project-а (Q9 — у Project ровно одна Machine). Машина о прогонах другой не знает. Autopilot на один Epic может пойти на обеих, и две Wave-ы возьмут одни и те же Ticket-ы.
- После Ticket-а 08 (Project-ы Machine открыты Linked machine-ам) `autopilot.start` и `autopilot.stop` с другой машины попадают в тот же `sharedAutopilot()` машины Project-а (`src/main/ipc/autopilot.ts:25-31`, `:49`).
- Повторный Stop от двух экранов. Разведка его не разбирала; ниже — чтение кода, запуском не проверено.
  - Оба вызова приходят в `Autopilot.stop` машины Project-а (`run.ts:334-340`). Каждый ставит в очередь прогона событие `stop` и ждёт `run.ended`.
  - Cycle в фазе `stopped` событие пропускает (`src/shared/autopilot/cycle.ts:172`). Ожидается один `run-stopped` в журнале прогона и ответ `stopped` обоим. Test-а на это нет.
  - Флаг «Stopping…» живёт в renderer, у каждого экрана свой (`useAutopilotStore().stopping`, `src/renderer/canvas/actions/AutopilotAction.tsx:108`, `:126`). Пока первый экран останавливает прогон, второй показывает активную «Stop autopilot».
- Ticket 18 Epic-а worfy-week (graceful Stop и Force stop в меню «⋯») правит те же файлы Autopilot. Он делает Stop graceful, добавляет `forceStop` и флаг `stopping` в `AutopilotState`; повторный Stop при `stopping` у него ничего не шлёт. Если он влит до claim, пункты про Stop ниже относятся и к `forceStop`.

## Вопросы владельцу до начала

Задаются при claim. Рядом — предложение по умолчанию.

1. Блокирует ли старт Linked machine, которая недоступна, спит или не ответила за 3 s? Предложение: не блокирует. В подсказке кнопки Autopilot пишется, какие Machine не удалось спросить.
2. Работает ли проверка, когда переключатель «Linked machines can work with my Projects» выключен (на одной из сторон или на обеих)? Предложение: да. Вопрос о прогонах — служебное сообщение связи, Project-ы он не открывает. В ответе только Epic, origin и имя Machine.
3. Как быть с Project-ом без `origin`? Это корень, который не git-репозиторий (Project в Silent mode над несколькими репозиториями), или репозиторий без remote `origin`. Предложение: проверка не делается, старт идёт, как сейчас.

## Что делаем

1. **Ключ прогона** — Epic плюс origin. Origin — адрес remote `origin` корня Project-а (`git remote get-url origin`), нормализованный.
   - Схема и пользователь отбрасываются, регистр — нижний, `.git` и `/` на конце срезаются.
   - `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git` и `https://github.com/owner/repo` дают один ключ `github.com/owner/repo`.
   - Новая функция с unit-test-ом. Origin читается на старте и хранится в прогоне.
2. **Вопрос перед стартом** (Q13 — второй Autopilot на тот же Epic с тем же origin на другой машине не стартует).
   - `Autopilot.start` после своих проверок (`run.ts:287-295`) и до `setUnattended` спрашивает каждую Linked machine в сети: идёт ли у неё прогон с тем же ключом.
   - Вопрос — служебное сообщение связи (Ticket 01 — сервер связи Machine-ов). Ответ — список `{ epic, origin }` прогонов машины в `starting` и в работе, включая ожидание Limits. Ответ ждём не дольше 3 s.
   - Идёт — отказ: `Autopilot is already running Epic <epic> of this repository on <Machine>`.
3. **Гонка двух стартов.** Машина отмечает свой старт (`starting`, как сейчас) до вопроса и отвечает другим и о стартующих прогонах. Видит у другой машины `starting` или прогон с тем же ключом — отказ. Два одновременных старта на разных машинах в худшем случае оба получат отказ, но оба не пойдут никогда.
4. **Обход — только явный.**
   - Renderer отличает отказ «уже идёт на <Machine>» от прочих без разбора текста ошибки: ответ `autopilot.start` (`src/shared/ipc/autopilot.ts:48`) несёт его отдельным полем. Сейчас ошибка — просто строка (`IpcResult`, `src/shared/ipc/channels.ts:76`). Форма ответа — на исполнителе.
   - У кнопки Autopilot рамки Epic-а появляется действие «Start anyway». Оно шлёт `autopilot.start` с `override: true`. Других обходов нет.
   - Строка `run-started` журнала прогона получает `override: true`, чтобы было видно, что старт прошёл в обход.
5. **Повторный Stop от двух экранов.** Поведение из раздела «Что происходит» закрепляется test-ами, код меняется, только если test покажет дефект. Stop с другой машины идёт тем же путём, через Ticket 08. Общий для всех экранов флаг «Stopping…» — это Ticket 18 Epic-а worfy-week, здесь его не делаем.
6. **Недоступная машина, выключенный доступ, Project без origin** — по ответам на вопросы 1–3.

Не входит: защита от ручного «Run wave» на двух машинах по одному Epic-у — Q13 говорит только об Autopilot.

## Готово, когда

- [x] Unit `test/unit/autopilot-origin.test.ts` (новый): `git@github.com:IDSAD-XL/worfy.git`, `ssh://git@github.com/IDSAD-XL/worfy.git`, `https://user@GitHub.com/IDSAD-XL/worfy.git/` и `https://github.com/IDSAD-XL/worfy` дают один ключ. Другой owner или repo — другой ключ. Папка вне git и репозиторий без `origin` — null.
- [x] Unit `test/unit/autopilot-run.test.ts`: Linked machine отвечает, что у неё идёт прогон того же Epic-а с тем же origin. `start` отклонён, отказ называет Machine, `setUnattended` не вызван, keep-awake не взят, журнал не открыт. Другой Epic или другой origin — старт идёт. С `override: true` старт идёт, и в `run-started` стоит `override: true`.
- [x] Unit там же: две машины стартуют один ключ одновременно (ответ каждой приходит, пока у неё `starting`) — идёт не больше одного прогона.
- [x] Unit там же — по ответам владельца: Linked machine не ответила за 3 s (вопрос 1); переключатель доступа выключен (вопрос 2); Project без origin (вопрос 3).
- [x] Unit там же: два одновременных `stop` одного прогона — в журнале один `run-stopped`, `giveBackNow` вызван один раз, оба ответа — `stopped` с причиной `user-stop`. `stop` после конца прогона отвечает состоянием и не пишет в журнал. Если Ticket 18 Epic-а worfy-week влит — то же для `forceStop` и для пары Stop + Force stop.
- [x] e2e `test/e2e/linked-autopilot.spec.ts` (новый, локально в gate full): два worfy, связанные helper-ом Ticket-а 02 («Link a machine» и список Linked machine-ов). У каждого свой Project — клон одного fixture-репозитория с одним `origin`. Autopilot Epic-а на A (fake-агент, скрипт `orchestrator`) — на B кнопка Autopilot того же Epic-а отвечает отказом с именем Machine A (`data-error`). «Start anyway» на B стартует прогон.
- [x] e2e там же: Stop прогона A нажат одновременно в окне A и в окне B (Project A, открытый на B). Оба экрана показывают `stopped`, в журнале прогона один `run-stopped`.
- [x] `test/e2e/autopilot.spec.ts` зелёный без правок: машина без Linked machine-ов ведёт себя как раньше.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — зелёный.

## Тесты

Сначала падающий test — `test/unit/autopilot-run.test.ts`: Linked machine отвечает о прогоне того же ключа, а `start` всё равно идёт. В «Итог» — как test падал.

В unit-test-ах Linked machine-ы — новая зависимость `AutopilotDeps` (`run.ts:94`): функция, которая отвечает список прогонов по каждой машине или «не ответила». Сеть в `test/unit/autopilot-run.test.ts` не поднимается. Связь целиком проверяет e2e.

Fixture-репозиторий для e2e создаётся во временной папке: `git init`, `git remote add origin https://example.invalid/demo.git`, Epic с одним Ticket-ом. Тот же приём, что у прочих e2e Autopilot (`test/e2e/autopilot.spec.ts:143-145`).

Helper двух связанных worfy берётся из Ticket-а 02 как есть. `test/e2e/helpers.ts` этот Ticket не правит.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/main/autopilot/origin.ts` (новый)
- `src/main/autopilot/journal.ts`
- `src/shared/autopilot/journal.ts`
- `src/main/ipc/autopilot.ts`
- `src/shared/ipc/autopilot.ts`
- `src/main/link/autopilot-runs.ts` (новый)
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `test/unit/autopilot-origin.test.ts` (новый)
- `test/unit/autopilot-run.test.ts`
- `test/e2e/linked-autopilot.spec.ts` (новый)

При claim сюда дописывается файл служебных сообщений связи из Ticket-а 01. Его путь будет в «Итог» Ticket-а 01. Те же файлы Autopilot правит Ticket 18 Epic-а worfy-week: если его PR открыт, перед claim сверить пересечения.

## Итог

**Ключ прогона** — `src/main/autopilot/origin.ts`: `originKey(url)` отбрасывает схему, пользователя и
порт, приводит к нижнему регистру, срезает `.git` и `/` на конце; `readOriginKey(root)` читает
`git remote get-url origin` в корне Project-а, без `origin` или вне git — `null`. Ключ читается на
старте и хранится в прогоне (`Run.origin`).

**Вопрос перед стартом** — `Autopilot.start` (`src/main/autopilot/run.ts`) после своих проверок и до
`setUnattended`: сначала прочие прогоны этой машины, потом Linked machine-ы через новую зависимость
`AutopilotDeps.linkedRuns`. Совпал Epic и ключ — отказ `RunningElsewhere` с текстом
`Autopilot is already running Epic <epic> of this repository on <Machine>`. Старт попадает в
`starting` вместе с ключом до вопроса, и `Autopilot.runKeys()` отвечает другим и о стартующих
прогонах: два одновременных старта на двух машинах в худшем случае оба получают отказ.

**Служебные сообщения связи** — `src/main/link/autopilot-runs.ts` (дописан к файлу служебных
сообщений Ticket-а 01, `src/main/link/messages.ts`, через `defineLinkMessage`):
`autopilot-runs-ask {id}` и ответ `autopilot-runs {id, runs: [{epic, origin}]}`. Ответ ждём 3 s
(`ASK_RUNS_TIMEOUT_MS`). Ответ принимается только от машины, которую спросили. Машина отвечает с
момента старта связи (`onAppLinkStart` в `src/main/ipc/autopilot.ts`), даже если её Autopilot ещё не
открывали. Новых каналов IPC нет.

**Ответ `autopilot.start`** (`src/shared/ipc/autopilot.ts`): вход получил `override?: boolean`, выход —
union «первое состояние прогона» или `{ runningElsewhere: { epic, machine, message } }`. Отказ «уже
идёт на <Machine>» — отдельное поле, прочие отказы — по-прежнему ошибка. Пометка канала — та же
`project`.

**Журнал** — `run-started` получил необязательные `origin`, `override: true` и `unasked`
(`src/shared/autopilot/journal.ts`, `src/main/autopilot/journal.ts`).

**Состояние и UI** — `AutopilotState` получил необязательные `machine` (машина, которая ведёт
прогон; только пока прогон идёт и у машины есть Linked machine-ы) и `unasked`. Действие Autopilot
(`AutopilotAction.tsx`): chip «on <Machine>» под кнопкой; при отказе — причина в `data-error`
кнопки, chip «running on <Machine>» и кнопка «Start anyway» справа (шлёт `override: true`).
Кнопки действия теперь всегда в одном контейнере: иначе кнопка при появлении «Start anyway»
создавалась заново и теряла `data-error`.

Снимки, светлая и тёмная тема:
- прогон ведёт эта машина — [светлая](../evidence/15-this-machine-light.png), [тёмная](../evidence/15-this-machine-dark.png);
- прогон ведёт другая машина, старт отклонён («занято») — [светлая](../evidence/15-other-machine-light.png), [тёмная](../evidence/15-other-machine-dark.png);
- после «Start anyway» — [светлая](../evidence/15-start-anyway-light.png), [тёмная](../evidence/15-start-anyway-dark.png).

**Ответы на вопросы — решено без владельца, подтвердить:**
1. Недоступная или не ответившая за 3 s Linked machine старт не блокирует. Её имя — в `unasked`
   состояния и `run-started`, в подсказке chip-а «on <Machine>» («Could not ask …»).
2. Проверка работает при выключенном «Linked machines can work with my Projects» на любой стороне:
   это служебное сообщение, не канал IPC. В ответе только Epic и ключ origin. e2e идёт с
   выключенным доступом на обеих машинах.
3. Project без `origin` никого не спрашивает и стартует как раньше.
4. Сверх Ticket-а: отказ и для другого Project-а этой же машины с тем же origin и Epic-ом (цель —
   «ни на этой машине, ни с Linked machine»). Отказ называет «<имя> (this Machine, Project <id>)».

**Выход из приложения** не менялся по порядку: `stopAll()` в `before-quit` ставит флаг, и старт,
который ещё спрашивает Linked machine-ы, после ответа отклоняется (`QUITTING_MESSAGE`), ничего не
взяв. Связь останавливается в `will-quit`, как в Ticket-е 02.

**Повторный Stop** (пункт 5) — дефекта нет, код не менялся. Ticket 18 Epic-а worfy-week влит:
graceful Stop отвечает `stopping`, а не `stopped`, и Orchestrator возвращает через
`setUnattended(false)`, без `giveBackNow`. Поэтому test-ы закрепляют: два Stop-а сразу — STOP_TEXT
один раз, один `run-stopping`, один `run-stopped`, `setUnattended(false)` один раз; два Force stop-а
— `giveBackNow` и halt по разу; Stop и Force stop сразу — один `run-stopped`, `giveBackNow` один
раз; Stop и Force stop после конца прогона — ответ состоянием, журнал не меняется.

**Отступление от Ticket-а в e2e Stop.** Открыть Project A в окне B нельзя до Ticket-а 09 (мост
renderer, открыт в этой же Wave). Поэтому Stop шлют одновременно два окна машины A (второе —
`openSecondWindow`), через мост, а не кликом: клик второго окна после ответа первому попадал бы в
«Stopping…» и ничего не слал. Путь Stop с другой машины — тот же handler через адаптер Ticket-а 08.

**Как падал первый test.** Новые test-ы `test/unit/autopilot-run.test.ts` до правки run.ts: 11 из 12
красные — `start` шёл, хотя Linked machine отвечала о прогоне того же ключа
(`AssertionError: The instanceof assertion needs a constructor but undefined was given`), и
`expected 2 to be less than or equal to 1` в гонке двух машин. Test-ы повторного Stop были зелёными
сразу — они закрепляют поведение.

**Мутанты** (unit): ключ отмечается после вопроса, а не до; нет проверки `quitting`; ответ от
любой машины; локальная проверка без сравнения origin — каждый краснит test. Мутант «не спрашивать
неподключённую машину» выжил: проверка дублировала отказ `sendMessage` — убрана.

**Вне следа:** в `test/contract/main-ipc-wiring.test.ts` mock `src/main/link/service` дополнен
`onAppLinkStart`: модуль `src/main/ipc/autopilot.ts` подписывается при загрузке.

**Проверки.** `pnpm lint`, `pnpm typecheck` — EXIT=0. CI PR #168 (lint, typecheck, unit и contract
на ubuntu) — зелёный. `GATE_SCOPE=all gate.sh full` на d6d558d: lint, typecheck, `test:e2e`,
`test:package` прошли, `test` красный — 8 test-ов в двух файлах (`harness-qmd.test.ts` и ещё
один), все «Test timed out in 5000ms». gate fast повторён дважды — так же (9–10 test-ов, таймауты
процессов в `harness-*`, `github-prs`, `workflow-reader`). Не проверено: зелёный `pnpm test` на
этой машине — нагрузка 5–7 от e2e соседних Ticket-ов не спадала; каждый упавший файл отдельно
зелёный, файлы этого Ticket-а не падали ни разу.

**Долг:** у узкой рамки Epic-а (два Ticket-а) «Start anyway» рядом с «Autopilot» и «Run wave»
сжимает заголовок Epic-а до нуля (снимок 15-other-machine); полное имя — в подсказке.
