# 23 — Run Autopilot-а, остановленный пользователем, не срочный: пункт несёт причину остановки

Type: task
Status: done 2026-11-26T07:22Z
PR: #2259
Blocked by: —
Source: решение владельца 2026-11-26 (раунд Q1–Q12 вечернего отчёта 2026-11-25), Q5; меняет решение 3 Ticket-а 06
(«Остановка самим пользователем тоже срочная», [Ticket 06](06-решение-о-пробуждении.md), «Решено без владельца»).
[spec.md](../spec.md), «Волны»: Wave 6.

Кто: агент.

## Что происходит

Строка `run-stopped` журнала Run-а Autopilot-а становится пунктом ядра внимания в `autopilotAttention`
(`src/main/assistant/core/sources.ts:171-189`). Вид пункта — `run-stopped`, кроме остановки `tickets-done`: она —
`run-finished` (`sources.ts:174`, `:184`). Причина остановки попадает только в текст пункта, строкой вида
`<epic>: user-stop` (`sources.ts:175`, `:185`); отдельного поля с причиной у события и у пункта нет
(`AttentionEvent` и `attentionItemSchema`, `src/shared/assistant/attention.ts:62-…`, `:83-…`).

Решение о пробуждении (Ticket 06) считает срочным любой пункт вида из `URGENT_ITEM_KINDS` = `run-stopped`
(`src/main/assistant/wake/planner.ts:31`, проверка — `planner.ts:123`). Поэтому Run, который пользователь остановил сам
кнопкой Stop, будит Assistant-а сразу, в любой час, — и тратит пробуждение из дневного предела на то, что пользователь
и так знает.

## Что строить

1. **Причина в пункте.** Событие и пункт остановки Run-а несут причину отдельным полем (не текстом), со значением из
   `AUTOPILOT_STOP_REASONS` (`src/shared/autopilot/cycle.ts:76`). Форму поля (необязательное поле события и пункта
   или свой вид пункта) выбирает агент; файл пунктов без поля читается, и старая сборка worfy читает файл с ним.
2. **Остановка пользователем не срочная.** Решение о пробуждении не считает срочной остановку самим пользователем:
   такой пункт идёт с пачкой или утренней сводкой, как прочие несрочные. Остальные остановки остаются срочными, как
   сейчас.
3. **Что значит «пользователем».** Точно — `user-stop` и `user-force-stop`. По комментарию к причинам
   (`cycle.ts:63-75`) рядом стоят `start-cancelled` (Cancel, пока Run ждал Orchestrator) и `discarded` (человек
   отбросил Run, оборванный перезапуском); `app-quit` осталась только для старых журналов. Агент решает, какие из них
   тоже не срочные, и пишет в «Решено без владельца» (рекомендация: `start-cancelled` и `discarded` — тоже
   пользователем).
4. **Текст пункта** называет причину словами, а не id причины (`user-stop`). Слова для остановки бюджетом уже есть
   (`src/shared/autopilot/budget.ts:211`); для остальных агент пишет короткие английские фразы по
   `docs/design/BRIEF.md`.

## Где в коде

- `src/main/assistant/core/sources.ts:28` (`AUTOPILOT_ITEM_KINDS`), `:171-189` (`autopilotAttention`, с комментарием).
- `src/shared/assistant/attention.ts:62-…` (`AttentionEvent`), `:83-…` (`attentionItemSchema`).
- `src/main/assistant/core/attention-core.ts` — склейка события в пункт, если поле добавляется.
- `src/main/assistant/wake/planner.ts:31` (`URGENT_ITEM_KINDS`), `:116-131` (`evaluate`, срочность).
- Только читать: `src/shared/autopilot/cycle.ts:63-101` (`AUTOPILOT_STOP_REASONS`), `src/shared/autopilot/budget.ts:211`.
- Test-ы: `test/unit/assistant-attention-sources.test.ts`, `test/unit/assistant-wake-planner.test.ts`.

## Решения

- Решение 3 Ticket-а 06 меняется только для остановки пользователем; решения 2 и 4 Ticket-а 06 (срочное — остановка
  Run-а и эскалация; остановка до первого запуска не срочная) остаются.
- Обязанность «Work stands» (`src/shared/assistant/duties.ts:115-124`) по-прежнему показывает такой пункт; убирать ли у
  него предложение `autopilot-start` («Start Autopilot again»), агент решает и пишет в «Решено без владельца».

## Test-ы

- Unit test источника: строка `run-stopped` с `user-stop` даёт пункт с причиной в поле; с `main-red` — тоже, со своей
  причиной; `tickets-done` — `run-finished`, как сейчас.
- Unit test решения о пробуждении (ненастоящие часы, вне work hours): остановка пользователем не будит; остановка
  `main-red` или `turn-hung` будит сразу, как сейчас. Сначала красный на нынешнем коде.
- Unit test: файл пунктов без поля причины читается.

## Готово, когда

- [ ] Unit test: пункт остановки Run-а несёт причину отдельным полем; текст называет её словами.
  - evidence: test-run pass · `pnpm test test/unit/assistant-attention-sources.test.ts` exit 0 · mac - · 406d907cdb3bb4e0c31517a9f29f64d4b2ba629f
  - evidence: review pass · PR #2259 · - - · 3ef683998e7c86b1817f786bb6dae20f53adf036
- [ ] Unit test: остановка самим пользователем не будит Assistant-а, другие остановки будят сразу.
  - evidence: test-run pass · `pnpm test test/unit/assistant-wake-planner.test.ts` exit 0 · mac - · 406d907cdb3bb4e0c31517a9f29f64d4b2ba629f
  - evidence: review pass · PR #2259 · - - · 3ef683998e7c86b1817f786bb6dae20f53adf036
