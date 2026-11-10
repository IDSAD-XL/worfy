# 04 — Skill `/worfy:pr-reply`, формат черновика, `review-draft-lint --reply`, action template `prReply`

Type: task
Status: claimed 2026-11-10T00:53Z
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Что видит пользователь», п. 4; «Как работает» → «Черновики ответов (Ticket 04; Q8)»;
«Риски» («Следы в Silent mode», «Публикация по ошибке»); «Ticket-ы», «Волны» (Wave 2); решения Q2, Q8;
[ADR-0105](../../../docs/adr/0105-pr-reply-only-on-the-users-click.md), пункты 3, 5, 6; spec
[worfy-human-review](../../worfy-human-review/spec.md), решения 8, 9

Платформенный Ticket: skill и скрипт Harness (`harness/skills/pr-reply/`, `harness/bin/review-draft-lint`) идут на Mac
и Windows; PR ждёт Windows verdict до merge (ADR-0056). Глубина ревью — `high`.

Ждёт Ticket 01: skill выходит вместе с guard-ом, который проверяет записи `gh api` на следы workflow. Ждёт Ticket 02:
оба правят `src/shared/projects/action-templates.ts` ([критика](../../../docs/product/critic/worfy-pr-inbox-2026-11-09.md),
возражение 1).

## Что происходит

- `harness/bin/review-draft-lint` (заголовок :1-38) проверяет только черновик review — payload
  `POST …/pulls/{number}/reviews` (`{ payload, tiers, body_tier }`): длина по tier-у, следы workflow
  (`harness/lib/workflow-traces.cjs`), подпись ИИ, личные данные (`harness/lib/privacy.cjs`), запрещённые слова.
- Запуск Session с первым сообщением из шаблона — `src/main/actions/launch.ts:10-17`; шаблоны и `ACTIONS` —
  `src/shared/projects/action-templates.ts:20`; IPC — `src/shared/ipc/actions.ts`.

## Что делаем

1. `harness/skills/pr-reply/SKILL.md` — `/worfy:pr-reply <owner>/<repo>#<N>`:
   1. читает `gh pr view`, diff и нерешённые нити (GraphQL), только чтение;
   2. по нити — метка (needs code change / needs answer / FYI / resolved by push), проверка утверждения по коду на
      head PR через `git show <sha>:<path>` (ветку не переключает: в `parallel: single` это main checkout), черновик;
      для своего PR и метки needs code change — `fixPlan`;
   3. голос — примеры Team reviewer-а, если есть `<Profile folder>/state/human-review/`; иначе `language.team`;
   4. `review-draft-lint --reply <file>` до exit 0;
   5. пишет `<Profile folder>/state/pr-inbox/drafts/<owner>-<repo>-<N>.json` (формат — spec, «Черновики ответов»).
   Текст skill-а запрещает публикацию: ни `gh api` записи, ни `gh pr comment|review`, ни resolve, ни push. В Session
   без человека — то же: только черновик.
2. `review-draft-lint --reply <draft.json> [--rules <lint.json>] [-C <dir>]` — формат черновика ответа: те же правила
   (следы workflow, подпись ИИ, личные данные, запрещённые слова), длина — одна граница на ответ. Находка называет
   `items[<i>]`. Режим review — как был, байт в байт.
3. Action template `prReply` (подпись `Draft replies`, по умолчанию `/worfy:pr-reply {repo}#{pr}`, новые placeholder-ы
   `repo`, `pr`); старый Harness без plugin — пустой шаблон, кнопка неактивна.
4. IPC `actions.prReply` (`project`, `write`): новая Session Node в checkout-е репозитория PR, Claude Code, с
   человеком; Autopilot его не вызывает. Кнопка в виде — Ticket 05.
5. Eval `harness/evals/pr-reply-*`: fixture-PR с тремя нитями — черновики в файле, ни одной записи на GitHub в журнале
   stub-а gh; черновик со следом workflow не проходит lint.

## Готово, когда

- [ ] Contract test: `review-draft-lint --reply` — чистый черновик exit 0; `<epic>/<NN>`, `ADR-<4 цифры>`, подпись
      ИИ, личные данные — exit 1 с `items[<i>]`.
  - evidence: test-run pass · `pnpm test` (test/contract/harness-review-draft-lint.test.ts, describe --reply) exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
- [ ] Contract test: режим review `review-draft-lint` — те же выходы, что до правки.
  - evidence: test-run pass · `pnpm test` (test/contract/harness-review-draft-lint.test.ts, review mode tests unchanged plus the empty-comment pin) exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
- [ ] Contract test: `actions.prReply` запускает Session с текстом шаблона; Autopilot и Linked machine с Read only
      получают отказ.
  - evidence: test-run pass · `pnpm test` (test/contract/actions.test.ts, describe actions.prReply) exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
- [ ] Eval `pr-reply-*` (dry run, затем платный под пределом из правил): черновики в файле, журнал stub-а gh — только
      чтение.
- [ ] Тексты `SKILL.md`: запрет публикации, путь черновика, шаг lint.
  - evidence: test-run pass · `pnpm test` (test/contract/harness-evals.test.ts, describe harness/evals: pr-reply) exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 на Mac.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
  - evidence: gate pass · `gate fast` exit 0 · mac - · f5f4554e0c1c3b2cf418c413eb8fa6c29aec7d20
- [ ] `test/contract/harness-review-draft-lint.test.ts` на Windows — exit 0.
  - needs: windows
- [ ] `ci-ok` на PR зелёный.

## Тесты

- Contract `test/contract/harness-review-draft-lint.test.ts`, `test/contract/actions.test.ts`; eval
  `harness/evals/pr-reply-*` (новые).
- Сначала падающий: `review-draft-lint --reply` на `main` — exit 2, флага нет.
- Ни настоящего GitHub, ни модели в test-ах: gh — stub через `WORFY_GH`, Session — fake agent (`WORFY_AGENT=fake`).
  Eval с моделью — отдельный шаг с dry run первым.
- Ничего не публикуется без щелчка: журнал stub-а gh после eval и contract test-ов не содержит ни одной записи.

## Где в коде

- `harness/skills/pr-reply/SKILL.md` (новый)
- `harness/bin/review-draft-lint`
- `src/shared/projects/action-templates.ts`
- `src/shared/ipc/actions.ts`
- `src/main/actions/launch.ts`
- `test/contract/harness-review-draft-lint.test.ts`
- `test/contract/actions.test.ts`
- `harness/evals/pr-reply-*` (новые)
