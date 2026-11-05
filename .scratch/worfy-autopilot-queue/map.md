# Autopilot-очередь и Work track — карта

Карта поиска пути (wayfinder): Ticket-ы этой папки — вопросы, ответ на каждый — решение, а не код. Карта закончена, когда решать больше нечего.

## Destination

Два принятых владельцем spec-а с нарезанными Ticket-ами и Wave-ами, Wave 1 каждого готова к раздаче:

- `.scratch/worfy-autopilot-queue/spec.md` — Autopilot запускается, пока идёт работа (Run принят и ждёт, пока Orchestrator освободится), и Run идёт по очереди из нескольких Epic-ов;
- `.scratch/worfy-work-track/spec.md` — Work track: в Runs лента всей работы Project-а по датам за выбранный период (1 д, 7 д, 14 д, 1 мес), без привязки к одному Run-у.

## Notes

- Источник — слово владельца 2026-11-05: «нельзя запустить автопилот пока идет работа»; «запускать автопилот не только по одному эпику»; «в runs пункт full work track … таймлайн по датам с выбранным периодом (1д, 7д, 2нд, 1 мес) где можно будет отследить всю работу».
- Термины — `CONTEXT.md`: Autopilot (`:99`), Run (`:103`), Run mode (`:107`), Background task (`:201`), Orchestrator, Session, Subagent, Wave, Epic, Linked machine. Терминов Run history, Flight Recorder, Journal в глоссарии нет — их и Work track добавляет spec `worfy-work-track`.
- Действующие решения: ADR-0029 (Autopilot ждёт фоновые задачи: перезапуск Session убивает их), ADR-0022 (unattended Session — `bypassPermissions`), ADR-0091 (Run history, Run над названными Ticket-ами), ADR-0092 (Flight Recorder считает timeline из источников, своего хранилища нет — «долгая память» отвергнута).
- Что уже есть, по разведке 2026-11-05 (main db7ded110):
  - все пути старта сходятся в `Autopilot.start` (`src/main/autopilot/run.ts:848`); отказы «Orchestrator в ходе / фоновые задачи / очередь» — `src/main/agent/orchestrator.ts:213-219`, `:313-325`, ранняя проверка чата — `src/main/autopilot/chat-start.ts:48-52`; Autopilot не создаёт Session, а перезапускает ту же unattended (`orchestrator.ts:329`);
  - отказ кнопки Canvas виден только в `title` кнопки, без toast (`src/renderer/canvas/actions/action-button.ts:41,44`); после остановки Run-а с ошибкой при живых задачах Session остаётся unattended (`orchestrator.ts:303-304`) — случай 2026-11-03;
  - один Epic на Run: `Run.epic` (`run.ts:682`), `CycleState.epic` (`src/shared/autopilot/cycle.ts:81,173`), один Run на Project (`run.ts:741`), MCP tool `{epic, tickets?}` (`src/shared/canvas/tools.ts:87-88`), команда чата (`src/shared/autopilot/chat-command.ts:5-23`), поле `epic` журнала (`src/shared/autopilot/journal.ts:415`), Run history (`src/renderer/flight-recorder/RunHistoryView.tsx:24,111`);
  - Flight Recorder: timeline считается при открытии из журнала, транскриптов, GitHub и логов gate (`src/main/flight-recorder/service.ts:1-38`); Span-ы и lane-ы — `src/shared/flight-recorder/facts.ts:9-29`, `spans.ts:83`; вкладка `Runs` — `src/renderer/shell/Toolbar.tsx:63-73`, список Run-ов — `src/main/autopilot/journal.ts:173-197`;
  - сроки источников: транскрипты 30 дней (`cleanupPeriodDays`), логи gate — 10 на worktree и 8 дней после удаления worktree, GitHub и журналы Run-ов — без срока; смена статуса Ticket-а вне Run-а не записывается (ADR-0092).
- Skills: research для research-Ticket-ов, grilling + domain-modeling для grilling-Ticket-ов, prototype для prototype-Ticket-ов. Документы по-русски, термины латиницей. Ответы research-Ticket-ов — в раздел `## Answer` самого Ticket-а с источниками; веток `research/*` нет (как в картах Flight Recorder и Multi-vendor).
- Режим владельца 2026-11-05: полная автономия; вопросы — раундами, по рекомендации, когда владельца нет.

## Decisions so far

- [01 — Destination и масштаб](issues/01-destination-и-масштаб.md): два spec-а из одной карты; старт при идущей работе — Run принят и ждёт; несколько Epic-ов — очередь по порядку; Work track считается из источников без хранилища, журнал работы — только если не хватит; вся работа Project-а на этой Machine; имя «Work track».

- [04 — Данные для Work track](issues/04-данные-work-track.md): за 1–14 дней источников хватает без журнала работы; транскрипты — ровно 30 дней (4 ГБ, ~12 с), GitHub полон, но нынешний reader (3 вызова `gh` на ветку) не годится для месяца — нужен пакетный GraphQL; логи gate живут 8–13 дней, ручные Wave-ы нигде не записаны. Рекомендация: без своего хранилища, две правки Harness — `timings.json` gate 31 день и строки начала/конца каждой Wave в `epic-wave`; иначе — минимальный журнал и новый ADR.

- [02 — Старт при идущей работе](issues/02-старт-при-идущей-работе.md): Run ждёт только ход, очередь и фоновые задачи Orchestrator-а; Start now после подтверждения, Cancel, без предела; причина `orchestrator-busy`; Run, остановленный ошибкой, сразу отдаёт Session; окно запуска внутри worfy для кнопки и `autopilot_start` (прототип `card-918c77d9` принят).
- [03 — Очередь Epic-ов](issues/03-очередь-epic-ов.md): список в чате, MCP tool и «Run all accepted»; правка между Wave-ами без перестановки; Epic, ждущий владельца, пропускается; красный CI main и `limits-timeout` — стоп всего Run-а; новое определение Run.
- [05 — Вид Work track](issues/05-вид-work-track.md): прототип `card-dcf3918a` принят: «Run history | Work track», Day / Week / Month, by Session / by Epic, сводка одной строкой, панель Span-а.
- [06 — Объём и доступ Work track](issues/06-объём-и-доступ-work-track.md): все Session этой Machine, только названия, без Linked machine; журнала нет — «данных нет» и две правки Harness-а; `cleanupPeriodDays` 35.

Destination достигнут 2026-11-05: [spec.md](spec.md) (Ticket-ы 07–20) и [../worfy-work-track/spec.md](../worfy-work-track/spec.md) (Ticket-ы 01–12) — ждут приёмки владельцем.

## Not yet specified

- Work track с работой Linked machine (ПК) в той же ленте — вне первой версии (решение 06, Q3); отдельный Epic, если понадобится.
- Свой журнал работы вне Run-а — не нужен по ответу 04 и решению 06; вернуться, только если Work track с правками Harness-а не покажет нужного (тогда новый ADR, отменяющий часть ADR-0092).

## Out of scope

- Wave-ы, смешивающие Ticket-ы разных Epic-ов параллельно (Q3 (б) Ticket-а 01): нужен `epic-wave` и gate по нескольким Epic-ам сразу — отдельное усилие.
- Run в отдельной Session Orchestrator-а параллельно ручной (Q2 (г) Ticket-а 01): ломает правило «один Orchestrator на Project».
