# worfy-schedules: Schedule — Session с точным prompt-ом по расписанию на этой Machine

Status: draft
Critic: [docs/product/critic/worfy-schedules-2026-11-28.md](../../docs/product/critic/worfy-schedules-2026-11-28.md) — Reorder;
the Alternative is applied in this draft (исключение ADR-0005 в Ticket-е 01, корни Approval policy — свой Ticket 13,
Ticket 08 ждёт 05 и несёт Run now); решение владельца по возражениям — в файле critic-а.
Source: исследование [docs/research/2026-11-28-scheduled-tasks.md](../../docs/research/2026-11-28-scheduled-tasks.md)
(вопрос владельца 2026-11-28: «scheduled задачи, которые можно описать в чате, ассистент предлагает, пользователь
принимает либо просит поменять, и принятые можно менять»); grilling владельца 2026-11-28, ответы Q1–Q20 — это решения, и
spec их не пересматривает.
[CONTEXT.md](../../CONTEXT.md) — термины Schedule и scheduled run (вносит этот PR), Project, Session, Vendor, Limits,
Machine, Linked machine, Assistant, Attention item, Proposal, Auto-approval, Approval policy, View button, Footer,
Settings, Autopilot.
Зависит от: [worfy-assistant](../worfy-assistant/spec.md) — ядро внимания и Attention item-ы, карточки Proposal, MCP-сервер
`worfy-app` ([ADR-0114](../../docs/adr/0114-assistant-app-session.md)); [worfy-layout](../worfy-layout/spec.md) — реестр
видов и View button-ы в трёх зонах; [worfy-auto-approve](../worfy-auto-approve/spec.md) — Auto-approval и Approval policy
([ADR-0098](../../docs/adr/0098-approval-policy.md)); [worfy-multi-vendor](../worfy-multi-vendor/spec.md) — Session-ы
Codex ([ADR-0094](../../docs/adr/0094-vendor-seam.md)); [worfy-link](../worfy-link/spec.md) — доступ Linked machine
([ADR-0052](../../docs/adr/0052-machines-and-linking.md), [ADR-0066](../../docs/adr/0066-read-only-access-for-a-linked-machine.md));
[worfy-continuity](../worfy-continuity/spec.md) — Session после перезапуска worfy
([ADR-0108](../../docs/adr/0108-work-continues-after-a-restart-of-worfy.md)).
Ticket-ы: Epic `worfy-schedules`, 14 Ticket-ов в 9 Wave-ах, нумерация с `01`; файлы — `.scratch/worfy-schedules/issues/`
(этот PR их не создаёт).

## Проблема

- В worfy нет способа сказать «каждый будний день в 9:00 запусти в Project-е X Session с вот этим текстом». Сущности
  нет: `cron`, `rrule` и `schedule` в `package.json` не встречаются (исследование, раздел 2).
- Единственный планировщик — `CheckScheduler` (`src/main/assistant/schedule/scheduler.ts`). Он знает только интервалы
  от 5 минут до суток (`src/shared/assistant/schedule/settings.ts`, `CHECK_INTERVAL_BOUNDS`) и три вида проверок
  источников Assistant-а. «В 9:00 по будням» он не выражает.
- Ночной Run Autopilot-а закрыт Start window ([ADR-0093](../../docs/adr/0093-run-mode-at-wave-boundary-and-epic-forecast.md)),
  но это Wave-ы Epic-а, а не произвольная Session. Ежедневный аудит, ночной прогон `overnight-fix-loop`, утренний обзор
  PR пользователь каждый раз запускает руками.
- Assistant может подготовить Session (Prepare), но граница 3 ADR-0114 требует щелчка пользователя перед каждой
  Session с текстом Assistant-а (`docs/adr/0114-assistant-app-session.md`, решение 5, пункт 3). Повтор без щелчка
  сейчас запрещён правилом, а не только отсутствием кода.
- На Windows закрытое окно завершает worfy (`src/main/index.ts:348`, `window-all-closed` → `app.quit()`), так что
  локальный запуск по времени там сейчас невозможен даже в принципе.

## Пользователи

- **Владелец с несколькими Project-ами на Mac и на ПК.** Хочет, чтобы повторяющаяся работа (аудит, обзор PR, прогон
  test-ов по модулям) шла сама, а утром он видел результат — Session на Canvas и строку истории.
- **Новый пользователь без Assistant-а.** Assistant у него выключен (spec worfy-assistant, решение 10). Schedule ему
  нужен через ручную форму, без чата.
- **Тот же владелец за второй машиной.** Смотрит Schedules Mac-а с ПК через Link и может их остановить, но не
  создавать и не править.

## Решение

- **Schedule** — правило «какую Session и когда запускать»: Project, Vendor и модель, точный текст prompt-а и повтор
  (или один раз) (Q1 (а), Q2). Один запуск — **scheduled run**: новая unattended Session на Canvas Project-а в своём
  git worktree (Q6, Q15).
- Schedule появляется только по **Accept** пользователя на карточке — в ручной форме или в чате Assistant-а. Accept —
  согласие на все будущие scheduled run-ы, пока текст, Project, Vendor и модель те же; любая их правка ждёт нового Accept
  (Q3; предложение Amendment ADR-0114 ниже).
- Работает только на своей Machine, пока worfy открыт и Machine не спит (Q4). Будить Machine worfy не умеет: `pmset
  schedule wake` требует root (исследование, раздел 1.3).
- Всё — в новом виде **Schedules** со своей View button (Q19): список карточек, редактор, история последних 50 run-ов
  каждого Schedule (Q20).

### Набросок функции

**Путь владельца.**

1. Владелец пишет Assistant-у: «каждый будний день в 7:30 гоняй в worfy аудит по модулям, Opus». Assistant отвечает
   карточкой Schedule: имя `daily-audit`, Project worfy, Claude Code · `claude-opus-5-5`, точный текст prompt-а, правило
   «Weekdays at 07:30 (Europe/Berlin)», три ближайшие даты, которые посчитал main, порог Limits «Global (80 %)» и строка
   «Runs only on this Mac while worfy is open and the Mac is awake».
2. Владелец правит в карточке время на 07:40 и жмёт **Accept**. Schedule появляется в виде Schedules со статусом Active и
   «Next: Mon 30 Nov, 07:40».
3. В понедельник в 07:40 worfy проверяет Limits (5-часовое окно 23 %), делает worktree на ветке
   `schedule/daily-audit/2026-11-30-0740` и стартует Session с принятым текстом. На Canvas появляется Node Session.
