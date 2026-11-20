# 08 — Agent review: Session с Team reviewer-ом или линзами пишет весь черновик ревью через `bin/pr-review-draft`; канал запуска и остановки

Type: task
Status: claimed 2026-11-20T09:12Z
PR: #2085
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
  - evidence: test-run pass · `pnpm test test/contract/harness-pr-review-draft.test.ts` exit 0 (10 tests) · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
- [ ] Тот же contract — test гонки: main (`prReview.saveComment` Ticket-а 07) и `bin/pr-review-draft` пишут в один файл
      одновременно 200 раз; ни одна запись не потеряна, файл всегда разбирается.
  - evidence: test-run pass · `pnpm test test/contract/harness-pr-review-draft.test.ts` exit 0 (races main: 200 + 200 writes; quit lock: own, other, stale) · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
- [ ] Contract `test/contract/pr-review-agent.test.ts` (новый) на `WORFY_AGENT=fake`: `prReview.agentReview` запускает
      Session с `/human-review …` при Team reviewer-е и с `/worfy:code-review` без него; `fill: 'add'`;
      `prReview.stopAgent`; `prReview.changed` при записи; отказ Linked machine.
  - evidence: test-run pass · `pnpm test test/contract/pr-review-agent.test.ts` exit 0 (12 tests: commit of the draft, end of turn, closed Session, unreadable look) · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
- [ ] `test/unit/action-templates.test.ts`: шаблон «Agent review» и его Vendor.
  - evidence: test-run pass · `pnpm test test/unit/action-templates.test.ts` exit 0 · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
- [ ] Eval `harness/evals/agent-review-guards/` — pass; результат и цена — в «Итог».
  - evidence: test-run pass · `pnpm eval:harness -- --case agent-review-guards --max-cost-usd 5` exit 0, score 1.00, 2 of 2 runs, 1.20 USD · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
- [ ] `harness/bin/tests/agents-text.test.sh`: текст раздела держит «только через `bin/pr-review-draft`» и «вердикт —
      только предложение»; mutant (фраза убрана) — красный. `test/contract/codex-parity.test.ts` зелёный.
  - evidence: test-run pass · `bash harness/bin/tests/agents-text.test.sh` exit 0 (510 passed); `pnpm test test/contract/codex-parity.test.ts` exit 0 · mac - · d710dde5dbde0b5de1e0d670bc312def26f7983e
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

## Итог

- `harness/bin/pr-review-draft` — единственный писатель черновика у Agent review:
  `pr-review-draft [-C <папка>] <owner>/<name>#<N> comment <path> <line> [--side] [--start-line] <текст|->`, `summary`,
  `verdict <comment|approve|request_changes>` (`suggestedEvent`), `done` (`agent.state: 'done'`). Меняет только записи
  `by: 'agent'`; итоговый текст — только пустой или агентский (новое поле `bodyBy`); exit 1 без черновика, на
  `submitting` / `submitted` и после Stop (`agent.state: 'stopped'`). Текст строк комментария берёт `git show` на head-е
  черновика; строка за концом файла — отказ. Git — через `hooks/eval-env.cjs`, как соседние скрипты.
- Замок `<file>.lock` (файл, создаваемый только если его нет) держат оба писателя — main и скрипт — на чтение,
  изменение и rename; замок старше 10 s забирается. Rename повторяется на `EPERM`/`EBUSY` (Windows).
- `src/main/github/pr-review-agent.ts`: `prReview.agentReview` (`{ projectId, repo, number, head, fill }`, `'local'`)
  создаёт Session Node на Claude Code с `/human-review {repo}#{pr}` (skill Team reviewer-а собран) или
  `/worfy:code-review {repo}#{pr}` и правилом черновика в том же сообщении; до сообщения пишет `agent: { sessionId,
  state: 'writing' }` сразу, мимо 500 ms склейки. Watch файла (chokidar с опросом, закрытие через `closeForGood`) шлёт
  `prReview.changed`; кончается на `done`, Stop, конце хода Session (черновик → `done`) или её закрытии (→ `stopped`).
  `prReview.stopAgent` — `halt()` Session и `stopped`, записи агента остаются.
- Раздел «When worfy runs you for Agent review» — в `/worfy:code-review` (свой раздел перед «Why two axes»; правка
  внесена в `harness/skills/THIRD_PARTY.md`) и в шаблоне Team reviewer-а (подраздел `###` шага 8: test шаблона не
  допускает девятого `## ` и пунктов списка без `[R<n>]`). Refresh (`refresh.md`, шаг 1) дописывает его в уже собранный
  reviewer, как `review-history upgrade` — шаг 1.
- Красное до правки: `test/contract/harness-pr-review-draft.test.ts` — 7 из 7 падали (скрипта не было); после скрипта
  гонка падала, пока main писал без замка: из 400 комментариев в файле 302 — 98 записей скрипта затёрты rename-ом main.
  `test/contract/pr-review-agent.test.ts` падал на импорте модуля. `test/unit/action-templates.test.ts`: «expected
  undefined to be 'Agent review'». `agents-text.test.sh`: 10 mutant-ов (фраза убрана из раздела) — красные.