- [ ] Unit test: файл пунктов, записанный до этого Ticket-а, читается.
  - evidence: test-run pass · `pnpm test test/unit/assistant-attention-sources.test.ts` exit 0 · mac - · 406d907cdb3bb4e0c31517a9f29f64d4b2ba629f
  - evidence: review pass · PR #2259 · - - · 3ef683998e7c86b1817f786bb6dae20f53adf036
- [ ] «Итог»: какие причины считаются остановкой пользователем — в «Решено без владельца».
  - evidence: commit pass · worfy-assistant/23: an Autopilot Run the user stopped does not wake the Assistant · - - · 406d907cdb3bb4e0c31517a9f29f64d4b2ba629f
  - evidence: review pass · PR #2259 · - - · 3ef683998e7c86b1817f786bb6dae20f53adf036
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45766222586/job/139754923964 · ci - · 3ef683998e7c86b1817f786bb6dae20f53adf036

## Итог

- Причина — необязательное поле `stopReason` события (`AttentionEvent`, тип `AutopilotStopReason`) и пункта
  (`attentionItemSchema`, `src/shared/assistant/attention.ts`). Источник (`autopilotAttention`,
  `src/main/assistant/core/sources.ts`) ставит его на каждую строку `run-stopped`, `tickets-done` (`run-finished`) тоже.
  Ядро (`attention-core.ts`) кладёт поле в новый пункт; при склейке поле берётся из последнего события: строка Run-а
  после остановки его убирает.
- Текст пункта называет причину словами: `AUTOPILOT_STOP_WORDS` в `sources.ts`, по одной короткой английской фразе на
  каждую причину `AUTOPILOT_STOP_REASONS` (`Record` по всему списку: новая причина без слов не пройдёт typecheck). Для
  `start-cancelled`, `start-refused`, `waits-owner`, `main-red`, `turn-hung` — те же слова, что в Run history
  (`src/renderer/flight-recorder/span-words.ts`; у `turn-hung` без числа минут). За словами в скобках остаётся id причины
  (`worfy-x: stopped by the user (user-stop)`): правило Project-а сравнивает текст пункта (`when.item.text`,
  `src/main/assistant/duties/rules.ts`), и правило с текстом `main-red` продолжает срабатывать.
- Срочность — одно правило `isUrgentStop` с `USER_STOP_REASONS` и `URGENT_ITEM_KINDS` в `src/shared/assistant/attention.ts`:
  пункт `run-stopped` с причиной пользователя не срочный и идёт с пачкой или утренней сводкой. Остальные остановки, пункт
  без поля (файл до этого Ticket-а) и причина, которую сборка не знает, — срочные, как раньше. Правило читают и решение
  о пробуждении (`src/main/assistant/wake/planner.ts`), и окно Assistant-а (`isUrgentItem`,
  `src/shared/assistant/window.ts`, Ticket 14): остановка пользователем не даёт и системного уведомления.
- Test-ы: `test/unit/assistant-attention-sources.test.ts` (блок «the stop of an Autopilot Run (ticket 23)»),
  `test/unit/assistant-wake-planner.test.ts` (два test-а про остановку пользователем); оба файла сначала красные на
  нынешнем коде. Test склейки строки Run-а после остановки красный без `delete glued.stopReason`.

### Решено без владельца — подтверждено владельцем 2026-11-26

1. **Остановка пользователем** — `user-stop` (Stop), `user-force-stop` (Force stop), `start-cancelled` (Cancel, Stop или
   Force stop, пока Run ждал Orchestrator) и `discarded` (человек отбросил Run, оборванный перезапуском): обо всех
   четырёх пользователь знает сам, по рекомендации Ticket-а. `app-quit` (только старые журналы), `limits-timeout`,
   `turn-error` и `interrupted` остаются срочными, хотя каждую из них может вызвать и действие пользователя:
   `limits-timeout` пишет и отмена ожидания Limits кнопкой Cancel, и истечение 24 часов; `turn-error` — и ошибка хода, и
   Cancel ожидания повтора в чате Orchestrator-а; `interrupted` — и прерванный ход Wave, и Interrupt из чата
   Orchestrator-а. По строке журнала их не различить.
2. **Форма поля** — необязательное поле `stopReason`, не свой вид пункта: вид `run-stopped` остаётся, обязанность «Work
   stands» и всё, что смотрит на вид, работают как раньше. В файле поле — любая строка (`z.string()`), не перечисление:
   `cycle.ts` через шаблоны действий и обязанности импортирует `attention.ts`, и импорт списка причин в схему дал бы
   цикл импорта; к тому же причина, которую добавит более поздняя сборка, не сделает файл нечитаемым. Источник кладёт
   только причины из `AUTOPILOT_STOP_REASONS`; незнакомую причину он оставляет только в тексте, как журнал её записал.
   Старая сборка читает файл с полем: схема пункта не `strict`, zod отбрасывает незнакомое поле.
3. **Слова бюджета** (`budgetStopText`, `src/shared/autopilot/budget.ts`) не используются: остановка бюджетом — строка
   `budget-stop` и ожидание, а не `run-stopped`, и у `run-stopped` нет ни причины бюджета, ни времени продолжения.
4. **Предложение `autopilot-start` у «Work stands» остаётся**: действия задаются на обязанность, а не на пункт, режим
   `ask` только предлагает, и само действие лишь открывает диалог Start Autopilot. Пользователь, который остановил Run,
   может хотеть запустить его снова; убирать предложение только для его пунктов — отдельная логика ради малого.
