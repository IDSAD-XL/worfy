# 24 — Настройка: на скольких токенах Session делает autocompact

Type: task
Status: open
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

- [ ] Contract test пункта 1 красный на main и зелёный с правкой: Orchestrator и Autopilot получают
      значение «Orchestrator», Session Canvas — «Other Sessions»; ни одного запуска настоящего Claude
      Code (fake SDK).
- [ ] Мутанты краснят свои test-ы: «`null` передаётся как ключ»; «роли перепутаны».
- [ ] (вручную) Stable copy: Orchestrator 400K — `getContextUsage().autoCompactThreshold` новой Session
      от 380 000 до 400 000 (порог = окно минус запас на сводку до 20 000); смена значения у живой
      Session ничего не меняет до перезапуска; значения — в «Итог».
- [ ] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

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

—
