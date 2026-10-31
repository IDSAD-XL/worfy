# Flight Recorder — карта

Карта поиска пути (wayfinder): Ticket-ы этой папки — вопросы, ответ на каждый — решение, а не код. Карта закончена, когда решать больше нечего.

## Destination

Принятый владельцем `spec.md` Epic-а `worfy-flight-recorder` с нарезанными Ticket-ами и Wave-ами, готовый к раздаче. Сам spec описывает Flight Recorder: одну временную шкалу Run — Wave-ы, Ticket-ы, агенты, повторы, ожидания и блокировки, commit-ы, PR и gate verdict на каждом шаге, и где ушло больше всего времени. Цель: после ночного Run не читать пять транскриптов, чтобы понять, что произошло.

## Notes

- Термины — `CONTEXT.md`: **Run** (заведён этой картой), Wave, Stage, Pipeline, Autopilot, Session, Subagent, Machine.
- Ограничения, которые уже действуют: ADR-0002 (worfy — view над workflow, нового хранилища событий нет), ADR-0067 (Stage вычисляется, нигде не хранится), Silent mode (в commit-ах и PR нет следов workflow).
- Что уже есть, по разведке 2026-11-01:
  - Autopilot Journal — один JSONL на Run, `<data dir>/autopilot/<run>.jsonl`, 23 вида событий, run id = время старта + 6 hex (`src/shared/autopilot/journal.ts`);
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

## Not yet specified

- «Run wave» с Canvas и из Command palette и Wave, начатые в Claude в терминале вне worfy, — Run для них нет (решение 09); нужна ли им запись.
- Ручная работа Orchestrator-а над Epic без Autopilot (как сегодня: агенты, merge-скрипты, ПК через bridge) — показывать ли её той же шкалой и что тогда начало и конец.
- Run, который шёл на ПК, — смотреть ли его с Mac через Link.
- Стоимость в токенах на span (по `scripts/agent-cost.mjs`) рядом со временем.
- Короткая текстовая выжимка Run для чата Orchestrator-а, сделанная из той же шкалы.
- Особенности Windows (пути, время файлов) — когда станет ясна модель источников.

## Out of scope

- Аналитика по многим Run: медианы, «где мы всегда теряем время», сравнение Run-ов. Это следующая карта; Flight Recorder — её фундамент, поэтому модель spans делается пригодной для сводок (решение 01).
