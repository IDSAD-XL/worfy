# 32 — Autopilot не даёт экрану погаснуть на время прогона

Type: task
Status: done 2026-10-06
PR: #70
Blocked by: —
Source: решение владельца 2026-10-06 ~23:40 (вариант (а)); вечер 2026-10-06, Wave 9 плана (Ticket-ы 24 и 28) и круг доработки Ticket-а 11: транскрипт Orchestrator-а `~/.claude/projects/-Users-alexey-Stuff-CanvasForAI/f6ab7045-416c-471a-a78d-433567aefa5a.jsonl`, записи 18:00Z–20:19Z; [spec.md](../spec.md), тема A; [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md), пункт 7; Ticket 04; урок «Заблокированный экран macOS» в [docs/lessons/agents.md](../../../docs/lessons/agents.md)

## Что произошло

- С 2026-10-06 CI — только lint, typecheck, unit и contract test-ы на Linux (решение владельца о
  цене CI, [PR #42](https://github.com/IDSAD-XL/worfy/pull/42)). e2e и собранное приложение
  проверяет только локальный `gate full` перед каждым мержем (`rules.md` Profile-а worfy). Значит,
  каждому PR Wave нужен Mac, на котором окно Electron видно.
- Пока экран Mac заблокирован, Electron не показывает окно. e2e падают с «the window was not shown
  within 30 s» — и на ветке, и на чистом main (урок в `docs/lessons/agents.md`).
- Вечером 2026-10-06 Wave 9 плана (Ticket-ы 24 и 28) вёл Autopilot, прогон 3 (журнал `2026-10-06T16-43-26-654Z-f08618.jsonl`), а не Orchestrator из CLI.
  Экран держал включённым внешний `caffeinate -d`. Около 20:00 по местному времени (UTC+3) он
  кончился. Дальше экран гас и блокировался дважды: примерно 21:00–21:06 (круг доработки Ticket-а
  11) и 21:50–23:05 (проверка 28, `gate full` 24 и 28). `ioreg` показывал
  `IOConsoleLocked = Yes`. Агенты ждали разблокировки циклом `until` по `IOConsoleLocked`. Ни один
  PR не влили, пока человек не разблокировал Mac.
- Autopilot сейчас держит `prevent-app-suspension` (ADR-0024, пункт 7): система не засыпает, а
  экран гаснуть может. Когда экран гаснет, macOS блокирует его (настройка «Lock Screen → Require
  password after screen saver begins or display is turned off»). Ночной прогон Autopilot встал бы
  так же.
- По определению Autopilot в [CONTEXT.md](../../../CONTEXT.md) любая точка, где понадобился
  человек, — дефект.

## Решение владельца

2026-10-06 ~23:40 — вариант (а). Autopilot на время прогона держит экран включённым
(`prevent-display-sleep`). Правило «на ночной прогон Mac не блокируют вручную» — в README и
HANDOFF.

Вариант (б) — e2e работают на заблокированном экране — пока отвергнут.

## Что делаем

**ADR-0034 до кода.** Номер зарезервировал Orchestrator. ADR заменяет пункт 7 ADR-0024 в части
типа keep-awake. ADR-0024 не правится. Черновик — ниже, раздел «Черновик ADR-0034».

**1. Один blocker другого типа.**

- `KEEP_AWAKE_TYPE` в `src/main/autopilot/power.ts` — `'prevent-display-sleep'`. По документации
  Electron этот тип держит активными и систему, и экран. Он имеет приоритет над
  `prevent-app-suspension` (`node_modules/electron/electron.d.ts`, `PowerSaveBlocker.start`).
- Второй blocker `prevent-app-suspension` не нужен. Один `start` на прогон, один `stop`.
- Когда blocker берётся и отпускается — не меняется:
  - берётся на старте прогона;
  - отпускается на остановке и на `will-quit`;
  - после Stop с живыми background task-ами (ADR-0029) — когда задачи кончились.

  Каждый прогон держит свой blocker, как сейчас.
- Комментарий в шапке `power.ts` описывает новый тип и ссылается на ADR-0034.

**2. Ожидание сброса Limits — тот же blocker: экран не гаснет.** Почему:

- После сброса Wave продолжается. Orchestrator шлёт implementer-ов и проверяющих, они гоняют e2e
  и `gate full`. Если экран заблокировался за время ожидания, прогон встанет после сброса. Это тот
  же дефект, только позже.
- Сменить тип на время ожидания — значит остановить один blocker и взять другой. Между ними —
  момент без blocker-а. У прогона появляется ещё одно состояние со своими test-ами. Выигрыш —
  тёмный экран на время ожидания (обычно до сброса пятичасового окна, не больше 24 ч,
  `MAX_WAIT_MS` в `src/shared/autopilot/resume-at.ts`). Он того не стоит.
- Сейчас прогон уже держит keep-awake во время ожидания: contract
  `test/contract/autopilot-limits.test.ts:289` и e2e `test/e2e/autopilot.spec.ts:320`. Код
  `src/main/autopilot/run.ts` не меняется, меняется только тип.
- Задержка после Stop с живыми background task-ами — так же. Эти задачи — implementer-ы, они тоже
  гоняют e2e.

**3. UI — только подсказки.**

- Видимая строка состояния не меняется. В ней 220 px. Самые длинные строки («waiting for limits ·
  resumes 14:20», «Wave 1 · 2 background tasks») уже заняли её целиком, и e2e это проверяет.
- Подсказка кнопки «Autopilot», когда она активна:
  `Run the Waves of <epic> one after another, without a person. The display stays on until the run ends`.
- Подсказка строки состояния в `running` и `waiting`: строка состояния и та же фраза,
  `<строка>. The display stays on until the run ends`. Если у состояния есть `message`
  (что пошло не так), подсказка — `message`, как сейчас.
- Фраза одна, константа в `AutopilotAction.tsx`.

**4. README, раздел «Stable copy».** Абзац про ночной прогон, по-английски, как весь README:

- на время прогона worfy держит экран включённым (ADR-0034);
- для прогона без человека крышка открыта;
- Mac не блокируют вручную (Lock Screen, Ctrl-Cmd-Q, активный угол): на заблокированном экране
  e2e и `gate full` агентов Wave ждут человека.

## Черновик ADR-0034

Файл `docs/adr/0034-autopilot-keeps-display-awake.md`. Формат — `rules.md` Profile-а: вторая строка
«Дата: ГГГГ-ММ-ДД. Статус: принят.», раздел `## Considered Options`.

- **Контекст.** Как в «Что произошло»: e2e и `gate full` только локально, на заблокированном экране
  окно не показывается, вечер 2026-10-06, пункт 7 ADR-0024 пускает экран гаснуть.
- **Решение.**
  1. keep-awake прогона — `powerSaveBlocker.start('prevent-display-sleep')`, один blocker на
     прогон. Этим заменяется тип в пункте 7 ADR-0024. Остальное в пункте 7 остаётся: когда blocker
     берётся и отпускается, закрытая крышка.
  2. Blocker держится весь прогон, включая ожидание сброса Limits и задержку после Stop с живыми
     background task-ами.
  3. Блокировку вручную и закрытую крышку worfy не обходит. Правило для ночного прогона — в README,
     раздел «Stable copy».
- **Последствия.**
  - Экран горит весь прогон, в том числе ночью. Это цена решения.
  - На батарее горящий экран её садит. При низком заряде macOS усыпит Mac, и прогон встанет, как
    при закрытой крышке.
  - Заблокировать экран по-прежнему можно вручную; прогон тогда ждёт человека.
- **Considered Options.**
  - `prevent-display-sleep` на весь прогон (выбрано).
  - `prevent-app-suspension`, как в ADR-0024, и правило «не блокировать вручную». Отвергнуто:
    экран гаснет и блокируется сам, без человека.
  - Два blocker-а, `prevent-app-suspension` и `prevent-display-sleep`. Отвергнуто: второй ничего не
    добавляет (`prevent-display-sleep` имеет приоритет), а путей освобождения вдвое больше.
  - Экран включён, только пока агенты гоняют e2e. Отвергнуто: worfy не знает, что делает skill и
    когда агенты запускают e2e (ADR-0002).
  - На время ожидания Limits — `prevent-app-suspension`. Отвергнуто: «Что делаем», пункт 2.
  - e2e работают на заблокированном экране (вариант (б)). Отвергнуто владельцем 2026-10-06 пока.
  - Внешний `caffeinate -d`. Отвергнуто: он вне worfy, кончается по таймеру (так было 2026-10-06),
    прогон о нём не знает.
  - Отключить пароль после гашения экрана. Отвергнуто: это системная настройка, worfy системных
    настроек не меняет (ADR-0024, пункт 7).

## Готово, когда

- [x] ADR-0034 принят до кода и заменяет тип keep-awake в пункте 7 ADR-0024. ADR-0024 не правится.
- [x] Прогон держит один blocker `prevent-display-sleep` со старта до остановки, включая ожидание сброса Limits и задержку после Stop с живыми background task-ами. Отпускает его на остановке, на `will-quit` и после конца задач, как сейчас. Второго blocker-а нет.
- [x] Подсказка активной кнопки «Autopilot» и подсказка строки состояния в `running` и `waiting` говорят «The display stays on until the run ends». Видимая строка состояния не меняется.
- [x] README, раздел «Stable copy»: на ночной прогон крышка открыта, Mac не блокируют вручную.
- [x] (вручную) Стабильная копия, обновлённая после влития. Во время прогона у процесса worfy есть assertion запрета гашения экрана; экран не гаснет и не блокируется дольше времени «Turn display off» из настроек; после остановки assertion нет. Как проверить: `pmset -g assertions` до, во время и после прогона (`NoDisplaySleepAssertion` у процесса worfy, `PreventUserIdleDisplaySleep 1` в системной сводке). (Проверено 2026-10-07 — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)

Ручной пункт агент не проверяет: нужен настоящий прогон на стабильной копии и время. Не сделанный
пункт — «не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца». Если экран всё же
блокируется (например, заставка с паролем), это записывается туда же.

## Тесты

Сначала падающий test: `test/unit/autopilot-power.test.ts`. Первый test ждёт `prevent-display-sleep`
в `KEEP_AWAKE_TYPE` и в вызове `start` fake-а `powerSaveBlocker`
(`electron.calls` — `[['start', 'prevent-display-sleep', id]]`). На нынешнем main он падает: тип
`prevent-app-suspension`.

- `test/unit/autopilot-power.test.ts`: тип в `start` fake-а; после `start()` ровно один вызов
  `start` — второго blocker-а нет. Остальные test-ы файла (повторный `start`, `will-quit`, два
  прогона) остаются зелёными.
- `test/unit/canvas-actions.test.tsx`, блок Autopilot: подсказка активной кнопки содержит фразу;
  в `running` и `waiting` подсказка строки состояния содержит фразу, а текст строки прежний.
  Сейчас mock `autopilot.state` отдаёт только `stopped` — нужен вариант с `running` и `waiting`.
- `test/e2e/autopilot.spec.ts`: запись подменённого `powerSaveBlocker` ждёт
  `start prevent-display-sleep` вместо `start prevent-app-suspension` (`:247`, `:263`, `:270`,
  `:320`, `:328`, `:381`, `:390`). Снимки `autopilot-*` в обеих темах не меняются: видимый текст
  тот же. Если исполнитель всё же меняет видимую строку — новые снимки в светлой и тёмной теме,
  ревьюер сверяет их (соглашение «Снимки UI» в spec.md).
- `test/contract/autopilot-limits.test.ts` и `test/contract/autopilot-background.test.ts` уже
  проверяют, что keep-awake держится во время ожидания Limits и после Stop с живыми задачами. Их
  fake keep-awake тип не знает, они остаются зелёными без правок.

## Где в коде

- `docs/adr/0034-autopilot-keeps-display-awake.md` (новый)
- `src/main/autopilot/power.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `README.md`
- `test/unit/autopilot-power.test.ts`
- `test/unit/canvas-actions.test.tsx`
- `test/e2e/autopilot.spec.ts`

Не меняются: `src/main/autopilot/run.ts` (blocker уже держится весь прогон, `run.ts:22`,
`:285-286`), `src/main/ipc/autopilot.ts:70` (создаёт `KeepAwake`).

Общих файлов с Ticket-ами Wave 8 плана (11, 16, 23, 25, 27) нет. Общий файл с не сделанным
Ticket-ом из другой Wave — `test/unit/canvas-actions.test.tsx`: 32 → 20. Ребро `Blocked by` не
ставится.

## Итог

[PR #70](https://github.com/IDSAD-XL/worfy/pull/70), merge e31c0c0. Ревью — VERIFIED, без доработки.

- **ADR-0034** (`docs/adr/0034-autopilot-keeps-display-awake.md`) принят отдельным коммитом до кода
  (6792d0a, код — 73432be). Он заменяет тип keep-awake в пункте 7 ADR-0024; ADR-0024 не правился.
- `src/main/autopilot/power.ts`: `KEEP_AWAKE_TYPE` — `'prevent-display-sleep'`. Один blocker на
  прогон, второго нет. Когда он берётся и отпускается, не изменилось: старт прогона; остановка,
  `will-quit`, конец background task-ов после Stop. `src/main/autopilot/run.ts` не менялся.
- `prevent-display-sleep` один держит и системный сон: по IOPMLib, пока гасить экран запрещено,
  система не уходит в idle sleep (ссылка — в комментарии VERIFIED к PR #70).
- Одноразовый скрипт Electron, который запускали исполнитель и ревью, показал только
  `NoDisplaySleepAssertion` у своего процесса, пока blocker взят.
- `src/renderer/canvas/actions/AutopilotAction.tsx`: подсказка активной кнопки «Autopilot» и
  подсказка строки состояния в `running` и `waiting` кончаются фразой «The display stays on until
  the run ends» (одна константа `DISPLAY_STAYS_ON`). Если у состояния есть `message`, подсказка —
  `message`, как раньше. Видимая строка состояния не менялась, снимки `autopilot-*` те же.
- `README.md`, раздел «Stable copy»: на ночной прогон крышка открыта, Mac не блокируют вручную.

**Тесты.**
- `test/unit/autopilot-power.test.ts` — тип blocker-а `prevent-display-sleep`, `start` ровно один
  раз; на main до правки красный.
- `test/unit/canvas-actions.test.tsx` — mock `autopilot.state` отдаёт любое состояние; фраза в
  подсказке кнопки и строки состояния в `running` (с background task-ами и без) и `waiting` (с
  временем сброса и без), текст строки прежний; подсказки `message` и `stopped` не изменились.
- `test/e2e/autopilot.spec.ts` — запись подменённого `powerSaveBlocker` ждёт
  `start prevent-display-sleep`; подсказки проверены в собранном приложении.

Проверки перед мержем: `pnpm lint && pnpm typecheck && pnpm test` — exit 0;
`GATE_SCOPE=all gate.sh full` — exit 0.

Ручной пункт «Готово, когда» проверен 2026-10-07 на настоящем прогоне Autopilot — подраздел
[«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

Долг ревью [low]: после Stop с живыми background task-ами экран горит, а подсказка строки
«stopped» об этом молчит (`test/e2e/autopilot.spec.ts:268`), хотя ADR-0034, раздел «Последствия»,
обещает, что о горящем экране говорят подсказки.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M1 второго круга ручных проверок), без GUI: журнал прогона,
`pmset -g assertions` и unified log процесса `powerd`. Stable copy `~/Applications/worfy-stable.app`
из 5060858 (pid 74430), прогон Autopilot `2026-10-07T00-32-09-524Z-66ddaf` над Epic-ом `worfy-week`
(4 Wave).

- Во время прогона: assertion у процесса worfy Orchestrator видел в `pmset -g assertions` в 00:32Z.
  По журналу `powerd` worfy (pid 74430) создал `NoDisplaySleepAssertion` «Electron» в 00:32:09.457Z,
  за 67 мс до `run-started`. За весь прогон у worfy был один id, второго blocker-а не было.
- Остановка: `background-tasks` с пустым списком задач — 04:38:02.310Z, `run-stopped` (reason
  `no-ready-wave`) — 04:38:34.551Z. worfy снял assertion в 04:38:34.539Z, за 12 мс до `run-stopped`.
  Assertion держался 4 ч 06 мин 25 с.
- После остановки: снимки `pmset -g assertions` в 04:39:57Z и 04:46:04Z — строк worfy нет ни в
  одном. `PreventUserIdleDisplaySleep 1` в системной сводке держит не worfy, а
  `caffeinate -dimsu -t 43200` (pid 92405, родитель launchd, запущен около 00:59Z). После снятия
  `powerd` не записал от worfy ни одного нового assertion.
- Гас ли экран, глазами не смотрели: доказательство — assertion, который держался весь прогон.
- Вердикт: проверено.
- Улики (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M1-journal-tail.txt`,
  `M1-pmset-after-stop.txt`, `M1-pmset-after-stop-5min.txt`, `M1-powerd-log.txt`.
