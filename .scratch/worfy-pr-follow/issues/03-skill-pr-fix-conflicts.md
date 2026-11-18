# 03 — Skill `/worfy:pr-fix`: режим `conflicts` — rebase и `--force-with-lease` в Full mode, merge commit в Silent mode

Type: task
Status: claimed 2026-11-18T16:35Z
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решения по реализации», 2; «Вопросы владельцу», Q3 и Q4 (решено без
владельца, подтвердить); «Решено без владельца», 6; «Риски», «Force-push»

Кто: агент.

Не платформенный Ticket (текст skill-а Harness и eval-кейс, без скриптов и веток по платформе). Глубина ревью —
`medium`; force-push — разрушающее действие, его сторожит явный eval в обоих режимах.

## Что происходит

- После Ticket-а 02 skill `pr-fix` отвечает на `conflicts` «not supported yet».
- Wave сегодня на конфликт делает rebase: `DIRTY — conflict, rebase` (`harness/skills/epic-wave/SKILL.md:920`); rebase
  всегда делает implementer в своём worktree (`:910`).
- GitHub не создаёт CI run для PR в `DIRTY` (`harness/skills/ship-ticket/step-8-pr-and-ci.md:112-113`).
- Режим проекта — Full или Silent — даёт поле `mode` Profile-а (`bin/profile --field mode`); Silent mode — командный репозиторий, где
  историю ветки мог взять коллега (`harness/skills/ship-ticket/silent-mode.md`).
- Responder Kiro никогда не делает rebase и force-push (spec, «Как это сделано у конкурентов»).

## Что делаем

1. Режим `conflicts` в `harness/skills/pr-fix/SKILL.md`:
   1. `git merge-tree` ветки PR и базы — назвать файлы конфликта до любой правки.
   2. Full mode: rebase на базу в worktree ветки PR, разрешение конфликтов, локальные проверки. Вопрос о push
      называет `--force-with-lease` явно: «Force-push (with lease) N commits to <branch>?». Push — только
      `git push --force-with-lease=<branch>:<head до rebase>`, никогда голый `--force`.
   3. Silent mode: merge базы в ветку PR обычным merge commit, без rebase и без force-push; вопрос «Push N commits to
      <branch>?».
   4. Конфликт, который нельзя разрешить без решения о дизайне или объёме, — спросить человека, ничего не пушить.
   5. «Not now» — rebase или merge остаётся в worktree; отчёт говорит, где, и как отменить (`git reset` в этом
      worktree, не в checkout человека).
2. Eval `harness/evals/pr-fix-conflicts` (Full и Silent на scaffold-репозитории с конфликтом), запись в
   `harness/evals/lib/coverage.json`. Запуск руками: сначала `scripts/eval-harness.mjs --dry-run`, затем с
   `--max-cost-usd 3` на вызов; цена — в «Итог».
3. Английские страницы: строка `pr-fix` в `docs/features/skills-agents-and-hooks.md` — режим `conflicts` и политика по
   режиму; число eval-кейсов в `docs/features/harness.md:449`. Перевод — Ticket 06.

## Готово, когда

- [ ] Eval `pr-fix-conflicts`, Full mode: rebase в worktree; вопрос о push называет `--force-with-lease`; на «Not now» —
      ни одного `git push`; на «Push» — только `--force-with-lease`, ни одного `--force` без lease.
- [ ] Eval `pr-fix-conflicts`, Silent mode: merge commit, ни одного rebase и force-push; checkout человека не тронут.
- [ ] Числа eval-а (pass и цена) — в «Итог» Ticket-а.
- [ ] `harness/evals/lib/coverage.json` называет кейс; contract test-ы evals зелёные.
  - evidence: test-run pass · `vitest run test/contract/harness-evals*.test.ts test/contract/harness-migrate.test.ts` exit 0 (coverage map: test/contract/harness-evals-run.test.ts:635) · mac - · 833915dadd659d33ec322bedd53ffdb23b389232
- [ ] Английские страницы `docs/features/skills-agents-and-hooks.md` и `docs/features/harness.md` описывают режим.
  - evidence: commit pass · worfy-pr-follow/03: pr-fix mode conflicts, rebase with lease in Full mode, merge commit in Silent mode, evals · - - · b8eddf74b
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 833915dadd659d33ec322bedd53ffdb23b389232

## Где в коде

- `harness/skills/pr-fix/SKILL.md`
- `harness/evals/pr-fix-conflicts/` (новый)
- `harness/evals/lib/coverage.json`
- `docs/features/skills-agents-and-hooks.md`, `docs/features/harness.md`

Только читать: `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/silent-mode.md`,
`harness/skills/ship-ticket/step-8-pr-and-ci.md`.

## Вне скоупа

- Abort rebase и Abort merge отдельными кнопками (как у Orca) — нет; отмена — словами отчёта.
- Перенос коммитов человека, которые пришли в ветку после `<sha>`: skill спрашивает, а не решает.

## Итог

- Режим `conflicts` skill-а `pr-fix`: `git merge-tree` называет файлы конфликта до правки, без конфликта skill ничего не
  меняет. Full mode — rebase в worktree и push только `--force-with-lease=<branch>:<head до rebase>`; Silent mode —
  merge commit (`--cleanup=strip`), без rebase и force-push. Кейсы `pr-fix-conflicts` (Full mode) и
  `pr-fix-conflicts-silent`, PR #2011.
- Платный eval на 6f0f63a98, 2 run-а на кейс, потолок 3 USD на кейс: `pr-fix-checks` 1.00 (0.80 USD),
  `pr-fix-comments` 1.00 (1.20 USD), `pr-fix-conflicts` 0.96 (0.75 USD; судья ответа разделился 2:1 в обоих run-ах),
  `pr-fix-conflicts-silent` 1.00 (0.83 USD); всего 3.58 USD.
- Решено без владельца (подтвердить): ветку «Push» ни один eval не достаёт. В прогоне нет человека для
  AskUserQuestion, а «Push», написанный в prompt заранее, skill по правилу ответом не считает. Поэтому пункт 1 «Готово,
  когда» проверяется двумя частями: что без ответа «Push» ничего не уходит — eval-ом (`no-publish-command`,
  `nothing-published`); что push после rebase идёт только с lease и lease отказывает, когда ветку сдвинули, — contract
  test-ом, который запускает строку push из SKILL.md в настоящем git (`test/contract/harness-evals.test.ts`,
  «conflicts in Full mode, a run as SKILL.md says»).
- Один кейс на оба режима не вышел: у кейса один prompt и один scaffold, а режим — поле Profile-а. Поэтому кейсов два.
