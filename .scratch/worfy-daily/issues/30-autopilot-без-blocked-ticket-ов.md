# 30 — Autopilot не берёт в Wave Ticket-ы не в `open` и называет Orchestrator-у Ticket-ы Wave

Type: task
Status: claimed — 2026-10-06
Blocked by: —
Source: второй настоящий прогон Autopilot 2026-10-06 (стабильная копия `~/Applications/worfy-stable.app`, собрана из main 9fcdaff): журнал прогона `~/Library/Application Support/worfy/autopilot/2026-10-06T12-14-04-168Z-c924e5.jsonl`, транскрипт Orchestrator-а `~/.claude/projects/-Users-alexey-Stuff-CanvasForAI/f6ab7045-416c-471a-a78d-433567aefa5a.jsonl`; [spec.md](../spec.md), тема A; [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md), пункт 5; Ticket 04

## Что произошло

Прогон по журналу (время UTC, события `background-tasks` опущены):

1. 12:14:04 — `run-started`. Wave 1 прогона — Ticket-ы 06–09 (Wave 5 плана), кончилась в 13:06:50.
2. 13:06:51 — Wave 2 прогона: 10, 12, 13, 14, 15, 22, 26 (Wave 6 плана). Два отклонённых диалога
   (`refused-dialog`, 13:17 и 13:47). Кончилась в 15:24:02: Orchestrator закрыл Wave 6, Ticket 15
   вывел из неё со Status `blocked` (две проверки с находками, [PR #48](https://github.com/IDSAD-XL/worfy/pull/48)
   открыт). Коммит dd2c34e с этим Status влит в main в 15:23:46, checkout Project-а подтянут в 15:23:50.
3. 15:24:02.780 — `wave-started`, Wave 3 прогона: `["11","15","23","25","27"]`. Ticket 15 в Wave.
4. Orchestrator получил `/epic-wave волна 6 эпика worfy-daily`. Номер 6 — Wave плана Ticket-а 15 в
   таблице «Волны» spec.md. Wave 6 плана уже закрыта. Orchestrator прошёл preflight и ответил:
   «Волна 6 эпика worfy-daily уже закрыта, перезапускать в ней нечего». Ход кончился.
5. 15:24:23.213 — `wave-finished` и `run-stopped` с причиной `no-progress`. В журнале нет ни
   текста, который ушёл Orchestrator-у, ни его ответа: почему прогон встал, видно только в транскрипте.

Первый прогон (10:17, Ticket 29) отправил `/epic-wave волна 4 эпика worfy-daily` для Ticket-ов 06–09.
Тогда номер совпал с таблицей. После того как в таблицу вставили Ticket 29 в Wave 4, тот же текст
назвал бы чужую Wave.

**Дефект 1: Ticket со Status `blocked` попал в Wave.** Модель workflow накладывает статус ветки
worktree на статус checkout-а: `applyBranches`, `src/main/workflow/reader.ts:298-299`. Ветка берёт
верх, если её `statusRaw` отличается от checkout-а и checkout не `done`. Ветка `worfy-daily/15`
(worktree `.claude/worktrees/15`, PR #48) файл Ticket-а не меняла. В ней Status `open` — какой был
на базе ветки. В checkout-е — `blocked — отклонён проверкой…`. Проверка: `epic-status --json --ref
worfy-daily/15` даёт 15 `open`, `epic-status --json` в checkout-е — `blocked`. Модель получила 15
`open`. `readyWave` (`src/shared/workflow/waves.ts:156`) пропускает только Ticket-ы не в `open` —
и взял 15: блокеры 06–09 done. Список Wave для журнала считает тот же `readyWave`:
`src/main/actions/launch.ts:174`, а цикл — `readyNums`, `src/shared/autopilot/cycle.ts:132`. Тот же
`open` видит и Canvas.

**Дефект 2: текст Orchestrator-у называет Wave плана, а не Ticket-ы.** Шаблон «Run wave» по
умолчанию — `/epic-wave волна {wave} эпика {epic}` (`src/shared/projects/action-templates.ts:29`),
такой же сохранён в `settings.json` Project-а CanvasForAI стабильной копии. `{wave}` считает
`readyWaveNumber` (`src/shared/actions/render-template.ts:59-68`): всем Ticket-ам Epic-а ставится
`open` (`:63`), номера Wave-ов считаются заново, берётся меньший номер среди готовых Ticket-ов
(`:67`). Готовы были 11, 15, 23, 25, 27; у 15 номер 6, у остальных 7 — ушло «волна 6». Текст
собирает `runWaveState` (`render-template.ts:109-112`), вызов — `launch.ts:167`. Номер не
привязан к списку, который Autopilot пишет в журнал: он зависит от версии таблицы и от Ticket-ов,
которые в Wave попасть не должны. ADR-0024, пункт 5, оставил номер плана в тексте сознательно —
это решение и меняется.

**Почему `no-progress` без объяснения.** После хода Orchestrator-а готовы те же 11, 15, 23, 25,
27 — правило `sameSet` в `evaluate` (`cycle.ts:141-144`) дало `no-progress`. Событие `run-stopped`
несёт только `reason` (`src/shared/autopilot/journal.ts:138`, запись — `src/main/autopilot/run.ts:606`).

## Что skill `epic-wave` принимает сейчас

`~/.claude/skills/epic-wave/SKILL.md`, только чтение:

- В описании skill-а — только «Прогони волну N эпика X» и возобновление волны. Формы «вот эти
  Ticket-ы» нет.
- Состав волны skill считает сам: Ticket-ы со `state: "open"`, `blockedParsed: true` и всеми
  блокерами `done` (раздел «1. Предполёт»). Это то же правило, что `readyWave`, без пересечения файлов.
- Вести волну не строго по таблице плана можно только с разрешения владельца (раздел «1.
  Предполёт», абзац после таблицы плана). Без него — по таблице.

Поэтому явный список в тексте сам по себе Orchestrator может не принять. Нужна одна фраза в
skill-е — её вписывает владелец: агентам запись в `~/.claude` запрещена.

## Что делаем

**ADR до кода.** Номер выдаёт Orchestrator Wave, заранее не взят. ADR заменяет пункт 5 ADR-0024
(«номер Wave плана остаётся в тексте»); ADR-0024 не правится. Черновик — в «Итог» ниже.

**1. В Wave — только Ticket-ы в `open`.**

- Статус ветки worktree не перекрывает `blocked` и `done` checkout-а. `open` ветки не перекрывает
  ничего: ветка, которая не трогала Ticket, несёт Status своей базы. Ветка перекрывает checkout,
  когда в checkout-е `open` или `none`, а в ветке `work`, `blocked` или `done` — так Ticket,
  взятый в worktree, остаётся `work`, как сейчас. Место — `applyBranches`, `reader.ts:298-299`.
  Если исполнитель найдёт правило проще с тем же итогом, он пишет его в «Итог».
- `readyWave` отдаёт третий список: Ticket-ы, у которых все блокеры done, а state `blocked` или
  `none`. Autopilot пишет их в `wave-started` полем `skipped`: номер и state каждого.
- Готовых Ticket-ов в `open` нет, а в этом третьем списке кто-то есть — прогон останавливается с
  новой причиной `blocked-tickets`. `run-stopped` несёт `tickets`: номера этих Ticket-ов. Так и на
  старте прогона, и после Wave. Если и третий список пуст — `no-ready-wave`, как сейчас.

**2. Текст Orchestrator-у называет Ticket-ы Wave.**

- Новый placeholder `{tickets}`: номера Ticket-ов Wave через запятую, двузначные — `11, 23, 25, 27`.
- Шаблон «Run wave» по умолчанию — `/epic-wave Ticket-ы {tickets} эпика {epic}`.
- Сохранённый шаблон, равный старому default (`/epic-wave волна {wave} эпика {epic}`), при чтении
  настроек Project-а становится новым default. Свой шаблон владельца не трогается.
- Autopilot не стартует с шаблоном без `{tickets}`. Причина — на кнопке Autopilot, как сейчас
  «No ready wave»: «The Run wave template does not name the Wave's tickets: add {tickets}».
  Кнопка «Run wave» с таким шаблоном работает: её жмёт человек.
- Текст и список `tickets` в `wave-started` — из одного чтения модели. Сейчас их два: текст из
  `runWaveState`, список из `readyWave` (`launch.ts:167` и `:174`).
- `{wave}` остаётся для своих шаблонов владельца с прежним смыслом — номер Wave плана.
- Binding: правило `/epic-wave` берёт Epic по последнему слову-Epic-у
  (`src/shared/binding/resolve.ts:143`), новый текст его не ломает. Проверить test-ом.

Почему список, а не номер:

- Номер Wave плана зависит от версии таблицы spec.md и от Ticket-ов, которых в Wave быть не должно
  (оба прогона 2026-10-06).
- Номер Wave прогона (1, 2, 3) skill-у ничего не говорит: skill читает таблицу плана.
- Посчитать номер «как в таблице» worfy не может: формат Ticket-ов читает только `epic-status`
  (`reader.ts:3`), таблицу spec.md он не разбирает.

Список — ровно то, что Autopilot записал в журнал. Его можно сверить с ответом Orchestrator-а.

**3. Журнал объясняет остановку.**

- `wave-started` получает `text` — текст, который ушёл Orchestrator-у, — и `skipped` (пункт 1).
- `run-stopped` с `no-progress`, `no-ready-wave` и `blocked-tickets` получает `lastText`: первые
  1000 символов последнего текста Orchestrator-а в ходах Wave. Если ходов не было (остановка на
  старте) — поля нет.
- Измеримо: по одному журналу видно, что ушло Orchestrator-у, что он ответил и каких Ticket-ов не
  было в Wave. Транскрипт для этого больше не нужен.

## Готово, когда

- [x] ADR (номер от Orchestrator-а) принят до кода и заменяет пункт 5 ADR-0024. ADR-0024 не правится.
- [x] Ticket со Status `blocked` в checkout-е не попадает в Wave, когда ветка его worktree говорит `open`, — случай Ticket-а 15 2026-10-06. Ticket, взятый в ветке (`work` в ветке, `open` в checkout-е), остаётся `work`.
- [x] Wave Autopilot и «Run wave» — только Ticket-ы в `open`. `wave-started` пишет `skipped` с номером и state каждого пропущенного.
- [x] Готовых `open` нет, а Ticket-ы с закрытыми блокерами не в `open` есть: `run-stopped` с причиной `blocked-tickets` и полем `tickets`. На старте прогона — то же, без `wave-started`.
- [x] Текст Orchestrator-у называет Ticket-ы Wave (`/epic-wave Ticket-ы 11, 23, 25, 27 эпика worfy-daily`). Список в тексте совпадает с `tickets` в `wave-started`.
- [x] Сохранённый старый default шаблона «Run wave» при чтении настроек становится новым. Свой шаблон без `{tickets}` Autopilot не запускает, причина видна на кнопке.
- [x] `run-stopped` с `no-progress`, `no-ready-wave` и `blocked-tickets` несёт `lastText`. Прогон на fake-агенте повторяет прогон 2026-10-06 15:24Z: Orchestrator ничего не запускает, и по журналу видно, что ушло, что он ответил и что 15 пропущен.
- [x] (владелец) В `~/.claude/skills/epic-wave/SKILL.md` есть явный список Ticket-ов как аргумент: «`/epic-wave Ticket-ы NN, NN эпика X` — волна из этих Ticket-ов. Строку таблицы плана не искать. Список посчитан по тем же правилам, разрешение владельца на волну не по таблице дано шаблоном Project-а».
- [ ] (вручную) Прогон Autopilot на стабильной копии, обновлённой после влития Ticket-а: Wave 8 плана (11, 23, 25, 27) уходит текстом со списком. Пока Ticket 15 `blocked`, он в `skipped`. Как проверить: журнал прогона.

Ручные пункты агент не проверяет: первый — запись в `~/.claude`, второй требует стабильной копии и
настоящего Claude Code. Не сделанный пункт — «не проверено: …» в «Итог» и пункт в HANDOFF, раздел
«Ждёт владельца».

## Тесты

Сначала падающие test-ы: контрактный test reader-а и прогон на fake-агенте. На нынешнем main
reader отдаёт 15 `open`, а прогон пишет в `wave-started` Ticket 15 и шлёт `волна N` вместо списка.

- `test/contract/workflow-reader.test.ts`: checkout `blocked`, ветка worktree `open` → `blocked`;
  checkout `open`, ветка `work` → `work` (как сейчас); checkout `done` → `done` (как сейчас).
- `test/unit/waves.test.ts`: третий список `readyWave` — `blocked` и `none` с закрытыми
  блокерами; `work` и `done` в нём нет.
- `test/unit/autopilot-cycle.test.ts`: `blocked-tickets` после Wave и на старте; `no-ready-wave`,
  когда третий список пуст.
- `test/unit/action-templates.test.ts`, `test/unit/render-template.test.ts`: `{tickets}`, новый
  default, `{wave}` для своих шаблонов.
- `test/unit/launch.test.ts`: текст и список — из одного чтения; шаблон без `{tickets}` —
  отказ Autopilot с причиной.
- `test/contract/projects.test.ts`: старый default в `settings.json` читается как новый; свой
  шаблон не меняется.
- `test/unit/binding.test.ts`: Session с текстом `/epic-wave Ticket-ы 11, 23 эпика worfy-mvp`
  привязана к Epic-у.
- `test/fixtures/agent-scripts/autopilot-blocked.jsonl` (новый) и
  `test/contract/autopilot.test.ts`: временный Project повторяет прогон 2026-10-06. Ticket 15
  `blocked` в checkout-е и `open` в ветке worktree. Fake-Orchestrator отвечает текстом и ничего не
  запускает. Журнал: `wave-started` без 15, со `skipped`, с `text`, где список; `run-stopped` —
  `no-progress` с `lastText`. Второй случай — открытых готовых нет, есть `blocked`:
  `blocked-tickets`.

e2e не нужен. В UI прибавляется строка `{tickets}` в списке placeholder-ов окна настроек
Project-а — её строит тот же код из `PLACEHOLDERS`. Причина на кнопке Autopilot — существующий
механизм. `test/e2e/projects.spec.ts` должен остаться зелёным.

## Где в коде

- `docs/adr/<номер>-autopilot-names-wave-tickets.md` (новый, номер от Orchestrator-а)
- `src/main/workflow/reader.ts`
- `src/shared/workflow/waves.ts`
- `src/shared/autopilot/cycle.ts`
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/projects/action-templates.ts`
- `src/shared/actions/render-template.ts`
- `src/main/projects/settings.ts`
- `src/main/actions/launch.ts`
- `test/fixtures/agent-scripts/autopilot-blocked.jsonl` (новый)
- `test/contract/workflow-reader.test.ts`
- `test/contract/autopilot.test.ts`
- `test/contract/projects.test.ts`
- `test/unit/waves.test.ts`
- `test/unit/autopilot-cycle.test.ts`
- `test/unit/action-templates.test.ts`
- `test/unit/render-template.test.ts`
- `test/unit/launch.test.ts`
- `test/unit/binding.test.ts`

Общие файлы с не сделанными Ticket-ами. Этот Ticket идёт раньше обоих:

- `src/main/actions/launch.ts`: 30 → 28 (28 ждёт 23, 23 ждёт 30).
- `test/contract/workflow-reader.test.ts`: 30 → 20 (20 ждёт 17, 17 — 11, 11 — 30).

## Итог

Решение — [ADR-0033](../../../docs/adr/0033-autopilot-names-wave-tickets.md) (черновик, который
здесь лежал, стал этим ADR). Он заменяет пункт 5 ADR-0024; ADR-0024 не правился.

**Корень дефекта 1 решён правилом модели, а не фильтром Autopilot.** `applyBranches`
(`src/main/workflow/reader.ts`, `branchOverrides`): Status ветки worktree перекрывает checkout,
только когда в checkout-е не `blocked` и не `done`, а в ветке не `open` и не `none`. Правило шире,
чем в «Что делаем» (там — «только при `open` или `none` в checkout-е»): Ticket, чей claim уже влит
в main (`work` в checkout-е), а ветка говорит `blocked` или `done`, по-прежнему показывается по
ветке, как до Ticket-а. Во всех случаях «Готово, когда» итог тот же. Цена: Ticket, вернувшийся в
доработку (`blocked` в checkout-е, `claimed` в ветке), Canvas показывает `blocked`, пока claim не
влит в main.

**Неочевидные решения.**

- `{tickets}` сортирует номера и пишет их двузначными через `, `. Пустой список — у `{tickets}`
  нет значения (render не проходит), а не пустая строка.
- Старый default переписывается только при чтении (`migrateProjectSettings` в
  `readProjectSettings`); файл `settings.json` не пишется. Новый текст ляжет в файл при следующем
  сохранении настроек. Сборка старше Ticket-а отложит такой файл как нечитаемый (`{tickets}` ей
  неизвестен) — поэтому стабильную копию обновляют вместе с влитием.
- Отказ Autopilot по шаблону — в двух местах: на кнопке (`useRunWaveState(…, true)` в
  `src/renderer/canvas/actions/gates.ts`) и в main до старта прогона
  (`ActionLauncher.autopilotRefusal`, вызов в `Autopilot.start`). Main отказывает и при пустом
  шаблоне «Run wave» — раньше такой прогон стартовал и сразу вставал с `send-failed`.
- `lastText` — `result.text` последнего хода Wave (ход Wave или поздний, как считает
  `endsWave`), обрезанный до 1000 UTF-16 единиц без половины суррогатной пары (`clipLastText`):
  формат журнала проверяет длину в тех же единицах. Новый Wave обнуляет `lastText`.
- Новые поля журнала (`text`, `skipped` у `wave-started`; `tickets`, `lastText` у `run-stopped`)
  в схеме необязательные: строки журналов, записанных до Ticket-а, читаются, как раньше. Пишет их
  worfy всегда, когда есть что писать.

**Файлы вне следа** (без них пункт не закрывался):

- `src/renderer/canvas/actions/gates.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx` —
  причина «The Run wave template does not name the Wave's tickets: add {tickets}» на кнопке
  Autopilot.
- `src/main/ipc/autopilot.ts` — проводка `autopilotRefusal` в Autopilot.
- `test/e2e/projects.spec.ts`, `test/e2e/ship-ticket.spec.ts`, `test/e2e/autopilot.spec.ts` —
  ожидали старый default и текст «волна N»; `test/contract/autopilot-limits.test.ts`,
  `test/unit/autopilot-run.test.ts`, `test/unit/canvas-actions.test.tsx`,
  `test/unit/autopilot-journal.test.ts` — то же и test-ы новых полей журнала и кнопки.

**Не проверено.**

- не проверено: прогон Autopilot на стабильной копии после влития (Wave 8 плана текстом со
  списком, Ticket 15 в `skipped`) — нужен настоящий Claude Code и стабильная копия, агенту запрещено
  запускать настоящий Autopilot; пункт остаётся за владельцем.
- Пункт владельца про skill `epic-wave` проверен только чтением: в
  `~/.claude/skills/epic-wave/SKILL.md` есть форма «Ticket-ы NN, NN эпика X» (commit 364070b).
