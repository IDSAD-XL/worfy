# 16 — Страница Feature `docs/features/product-session.md` и `ru/` копия

Type: task
Status: open
Blocked by: 09, 13, 14
Source: [spec.md](../spec.md), «Готово, когда»; [docs/features/README.md](../../../docs/features/README.md) (шаблон страницы и «Form of paths»)

Не платформенный Ticket. Глубина ревью — `low` и сверка каждого утверждения страницы с кодом.

## Что происходит

- Страницы Feature — `docs/features/*.md` (английский — основной), перевод — `docs/features/ru/`.
  `node scripts/check-feature-docs.mjs` проверяет, что пути на английских страницах существуют.
- Session-ы описывает `docs/features/sessions.md`; Product Session там нет.

## Что делаем

1. `docs/features/product-session.md` по шаблону README: что это, как открыть («New Product Session»), что она может и
   чего не может, папка `docs/product/<тема>/` и `mind-map.json`, экран (60 / 40, «дерево» и «граф», «скрыть
   отклонённые», чипы, руками — двигать и сворачивать), критик перед приёмкой spec-а, идеи, доля принятых, только
   Claude Code, сильнейшая модель. Пути — к коду Ticket-ов 01–14, без номеров строк.
2. `docs/features/ru/product-session.md` — перевод, термины латиницей.
3. Строка в списке страниц `docs/features/README.md`; абзац со ссылкой в `sessions.md` и `ru/sessions.md`.
4. Снимок экрана — только после проверки пикселей; без путей домашней папки и имён машин.

## Готово, когда

- [ ] Обе страницы есть; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 2c9ddf438a3ca00fed08aa81923a9fb9a3fb9111
- [ ] Каждое утверждение страницы сверено с кодом; список сверки — в «Итог».
  - evidence: commit pass · Add the Feature page Product Session and its Russian copy (worfy-product-session 16) · - - · 2c9ddf438a3ca00fed08aa81923a9fb9a3fb9111
- [ ] `node scripts/check-cyrillic.mjs` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- `scripts/check-feature-docs.mjs` (часть `pnpm lint`).

## Где в коде

- `docs/features/product-session.md` (новый)
- `docs/features/ru/product-session.md` (новый)
- `docs/features/README.md`
- `docs/features/sessions.md`
- `docs/features/ru/sessions.md`

Только читать: код Ticket-ов 01–14, `docs/features/cards.md` (образец страницы).

## Итог

- Страница [docs/features/product-session.md](../../../docs/features/product-session.md) — три раздела по шаблону
  README: Product Session (вход, модель, экран, ограничения, правила, сохранение), Mind map (папка темы, узлы, экран,
  руками, чипы, живая перерисовка, tools), «Critic, ideas and the share of accepted advice» (критик, «Before a spec is
  accepted», skill идей, доля принятых). 338 строк. Перевод — [docs/features/ru/product-session.md](../../../docs/features/ru/product-session.md),
  строка перевода `same-pr`.
- `docs/features/README.md` — строка в таблице страниц; `sessions.md` — ссылка на новую страницу в абзаце о Product
  Session; `ru/sessions.md` — короткий абзац «Product Session» со ссылкой (строку commit перевода не трогал: перевод
  остаётся отстающим).
- Не описано, потому что на `main` этого нет: pilot Ticket-а 15, eval/pilot Ticket-а 17, Product Session на Codex.
- **Отступление от п. 4 «Что делаем».** Снимка экрана нет: шаблон `docs/features/README.md` («There are no screenshots:
  they go out of date and nothing checks them») снимки на страницах запрещает.
- Примеры на странице выдуманы (тема `onboarding-flow`, Ticket `01-pricing.md`); личных строк нет.
- Ревью PR #1684, раунд 1 (REJECTED, один medium): e2e `new-product-session.spec.ts` проверяет только вход из Command
  palette; «never runs git» → «never changes the repository with git»; метка строки «Critic» — на языке `language.docs`;
  критик перед приёмкой spec-а получает ещё roadmap и `epic-status`; тема и вид Mind map запоминаются на Machine
  (localStorage общий для окон), вживую тема следует только в своём окне; e2e Mind map — без сворачивания; строка в
  `ru/README.md`; строки MM3, MM6–MM8, MM28, CR1, CR4 таблицы поправлены.

### Сверка утверждений с кодом

Номера строк — `main` 93ae34333. «PS» — раздел Product Session, «MM» — Mind map, «CR» — раздел критика и доли.

