# 50 — `land.test.sh` быстрее: мир из шаблона, squash stub-а gh прямо в origin

Type: task
Status: claimed 2026-10-29T05:00Z
Branch: worfy-throughput/50
Blocked by: 35
Source: бриф моста 2026-10-29: `harness/bin/tests/land.test.sh` — один из самых долгих файлов
`harness-scripts.test.ts` (около 230–317 s), условия Orchestrator-а 1–4 и одобрение подхода мостом.

## Что происходит

Посылка брифа — «test ждёт фиксированные паузы» — на деле не подтвердилась. Фиксированных ожиданий в файле нет:

- 26 мест со `sleep` — это stub `LAND_SLEEP` (`sleep.mjs`): он пишет секунды в лог и сразу возвращается;
- единственное настоящее ожидание — случай SIGTERM (на `main` `:409`), и он уже опрашивает, а не спит; на Windows
  этот случай пропущен (`on_windows`), его доказывает Mac;
- повторная проверка под замком (`lockrecheck`, на `main` `:372-379`) уже идёт через точку синхронизации, а stub
  sleep и подставленная пауза повторов `UNKNOWN` уже на месте. Условия Orchestrator-а 1 и 2 выполнены на `main`.

Профиль на ПК (Windows 11, `bash -x` с `EPOCHREALTIME` в `PS4`, временный HOME), всего 311 s:

| Что | Время | Доля |
| --- | --- | --- |
| запуски `land` (node, вызовы stub-а gh, git внутри `pr merge` stub-а) | 186 s | 60 % |
| тело `new_world` (38 миров: `git init`, clone, commit-ы, push, clone) | 91 s | 29 % |
| прочее (проверки, `state`, node в самом test-е) | 34 s | 11 % |

Самые долгие строки — внутри `new_world`: push 20.4 s, commit `base` 14.1 s, commit-ы PR 13.0 s, clone `repo`
11.4 s, clone `seed` 9.8 s. Один мир с двумя PR строится около 3.1 s; `cp -r` готового мира и два
`remote set-url` — около 0.45 s. Каждый `pr merge` stub-а делал clone, fetch, merge `--squash`, commit, push и
rev-parse во временной папке.

## Что делаем

1. **Мир из шаблона.** `new_world` строит каждый набор PR один раз (`$T/tpl-<N>-…`; наборов три: `1`, `1 2`,
   `1 2 3 4`). Каждый случай получает свежую копию (`cp -r`) и `remote set-url` в `seed` и `repo` на своё origin —
   как #943 (Ticket 46). Общего изменяемого мира нет. Если папка мира уже есть, test сразу падает.
2. **`pr merge` stub-а gh без clone.** Squash-коммит делается в bare origin: `merge-tree --write-tree`,
   `commit-tree -p main -m "squash #N"`, `update-ref refs/heads/main <новый> <старый main>`. Один родитель (main),
   дерево слияния, то же сообщение и те же `GIT_AUTHOR_*`/`GIT_COMMITTER_*`. Конфликт по-прежнему даёт exit 1
   stub-а (бросает `execFileSync`), `update-ref` со старым значением отказывает, если main сдвинулся. Нужен
   git ≥ 2.38 (`merge-tree --write-tree`): на Mac 2.50.1, на ПК 2.45.1, на образах GitHub — выше.
3. `harness/bin/land` не меняется.

## Готово, когда

- [x] Число проверок и строки вывода те же, что на `main` (кроме времени и предупреждений git о CRLF).
- [x] Время на ПК до и после: три run-а, медиана.
- [x] Mutant общего мира красный; mutant-ы Ticket-а 27, которые зависят от устройства мира и git stub-а, перезапущены.
- [ ] `test/contract/harness-scripts.test.ts` целиком и gate fast — exit 0.
- [ ] `check/windows` (платформенный PR, ADR-0056) — ставит ПК после review моста.

## Где в коде

- `harness/bin/tests/land.test.sh` — `new_world` и новый `build_world`; ветка `pr merge` в stub-е `gh.mjs`.
- `.scratch/worfy-throughput/spec.md` — строка Ticket-а 50 и строка «Почему так».

## Вне скоупа

- `harness/bin/land` и его ожидания.
- Другие test-ы, которые подключают `real-home.sh` и `gh-stand-in.sh`: они не менялись.

## Итог

Замер 2026-10-29 на ПК (Windows 11), каждый run — `bash harness/bin/tests/land.test.sh` с временным HOME.

ИТОГ_ЗАМЕРОВ
