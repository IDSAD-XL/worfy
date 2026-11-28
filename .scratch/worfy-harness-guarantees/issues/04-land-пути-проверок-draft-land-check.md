# 04: `land`: пути проверок, draft, `land --check`

Type: task
Status: claimed 2026-11-28T09:58Z
Branch: worfy-harness-guarantees/04
Blocked by: 02
Source: [spec.md](../spec.md), «Ticket-ы», 04; «Решение», 1 и 2; «Решения по реализации» («`land`: пути проверок,
draft, `land --check`»); «Решения по test-ам», Seams (`land`) и «Сначала падающий test», 04; «Вопросы владельцу», Q3 (а);
«Волны», Wave 2; [critic 2026-11-28](../../../docs/product/critic/worfy-harness-guarantees-2026-11-28.md), возражения 1
и 2

Кто: агент. Глубина ревью — `high`.

Платформенный PR (ADR-0056, пункт 2): `harness/bin/land` — скрипт Harness, `land.test.sh` идёт и в Git Bash; до merge
нужен Windows verdict.

## Что происходит

- Условие merge проверяет `land`: зелёный CI, тот же change, отметки `review` и `check/*`, main не красный
  (`ready()`, `harness/bin/land:755-764`). Какие файлы правит PR, он не смотрит: PR может сделать `ci-ok` зелёным,
  поменяв workflow, scope-скрипт или Quarantine, которые `ci-ok` проверяют.
- `land` не читает draft: в `PR_FIELDS` нет `isDraft` (`land:356`). Сегодня draft с зелёным CI и `review` сливается.
- Имя check-а CI `land` берёт из state file (`ci_check`, `land:263`, `:373-378`), который пишет Orchestrator
  (`harness/skills/epic-wave/SKILL.md:1335`).

## Что строить

- Шаг `verified(st, pr, head)` в `ready()`: пути diff-а PR от merge-base — так же, как их берёт `documentsOnly`
  (`land:612-624`), — сверяются со списком `harness/lib/verification-paths.cjs` (Ticket 02) и Profile-ом, никогда из
  state file.
- Trail Ticket-а PR-а:
  - Ticket — по ветке PR и шаблону `tickets.branch` (`<epic>/<NN>`), файл — по `tickets.path`, раздел —
    `tickets.trail_section` (`## Где в коде`);
  - текст — на вершине base branch: `git show refs/remotes/<remote>/<branch>:<путь>` по state file-у (для guard-а то же
    самое — `git show <worktree.base>:<путь>`), не на merge-base. Решение владельца 2026-11-28 (critic, возражение 2):
    ветка implementer-а старше documents PR-а, который расширил её trail, и на merge-base trail ещё старый;
  - чтение trail-а — helper в `harness/lib/` (например `trailPaths()` в `verification-paths.cjs` или новый
    `harness/lib/ticket-trail.cjs`, имя — предложение). Его же берёт guard в Ticket-е 03: guard и `land` читают trail
    одним кодом.
- Путь проверки вне trail-а — PR ждёт: `waits — verification paths outside the trail of <epic> <NN>: <пути>`. PR без
  Ticket-а (ветка не по шаблону) с путём проверки ждёт владельца.
- PR, который дописывает путь проверки в trail любого Ticket-а (diff в `tickets.root`, раздел trail-а), сам считается
  правкой путей проверок: строка `land` его называет. Требования отметки `owner` здесь нет — его ставит Ticket 10 вместе
  с кнопкой владельца (решение владельца 2026-11-28, critic, возражение 1).
- `isDraft` в `PR_FIELDS`: draft ждёт — `waits — draft`.
- Имя check-а CI — из `workflow.ci_check` Profile-а (Ticket 02); state file с другим `ci_check` `land` отказывает с
  причиной.
- Новый режим `land --check <N>`: условие одного PR без state file, по Profile-у (repo, ветка, check CI, Pipeline).
  Exit 0 — готов; 1 — ждёт, причина одной строкой; 2 — не может сказать (нет сети, нет Profile-а, ошибка `gh`).
  Время ответа на одном PR — в «Итог»: guard Ticket-а 05 зовёт его внутри лимита hook-а 30 s
  (`harness/hooks/hooks.json:192`).
- Строка `land` называет пути проверок PR: `#1850: merged — verification paths: .github/workflows/ci.yml (trail of
  worfy-x 07)`. Отчёт Wave (skill `epic-wave`, раздел 4 «Merge by policy» `:922` и раздел 5 «Report» `:1911`) их
  переносит.
