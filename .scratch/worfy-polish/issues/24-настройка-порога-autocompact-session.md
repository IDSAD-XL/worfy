# 24 — Настройка: на скольких токенах Session делает autocompact

Type: task
Status: done 2026-10-16
PR: #376
Branch: worfy-polish/24
Blocked by: 23
Source: слово владельца 2026-10-15 (через Orchestrator-а): «Настройка: на скольких токенах происходит
autocompact Session».

## Что происходит

Autocompact — Claude Code сам сжимает историю Session-а, когда окно контекста почти заполнено.
worfy на порог сейчас никак не влияет.

**Как worfy запускает Session.** Через Agent SDK (`query()`), не через CLI в Terminal-е. Опции
собирает `sessionOptions` (`src/main/agent/options.ts:227-278`): `env` — окружение login shell,
`settingSources` — `user`, `project`, `local` (`:232`), модель и effort (`:245-246`). Inline-настроек
SDK (`settings`) worfy не передаёт. У живой Session worfy уже меняет effort через
`applyFlagSettings` (`src/main/agent/session.ts:98`, `:252`).

**Какой механизм есть в Claude Code** (пакет проекта: Agent SDK 0.3.289 и Claude Code из
`@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.289`; найдено в `sdk.d.ts` и строках бинарника
`claude`, не по памяти):

- **Окно autocompact в токенах — настройка.** `Settings.autoCompactWindow` (`sdk.d.ts:8980-8983`) и
  по модели `modelSettings.<model>.autoCompactWindow` — «in tokens (100000 to 1000000), or "auto"»;
  ключ модели совпадает и с написанием `[1m]`; команда `/autocompact` пишет туда (`:8970-8972`).
- **Включено или нет** — `Settings.autoCompactEnabled` (`:9216-9219`).
- **Переменная окружения** `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. В коде бинарника порядок выбора окна:
  env, затем настройки, затем другие источники, затем значение модели; итог не больше окна модели.
  Значение env — целое число токенов: `400k` или `400` разбираются как 100 000 (нижняя граница);
  сокращение «100–1000 — тысячи» есть только у команды `/autocompact`.
- **Порог = окно минус запас на сводку.** Так описано поле `threshold` в схеме события
  `autocompact_state` в бинарнике. Переменная `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` опускает порог в
  процентах; в коде она названа `testPctOverride` — опора на неё рискованна.
- **Как передать из SDK.** Опция `settings` у `query()` (`sdk.d.ts:2212`, тип `Options`, `:1521`) — это
  флаг `--settings`. `Query.applyFlagSettings()` (`:2925-2953`) — тот же слой на ходу. «Flag settings
  sit above user/project/local and below managed policy settings» (`:2926-2927`). Env выше настроек:
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` из login shell пользователя перебьёт настройку worfy.
- **Проверить, что применилось,** — `getContextUsage()`: `autoCompactThreshold`, `isAutoCompactEnabled`
  (`sdk.d.ts:4017-4018`; Ticket 23 этот вызов добавляет).

- **Живая Session новое окно не подхватывает** (по коду бинарника): окно вычисляется один раз при запуске,
  `apply_flag_settings` только пишет flag-слой, пересчёт зовут лишь внутренние события вроде `/autocompact`.
- **Subagent-ы** (в том числе implementer-ы и reviewer-ы Harness) сжимаются тем же циклом и берут порог
  родительской Session без изменений; окно ограничено моделью самого subagent-а. Своего порога у агента
  нет: в `AgentDefinition` нет полей autocompact, env или settings (`sdk.d.ts:38-104`). Обход — только
  другая модель агента плюс `modelSettings`; `opus` и `opus[1m]` — один ключ.

Итог: механизм есть. Единица — **токены окна**, не процент. Порог действует с запуска Session.

## Что делаем

1. **Сначала красный contract test** на fake SDK: настройка задана — `query()` получает
   `settings: { autoCompactWindow: <N> }`; не задана — `settings` без этого ключа (сегодня ключа нет
   никогда — test красный на «задана»).
