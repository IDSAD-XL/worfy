# 0108 — Работа продолжается после перезапуска worfy: Run и Session идут дальше с того же места
Дата: 2026-11-18. Статус: принят.

**Контекст.** До Epic-а `worfy-continuity` выход из worfy останавливал каждый Run с `app-quit`, обрывал turn-ы Session-ов
и терял очереди сообщений. Update ждал, пока ничего не работает, поэтому ночной Run держал его до утра. После перезапуска
человек сам искал, что было в работе, и продолжал Ticket-ы руками. `resumable` жил только в памяти main (ADR-0050), а
состояние Session — только в памяти (ADR-0010). Владелец не ответил на вопросы spec-а: каждый решён рекомендованным
вариантом (а) по его указанию «сразу запускай» 2026-11-17, с пометкой «подтвердить»
(`.scratch/worfy-continuity/spec.md`, «Вопросы владельцу», Q1–Q5).

**Решение.**

1. **Выход приостанавливает, а не останавливает (Ticket 04).** Один координатор выхода (`src/main/quit-grace.ts`) ведёт
   выход из приложения, Restart now у Update и выключение системы. Он приостанавливает каждый Run, держит очереди
   Session-ов и ждёт внешние вызовы без результата — `git push`, `gh pr merge`, вызов MCP server-а, Subagent — не дольше
   60 секунд, с окном **Quitting worfy** и кнопкой **Quit now** (Q2 (а)). Вызовы Subagent-ов он читает из их транскриптов
   (Ticket 07). Затем turn-ы останавливаются по ADR-0064 (interrupt, 7,5 с, SIGKILL, ещё 2 с), и каждый Run пишет
   `run-suspended`. Выключение системы не ждёт: записи пишутся сразу.
2. **Journal Run-а — его checkpoint (Ticket 02).** Всё, что нужно перезапуску, читается из строк journal-а
   (`src/shared/autopilot/checkpoint.ts`): очередь Epic-ов, Wave и её Ticket-ы в работе, открытый Wait с его концом,
   счёт повторов и продолжений, `resumable`. Две новые строки: `run-suspended {cause: quit | update | shutdown, wave,
   tickets, wait}` и `run-continued {after: quit | update | shutdown | crash}`. Имя `resumed` уже занято концом Wait-а,
   поэтому имя другое. Run оборван, если последняя строка — `run-suspended` или `run-stopped` нет вовсе.
   `run-stopped` с `app-quit` новый выход не пишет; причина остаётся для старых journal-ов.
3. **Запись живых Session-ов (Ticket 03).** `live-sessions.json` в подпапке Project-а (папка данных worfy, ADR-0005)
   называет Session-ы, у которых идёт turn или есть очередь: Vendor и id session или thread, состояние, тексты очереди,
   удержана ли очередь, Run-владелец, время последнего события и автоматические продолжения за час. Файл с `version`,
   main пишет его атомарно на каждое изменение. Выход останавливает запись раньше, чем закрываются Session-ы, поэтому
   после выхода, Update или падения файл называет оборванные Session-ы. Binding в файл не копируется: он читается
   заново из транскриптов (ADR-0002).
4. **Правило часа и cap 2 (Q3 (а)).** Оборванный Run или Session продолжается сам, только если обрыв был не больше часа
   назад и за последний час он сам продолжался меньше двух раз. Run считает по строкам `run-continued`, Session — по
   своей записи в `live-sessions.json`. Иначе работа ждёт человека: у Run-а — строка `cut off by restart · 14:05` с
   **Resume** и **Discard**, у Session Node — chip **Interrupted by restart** с **Continue**. Cap не даёт продолжению,
   которое роняет приложение, зациклиться.
5. **Продолжение Session (Ticket 05).** Session получает одно сообщение: worfy перезапустился и оборвал её turn, какие
   Subagent-ы стали Interrupted и их Ticket-ы, проверь, что сделала каждая команда, прежде чем повторять её. Исходное
   сообщение снова не уходит, очередь возвращается как была. Session, которой владеет Run, оставлена Run-у. Перед
   продолжением worfy ждёт, затем убивает прежний процесс Claude Code, оставшийся от умершего worfy.
6. **Продолжение Run-а (Ticket 06).** Тот же Run идёт дальше под тем же id и в том же journal-е. Открытый Wait идёт до
   своего конца; иначе сразу уходит следующая Wave, в которой Ticket-ы оборванной Wave в работе идут как возобновлённые;
   команда оборванной Wave снова не уходит, номер новой Wave следует за оборванной. Пока оборванный Run ждёт Resume или
   Discard, старт любого Run-а в Project-е отклоняется, а кнопка Autopilot его Epic-а неактивна. Строка с Resume и
   Discard стоит только в рамке Epic-а этого Run-а (`src/renderer/canvas/actions/AutopilotAction.tsx`). Discard пишет
   `run-stopped` с новой причиной `discarded`, и Ticket-ы его Wave в работе становятся `resumable`, как после Force stop.
   На Linked machine Resume, Discard и Checked, include требуют Full access (ADR-0066).
7. **Unknown side effects ждут человека (Q4 (а); Ticket-ы 16 и 07).** Ticket, у implementer-а которого внешний вызов
   без результата, в продолженную Wave не идёт: он остаётся в `claimed`, получает метку **unknown side effects** с
   tooltip-ом о вызове и toast с **Checked, include**. Метка — строка journal-а `unknown-side-effects {ticket, actions}`,
   снимает её `side-effects-checked`. Метки живут в journal-е, поэтому переживают перезапуск и переходят к следующему
   Run-у того же Epic-а. Вызов без результата у самого Orchestrator-а или у Subagent-а, не привязанного ни к одному
   Ticket-у, удерживает все Ticket-ы Wave. Discard сначала читает вызовы оборванной Wave и помечает удержанные
   Ticket-ы до `run-stopped`.
   worfy не сверяет git и GitHub сам: включить Ticket — всегда решение человека. Читаются только транскрипты Claude
   Code: на Orchestrator-е Codex ни один Ticket не удерживается. Новый Recovery invariant I10: Ticket, помеченный
   `unknown-side-effects`, не входит ни в одну более позднюю `wave-started` до своего `side-effects-checked`.
