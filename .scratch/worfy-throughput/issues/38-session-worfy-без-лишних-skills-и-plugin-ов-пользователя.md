# 38 — Session worfy без skills и plugin-ов пользователя вне списка Profile: сначала замер

Type: task
Status: claimed 2026-10-28T17:25Z
Branch: worfy-throughput/38
Blocked by: 19
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идея 2, строка L5
таблицы «Цель и числа», вопрос Q-L4; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md);
[ADR-0021](../../../docs/adr/0021-mcp-servers-allowlist-in-profile.md); образец — [`worfy-daily` 06](../../worfy-daily/issues/06-mcp-серверы-по-profile.md).

## Что происходит

- Session worfy идёт с настройками пользователя: `settingSources` user + project + local
  (`src/main/agent/options.ts:3`). MCP-серверы отбирает список Profile (ADR-0021, `:19-21`), а «CLAUDE.md, hooks
  and skills still come from the user (ADR-0002)» (`:21-22`).
- Значит, в каждую Session Project-а и в её Subagent-ы приходят описания всех skills и plugin-ов пользователя, не
  только plugin worfy. У пользователя с десятками plugin-ов это может быть тысячи token-ов на каждый старт.
- Для MCP такой отбор уже дал разницу: 12 MCP tools вместо 634 tools всего (`.scratch/worfy-daily/issues/06-mcp-серверы-по-profile.md:56`).
- Сколько token-ов дают skills и plugin-ы пользователя — базы нет.

## Что делаем

1. **Замер, до кода.** По транскриптам (скрипт Ticket-а 19 или разовый разбор) — размер описаний skills и
   plugin-ов в первом запросе Session worfy и Subagent-а на Mac владельца: token-ы и доля стартового контекста.
   Итог — в «Итог»; по нему выбирается шаг 2 (ответ владельца на Q-L4). Меньше 5k token-ов на старт (порог из рекомендации Q-L4) — Ticket
   закрывается этим ответом.
2. Иначе (больше 5k token-ов; «да» владельца на Q-L4 — 2026-10-28, `spec.md` «Ответы»; нужен новый ADR): поле Profile со списком plugin-ов и skills для Session Project-а (имя
   предлагает Ticket). Поле объявляется в контракте Profile так же, как `mcp.allowed`: строка в
   `harness/profiles/README.md` (образец — `:209`) и в `harness/profiles/draft.schema.json` (образец — `:147`).
   Нет поля — как сейчас. plugin worfy в списке всегда.
3. Способ отбора в SDK — по документации Agent SDK и на fixture `system/init` (как `worfy-daily` 06), без вызова
   модели: `settingSources` оставить, иначе пропадут `CLAUDE.md` и hooks пользователя. Живая Session — только
   ручным пунктом с «да» владельца. Версии Claude Code и SDK — в «Итог».
4. Новый ADR: меняет следствие ADR-0002 о skills. Номер — `bin/preflight` на claim.

Нужен ПК: нет. **Трогает Harness: да** — контракт Profile (`harness/profiles/README.md`, `draft.schema.json`) на
шаге 2; слово владельца дано (Q-L0 spec-а: «да» 2026-10-28). Остальное — код worfy. Вердикт Windows: runner `full` (код Session, нужен
на обеих ОС).

## Готово, когда

- [x] «Итог»: замер шага 1 — token-ы описаний skills и plugin-ов в первом запросе, команда и код выхода.
- [x] (если шаг 2) Сначала падающий test: `test/unit/agent-options.test.ts` — Session в Project со списком
      НЕ получает plugin вне списка (до правки — получает, test красный).
- [x] (если шаг 2) Schema принимает поле и его отсутствие, отвергает неверный тип — test по образцу
      `harness/bin/tests/review-depth.test.sh`, раздел 2.
