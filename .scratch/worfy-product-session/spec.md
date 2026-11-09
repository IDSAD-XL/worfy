# worfy-product-session: Product Session и Mind map — советник Product owner-а

Status: принят владельцем 2026-11-07 («тогда да, верно») вместе с разделом roadmap «worfy для соло-разработки
продукта»: Q1–Q10 — по рекомендации; Q5 владелец уточнил (сохранение `docs/product/` — docs PR Orchestrator-а по
«сохранить» или по концу разговора, Product Session git не трогает).
Source: карта [worfy-product](../worfy-product/map.md), решения 01–09 владельца 2026-11-07 (Ticket
[11](../worfy-product/issues/11-spec-первого-epic-а-product-session.md) карты — этот spec); раздел roadmap
[«worfy для соло-разработки продукта»](../../docs/roadmap.md#worfy-для-соло-разработки-продукта); research
[«Product Session и Mind map: на чём строить»](../../docs/research/2026-11-07-product-session-основа.md) (факты кода,
оценка 14–17 Ticket-ов), [оценка идей PR #1580](../../docs/research/2026-11-07-оценка-идей-pr-1580.md), раздел 8,
[оценка идей PR #1314](../../docs/research/2026-11-07-оценка-идей-pr-1314.md); прототип — Card «Прототип: Product
Session + Mind map» (`card-2dffdc46`) на Canvas Project-а worfy; Epic [worfy-skills](../worfy-skills/spec.md) (skills
Matt Pocock в plugin-е worfy — основа процесса); [CONTEXT.md](../../CONTEXT.md), термины Product owner, Product Session,
Mind map, Session, Orchestrator, Eco mode, Vendor; ADR [0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[0005](../../docs/adr/0005-worfy-own-state-inventory.md), [0021](../../docs/adr/0021-mcp-servers-allowlist-in-profile.md),
[0056](../../docs/adr/0056-windows-checks-and-two-sessions.md), [0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md),
[0094](../../docs/adr/0094-vendor-seam.md), [0100](../../docs/adr/0100-run-epic-queue.md); [TICKETS.md](../../harness/bin/TICKETS.md).
Ticket-ы: Epic `worfy-product-session`, 18 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` /
`Source:`, как у worfy-skills.

**Wave-ы Harness (10–14) ждут Epic `worfy-skills` целиком.** Их Status — `blocked` с причиной «ждёт Epic worfy-skills»
(`bin/ticket block`): `Blocked by` держит только номера этого Epic-а. Когда `worfy-skills` закрыт, Orchestrator
открывает их (`bin/ticket open`). Остальные Wave-ы стартуют сразу.

## Цель

Product owner — человек, который один ведёт продукт целиком (CONTEXT.md). Его идеи — ресурс ограниченный и часто
ошибочный (слова владельца 2026-11-07). Сегодня у него в worfy есть только Session-ы разработки: Orchestrator и Session
Node-ы. Они берут Ticket-ы, правят код и запускают Autopilot. Советника, который сам предлагает и спорит с планом,
нет (оценка PR #1580, раздел 8.1).

Epic даёт **Product Session** — отдельный вид Session-советника — и **Mind map** — живую схему её разговора:

- Product Session ведёт продуктовую тему по процессу wayfinder + grilling + research + prototype + to-spec (skills,
  скопированные в plugin worfy Epic-ом `worfy-skills`) плюс наши слои: агент-критик, генерация идей, Mind map, доля
  принятых советов.
- Она код не меняет, Autopilot не запускает, Ticket-ы не берёт. Пишет только `docs/product/` и черновики Epic-ов с
  пометкой «черновик советника».
- Перед приёмкой spec нового Epic-а Orchestrator по правилу Harness зовёт критика. Его разбор лежит отдельным файлом в
  `docs/product/`, spec на него ссылается, владелец может принять spec вопреки критику.
- Экран: Mind map 60 / чат 40 с разделителем, панель агентов свёрнута в полосу иконок.

Решает всегда человек: Epic-и и их порядок принимает Product owner, worfy сам Epic-и не выбирает и в очередь Run-а не
ставит (ADR-0100).

## Решения владельца 2026-11-07 (карта worfy-product, не пересматриваются)

1. **Отдельный вид Session, четыре границы** (решение 04):
   - свои правила продуктового мышления — без Ticket-ов, gate и merge;
   - код не меняет, Autopilot не запускает, Ticket-ы не берёт; пишет только `docs/product/` и черновики Epic-ов с
     пометкой «черновик советника»;
   - свой вход «New Product Session» — в sidebar и в Command palette;
   - своя папка `docs/product/<тема>/`.
2. **Чтение и запись.** Product Session читает всё о разработке: roadmap, spec-и, Ticket-ы, PR, падения CI. Обычные
   Session-ы и Orchestrator читают `docs/product/`, но не пишут туда (решение 04, Q4).
3. **Основа процесса** — wayfinder + grilling + research + prototype + to-spec из plugin-а worfy, плюс критик, генерация
   идей, Mind map и доля принятых советов (решение 09, Q1).
4. **Папка темы** `docs/product/<тема>/` — карта wayfinder (`map.md` и `issues/`) плюс файл Mind map с более мелкими
   узлами и их положением. Ticket-ы карты — крупные узлы Mind map. Формат, который worfy описывает сам, worfy сам
   читает и проверяет (решение 09, Q2, Q3).
5. **Mind map** (решения 05, 06):
   - четыре вида узлов: Идея, Вопрос, Решение (принято или отклонено, всегда с причиной), Возражение (со ссылкой на
     факт);
   - связь между узлами значит «из чего выросло»;
   - агент меняет Mind map только своими MCP tools `mind_map_*` по образцу `worfy-canvas`; tool проверяет формат;
   - экран перерисовывается сразу;
   - хранится файлом в Project-е, без базы данных.
6. **Экран** (решения 05 Q4, 06):
   - Mind map 60 / чат 40, разделитель тянется, положение запоминается, по умолчанию 60 / 40; переключателя 50/50 нет;
   - панель агентов свёрнута в полосу иконок; привязанного Epic-а нет;
   - вид «дерево» по умолчанию, текст в нём крупнее; второй вид — «граф»;
   - отклонённые решения остаются зачёркнутыми; переключатель «скрыть отклонённые»;
   - чипы узлов под сообщениями чата: click выделяет узел, наведение подсвечивает;
   - руками владелец только двигает узлы и сворачивает ветки; смысл узла меняет только агент, по просьбе владельца;
   - zoom и pan.
7. **Критик** (решение 08, Q1): перед приёмкой spec Orchestrator запускает критика по правилу Harness. Вердикт — Keep,
   Reorder, Split или Defer; до 3 возражений, у каждого ссылка на факт; одна альтернатива. Разбор — отдельный файл в
   `docs/product/`, spec ссылается на него, владелец всегда может принять вопреки.
8. **Идеи** (решение 08, Q2): по просьбе 3–5 идей; у каждой — для кого, почему сейчас, цена в Ticket-ах, как
   проверить. Хотя бы одна идёт против roadmap.
9. **Польза** (решение 08, Q3): каждый совет — узел Mind map; принятый или отклонённый, он становится Решением с
   причиной. Доля принятых — в шапке Product Session, накапливается по Project-у.
10. **Модель** (решение 08, Q4, Q5): Product Session и критик всегда на сильнейшей модели, Eco mode на них не действует.
    Только Claude; Codex — позже отдельным Ticket-ом.
11. **Против лёгкого согласия** (решение 03, Q5): отдельный агент ищет возражения; за каждым возражением — факт; доля
    принятых советов — мерка.
12. **Pilot** (решение 03, Q4): сначала на roadmap самого worfy, потом на проекте project-a.

## Решения владельца 2026-11-08: экран как в прототипе

Владелец посмотрел готовый экран в Mac Stable: «Мне больше понравилась версия из прототипа. В продакт сессии не нужны
все эти вызовы команд, логи и т.д.». Чат Product Session собран из Transcript обычной Session и показывает все её строки;
прототип (Card `card-2dffdc46`) показывает только разговор. Владелец ответил «все да» на Q1–Q6:

- **Q1.** В чате остаются: сообщения владельца, ответы советника, чипы узлов под ними, запросы разрешений, вопросы
  советника с вариантами, строка упавшего хода. Убираются совсем: вызовы tools и их вывод, Thinking, строки hook-ов,
  notice Claude Code, строки Subagent-ов, «Turn finished», строки slash-команд; ошибка отдельного вызова tool тоже не
  показывается — только упавший ход.
- **Q2.** Переключателя «показать детали» нет. Пока советник работает, в чате индикатор «советник думает…»; полный
  журнал — во Flight Recorder.
- **Q3.** Шапка: «Product Session», тема, значок Vendor-а, состояние, «Advice accepted N of M». Model, Effort,
  Permissions, Cost и Hide tools убираются.
- **Q4.** Поле ввода: текст, «Отправить» / «Прервать», прикрепление картинки. Context meter, очередь, подсказка и
  pickers убираются.
- **Q5.** Сообщения как в прототипе: пузыри «Вы» справа и «Советник» слева, время, заголовок «Разговор с советником»;
  наведение на сообщение подсвечивает его узлы на Mind map.
- **Q6.** Полоса агентов раскрывается списком по именам и состоянию («Критик — работает · 3 возражения», «Генератор
  идей — готово») вместо блоков обычной Session. Отдельный Ticket 20 после 19.
- **Позже в тот же вечер:** «Сам канвас с нодами и связями тоже должны выглядеть как на прототипе» — Ticket 21: вид
  Mind map (узлы, связи, легенда, фон) по прототипу, поведение не меняется.

## Решения владельца 2026-11-08 (PR #1666)

Владелец ответил «да» на все вопросы research
[«Product Session: качество решений»](../../docs/research/2026-11-08-product-session-decision-quality.md) (PR #1666).

- **Q1.** Ticket 11 (агент-критик, PR #1654) вливается как есть.
- **Q2.** Pilot 15: перед Решением — 2–5 предположений со статусом, у Решения — отклонённые альтернативы и «Revisit
  when»; свободный текст в `map.md` темы, схема Mind map не меняется.
- **Q3.** Pilot 17: польза критика против baseline (тот же план без критика), число ложных возражений и расход
  токенов; доля принятых — не мерка качества.
- **Q4.** Новый Ticket 18: критик без вердикта автора, `Fact:` отдельно от `Judgement:`, три новых случая eval
  `critic-verdict`.
- **Q5.** Hypothesis Validation и Product Memory отложены до итогов pilot-ов 15 и 17 («Не в этом Epic-е»).
- **Q6.** PR #1666 вливается как research note, без изменения принятых решений spec-а.

## Решения владельца 2026-11-09: остатки сравнения с прототипом

Финальное сравнение готового экрана с прототипом (`main` `169f01ae8`, снимки
`~/Stuff/owner-check-2026-11-09/ps-vs-prototype-final/`) оставило четыре вопроса владельцу. Ответы утром 2026-11-09:

- **Q1 — да.** Вид «Graph» на Mind map становится радиальным, как в прототипе: корень (тема) в центре, ветки вокруг
  него, прямые стрелки «выросло из»; красная пунктирная стрелка `replaces` остаётся. «Tree» не меняется. Ticket 26.
- **Q2 — да.** Ещё три кнопки rail, как в прототипе. Ticket 27.
- **Q3 — да, но без переключателя 50/50 · 60/40.** Session picker и «Interrupt» в шапке остаются; доля принятых
  советов показывается, только когда советы уже есть. Ticket 27.
- **Q4 — оставить.** «Hide rejected» и кнопки сворачивания на узлах остаются как сейчас.

## Что видит владелец

Прототип — Card «Прототип: Product Session + Mind map» (`card-2dffdc46`), принят владельцем 2026-11-07 («Получилось
просто ебейше»). Экран строится таким, каким он показан, с поправками решения 06. Что в прототипе есть:

- **Шапка.** Метка «Product Session», название темы. В прототипе там же кнопки проигрывания разговора и переключатель
  «Раскладка 50 / 50 · 60 / 40» — в продукте их нет (переключатель снят решением 06, проигрывание — только демо).
  В продукте в шапке — доля принятых советов (Ticket 14).
- **Слева — Mind map (60 %).** SVG-холст с узлами и стрелками «из чего выросло». Корень — тема. Цвет и значок по виду:
  Идея ✦, Вопрос ?, Возражение !, Решение ✓ принято / ✕ отклонено (зачёркнуто, серое). Сверху — переключатель «Вид:
  дерево · граф», кнопки zoom «−», «+», процент и «Вписать». Колесо мыши — zoom, перетаскивание фона — pan. Легенда
  сворачивается.
- **Карточка узла** по click: вид и статус, текст, «Причина» у Решения, «Источник» у Возражения, «История» (как Решение
  менялось: «шаг 5: принято — …», «шаг 7: отклонено — …»), «Выросло из» со ссылкой на узел-родитель, «Сообщение» —
  ссылка на сообщение чата, где узел появился, «Изменило» — сообщения, которые его меняли.
- **Связь «заменило».** Позднее Решение, которое отменило раннее, рисуется отдельной стрелкой поверх дерева (в
  прототипе — «Сначала Harness, в интерфейсе минимум» отменено «Mind map 60 / чат 40»).
- **Разделитель.** Тянется мышью; двойной click — назад к 60 / 40.
- **Справа от Mind map — чат (40 %).** Заголовок «Разговор с советником», значок Vendor-а. Под каждым сообщением —
  чипы узлов, которые это сообщение создало или изменило; наведение на сообщение подсвечивает его узлы.
- **Панель агентов** — полоса иконок у правого края с числом агентов; по click раскрывается список: «Критик —
  работает · 3 возражения», «Генератор идей — готово». Привязанного Epic-а нет.

## Как работает

### Вид Session (Ticket-ы 01, 02, 06)

- Сегодня вида Session нет: у Session Node-а в данных только `origin`, `vendor`, `sessionId`
  (`src/shared/ipc/sessions.ts:24-33`), Orchestrator отличается флагом `SessionLaunch.orchestrator`
  (`src/main/agent/session-settings.ts:31-39`), который выбирает только окно autocompact
  (`src/main/vendors/claude/query.ts:166`).
- Новое необязательное поле `kind: 'product'` в данных Session Node-а и в виде Session; вход `sessions.new` получает
  `kind` (`src/shared/ipc/sessions.ts:96`). Node без поля — обычная Session, как раньше. Node остаётся видом
  `session` на Canvas: новый вид Node-а потребовал бы поддержки в main (research, раздел 1.5).
- Vendor Product Session — только Claude Code. `sessions.new` с `kind: 'product'` и Vendor-ом `codex` — отказ с
  текстом; вход «New Product Session» Vendor не предлагает.
- Модель — сильнейшая, Eco mode не действует (Q10). Eco mode меняет только роли Subagent-ов из `agents` Profile-а
  (`src/shared/agent/plan-preset.ts:22-24`) и Modes есть только у Orchestrator-а
  (`src/renderer/session/composer/Modes.tsx:10`); Product Session — не Orchestrator, Modes у неё нет.

### Ограничения (Ticket 02)

Решение 04 держится тремя слоями, только для Claude Code:

1. **PreToolUse hook worfy отвечает deny.** Сегодня он только наблюдает и всегда отвечает `{}`
   (`src/main/vendors/claude/options.ts:325-335`). В Product Session он отказывает:
   - `Edit`, `MultiEdit`, `Write`, `NotebookEdit` — путь вне `docs/product/` Project-а (после `realpath`, с учётом регистра и `\`
     на Windows, ссылок и `..`);
   - `Bash` — известные команды, которые пишут в репозиторий или в Ticket-ы: `bin/ticket`, `git commit`, `git push`,
     `git merge`, `gh pr create|merge`, `pnpm`, `npm` (Q3). Это не sandbox: правила Session называют запрет словами,
     guard ловит известное (research, раздел 2.4: «Ticket CLI через Bash надёжно не закрыть»).
   Ответ deny несёт причину, которую агент читает.
2. **Без `autopilot_start`.** Tool отказывает, если у контекста нет `autopilotStart` (`src/main/mcp/canvas-server.ts:295`);
   сервер Session строится в `sessionCanvas` (`:508-521`). Для Product Session он строится без него.
3. **Правила Session** (Ticket 10) называют границы словами.

Session без человека Product Session не бывает: Autopilot её не запускает, `bypassPermissions` у неё — только по
выбору пользователя, и deny hook-а действует в любом режиме.

### Папка темы и файл Mind map (Ticket 03)

```text
docs/product/
  <тема>/
    map.md            карта wayfinder: Destination, Notes, Decisions so far, Not yet specified
    issues/NN-slug.md Ticket-ы карты (Type/Status/Blocked by/Source, TICKETS.md «Wayfinding operations»)
    mind-map.json     мелкие узлы, связи, положения, свёрнутые ветки (Q1)
    drafts/<epic>.md  черновики Epic-ов с пометкой «черновик советника» (Q4)
  critic/<epic>-<YYYY-MM-DD>.md   разборы критика (Q8)
```

- Схема `mind-map.json` — zod в `src/shared/product/` (рекомендация Q1):
  - `version: 1`, `nodes: [...]`;
  - узел: `id`, `kind` (`idea` | `question` | `decision` | `objection`), `text`, `from` (id узла-родителя,
    `ticket:NN` — Ticket карты, или `null` — от темы);
  - у `decision` обязательны `status` (`accepted` | `rejected`) и `reason`; у `objection` — `source` (факт: путь
    документа, Ticket, PR, URL);
  - `advice: true` — узел предложил советник сам (идея, своё возражение), считается в доле принятых по
    `mind_map_decide` (Q9); возражение из разбора критика на Mind map — `advice: false`, `source` — файл разбора, в
    доле оно считается один раз, по строке `Owner decision:` разбора (п. 10 «Решено без владельца»);
  - `replaces` — id Решения, которое это Решение отменило (стрелка «заменило»);
  - `history` — прежние `status` и `reason` Решения;
  - `message` — id сообщения чата (uuid события транскрипта), где узел появился или менялся;
  - `x`, `y`, `collapsed` — пишет только экран (руками владельца).
- Ticket-ы карты (`issues/NN-*.md`) — крупные узлы: worfy читает их заголовок и `Status:` по правилам TICKETS.md (H1 —
  `firstHeading`, `src/main/workflow/reader.ts:227`, правило то же, что `harness/lib/code-fence.cjs`), в
  `mind-map.json` они не копируются.
- Проверка формата — одна функция в `src/shared/product/`: её зовёт tool до записи и экран при чтении. Файл, который
  не прошёл проверку (правка руками, чужой агент), экран показывает с ошибкой и номером узла, а не пустым.
- ADR о формате папки и файла (Ticket 03).

### Tools `mind_map_*` (Ticket 04)

По образцу `worfy-canvas`: zod raw shape на tool (`src/shared/canvas/tools.ts:99-118`), повторный разбор и ошибка как
результат `isError` (`src/main/mcp/canvas-server.ts:314-326`), нейтральное описание `McpServer`
(`src/main/vendors/mcp.ts:26-39`), Claude — SDK-сервер в процессе (`src/main/vendors/claude/mcp.ts:22-28`).

Рекомендация Q2 — отдельный сервер `worfy-mind-map`, только у Product Session (так подключён `worfy-browser`:
`withBrowserServer`, `src/main/vendors/claude/query.ts:146`). Операции:

| Tool | Что делает |
|---|---|
| `mind_map_read` | тема или список тем: узлы, Ticket-ы карты, ошибки формата |
| `mind_map_add` | новый узел: вид, текст, `from`; у Решения — статус и причина, у Возражения — источник |
| `mind_map_update` | текст или вид узла; Решение без причины отклоняется |
| `mind_map_decide` | узел становится Решением: `accepted` / `rejected` и причина; прежний статус уходит в `history` |
| `mind_map_remove` | только узел без детей и не Решение — ошибка агента, а не отказ от идеи |
| `product_save` | сигнал «сохранить»: Orchestrator-у уходит просьба сохранить `docs/product/` docs PR-ом (раздел «Сохранение») |

Handler проверяет узел схемой, пишет файл атомарно (`writeJsonFile`, `src/main/storage/json-file.ts:79`) и отвечает
JSON-ом. Main — единственный писатель `mind-map.json`: и tool, и перетаскивание узла на экране идут через него.

### Сохранение `docs/product/` (Ticket 04, правило — Ticket 10; Q5, Q6)

- **Product Session git не трогает никогда** — ни `git add`, ни commit, ни PR (решение владельца 2026-11-07, Q5).
- **Повод.** Владелец говорит «сохранить» в Product Session — агент по правилам (Ticket 10) зовёт tool
  `product_save` сервера `worfy-mind-map`. Или разговор заканчивается: Node Product Session закрыт или отправлен в
  архив.
- **Сигнал.** Main проверяет, есть ли незакоммиченные изменения под `docs/product/` (только чтение
  `git status --porcelain -- docs/product`, сам main ничего не коммитит). Есть — ставит в очередь Orchestrator-а
  Project-а сообщение: какие файлы изменились, из какой темы, и просьба сохранить их обычным docs PR-ом. Очередь —
  `MessageQueue` (`src/main/agent/queue.ts`): занятый Orchestrator возьмёт сообщение после своего хода. Изменений
  нет — сигнала нет, `product_save` отвечает «nothing to save».
- **Docs PR** делает Orchestrator, как любой свой docs PR: ветка, commit, PR, зелёный CI, merge. Сообщение сигнала
  само говорит, что делать, поэтому отдельной строки в правилах Orchestrator-а не нужно (их предел — 10000 символов).
- **Silent mode** (Q6): файлы лежат в `<Workflow folder>/product/<тема>/` вне git — PR нет и сохранять нечего;
  `product_save` отвечает «Silent mode: nothing to save», сигнала нет. Черновик Epic-а при приёмке переносится в
  `<Workflow folder>/.scratch/<epic>/spec.md`.

### Живая перерисовка (Ticket 05)

Watcher документов уже держит один рекурсивный `fs.watch` корня Project-а (`src/main/docs/watch.ts:183-184`), но
читает только `HANDOFF.md` и ADR (`isDocument`, `:54-57`) и прочие пути отбрасывает по имени (`:342-352`). Он
расширяется путями `docs/product/**`; событие уходит в renderer новым каналом `product.changed`. Правку файла руками или
другим агентом экран видит так же, как правку через tool. Debounce — как у watcher-а (`:433`, 50 мс).

### Экран (Ticket-ы 07, 08, 09)

- Сегодня тело Session — flex-ряд без разделителя (`src/renderer/session/session.css`, `.w-session__body`), правая
  колонка `SessionRail` — 300px без сворачивания (`session.css:308-310`). `SessionPanel`
  (`src/renderer/session/SessionView.tsx:140`) рисует `w-session__body` на `:320`.
- Product Session получает свою ветку тела: Mind map | разделитель | чат (Transcript и MessageInput — те же) | полоса
  агентов. Header общий; в нём метка «Product Session» и доля принятых.
- Разделитель — свой компонент; логика drag — как в Focus mode (`src/renderer/focus/FocusMode.tsx:462-480`), минимум
  доли — `MIN_SHARE = 0.1` (`src/renderer/focus/split-tree.ts:47`). Доля пишется в app settings
  (`src/shared/settings/app-settings.ts:262`), одна на Machine; двойной click — 60 / 40.
- Отрисовка Mind map — React Flow (`@xyflow/react`) и раскладка ELK (`elkjs`) в Web Worker — обе уже в зависимостях
  (`package.json:35`, `:39`; `src/renderer/canvas/elk/client.ts`).
- Чипы под сообщением выводятся из вызовов `mind_map_*` в этом ходе агента: id узла есть в ответе tool-а. Нового
  хранения не нужно.

### Harness (Ticket-ы 10–14)

- **Правила.** Hook `SessionStart` кладёт правила Orchestrator-а в каждую главную Session без условий
  (`harness/hooks/hooks.json:9`); набор выбирает только аргумент командной строки
  (`harness/hooks/inject-rules.mjs:33`, `:38`). Ticket 10 добавляет `rules/product.md` и выбор по переменной окружения
  `WORFY_SESSION_KIND`, которую worfy кладёт в `env` Session (Ticket 02): у Product Session — `common` + `product`, без
  `orchestrator`.
- **Критик** — Subagent `worfy:critic` (`harness/agents/critic.md`), `model: opus`. Только Claude: список агентов Codex
  `CODEX_AGENT_SOURCES` (`src/main/harness/codex-agents.ts:21`) не меняется.
- **Идеи** — skill `worfy:product-ideas`.
- **Правило Orchestrator-а** — одна строка в `harness/hooks/rules/orchestrator.md`: в нём 9637 символов при пределе
  10000 (`inject-rules.mjs:24`, проверка — `harness/hooks/tests/rules-hooks.test.sh:59`, `:116`), поэтому шаги живут в
  `critic.md`, а не в правилах.
- **Доля принятых** — считается при чтении из файлов `docs/product/` (Q9), нигде не хранится.

## Решено без владельца

1. **Node остаётся видом `session`** с полем `kind`, а не новым видом Node-а: новый вид требует поддержки в main и в
   `nodeSession()` (research, 1.5). На Canvas Product Session отличается меткой.
2. **Доля разделителя — в app settings**, одна на Machine для всех окон, а не в localStorage окна: «положение
   запоминается» значит и после перезапуска, и во втором окне.
3. **Двойной click по разделителю — 60 / 40**, как в прототипе.
4. **Чипы — из вызовов tool-ов**, без нового поля в транскрипте.
5. **Критик — Subagent, идеи — skill.** Критик должен быть отдельным агентом (решение 03, Q5); идеи генерирует сама
   Product Session на сильнейшей модели.
6. **Правило критика в `orchestrator.md` — одна строка**, шаги — в `critic.md`: правила Orchestrator-а почти у предела
   10000 символов.
7. **Тексты plugin-а и кода — английские** (ADR-0074), документы `docs/product/` — на языке `language.team` Profile-а.
8. **Без нового watcher-а** — расширяется watcher документов (research, 3.3): он идёт через `fs.watch`, а не через
   chokidar.
9. **Codex не входит** в Epic (решение 08, Q5): Product Session на Codex — отдельный Ticket позже (в «Не в этом
   Epic-е»).
10. **Возражение критика считается один раз** (Orchestrator, 2026-11-08; ревью PR #1672 Ticket-а 14): по строке
    `Owner decision:` его разбора. Product Session, вынося такое возражение на Mind map, ставит узлу `advice: false`, а в
    `source` — файл разбора; узел с `source` в `critic/` доля не считает, даже с `advice: true`. Совет не из разбора
    критика (идея, своё возражение Session) — `advice: true`, считается по `mind_map_decide`.

## Ticket-ы

- **01 — Вид Session `product`: данные Node-а и `sessions.new`.** Blocked by: —. Не платформенный. Ревью `medium`.
- **02 — Ограничения Product Session у Claude: deny в PreToolUse, без `autopilot_start`, сильнейшая модель.** Blocked
  by: 01. Платформенный (пути Windows в guard). Ревью `high`.
- **03 — Формат папки темы и файла Mind map, ADR.** Blocked by: —. Не платформенный. Ревью `medium`.
- **04 — MCP server `worfy-mind-map`: tools `mind_map_*` и сигнал сохранения Orchestrator-у.** Blocked by: 02, 03. Платформенный (атомарная запись файла
  Project-а на Windows). Ревью `high`.
- **05 — Watcher `docs/product/` и канал `product.changed`.** Blocked by: 03. Платформенный (`fs.watch` на Windows).
  Ревью `medium`.
- **06 — Входы «New Product Session»: sidebar и Command palette.** Blocked by: 01. Не платформенный. Ревью `low`.
- **07 — Экран Product Session: разделитель 60 / 40, полоса агентов, без Binding.** Blocked by: 01. Не платформенный.
  Ревью `medium`.
- **08 — Отрисовка Mind map: «дерево» и «граф», отклонённые, zoom и pan.** Blocked by: 03, 05, 07. Не платформенный.
  Ревью `medium`.
- **09 — Руками: двигать узлы и сворачивать ветки; чипы узлов под сообщениями.** Blocked by: 04, 08. Не платформенный.
  Ревью `medium`.
- **10 — Правила Product Session и выбор набора правил по виду Session.** Blocked by: 02; ждёт Epic `worfy-skills`.
  Платформенный (hook-и Harness). Ревью `high`.
- **11 — Агент-критик `worfy:critic`.** Blocked by: —; ждёт Epic `worfy-skills`. Не платформенный. Ревью `medium`.
- **12 — Skill генерации идей `worfy:product-ideas`.** Blocked by: 04; ждёт Epic `worfy-skills`. Не платформенный.
  Ревью `medium`.
- **13 — Правило Orchestrator-а: критик перед приёмкой spec.** Blocked by: 11; ждёт Epic `worfy-skills`. Не
  платформенный. Ревью `medium`.
- **14 — Доля принятых советов: подсчёт и шапка.** Blocked by: 07, 10, 11, 12; ждёт Epic `worfy-skills`. Не
  платформенный. Ревью `medium`.
- **15 — Pilot на roadmap worfy.** Blocked by: 09, 13, 14. Не платформенный. Ревью `low`.
- **16 — Страница Feature `docs/features/product-session.md` и `ru/` копия.** Blocked by: 09, 13, 14. Не платформенный.
  Ревью `low` и сверка утверждений страницы с кодом.
- **17 — Pilot на проекте project-a.** Blocked by: 15. Не платформенный. Ревью `low`.
- **18 — Критик: вход без вердикта автора, факты отдельно от суждений.** Blocked by: 11. Не платформенный. Ревью
  `medium`.
- **19 — Чат, шапка и поле ввода Product Session как в прототипе.** Blocked by: 07, 09. Не платформенный. Ревью
  `medium`; снимок экрана и взгляд владельца.
- **20 — Полоса агентов: список по именам и состоянию.** Blocked by: 19. Не платформенный. Ревью `medium`.
- **21 — Mind map выглядит как в прототипе: узлы, связи, легенда.** Blocked by: 08. Не платформенный. Ревью `medium`;
  снимок экрана и взгляд владельца.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде» нет. Таблица —
план; Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave). Ticket с большим
номером при общем файле уходит дальше (`filesOverlap`, `src/shared/workflow/waves.ts`).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/shared/ipc/sessions.ts`, `src/main/ipc/sessions.ts`, `src/main/agent/node-sessions.ts`, `src/main/agent/session-settings.ts`, `src/renderer/session/node-sessions.ts`, `test/contract/node-sessions.test.ts`, `test/contract/sessions-vendor.test.ts` | 1 |
| 03 | `src/shared/product/**`, `src/main/product/topic.ts`, `test/unit/product-mind-map.test.ts`, `test/unit/product-topic.test.ts`, `test/fixtures/product-topic/**`, `docs/adr/NNNN-product-session-folder-and-mind-map.md` | 1 |
| 02 | `src/main/agent/product-guard.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts`, `src/main/mcp/canvas-server.ts`, `src/main/agent/node-sessions.ts`, `src/main/agent/session-settings.ts`, `test/unit/product-guard.test.ts`, `test/unit/agent-options.test.ts`, `test/contract/canvas-tools.test.ts`, `test/contract/node-sessions.test.ts` | 2 |
| 05 | `src/main/docs/watch.ts`, `src/shared/ipc/product.ts`, `src/main/ipc/product.ts`, `src/renderer/product/useMindMap.ts`, `test/contract/docs-watch-root.test.ts`, `test/contract/product-watch.test.ts` | 2 |
| 06 | `src/renderer/palette/commands.ts`, `src/renderer/shell/sidebar/SessionsSection.tsx`, `src/renderer/canvas/nodes/SessionNode.tsx`, `test/unit/palette-commands.test.tsx`, `test/unit/sidebar-section.test.tsx`, `test/e2e/new-product-session.spec.ts` | 2 |
| 07 | `src/renderer/session/SessionView.tsx`, `src/renderer/session/ProductSessionPanel.tsx`, `src/renderer/session/SplitDivider.tsx`, `src/renderer/session/session.css`, `src/renderer/session/composer/Pickers.tsx`, `src/shared/settings/app-settings.ts`, `test/unit/session-view.test.tsx`, `test/unit/product-session-panel.test.tsx`, `test/contract/app-settings.test.ts` | 2 |
| 04 | `src/shared/product/tools.ts`, `src/main/mcp/mind-map-server.ts`, `src/main/product/save-signal.ts`, `src/main/agent/node-sessions.ts`, `test/contract/product-save-signal.test.ts`, `src/main/vendors/claude/options.ts`, `src/main/vendors/claude/query.ts`, `src/main/mcp/agent-instructions-mind-map.md`, `test/contract/mind-map-tools.test.ts` | 3 |
| 08 | `src/renderer/product/MindMap.tsx`, `src/renderer/product/mind-map-layout.ts`, `src/renderer/product/mind-map.css`, `src/renderer/session/ProductSessionPanel.tsx`, `test/unit/mind-map-view.test.tsx`, `test/unit/mind-map-layout.test.ts` | 3 |
| 09 | `src/renderer/product/MindMap.tsx`, `src/renderer/product/NodeChips.tsx`, `src/renderer/session/Transcript.tsx`, `src/shared/ipc/product.ts`, `src/main/ipc/product.ts`, `src/main/mcp/mind-map-server.ts`, `test/unit/mind-map-hand.test.tsx`, `test/unit/node-chips.test.tsx`, `test/e2e/product-session.spec.ts` | 4 |
| 10 | `harness/hooks/rules/product.md`, `harness/hooks/inject-rules.mjs`, `harness/hooks/hooks.json`, `harness/hooks/rules/common.md`, `harness/hooks/tests/rules-hooks.test.sh`, `harness/bin/TICKETS.md`, `test/contract/codex-parity.test.ts`, `test/contract/harness-plugin.test.ts` | H1 |
| 11 | `harness/agents/critic.md`, `src/main/harness/migrate/plan.ts`, `test/contract/harness-migrate.test.ts`, `harness/evals/critic-verdict/**`, `harness/evals/lib/coverage.json` | H1 |
| 12 | `harness/skills/product-ideas/**`, `harness/evals/product-ideas/**`, `harness/evals/lib/coverage.json` | H2 |
| 13 | `harness/hooks/rules/orchestrator.md`, `harness/agents/critic.md` | H2 |
| 14 | `src/shared/product/share.ts`, `src/main/ipc/product.ts`, `src/renderer/session/ProductSessionPanel.tsx`, `harness/hooks/rules/product.md`, `test/unit/product-share.test.ts`, `test/unit/product-session-panel.test.tsx` | H3 |
| 15 | `.scratch/worfy-product-session/evidence/15-*`, `docs/product/roadmap-worfy/**`, `docs/product/critic/**` | 5 |
| 16 | `docs/features/product-session.md`, `docs/features/ru/product-session.md`, `docs/features/README.md`, `docs/features/sessions.md`, `docs/features/ru/sessions.md` | 5 |
| 17 | `.scratch/worfy-product-session/evidence/17-*` | 6 |
| 18 | `harness/agents/critic.md`, `harness/evals/critic-verdict/**`, `test/contract/harness-evals.test.ts` | H3 |

- **Wave 1 — 01, 03.** Стартуют сразу: вид Session и формат файла не зависят ни от чего.
- **Wave 2 — 02, 05, 06, 07.** 02, 06 и 07 ждут поле вида (01), 05 — схему (03). Общих файлов нет.
- **Wave 3 — 04, 08.** 04 подключает сервер там же, где 02 правил настройки Claude (`options.ts`, `query.ts`); 08
  рисует схему 03 по каналу 05 в панели 07.
- **Wave 4 — 09.** Руками и чипы: пишет положения через сервер 04 и правит отрисовку 08.
- **Wave-ы Harness — после закрытия Epic-а `worfy-skills`.** H1 — 10 (нужна переменная вида из 02) и 11. H2 — 12
  (имена tools из 04) и 13 (критик 11; общий файл `critic.md`, поэтому после 11). H3 — 14 (шапка 07, правила 10,
  файл критика 11, идеи 12) и 18 (критик 11; общий с 13 файл `critic.md`, поэтому после 13). 11 и 12 оба правят `harness/evals/lib/coverage.json`, поэтому в разных Wave-ах.
  Если `worfy-skills` закроется раньше, чем дойдут Wave-ы 2–4, 11 может идти вместе с ними: общих файлов нет.
- **Wave 5 — 15, 16.** Pilot на worfy и страница Feature — после экрана (09) и Harness (13, 14).
- **Wave 6 — 17.** Pilot на project-a — после pilot на worfy.

Имена новых файлов — предложение; implementer может назвать иначе, не задевая чужих Ticket-ов своей Wave. Пути
существующих файлов и строки `file:line` сверены с `main` 2026-11-07 (`42372355b`).

## Не в этом Epic-е

- **Product Session на Codex** — отдельный Ticket позже (решение 08, Q5): `developerInstructions`, preset
  `read-only`/`auto`, guard через `guard.mjs` после одобрения hook-ов Harness в Codex (research, 2.3, 2.4), TOML
  критика.
- **Обзор рынка с поиском в сети** — второй Epic направления (решение 03, Q1; раздел roadmap).
- **Советник по расписанию** — позже (решение 03, Q3): сейчас только по просьбе и перед приёмкой spec.
- **Правка смысла узла руками** (решение 06, Q4).
- **Аналитика продукта** — у worfy её нет; советник говорит вслух, что не знает, какой функцией пользуются (оценка PR
  #1580, 8.3).
- **Реестр неоднозначностей черновика spec и сценарии приёмки словами владельца** (#1580/2, #1580/1) — работы советника
  следующих Epic-ов (раздел roadmap).
- **Команда на большом многолетнем проекте** — своя карта позже (решение владельца 2026-11-07).
- **Card как экран Product Session** — Card не читает файлы Project-а (research, раздел 4); Card остаётся прототипом.
- **Hypothesis Validation** — прогноз до решения и наблюдаемый результат после него — и **Product Memory** — lessons
  из проверенных итогов решений, с областью действия и сроком устаревания. Отложены, пока pilot-ы 15 и 17 не покажут
  пользу (решение владельца 2026-11-08, Q5); источник — research
  [«Product Session: качество решений»](../../docs/research/2026-11-08-product-session-decision-quality.md), разделы
  4, 5 (PR #1666).

## Риски

1. **Получает ли hook `SessionStart` окружение Session** — не проверено (research, «Что не проверено»). Ticket 10
   первым шагом проверяет это test-ом на stub-е `claude`. Если нет — правила Product Session идут через
   `systemPrompt.append` из приложения (Ticket 02 оставляет для этого место), а `product.md` прямо говорит, что правила
   Orchestrator-а к этой Session не относятся.
2. **Bash обходит guard.** Deny ловит известные команды, а не любую запись. Граница держится правилами, guard-ом и
   отсутствием `autopilot_start`; полный sandbox — нет (Q3).
3. **Mind map на 100+ узлах** не мерили (карта, «Not yet specified»). Ticket 08 рисует fixture на 150 узлов и пишет
   время раскладки в «Итог»; сворачивание веток (09) — ответ на рост.
4. **Две быстрые записи подряд.** Watcher документов идёт через `fs.watch`, не chokidar, и потери второго изменения за
   50 мс у него не ждём — но это вывод по коду (research, 3.3). Ticket 05 пишет test на две записи подряд.
5. **Критик соглашается.** Мерка — доля принятых советов (Ticket 14) и pilot-ы 15, 17; eval Ticket-а 11 проверяет, что
   на плане с заложенной ошибкой критик её находит; Ticket 18 добавляет случаи дубля, дешёвой альтернативы и
   изменившегося условия, pilot 17 сравнивает с baseline без критика.
6. **Правила Orchestrator-а у предела 10000 символов.** Строка Ticket-а 13 — не длиннее 300 символов; test
   `rules-hooks.test.sh` проверяет предел.
7. **Файлы `docs/product/` в рабочем дереве.** Product Session пишет в checkout Project-а; до сигнала «сохранить» или
   конца разговора (Q5) это незакоммиченные изменения рядом с работой Orchestrator-а. Docs PR берёт только
   `docs/product/`, чужие изменения дерева не трогает.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-product-session/<NN>`, worktree `.claude/worktrees/<NN>`. Конец Ticket-а — `pr-green-ci`: PR, зелёный
  `ci-ok` (Linux, macOS и Windows job-ы), отметка `review`. Глубина ревью — в шапке каждого Ticket-а.
- **Платформенные PR** (02, 04, 05, 10): Windows verdict до merge (ADR-0056).
- **Сначала падающий test**: показать красный на старом поведении, это пишется в «Итог».
- **Без токенов и без чужих учётных записей.** `WORFY_AGENT=fake`, stub `claude`; настоящий Claude Code — только в
  платных eval-ах Ticket-ов 11 и 12 (до 100 USD разрешено заранее; сначала `--dry-run`, cap ниже 100) и в pilot-ах.
  Ни один test не пишет в настоящий `~/.claude`.
- Скрипты Node, не bash (ADR-0055); всё работает на Windows (ADR-0054). Timeout-ы — через `ms()` (`test/time-scale.ts`).
- Интерфейс читает флаги capabilities, не `vendor === 'claude'` (ADR-0094).
- Flaky test — Quarantine со сроком (`test/quarantine.ts`). Low findings не становятся Ticket-ами.
- Репозиторий публичный: в fixture-ах и логах нет путей домашней папки, имён машин, id учётных записей; содержимое
  проекта project-a в репозиторий worfy не попадает.
- Язык: документы — русские, термины — латиницей из `CONTEXT.md`; skills, агенты, код и комментарии — английские
  (ADR-0074).

## Вопросы владельцу

Решения карты эти вопросы не закрывали. Владелец 2026-11-07 («тогда да, верно») принял рекомендацию по каждому; Q5 —
с уточнением владельца.

1. **Q1. Файл Mind map.** (а) `mind-map.json` — JSON по схеме zod; один родитель на узел (`from`) плюс необязательная
   связь `replaces`; положения и свёрнутые ветки — в том же файле. (б) Markdown со списком узлов — читается глазами, но
   положения и проверка формата хуже. **Рекомендую (а).** **Подтверждено владельцем 2026-11-07.**
2. **Q2. Где живут tools.** (а) Отдельный сервер `worfy-mind-map`, только у Product Session, операции `read`, `add`,
   `update`, `decide`, `remove` (раздел «Tools»). (б) Те же tools в `worfy-canvas` — их получит каждая Session.
   **Рекомендую (а):** обычная Session и не увидит, чем менять Mind map. **Подтверждено владельцем 2026-11-07.**
3. **Q3. Bash в Product Session.** (а) Есть, но deny известных команд записи (`bin/ticket`, `git commit|push|merge`,
   `gh pr create|merge`, `pnpm`, `npm`). (б) Bash нет совсем — тогда нет `gh`, `git log` и `epic-status`, советник не
   прочитает PR и падения CI (решение 04, Q4). **Рекомендую (а).** **Подтверждено владельцем 2026-11-07.**
4. **Q4. Где черновики Epic-ов.** (а) `docs/product/<тема>/drafts/<epic>.md` с пометкой «черновик советника»; после
   приёмки Orchestrator переносит его в `.scratch/<epic>/spec.md` и нарезает Ticket-ы. (б) Сразу
   `.scratch/<epic>/spec.md` — тогда guard должен пускать Product Session в папку Ticket-ов. **Рекомендую (а):** одна
   разрешённая папка. **Подтверждено владельцем 2026-11-07.**
5. **Q5. Кто коммитит `docs/product/`.** (а) Product Session не коммитит; файлы уходят docs PR-ом Orchestrator-а, как
   правки Ticket-ов сегодня. (б) Product Session сама делает commit и PR — нужен `git commit` и `gh pr create`, которые
   Q3 закрывает. **Рекомендую (а).** **Подтверждено владельцем 2026-11-07, с уточнением:** Product Session git не
   трогает никогда; Orchestrator коммитит `docs/product/` обычным docs PR-ом (ветка, commit, PR, зелёный CI, merge).
   Повод — владелец говорит «сохранить» в Product Session или разговор заканчивается: Orchestrator получает сигнал и
   открывает docs PR (раздел «Сохранение `docs/product/`», Ticket 04).
6. **Q6. Silent mode.** В Silent mode от workflow в репозитории следа нет (CONTEXT.md). (а) Папка Product Session —
   `<Workflow folder>/product/`, в Full mode — `docs/product/`; путь даёт одна функция. (б) Product Session в Silent
   mode не предлагается. **Рекомендую (а).** **Подтверждено владельцем 2026-11-07:** в Silent mode файлы лежат в
   `<Workflow folder>/product/<тема>/` вне git, PR нет и сохранять нечего; черновик Epic-а при приёмке переносится в
   `<Workflow folder>/.scratch/<epic>/spec.md`.
7. **Q7. Как обычные Session-ы не пишут в `docs/product/`.** (а) Строка в правилах `common.md` плюс отсутствие tools
   `mind_map_*`; без guard-а. (б) Guard для всех Session-ов и Subagent-ов. **Рекомендую (а):** guard для всех задел бы
   docs PR Orchestrator-а (Q5). **Подтверждено владельцем 2026-11-07.**
8. **Q8. Разбор критика.** (а) `docs/product/critic/<epic>-<YYYY-MM-DD>.md`: вердикт, до 3 возражений с фактом, одна
   альтернатива, под каждым возражением — строка `Owner decision:` (`accepted — <причина>` / `rejected — <причина>`,
   пустая — ждёт; метка английская, Ticket 11); spec ссылается
   на файл строкой `Критик:` в шапке. (б) Разбор в папке темы. **Рекомендую (а):** критик идёт и для spec-ов, у которых
   темы нет. **Подтверждено владельцем 2026-11-07.**
9. **Q9. Доля принятых.** (а) Считаются узлы с `advice: true` во всех `mind-map.json` Project-а и возражения всех
   разборов критика, у которых есть решение владельца; без решения — не в счёт. Шапка: «Советы: принято N из M».
   Нигде не хранится — считается при чтении. (б) Только узлы Mind map. **Рекомендую (а).** **Подтверждено владельцем 2026-11-07.**
10. **Q10. Сильнейшая модель.** (а) Product Session стартует на alias `opus` с самым высоким effort модели; выбор
    модели в её строке ввода закрыт с tooltip «Product Session всегда на сильнейшей модели». Критик — `model: opus`.
    (б) Модель выбирает пользователь, по умолчанию `opus`. **Рекомендую (а).** **Подтверждено владельцем 2026-11-07.**

## Готово, когда

- [ ] «New Product Session» в sidebar и Command palette создаёт Session вида `product` на Claude Code (01, 06).
- [ ] Product Session не правит файлы вне `docs/product/`, не зовёт известные команды записи и `autopilot_start`;
      отказ называет причину (02).
- [ ] Формат папки темы и `mind-map.json` описан ADR и проверяется одной функцией (03).
- [ ] Агент меняет Mind map только tools `mind_map_*`, tool отклоняет неверный узел (04).
- [ ] «Сохранить» или конец разговора дают Orchestrator-у сигнал, и он открывает docs PR с `docs/product/`;
      Product Session git не трогает; в Silent mode сигнала нет (04, 10).
- [ ] Правка файла через tool или руками перерисовывает экран без перезагрузки (05).
- [ ] Экран: Mind map 60 / чат 40, разделитель запоминается, полоса агентов, без Binding; «дерево» и «граф»,
      отклонённые зачёркнуты и скрываются, zoom и pan, чипы под сообщениями; руками — только двигать и сворачивать
      (07, 08, 09).
- [ ] Product Session получает правила `product`, а не `orchestrator`; критик пишет разбор в `docs/product/critic/`;
      идеи — 3–5 с полями и хотя бы одной против roadmap (10, 11, 12).
- [ ] Orchestrator зовёт критика перед приёмкой spec; доля принятых — в шапке (13, 14).
- [ ] Критик не получает вердикта автора и отделяет `Fact:` от `Judgement:`; eval `critic-verdict` — пять случаев
      (11, 18).
- [ ] Pilot на roadmap worfy и на project-a прошли, доля принятых записана (15, 17).
- [ ] Страница Feature и её `ru/` копия (16).
