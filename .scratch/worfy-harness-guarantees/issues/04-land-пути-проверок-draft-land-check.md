# 04: `land`: пути проверок, draft, `land --check`

Type: task
Status: open
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
- [ ] `land` не сливает PR, который правит путь проверки вне trail-а своего Ticket-а на вершине base branch; PR без
      Ticket-а с путём проверки ждёт владельца; ветка старше расширения trail-а не ждёт (shell test-ы).
- [ ] Строка `land` и отчёт Wave называют пути проверок каждого PR, и PR, который расширяет trail, тоже.
- [ ] Имя check-а CI берётся из `workflow.ci_check`; state file с другим именем отказан.
- [ ] `land --check <N>` отвечает за один PR без state file: exit 0, 1 с причиной одной строкой, 2; время ответа — в
      «Итог».
- [ ] Helper чтения trail-а лежит в `harness/lib/` и готов для guard-а Ticket-а 03.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, включая Windows verdict.
