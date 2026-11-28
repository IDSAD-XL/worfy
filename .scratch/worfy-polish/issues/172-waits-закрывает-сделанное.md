# 172 — Waits сам закрывает то, что пользователь уже сделал

Type: polish
Status: done 2026-11-28T10:41Z
PR: #2362
Branch: worfy-polish/172
Blocked by: None — can start immediately
Source: просьба владельца 2026-11-28 со screenshot-ом панели Assistant: на вкладке «Waits 6» висят, например, «Resolve
conflicts in PR #8406», «7 draft replies wait for your Send», «Replace Harness» и Linked machine, которая не отвечает.
Слова владельца: «по открытым предложениям Waits нужна регулярная перепроверка: если юзер сделал то, что просилось,
закрывать это предложение, чтобы они не копились и не висели вечно, пока юзер сам не уберёт».

Кто: агент. Глубина review — `medium`. Не платформенный PR.

## Решения владельца

- 2026-11-28 (ответ на PR #2346): строки Journal для пункта, который закрылся сам, нет. След — существующее состояние
  `closed`.
- 2026-11-28 (ответ на PR #2346, против рекомендации «оставить до Dismiss»): то, что worfy проверить не может, —
  предложения без пункта («7 draft replies wait for your Send»), Slack, Jira, Autopilot — перепроверяет model. На
  каждом wake Assistant-а она смотрит такие открытые пункты и закрывает сделанные. Лишних wake-ов ради уборки нет:
  проверка едет на тех, что и так были. У закрытого model-ю пункта записано, почему он закрыт.

## Что происходит

Во вкладке Waits (`Waits`, `src/renderer/assistant/AssistantPanel.tsx:134`) три вида строк:

- пункты attention core (attention core — модуль main, который копит пункты из событий);
- предложения Assistant-а (proposals), которые модель создаёт через `proposal_create`
  (`src/shared/assistant/app-tools.ts:75`);
- карточки Linked machine.

Пункт attention core уже умеет закрываться сам. Состояние `closed` — «the cause went away»
(`src/shared/assistant/attention.ts:31-32`). Переход делает `AttentionCore.resolve`
(`src/main/assistant/core/attention-core.ts:229-233`). Его зовёт источник, когда снова прочитал предмет и увидел, что
причина ушла:

- Session: ответ, prompt, закрытие Session (`src/main/assistant/core/sources.ts:102`, `:117`);
- Ticket больше не ждёт или исчез (`:143`, `:158`);
- PR перешёл в группу, которая не ждёт пользователя (`:172`);
- строка Health check снова `ok` (`:260`);
- окно Limits снова allowed (`:277`);
- CI основной ветки снова зелёный (`src/main/assistant/duties/main-ci.ts:35`).

Карточка Linked machine перечитывается каждые 60 s и на каждое изменение соединения
(`src/main/assistant/window/app.ts:153-163`), так что она уже исправляется сама.

Предложение, привязанное к пункту, уходит из окна вместе с пунктом (`src/main/assistant/window/view.ts:410`).
Предложение без пункта (`item: null`, `src/shared/assistant/proposals.ts:36`) уходит только по Dismiss или Start
пользователя (`view.ts:634`, `:718`) или по `proposal_remove` модели.

Пункт без событий удаляется через 14 дней (`ATTENTION_KEEP_DAYS`, `attention-core.ts:27`, `:151-154`). До этого он висит.

Где пункты не закрываются, хотя дело сделано:

1. **PR смержен или закрыт.** Поиск PR inbox берёт только `is:pr is:open` (`src/main/github/inbox.ts:100`). Смерженный
   или закрытый PR пропадает из snapshot-а. `takePrInbox` (`sources.ts:166-179`) проходит только по строкам snapshot-а,
   поэтому пункт PR — а с ним предложение вроде «Resolve conflicts in PR #8406» — висит до 14 дней. Test-а на этот
   случай нет (`test/unit/assistant-attention-sources.test.ts:134` проверяет только переход в другую группу).
2. **Harness заменён или обновлён.** Строку Health check `harness` («replace it only if this build is the newer one»,
   `src/main/first-run/checks.ts:810-819`) пересчитывают только старт (`src/main/ipc/first-run.ts:349-352`),
   «Check again» и открытие Settings → Health (`:364-367`). Re-check на focus окна (`health.focus`, не чаще раза в
   5 мин — `RECHECK_ON_FOCUS_MS`, `src/main/first-run/health-reports.ts:43`, `:175-184`) зарегистрирован только у
   `github-access` (`first-run.ts:290`). После Install, Update или Replace из popover-а версии main узнаёт об этом
   через `onHarnessInstalled` (`src/main/ipc/harness.ts:53`). Слушает его только `index.ts:449`, Health check — нет.
   Поэтому пункт «Replace Harness» висит до следующего полного прогона.
3. **Предложения без пункта.** «7 draft replies wait for your Send» — скорее всего такое предложение. Черновики pr-reply
   на диске есть (`<Profile>/state/pr-inbox/drafts/<owner>-<name>-<N>.json`, state `draft`, `sent` или `discarded`,
   `src/shared/ipc/pr-inbox.ts:229`, `:237`; читает их `PrReplySender.drafts`,
   `src/main/github/pr-reply-send.ts:202`). Но у предложения без пункта нет ссылки на PR, и проверить его нечем.
4. **Slack и Jira** (`src/main/assistant/sources/connector-check.ts:116`) и **Autopilot** (`sources.ts:235`): пункты
   только создаются. Проверить, что дело сделано, можно лишь новым вызовом connector-а или model-и.

Journal (`src/main/assistant/actions/journal.ts`) — журнал действий: `outcome` у строки только `done`, `refused` или
`escalated` (`src/shared/assistant/actions.ts:85`). Строку «закрылось само» он не пишет и не для неё сделан. След
закрытия уже есть: пункт в `closed` остаётся в файле пунктов (`assistant-items.json`,
`src/main/assistant/core/store.ts:52-55`) до удаления через 14 дней.

## Что строить

Новый таймер и новые вызовы GitHub не нужны: перепроверка садится на чтения, которые worfy уже делает.

1. **PR, которого больше нет среди открытых.** После каждого удачного поиска PR inbox Project-а — раз в 5 мин,
   при открытии вида Pull requests чаще, с тем же rate limit floor (`inbox.ts:22-26`) — открытый пункт `pr-inbox`
   этого Project-а закрывается (`resolve`), если его PR нет в результате поиска. Условия:
   - чтение удачное (`error === null`, `readAt` не null, reader включён);
   - результат полный: каждый из двух `search` вернул меньше `INBOX_SEARCH_LIMIT` (100, `inbox.ts:57`) PR-ов;
   - решение — по номерам из результата поиска, а не по строкам групп. PR, чьи details не прочитались, уходит из
     cache (`inbox.ts:18-19`), хотя открыт.
   Если хоть одно условие не выполнено, пункт остаётся. Reader отдаёт эти факты (например, `searchComplete` и номера
   найденных PR-ов) в snapshot или в `onChange`. Новых запросов к GitHub нет.
2. **Harness.**
   - Health check подписывается на `onHarnessInstalled` и пересчитывает строку `harness`. Строка `ok` закрывает пункт
     уже существующим путём (`sources.ts:260`).
   - Для `harness` регистрируется re-check (`health.registerRecheck`, `health-reports.ts:95`). Тогда строка не `ok`
     перепроверяется на focus окна, не чаще раза в 5 мин, — так ловится Replace, сделанный в терминале.
   - Re-check читает только локальное состояние (`appInstaller().status()`). Последний ответ GitHub о том, какая
     сборка новее (`behind`), берётся из прошлой проверки, без нового вызова.
3. **То, что worfy проверить не может, перепроверяет model на wake-ах, которые и так идут** (решение владельца
   2026-11-28). Сюда входят предложения без пункта, пункты Slack, Jira и Autopilot.
   - Новых wake-ов нет. Planner (`src/main/assistant/wake/planner.ts`) не планирует wake ради уборки. Daily limit
     (`ASSISTANT_DAILY_WAKE_LIMIT` = 20, `src/shared/assistant/budget.ts:26`) и правило про 5-часовое окно
     (wake ждёт, пока окно занято больше 80 %, `src/main/assistant/budget/wake-gate.ts:6-7`) не меняются.
     Перепроверка едет только на автоматических wake-ах (urgent, batch, morning). Run на сообщение пользователя её
     не делает: пользователь ждёт ответа.
   - Первое сообщение wake-а (`wakePrompt`, `src/main/assistant/session/runner.ts:93-108`) получает короткий раздел:
     «Open items worfy cannot re-check». В нём записи, как у handed-over items (id, kind, source, возраст), не
     больше 10 самых старых, и число остальных (их model дочитает через `items_list`). Тексты — outside-text
     objects, как у остальных записей. Пустой список — раздела нет. Предложения без пункта model уже видит в своей
     memory (`memoryForPrompt`, `src/main/assistant/session/memory.ts:93`): им нужна только строка в правилах.
   - Чем закрывать:
     - предложение — существующий `proposal_remove` (`src/shared/assistant/app-tools.ts:77`). У него появляется
       необязательный `why`. С `why` book не удаляет предложение, а помечает закрытым: when, `by: 'assistant'`,
       `why`. Такое предложение окно не показывает, book хранит его 14 дней, как пункты;
     - пункт — нового tool-а в `worfy-app` нет, его надо завести: `item_close { id, why }`. Он закрывает только
       открытые пункты источников `slack`, `jira` и `autopilot`. Пункты, которые worfy проверяет сам (session,
       pr-inbox, health, limits, ci и другие), он отказывает с понятной ошибкой. Пункт уходит в `closed` с одной
       строкой о причине в самом пункте (например, `closedBy: 'assistant'`, `closedWhy` до 200 символов, в схеме
       `src/shared/assistant/attention.ts:87-122`). Новое событие того же предмета открывает пункт снова, как
       сегодня (`new` после `closed`).
   - Правила Assistant-а — `harness/hooks/rules/assistant.md`, список tools (строки 22-24) и абзац о первом
     сообщении (строки 30-37). Новая строка: на wake-е посмотри «Open items worfy cannot re-check» и свои
     предложения без пункта. Закрой только то, что точно сделано по тому, что ты прочитал (`autopilot_runs_read`,
     `pr_threads_read`, connector Slack или Jira, если он есть в этой Session). Если не уверен — оставь. Описания
     tools — в `app-tools.ts` (строки 118-126).
   - Расход: раздел — около 1 KB текста на wake. Tool calls — только на то, что model закрывает. Больше ничего не
     нужно: usage этих wake-ов и так считается.
4. **Возраст того, что осталось.** Дату у строк Waits видно уже сейчас (`shortTime`, `AssistantPanel.tsx:93`). Но для
   старше 6 дней `shortTime` показывает только день недели (`src/renderer/assistant/format.ts:6-11`), и возраст
   неясен. Для таких — дата (`Nov 20`).
5. **След.** Journal не трогать (решение владельца). Закрытое worfy — состояние `closed`. Закрытое model-ю — `closed`
   и строка о причине в пункте или в предложении. В `docs/features/assistant.md` (абзац **Items**, строки 182-188) и в
   `docs/features/ru/assistant.md` к «An item closes when…» добавить смерженный или закрытый PR, заменённый Harness и
   уборку model-ю на wake-ах — с тем, что закрытое model-ю хранит причину.

## Где в коде

- `src/main/github/inbox.ts:57`, `:75`, `:98-101` — поиск и его предел; snapshot — `src/shared/ipc/pr-inbox.ts:167-189`.
- `src/main/assistant/core/sources.ts:160-179` — `prInboxAttention`, `takePrInbox`.
- `src/main/assistant/core/install.ts:80-81` — подписки attention core на PR inbox и Health check.
- `src/main/ipc/harness.ts:50-56`, `:70-78` — `onHarnessInstalled`; `src/main/ipc/first-run.ts:286-292` — образец
  `registerRecheck`; `src/main/first-run/health-reports.ts:95`, `:175-184`.
- `src/main/first-run/checks.ts:810-819` — строка `harness`.
- `src/main/assistant/session/runner.ts:53-58` (`WHY`), `:93-108` (`wakePrompt`).
- `src/shared/assistant/app-tools.ts:74-78`, `:118-126` — схемы и описания tools;
  `src/main/mcp/app-server.ts:659-666` — `proposal_remove`, рядом ляжет `item_close`.
- `src/main/assistant/proposals/book.ts`, `src/shared/assistant/proposals.ts:32-49` — закрытое предложение.
- `src/shared/assistant/attention.ts:87-122`, `src/main/assistant/core/attention-core.ts:229-233` — пункт и `resolve`.
- `harness/hooks/rules/assistant.md:22-37` — правила Assistant-а.
- `src/renderer/assistant/format.ts:6-11` — `shortTime`.
- `docs/features/assistant.md:182-188`, `docs/features/ru/assistant.md`.

## Test-ы

Unit test-ы, по три случая на каждый вид: условие держится, условие ушло, проверить нельзя. Все красные до правки
там, где закрытия ещё нет.

- `test/unit/assistant-attention-sources.test.ts`, PR:
  - PR по-прежнему в группе, которая ждёт пользователя → пункт открыт;
  - PR нет в полном удачном поиске → пункт `closed`;
  - поиск с ошибкой, неполный (100 PR-ов), reader выключен, `readAt` null, PR ушёл только из cache details → пункт
    открыт.
- `test/unit/pr-inbox.test.ts`: reader отдаёт полноту поиска и найденные номера; ровно 100 PR-ов → не полный.
- `test/unit/health-reports.test.ts` (или новый test рядом), Harness:
  - после `onHarnessInstalled` со статусом, совпавшим со сборкой, строка `harness` — `ok`, пункт закрыт;
  - статус по-прежнему outdated → пункт открыт;
  - статус не прочитался → строка не `ok`, пункт открыт;
  - re-check на focus зовётся не чаще раза в 5 мин.
- `test/unit/assistant-attention-sources.test.ts`: ни PR inbox, ни Health check не закрывают пункты Slack, Jira,
  Autopilot и предложения без пункта.
- `test/unit/assistant-session.test.ts`, `wakePrompt`:
  - у batch-, urgent- и morning-wake-а есть раздел с открытыми пунктами Slack, Jira и Autopilot, не больше 10, и с
    числом остальных;
  - у run-а на сообщение пользователя и при пустом списке раздела нет;
  - тексты пунктов — outside-text objects.
- `test/unit/worfy-app-tools.test.ts` (tools `worfy-app`), со stub-ом ответа model-и вместо настоящей Session:
  - `item_close` с `why` закрывает открытый пункт Slack (Jira, Autopilot): `closed`, `closedBy`, `closedWhy`;
  - отказывает пункту pr-inbox и health, неизвестному id, уже закрытому пункту, пустому или длинному `why`;
  - `proposal_remove` с `why` прячет предложение и хранит причину; без `why` — удаляет, как сегодня.
- Тот же stub-сценарий целиком (stub Session зовёт `item_close`): пункт ушёл из Waits, новое событие того же предмета
  открывает его снова. В `test/unit/assistant-wake-planner.test.ts`: при одних только открытых пунктах Slack, Jira и
  Autopilot planner не планирует wake.
- Unit test на `shortTime`: старше 6 дней — дата.
- E2e не нужен.

## Готово, когда

- [ ] Пункт PR, которого нет в полном удачном поиске PR inbox, закрывается после очередного чтения; при ошибке,
      неполном поиске или PR, ушедшем только из cache, пункт остаётся. Новых вызовов GitHub нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts test/unit/assistant-attention-sources.test.ts` (in the run of 12 files) exit 0 · mac - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] Пункт строки Health check `harness` закрывается после Install, Update или Replace и после Replace в терминале
      (re-check на focus); при непрочитанном статусе остаётся.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/health-harness-row.test.ts test/contract/health-reports.test.ts test/contract/first-run-checks.test.ts` (in the run of 12 files) exit 0 · mac - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] На автоматическом wake-е model получает до 10 открытых пунктов Slack, Jira и Autopilot и может закрыть
      сделанные (`item_close`) и свои предложения без пункта (`proposal_remove` с `why`); у закрытого записана
      причина; новых wake-ов нет, daily limit и правило 80 % не тронуты.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-session.test.ts test/contract/worfy-app-tools.test.ts test/unit/assistant-wake-planner.test.ts test/contract/assistant-two-machines.test.ts` (in the run of 12 files) exit 0 · mac - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] Что осталось открытым, старше 6 дней показывает дату.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/assistant-short-time.test.tsx` (in the run of 12 files) exit 0 · mac - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] Unit test-ы на каждый вид («держится», «ушло», «нельзя проверить») и на уборку model-ю (stub ответа model-и)
      красные до правки там, где закрытия не было.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs <54 assistant, health, first-run, pr-inbox and worfy-app test files>` exit 0; closing tests red before the change · mac - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] `harness/hooks/rules/assistant.md`, `docs/features/assistant.md` и `docs/features/ru/assistant.md` говорят, что
      закрывает worfy, что — model на wake-е, а что — только пользователь.
  - evidence: commit pass · worfy-polish/172: a PR found again after one missed search waits again · - - · 55a38d2018f094e3589704a7f8ec3d16d1fdd16e
  - evidence: review pass · PR #2362 · - - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/46124074669/job/140933014028 · ci - · 118f9e51637be298370f3f431ae0341d34b51290
- [ ] (вручную) Сделай: в Stable worfy дождись пункта Waits о своём PR, смержи или закрой PR на GitHub и подожди до
      5 мин (или открой вид Pull requests) → Должно быть: пункт и его предложение ушли из Waits. Затем при пункте
      «Replace Harness» нажми Replace в popover-е версии → Должно быть: пункт ушёл.
  - needs: mac stable
- [ ] (вручную) Сделай: дождись предложения Assistant-а без пункта, например о черновиках ответов. Сделай то, о чём
      оно просит (отправь или удали черновики), и дождись следующего batch- или morning-wake-а → Должно быть:
      предложение ушло из Waits.
  - needs: mac stable

## Итог

- **PR смержен или закрыт.** Snapshot PR inbox несёт `search: { complete, found }` (`src/shared/ipc/pr-inbox.ts`):
  номера всех PR, которые нашёл последний поиск (с cache details или без), и полноту — каждый из двух `search` дал
  меньше `INBOX_SEARCH_LIMIT` (`src/main/github/inbox.ts`, `search()`). `prInboxAttention`
  (`src/main/assistant/core/sources.ts`) после строк закрывает открытый пункт `pr-inbox`, чьего PR нет в `found`, —
  только при `error === null`, `complete` и известном `search`. Новых вызовов GitHub нет: данные — из того же ответа
  поиска.
- **Harness.** `harnessCheck` (`src/main/first-run/checks.ts`) считает одну строку `harness` по локальному
  `appInstaller().status()` и прошлому `harnessBehind` из snapshot-а Update. `followHarnessRow`
  (`src/main/first-run/harness-row.ts`, новый файл) регистрирует re-check `harness` (focus, не чаще раза в 5 мин) и
  подписывается на `onHarnessInstalled`: после Install/Update/Replace строка пересчитывается с тем статусом, что
  вернула установка, через новый `HealthReports.recheckNow` — он ждёт идущий re-check той же строки, а не теряет
  пересчёт. Пункт закрывает существующий путь строки `ok`.
- **Уборка model-ю на wake-ах.** `wakePrompt` (`src/main/assistant/session/runner.ts`) на batch/urgent/morning
  добавляет раздел «Open items worfy cannot re-check»: открытые пункты `slack`, `jira`, `autopilot`
  (`ASSISTANT_RECHECKED_SOURCES`, `src/shared/assistant/attention.ts`), не переданные этим wake-ом, до 10 самых старых
  (`WAKE_UNCHECKED_RECORDS_MAX`) короткими записями `worfy-app` (тексты — outside-text) и число остальных. Run на
  сообщение пользователя раздела не получает; пустой список — раздела нет. Planner не тронут: новых wake-ов нет.
- **`item_close { id, why }`** (`src/shared/assistant/app-tools.ts`, `src/main/mcp/app-server.ts`): закрывает только
  открытый пункт Slack, Jira, Autopilot; пункты других источников, неизвестный id, пункт Linked machine, не открытый
  пункт, пустой или длиннее 200 символов `why` — отказ. Пункт получает `closedBy: 'assistant'` и `closedWhy`
  (`AttentionCore.close`); новое событие того же предмета открывает пункт и снимает обе метки.
- **`proposal_remove` с `why`** помечает предложение `closed: { at, by: 'assistant', why }`
  (`src/shared/assistant/proposals.ts`, `src/main/assistant/proposals/book.ts`): `list()`, окно, `proposals_list` и
  первое сообщение (`memoryView`, `src/main/assistant/session/memory.ts`) его не видят; book хранит его 14 дней и
  выбрасывает при следующей записи. Без `why` — удаление, как раньше. Journal не тронут (решение владельца).
- **Дата.** `shortTime` (`src/renderer/assistant/format.ts`): старше 6 календарных дней — `Nov 20`.
- **Тексты.** `harness/hooks/rules/assistant.md` (tools и раздел «Closing what is done»),
  `src/main/mcp/agent-instructions-app.md` (тот же раздел: файл меняют вместе с `app-tools.ts`, по его комментарию),
  `docs/features/assistant.md` и `docs/features/ru/assistant.md` (абзац «Items»/«Пункты» и время пункта).
- **Test-ы**, красные до правки: `test/contract/pr-inbox.test.ts` (полнота и номера, 100 PR — не полный),
  `test/unit/assistant-attention-sources.test.ts` (закрытие по полному поиску), `test/contract/health-harness-row.test.ts`
  (новый: install, focus, 5 мин, непрочитанный статус), `test/unit/assistant-session.test.ts` (раздел wake-а, закрытое
  предложение в памяти), `test/contract/worfy-app-tools.test.ts` (`item_close`, `proposal_remove` с `why`, список
  tools), `test/unit/assistant-short-time.test.tsx` (новый). Зелёные с первого прогона — охранные: «держится» и
  «проверить нельзя» для PR, «PR inbox и Health check не закрывают Slack/Jira/Autopilot»,
  `test/unit/assistant-wake-planner.test.ts` (только такие пункты — wake-а нет), отказ `item_close` для Linked machine
  в `test/contract/assistant-two-machines.test.ts`.
- **CI, раунд 1:** e2e `test/e2e/first-run.spec.ts:381` (Install из popover-а версии до первого Health check, затем
  экран из палитры) на macOS и Windows видел 16 строк вместо 15: пересчёт после установки при пустом отчёте клал строку
  `harness` в дополнительные, и первая проверка ставила вторую рядом. `HealthReports.recheckNow` теперь пересчитывает
  только строку, которая уже есть в отчёте; test «an install before the first check adds no row» в
  `test/contract/health-harness-row.test.ts` красный без этой проверки.
- **Ревью, раунд 1** (REJECTED на 68c51616c):
  - пункт PR, закрытый отсутствием в одном полном поиске, не открывался, когда PR находился снова с тем же
    `updatedAt`: ключ `seen` (source, id, revision) отбрасывал событие. Новый `AttentionCore.resolveGone`
    (`src/main/assistant/core/attention-core.ts`) закрывает пункты предмета и снимает ключи источника с префиксом id
    (`<repo>#<N>:`); `prInboxAttention` зовёт его вместо `resolve`. Test «a PR one whole search missed and the next one
    finds again, unchanged, opens its item again» в `test/unit/assistant-attention-sources.test.ts` красный до правки;
    feature pages (en, ru) говорят, что найденный снова PR открывает пункт снова;
  - test «an Install that ends while a focus re-check still reads the old state…» в
    `test/contract/health-harness-row.test.ts`: с удалённым `await this.inFlight.get(key)` в `recheckNow` он красный
    (проверено мутантом, файл восстановлен), с ним — зелёный;
  - Evidence-строки на `c319c3b43` (его нет на ветке после rebase) сняты; новые стоят на коммите правки ревью.
