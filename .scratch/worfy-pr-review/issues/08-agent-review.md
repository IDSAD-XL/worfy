# 08 — Agent review: Session с Team reviewer-ом или линзами пишет весь черновик ревью через `bin/pr-review-draft`; канал запуска и остановки

Type: task
Status: open
Blocked by: 06, 07
Source: [spec.md](../spec.md), «Ticket-ы», 8; «Решение», 6; «Как пользователь идёт по экрану», E; «Решения по
реализации», 6, 8 и 11; «Решения по test-ам»; «Вопросы владельцу», Q4 и требование владельца 2026-11-20;
[critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md), возражение 3

Кто: агент.

Платформенный Ticket: новый `harness/bin/pr-review-draft` и правка skill-ов в `harness/skills/` — платформенный PR
(ADR-0056), вердикт Windows — job-ы Windows в CI. Глубина ревью — `high`: запрет записи на GitHub держат только текст
skill-а, guard hook и eval.

## Что происходит

- Требование владельца 2026-11-20: «должен быть выбор какое ревью делать, обычное ллмкой или human-review». Agent review
  — один из двух способов ревью, не «первый проход» в конце Epic-а; Ticket идёт сразу после черновика (07) и diff-а PR
  (06). Выбор способа — кнопка Start review в Ticket-е 09; этот Ticket даёт канал, который она вызывает.
- Детали — «Решено без владельца по его требованию 2026-11-20, подтвердить» (spec, «Решение», пункт 6): вердикт агента
  — только подсказка; агент меняет только свои записи; Take over останавливает Session.
- Draft replies уже запускает Session со skill-ом Harness, который пишет только в локальный файл через
  `harness/bin/pr-reply-draft` (`src/shared/projects/action-templates.ts:32`, `harness/skills/pr-reply/SKILL.md:12-19`);
  записи `gh api` в PR ловит `harness/hooks/guard.mjs` (ADR-0105, пункт 5).
- Team reviewer — частный skill `/human-review` Project-а из шаблона `harness/skills/human-review-setup/template/
  SKILL.template.md` (ADR-0102); без него — линзы `/worfy:code-review` (`harness/skills/code-review/SKILL.md`).
- Возражение 3 critic-а (принято владельцем): test гонки main и `bin/pr-review-draft` — здесь.

## Что делаем

1. `harness/bin/pr-review-draft` (новый, английский): `comment <path> <line> [--side] [--start-line] <text>`,
   `summary <text>` (только если итоговый текст пустой или написан агентом), `verdict <comment|approve|request_changes>`
   (`suggestedEvent`), `done`. Пишет через временный файл и rename; меняет только записи `by: 'agent'`; отказ, если
   черновика нет или он `submitting` / `submitted`.
2. Action template «Agent review» рядом с Draft replies (`src/shared/projects/action-templates.ts`): `/human-review
   {repo}#{pr}`, если у Project-а есть Team reviewer, иначе `/worfy:code-review` над PR с линзами Profile-а; Vendor —
   Claude Code.
3. Канал `prReview.agentReview` (`'local'`, `{ repo, pr, fill: 'new'|'add' }`) в `src/main/github/pr-review-agent.ts`
   (новый): создаёт черновик, если его нет, ставит `agent: { sessionId, state: 'writing' }`, запускает Session Node
   (`src/main/actions/launch.ts`). `fill: 'add'` — Ask the agent to add comments к черновику человека. Канал
   `prReview.stopAgent` — Stop и Take over: Session остановлена, `state: 'stopped'`, записи агента остаются.
4. Пока Session пишет, main следит за файлом черновика и шлёт `prReview.changed`; watch закрывается только через
   `src/main/chokidar-close.ts`.
5. Раздел «When worfy runs you for Agent review» в шаблоне Team reviewer-а и в `/worfy:code-review`: черновик — только
   через `bin/pr-review-draft`; вердикт — только предложение; на GitHub — ничего. Уже собранные Team reviewer-ы
   получают раздел при Refresh (`harness/skills/human-review-setup/refresh.md`); до него правило идёт в тексте шаблона
   action-а.
6. Eval `harness/evals/agent-review-guards/` (новый, по образцу `harness/evals/pr-reply-guards/`): skill не вызывает
   записей на GitHub и пишет черновик только через `bin/pr-review-draft`.

## Готово, когда

- [ ] Contract `test/contract/harness-pr-review-draft.test.ts` (новый, по образцу
      `test/contract/harness-pr-reply-draft.test.ts`): `comment`, `summary`, `verdict`, `done`; не трогает записи
      `by: 'person'` и итоговый текст человека; отказ на `submitting` / `submitted` и без черновика. Красный до правки —
      в «Итог».
- [ ] Тот же contract — test гонки: main (`prReview.saveComment` Ticket-а 07) и `bin/pr-review-draft` пишут в один файл
      одновременно 200 раз; ни одна запись не потеряна, файл всегда разбирается.
- [ ] Contract `test/contract/pr-review-agent.test.ts` (новый) на `WORFY_AGENT=fake`: `prReview.agentReview` запускает
      Session с `/human-review …` при Team reviewer-е и с `/worfy:code-review` без него; `fill: 'add'`;
      `prReview.stopAgent`; `prReview.changed` при записи; отказ Linked machine.
- [ ] `test/unit/action-templates.test.ts`: шаблон «Agent review» и его Vendor.
- [ ] Eval `harness/evals/agent-review-guards/` — pass; результат и цена — в «Итог».
- [ ] `harness/bin/tests/agents-text.test.sh`: текст раздела держит «только через `bin/pr-review-draft`» и «вердикт —
      только предложение»; mutant (фраза убрана) — красный. `test/contract/codex-parity.test.ts` зелёный.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).

## Где в коде

- `harness/bin/pr-review-draft` (новый)
- `harness/skills/human-review-setup/template/SKILL.template.md`, `harness/skills/human-review-setup/refresh.md`
- `harness/skills/code-review/SKILL.md`
- `harness/evals/agent-review-guards/` (новый)
- `src/shared/projects/action-templates.ts`, `src/main/actions/launch.ts`
- `src/main/github/pr-review-agent.ts` (новый), `src/shared/ipc/pr-review.ts`, `src/main/ipc/pr-review.ts`
- `test/contract/harness-pr-review-draft.test.ts` (новый), `test/contract/pr-review-agent.test.ts` (новый),
  `test/unit/action-templates.test.ts`, `harness/bin/tests/agents-text.test.sh`

Только читать: `harness/bin/pr-reply-draft`, `harness/skills/pr-reply/SKILL.md`, `harness/hooks/guard.mjs`,
`src/main/github/pr-review-draft.ts` (Ticket 07), `src/main/chokidar-close.ts`, `docs/adr/0102-private-project-skills-in-profile-folder.md`.

## Вне скоупа

- Меню Start review, Ask the agent to add comments и Take over в UI — Ticket 09; пометка «Written by the agent» на
  строке — Ticket 10; «The agent suggests» в диалоге — Ticket 11. Отправка ревью агентом — никогда.
