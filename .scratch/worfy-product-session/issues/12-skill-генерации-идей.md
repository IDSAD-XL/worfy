# 12 — Skill генерации идей `worfy:product-ideas`

Type: task
Status: done 2026-11-08T09:12Z
PR: #1658
Blocked by: 04
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 8, 9; «Решено без владельца», п. 5; карта [worfy-product](../../worfy-product/map.md), решение 08 (Q2, Q3); [оценка идей PR #1580](../../../docs/research/2026-11-07-оценка-идей-pr-1580.md), раздел 8.3 (работы советника и их входы)

**Ждёт Epic `worfy-skills` целиком:** skill живёт рядом со скопированными skills и ссылается на `worfy:research`.

Не платформенный Ticket: skill и eval. Глубина ревью — `medium`.

## Что происходит

- Skills worfy — `harness/skills/<имя>/SKILL.md`; после `worfy-skills` там же skills Matt Pocock.
- Tools Mind map — `mind_map_add`, `mind_map_decide` (Ticket 04).
- Входы советника, которые worfy правда читает: файлы Project-а (roadmap, spec-и, ADR, Ticket-ы), GitHub через `gh`,
  поиск в сети (оценка PR #1580, 8.3).

## Что делаем

1. `harness/skills/product-ideas/SKILL.md` (английский): вызов моделью по просьбе владельца («идеи», «что дальше»).
2. Шаги:
   - прочитать roadmap, принятые и черновые spec-и, открытые Ticket-ы и Mind map темы;
   - дать 3–5 идей; у каждой: для кого, почему сейчас, грубая цена в Ticket-ах, как проверить, что сработало;
   - хотя бы одна идея идёт против текущего roadmap — и говорит, против какого пункта;
   - каждая идея — узел `mind_map_add` вида Идея с `advice: true` и `from` — узел или Ticket карты, из которого она
     выросла;
   - сказать вслух, чего советник не знает (аналитики продукта нет).
3. Не писать черновик Epic-а без «да» владельца по идее.
4. Eval `harness/evals/product-ideas/`: на fixture-roadmap ответ даёт 3–5 идей со всеми четырьмя полями и хотя бы
   одну против roadmap. Платный прогон: сначала `--dry-run`, cap ниже 100 USD.

## Готово, когда

- [ ] `harness/skills/product-ideas/SKILL.md` есть; test-ы plugin-а зелёные (имя, frontmatter, ссылки `worfy:`).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-evals.test.ts test/contract/harness-evals-run.test.ts test/contract/harness-plugin.test.ts test/contract/harness-third-party-skills.test.ts test/contract/harness-migrate.test.ts` exit 0 · mac - · 928ebab4c7022d2cc498edaf2af6603c5ffab2be
  - evidence: review pass · PR #1658 · - - · 51a852893a3528245ffc696b00568acd4ca9e367
- [ ] Eval `product-ideas`: dry run exit 0; платный прогон прошёл, расход записан в «Итог».
  - evidence: test-run pass · `node scripts/eval-harness.mjs --case product-ideas --max-cost-usd 10` exit 0, 3 of 3 runs, 0.68 USD; `--dry-run --changed origin/main` exit 0 · mac - · 928ebab4c7022d2cc498edaf2af6603c5ffab2be
  - evidence: review pass · PR #1658 · - - · 51a852893a3528245ffc696b00568acd4ca9e367
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 928ebab4c7022d2cc498edaf2af6603c5ffab2be
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42463593301/job/128685702663 · ci - · 51a852893a3528245ffc696b00568acd4ca9e367

## Тесты

- Contract `test/contract/harness-plugin.test.ts`, `test/contract/harness-evals.test.ts`.
- Eval `harness/evals/product-ideas/` (новый), запись в `harness/evals/lib/coverage.json`.
- Сначала падающий: случай eval до появления skill-а.

## Где в коде

- `harness/skills/product-ideas/**` (новый)
- `harness/evals/product-ideas/**` (новый)
- `harness/evals/lib/coverage.json`

Только читать: `harness/skills/research/SKILL.md`, `src/shared/product/tools.ts`, `docs/roadmap.md`.

## Итог

- Skill `harness/skills/product-ideas/SKILL.md`: модель зовёт его по просьбе владельца («идеи», «что дальше»). Он
  читает roadmap, spec-и, открытые Ticket-ы и тему, даёт 3–5 идей в одном формате (`### Idea <N>:`, поля `For whom:`,
  `Why now:`, `Cost:`, `How we will know it worked:`, `Grew from:`, у идеи против roadmap — `Against the roadmap:`),
  кладёт каждую в Mind map через `mind_map_add` (`kind: idea`, `advice: true`, `from`), говорит, чего не знает, и не
  пишет черновик Epic-а без «да» владельца. Без tools `mind_map_*` идеи остаются в ответе.
- Eval `harness/evals/product-ideas/`: fixture — проект demo с `docs/roadmap.md` и темой `docs/product/growth/`, без
  сервера `worfy-mind-map`; 8 grader-ов (вызов skill-а, чтение roadmap, нет `worfy:to-spec`, 3–5 идей, четыре поля, строка
  против roadmap, llm judge).
- Платный прогон 2026-11-08: `node scripts/eval-harness.mjs --case product-ideas --max-cost-usd 10` — exit 0,
  casesPassed 1 of 1, overallScore 1, 3 run-а из 3, **расход 0.68 USD**, claude 2.1.289. Dry run
  `--dry-run --changed origin/main` — exit 0.
