# 27 — `bin/land`: цикл merge одним скриптом в фоне — rebase, gate full, метки, merge, `ticket done`, batch CI

Type: task
Status: claimed 2026-10-28T22:09Z
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложения 3 и 4, решения 12 и 13;
скрипт Orchestrator-а `merge-once.sh`
(2026-10-26/27, вне репозитория), которым влиты #833–#860.

## Что происходит

- Profile worfy задаёт `workflow.merge_gate: "wave"` (`profile.json:67`), и `harness/bin/wave-gate` умеет
  `check` (набор под один gate full), `merge` (зелёный набор или его префикс) и `ci` (batch CI на `main`). Но
  Orchestrator вливал по одному своим `merge-once.sh`: wave-gate краснел typecheck-ом в дереве под `.git/`
  (Ticket 07), а меток и `ticket done` wave-gate не делает.
- После каждого merge Orchestrator сам, в своём контексте (около 295k token-ов на вызов): переносит метки
  `review` и `check/windows` на новый head (`bin/ticket mark`), ждёт `mergeable` (`UNKNOWN` → повтор),
  пишет комментарий «Pre-merge basis», `ticket done` и отдельный docs PR со статусом, запускает batch CI.
  Каждый шаг — вызов модели с полным контекстом.

Правка 2026-10-28 (решение 0 spec-а, «Переходим на CI раннеры»): основа `land` — check `ci-ok` на head каждого PR (Ticket 35), а не
локальный gate full. Шаг 1.1 ниже — ждать `ci-ok` на head после rebase; `wave-gate check` и `wave-gate merge`
— только если оценка Ticket-а 07 оставит `wave-gate` путём по умолчанию, иначе merge по одному PR. Цель —
скорость и стабильность пути до merge, а не экономия Mac.

## Что делаем

1. `harness/bin/land <state.json>` (Node, как остальные скрипты Harness, ADR-0055). Вход — тот же state file,
   что у `wave-gate`, плюс на каждый PR `epic`, `ticket`, `windows_verdict` (для scope `runner` — вывод
   `scripts/windows-run-verdict.mjs` Ticket-а 24 по автоматическому run-у на head; пока 24 не влит, поле пишет
   Orchestrator). Шаги, каждый пишется в state file сразу:
   1. `wave-gate check` (набор; набор из одного PR — путь `each`);
   2. метки `review` и `check/<name>` на новый head каждого PR, если rebase его сдвинул;
   3. `wave-gate merge`;
   4. на каждый влитый PR — `ticket done <epic> <NN> --pr <N>` в отдельном worktree docs-ветки, один docs PR
      на набор, его merge после `check-handoff` (команда `docs.handoff.check` Profile-а);
   5. `wave-gate ci` и, если в наборе был платформенный PR, dispatch `windows-full` на `main`
      (правило Profile-а).
2. Идёт в фоне; повторный запуск на том же файле продолжает с последнего записанного шага.
3. Вывод для Orchestrator-а — одна строка на PR (`#N merged <sha>` / `#N waits: <причина>`) и итоговая строка
   `LAND=<green|red|unverified>`; полный лог — в файл рядом со state file.
4. Раздел 4 skill-а `epic-wave`: «Gate before merge» с `merge_gate: "wave"` — одна команда `land` в фоне
   вместо ручных шагов. Решение владельца 2026-10-28 (решение 13): Orchestrator вливает PR **только** через
   `land` в фоне — ни своего `merge-once.sh`, ни ручного `gh pr merge`; ручной путь в skill-е остаётся
   описанием того, что делает скрипт, а не вторым путём.

Нужен ПК: нет. **Трогает Harness: да** — новый скрипт `harness/bin/land` и раздел 4 skill-а `epic-wave`; слово
владельца дано 2026-10-28 (решение 1). Вердикт Windows: runner `full` (скрипт Harness, ADR-0056, пункт 2).

## Готово, когда

- [ ] `harness/bin/tests/land.test.sh` на временном репозитории со stub-ами gate, `gh` и `ticket`: зелёный
      набор из двух PR — оба влиты, метки на новых head, `ticket done` для обоих в одном docs PR, batch CI
      запущен один раз; красный набор — влит только зелёный префикс, остальные `waits`; обрыв после merge
      первого PR и повторный запуск — второй влит, первый не повторён.
- [ ] Shell test: `mergeable` `UNKNOWN` — повтор до 6 раз через 10 s (подставной `sleep`), потом `waits`.
- [ ] Ни один шаг не вливает PR, если `wave-gate check` не `green` или gate вернул 3, 127 или код сигнала.
- [ ] Shell test-ы Harness — exit 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; вердикт Windows —
      runner `full`; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную, после обновления Stable copy) Одна настоящая Wave влита через `land`; число вызовов модели
      Orchestrator-а на merge до и после — по Ticket-у 19, в «Итог».
- [ ] `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md` (`:50`, `:678`, `:743`) и
      `harness/agents/implementer.md` (`:202`) называют условием merge `ci-ok`, а не gate full (расхождение из
      «Итог» Ticket-а 35).

## Где в коде