- Комментарий-шапка `land` (условие merge, `:8-58`) называет новые шаги.

## Где в коде

- `harness/bin/land` — шапка `:1-58`, `PR_FIELDS` `:356`, `prView` `:357`, `ciGreen` `:367-378`, `documentsOnly`
  `:612-624`, `ready()` `:755-764`, merge `:818`, разбор аргументов (новый `--check`)
- `harness/lib/verification-paths.cjs` (Ticket 02) — helper чтения trail-а, или новый `harness/lib/ticket-trail.cjs`
- `harness/bin/tests/land.test.sh`, `harness/bin/tests/gh-stand-in.sh`
- `harness/skills/epic-wave/SKILL.md` — раздел 4 `:922` (строки `land`, `:1233-1284`), раздел 5 `:1911`
- Только читать: `harness/bin/profile`, `harness/profiles/README.md` (поля `tickets.*`, `worktree.base`)

## Test-ы

- `harness/bin/tests/land.test.sh` с gh stand-in:
  - draft с зелёным CI и `review` — `waits — draft` (сначала падающий test: сегодня draft сливается);
  - PR правит путь проверки, trail на вершине base branch его не называет — ждёт с путём в причине;
  - trail расширен на base branch после того, как ветка PR ушла от неё (merge-base держит старый trail) — PR не ждёт;
  - PR, который дописывает путь проверки в trail, — строка `land` называет его как правку путей проверок;
  - PR без Ticket-а с путём проверки — ждёт владельца;
  - state file с `ci_check`, отличным от `workflow.ci_check`, — отказ;
  - `land --check <N>`: exit 0, 1 с причиной, 2 без ответа `gh`.
- Unit test helper-а trail-а, если он в `harness/lib/`: раздел trail-а, пути в backticks, `\` на Windows.
- `land.test.sh` проходит в Git Bash на Windows.
- Без моделей и без сети: только gh stand-in.

## Готово, когда

- [ ] `land` не сливает draft: строка `waits — draft` (shell test, красный на старом коде).
  - evidence: test-run pass · `bash harness/bin/tests/land-verification.test.sh` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] `land` не сливает PR, который правит путь проверки вне trail-а своего Ticket-а на вершине base branch; PR без
      Ticket-а с путём проверки ждёт владельца; ветка старше расширения trail-а не ждёт (shell test-ы).
  - evidence: test-run pass · `bash harness/bin/tests/land-verification.test.sh` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] Строка `land` и отчёт Wave называют пути проверок каждого PR, и PR, который расширяет trail, тоже.
  - evidence: test-run pass · `bash harness/bin/tests/land-verification.test.sh` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] Имя check-а CI берётся из `workflow.ci_check`; state file с другим именем отказан.
  - evidence: test-run pass · `bash harness/bin/tests/land-verification.test.sh` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] `land --check <N>` отвечает за один PR без state file: exit 0, 1 с причиной одной строкой, 2; время ответа — в
      «Итог».
  - evidence: test-run pass · `bash harness/bin/tests/land-verification.test.sh` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] Helper чтения trail-а лежит в `harness/lib/` и готов для guard-а Ticket-а 03.
  - evidence: test-run pass · `pnpm test test/unit/ticket-trail.test.ts` exit 0 · mac - · 1053c3b169c62803d406ee5042a51cd111f631d7
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.

## Итог

- `land` не сливает draft: `isDraft` добавлен в `PR_FIELDS`, PR ждёт с причиной `draft` и при первом чтении, и под
  замком main branch. Строка — `#N waits: draft` (общая форма строк `land` — `#N waits: <причина>`).
- Шаг `verified()` в `ready()`: пути diff-а PR от merge-base сверяются со списком `lib/verification-paths.cjs` и
  `verification.paths` Profile-а (`bin/profile --json`), никогда из state file. Ticket — по ветке PR и
  `tickets.branch`, файл — по `tickets.path`, trail — раздел `tickets.trail_section` на вершине base branch
  (`git show refs/remotes/<remote>/<branch>:<путь>`). Путь вне trail-а — `verification paths outside the trail of
  <epic> <NN>: <пути>`; PR без Ticket-а с путём проверки — `verification paths, and the PR has no ticket (…): <пути> —
  the owner decides`. Правка собственного trail-а в PR ничего не разрешает: на base branch её нет (test «own trail»).
