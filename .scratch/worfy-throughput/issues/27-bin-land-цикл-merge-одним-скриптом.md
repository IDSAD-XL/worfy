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
worfy `workflow.merge_gate` — `null`). Отступления от «Что делаем» — ниже, отдельным списком.

- `harness/bin/land <state.json> [--watch]` (Node). Условие merge на head PR: ни одного run-а
  `ci.yml` в очереди или в работе; последний check `ci-ok` — `completed` `success` (`failure` и
  `cancelled` — красный); head — тот, что проверил Orchestrator (`prs[].head`), или head с побайтно тем же
  diff PR вне tickets root (без строк `index`), иначе PR ждёт новой проверки; commit status `review` —
  `success`; каждый `check/<name>` из `prs[].checks` — `success` (`skipped` ставится как `success`).
  Список `checks` заполняет Orchestrator по `check` Stage-ам Pipeline-а и правилам проекта (для worfy —
  `windows`, если `node scripts/windows-verdict-scope.mjs origin/main <head>` даёт код 1; код 0 — пусто;
  другой код — PR в state file не идёт); своей логики scope в `land` нет. Метка `review` переносится на
  новый head, только если на нём нет статуса `review` вовсе, а на проверенном head — `success`;
  `failure`, `error` и `pending` на новом head не перезаписываются. Метки `check/<name>` не переносятся.
  Merge по одному PR, под замком `$(git rev-parse --git-common-dir)/main.lock` (mkdir):
  `mergeable` `UNKNOWN` — повтор до 6 раз через 10 s, потом `waits`; `CONFLICTING`/`DIRTY`/`BEHIND` —
  `waits` с причиной (rebase и update-branch `land` не делает); под замком `ci-ok` и метки читаются
  заново (ожидание замка бывает долгим); `gh pr merge N --squash --match-head-commit <head>`. После
  merge-ей — один docs PR на run: `ticket done` в отдельном worktree `<state>.docs`,
  `docs.handoff.check`, commit, push, `gh pr create`, merge по `ci-ok`; docs PR, закрытый без merge, не
  покрывает свои tickets — для них открывается новый. `tickets_root` приходит из `tickets.root` Profile-а
  (абсолютный путь блок skill-а делает относительным; вне репозитория и в Silent mode — `null`, без docs
  PR). Каждый шаг пишется в state file сразу; повторный запуск продолжает с записанного, влитый PR не
  вливается снова. Вывод: `#N merged <sha>` / `#N waits: <причина>`, затем `LAND=green|red|unverified`
  (exit 0/2/3, 1 — ошибка во входе); лог — `<state>.log` рядом со state file. `workflow.ci` `batch`
  отклоняется.
- `harness/bin/tests/land.test.sh` — 68 проверок на временном bare-репозитории со stub-ами `gh`,
  `ticket`, `sleep` и docs check: два зелёных PR и один docs PR; красный и отменённый `ci-ok`; run в
  работе при старом зелёном `ci-ok`; `review` нет / `failure` / перенос после rebase / `failure` и
  `pending` на новом head не перезаписаны; `checks` (нет метки, `success`, `failure`, пустой список,
  не переносятся); изменённый PR на новом head ждёт; `UNKNOWN` ×6, `BEHIND`, `DIRTY`, сдвиг head;
  замок (ожидание, брошенный замок, снятие на SIGTERM, повторная проверка `review` под замком, PR влит
  кем-то во время ожидания); kill после merge первого PR и повторный запуск; `--watch`; красный docs
  check; упавший `ticket done`; закрытый docs PR; свой `tickets_root`; отказ на абсолютный и внешний
  `tickets_root`, на старое поле `scope`, на PR без `checks`; Silent mode; блок state file из skill-а
  (`checks`, `tickets_root` из Profile-а). Настоящий `~/.claude` test не трогает (снимок до и после).
- Mutation testing: 26 mutant-ов первого круга (по одному на правило) и 18 mutant-ов доработки (перенос
  поверх не-`success` review, `checks` не читаются, префикс `check/`, перенос `checks`, изменённый head,
  повторная проверка под замком, `unknown` для влитого во время ожидания, закрытый docs PR, обязательность
  `checks`, отказ на `scope`, абсолютный и внешний `tickets_root`, четыре правки блока skill-а, две
  фразы skill-а, которые закрепляет `agents-text.test.sh`) — каждый краснит свой test, после
  восстановления — exit 0.
- Skill `epic-wave`, раздел 4: «Merge with land» — Orchestrator вливает PR только через `land` в фоне,
  без `gh pr merge` руками; PR с label `cross_machine_gate` и PR, которые держат люди Pipeline-а, в state
  file не идут; блок state file (`checks`, `tickets_root` из Profile-а) и команда запуска. `ship-ticket`
  (раздел о merge) и `implementer.md` (шаг 5, e2e) называют условием merge финальный CI check
  (`ci-ok`), а не gate full. Строки `ship-ticket` `:50`, `:683`, `:748` из «Готово, когда» описывают
  finish `local-green`, где gate full и есть условие, — их не правили. `harness/README.md` — `land` в
  списке скриптов.

**Отступления от «Что делаем» — сознательные.**
- Пункты 1.1, 1.3 и 1.5 (gate full набора, `wave-gate merge`, batch CI и dispatch `windows-full`) не
  вошли: правка 2026-10-28, merge по `ci-ok`; с `workflow.ci` `pr` CI идёт на каждом PR и на каждом push
  в `main` сам.
- Пункт 1.2 переносит на новый head только `review` (и только на head без статуса `review`); метки
  `check/<name>` не переносятся никогда — новый head ждёт свою метку от Orchestrator-а.
- Поля `windows_verdict` в state file нет: вердикт Windows — метка `check/windows`, её требует список
  `checks` PR, а ставит Orchestrator.
- `land` не останавливается на PR, который ждёт: каждый PR вливается по условию своего head, а не только
  зелёный префикс списка (условие «красный набор — влит только зелёный префикс» из «Готово, когда» было
  о наборе под один gate full, которого больше нет).

**Что осталось.**
- (вручную, после обновления Stable copy) одна настоящая Wave, влитая через `land`, и число вызовов
  модели Orchestrator-а на merge до и после (Ticket 19).
- Вердикт Windows — runner `full`: `land.test.sh` на Windows идёт в `windows / full-suite` (через
  `test/contract/harness-scripts.test.ts`); merge ждёт `check/windows`.
- Две параллельные копии `land` на одном state file не разведены (`shortcut:` в шапке скрипта): каждый
  merge защищён замком и `--match-head-commit`, сам файл — нет.