- [x] (если шаг 2) Session вне Project и Profile без поля работают как раньше — test-ы на оба случая.
- [x] (если шаг 2) worfy не пишет в `~/.claude` и в репозиторий Project — test сравнивает деревья временных
      папок до и после.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; e2e — только свои spec-и; условие merge — `ci-ok`.
- [ ] (вручную, с «да» владельца, если шаг 2) Живая Session на Project worfy: стартовый контекст до и после — в «Итог».

## Где в коде

- `src/main/agent/options.ts` (`:3`, `:19-22`)
- `src/main/workflow/profile.ts` (чтение поля Profile, как для MCP)
- `harness/profiles/README.md` (строка поля, образец `:209`), `harness/profiles/draft.schema.json` (образец `:147`)
- `test/unit/agent-options.test.ts`
- Только читать: `scripts/agent-cost.mjs`, `docs/adr/0002-*.md`, `docs/adr/0021-*.md`

## Вне скоупа

- Тексты Harness, которые hook добавляет в каждый Subagent, — правка Ticket-а 33 от 2026-10-28 (вечер).
- Сессии Claude Code вне worfy (терминал) — не трогаем.

## Итог

### Замер (шаг 1), 2026-10-28

Источник — транскрипты в `~/.claude/projects/-Users-alexey-Stuff-CanvasForAI/` (только чтение): main-транскрипт
Session worfy `f6ab7045-…` (`entrypoint: sdk-ts`, Claude Code 2.1.289, SDK 0.3.289) и 400 последних её
Subagent-ов. Описания skills в транскрипте — вложение `skill_listing` первого запроса (`content`,
`skillCount`). Разбор — разовые node-скрипты в scratchpad агента (не в репозитории): `skills.mjs`/`groups.mjs`
(список skills по источникам), `scan.mjs` (стартовый контекст Subagent-ов), `ratio.mjs` (символов на token);
каждый — exit 0.

Стартовый контекст — input + cache write + cache read первого запроса.

| Кто | Первый запрос, token-ов | Список skills: skills / символов | Из них пользователя (не worfy, не встроенные) | ≈ token-ов пользователя | Доля старта |
| --- | --- | --- | --- | --- | --- |
| Session worfy (Orchestrator) | 53 823 | 74 / 29 787 | 20 999 символов | 7,0 тыс. (6,0–7,9) | 13 % |
| Subagent implementer (`agent-a8debc3bc050c0760`) | 35 689 (медиана 141 implementer-а — 29 251) | 77 / 29 862 | 18 971 символ | 6,3 тыс. (5,4–7,2) | 22 % медианы |
| Subagent general-purpose (17) | медиана 25 522 | 75–77 / ~29 870 | как у implementer-а | ~6,3 тыс. | ~25 % |
| Subagent reviewer (218), scout (23) | медианы 17 725 и 13 626 | списка нет (у агента нет tool `Skill`) | — | 0 | — |

Список Session по источникам (символов): plugin worfy 6 skills / 2 159; встроенные в Claude Code 14 / 6 630;
`~/.claude/skills` 14 / 5 370 (Cloudflare, Sentry, web-perf…); plugin `figma` 14 / 6 274; plugin
`mattpocock-skills` 11 / 2 645; синхронизированные с claude.ai (`anthropic-skills`,
`cowork-plugin-management`) 15 / 6 710. У implementer-а: 5 370, 4 262 (worfy, 9 skills), 2 513, 7 186,
6 630 и 3 902.

Token-ы — из символов: токенизатор модели офлайн недоступен, а считать через API — запрещённый живой запуск.
Отношение измерено по тем же транскриптам: рост запроса между двумя соседними ответами, где добавлен только
ответ без thinking и один ASCII tool result, минус output token-ы ответа. 51 tool result, похожий на текст:
медиана 2,65 символа на token (p10 2,40, p90 2,97); markdown-проза — 2,94–3,00. Взято 3,0, вилка 2,65–3,5.