4. Run закончился без вопросов. В истории — строка «Done · 41 min · Open Session · branch …». Уведомления нет (Q16).
5. Во вторник Mac спал до 10:10. При пробуждении пропуск 2 ч 30 мин — не старше 6 часов, поэтому идёт один catch-up run
   (Q10); в истории строка помечена «Catch-up for 07:40».
6. В среду агент упёрся в `git push` — Approval policy отдаёт его владельцу (park, ADR-0098). worfy поднимает Attention
   item «daily-audit needs you» и шлёт системное уведомление (Q6, Q16).
7. Владелец просит в чате «перенеси на Sonnet». Assistant показывает карточку «было → станет»: модель меняется, поэтому
   в карточке строка «Changing the model needs a new Accept». До Accept Schedule идёт по-старому.
8. С ПК владелец открывает Linked machine, видит Schedules Mac-а без кнопок правки и жмёт Pause (Q17).

## Как это сделано у конкурентов

Сводка исследования (раздел 1). Создание словами в чате есть у Claude Code (`/schedule`, Desktop), Cowork, ChatGPT,
Gemini, Cursor, GitHub Copilot и Devin. Карточку с полями и кнопкой принятия документируют Cowork и Devin. Локальные
задачи у всех идут только при открытом приложении и не спящей машине; Claude Code Desktop при пробуждении делает
«exactly one catch-up run for the most recently missed time». Удалять задачу Claude Code Desktop разрешает только кнопкой
Delete, не словами Claude. Правило повтора: RRULE — у Codex Desktop и Devin, cron — у Claude Code, Cursor и GitHub
Actions. Пределы: ChatGPT — не чаще раза в час на платных планах, 3–15 активных задач; Claude cloud — 100 run-ов в час
на аккаунт.

## Истории пользователя

1. Как владелец, я хочу описать повторяющуюся работу словами в чате и получить карточку с точным текстом и датами, чтобы
   принять её одним щелчком.
2. Как пользователь без Assistant-а, я хочу создать Schedule в форме, чтобы не включать Assistant ради этого.
3. Как владелец, я хочу видеть ближайшие три даты конкретно, чтобы не гадать, как worfy понял «каждый второй вторник».
4. Как владелец, я хочу, чтобы run не стартовал, когда Limits почти кончились, чтобы утром было на чём работать.
5. Как владелец, я хочу, чтобы Schedule никогда не запустил текст, которого я не видел и не принял.
6. Как владелец, я хочу получать уведомление только когда run упал или ждёт меня, а не на каждый успешный run.
7. Как владелец, я хочу, чтобы проспанный Mac-ом запуск догнался один раз, а давно пропущенный — не стартовал внезапно
   в обед.
8. Как пользователь Windows, я хочу сам решить, оставаться ли worfy в фоне и стартовать ли при входе.
9. Как владелец за ПК, я хочу видеть и ставить на паузу Schedules Mac-а, но не менять их оттуда.
10. Как владелец, я хочу, чтобы каждый run работал в своём worktree и не трогал мою рабочую ветку.

## Решения владельца (grilling 2026-11-28)

1. **Q1 (а). Термин — «Schedule»; один запуск — «scheduled run».** Запись в CONTEXT.md — этот PR.
2. **Q2. Schedule только стартует Session с точным prompt-ом.** Никаких других действий: ни команд worfy, ни Card-ов, ни
   Autopilot-а.
3. **Q3. Accept — согласие, пока не изменились текст, Project, Vendor или модель.** Это Amendment ADR-0114 (раздел
   «Предложение Amendment ADR-0114»).
4. **Q4. Только локально, на этой Machine.** Облачные routines Claude Code worfy не встраивает.
5. **Q5. Без Autopilot-а.** Session scheduled run-а не стартует Run Autopilot-а: `autopilot_start` в unattended Session
   уже отклоняется (`src/main/autopilot/chat-confirm.ts`, `UNATTENDED_MESSAGE`; [ADR-0091](../../docs/adr/0091-autopilot-from-chat.md)).
   [ADR-0100](../../docs/adr/0100-run-epic-queue.md) не меняется.
6. **Q6. Run идёт без человека; состояние «нужен человек» — Attention item.**
7. **Q7. Работает без Assistant-а.** Вид Schedules, форма, планировщик и Attention item-ы не зависят от выключателя
   Assistant-а: ядро внимания и раздел Assistant-а стартуют в main и при выключенном Assistant-е
   (`src/main/index.ts`, «The attention core of the Assistant … worfy runs without it»).
8. **Q8. Claude Code и Codex.**
9. **Q9. Удаление — только кнопкой Delete на карточке.** У Assistant-а нет tool-а, который удаляет.
10. **Q10. Пропуск не старше 6 часов — один catch-up run; старше — строка истории и Attention item.**
11. **Q11. Windows: настройки «работать в фоне» и «запускать при входе», обе выключены по умолчанию.**
12. **Q12. Не чаще раза в час, не больше 20 активных Schedules, run не дольше 2 часов, run-ы одного Schedule не
    пересекаются.**
13. **Q13. Пресеты + подмножество RRULE + IANA-пояс; worfy сам считает и показывает три ближайшие даты.**
14. **Q14. Порог Limits настраивается.**
15. **Q15. Каждый run — в git worktree на ветке `schedule/<name>/<date>`; PR — только если просит prompt.**
16. **Q16. Результат — Session и строка истории; уведомление — только на ошибку или «нужен человек».**
17. **Q17. Linked machine видит Schedules только для чтения и может ставить их на паузу.**
18. **Q18 (в). Глобальный порог в Settings (5-часовое окно 80 %, недельный — по желанию, выключен) плюс необязательный
    порог у Schedule; run, который перешёл бы порог, пропускается со строкой истории.**
19. **Q19. Своя View button, которую можно переносить, как остальные View button-ы worfy-layout.**
20. **Q20. Хранится 50 последних run-ов каждого Schedule.**

## Scope

**В этом Epic-е.**

- Сущность Schedule и история run-ов в папке данных worfy; согласие с отпечатком четырёх полей.
- Правило повтора: пресеты, подмножество RRULE, IANA-пояс, три ближайшие даты, проверка «не чаще раза в час».
- Планировщик в main: точный запуск, catch-up, пропуски, сон и пробуждение, без пересечений, предел 2 часа.
- Порог Limits: глобальный в Settings и свой у Schedule.
- Scheduled run: worktree и ветка, unattended Session Claude Code или Codex с принятым текстом, корни Approval policy,
  исход run-а, Attention item-ы и уведомления.