- `harness/bin/land`, `harness/bin/tests/land.test.sh` — новые
- `harness/skills/epic-wave/SKILL.md` — раздел 4 «Merge by policy», «Gate before merge» (около `:936-950`)
- `harness/README.md` — список скриптов
- Только читать: `harness/bin/wave-gate` (997 строк — не расширять), `harness/bin/ticket`,
  `harness/bin/tests/wave-gate-world.sh` (готовый stub-мир для test-ов)

## Вне скоупа

- Платформенный PR в наборе — Ticket 29.
- e2e по путям внутри gate full — Ticket 13.
- Свежий контекст Orchestrator-а — Ticket 28.

## Итог

Ветка `worfy-throughput/27`; PR — с этой ветки, платформенный (ADR-0056, пункт 2: новый скрипт Harness).

**Что сделано.** Основа — правка 2026-10-28: merge по check `ci-ok` на head каждого PR, без локального
gate full и без `wave-gate check`/`merge` (Ticket 07 не оставил `wave-gate` путём по умолчанию, у профиля
worfy `workflow.merge_gate` — `null`). Поэтому пункты «Что делаем» 1.1, 1.3 и 1.5 (gate full набора,
`wave-gate merge`, batch CI и dispatch `windows-full`) в скрипт не вошли: с `workflow.ci` `pr` CI идёт на
каждом PR и на каждом push в `main` сам.

- `harness/bin/land <state.json> [--watch]` (Node). Условие merge на head PR: ни одного run-а
  `ci.yml` в очереди или в работе; последний check `ci-ok` — `completed` `success` (`failure` и
  `cancelled` — красный); commit status `review` — `success`; с правилом scope — `node
  scripts/windows-verdict-scope.mjs origin/main <head>` в checkout-е `main`: код 0 — достаточно runner-а,
  код 1 — нужен `check/windows` `success` (`skipped` — тоже `success`), другой код — PR ждёт. Метка
  `review` переносится на новый head, только если diff PR вне `.scratch` (без строк `index`) побайтно
  тот же. Merge по одному PR, под замком `$(git rev-parse --git-common-dir)/main.lock` (mkdir):
  `mergeable` `UNKNOWN` — повтор до 6 раз через 10 s, потом `waits`; `CONFLICTING`/`DIRTY`/`BEHIND` —
  `waits` с причиной (rebase и update-branch `land` не делает); `gh pr merge N --squash
  --match-head-commit <head>`. После merge-ей — один docs PR на run: `ticket done` в отдельном worktree
  `<state>.docs`, `docs.handoff.check`, commit, push, `gh pr create`, merge по `ci-ok`. Каждый шаг
  пишется в state file сразу; повторный запуск продолжает с записанного, влитый PR не вливается снова.
  Вывод: `#N merged <sha>` / `#N waits: <причина>`, затем `LAND=green|red|unverified` (exit 0/2/3,
  1 — ошибка во входе); лог — `<state>.log` рядом со state file. `workflow.ci` `batch` отклоняется.
- `harness/bin/tests/land.test.sh` — 55 проверок на временном bare-репозитории со stub-ами `gh`,
  `ticket`, `sleep`, scope и docs check: два зелёных PR и один docs PR; красный и отменённый `ci-ok`;
  run в работе при старом зелёном `ci-ok`; `review` нет / `failure` / перенос после rebase; scope 0/1/2;
  `UNKNOWN` ×6, `BEHIND`, `DIRTY`, сдвиг head; замок (ожидание, брошенный замок, снятие на SIGTERM);
  kill после merge первого PR и повторный запуск; `--watch`; красный docs check; упавший `ticket
  done`; Silent mode; блок state file из skill-а. Настоящий `~/.claude` test не трогает (снимок до и после).
- Mutation testing: 26 mutant-ов правил `land` (по одному на правило: `ci-ok`, run в работе, `review`,
  перенос, scope, `--match-head-commit`, замок, `UNKNOWN`, `BEHIND`, `DIRTY`, сдвиг head, resume, один
  docs PR, docs check, `ticket done`, `batch`, сигнал, брошенный замок, вердикт) — каждый краснит
  `land.test.sh`, после восстановления — exit 0. Два mutant-а сначала выжили (повторный опрос GitHub о
  PR, который state file уже знает влитым; упавший `ticket done` без проверки кода выхода) — для них
  добавлены проверки.
- Skill `epic-wave`, раздел 4: «Merge with land» — Orchestrator вливает PR только через `land` в фоне,
  блок state file и команда запуска. `ship-ticket` (раздел о merge) и `implementer.md` (шаг 5, e2e)
  называют условием merge финальный CI check (`ci-ok`), а не gate full. Строки `ship-ticket` `:50`,
  `:683`, `:748` из «Готово, когда» описывают finish `local-green`, где gate full и есть условие, —
  их не правили. `harness/README.md` — `land` в списке скриптов.

**Что осталось.**
- (вручную, после обновления Stable copy) одна настоящая Wave, влитая через `land`, и число вызовов
  модели Orchestrator-а на merge до и после (Ticket 19).
- Вердикт Windows — runner `full`: `land.test.sh` на Windows идёт в `windows / full-suite` (через
  `test/contract/harness-scripts.test.ts`); merge ждёт `check/windows`.
- Две параллельные копии `land` на одном state file не разведены (`shortcut:` в шапке скрипта): каждый
  merge защищён замком и `--match-head-commit`, сам файл — нет.
