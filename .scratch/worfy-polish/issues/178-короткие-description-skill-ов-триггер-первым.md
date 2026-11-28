# 178 — Короткие `description` skill-ов Harness, триггер первым: список skill-ов в пределе 8 000 знаков

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 по worfy-harness-eval 06 (одноразовая статика SkillEvaluator по 35 skill-ам Harness,
PR #2350, «Итог», «Вопросы владельцу», вопрос 3: «да, сократить description, триггер первым»).

Кто: агент. Глубина review — `medium`. Не платформенный PR: frontmatter `SKILL.md` и contract test.

## Что происходит

- Claude Code и Codex кладут в контекст модели список skill-ов: имя и `description` каждого. Список имеет предел.
  SkillEvaluator 1.2.0 (`harness-check`, профили Claude Code 2.1.316 и Codex 0.166.0) дал всем 35 skill-ам
  `degraded`:
  - у 35 skill-ов 9 668 знаков `description`; список, когда окно модели неизвестно, вмещает 8 000;
  - `CC-LIST-BUDGET`: Claude Code укорачивает description. `CX-LIST-BUDGET`: Codex укорачивает, потом убирает
    description, потом выбрасывает skill-ы;
  - зависит от окна: при `--context-tokens 200000` Claude Code — degraded, Codex — loads; при `1000000` — оба loads;
  - skill-ы других plugin-ов той же сессии делят тот же предел; `harness-check` считает только `harness/skills/`.
- Пересчёт на origin/main `0bfb5e57d` (знаки значения `description` во frontmatter): 9 684. Из них:
  - 15 своих skill-ов — 6 668: `human-review-setup` 628, `ship-ticket` 608, `gate-queue` 548, `qmd` 514,
    `epic-wave` 475, `overnight-fix-loop` 463, `max-review` 460, `pr-fix` 446, `connect-project` 438, `owner-check` 429,
    `orchestrator-rules` 421, `tickets-to-tasks` 358, `product-ideas` 333, `continuous-audit` 279, `pr-reply` 268;
  - 20 скопированных skill-ов Matt Pocock — 3 016. Их файлы — копия 1.3.1 байт в байт, кроме правок из
    `harness/skills/THIRD_PARTY.md`. sha256 каждого файла закреплён в `test/contract/harness-third-party-skills.test.ts`
    (карта `UPSTREAM`).
- В description семи своих skill-ов есть плейсхолдеры в угловых скобках (`<folder>`, `<branch>`, `<epic>`):
  `connect-project`, `max-review`, `overnight-fix-loop`, `owner-check`, `pr-fix`, `pr-reply`, `ship-ticket`.
  SkillEvaluator Tier 1 дал на них High «description must not contain XML tags». Claude Code показывает их в списке
  skill-ов как `&lt;…&gt;`.
- Description, от которых зависят eval case-ы и test-ы (case без slash command-ы, модель выбирает skill по description):
  - `epic-wave`: `harness/bin/tests/epic-wave-ship-ticket.test.sh:80-86` требует в description четыре формы —
    «tickets NN, NN of epic X» первой, потом «Ticket-ы NN, NN эпика X», «волна N эпика X», «run wave N of epic X».
    Case `epic-wave-old-form` даёт модели «Ticket-ы 02, 04 эпика demo» без slash command-ы;
  - `product-ideas`: case `product-ideas` даёт «What should demo do after epic demo? Give me some ideas». Test
    `test/contract/harness-evals.test.ts:449-454` требует description длиннее 40 знаков и без
    `disable-model-invocation`;
  - `grilling` (скопированный): case `skill-grilling-trigger` — «Grill me on this plan».
  Остальные case-ы зовут skill slash command-ой (`/worfy:pr-fix …`, `/worfy:code-review …`), от description не зависят.
- worfy-harness-eval 14 (матрица срабатывания 22 skill-ов: 2 фразы «должен», 1 «не должен», open) будет мерить
  срабатывание по description; эта правка — её вход.

## Что строить

1. Цель: сумма `description` всех 35 skill-ов ≤ 6 000 знаков. Она опирается на spike: предел списка — 8 000 знаков,
   когда окно неизвестно. Запас ~2 000 — на skill-ы других plugin-ов в той же сессии, их `harness-check` не считает.
   Отдельного предела на один skill spike не даёт. Предел 300 на skill сам не хватит: 13 своих skill-ов длиннее 300 с
   пределом 300 дали бы в сумме 7 463.
2. Скопированные 20 skill-ов не трогать (см. вопрос ниже). Тогда 15 своих вместе ≤ 2 980 знаков, в среднем ~200.
3. Каждый новый description своего skill-а:
   - первым — триггер: что говорит пользователь или когда skill нужен («Use when …», команда, фраза);
   - потом — что skill делает, одной фразой;
   - без угловых скобок `<…>`: вместо `<owner>/<repo>#<N>` — `owner/repo#N` или слова;
   - сохраняет фразы, от которых зависят case-ы и test-ы (см. «Что происходит»); у `epic-wave` — четыре формы в том же
     порядке;
   - детали (откуда profile, какие команды, Silent mode) остаются в теле `SKILL.md`, не в description.
4. Contract test в `test/contract/harness-plugin.test.ts`:
   - сумма description `harness/skills/*/SKILL.md` ≤ 6 000 знаков;
   - в description своих skill-ов (не из `THIRD_PARTY.md`) нет `<` и `>`.
5. Есть ли в списке skill-ов Claude Code и Codex description skill-ов с `disable-model-invocation: true` (13 skill-ов,
   2 из них свои), spike не проверял: `harness-check` считает все 35. Цель 1 тоже считает все 35. Если docs Claude
   Code или Codex говорят, что такие description в список не идут, — записать это с источником в «Итог»; цель не
   меняется.

Вопрос владельцу (в «Итог», работу не держит): сокращать ли description и 20 скопированных skill-ов? Это правка
копии: запись в `THIRD_PARTY.md` и новые sha256 в `harness-third-party-skills.test.ts`. Без ответа копия не меняется;
цель 1 достижима и так.

## Где в коде

- `harness/skills/*/SKILL.md` 15 своих skill-ов — строка `description:` frontmatter-а.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh:80-86`, `test/contract/harness-evals.test.ts:449-454` — фразы, которые
  нельзя потерять.
- `harness/skills/THIRD_PARTY.md` — какие 20 skill-ов скопированы.
- `test/contract/harness-plugin.test.ts` — новый test.

## Test-ы

- Новый test суммы и угловых скобок — красный до правки (9 684 > 6 000; семь description с `<…>`), зелёный после.
- `bash harness/bin/tests/epic-wave-ship-ticket.test.sh`, `bash harness/bin/tests/plugin-neutral.test.sh`,
  `bash harness/bin/tests/agents-text.test.sh` — exit 0.
- `test/contract/harness-evals.test.ts`, `harness-evals-run.test.ts`, `harness-third-party-skills.test.ts`,
  `harness-human-review-setup.test.ts`, `codex-compat.test.ts` — зелёные.
- Eval — по `~/.claude/worfy-harness/projects/worfy/rules-merge.md` («Платный `eval --changed` перед мержем PR с
  правками правил Harness — только с одобрения владельца на этот PR»):
  - `pnpm eval:harness -- --changed origin/main --dry-run` бесплатно — exit 0, план в описании PR. Правка 15 своих
    `SKILL.md` выберет 16 case-ов: `epic-wave-old-form`, `epic-wave-tickets`, `reviewer-verdict`,
    `human-review-setup-full`, `human-review-setup-refresh-declined`, `human-review-setup-short-history`,
    `no-os-screen-capture`, `ship-ticket-local-green`, `ship-ticket-pr-green-ci`, `pr-fix-checks`, `pr-fix-comments`,
    `pr-fix-conflicts`, `pr-fix-conflicts-silent`, `pr-reply-guards`, `pr-reply-three-threads`, `product-ideas`;
  - платный run без «да» владельца на этот PR не запускается;
  - описание PR называет полным run-ом этой правки worfy-harness-eval 05 (точка отсчёта: первый полный run 28 case-ов).
- SkillEvaluator: `harness-check` по 35 skill-ам без `--context-tokens`, в окружении, как в worfy-harness-eval 06 (venv
  из `mktemp -d`, без extra `llm`, `env -i`, `--no-llm`; удалить после) — без `CC-LIST-BUDGET` и `CX-LIST-BUDGET`.
  Модель не вызывается.

## Готово, когда

- [ ] Сумма description 35 skill-ов ≤ 6 000 знаков; до и после, по skill-ам, и команда счёта — в «Итог».
- [ ] Description каждого своего skill-а начинается с триггера и без `<…>`; фразы case-ов `epic-wave-old-form` и
      `product-ideas` и четыре формы `epic-wave` на месте.
- [ ] Contract test суммы и угловых скобок есть, красный до правки, зелёный после.
- [ ] `harness-check` по 35 skill-ам — без `CC-LIST-BUDGET` и `CX-LIST-BUDGET`; exit code и вывод — в «Итог».
- [ ] `pnpm eval:harness -- --changed origin/main --dry-run` — exit 0, план в описании PR; описание PR называет
      worfy-harness-eval 05 полным run-ом; платного run-а без «да» владельца нет.
- [ ] Вопрос о 20 скопированных skill-ах — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