2. **Где хранится — решение владельца 2026-10-15:** две настройки приложения
   (`src/shared/settings/app-settings.ts`), общие для всех Project-ов:
   - **Orchestrator** — Session Orchestrator-а, в том числе под Autopilot, и все её subagent-ы
     (implementer-ы наследуют порог). По умолчанию **400K**: Orchestrator-у хватает 200–400K,
     implementer-у лучше 400–600K, 400K подходит обоим.
   - **Other Sessions** — Session-ы, открытые на Canvas. По умолчанию **500K**.
   Каждая — число токенов окна или «Claude Code default» (`null`: worfy ничего не передаёт, решают
   `settings.json` пользователя и Claude Code). Чтобы различать роли, запуск Session несёт признак
   Orchestrator-а (сейчас передаётся только `unattended`, `src/main/agent/session.ts:582`; опции
   настроек — там же, `:580`, `querySettings`). Раздел Settings — новый файл
   `src/renderer/settings/SessionsSection.tsx` (разделы находятся сами, `sections.ts:4-8`).
3. **Ввод.** Число в тысячах токенов (100K–1M, шаг 10K); рядом — подсказка: «Autocompact runs a little
   below this: Claude Code keeps room for the summary». Если в окружении login shell есть
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW` — строка «Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW in your
   shell».
4. **К каким Session-ам — решение владельца 2026-10-15:** значение действует со следующего запуска
   Session; под полем подпись «Applies after restarting the Session». worfy сам Session-ы не
   перезапускает и `applyFlagSettings` для порога не зовёт.
5. **Autopilot** — это перезапуск Session Orchestrator-а с `unattended: true`
   (`src/main/agent/orchestrator.ts:252`): он получает настройку «Orchestrator».
6. **Снимки** раздела Settings — значение по умолчанию, своё значение, строка про env — светлая и
   тёмная тема, `.scratch/worfy-polish/evidence/24-*.png`.

## Готово, когда

- [x] Contract test пункта 1 красный на main и зелёный с правкой: Orchestrator и Autopilot получают
      значение «Orchestrator», Session Canvas — «Other Sessions»; ни одного запуска настоящего Claude
      Code (fake SDK).
- [x] Мутанты краснят свои test-ы: «`null` передаётся как ключ»; «роли перепутаны».
- [ ] (вручную) Stable copy: Orchestrator 400K — `getContextUsage().autoCompactThreshold` новой Session
      от 380 000 до 400 000 (порог = окно минус запас на сводку до 20 000); смена значения у живой
      Session ничего не меняет до перезапуска; значения — в «Итог». Не проверено: шаг владельца.
- [x] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)` (оркестратор перед merge); Linux CI зелёный (в PR).

## Тесты

- Contract — `test/contract/agent-autocompact.test.ts` (новый): опции `query()` по роли Session.
- Unit — `test/unit/settings-sessions.test.tsx` (новый): ввод, пределы, «default», строка про env.

## Где в коде

- `src/shared/settings/app-settings.ts`
- `src/main/agent/options.ts`
- `src/main/agent/session.ts`
- `src/main/agent/orchestrator.ts`
- `src/main/agent/fake-query.ts`
- `src/renderer/settings/SessionsSection.tsx`
- `test/contract/agent-autocompact.test.ts`
- `test/unit/settings-sessions.test.tsx`
- Дописано при claim (2026-10-16):
  - `src/main/agent/app-registry.ts` — здесь main при запуске Session читает настройки приложения и
    выбирает окно по роли;
  - `src/main/agent/session-settings.ts` — признак Orchestrator-а в `SessionLaunch`;
  - `src/main/settings/store.ts` — чтение, слияние и сравнение новых полей настроек приложения;
  - `src/shared/ipc/session-autocompact.ts`, `src/main/ipc/session-autocompact.ts` (новые) — канал,
    по которому раздел Settings узнаёт `CLAUDE_CODE_AUTO_COMPACT_WINDOW` из окружения login shell;
  - `test/contract/app-settings.test.ts` — сравнение настроек целиком теперь с новым полем;
  - `test/unit/shell.test.tsx`, `test/unit/machines-section.test.tsx`,
    `test/unit/use-app-settings.test.tsx`, `test/unit/interface-scale.test.tsx`,
    `test/unit/sidebar-section.test.tsx` — их образцы `AppSettings` получают новое обязательное
    поле (иначе не проходит typecheck);
  - `test/unit/terminal-ai-settings.test.tsx` — test ждал, что Terminal AI — последний раздел
    Settings; теперь проверяет, что он сразу после Machines;
  - `test/e2e/settings-sessions.spec.ts` (новый) — снимки раздела в двух темах;
  - круг доработки 1: `test/setup-contract.ts` — свой `WORFY_DATA_DIR` у каждого файла contract
    test-ов и защита `dataRoot()` от настоящей папки данных; `test/contract/claude-home-isolation.test.ts`
    — test-ы этой защиты.

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/settings/sections.ts`, `src/main/ipc/app-settings.ts`, `src/main/agent/env.ts`,
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. Где main берёт настройки приложения при
запуске Session — исполнитель дописывает файл в «Где в коде» при claim.

## Вне скоупа

- Порог в процентах (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`) — в коде Claude Code помечен как override для
  test-ов.