- Eval `harness/evals/agent-review-guards/` (fixture PR `octo-org/ledger#7`, `/worfy:code-review` в режиме Agent
  review): финальный run — 2 из 2, score 1.00, все четыре grader-а, **1.19 USD**. Всего на eval за Ticket — **8.83 USD**
  (шесть run-ов отладки grader-ов, 7.64 USD: grader не узнавал вызов через переменную `$BIN`, stand-in gh писал
  `REFUSED` на чтение `gh issue list`; skill тут был ни при чём). Cap: 30 USD — `BUDGET_USD=4` скрипт не принял: это константа скрипта, cap ниже задаёт
  `--max-cost-usd`.
- gate fast (один раз): exit 2. 27 красных test-ов — file watcher-ы (fseventsd на этом Mac): `cards-watch-edits`,
  `claude-home-registry`, `docs-watch-root`, `docs`, `product-watch`, `workflow-reader`, `workflow-read-from-main`,
  `profile-move`, `harness-script-env`. Два — мои, исправлены и проверены отдельно (`no-rmsync`: замок снимается
  через `removeFile`; `quit-listeners`: один `will-quit` на черновики и Agent review).

Решено без владельца, подтвердить:

- **«Agent review» — не шаблон в Project settings, а константы** (`AGENT_REVIEW_TEAM_TEMPLATE`,
  `AGENT_REVIEW_LENSES_TEMPLATE`, `AGENT_REVIEW_RULE`, `AGENT_REVIEW_VENDOR` в `action-templates.ts`): какой из двух
  текстов идёт, решает наличие Team reviewer-а, а не шаблон человека; новое действие в `ACTIONS` потянуло бы правку
  десятка fixture-ов настроек.
- **Правка `src/main/github/pr-review-draft.ts`** (в Ticket-е — «только читать»): без замка в main test гонки терял
  записи скрипта; там же `setAgent` и запись «сразу» для него.
- **Вход канала** — `{ projectId, repo, number, head, fill }`, как у каналов Ticket-а 07, а не `{ repo, pr, fill }`:
  `head` нужен, чтобы создать черновик.
- **`fill: 'new'` отказывает поверх черновика с комментариями или текстом человека** («Ask the agent to add comments
  to it»); любой запуск отказывает, пока Agent review этого PR пишет и его Session жива.
- **Скрипт отказывает после Stop**, а `done` — нет: после `done` человек может попросить Session дописать в её же чате.
- **Watch — опросом файла**, а не событиями ОС: один файл на время ревью.
- **Комментарий агента всегда добавляется**, повтор на тех же строках не заменяет прежний.

Раунд ревью 1 (ревью PR #2085, одна medium-находка и три low):

- **Коммит ревью — коммит черновика** (medium). Для черновика, который уже есть, `start()` не передавал агенту коммит,
  и skill ревьюировал `headRefOid` PR, а номера строк комментариев скрипт сверяет с коммитом черновика. Теперь первое
  сообщение кончается фразой `Review the commit <sha>: number the lines of each comment at that commit.` с коммитом
  черновика (`anchoredOn`, иначе `startedOn`), а оба skill-а (`/worfy:code-review` и шаблон Team reviewer-а) открывают
  worktree и считают строки на этом коммите; без фразы — на `headRefOid`. Черновик в `start()` на новый head не
  переставляется: так черновик остаётся на коммите начала, и Ticket 09 может показать «N new commits since you
  started». Test-ы: `pr-review-agent.test.ts` (`fill: 'add'` с новым head — в сообщении коммит черновика, `startedOn`
  не меняется) и `action-templates.test.ts`: 4 красных до правки (exit 1), после — 37 зелёных (exit 0).
  `agents-text.test.sh`: новая фраза в проверках обоих skill-ов, mutant (фраза убрана) красный; 510 passed, exit 0.
  Prompt eval-а получил ту же фразу (test `harness-evals` сверяет его первую строку с `agentReviewText`); хеш правки
  `code-review/SKILL.md` — в `THIRD_PARTY.md` и `harness-third-party-skills.test.ts`. Eval перезапущен, потому что
  текст skill-а и prompt изменились: 2 из 2, score 1.00, **1.20 USD** (cap 5 USD); всего на eval за Ticket —
  **10.03 USD**.
- **Выход не ждёт замок своей же записи** (low). `flushSync` ждал ~10 s, пока устареет замок, который держит
  асинхронная запись main этого же процесса. Теперь замки, взятые этим процессом, в множестве `heldHere`, и
  `flushSync` пишет сразу. Test `harness-pr-review-draft.test.ts` «does not wait for the lock its own write of this
  process holds»: до правки 10006 ms (exit 1), после — зелёный. Там же два test-а замка при выходе, которых не было:
  чужой замок (держит другой процесс 300 ms) `flushSync` ждёт, устаревший (20 s) забирает сразу; mutant «`flushSync`
  без замка» красит оба.
- **Нечитаемый черновик не закрывает watch** (low). Ответ `{ draft: null, problem }` теперь пропускает этот взгляд.
  Test «a look that cannot read the draft is skipped»: до правки watch закрывался после первой неудачи (exit 1),
  после — зелёный.
- **Test-ы концов watch-а** (low). Добавлены «the Session’s turn ends without done» (fixture
  `test/fixtures/agent-scripts/pr-review-agent-turn.jsonl`, ход держится до release) и «the Session closes while it
  writes». Код не менялся, поэтому до правки они зелёные; mutant-ы (ветка `done` убрана, ветка `stopped` убрана) красят
  каждый свой test.
- Evidence перепривязаны к коммиту после rebase-а. gate fast не запускался: file watcher test-ы на этом Mac красные из-за
  fseventsd.
