# 38 — Session worfy без skills и plugin-ов пользователя вне списка Profile: сначала замер

Type: task
Status: open
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
   Итог — в «Итог» и ответ на Q-L4. Меньше 5k token-ов на старт (порог из рекомендации Q-L4) — Ticket
   закрывается этим ответом.
2. Иначе, после «да» владельца на Q-L4: поле Profile со списком plugin-ов и skills для Session Project-а (имя
   предлагает Ticket). Поле объявляется в контракте Profile так же, как `mcp.allowed`: строка в
   `harness/profiles/README.md` (образец — `:209`) и в `harness/profiles/draft.schema.json` (образец — `:147`).
   Нет поля — как сейчас. plugin worfy в списке всегда.
3. Способ отбора в SDK — по документации Agent SDK и на fixture `system/init` (как `worfy-daily` 06), без вызова
   модели: `settingSources` оставить, иначе пропадут `CLAUDE.md` и hooks пользователя. Живая Session — только
   ручным пунктом с «да» владельца. Версии Claude Code и SDK — в «Итог».
4. Новый ADR: меняет следствие ADR-0002 о skills. Номер — `bin/preflight` на claim.

Нужен ПК: нет. **Трогает Harness: да** — контракт Profile (`harness/profiles/README.md`, `draft.schema.json`) на
шаге 2; слова владельца нет (Q-L0 spec-а). Остальное — код worfy. Вердикт Windows: runner `full` (код Session, нужен
на обеих ОС).

## Готово, когда

- [ ] «Итог»: замер шага 1 — token-ы описаний skills и plugin-ов в первом запросе, команда и код выхода.
- [ ] (если шаг 2) Сначала падающий test: `test/unit/agent-options.test.ts` — Session в Project со списком
      НЕ получает plugin вне списка (до правки — получает, test красный).
- [ ] (если шаг 2) Schema принимает поле и его отсутствие, отвергает неверный тип — test по образцу
      `harness/bin/tests/review-depth.test.sh`, раздел 2.
- [ ] (если шаг 2) Session вне Project и Profile без поля работают как раньше — test-ы на оба случая.
- [ ] (если шаг 2) worfy не пишет в `~/.claude` и в репозиторий Project — test сравнивает деревья временных
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