- Запись в `settings.json` пользователя (`/autocompact` пишет туда) — worfy не пишет в чужие файлы
  (ADR-0002, ADR-0005).
- Индикатор заполненности — Ticket 23.
- Свой порог implementer-ам (решение владельца 2026-10-15): в SDK его нет; другая модель implementer-а
  или implementer как отдельная Session worfy — вернуться, если 400K окажется мало.
- Перезапуск Session при смене порога.

## Итог

- **Настройки.** В `AppSettings` новое поле `autoCompactWindow: { orchestrator, other }` — окно в
  токенах (100 000–1 000 000, шаг 10 000) или `null` («Claude Code default»). По умолчанию 400K и
  500K. Store (`src/main/settings/store.ts`) приводит значение к пределам и шагу; в старом
  `app-settings.json` без поля берутся значения по умолчанию.
- **Передача в Claude Code.** Признак Orchestrator-а — `SessionLaunch.orchestrator`: его ставит
  `Orchestrators.launch` для каждого запуска, и при Autopilot тоже. `Session` передаёт его в
  `QueryRequest.orchestrator`. `sdkQueryFactory` читает настройки приложения при каждом запуске процесса Claude Code
  и передаёт окно в `sessionOptions`, а оттуда — `settings: { autoCompactWindow }` в `query()`.
  При `null` ключа `settings` нет совсем. `applyFlagSettings` для окна не вызывается: живая Session
  держит окно, с которым запущена.
