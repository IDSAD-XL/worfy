# Flight Recorder — карта

Карта поиска пути (wayfinder): Ticket-ы этой папки — вопросы, ответ на каждый — решение, а не код. Карта закончена, когда решать больше нечего.

## Destination

Принятый владельцем `spec.md` Epic-а `worfy-flight-recorder` с нарезанными Ticket-ами и Wave-ами, готовый к раздаче. Сам spec описывает Flight Recorder: одну временную шкалу Run — Wave-ы, Ticket-ы, агенты, повторы, ожидания и блокировки, commit-ы, PR и gate verdict на каждом шаге, и где ушло больше всего времени. Цель: после ночного Run не читать пять транскриптов, чтобы понять, что произошло.

## Notes

- Термины — `CONTEXT.md`: **Run** (заведён этой картой), Wave, Stage, Pipeline, Autopilot, Session, Subagent, Machine.
- Ограничения, которые уже действуют: ADR-0002 (worfy — view над workflow, нового хранилища событий нет), ADR-0067 (Stage вычисляется, нигде не хранится), Silent mode (в commit-ах и PR нет следов workflow).
- Что уже есть, по разведке 2026-11-01:
  - Autopilot Journal — один JSONL на Run, `<data dir>/autopilot/<run>.jsonl`, 18 видов событий, run id = время старта + 6 hex (`src/shared/autopilot/journal.ts`);
  - `decisions.tsv` и `wave-brief.txt` Harness — в `~/.claude/worfy-harness/runs/<project>/<epic>-wave-<время>/`, общего ключа с Journal нет;
  - транскрипты Session и Subagent (`src/shared/transcript/`) — session id и agent id, без Ticket и Epic;
  - gate — только последний verdict на worktree и логи последних 10 запусков (`harness/hooks/gate.mjs`, `gate-log.mjs`);
  - заголовок Ticket-а — только текущий статус; GitHub — только в памяти (`src/main/github/prs.ts`);
  - `scripts/critical-path.mjs` — офлайн-разбор claim → PR → CI → Gate → merge из тех же источников, самый близкий прототип.
- Вид, который владелец показал как пример (не инструкция): waterfall из APM-tracing — слева дерево spans с отступами, справа полосы на общей оси времени с длительностью, цвет по сервису, фильтр, переключатель «только ошибки», под выбранным span — панель деталей с вкладками.
- Пожелания владельца: после остановки Autopilot предлагать посмотреть историю Run; Autopilot, запущенный из чата, — такой же Run, как запущенный кнопкой.
- Skills: grilling + domain-modeling для grilling-Ticket-ов, prototype для prototype-Ticket-ов. Документы — по-русски, термины латиницей.

## Decisions so far

- [01 — Destination, единица истории, хранение и id](issues/01-destination-единица-истории-хранение-id.md): spec Epic-а как финиш; единица — Run; шкала вычисляется при открытии, дыры закрываются в источниках; ключ — run id Journal; разбор `critical-path.mjs` становится общим модулем; аналитика по многим Run — вне карты.
- [02 — Autopilot из чата — тот же Run, что кнопкой?](issues/02-autopilot-из-чата-тот-же-run.md): нет — Run и Journal создаёт только кнопка; при остановке интерфейс показывает лишь строку статуса; читателя Journal для интерфейса нет.
- [09 — Что значит «Autopilot из чата считается запуском»](issues/09-что-значит-autopilot-из-чата.md): команда и просьба словами («на автопилоте», «автономно») запускают тот же Autopilot, что кнопка; словами — через инструмент `autopilot_start` с подтверждением; Run с названными Ticket-ами ведёт только их.
- [03 — Модель spans](issues/03-модель-spans.md): дерево Run → Wave → Ticket → Stage → работа (агент, CI, gate) плюс дорожки Wait и Orchestrator; Stage выводится из событий; Wait — span с причиной, блокировка — отметка, повтор — span с номером попытки; собственное время и итог «где ушло время».
- [04 — Дыры источников и кто их закрывает](issues/04-дыры-источников.md): почти всё читается после факта (транскрипты, GitHub, логи gate); новое в Journal — только `ticket-status` и конец `gate-queue`, пишет только worfy main.
- [05 — Экран шкалы Run](issues/05-экран-шкалы.md): прототип в Card `card-57714d55` принят: итог сверху, дорожки Wait и Orchestrator, повторы с «#2», «Problems only»; экран — во весь основной viewport окна worfy; подписи не пересекают полосы.
- [06 — Предложение после остановки и прошлые Run](issues/06-предложение-после-остановки-и-прошлые-run.md): toast при остановке живёт до закрытия, ссылка «History» в строке статуса; прошлые Run — выбор на экране, меню рамки Epic, Command palette; без уведомлений ОС.
- [07 — Живая шкала или только после остановки](issues/07-живая-шкала-или-после-остановки.md): живая; пересчёт не чаще раза в несколько секунд, GitHub — раз в минуту.
- [08 — Неполная история](issues/08-неполная-история.md): потерянный источник — серый span со штриховкой и подписью; каркас Run живёт с Journal, подробности угасают с источниками; без GitHub — «GitHub не ответил» и «Retry».

## Not yet specified

Ничего: особенности Windows разобраны в [spec.md](spec.md), раздел «Windows».

## Out of scope

- Аналитика по многим Run: медианы, «где мы всегда теряем время», сравнение Run-ов. Это следующая карта; Flight Recorder — её фундамент, поэтому модель spans делается пригодной для сводок (решение 01).
- Запись для «Run wave» с Canvas и из Command palette и для Wave, начатых в Claude в терминале вне worfy (решение 09: Run для них нет).
- Ручная работа Orchestrator-а над Epic без Autopilot.
- Run, который шёл на другой Machine, — смотреть его через Link (решение 01, Q7: Run виден на своей Machine).
- Стоимость в токенах на span рядом со временем.
- Текстовая выжимка Run для чата Orchestrator-а.
- Ожидание e2e lock как отдельный Wait (решение 04: в v1 часть span агента).