**Ответ:** skills и plugin-ы пользователя дают около 7 тыс. token-ов на старт Session и около 6,3 тыс. на
старт implementer-а и general-purpose — больше порога 5 тыс. даже при 3,5 символа на token. Шаг 2 сделан.

Оговорка: Claude Code сокращает описания, когда список больше бюджета (`skillListingBudgetFraction`, 1 %
окна), — у части синхронизированных skills описания уже нет (`pptx`, `xlsx`). Без skills пользователя
описания оставшихся могут стать длиннее, так что экономия может быть немного меньше этой оценки.

### Шаг 2 и 3: поле `skills.allowed`, ADR-0084

- Поле Profile `skills.allowed` — строки: имя или id plugin-а, имя skill из `~/.claude/skills`, `claude.ai`
  для синхронизированных. Контракт — `harness/profiles/README.md`, схема — `harness/profiles/draft.schema.json`.
  Нет поля — всё как раньше; plugin worfy, skills самого Project-а и встроенные skills остаются всегда.
- Способ отбора (`src/main/agent/options.ts`, `userExtensions`, `extensionSettings`): worfy читает
  `enabledPlugins` из настроек пользователя, Project-а и local и папки `~/.claude/skills`, и передаёт flag
  settings: `enabledPlugins: {id: false}`, `skillOverrides: {имя: 'off'}`, `syncClaudeAiSkills` и
  `syncClaudeAiPlugins: false`. `settingSources` не меняются. Ключи синхронизации — никогда не в
  `managedSettings`: там они переносят synced skills в корзину (документация SDK 0.3.289, тип `Settings`).
- Опция SDK `skills` не подошла: по документации она фильтрует только основную Session, не Subagent-ов.
- Чтение поля — `readSkillsAllowlist` в `src/main/workflow/profile.ts`; подключение к старту Session —
  `src/main/agent/app-registry.ts` (`skills` в `SdkQueryFactoryOptions`).
- Проверено без вызова модели: документация SDK 0.3.289 (`Options.settings`, `Options.skills`, `Settings`:
  `enabledPlugins`, `skillOverrides`, `syncClaudeAiSkills`, `syncClaudeAiPlugins`) и fixture `system/init`
  `test/fixtures/sdk-messages/plugin-known-user-settings.jsonl` (Claude Code 2.1.289): id plugin-ов в
  `enabledPlugins` — те же `имя@marketplace`, что в `system/init`; встроенные (`@builtin`) и inline plugin
  не выключаются.
- Чтобы включить в Project-е worfy: в его `profile.json` добавить `"skills": {"allowed": []}` (или с
  нужными именами). Профиль лежит в Harness home вне репозитория — правка за Orchestrator-ом или владельцем.

Test-ы: `test/unit/agent-options.test.ts` (разделы «the plugins and skills of a Session in a Project» и
«the Profile's skills.allowed»), `test/contract/workflow-profile.test.ts` (подключение к `sdkQueryFactory`),
`harness/bin/tests/skills-allowed.test.sh` (контракт, схема, `bin/profile`). Новые test-ы до правки — красные
(`userExtensions is not a function`, 11 failed). Mutation testing в своём worktree: 11 мутантов, 9 убиты;
два выжили на лишних проверках — проверки удалены (папка `synced` без `SKILL.md` и так не skill; `null` и
так не список).

Проверка на Mac владельца: `pnpm lint` и `pnpm typecheck` — exit 0; `pnpm test` — exit 1 только на test-ах
watcher-ов файлов (`docs-watch-root`, `docs`, `workflow-reader`, `claude-home-registry`, `harness-script-env`;
12–14 из 9899), и каждый из этих файлов отдельно — exit 0, кроме `claude-home-registry`, который так же
красный на чистом `origin/main` 2026dd96 (два run-а, exit 1). gate fast — exit 2 по тем же test-ам. Вердикт —
`ci-ok` на runner-ах.

Не проверено: живая Session на Project worfy (стартовый контекст до и после) — ручной пункт, нужен «да»
владельца.