- **Раздел Settings → Sessions** (`order = 60`, после Terminal AI). Две строки — «Orchestrator» и
  «Other Sessions»: выбор «Claude Code default» / «Custom» и поле в тысячах токенов («K tokens»).
  Ввод применяется по Enter или при уходе из поля. Под каждой строкой — «Applies after restarting
  the Session.», под разделом — «Autocompact runs a little below this: Claude Code keeps room for
  the summary.». Если в окружении login shell есть `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, вверху
  строка «Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW in your shell (<значение>).». Значение
  приходит по новому каналу `sessionAutocompact.shellOverride` (`local`).
- **Решено без владельца, подтверждено владельцем 2026-10-16:**
  - вид ввода: выбор «Claude Code default» / «Custom» и рядом поле; при переключении на «Custom»
    берётся значение роли по умолчанию (400K или 500K);
  - текст вне пределов приводится к ним молча (50 → 100K, 1500 → 1M, 455 → 460K); текст, который не
    число, ничего не меняет, и поле снова показывает действующее значение;
  - пустая переменная `CLAUDE_CODE_AUTO_COMPACT_WINDOW=` считается отсутствующей;
  - черновая Session подключения Project-а (`draftSessionOptions`) окна не получает;
  - (**не принято владельцем 2026-10-16, follow-up — Ticket 29**) значения по умолчанию действуют и у тех, кто настройку не открывал. Session-ы после обновления
    worfy сжимаются у окна 400K/500K, а не у окна Claude Code по умолчанию, и flag settings
    перекрывают `autoCompactWindow` из `settings.json` пользователя.
- **Test-ы.** `test/contract/agent-autocompact.test.ts` — цепочка Orchestrators → Session → `sdkQueryFactory` →
  `sessionOptions` → опции замоканного `query()`; Session играет fake agent. До правки: 6 из 7
  test-ов красные (exit 1), после — 9 из 9 зелёные. `test/unit/settings-sessions.test.tsx` — ввод,
  пределы, «default», строка про env, отказ main. `test/contract/app-settings.test.ts` — store.
- **Мутанты** (на копиях, восстановление проверено `cmp`), каждый красит свои test-ы: `null`
  передаётся как ключ (2 красных); роли перепутаны в `app-registry.ts` (5) и в
  `autoCompactWindowFor` (5); Orchestrator не помечен (4); Session теряет признак (4); store не
  сливает `other` (1); store не приводит к пределам (1); раздел не приводит к пределам (1);
  «Custom» берёт значение не своей роли (1); строка про env не показывается (1); handler читает
  не ту переменную (1).
- **Снимки** (`test/e2e/settings-sessions.spec.ts`, `WORFY_EVIDENCE_DIR`):
  по умолчанию — [светлая](../evidence/24-sessions-default-light.png),
  [тёмная](../evidence/24-sessions-default-dark.png); своё значение (Orchestrator 250K, Other
  Sessions — Claude Code default) — [светлая](../evidence/24-sessions-custom-light.png),
  [тёмная](../evidence/24-sessions-custom-dark.png); строка про env —
  [светлая](../evidence/24-sessions-shell-override-light.png),
  [тёмная](../evidence/24-sessions-shell-override-dark.png).
- **Круг доработки 1** (ревью PR #376):
  - `sdkQueryFactory` получает загрузчик SDK параметром (`loadSdk`, по умолчанию — dynamic import
    SDK). `test/contract/agent-autocompact.test.ts` передаёт свой `query()` и модуль SDK не
    импортирует. Очереди, которая запускала Session-ы по одному, больше нет: Session-ы стартуют
    одновременно, как в приложении. Ещё две защиты: модуль SDK замокан, его `query()` бросает
    ошибку; приложение в test-е считается собранным, и Resources лежат в несуществующей папке —
    даже настоящий `query()` не нашёл бы исполняемый файл.
  - `test/setup-contract.ts` даёт каждому файлу contract test-ов свой пустой `WORFY_DATA_DIR`, как
    уже давал Claude home. `dataRoot()` с окружением процесса и без `WORFY_DATA_DIR` бросает
    ошибку. Если код под test-ом эту ошибку поймал, test всё равно падает после себя
    (`failOnRefusals`). Без изоляции три test-а `workflow-profile.test.ts` из ревью красные.
  - Мутанты, все красные: загрузчик не используется (6 test-ов); нет изоляции папки данных (4,
    из них 3 — `workflow-profile.test.ts`); защита пропускает (2); `dataRoot()` не подменён (2);
    `failOnRefusals` молчит (1).
- **Не проверено:** порог на настоящем Claude Code (`autoCompactThreshold` 380 000–400 000 при
  окне 400K) и то, что живая Session не меняет порог до перезапуска, — шаг владельца на Stable
  copy.

### Gate оркестратора (2026-10-16)

- Wave 4 Epic-а под Autopilot: Ticket-ы 22 и 24 параллельно, общих файлов нет. Глубина — один verifier на круг; UI — снимки в обеих темах.
- Гейт — два круга. Круг 1 — `REJECTED` ([комментарий в PR #376](https://github.com/IDSAD-XL/worfy/pull/376#issuecomment-6204320485)): [med] reader настроек по умолчанию заставлял `workflow-profile.test.ts` читать (и при ошибке переименовывать) `app-settings.json` настоящей папки данных, а в test-ах это папка Stable copy; [med] защита в `agent-autocompact.test.ts` ловила настоящий SDK уже после того, как `query()` запустил Claude Code. Круг 2 — `VERIFIED` на `629b0d67` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/376#issuecomment-6204676937)): у каждого файла contract test-ов своя `WORFY_DATA_DIR`, `dataRoot()` без неё бросает и роняет test; загрузчик SDK передаётся параметром `loadSdk`. Мутанты обоих кругов красные; настоящий `app-settings.json` не менялся.
- Во время работы исполнителя contract test один раз запустил настоящий Claude Code из `node_modules` (гонка двух dynamic import замоканного SDK под vitest; HOME — несуществующий `/Users/tester`). Новых транскриптов в `~/.claude/projects` не найдено; после круга 2 test SDK не импортирует.
- Merge: `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `a10a8e3`.
- Consider, Dismissed — нет.
- Noted (**решение владельца 2026-10-16: не принято, follow-up — Ticket 29**): 400K и 500K по умолчанию перекрывают `autoCompactWindow` из `~/.claude/settings.json` — `/autocompact` в Session worfy после перезапуска не действует, пока не выбран «Claude Code default»; в UI об этом не сказано.
- Noted: `test/unit/agent-query-factory.test.ts` всё ещё импортирует SDK через загрузчик по умолчанию — кандидат на `loadSdk`; `canvas-tools.test.ts:103` удаляет `WORFY_DATA_DIR`, выданную setup-ом.

Решение владельца 2026-10-16: решения без владельца приняты, кроме одного. 400K и
500K по умолчанию не должны перекрывать `autoCompactWindow` из `~/.claude/settings.json`: если он там
задан, worfy его уважает; свои значения по умолчанию worfy берёт, только когда там пусто; Settings
показывает, откуда значение. Follow-up — Ticket [29](29-autocompactwindow-из-settings-json-claude-code.md).
