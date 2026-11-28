# 05: guard: merge только через `land`

Type: task
Status: open
Blocked by: 04, 06
Source: [spec.md](../spec.md), «Ticket-ы», 05; «Решение», 2; «Набросок функции» (шаг 5, схема решения guard-а);
«Решения по реализации» («guard: merge и история main branch»); «Решения по test-ам», «Сначала падающий test», 05,
«Mutation testing» и «Windows»; «Риски» («Сбой guard открывает проход»); «Вопросы владельцу», Q5 (а); «Волны», Wave 5;
[critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md), «Alternative» (05 — последним)

Кто: агент. Глубина ревью — `max`; reviewer делает mutation testing: убирает каждое правило deny в отдельной копии
репозитория, хотя бы один test краснеет.

Платформенный PR (ADR-0056, пункт 2): hook Harness, разбор команд в Git Bash; до merge нужен Windows verdict.

## Что происходит

- «Merge только через `bin/land`, без `gh pr merge` руками» (`harness/skills/epic-wave/SKILL.md:1244`) и «Do not
  merge» implementer-а (`harness/agents/implementer.md:94`) — текст.
- guard разбирает `gh` — `ghCommand` (`harness/hooks/guard.mjs:609`), `GH_API_WRITES` (`:626`), `ghApi` (`:643`) — но
  только ради следов workflow в Silent mode (раздел 3, `:235`). В Project-е Full mode `gh pr merge --admin` проходит.
- Отметки `review` и `check/*` — обычный commit status. Тот же `gh api … statuses/<sha>`, что делает `land`
  (`harness/bin/land:417`), может вызвать любая Session: hook `harness/hooks/gh-token-env.mjs` даёт каждому Bash
  `GH_TOKEN` аккаунта Profile-а.
- По Q5 (а) сторона GitHub не меняется: обязателен только `ci-ok`; держат guard и `land`.

## Что строить

Новый раздел guard-а — в каждом Project-е с Profile-ем и в любом permission mode. Без Profile-а (незарегистрированная
папка) раздел молчит, как раздел 3.

- `gh pr merge <N>`: guard зовёт `land --check <N>` (Ticket 04) с бюджетом внутри лимита hook-а 30 s
  (`harness/hooks/hooks.json:192`). Exit 0 — пропуск; 1 — отказ с причиной `land`; 2 или нет ответа вовремя — отказ
  «run land»: для merge guard при сбое закрыт.
- Всегда отказ:
  - `gh pr merge` с `--admin` или `--auto`;
  - `gh api` PUT `…/pulls/<N>/merge`; GraphQL `mergePullRequest` и `enablePullRequestAutoMerge`;
  - `git push` в main branch (`worktree.base`) или её удаление; force push без lease, `--mirror`, `--all`.
- Push с `--force-with-lease=<ветка>:<sha>` в ветку PR проходит: skill велит так делать после rebase
  (`SKILL.md:968`).
- `gh api …/statuses/<sha>` с context `review`, `check/*`, `deploy` или `owner` — отказ любой Session агента;
  `ticket mark … owner` — тоже. Commit status `owner` пишет только worfy по кнопке владельца (Ticket 10).
- `workflow.merge: null` (сливают люди) — любой merge агента отказан.
- `land` сам зовёт `gh` из node (`land:818`): hook этого не видит, путь через `land` открыт.
- Отказ — через `deny()` Ticket-а 03 (строка в `WORFY_GUARD_LOG`, id правила `merge-outside-land` и подобные — имена
  предложение).
- Case contract set-а (Ticket 08): `gh pr merge 1 --admin` отказан (gh — stub).

## Где в коде

- `harness/hooks/guard.mjs` — новый раздел merge, `ghCommand` `:609`, `GH_API_WRITES` `:626`, `ghApi` `:643`, бюджет
  попыток `:249-257`
- `harness/hooks/tests/guard-merge.test.sh` (новый, имя — предложение)
- `src/main/harness/contract/` (Ticket 08) — case merge
- `harness/agents/implementer.md` — `:94` (отказ называет текст)
- Только читать: `harness/bin/land` (`--check`, Ticket 04), `harness/skills/epic-wave/SKILL.md` (`:968`, `:1244`),
  `harness/hooks/gh-token-env.mjs`

## Test-ы

- Shell test-ы на JSON PreToolUse, `land` — stub:
  - `gh pr merge 1 --admin` в Project-е Full mode — deny (сначала падающий test: сегодня проходит);
  - `gh pr merge 1` при `land --check` exit 0 — allow; exit 1 — deny с причиной; exit 2 и timeout — deny «run land»;
  - `--auto`, `gh api -X PUT repos/o/r/pulls/1/merge`, GraphQL `mergePullRequest` и `enablePullRequestAutoMerge` — deny;
  - `git push origin HEAD:main`, `git push origin :main`, `git push --force`, `--mirror`, `--all` — deny;
    `git push --force-with-lease=feature:abc123 origin HEAD:feature` — allow;
  - `gh api repos/o/r/statuses/<sha> -f context=review` (и `check/x`, `deploy`, `owner`) — deny; `ticket mark … owner` —
    deny;
  - `workflow.merge: null` — любой merge deny; папка без Profile-а — раздел молчит.
- Windows: тот же shell test в Git Bash на ПК в CI.
- Без моделей и без сети.

## Готово, когда

- [ ] `gh pr merge` агента проходит, только когда `land --check` говорит «готов»; без ответа вовремя — отказ «run land»
      (shell test-ы).
- [ ] `--admin`, `--auto`, merge через REST и GraphQL, auto-merge, push в main branch и её удаление, force push без
      lease отказаны в любом permission mode; lease в ветку PR проходит (shell test-ы, `--admin` красный на старом
      коде).
- [ ] Запись статусов `review`, `check/*`, `deploy`, `owner` и `ticket mark … owner` отказаны любой Session агента.
- [ ] `workflow.merge: null` — любой merge агента отказан; без Profile-а раздел молчит.
- [ ] Contract set Ticket-а 08 получил case merge.
- [ ] Mutation testing reviewer-а: снятие каждого нового правила deny краснит хотя бы один test.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
