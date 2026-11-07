# 05 — Eval-ы переименованных skills и проверка на Stable copy

Type: task
Status: open
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 7; «Как работает» → «Документация, ADR, eval-ы»; «Риски», п. 2, 4

Не платформенный: случаи eval и запись прогона; платный прогон — на Mac владельца. Глубина ревью — `low`.

## Что происходит

- Eval-ы Harness — случаи `harness/evals/<case>/` (`case.yaml`, `prompt.md`, `graders/`, `scaffold.sh`), прогон
  `pnpm eval:harness` → `claude plugin eval` на учётной записи владельца (`scripts/eval-harness.mjs:1-4`). Не в CI и не
  в gate.
- Бюджет прогона — не выше `BUDGET_USD = 30` (`scripts/eval-harness.mjs:81`); `--max-cost-usd <x>` только снижает его;
  `--dry-run` печатает план вызовов и ничего не тратит.
- Plugin под test-ом — временная копия `harness/` (`scripts/eval-harness.mjs:13-15`): в прогоне стоит только `worfy`, без
  `mattpocock-skills`, так что случай видит только копии worfy.
- Случаев на skills Matt Pocock нет: Ticket 01 записал их файлы в `uncovered` (`harness/evals/lib/coverage.json`).

## Что делаем

1. Случаи eval (английский текст, tag `main`):
   - `skill-grilling-trigger` — просьба «grill me on this plan» → вызов Skill `worfy:grilling`, ни одного
     `mattpocock-skills:`;
   - `skill-wayfinder-refs` — `/worfy:wayfinder` на demo-проекте → вызовы `worfy:grilling` и `worfy:domain-modeling`;
     Ticket карты записан по `TICKETS.md` (`Type:`, `Status:` через `bin/ticket`, без `resolved`);
   - `skill-to-tickets-format` — `/worfy:to-tickets` → Ticket-ы в `tickets.root` с шапкой `TICKETS.md`, `epic-status`
     их читает без «old header»;
   - `skill-code-review` — `/worfy:code-review` с точки отсчёта → отчёт по двум осям (стандарты и spec).
2. `coverage.json`: файлы skills, которые покрыты, — в `cases`; остальные остаются в `uncovered` с причиной.
3. **Платный прогон** (разрешён заранее до 100 USD): сначала
   `pnpm eval:harness -- --dry-run --max-cost-usd 30 --case 'skill-*'` — план и бюджет в «Итог»; затем тот же вызов без
   `--dry-run`. Строки расхода по каждому вызову — в «Итог».
4. **Stable copy владельца** после merge 01–03 и Update: в списке slash-команд есть `/worfy:grilling` и
   `/worfy:code-review`; plugin `mattpocock-skills`, который владелец поставил сам до worfy, на месте (правило Q5, подтверждено владельцем 2026-11-07).

## Готово, когда

- [ ] Четыре случая в `harness/evals/`; `test/contract/harness-evals.test.ts` и
      `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
- [ ] Dry run: план вызовов и бюджет записаны в «Итог»; бюджет не выше 30 USD.
- [ ] Платный прогон: каждый случай проходит в большинстве run-ов; расход по вызовам и итог — в «Итог».
- [ ] (вручную) На Stable copy Mac: `/worfy:grilling` и `/worfy:code-review` в списке slash-команд поля ввода.
  - needs: mac stable
- [ ] (вручную) На Stable copy Mac после Update: `mattpocock-skills`, поставленный владельцем до worfy, не удалён.
  - needs: mac stable
- [ ] `pnpm lint`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Contract `test/contract/harness-evals.test.ts` — случаи и карта покрытия.
- Сначала падающий: grader `skill-grilling-trigger` красный на копии Harness без Ticket-а 01 (`HARNESS_DIR` на
  `main` до 01) — в dry run это видно по плану, в платном прогоне — по результату; если платить за красный прогон
  жалко, показать красный grader на записанном транскрипте.

## Где в коде

- `harness/evals/skill-grilling-trigger/**` (новый)
- `harness/evals/skill-wayfinder-refs/**` (новый)
- `harness/evals/skill-to-tickets-format/**` (новый)
- `harness/evals/skill-code-review/**` (новый)
- `harness/evals/lib/coverage.json`
- `test/contract/harness-evals.test.ts`
- `.scratch/worfy-skills/evidence/05-*` (новые)

Только читать: `scripts/eval-harness.mjs`, `scripts/eval-harness-coverage.mjs`, `harness/evals/lib/demo-project.sh`,
`harness/evals/status-block/` (образец случая).