8. **Update во время работы (Q1 (а); Ticket 08).** "Restart now" предлагается всегда, и во время работы тоже, рядом с
   "Restart when idle". Нажатие — согласие на 60 секунд ожидания при выходе и на приостановку Run-ов. Run в Wait-е Limits,
   budget или Start window не считается работой и не держит "Restart when idle": перезапуск приостанавливает его, и
   после старта он ждёт дальше. Причина перезапуска уходит в `update/restart.json`, поэтому `run-continued` и строка в
   Session view называют `update`, а не `crash`.
9. **Wait `restart` в Run history и Work track (Ticket 09).** Продолженный Run — один Run с Wait-ом `restart (<cause>)` от
   `run-suspended` (после падения — от последней строки перед ним) до `run-continued`.
10. **Compaction (Ticket-ы 10–12).** Hook `PreCompact` даёт модели summary инструкции `harness/hooks/rules/compaction.md`,
    а hook `SessionStart` с источником `compact` (`after-compact.mjs`) возвращает агенту состояние работы из файлов. Epic
    знает только Orchestrator, которого Autopilot запускает без человека: при старте Run-а и для новой session перед
    каждой Wave он получает `WORFY_EPIC` в окружении и строку system prompt с именем Epic-а. Orchestrator, открытый
    человеком, или «Run wave», отправленный в него руками, своего Epic-а не несёт: окружение процесса задано при старте,
    и worfy не перезапускает Orchestrator ради переменной; там Harness берёт Epic ветки checkout-а. На Codex worfy задаёт
    thread-у `compact_prompt` — полный prompt с теми же правилами; он заменяет `compact_prompt` из config.toml
    пользователя для thread-ов, которые запускает worfy.
11. **ADR-0010 сверен.** Его фраза «Состояние Session живёт только в памяти» больше не верна: `live-sessions.json`
    хранит состояние и очередь живых Session-ов в папке данных. В ADR-0010 дописан Amendment. Его решение о Layout
    остаётся в силе: `data` Node-а `orchestrator` по-прежнему несёт только `sessionId`, `costUsd` и `vendor`.
12. **Daemon — вне решения (Q5 (а)).** Процесс, который держит Session-ы живыми без worfy, решается после замеров этого
    Epic-а: сколько работы ещё теряется на перезапуске.

**Последствия.**

- Выход и Restart now во время работы могут длиться до 60 секунд дольше; Quit now их обрывает.
- Run, оборванный больше часа назад или в третий раз за час, ждёт человека, и пока он ждёт, другой Run в Project-е не
  стартует.
- Ticket с unknown side effects ждёт человека, даже если вызов на самом деле не выполнился. Автоматическую сверку git и
  GitHub (Q4 (б)) стоит делать, когда станет видно, как часто встаёт метка.
- Lock-и оборванной Wave worfy не снимает: lock worktree — рекомендательный и лежит под `~/.claude`, куда worfy не
  пишет (ADR-0005); e2e lock старше 30 минут перехватывает следующий запуск.
- Сборка старше этого решения читает `run-suspended` и `run-continued` как незнакомые строки и пропускает их.
- Известное ограничение (Ticket 12): в очереди Epic-ов первая Wave следующего Epic-а может уйти в Session прежнего
  Epic-а, когда Orchestrator не свободен для новой session; после compaction Harness тогда возвращает состояние
  прежнего Epic-а, пока Run не начнёт новую session.

Источник: spec `.scratch/worfy-continuity/spec.md`; Ticket-ы 02–12 и 16 Epic-а `worfy-continuity`; страницы
`docs/features/autopilot-faults.md`, `docs/features/sessions.md`, `docs/features/updates.md`,
`docs/features/storage-and-diagnostics.md`, `docs/features/flight-recorder.md`, `docs/features/skills-agents-and-hooks.md`.

## Considered Options

- **Продолжение с правилом часа и cap 2, unknown side effects ждут человека** (выбрано, Q1–Q5 (а)).
- **Всегда по кнопке (Q3 (б)).** Отвергнуто: Update и выход — это минуты, и ночной Run стоял бы до утра.
- **Всегда само (Q3 (в)).** Отвергнуто: продолжение, которое роняет приложение, зациклилось бы, а работа, оборванная
  давно, могла уже уйти дальше руками.
- **Выходить сразу, как раньше (Q2 (б)).** Отвергнуто: обрыв посреди `git push` или `gh pr merge` — ровно то, что потом
  проверяют руками.
- **Продолженная Wave сама сверяет git и GitHub и включает Ticket (Q4 (б)).** Отложено: ещё одна проверка, которая может
  ошибиться в обе стороны.
- **Update во время работы — только "Restart when idle" (Q1 (б)).** Отвергнуто: решение 7 worfy-update принято, когда
  работа после перезапуска терялась.
- **Daemon, который держит Session-ы (Q5 (б)).** Отложено: у похожих продуктов daemon — главный источник жалоб, а
  продолжение может закрыть большую часть потерь без него.
- **Отдельное хранилище состояния Run-а рядом с journal-ом.** Отвергнуто: journal уже единственная запись, которая
  переживает приложение; второй источник мог бы с ним разойтись.