| # | Утверждение страницы | Где в коде |
|---|---|---|
| PS1 | Советует Product owner-у; Epic-и и порядок решает владелец, в очередь не ставит | `harness/hooks/rules/product.md:9-11` |
| PS2 | Вопросы по одному, факты, прототип, черновики; возражение — с фактом | `harness/hooks/rules/product.md:27-36`, `:59-63` |
| PS3 | Аналитики нет — говорит об этом | `harness/hooks/rules/product.md:67-68` |
| PS4 | «New Product Session» — строка sidebar над списком | `src/renderer/shell/sidebar/SessionsSection.tsx:163-172`, `:255` |
| PS5 | Команда Command palette | `src/renderer/palette/commands.ts:188-200` |
| PS6 | Vendor не предлагается; только Claude Code; текст отказа | `src/shared/ipc/sessions.ts:31-33`; `src/main/agent/node-sessions.ts:130-135`, `:217-218` |
| PS7 | Сразу открывается в Session view | `src/renderer/shell/sidebar/SessionsSection.tsx:133`; `src/renderer/palette/commands.ts:199` |
| PS8 | Node — Session Node с меткой «Product Session» | `src/renderer/canvas/nodes/SessionNode.tsx:482-486`; `src/shared/ipc/sessions.ts:22-24` |
| PS9 | На read-only экране вход неактивен | `src/renderer/projects/read-only.ts:26-29`; `SessionsSection.tsx:169`; `commands.ts:192` |
| PS10 | Всегда `opus`, старт с высшим effort | `src/main/agent/session-settings.ts:62-64`, `:75-77` |
| PS11 | Выбор модели неактивен, tooltip; смена модели отклоняется | `src/renderer/session/composer/Pickers.tsx:395-396`; `src/renderer/session/product-session.ts:10`; `session-settings.ts:95` |
| PS12 | Eco mode не доходит; меню Modes только у Orchestrator-а | `session-settings.ts:70-73`; `src/renderer/session/composer/Modes.tsx:277-282` |
| PS13 | Заголовок «Product Session», доля в шапке | `src/renderer/session/SessionView.tsx:219-220`, `:347` |
| PS14 | Тело: Mind map, разделитель, тот же чат, полоса агентов | `src/renderer/session/ProductSessionPanel.tsx:251-279` |
| PS15 | Полоса: число Subagent-ов без скрытых | `ProductSessionPanel.tsx:47-52`, `:222-224` |
| PS16 | 60 / 40, ←/→ шаг 5 %, Home/End, двойной click — 60 / 40, минимум 10 % | `src/shared/settings/app-settings.ts:266-269`; `src/renderer/session/SplitDivider.tsx:16`, `:88-98`; `ProductSessionPanel.tsx:266-275` |
| PS17 | Доля одна на Machine, пишется в app settings по концу жеста | `ProductSessionPanel.tsx:19-21`, `:169-183`; `SplitDivider.tsx:6-7` |
| PS18 | Click по полосе — блоки rail поверх чата; Escape и «›»; без Binding | `ProductSessionPanel.tsx:196-243`, `:247`; `src/renderer/session/product-session.ts:13` |
| PS19 | Hook PreToolUse: файловые tools вне папки; Bash/PowerShell — список команд | `src/main/agent/product-guard.ts:39-52`, `:218`, `:253-255`; `src/main/vendors/claude/options.ts:640` |
| PS20 | `autopilot_start` отклоняется с текстом | `src/main/mcp/canvas-server.ts:132-133`, `:301`, `:538-540` |
| PS21 | Правила называют границы словами | `harness/hooks/rules/product.md:70-80` |
| PS22 | Отказ с причиной; в любом режиме, и в `bypassPermissions` | `options.ts:377-385`; `product-guard.ts:69-72`, `:208` |
| PS23 | Папка: `docs/product/` в Full, `<Workflow folder>/product/` в Silent; не нашлась — любая запись отклоняется | `src/shared/product/paths.ts:40-42`; `product-guard.ts:105`; `src/main/vendors/claude/query.ts:161-166` |
| PS24 | Команда читается как shell (кавычки, `$(…)`, backticks, `bash -c`, `eval`); чтение проходит; не sandbox | `product-guard.ts:15-21`, `:71`, `:224` |
| PS25 | Правила `product` и общие, без `orchestrator` | `harness/hooks/hooks.json:18`, `:27`; `harness/hooks/inject-rules.mjs:35-40` |
| PS26 | Процесс: wayfinder, grilling, research в папку темы, prototype одним HTML/Markdown, to-spec в `drafts/<epic>.md` с `Advisor draft`; переносит Orchestrator | `harness/hooks/rules/product.md:27-36` |
| PS27 | Три повода сигнала: `product_save`, Close, архив (руками и автоматически) | `src/main/product/save-signal.ts:1-4`; `src/main/agent/node-sessions.ts:19-21`, `:328`, `:331-336`; `src/main/mcp/mind-map-server.ts:327` |
| PS28 | Сообщение: файлы, темы, просьба docs PR, не трогать другое; занятый — после хода | `save-signal.ts:95-104`, `:9-10` |
| PS29 | Ответы `product_save` (sent, already, nothing, silent, autopilot) | `save-signal.ts:108-122`, `:150-158` |
| PS30 | `kind: 'product'` в данных Node-а; Node остаётся Session Node | `src/shared/ipc/sessions.ts:22-27`, `:52`; `node-sessions.ts:256` |
| PS31 | Каждый старт читает вид; неизвестный вид — хранится, старт отклоняется | `node-sessions.ts:14-18`, `:139-157`, `:271`, `:288` |
| PS32 | Вид доходит до driver-а: guard, `WORFY_SESSION_KIND`, Mind map server, canvas без запуска Autopilot | `query.ts:46`, `:228-240`, `:276`; `options.ts:371`, `:605`, `:640`, `:669-672` |
| PS33 | Guard при сомнении отказывает | `product-guard.ts:23-24`, `:93-94` |
| PS34 | Запись: написанный и реальный путь, регистр, ссылки, junction-ы; имена Windows | `product-guard.ts:7-14`, `:112-118` |
| PS35 | Одно чтение `git status --porcelain=v2`, без commit; отпечаток по Project-у; по одному сигналу | `save-signal.ts:6-7`, `:58`, `:127-129`, `:157`, `:169-182` |
| MM1 | Папка темы: `map.md`, `issues/`, `mind-map.json`, `drafts/`; `critic/` — не тема | `src/shared/product/paths.ts:7`, `:16-22` |
| MM2 | Имя темы: буквы, цифры, `.`, `_`, `-`, до 80; не `critic`, не имя устройства Windows | `paths.ts:44-60` |
| MM3 | Корень — тема, крупные узлы — Ticket-ы карты | `src/renderer/product/MindMap.tsx:39-41`; `src/renderer/product/mind-map-layout.ts:26`, `:79-86`, `:168-170` |
| MM4 | Четыре вида и знаки; Decision — статус и причина, Objection — источник | `src/shared/product/mind-map.ts:18`, `:173-178`; `MindMap.tsx:483-488` |
| MM5 | Отклонённое — зачёркнуто, серое; «Replaces» — пунктир | `MindMap.tsx:220`; `src/renderer/product/mind-map.css:137-143`, `:193-194`; `MindMap.tsx:504-507` |
| MM6 | Тема не привязана; следует за последней изменённой вживую только в этом окне; последняя запоминается по Node на Machine (localStorage общий для окон: окна без своей partition); пустой текст; ошибка чтения | `ProductSessionPanel.tsx:27-32`, `:54-89` (живое следование — state окна, `:70`; запись — `:78`); `src/main/window.ts:135-146`; `ProductSessionPanel.tsx:254-261` |
| MM7 | Панель: «Tree · Graph», «Hide rejected», «−», процент, «+», «Fit»; колесо, pan; 10–250 % | `MindMap.tsx:84-89`, `:464-476`, `:766-770`, `:802-803`, `:39-43` |
| MM8 | «Tree» по умолчанию, 15 px сверху вниз; «Graph» 12 px слева направо; вид по теме на этой Machine (localStorage) | `MindMap.tsx:66-79`; `src/renderer/product/mind-map-layout.ts:23`, `:245-248` |
| MM9 | «Hide rejected» прячет ветки, пока карта открыта, файл не меняется | `mind-map-layout.ts:73`, `:101-117`; `MindMap.tsx:616` |
| MM10 | Легенда сворачивается | `MindMap.tsx:481-494` |
| MM11 | Карточка: поля, Status и файл Ticket-а, подсказка «To change…» у узла файла | `MindMap.tsx:524-595` |
| MM12 | Tab, Enter/Space, Escape | `MindMap.tsx:182`, `:209-212`, `:754-761` |
| MM13 | Двигать можно только узлы `mind-map.json`; место пишется в файл | `MindMap.tsx:289`, `:650`; `src/main/ipc/product.ts:16-18` |
| MM14 | Метка сворачивания, ←/→, «+N»; пишется в файл; ошибка записи | `MindMap.tsx:152-173`, `:189`, `:690`, `:775-778` |
| MM15 | Чипы под ответом из `mind_map_add/update/decide`, один на узел | `src/renderer/product/node-chips.ts:4-9`; `src/renderer/session/Transcript.tsx:24-27` |
| MM16 | Click по чипу выделяет и показывает; скрытый — включает показ и разворачивает | `src/renderer/product/NodeChips.tsx:32`; `MindMap.tsx:691-712` |
| MM17 | Наведение или фокус подсвечивают; «Show in the chat» прокручивает | `NodeChips.tsx:4-7`, `:33-34`; `MindMap.tsx:639`; `Transcript.tsx:597` |
| MM18 | Перерисовка без перезагрузки при любой правке файлов темы | `src/renderer/product/useMindMap.ts:1-10`; `src/main/docs/watch.ts:190`, `:485` |
| MM19 | Файл с ошибкой: строка ошибок с id узла; корень и Ticket-ы видны, узлы файла — нет | `MindMap.tsx:598-608`; `src/main/product/topic.ts:168-173`; `mind-map.ts:105` |
| MM20 | Linked machine: смотреть можно, двигать и сворачивать нельзя; чип в свёрнутой ветке — заметка | `MindMap.tsx:155`, `:799`, `:704-709` |
| MM21 | Server `worfy-mind-map` только у Product Session | `options.ts:30-31`, `:669`; `query.ts:239-240` |
| MM22 | Tools и их правила (add в существующую тему, update не делает Decision, decide с историей, remove) | `src/shared/product/tools.ts:26-44`; `src/main/mcp/mind-map-server.ts:259`, `:277-281`, `:297-316`, `:321-323` |
| MM23 | Отказ ничего не меняет, ошибка — результат; новая тема — `map.md` через `Write` | `mind-map-server.ts:19`, `:349-353`; `src/main/mcp/agent-instructions-mind-map.md:11-12`, `:25` |
| MM24 | Одна проверка: перечень ошибок; tool до записи, экран при чтении | `mind-map.ts:122-130`, `:148-180`, `:1-5` |
| MM25 | main — единственный писатель; по одному на файл, атомарно; битый не перезаписывает; Windows — секунда, потом на месте | `mind-map-server.ts:7-21`, `:58`, `:72`, `:124`, `:131-132` |
| MM26 | `message` — id сообщения, если известно; чипы из transcript, без нового хранения | `mind-map-server.ts:23-24`, `:232-238`; `node-chips.ts:4-7` |
| MM27 | Слежение за папками тем, 50 мс, `product.changed` | `watch.ts:190`, `:428`, `:485`; `src/shared/ipc/product.ts:46` |
| MM28 | React Flow; ELK в Web Worker (`mrtree`/`layered`), до ответа — синхронная раскладка; `x`, `y` из файла | `mind-map-layout.ts:10-11`, `:184-185`, `:194`; `MindMap.tsx:39-40`, `:782-806` |
| CR1 | Критик: путь плана, без вердикта автора; перед приёмкой spec-а ещё путь roadmap и строки `epic-status`; один файл разбора; ответ одной строкой | `harness/agents/critic.md:3`, `:14-20`, `:146-149`, `:90-99`, `:136-140` |
| CR2 | Вердикт из четырёх слов; до трёх возражений с `Fact:`/`Judgement:`/`Owner decision:`; одна альтернатива; «cannot know» | `critic.md:83-90`, `:101-136` |
| CR3 | Product Session зовёт критика по просьбе владельца | `harness/hooks/rules/product.md:37` |
| CR4 | Orchestrator зовёт критика перед приёмкой spec-а; строка-ссылка с меткой «Critic» на языке `language.docs`; таблица; `Owner decision:`; можно вопреки | `harness/hooks/rules/orchestrator.md:116-118`; `critic.md:142-165` (метка — `:152-155`) |
| CR5 | Skill идей: 3–5, поля, против roadmap; узлы с `advice: true`; без tools — в ответе | `harness/skills/product-ideas/SKILL.md:3`, `:42-62`, `:64-80` |
| CR6 | Шапка «Advice accepted N of M · P%» / «No advice decided yet»; ждущие не в доле | `ProductSessionPanel.tsx:148-166`; `test/unit/product-session-panel.test.tsx:362` |
| CR7 | Tooltip: ждущие, пропущенные файлы, задержка разбора, «не мерка качества» | `ProductSessionPanel.tsx:131-145` |
| CR8 | Что считается; возражение критика один раз; считается при чтении, не хранится | `src/shared/product/share.ts:1-14`, `:55`, `:61-79` |
| CR9 | Шапка спрашивает на каждом `product.changed`; разбор без темы — со следующим изменением | `ProductSessionPanel.tsx:111-122` |
| CR10 | Метки английские, их читают tools | `critic.md:33-34`; `share.ts:9-10` |
| CR11 | Eval-ы критика и идей; запуск `scripts/eval-harness.mjs`, CI их не запускает | `harness/evals/critic-verdict/case.yaml`, `harness/evals/product-ideas/case.yaml`; `.github/workflows/` — `eval-harness` нет (`grep -rn eval-harness .github/workflows` пусто) |