- PR, который дописывает путь проверки в trail любого Ticket-а (файл под `tickets.root`, в trail-е на head есть путь
  проверки, которого нет на merge-base), сливается, а его строка это называет:
  `#N merged <sha> — verification paths: added to the trail of <файл Ticket-а>: <пути>`. Отметки `owner` нет — это
  Ticket 10 (возражение 1 critic-а).
- Строка слитого PR с путями проверок: `#N merged <sha> — verification paths: <пути> (trail of <epic> <NN>)`; то же
  в `prs[].result.verification`. Skill `epic-wave`: раздел 4 описывает новые условия и хвост строки, раздел 5 —
  строку под таблицей отчёта Wave для каждого такого PR.
- Имя check-а CI: state file с `ci_check`, отличным от `workflow.ci_check` Profile-а, — отказ (exit 1) с обоими
  именами. Сверх Ticket-а и осознанно: если Profile не называет `workflow.ci_check` (сейчас так у worfy, пока владелец
  не выполнил команду `profile-set` из «Итог» Ticket-а 02), остаётся имя state file-а и строка в log — иначе каждый
  `land` worfy падал бы до этой команды. Отмечено `shortcut:` в коде.
- Новый режим `land --check <N> [-C <dir>]`: условие одного PR без state file по Profile-у (`_resolved.checkout`,
  `worktree.base`, `workflow.ci_check`, Check-и всех Stage-ей `check` Pipeline-а, `tickets.*`); workflow CI — тот, в
  чьём run-е последний check `ci_check` на head (`details_url` → `gh run list --commit`). Exit 0 — `#N ready`,
  1 — `#N waits: <причина>`, 2 — `#N unverified: <причина>` (нет Profile-а, нет ответа `gh` или git). Ничего не пишет:
  ни log, ни marker `main-red`, ни merge. `red_elsewhere` не читает: это правила Project-а, не Profile.
- Время ответа `land --check` на одном PR с gh stand-in на Mac — 311 ms (test `land-verification.test.sh`, случай
  «check: a green PR»). С настоящим GitHub не мерилось (бриф запрещает настоящий `gh`): это `git fetch` и 7 вызовов
  `gh` (`pr view`, 2 × check runs, 2 × `run list` на head, statuses, push runs main) плюс `bin/profile` дважды; при 0,5–1 s на
  вызов `gh` — около 5–8 s, внутри лимита hook-а 30 s, но это оценка, не замер.
- Helper trail-а — `harness/lib/ticket-trail.cjs`: `ticketOfBranch`, `ticketPattern`, `trailPaths`, `namedByTrail`,
  `readTrail({repo, ref, branch, tickets, git, folder})`. Guard Ticket-а 03 зовёт `readTrail` с `ref` =
  `worktree.base` и получает тот же trail. Unit test — `test/unit/ticket-trail.test.ts` (раздел trail-а, пути в
  backticks, суффиксы строк, `\` с Windows, блоки кода, чтение на ref, а не из working tree).
- Test-ы `land` вынесены в новый файл `harness/bin/tests/land-verification.test.sh` (тема отдельно, как
  `land-story.test.sh`: `land.test.sh` и так 306 s на Windows). Stub-ы `land-world.sh` отдают `isDraft`,
  `headRefName`, `bin/profile --json` и отказ `gh` (`gh-down`); bare origin получил `receive.autogc false`. В
  `land-story.test.sh` случай «PR без Ticket-а» теперь проверяет, что не читается `code_stories.pr`: Profile
  читается всегда, ради путей проверок.
- Сначала падающий test: `land-verification.test.sh` на старом `land` — 16 FAIL из 19 (draft сливался: `#1 merged
  …`; пути проверок, `ci_check` и `--check` не читались).
- Feature page `docs/features/gate-and-github.md` — абзац «Drafts and verification paths» (полный текст — Ticket 12).
- Вне trail-а, потому что без этого красные test-ы: `harness/evals/lib/coverage.json` (карта eval runner-а: кто грузит
  `lib/ticket-trail.cjs` и `lib/verification-paths.cjs`) и `harness/lib/README.md` (список модулей `lib/`).
- Gate fast на Mac — exit 2: 27 test-ов file watcher-ов (`docs.test.ts`, `docs-watch-root.test.ts`,
  `product-watch.test.ts`, `workflow-reader.test.ts` и др., `fs.watch` не сообщает об изменении). `src/` эта правка не
  трогает; это известная проблема `fseventsd` на этом Mac. Вердикт — CI.
