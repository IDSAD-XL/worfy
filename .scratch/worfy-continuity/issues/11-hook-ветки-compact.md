# 11 — Harness: hook ветки `compact` возвращает агенту состояние

Type: task
Status: claimed 2026-11-18T04:15Z
Blocked by: 01, 10
Source: [spec.md](../spec.md), «Ticket-ы», 11; «Решения по реализации» → «Compaction», пункт «Hook ветки `compact` (11)»;
«Решения по test-ам», Harness; «Риски», 11, 12, 13

Кто: агент.

Платформенный PR (ADR-0056, пункт 2): новый hook и скрипт Harness. Глубина ревью — `high`.

## Что происходит

- В `harness/hooks/hooks.json` `SessionStart` стоит без matcher-а (`:4–7`). `harness/hooks/inject-rules.mjs` и
  `harness/hooks/session-start.mjs` на `source` не смотрят и после compaction вставляют то же, что при старте: правила
  роли, а не Ticket, Wave и решения.
- Codex знает hook `sessionStart` (`src/main/vendors/codex/harness-hooks.ts:51–66`).
- `wave-brief` укладывается только в 11 000 байт (`harness/bin/wave-brief:46`), а Claude Code режет кусок
  `additionalContext` после 10 000 знаков (`harness/hooks/inject-rules.mjs:29–30`).
- Hook может не видеть окружения Session (тот же риск записан для `WORFY_SESSION_KIND`, `inject-rules.mjs:13`).
- Приходит ли `SessionStart` с `source: 'compact'` в Subagent-е, отвечает spike 01 (вопрос 1).

## Что делаем

1. `harness/hooks/after-compact.mjs` на `SessionStart` с matcher-ом `compact` (у Codex — `sessionStart`) возвращает
   `additionalContext`:
   - Orchestrator-у — вывод `wave-brief <epic>`; Epic — из `WORFY_EPIC` (Ticket 12), иначе из ветки, иначе первый из
     «Epics in play» (`harness/hooks/stage-lines.mjs`);
   - implementer-у — файл его Ticket-а и `git status --short` его worktree.
2. Предел: Stage-строка, Ticket-ы в работе и открытые PR — первыми, остальное режется до 10 000 знаков.
3. Вне worfy и без Ticket-а hook молчит.
4. Если spike показал, что в Subagent-е hook не срабатывает, — так и записать в «Итог»; тогда implementer-а держит
   запасная строка `common.md` (Ticket 10).
5. Английская страница `docs/features/skills-agents-and-hooks.md`: hook ветки `compact`; перевод — Ticket 14.

## Готово, когда

- [ ] `harness/hooks/tests/session-hooks.test.sh`: ветка `compact` — Orchestrator получает `wave-brief`; implementer —
      свой Ticket и `git status`; вне worfy hook молчит; обычный старт (`source: startup`) не меняется.
  - evidence: test-run pass · `bash harness/hooks/tests/session-hooks.test.sh` exit 0 · mac - · 5050b0bf04ec9df4817e6f952c95b0b891ccff96
- [ ] Shell test: Epic из ветки, когда `WORFY_EPIC` нет; вывод длиннее предела режется, Stage-строка остаётся.
  - evidence: test-run pass · `bash harness/hooks/tests/session-hooks.test.sh` exit 0 · mac - · 5050b0bf04ec9df4817e6f952c95b0b891ccff96
- [ ] Shell test: Codex `sessionStart` с compaction даёт тот же вывод.
  - evidence: test-run pass · `bash harness/hooks/tests/session-hooks.test.sh` exit 0 · mac - · 5050b0bf04ec9df4817e6f952c95b0b891ccff96
- [ ] Английская страница `skills-agents-and-hooks.md` называет hook ветки `compact`.
  - evidence: commit pass · harness: SessionStart hook of the compact branch hands the agent its state back · - - · 5050b0bf04ec9df4817e6f952c95b0b891ccff96
- [ ] Платформенный PR (ADR-0056, пункт 2; ADR-0071): job Windows в составе `ci-ok` зелёный на head PR до merge.
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- `harness/hooks/tests/session-hooks.test.sh`. Каждый test сначала красный.

## Где в коде

- `harness/hooks/after-compact.mjs` (новый)
- `harness/hooks/hooks.json`
- `harness/hooks/tests/session-hooks.test.sh`
- `src/main/vendors/codex/harness-hooks.ts` (если Codex-hook надо зарегистрировать)
- `docs/features/skills-agents-and-hooks.md`

Только читать: `harness/hooks/stage-lines.mjs`, `harness/bin/wave-brief`, `harness/hooks/inject-rules.mjs`, «Итог»
Ticket-а 01.

## Вне скоупа

- `WORFY_EPIC` в окружении Session — Ticket 12; eval — Ticket 13.