- Вид Schedules с View button, карточки, редактор, история; Run now, Pause/Resume, Delete.
- Assistant: карточка Schedule и карточка «было → станет» в чате, чтение списка.
- Linked machine: список только для чтения и Pause.
- Windows: работа в фоне и запуск при входе.
- ADR Schedule-ов, Amendment-ы ADR-0114 и ADR-0098, исключение ADR-0005 (worfy сам делает worktree-ы и ветки
  `schedule/*` в репозитории Project-а), запись в инвентарь ADR-0005, документация en и ru.

**Не в этом Epic-е.**

- Облачные запуски, когда ноутбук закрыт (Q4); пробуждение Machine (`pmset` с root, Windows `WakeToRun`).
- Run Autopilot-а или Wave из Schedule (Q5); Epic-и, которые worfy ставит в очередь сам (ADR-0100).
- Действия, кроме старта Session: Card, команда worfy, скрипт без модели (Q2).
- Запуск по событию (новый PR, красный CI) — это Duty Assistant-а, а не Schedule.
- Schedule на Linked machine: создание, правка, Run now и Resume с другой Machine (Q4, Q17).
- Login item на macOS: на Mac worfy и без окон живёт до Quit (`index.ts:348`); Q11 говорит только о Windows.
- Сырой cron; RRULE вне подмножества (`BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `EXDATE`, `FREQ=MINUTELY`/`SECONDLY`/`YEARLY`).
- Отдельный канал уведомлений (почта, телефон, Slack).

## Модель данных (простыми словами)

- **Schedule.**
  - id; имя — до 60 символов, уникально в Project-е; из него получается slug ветки (латиница, цифры, дефис).
  - Project (id Project-а этой Machine), Vendor (Claude Code или Codex), модель — точный id модели, как его показывает
    picker модели Vendor-а.
  - Текст prompt-а — ровно то, что получит Session; до 20 000 символов, как у Prepare (`assistant.start`,
    `src/shared/ipc/assistant.ts`).
  - Правило: пресет (Once, Hourly, Daily, Weekdays, Weekly, Monthly, Custom) и поля подмножества RRULE — `FREQ`
    (HOURLY, DAILY, WEEKLY, MONTHLY), `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYHOUR`, `BYMINUTE` (ровно одно значение),
    `COUNT`, `UNTIL`; начало (`DTSTART`) в стенном времени и IANA-пояс. Once — `COUNT=1`.
  - Порог Limits: «Global» или свой — доля 5-часового окна и, по желанию, доля недели.
  - Состояние: Active; Paused с причиной (by you, from <Linked machine>, after 3 failed runs, Project not found); Needs
    Accept (согласие потеряно); Finished (у Once и у правила с `COUNT`/`UNTIL`, когда дат больше нет).
  - Согласие: отпечаток (SHA-256 от текста, id Project-а, Vendor-а и модели), время Accept и откуда он пришёл (форма или
    карточка в чате, с id Proposal).
  - Последняя дата, которую планировщик уже обработал (запуском, catch-up-ом или строкой пропуска): по ней пропуски
    считаются после сна и перезапуска.
- **Scheduled run** (строка истории).
  - id, Schedule, плановое время, вид (scheduled, catch-up, run now), время старта и конца.
  - Исход: Done; Needs you (с причиной); Error (с причиной); Timed out (2 часа); Interrupted (worfy закрыт дольше
    часа); Skipped (Limits, previous run still in progress, Project not found, model not available, consent lost);
    Missed (Mac asleep или worfy closed, с числом пропущенных дат).
  - Session и её Node, путь worktree, ветка, ссылка на PR, если PR inbox видит PR этой ветки.
- **Настройки Machine** (Settings, ADR-0005): порог 5-часового окна (по умолчанию 80 %), недельный порог (по умолчанию
  выключен); на Windows — «Keep worfy running in the background» и «Start worfy when I sign in» (обе выключены).
- **Где лежит.** `<WORFY_DATA_DIR>/schedules/schedules.json` — все Schedules Machine; `<WORFY_DATA_DIR>/schedules/runs/<id>.json` —
  50 последних run-ов одного Schedule. Запись через `src/main/storage/json-file.ts` (zod, временный файл и rename,
  нечитаемый файл переименовывается). Сами Schedules и история в репозиторий Project-а не попадают, но каждый run
  оставляет в нём след: ветку `schedule/*`, запись в `.git/worktrees` и папку в `.claude/worktrees/` (раздел
  «Scheduled run»). Это исключение из ADR-0005, Ticket 01. Имена файлов и запись в инвентарь ADR-0005 — тоже Ticket 01.

## Решения по реализации

### Правило повтора (Q12, Q13)

- Модуль `src/shared/schedules/recurrence.ts` без зависимостей: разбор и проверка подмножества RRULE zod-ом, пресеты ↔
  поля, следующие N дат в IANA-поясе через `Intl.DateTimeFormat`, фраза по-английски («Weekdays at 07:40
  (Europe/Berlin)»). Своё подмножество вместо пакета: полей мало, а правила DST и проверка частоты — наши.
- **Не чаще раза в час.** `BYMINUTE` — ровно одно значение; `FREQ=HOURLY` — `INTERVAL ≥ 1`; несколько `BYHOUR` дают
  разные часы. Так две соседние даты не ближе 60 минут при любом правиле подмножества; проверка ещё раз считает
  интервал между первыми 500 датами.
- **Переход на летнее время.** Несуществующее стенное время (02:30 в ночь перевода вперёд) сдвигается на час вперёд, как
  велит RFC 5545; повторённое (01:30 в ночь перевода назад) — первое из двух. Unit-test-ы на Europe/Berlin и
  America/New_York.
- **Модель даты не считает.** Assistant заполняет поля, main проверяет их и сам считает три даты; карточка показывает
  только посчитанное main.
- Смена пояса Machine не сдвигает Schedule: пояс — часть правила. Карточка показывает и время в поясе правила, и, если
  пояс Machine другой, местное.

### Согласие (Q3)

- Accept записывает отпечаток. Перед каждым run-ом main считает отпечаток заново из того, что лежит в файле; не
  совпало — run не стартует, Schedule становится Needs Accept, строка истории «Skipped: consent lost», Attention item и
  уведомление.
- Session получает ровно принятый текст: main берёт его из Schedule в момент старта, а не из карточки или renderer-а.
- Правка имени, правила или порога Limits тоже применяется только щелчком пользователя (Save в редакторе, Accept на
  карточке «было → станет»), но согласия не снимает: Q3 привязывает его к четырём полям.
- Файл, поправленный руками, или запись старой версии без отпечатка — Needs Accept.

### Планировщик (Q10, Q12)

- `src/main/schedules/scheduler.ts`. Один таймер на ближайшую дату всех Active Schedules, не дольше часа, с
  перепланированием (как `CheckScheduler` ловит смену часов и пояса). Время — `mainClock` (`src/main/clock.ts`), так
  e2e фиксирует его через `WORFY_NOW`.
- Без jitter: человек ждёт run в 07:40. Несколько Schedules на одну минуту стартуют подряд.
- **Сон и закрытый worfy.** На старте main и на `powerMonitor` `resume` планировщик берёт даты после «последней
  обработанной» до сейчас. Самая поздняя из них не старше 6 часов — один catch-up run, остальные — одна строка «Missed
  (N)». Самая поздняя старше 6 часов — строка «Missed» и Attention item, run-а нет. На `suspend` таймер останавливается.
- **Без пересечений.** Дата пришла, а прошлый run этого Schedule ещё идёт — строка «Skipped: previous run still in
  progress», catch-up-а для неё нет. Run now в это время недоступен.
- **2 часа.** От старта run-а по стенным часам. В срок worfy прерывает ход Session (Interrupt), через минуту без конца
  хода — останавливает её; исход Timed out, уведомление.
- **20 активных.** Accept или Resume 21-го Active Schedule на Machine отказывает с текстом «20 active schedules is the
  limit on this machine. Pause one first.»
- **Три ошибки подряд** — Schedule сам встаёт на паузу «after 3 failed runs», Attention item. Решено spec-ом без
  владельца, по образцу backoff `CheckScheduler` и паузы задач ChatGPT; ошибкой считаются Error и Timed out, не
  Skipped и не Needs you.
- Keep-awake (`prevent-app-suspension`, как `src/main/autopilot/power.ts`) — только на время run-а, не между run-ами.

### Limits (Q14, Q18)

- `src/main/schedules/limits.ts` поверх нынешней проверки (`src/main/agent/limits-gate.ts`, вид `automatic`).
  Порог — свой у Schedule, иначе глобальный. Окна по Vendor-у: у Claude — 5 часов и 7 дней, у Codex — primary и
  secondary его плана (CONTEXT.md, Limits).
- «Run перешёл бы порог» spec читает так: на момент старта доля окна уже на пороге или выше. Сколько съест сам run,
  worfy заранее не знает. Тогда — строка «Skipped: Limits (5-hour window 84 % ≥ 80 %)», без уведомления и без
  отложенного запуска.
- Нет данных о Limits — как у `limits-gate` для вида `automatic` сейчас.

### Scheduled run (Q6, Q8, Q15, Q16)

- `src/main/schedules/run.ts`. Шаги: проверить Project, модель, согласие и Limits; `git fetch` основной ветки
  (без сети — от локальной, со строкой в истории); `git worktree add -b schedule/<slug>/<YYYY-MM-DD-HHmm>
  <Project>/.claude/worktrees/schedule-<slug>-<YYYYMMDD-HHmm> origin/<default>`; Session на Canvas Project-а с cwd в
  этом worktree, unattended, первое сообщение — принятый текст.
- **`<date>` с временем.** Q15 называет ветку `schedule/<name>/<date>`; у Hourly-правила несколько run-ов в день,
  поэтому в «дате» есть часы и минуты.
- **Папка worktree** — `.claude/worktrees/` внутри Project-а, как кладёт worktree-ы сам Claude Code: так ядро внимания и
  Canvas узнают Project Session по её cwd (`projectOfPath`, `src/main/assistant/core/sources.ts`).
- **Worktree после run-а.** Чистый worktree без коммитов сверх базы worfy удаляет вместе с веткой. С правками или
  коммитами — оставляет; строка истории говорит «worktree kept» и даёт Remove worktree с подтверждением. Ветку с
  коммитами worfy сам не удаляет никогда, и когда строка уходит за 50.
- **Vendor.** Старт — через seam Vendor-ов (ADR-0094): Claude Code и Codex одним путём; Codex-у тот же unattended и та
  же Approval policy (ADR-0098, «тот же ответ на Codex»).
- **Права.** Auto-approval Project-а как есть (Off, Shadow, On). Корни Approval policy у scheduled run-а — его worktree,
  его папка временных файлов `<WORFY_DATA_DIR>/schedule-tmp/<run>` (TMPDIR Session-а) и scratchpad Session-а; рабочая
  копия Project-а и его `.scratch` — не корни. Это Amendment ADR-0098, пункт 3: текст — Ticket 01, код и test —
  Ticket 13. Session без человека не меняет режим разрешений
  ([ADR-0022](../../docs/adr/0022-unattended-session-refuses-permission-mode-change.md)).
- **«Нужен человек».** Запрос в park (ADR-0098), ошибка входа Vendor-а, Limits кончились посреди run-а. worfy сразу
  поднимает Attention item «<name> needs you» и шлёт уведомление; запрос в park ждёт, как в Autopilot-е
  (`PARK_LIMIT_MS`, 60 минут, `src/main/agent/auto-approve/park.ts`). Без ответа — отказ с подсказкой, ход кончается, исход
  Needs you. Session остаётся на Canvas: человек продолжает её сам, это уже не scheduled run.
- **Исход.** Конец хода без запроса и ошибки — Done. Ошибка старта (worktree, Session, Vendor) или ошибка API — Error.
  Уведомление — только Error, Timed out и Needs you (Q16), через `src/main/notify.ts`: он работает и при выключенном
  Assistant-е, а свои уведомления Assistant-а тогда молчат (`docs/features/assistant.md`, «While it is off…»).
- **Перезапуск worfy посреди run-а** — по ADR-0108: Session продолжается сама, если обрыв не дольше часа; иначе исход
  Interrupted. Предел 2 часа считается от первого старта.
- **Attention item-ы** — новый источник `schedule` ядра внимания, виды: needs-you, missed, needs-accept, paused-after-failures,
  project-not-found. Пункт лежит в папке данных Project-а (ADR-0114, решение 7). У Schedule, Project которого больше нет,
  пункт держать негде: тогда только уведомление и состояние карточки (Ticket 06 проверяет, есть ли в ядре пункты без
  Project-а).

### Вид Schedules (Q9, Q19, Q20)

- View button `schedules` — седьмая в реестре видов (`src/renderer/shell/views.tsx`) и в `VIEW_BUTTON_IDS`
  (`src/shared/layout/view-buttons.ts`). Зона по умолчанию — Footer, после Runs; у пользователя с сохранённой
  расстановкой её ставит туда же ремонт расстановки (`repairViewButtons`). Подпись «Schedules», tooltip «Schedules —
  sessions that start by time on this machine», строка Command palette `view:schedules`. Бейдж — число Schedules в Needs
  Accept и Paused after failures.
- **Список.** Все Schedules этой Machine, по Project-ам, текущий Project сверху. Над списком — строка «Schedules run only
  on this machine while worfy is open and the machine is awake.» и кнопка **New schedule**.
- **Карточка Schedule.** Имя; Project; Vendor · модель; правило словами; «Next: …» или причина, почему дат нет; chip
  состояния (Active, Paused, Needs Accept, Finished); последний исход. Кнопки: **Run now**, **Pause** / **Resume**,
  **Edit**, **History**, **Delete**. Delete спрашивает «Delete schedule "<name>"? Its history goes too; worktrees and
  branches stay.» с Delete и Cancel. Needs Accept показывает **Review and Accept**.
- **Редактор** (New schedule и Edit; работает без Assistant-а, Q7). Поля: Name, Project, Vendor, Model, Prompt (точный
  текст, моноширинный), When — пресеты (Once, Hourly, Daily, Weekdays, Weekly, Monthly, Custom), время, дни, Time zone
  (по умолчанию пояс Machine), у Custom — поле RRULE; Limits — «Use global threshold (80 %)» или свои значения. Под When —
  «Next runs:» и три даты от main; ошибка правила — под полем («More often than once an hour is not allowed»). Кнопки
  **Accept** и **Cancel**. Для Project-а без git — «Schedules need a git repository: each run works in its own
  worktree.», Accept неактивен. Правка Prompt, Project, Vendor или Model показывает «This change needs a new Accept»; кнопка
  тоже **Accept**; остальные правки — **Save**.
- **История** — панель под карточкой: до 50 строк (Q20), новые сверху. Плановое время, вид (Catch-up for 07:40, Run now),
  исход с причиной, длительность, **Open Session**, ветка, PR, если есть, «worktree kept» с **Remove worktree**.

### Assistant (Q7, Q9)

- Tools `worfy-app` (`src/shared/assistant/app-tools.ts`): `schedules_list` (чтение); `schedule_propose` — карточка
  нового Schedule; `schedule_change_propose` — карточка «было → станет» по образцу `src/shared/assistant/settings-change.ts`,
  в том числе Pause, Resume и Delete как предложенная правка. Tool-а, который создаёт, меняет или удаляет сам, нет.
- Карточка Schedule в чате — те же поля, что редактор, с правкой прямо в карточке; кнопки **Accept**, **Edit…**
  (открывает редактор с полями карточки), **Dismiss**. Кнопка Delete на карточке «было → станет» удаления — тот же щелчок
  пользователя, что Delete карточки в виде Schedules (Q9; CONTEXT.md, Schedule).
- Текст prompt-а пишет Assistant, поэтому до Accept он виден целиком (граница 3 ADR-0114).
- Режим обязанности для Schedule-ов не нужен: Assistant их только предлагает, ничего не делает сам.

### Linked machine (Q17)

- Каналы `schedules.list` и `schedules.history` — `project`, `read`; `schedules.pause` — `project`, `write`
  (`src/shared/ipc/channels.ts`, ADR-0066, пункт 3). Остальные каналы правки — `local`: с Linked machine их не вызвать.
- Окно Linked machine показывает вид Schedules той Machine без New schedule, Edit, Run now, Resume и Delete; Pause — при
  Full access. Пауза с Linked machine пишет причину «Paused from <Machine>»; Resume — только на своей Machine.

### Windows (Q11)

- Settings → General, только на Windows: «Keep worfy running in the background while schedules are active» и «Start
  worfy when I sign in» (`app.setLoginItemSettings`), обе выключены.
- Пока первая включена и есть Active Schedule, `window-all-closed` не завершает worfy. Вторая стартует worfy без окна,
  если включена первая, иначе — с окном.
- Платформенный Ticket: вердикт Windows — CI job (ADR-0071, ADR-0086).

### Предложение Amendment ADR-0114

Spec только предлагает текст; ADR правит Ticket 01.

> **Amendment 2026-MM-DD (worfy-schedules, Ticket 01).** Граница 3: щелчок Accept на карточке Schedule — щелчок
> пользователя для каждого scheduled run-а этого Schedule, пока текст, Project, Vendor и модель те же, что при Accept.
> main хранит отпечаток этих четырёх полей и перед каждым run-ом сверяет его; не совпало — run не стартует, Schedule
> ждёт нового Accept. Session scheduled run-а получает ровно принятый текст. Правка любого из четырёх полей любым путём —
> редактор, карточка «было → станет», файл, поправленный руками, — ждёт нового Accept. Assistant не создаёт, не меняет и
> не удаляет Schedule сам. Правило действует и для Schedule, текст которого написал пользователь в форме.

### ADR

- **Новый ADR** (следующий свободный номер в момент Ticket-а 01): Schedule — сущность в папке данных Machine;
  планировщик в main без ОС-планировщиков; согласие с отпечатком; worktree на каждый run; уведомления только об ошибке и
  «нужен человек».
- **Amendment ADR-0114** — выше. **Amendment ADR-0098, пункт 3** — корни scheduled run-а.
- **Исключение ADR-0005** (предложение; текст пишет Ticket 01, принимает владелец). ADR-0005 говорит, что worfy ничего
  не пишет в репозиторий Project-а; каждое прежнее исключение записано своим Amendment-ом (так ADR-0101 — папка Product
  Session). Текст: «Amendment 2026-MM-DD (worfy-schedules). Исключение: для scheduled run-а main worfy сам делает
  `git fetch` основной ветки, `git worktree add` на ветке `schedule/<slug>/<YYYY-MM-DD-HHmm>` в
  `<Project>/.claude/worktrees/schedule-<slug>-<YYYYMMDD-HHmm>` и после run-а удаляет такой worktree вместе с веткой,
  только если в нём нет правок и коммитов сверх базы. Другие ветки и worktree-ы worfy не трогает; ветку с коммитами не
  удаляет никогда; запрет `worktree add` у экрана Changes (`src/main/changes/git.ts`) остаётся».
- **Запись в инвентарь ADR-0005** — два файла папки данных.
- Не меняются: ADR-0100 (очередь Epic-ов задаёт человек), ADR-0091 (`autopilot_start` из unattended Session
  отклоняется), ADR-0066 (Pause с Linked machine — обычный канал `write`), ADR-0108 (продолжение после перезапуска),
  [ADR-0024](../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md) и [ADR-0097](../../docs/adr/0097-far-limits-wait-releases-keep-awake.md)
  (keep-awake Autopilot-а; у scheduled run-а свой, на время run-а).
- Тексты UI — английские ([ADR-0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md)).

## Сбои и что видит пользователь

| Случай | Что делает worfy | История | Attention item | Уведомление |
|---|---|---|---|---|
| Mac спал, пропуск ≤ 6 ч | один catch-up run за последнюю дату | Catch-up for HH:MM; Missed (N−1), если дат несколько | — | — |
| Mac спал или worfy закрыт, пропуск > 6 ч | run-а нет | Missed (N) | да | — |
| worfy закрыт посреди run-а ≤ 1 ч | Session продолжается (ADR-0108) | исход по концу | — | — |
| worfy закрыт посреди run-а > 1 ч | — | Interrupted | — | да |
| Windows, окно закрыто, фон выключен | worfy завершён — как «worfy закрыт» | Missed / Catch-up | > 6 ч | — |
| Limits на пороге или выше | run-а нет | Skipped: Limits (окно и доля) | — | — |
| Limits кончились посреди run-а | ход стоит | Needs you | да | да |
| Прошлый run ещё идёт | run-а нет | Skipped: previous run still in progress | — | — |
| Run дольше 2 ч | Interrupt, потом остановка | Timed out | — | да |
| Запрос в park | ждёт до 60 мин | Needs you, если без ответа | да | да |
| Project удалён из worfy или папки нет | Schedule на паузу «Project not found» | Skipped: Project not found | если есть где держать | да |
| Модели нет у Vendor-а | run-а нет | Skipped: model not available | да | да |
| Текст, Project, Vendor или модель поменялись без Accept | Needs Accept | Skipped: consent lost | да | да |
| Ошибка worktree или старта Session | — | Error (причина) | — | да |
| Три ошибки подряд | Schedule на паузу | — | да | да |
| Нет сети для `git fetch` | worktree от локальной основной ветки | пометка в строке | — | — |

## Приватность

- Schedules, тексты prompt-ов и история лежат только в папке данных этой Machine; в репозиторий Project-а и в облако
  worfy их не шлёт. Наружу идут только вызовы модели самой Session и `git fetch` — как у любой Session.
- Log main пишет id Schedule и run-а, исход и причину; текст prompt-а — никогда.
- Уведомление называет имя Schedule и Project, не текст prompt-а: уведомления уходят и Linked machine-ам (ADR-0066,
  «Последствия»).
- Linked machine с Read only видит текст prompt-а: это то же доверие, что транскрипт Session (ADR-0066, пункт 7).
- Текст, который Assistant написал по прочитанному в Slack или PR, может нести prompt injection. Защита — граница 3:
  пользователь видит весь текст до Accept, а отпечаток не даёт поменять его после.
- Fixture-ы и снимки test-ов — без домашних путей и имён Machine.

## Решения по test-ам

- Без моделей и без сети: Session — `WORFY_AGENT=fake` (`src/main/agent/fake-query.ts`), Codex — `WORFY_CODEX=fake`
  (`test/fixtures/codex-app-server/fake-app-server.mjs`), Limits — fixture `limits.json` во временном `WORFY_DATA_DIR`,
  время — fake timers vitest и `WORFY_NOW` в e2e. Сначала падающий test в каждом Ticket-е с кодом.
- **Unit.**
  - `test/unit/schedule-recurrence.test.ts` — пресеты ↔ поля; отказ на `BYMINUTE` с двумя значениями, `FREQ=MINUTELY`,
    `BYSETPOS`; три даты для Weekdays, Monthly 31-го (месяцы без 31-го пропускаются), `COUNT`, `UNTIL`; DST вперёд и назад
    в Europe/Berlin и America/New_York; фраза.
  - `test/unit/schedule-store.test.ts` — отпечаток; файл, поправленный руками, → Needs Accept; 21-й Active — отказ; 51-я
    строка вытесняет первую; нечитаемый файл переименован, остальные Schedules целы.
  - `test/unit/schedule-scheduler.test.ts` — запуск в срок; пропуск 3 ч → один catch-up и «Missed (N−1)»; пропуск 8 ч →
    Missed и Attention item; `suspend`/`resume`; пересечение; 2 часа → Timed out; три ошибки → пауза; смена пояса
    Machine не двигает дату.
  - `test/unit/schedule-limits.test.ts` — глобальные 80 %, недельный выключен и включён, порог Schedule поверх
    глобального, окна Codex, нет данных.
  - `test/unit/schedule-run-outcome.test.ts` — события Session → Done, Needs you, Error; park → Attention item и
    уведомление; уведомлений нет на Done и Skipped.
  - `test/unit/schedule-approval-roots.test.ts` — запись в worktree run-а — allow; в рабочую копию Project-а — не allow;
    `git push` — park.
  - `test/unit/schedules-view.test.tsx`, `test/unit/schedule-editor.test.tsx` — состояния карточки, Delete с
    подтверждением, «This change needs a new Accept», три даты, Accept неактивен без git.
  - `test/unit/assistant-schedule-tools.test.ts` — нет tool-а, который пишет; форма карточек.
  - `test/unit/view-buttons.test.ts` — старая расстановка получает `schedules` в Footer; `test/unit/link-access.test.ts` —
    `schedules.list` и `schedules.history` — `read`, `schedules.pause` — `write`.
- **Contract.**
  - `test/contract/schedule-worktree.test.ts` — настоящий git во временном repo: ветка `schedule/<slug>/<date>`, база,
    чистый worktree удалён, worktree с коммитом оставлен; на Windows runner-е тоже (пути).
  - `test/contract/schedule-codex-start.test.ts` — fake app-server Codex получает ровно принятый текст и unattended.
- **E2E** (каждый новый spec — строка в `scripts/e2e-specs.table.json`).
  - `test/e2e/schedules.spec.ts` — Assistant выключен; New schedule, три даты, Accept; `WORFY_NOW` за 30 с до даты → Node
    Session с принятым текстом и строка Done; Pause/Resume; Delete с подтверждением; View button переносится в Header.
  - `test/e2e/schedules-missed.spec.ts` — старт worfy с последней датой 3 ч назад → один catch-up; 8 ч назад → Missed и
    Attention item.
  - `test/e2e/schedules-assistant.spec.ts` — fake Assistant предлагает карточку → Accept; карточка смены модели →
    Needs Accept до Accept.
  - `test/e2e/schedules-linked.spec.ts` — Linked machine видит список без кнопок правки; Pause при Full access; отказ при
    Read only.

## Ticket-ы

14 Ticket-ов. Каждый — один PR со своими test-ами; «Готово, когда» каждого кончается пунктом: `pnpm lint`,
`pnpm typecheck`, `pnpm test` — exit 0, `ci-ok` зелёный на head PR. Номера 01–12 — как в первом черновике; корни
Approval policy выделены из 06 в новый Ticket 13 (возражение 3 critic-а), приёмка стала 14.

1. **01 — ADR Schedule-ов, Amendment-ы и исключение ADR-0005.** Новый ADR, Amendment ADR-0114 (граница 3) и ADR-0098
   (пункт 3, корни), Amendment ADR-0005 — исключение: main сам делает worktree-ы и ветки `schedule/*` в репозитории
   Project-а и удаляет чистые (раздел «ADR»); запись в инвентарь ADR-0005. Только документы. Агент. Blocked by: —.
   Готово, когда: владелец принял ADR и три Amendment-а, они и строка инвентаря в `main`.
2. **02 — Правило повтора.** `src/shared/schedules/recurrence.ts`: подмножество RRULE, пресеты, IANA-пояс, N дат, DST,
   проверка «раз в час», фраза. Агент. Blocked by: —.
   Готово, когда: `schedule-recurrence.test.ts` зелёный, включая DST в двух поясах.
3. **03 — Хранилище и согласие.** `src/main/schedules/store.ts`: два файла, отпечаток, Needs Accept, 20 активных, 50
   строк; каналы IPC с пометками `local`/`read`/`write`. Агент. Blocked by: 02.
   Готово, когда: `schedule-store.test.ts` и строки `link-access.test.ts` зелёные.
4. **04 — Порог Limits.** `src/main/schedules/limits.ts` и Settings → Schedules (5-часовое окно, недельный), поле порога
   у Schedule. Агент. Blocked by: 03.
   Готово, когда: `schedule-limits.test.ts` зелёный, Settings показывает оба порога со значениями по умолчанию.
5. **05 — Планировщик.** `src/main/schedules/scheduler.ts`: таймер, catch-up ≤ 6 ч, Missed, сон, пересечения, 2 часа,
   три ошибки, keep-awake на run; запуск в `src/main/index.ts`. Агент. Blocked by: 04, 06.
   Готово, когда: `schedule-scheduler.test.ts` и `schedules-missed.spec.ts` зелёные.
6. **06 — Scheduled run.** `src/main/schedules/run.ts`: worktree и ветка, Session Claude Code и Codex с принятым текстом,
   исходы, Attention item-ы источника `schedule`, уведомления, ADR-0108; корни берёт из Ticket-а 13. Агент.
   Blocked by: 03, 13.
   Готово, когда: `schedule-run-outcome`, `schedule-worktree`, `schedule-codex-start` зелёные.
7. **07 — Вид Schedules.** View button `schedules` (Footer по умолчанию), список, карточка, Pause/Resume, Delete с
   подтверждением, история; без Run now (он в Ticket-е 08). Агент. Blocked by: 03.
   Готово, когда: `schedules-view.test.tsx` и `view-buttons.test.ts` зелёные, снимки обеих тем приложены.
8. **08 — Редактор и Run now.** New schedule и Edit: поля, пресеты, Custom RRULE, пояс, три даты от main, порог,
   Accept/Save, проверка git; кнопка Run now на карточке. Агент. Blocked by: 02, 05, 07.
   Готово, когда: `schedule-editor.test.tsx` и `schedules.spec.ts` зелёные с выключенным Assistant-ом, Run now стартует run.
9. **09 — Assistant.** Tools `schedules_list`, `schedule_propose`, `schedule_change_propose`; карточки в чате; Delete
   только кнопкой. Агент. Blocked by: 05, 08.
   Готово, когда: `assistant-schedule-tools.test.ts` и `schedules-assistant.spec.ts` зелёные.
10. **10 — Linked machine.** Вид Schedules в окне Linked machine только для чтения, Pause при Full access, причина
    «Paused from <Machine>». Агент. Blocked by: 07.
    Готово, когда: `schedules-linked.spec.ts` зелёный.
11. **11 — Windows: фон и вход.** Две настройки, `window-all-closed`, `setLoginItemSettings`. Платформенный. Агент.
    Blocked by: 05.
    Готово, когда: на Windows CI job закрытое окно при включённом фоне не завершает worfy, обе настройки выключены по
    умолчанию.
12. **12 — Документация en и ru.** `docs/features/schedules.md` и `docs/features/ru/schedules.md`; правки `app-shell`,
    `assistant`, `link`; CONTEXT.md — View button с семью видами. Агент. Blocked by: 05–11, 13.
    Готово, когда: страницы en и ru говорят одно и то же и называют все случаи таблицы сбоев.
13. **13 — Корни Approval policy scheduled run-а.** `src/main/agent/auto-approve/roots.ts` и контекст политики для
    scheduled run-а: корни — его worktree, папка `<WORFY_DATA_DIR>/schedule-tmp/<run>` и scratchpad Session-а; рабочая
    копия Project-а и `.scratch` — не корни; push — park, как раньше. Код по Amendment-у ADR-0098 из Ticket-а 01.
    Агент. Blocked by: 01, 03.
    Готово, когда: `schedule-approval-roots.test.ts` зелёный, прежние test-ы Approval policy не менялись.
14. **14 — Приёмка владельцем.** Mac Stable и ПК, ручные пункты раздела «Готово, когда». Владелец. Blocked by: 01–13;
    `blocked --waits owner`.
    Готово, когда: владелец принял Epic.

## Волны

| Wave | Ticket-ы | Blocked by | Почему так |
|---|---|---|---|
| 1 | 01, 02 | — | ADR — только `docs/adr/`; правило — только `src/shared/schedules/` |
| 2 | 03 | 02 | хранилище держит правило в схеме |
| 3 | 04, 13, 07 | 03 / 01, 03 / 03 | порог (`src/main/schedules/limits.ts`, Settings), корни (`auto-approve/roots.ts`), вид (`src/renderer/schedules/`, `views.tsx`, `view-buttons.ts`): общих файлов нет |
| 4 | 06, 10 | 03, 13 / 07 | run (`run.ts`) и окно Linked machine (`ScheduleCard.tsx`, `link-access`) |
| 5 | 05 | 04, 06 | планировщику нужны порог и run (`scheduler.ts`, `index.ts`) |
| 6 | 08, 11 | 02, 05, 07 / 05 | e2e редактора и Run now ждут планировщик и run; Windows правит `index.ts` после 05 |
| 7 | 09 | 05, 08 | карточки чата повторяют поля редактора |
| 8 | 12 | 05–11, 13 | документация по сделанному |
| 9 | 14 | 01–13 | приёмка |

Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave); таблица — прогноз по
Blocked by и спискам файлов. 11 ждёт 05 не по смыслу, а потому что оба правят `src/main/index.ts`. Wave-ов на одну больше,
чем в первом черновике, зато test «Готово, когда» каждого Ticket-а может стать зелёным, когда Ticket начат (critic,
«Alternative»).

## Риски

- **Run без человека в обед.** Catch-up ≤ 6 ч может запустить «утренний» run в 13:00. Карточка и история помечают
  catch-up; prompt может сам проверить время. Порог 6 ч решён владельцем (Q10).
- **Расход Limits.** 20 Schedules раз в час — до 20 run-ов в час на одной Machine. Против — порог Limits до старта и
  пределы Q12; всё же это расход подписки пользователя, а не Assistant-а: доля Assistant-а (Ticket 27 worfy-assistant)
  scheduled run-ы не считает.
- **Push и PR.** Approval policy никогда не одобряет push сама (ADR-0098, пункт 4): Schedule, prompt которого просит PR,
  каждый раз упрётся в park. Вопрос 1 ниже.
- **Worktree-ы копятся.** Hourly-Schedule с правками даёт до 24 оставленных worktree-ов в день. История показывает их, и
  Remove worktree рядом; автоудаления с коммитами нет.
- **Windows без tray.** worfy в фоне без окна не видно: открыть его можно повторным запуском (единственный экземпляр,
  `requestSingleInstanceLock`, `index.ts:96`), а Quit — только из окна. Вопрос 5 ниже.

## Вопросы владельцу

Только то, что Q1–Q20 оставляют открытым. У каждого — рекомендация.

1. **Push и PR из scheduled run-а** (Q15 говорит «PR — только если просит prompt», но не говорит, кто одобряет push).
   (а) ADR-0098 как есть: push и `gh pr create` — park, Attention item, владелец одобряет в течение 60 минут или делает PR
   сам. Рекомендация: правило ADR-0098 «push никогда сам» держится с 2026-11-06, а Schedule-ы с PR, видимо, редки.
   (б) Новое правило allow: push своей ветки `schedule/<slug>/*` без force в `origin` и `gh pr create --draft` — ещё
   Amendment ADR-0098.
2. **Limits кончаются посреди run-а** (Q18 решает только старт). (а) Не останавливать: run идёт до конца хода или до 2
   часов; кончились Limits — Needs you. Рекомендация: run уже начат, а остановка на пороге теряет сделанное. (б)
   Останавливать на пороге.
3. **Pause с Linked machine при Read only** (Q17 + ADR-0066: Read only ничего не меняет). (а) Pause — только при Full
   access, ADR-0066 не меняется. Рекомендация. (б) Pause — исключение, доступное и при Read only, как аварийная
   остановка; это Amendment ADR-0066.
4. **Что такое «модель» в согласии** (Q3). (а) Точный id модели; псевдонимы вроде «Default» в редакторе не предлагаются;
   модели не стало — Skipped и Needs Accept с другой моделью. Рекомендация: иначе обновление Claude Code молча меняет
   модель без нового Accept. (б) Разрешить псевдоним; смена модели за ним согласия не снимает.
5. **Tray на Windows в фоне** (Q11 не называет). (а) Значок в tray, пока worfy в фоне без окна: Open worfy, Quit.
   Рекомендация: иначе фоновый worfy не закрыть без Task Manager. (б) Без tray.
6. **Сколько scheduled run-ов разных Schedules идёт одновременно** (Q12 запрещает только пересечение run-ов одного).
   (а) Без отдельного предела: хватает порога Limits и 20 активных. Рекомендация. (б) Не больше N одновременно, остальные
   ждут.

## Готово, когда

- [ ] Schedule создаётся в форме при выключенном Assistant-е и карточкой в чате; оба пути кончаются Accept.
- [ ] Три ближайшие даты считает main; правило чаще раза в час не принимается; DST в двух поясах верен.
- [ ] Scheduled run — Session на Canvas в worktree на ветке `schedule/<slug>/<YYYY-MM-DD-HHmm>` с ровно принятым текстом,
      Claude Code и Codex.
- [ ] Правка текста, Project-а, Vendor-а или модели без Accept не даёт run-у стартовать; Schedule — Needs Accept.
- [ ] Пропуск ≤ 6 ч — один catch-up; старше — строка истории и Attention item; run-ы одного Schedule не пересекаются; run
      не дольше 2 часов; больше 20 активных нельзя.
- [ ] Порог Limits — глобальный в Settings (80 %, недельный выключен) и свой у Schedule; run выше порога пропущен со
      строкой.
- [ ] Уведомление — только Error, Timed out и Needs you; «нужен человек» — Attention item.
- [ ] View button Schedules переносится между зонами; история хранит 50 run-ов; Delete — только кнопкой с подтверждением.
- [ ] Linked machine видит Schedules без правки и ставит на паузу.
- [ ] На Windows обе настройки есть и выключены по умолчанию.
- [ ] ADR, Amendment-ы ADR-0114 и ADR-0098, исключение ADR-0005 для worktree-ов и веток `schedule/*`, строка инвентаря
      ADR-0005, страницы Feature en и ru.
- [ ] (вручную) Владелец принял Epic на Mac и на ПК.
