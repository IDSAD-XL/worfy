# 50 — `land.test.sh` быстрее: мир из шаблона, squash stub-а gh прямо в origin

Type: task
Status: done 2026-10-29T06:10Z
PR: #955
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
- [x] `test/contract/harness-scripts.test.ts` целиком и gate fast — exit 0.
- [x] `check/windows` (платформенный PR, ADR-0056) — ставит ПК после review моста.

## Где в коде

- `harness/bin/tests/land.test.sh` — `new_world` и новый `build_world`; ветка `pr merge` в stub-е `gh.mjs`.
- `.scratch/worfy-throughput/spec.md` — строка Ticket-а 50 и строка «Почему так».

## Вне скоупа

- `harness/bin/land` и его ожидания.
- Другие test-ы, которые подключают `real-home.sh` и `gh-stand-in.sh`: они не менялись.

## Итог

Замер 2026-10-29 на ПК (Windows 11), каждый run — `bash harness/bin/tests/land.test.sh` с временным HOME.

Время файла:

| | run 1 | run 2 | run 3 | медиана |
| --- | --- | --- | --- | --- |
| до (`main` 5d15f9e5) | 310 s | 305 s | 309 s | 309 s |
| после (ветка на `main` c8b7c5cc) | 209 s | 210 s | 206 s | 209 s |

Минус 100 s (32 %). Оба раза 70 passed, 0 failed. Вывод совпадает с `main` строка в строку, если убрать время и
предупреждения git о CRLF (`diff` пустой). Предупреждений стало меньше: миры строятся три раза, а не 38.

Mutant-ы: каждый — одна замена строки на время одного run-а файла, потом `git checkout` файла. Все, кроме
отмеченных, — на ветке с шаблонными мирами.

| Mutant | Правка | Exit | Красные строки |
| --- | --- | --- | --- |
| общий мир | `cp -r "$tpl" "$W"` → `W="$tpl"` | 1 | 36 FAIL, первая `FAIL red: exit 0: #1 merged …` |
| нет `set-url` у `repo` | строка `git -C "$W/repo" remote set-url …` → `:` | 1 | 24 FAIL, первая `FAIL green: exit 3: #1 merged …` |
| stub: squash без родителя | `commit-tree tree -p main …` → `commit-tree tree …` | 1 | 8 FAIL, первая `FAIL green: exit 3: #1 merged …` |
| stub: `update-ref` без старого main | `update-ref refs/heads/main oid main` → `… oid` | 0 | нет, 70 passed |
| `land`: diff с index-строками | `.filter((l) => !l.startsWith("index "))` → `.filter(() => true)` | 1 | 4 FAIL (`carry`, `carry over failure`, `carry over pending`) |
| `land`: сдвиг head не замечен | `if (v.headRefOid !== head) throw` → `if (false) throw` | 1 | 1 FAIL: `FAIL moved: exit 0: #1 merged …` |
| `land`: review не перечитывается под замком | `mergeOne(st, pr.number, head, () => ready(st, pr, head, false))` → `mergeOne(st, pr.number, head, () => {})` | 1 | 1 FAIL: `FAIL lockrecheck: exit 0: #1 merged f5bc508c…` |
| то же на `main` c8b7c5cc | та же | 1 | 1 FAIL: `FAIL lockrecheck: exit 0: #1 merged eea014c6…` |
| `land`: PR влит во время ожидания замка | в `mergeOne` `… \|\| "unknown"` → `… \|\| "none"` | 1 | 1 FAIL: `FAIL lockmerged: exit 0: #1 merged none` |
| `land`: documents PR уже влит на GitHub | `:483` `v.state === "MERGED"` → `"MERGED-x"` | 0 | нет, 70 passed; на `main` тоже 0, 70 passed |

Не покрыто test-ами — оба случая не новые:

- `update-ref` со старым main: ни один случай не двигает main во время `pr merge` stub-а. Старый путь (push в
  origin) тоже отказал бы при сдвиге main, и его тоже ничто не проверяло. Test ради mutant-а не добавлен: он
  проверял бы stub, а не `land`.
- Ветка `:483` в цикле documents PR (PR уже влит на GitHub, когда `land` до него дошёл): mutant зелёный и на
  `main`. Сначала этот mutant был поставлен по ошибке вместо случая «PR влит во время ожидания замка». Верный
  mutant для того случая — строка выше, он красный.

Условия Orchestrator-а: 1 и 2 выполнены на `main` (точка синхронизации в `lockrecheck`, подставленная пауза
повторов `UNKNOWN` не тронута); 3 — случай SIGTERM на Windows пропущен, его доказывает Mac; 4 — фиксированных
ожиданий не было, удалять нечего; mutant-ы устройства мира и повторной проверки под замком — выше.

Проверки на ветке (на `main` c8b7c5cc), ПК:

- `node scripts/vitest-electron.mjs test/contract/harness-scripts.test.ts` целиком, временный HOME: exit 0, 69 passed,
  2 skipped, 1017 s. Другие test-ы, которые подключают `real-home.sh` и `gh-stand-in.sh`, идут внутри него.
- Gate fast: exit 0, «[gate] green (fast): lint, typecheck».
- `node scripts/windows-verdict-scope.mjs <merge-base> HEAD` (скрипт с `main`): `runner`, exit 0.

Осталось: `land.test.sh` на Mac (случай SIGTERM и время на Mac), `check/windows` после review моста.

### Merge

PR #955 влит, merge-commit `80149146`. Status `check/windows` на head `444dd227` — success, поставил ПК: land.test.sh
70/70 три раза (309 → 209 s), mutant-ы красные, `harness-scripts.test.ts` — exit 0, gate fast — green.

Review на Mac: `land.test.sh` — 39 и 42 s до правки, 31 s после, 71 passed. Mutant-ы красные, в том числе `lockrecheck`
и случай «нет unlock на SIGTERM». Ветка `land:483` (documents PR уже влит на GitHub) test-ами не покрыта и на `main`
до #955 — пробел старый, #955 его не вносил.
