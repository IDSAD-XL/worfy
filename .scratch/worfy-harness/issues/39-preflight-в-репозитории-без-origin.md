# 39 — `preflight` в репозитории без remote `origin` отвечает `BLOCKED`, хотя для Project-а с локальным финишем это поддерживаемый случай

Type: task
Status: done 2026-10-20T08:45Z
PR: #565
Branch: worfy-harness/39
Blocked by:
Source: приёмочный прогон 2026-10-14 под вторым пользователем macOS — пункт 5 приёмки E3 (приёмка Epic-а `worfy-harness`, Ticket [26](26-приёмка-e3.md)); отчёт — [26-пункт-5-отчёт-2026-10-14.md](../evidence/26-пункт-5-отчёт-2026-10-14.md), находка 8 («Preflight блокирует Wave в репозитории без `origin`») и два дополнительных прогона.

## Что происходит

`harness/bin/preflight` — проверка перед работой над Ticket-ом или Wave (Wave — группа Ticket-ов
одного Epic-а, которые выполняются вместе). Она смотрит состояние дерева, свежесть базы (ветки, от
которой создаются ветки Ticket-ов), чужие Session в том же дереве, свободные номера ADR и миграций,
открытые PR и состояние Epic-а. Последняя строка вывода — `GO` (exit code 0) или
`BLOCKED: <причины через «; »>` (exit code 1). Exit code 2 значит, что проверка не смогла работать:
папка не git-репозиторий, Project не зарегистрирован, неизвестный флаг
(`harness/bin/preflight:11-15`).

Локальный финиш — значение `workflow.finish: local-green` в Profile Project-а. Ticket закрывается
без PR: локальный gate (набор проверок Project-а: lint, test-ы) зелёный, ветка влита в главную
ветку на этой машине. Решение ADR-0045 («один Ticket — один репозиторий»), пункт 4, называет для
него два случая: нет прав на PR или у репозитория нет `origin`
(`docs/adr/0045-one-ticket-one-repository.md:39-41`; контракт Profile —
`harness/profiles/README.md:355`).

В репозитории без remote `origin` `preflight` всегда отвечает `BLOCKED`. Wave в прогоне прошла
только потому, что Orchestrator (агент, который ведёт Wave) решил эту блокировку не учитывать.

### Что наблюдал прогон

Из отчёта, находка 8 и разделы о втором Project-е. Время Wave — UTC, 2026-10-13.

- Три Wave в двух Project-ах без единого remote. Оба — в Silent mode (режим, в котором файлы
  workflow Project-а лежат вне его репозитория): `~/silent-app` (23:08) и `~/silent-app-2`
  (23:31 и 23:44). Каждый раз `preflight` вернул `BLOCKED: fetch failed`. Exit code 1 отчёт
  называет для первой Wave. Для второй и третьей он следует из кода: строка `BLOCKED` всегда идёт с
  exit code 1 (`harness/bin/preflight:459`). Вид команды — `preflight --epic e3-acceptance` —
  записан в журнале решений первой Wave, в отчёте его нет.
- Каждый раз Orchestrator продолжил Wave и записал это в журнал решений Wave (`decisions.tsv` —
  файл, куда Orchestrator пишет решения, принятые без человека). Строка первой Wave: «Preflight
  BLOCKED (fetch failed: no origin) treated as a warning; ticket 01 is dispatched after a minimal
  preflight on local main 5d14d2d».
- В итоговом сообщении Orchestrator ждёт подтверждения человека: «confirm that treating the
  preflight's `BLOCKED: fetch failed` (no `origin`) as a warning was right».
- Вывод отчёта: локальный финиш без `origin` дошёл до конца по решению агента. Другой прогон на том
  же месте может остановиться.

Прочитано на машине после прогона, только чтение (2026-10-14, около 03:00):

- Три файла `decisions.tsv` в `/Users/worfy-test/.claude/worfy-harness/runs/`:
  `silent-app/e3-acceptance-wave-20261013T230854Z/`,
  `silent-app-2/e3-acceptance-wave-20261013T233109Z/`,
  `silent-app-2/e3-acceptance-wave-20261013T234429Z/`. В каждом — строка о `BLOCKED`, принятом за
  предупреждение. Колонка `evidence` первой: `preflight --epic e3-acceptance: EXIT=1; git remote -v:
  empty; git status --porcelain: empty`. Отчёт для третьей Wave называет только запись в Ticket-е;
  строка в журнале решений у неё тоже есть.
- `profile.json` обоих Project-ов: `mode: "silent"`, `workflow.finish: "local-green"`,
  `github.account: null`, `worktree.base: "main"`.
- `rules.md` обоих Project-ов (правила Project-а для агентов, их пишет Session подключения)
  начинает раздел о финише фразой «The repository has no remote.» и дальше говорит, что Ticket
  кончается локальным слиянием без push и без PR. На этот раздел Orchestrator и сослался.
- Та же просьба о подтверждении стоит в файлах Ticket-ов 01 и 02 и в `HANDOFF.md` (файл состояния
  Project-а) у `silent-app-2`.

### Что подтверждено в коде (main `ff61b06`)

Fetch. Строка из отчёта верна.

- `check_fetch` (`harness/bin/preflight:215-226`) выполняет `git fetch origin --prune --quiet`
  (`:220`) с пределом 60 секунд. Шаг пропускается только флагом `--no-fetch` (`:125`, `:218`).
- Любой ненулевой exit code git — причина `fetch failed: <первая строка stderr git>` (`:224`).
  Истёкшее время — `fetch failed: timed out after 60 s` (`:223`).
- От наличия remote `origin` запуск fetch не зависит. О remote спрашивает только
  `check_gh_account` (`:200-213`), шаг прямо перед fetch (`:468-469`): `git remote get-url origin`
  (`:202`). Ответ идёт на подсказку об аккаунте gh. Если remote нет, функция молча выходит, и
  `check_fetch` об этом не узнаёт.

Fetch — не единственная причина. Этого в отчёте нет.

- `check_origin_main` (`:228-234`) ищет ссылку `refs/remotes/<база>` (`:229`). Нет её — причина
  `no ref <база>` (`:230`).
- База — `worktree.base` из Profile как записано (`:161`, `:171`). Если поля нет:
  `origin/<default_branch>` из `layout.repos` (`:159-161`), потом ветка, на которую смотрит
  `origin/HEAD`, потом `origin/main` (`:179-182`). В репозитории без remote ни одной ссылки
  `refs/remotes/…` нет, значит причина есть при любом значении поля.
- `check_main` (`:236-271`) считает, на сколько локальная главная ветка отстала от базы
  (`:246-247`). Имя базы здесь git разрешает по общим правилам, а не только в `refs/remotes/`. При
  `worktree.base: "main"` (значение прогона) база и главная ветка — одна локальная ветка `main`:
  оба числа равны 0, предупреждения и причины нет (строки 1–2 таблицы раздела «Что
  воспроизведено»). При `"origin/main"` и при `null` имя `origin/main` в репозитории без remote
  не разрешается, оба числа — `?`. Тогда
  печатается предупреждение «main is behind origin/main by ? — diverged …» (`:250`, `:258`), а на
  главной ветке добавляется причина `working on a stale main (behind by ?)` (`:259`) — строки 3–5
  той же таблицы.
- Поэтому флаг `--no-fetch` не даёт `GO`: он убирает только первую причину.
- `check_prs` (`:409-420`) в любом случае зовёт `gh pr list`. Без remote это предупреждение
  `! gh unavailable: …` (`:414`), оно не блокирует.

Profile.

- `preflight` берёт из `profile --json` шесть значений: базу, папку ADR, журнал миграций, команду
  миграций, режим и Workflow folder — папку с файлами workflow Project-а (`:160-167`).
  `workflow.finish` и `github.account` он не читает.
- Ни один скрипт в `harness/bin` и `harness/hooks` не читает `workflow.finish`: поле читают только
  тексты skills и агентов (поиск по `harness/`).
- Поля «у репозитория нет remote» в Profile нет. Три поля говорят об этом косвенно:
  - `workflow.finish: local-green` — skill `connect-project` ставит его, когда у репозитория нет
    `origin` (`harness/skills/connect-project/SKILL.md:70`). То же значение у Project-а с `origin`,
    но без прав на PR (`harness/profiles/README.md:355`).
  - `worktree.base` без `origin/` — так skill велит писать базу, когда `origin` нет
    (`SKILL.md:51-52`). Контракт Profile называет только значения вида `origin/main`
    (`README.md:142`).
  - `github.account: null` — при подключении оно `null` всегда (`SKILL.md:74`) и ничего не значит.
- Сам факт известен только в момент подключения: `project-connect --facts` печатает `origin: null`
  (`harness/bin/project-connect:141`, `:149`). После подключения он записан только словами в
  `rules.md`.

Skills.

- `harness/skills/epic-wave/SKILL.md:102-103`: «`BLOCKED` — stop with a message (the reasons, and
  which of them are only warnings, are in `rules.md`)».
- `harness/skills/ship-ticket/SKILL.md:116`: «Any other reason — stop, do not work around it».
- Ручной минимальный preflight skills разрешают только при exit code 2 (`epic-wave/SKILL.md:84-87`,
  `ship-ticket/SKILL.md:120-124`), и он тоже начинается с `git -C <repo> fetch`.
- По этим текстам Orchestrator должен был остановиться. В журнале решений он сослался на правила
  Project-а: «The project rules state the repository has no remote and finishes by a local merge»
  (первая Wave), `profile --rules, section Repository and finish` (вторая и третья). Опирался ли он
  ещё и на слова skill-а «which of them are only warnings … in `rules.md`», неизвестно: записи
  Session не читаются. Эти слова такое прочтение допускают.

Test-ы и другие прогоны.

- `harness/bin/tests/preflight.test.sh`: у каждого репозитория, в котором `preflight` доходит до
  шагов fetch и базы, есть `origin` (`:35`, `:40-41`, `:99-106`). Каждый запуск идёт с `--no-fetch`
  (например `:68`, `:77`, `:116`, `:135`). Два репозитория без remote там зарегистрированы
  (`:54-57`), но `preflight` в них не запускается. В этом файле fetch не выполняется ни разу.
- `harness/bin/tests/harness-home.test.sh` запускает `preflight` в репозитории без единого remote.
  Репозиторий создан через `git init`, remote не добавляется (`:45-55`). Profile — schema 1,
  `worktree.base: "origin/main"`, поля `workflow.finish` нет (`:75`). Два запуска идут без
  `--no-fetch`: `:186` (вывод не читается) и `:221`. Test принимает и `GO`, и `BLOCKED: …` (`:32`,
  `:223`), поэтому блокировку никто не заметил. Ещё два запуска идут с `--no-fetch` и проверяют
  только строку `lock:` (`:225-228`). Файл входит в `pnpm test`.
- Eval-кейсы (проверка поведения агента на демо-репозитории) строит
  `harness/evals/lib/demo-project.sh`. При `local-green` он даёт демо-репозиторию локальный
  bare-репозиторий как `origin` — «so preflight can fetch without network» (`:16-17`, `:219-225`).
  Так собраны девять кейсов из десяти. При `pr-green-ci` remote нет совсем, а `worktree.base` равен
  `"main"` (`:17`, `:226-227`). Так собран один кейс — `ship-ticket-pr-green-ci`
  (`harness/evals/ship-ticket-pr-green-ci/scaffold.sh:3`; Ticket 27, таблица кейсов,
  `27-eval-кейсы-harness-через-plugin-eval.md:108`). Запускался ли он, в Ticket-ах 27 и 29 не
  записано.
- Автоматическая приёмка «silent» идёт с `origin` и PR. Так сказано в инструкции прогона
  (`/Users/Shared/worfy-item5/README-item5.md:100`, файл вне репозитория). Репозиторий без `origin`
  Ticket 26 отдаёт только пункту 5 (`26-приёмка-e3.md:121-125`).
- Итог: случай «remote нет, `workflow.finish: local-green`» до 2026-10-14 не проверял ни один
  test, ни один eval-кейс и ни одна приёмка. Сам `preflight` в репозитории без remote запускается
  в `harness-home.test.sh` при каждом `pnpm test` и отвечает `BLOCKED`; test этого не различает.

### Что воспроизведено

Скрипт из дерева `ff61b06` запущен во временной папке: свои `HOME`, `HARNESS_HOME`, `TMPDIR`,
маленькие git-репозитории, Profile со значениями прогона (schema 2, `mode: silent`,
`workflow.finish: local-green`, `github.account: null`). В `PATH` — `node`, `/usr/bin` и `/bin`;
`gh` там нет, сеть не используется: все `origin` — локальные пути.

```
cd <репозиторий> && env -i HOME=<папка>/home HARNESS_HOME=<папка>/hh TMPDIR=<папка>/tmp \
  PATH=<папка>/bin:/usr/bin:/bin harness/bin/preflight [--no-fetch]; echo "EXIT=$?"
```

| № | Репозиторий | `worktree.base` | Флаг | Exit code | Последняя строка |
| --- | --- | --- | --- | --- | --- |
| 1 | без remote, ветка `main` | `"main"`, как в прогоне | — | 1 | `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository; no ref main` |
| 2 | тот же | `"main"` | `--no-fetch` | 1 | `BLOCKED: no ref main` |
| 3 | тот же | `"origin/main"` | — | 1 | `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository; no ref origin/main; working on a stale main (behind by ?)` |
| 4 | тот же | `"origin/main"` | `--no-fetch` | 1 | `BLOCKED: no ref origin/main; working on a stale main (behind by ?)` |
| 5 | тот же | `null` | — | 1 | как в строке 3 |
| 6 | тот же, ветка `feat/x` | `"origin/main"` | — | 1 | `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository; no ref origin/main` |
| 7 | `origin` задан, его путь не существует, fetch не проходил ни разу | `"origin/main"` | — | 1 | `BLOCKED: fetch failed: fatal: '<путь>' does not appear to be a git repository; no ref origin/main; working on a stale main (behind by ?)` |
| 8 | `origin` раньше отвечал, потом его путь убран | `"origin/main"` | — | 1 | `BLOCKED: fetch failed: fatal: '<путь>' does not appear to be a git repository` |
| 9 | тот же, что в строке 8 | `"origin/main"` | `--no-fetch` | 0 | `GO` |
| 10 | `origin` отвечает | `"origin/main"` | — | 0 | `GO` |

Ещё два факта из той же папки:

- `git remote get-url origin` в репозитории без remote: exit code 2, `error: No such remote
  'origin'`. В репозитории с `origin` — exit code 0 и его адрес.
- `git fetch origin` даёт exit code 128 и в строке 1, и в строке 7. Первая строка stderr
  отличается только словом в кавычках. По тексту ошибки git «remote нет» от «remote не отвечает»
  надёжно не отличить.

Отдельно, в песочнице проверки черновика (тот же вид команды):

- Форма fixture `harness-home.test.sh` (remote нет, Profile schema 1,
  `worktree.base: "origin/main"`, поля `workflow.finish` нет, `preflight --epic e1`): exit code 1,
  `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository; no ref
  origin/main; working on a stale main (behind by ?)`. Сам test не запускался.
- Значения демо-репозитория eval-кейса `ship-ticket-pr-green-ci` (remote нет,
  `workflow.finish: pr-green-ci`, `worktree.base: "main"`): exit code 1, `BLOCKED: fetch failed:
  fatal: 'origin' does not appear to be a git repository; no ref main`.
- Репозиторий с отвечающим `origin` (локальный bare-репозиторий): exit code 0, 8 строк вывода, ни
  одной о fetch.

### Что остаётся предположением

- Полная последняя строка `preflight` в самом прогоне. Отчёт и журнал решений приводят только
  `fetch failed`. Записи Session прогона другому пользователю не читаются. Со значениями Profile
  прогона временная папка даёт две причины (строка 1 таблицы).
- Почему агент три раза из трёх принял одно и то же решение. Это выбор модели, код его не
  закрепляет.
- На какие слова skill-а опирался агент. Журнал решений называет только `rules.md` Project-а.

## Что делаем

Правило: репозиторий без remote с именем `origin` — поддерживаемый случай для Project-а, у которого
`workflow.finish` равен `local-green`. `preflight` говорит об этом одной строкой и из-за этого не
блокирует. Fetch, который не прошёл у существующего `origin`, блокирует, как сейчас.

По чему решать — три варианта.

- **А. Только по репозиторию.** Нет remote `origin` (`git remote get-url origin`, exit code не 0) —
  fetch не выполняется и не блокирует, что бы ни стояло в Profile. Плюс: один факт, Profile читать
  не надо. Минус: Project с `pr-green-ci` без `origin` получает `GO` и узнаёт о проблеме только на
  шаге PR, после всей работы.
- **Б. Только по Profile.** При `local-green` fetch не выполняется, или его неудача становится
  предупреждением. Минус: `local-green` стоит и у Project-а с `origin` без прав на PR. Он либо
  остаётся без обновления базы, либо перестаёт блокироваться при недоступном `origin`. Это нарушает
  вторую половину правила.
- **В. Оба факта (рекомендуется).** Есть ли `origin`, решает репозиторий. Допустимо ли его
  отсутствие, решает `workflow.finish`. Для `pr-green-ci` без `origin` блокировка остаётся, как
  сегодня, но с причиной по существу.

По варианту В:

1. **Profile.** `load_profile` читает ещё одно поле — `workflow.finish`.
2. **Есть ли `origin`.** Проверка идёт до fetch, командой git, которая отвечает о remote по имени,
   а не по тексту ошибки fetch.
3. **`origin` есть** — всё как сейчас: fetch, причина `fetch failed: …` при неудаче, база
   `refs/remotes/<база>`.
4. **`origin` нет, `workflow.finish` равен `local-green`:**
   - fetch не выполняется; причины `fetch failed` нет;
   - одна строка вывода, не предупреждение (не начинается с `! `). Она говорит, что remote с именем
     `origin` нет, финиш локальный и база — локальная ветка. Пример: `origin: none — local finish,
     the base is the local branch main`;
   - база — локальная главная ветка. Порядок — из контракта локального финиша
     (`harness/profiles/README.md:360-362`) без одного шага: `worktree.base` без `origin/`
     (значения `"main"` и `"origin/main"` дают `main`), потом
     `layout.repos.<repo>.default_branch`, потом локальная `main`, потом `master`. Шаг контракта
     «ветка, на которую смотрит `origin/HEAD`» здесь не нужен: без `origin` такой ссылки нет;
   - проверяется `refs/heads/<ветка>`. Нет её — причина `no local branch <ветка>`;
   - строка базы печатается в прежнем виде: `main: <sha> <дата> "<тема>"`. Skills берут из неё базу
     для заданий агентам;
   - остальные шаги (отставание, номера ADR и миграций) считают от этой же ветки. Предупреждения
     «behind … by ?» и причины `working on a stale main` в этом случае быть не должно;
   - шаг открытых PR не зовёт `gh` и печатает строку: `open PRs: no remote origin — step skipped`.
     Шапка скрипта обещает, что пропущенный шаг печатается строкой (`:27`);
   - с флагом `--no-fetch` результат тот же.
5. **`origin` нет, `workflow.finish` другой или поля нет** — `BLOCKED`, exit code 1. Причина одна и
   называет оба факта и выход. Пример: `no remote origin, and workflow.finish is pr-green-ci: add
   the remote or set workflow.finish to local-green`. Причин `fetch failed` и `no ref …` рядом с
   ней нет.
6. **Тексты.**
   - `harness/profiles/README.md`: строка `worktree.base` (`:142`) и абзац о `preflight`
     (`:238-248`) — что в репозитории без `origin` при локальном финише база локальная и fetch нет.
     Строка `workflow.finish` (`:151`): в колонку «Who reads» добавить `preflight`.
   - Шапка `harness/bin/preflight` (`:17-29`).
   - `harness/skills/epic-wave/SKILL.md:102-103`: причина после `BLOCKED:` — остановка: Wave не
     начинается, пока `preflight` не ответит `GO`. `rules.md` говорит, что значит причина и как её
     устранить, но не делает причину предупреждением. Пример действия из `rules.md`: при причине
     `another live session in the tree` перейти в свой worktree и запустить `preflight` снова — так
     же, как в `ship-ticket/SKILL.md:112-115`. Предупреждения — только строки, которые начинаются
     с `! `. Нынешние слова «which of them are only warnings» допускают прочтение, по которому
     `rules.md` делает причину `BLOCKED` предупреждением. Без этой правки агент может так же не
     учесть и настоящую блокировку — недоступный `origin`.
   - `epic-wave/SKILL.md:82-83` и `ship-ticket/SKILL.md:116-117` говорят «the base is
     `F worktree.base`». Добавить: в репозитории без `origin` база — ветка из строки базы
     `preflight`.

## Готово, когда

- [ ] Репозиторий без remote; Profile: `workflow.finish: local-green`, `worktree.base: "main"`.
      `preflight` без флагов: exit code 0, последняя строка `GO`. В выводе одна строка о том, что
      remote `origin` нет, и строка базы `main: <sha> …`. Нет слов `fetch failed`, `no ref`,
      `behind`. **Сегодня эта проверка падает:** exit code 1, `BLOCKED: fetch failed: fatal:
      'origin' does not appear to be a git repository; no ref main`.
- [ ] То же с `worktree.base: "origin/main"` и с `null`: `GO`, строка базы `main: <sha> …`.
- [ ] То же с `--no-fetch`: `GO`.
- [ ] В этом случае `gh` не вызывается (stub `gh` в `PATH` пишет файл-отметку; файла нет), в выводе
      строка о пропущенном шаге PR.
- [ ] Репозиторий без remote, `local-green`, локальной ветки из `worktree.base` нет: exit code 1,
      причина `no local branch <ветка>`.
- [ ] `origin` задан, его адрес — локальный путь, которого нет; Profile тот же (`local-green`).
      `preflight` без флагов: exit code 1, последняя строка начинается с `BLOCKED: fetch failed:`.
- [ ] `origin` отвечает, Profile `local-green`: fetch выполняется. Коммит, отправленный в `origin`
      из другого клона после последнего fetch, виден в строке базы `origin/main: <новый sha>`.
- [ ] Репозиторий без remote, `workflow.finish: pr-green-ci`, и отдельно Profile без поля
      `workflow.finish`: exit code 1; причина называет отсутствие `origin` и `workflow.finish`;
      слов `fetch failed` нет.
- [ ] Вывод в каждом случае не длиннее 20 строк (`harness/bin/preflight:11`).
- [ ] Прежние случаи `preflight.test.sh` проходят без правок ожиданий. В их числе репозиторий, у
      которого `origin` есть, а ветки `origin/main` нет: `BLOCKED: … no ref origin/main`
      (`:121-124`).
- [ ] `harness/bin/tests/harness-home.test.sh` — exit code 0 без правок ожиданий. Его репозиторий
      без remote, в Profile нет `workflow.finish` (`:45-55`, `:75`). Запуски `:186` и `:221`
      попадают под пункт 5 раздела «Что делаем» (remote нет, `workflow.finish` не `local-green`) и
      по-прежнему кончаются строкой `BLOCKED: …`.
- [ ] Новый случай в `preflight.test.sh` повторяет демо-репозиторий eval-кейса
      `ship-ticket-pr-green-ci`: remote нет, `workflow.finish: pr-green-ci`,
      `worktree.base: "main"`. Exit code 1, причина одна — из пункта 5 раздела «Что делаем».
      Сегодня там `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository;
      no ref main`.
- [ ] Тексты из пункта 6 обновлены; text-test-ы skills (`epic-wave-ship-ticket.test.sh`,
      `skill-blocks.test.sh`, `agents-text.test.sh`) — exit code 0.
- [ ] Каждое новое правило — test, красный на мутанте (мутант — намеренно испорченная версия
      кода, на которой test обязан упасть): без `origin` не блокирует при любом
      `workflow.finish`; при `local-green` fetch не выполняется никогда; неудача fetch при
      существующем `origin` — предупреждение; база без `origin` по-прежнему ищется в
      `refs/remotes/`; шаг PR зовёт `gh` без `origin`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit code 0; gate full на Mac зелёный.
- [ ] (приёмка, владелец или Orchestrator, после мержа и `pnpm install:stable`) Wave в Silent
      Project-е без `origin`, как в пункте 5 приёмки E3: `preflight` отвечает `GO`, в
      `decisions.tsv` нет строки о preflight. Результат — в «Итог» Ticket-а 26.

## Тесты

Сначала падающий test — `harness/bin/tests/preflight.test.sh`, новый случай «репозиторий без
remote, `local-green` → `GO`». На main он красный: exit code 1 и `BLOCKED: fetch failed: …; no ref
main`. В «Итог» — как он падал.

- `harness/bin/tests/preflight.test.sh` — случаи из «Готово, когда». Новые случаи запускают
  `preflight` без `--no-fetch`: иначе шаг fetch не выполняется, как во всех нынешних случаях файла.
- Сеть не нужна. Недоступный `origin` — remote с локальным путём, которого нет. Отвечающий
  `origin` — локальный bare-репозиторий, как уже сделано в файле (`:35`, `:40-41`).
- `gh` в новых случаях — stub в `PATH`: настоящий `gh` мог бы пойти в сеть.
- Файл идёт в `pnpm test` через `test/contract/harness-scripts.test.ts` (по одному случаю на
  каждый `*.test.sh`), то есть в gate и в CI на Linux.
- Правка текста skill-а меняет поведение агента, а его проверяют eval-кейсы (`harness/evals/`,
  запуск `pnpm eval:harness`). В `pnpm test` они не входят. Запускать ли их в этом Ticket-е — по
  правилу, действующему на момент работы (Ticket 27 — eval-кейсы Harness; Ticket 29 — какие
  eval-кейсы запускать по изменённым файлам правил); решение записать в «Итог».
- Eval-кейс `ship-ticket-pr-green-ci` собран на репозитории без `origin` с `pr-green-ci`
  (`harness/evals/lib/demo-project.sh:17`, `:226-227`). После правки `preflight` отвечает в нём
  другой причиной `BLOCKED`. Если eval-кейсы запускаются в этом Ticket-е, этот кейс — первый.

## Где в коде

- `harness/bin/preflight` — `load_profile` (`:146-184`), `check_gh_account` (`:200-213`) — уже
  зовёт `git remote get-url origin` (`:202`), `check_fetch` (`:215-226`),
  `check_origin_main` (`:228-234`), `check_main` (`:236-271`), `check_prs` (`:409-420`), порядок
  шагов в `main` (`:463-478`), шапка (`:1-29`).
- `harness/bin/tests/preflight.test.sh` — test-ы скрипта.
- `harness/bin/tests/harness-home.test.sh` — `:45-55`, `:75`, `:186`, `:221-228`: `preflight` в
  репозитории без remote. Ожидания не меняются.
- `harness/evals/ship-ticket-pr-green-ci/`, `harness/evals/lib/demo-project.sh:226-227` —
  eval-кейс на репозитории без `origin`. Не меняется.
- `harness/profiles/README.md` — `:142`, `:151`, `:238-248`, `:353-362`.
- `harness/skills/epic-wave/SKILL.md` — `:82-88`, `:102-104`.
- `harness/skills/ship-ticket/SKILL.md` — `:111-124`.
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`, `harness/bin/tests/skill-blocks.test.sh`,
  `harness/bin/tests/agents-text.test.sh` — проверки текстов skills.
- `harness/evals/lib/demo-project.sh:16-17`, `:219-225` — демо-репозиторий eval-кейсов; для
  справки, не меняется.

## Вне скоупа

- Репозиторий с `origin`, у которого `worktree.base` записан без `origin/` (`"main"`). Сегодня это
  причина `no ref main`. Не меняется.
- Remote под другим именем (например только `upstream`). Для `preflight` это «`origin` нет».
- Хранить факт «remote нет» отдельным полем Profile. Не делаем: факт читается из репозитория при
  каждом запуске и не устаревает.
- Убрать `origin` из демо-репозитория eval-кейсов с `local-green` (девять кейсов из десяти) —
  решение Ticket-а 27 (eval-кейсы Harness).
- Project над несколькими репозиториями: в папке над ними `preflight` отвечает exit code 2, и
  skills ведут минимальную проверку руками. Не меняется.
- `harness/bin/qmd-collections` в Full mode (режим, в котором файлы workflow лежат в самом
  репозитории Project-а) без `origin` отказывает текстом `has no origin to clone the copy from`
  (`:224-225`). Другой скрипт и другой случай.
- Перенос `preflight` на Node — Ticket `worfy-windows/06`.
- Остальные находки того же прогона: скрипты Harness без окружения login shell — Ticket 37;
  `qmd-collections` и строка `collections: {}` — Ticket 38; мелкие наблюдения (строка `Noted:`
  после `gate: VERIFIED`, даты в Ticket-е, пустая папка `.claude/worktrees/`) — Ticket 42.

## Риски

- Тот же файл целиком переписывает открытый Ticket `worfy-windows/06` (`preflight` на Node, вывод
  обязан совпасть со старой версией). Если он влит раньше — правка идёт в Node-версию. Если позже —
  он переносит новое правило вместе с его test-ами. Перед claim сверить открытые PR.
- Remote удалён или переименован по ошибке, а в Profile стоит `local-green`. `preflight` ответит
  `GO` на локальной ветке без fetch. Единственный сигнал — строка о том, что `origin` нет. Поэтому
  она печатается при каждом запуске и не прячется среди предупреждений.
- Project с `origin` и `workflow.finish: local-green` не должен потерять fetch. Так устроен
  Atakama — Project владельца над тремя репозиториями
  (`docs/adr/0045-one-ticket-one-repository.md:14-15`, `harness/profiles/README.md:242-245`). На
  это — отдельная проверка и мутант в «Готово, когда».
- Правка текста skill-а действует на всех агентов сразу. Менять одну фразу, не раздел.
- Фраза не должна отменить действие, которое `ship-ticket/SKILL.md:112-115` и `rules.md`
  Project-ов предписывают для причины `another live session in the tree` (перейти в свой worktree
  и повторить).
- Предел в 20 строк вывода (`harness/bin/preflight:11`). Строки о fetch в обычном запуске нет:
  успешный fetch ничего не печатает (`:222`), строка `! fetch skipped` появляется только с
  `--no-fetch` (`:218`). Поэтому строка об `origin` — новая, она ничего не заменяет. Предел при
  этом не нарушается: шаг PR с `origin` печатает до шести строк (`:417-419`), а без `origin`, по
  пункту 4 раздела «Что делаем», — одну. Проверка на 20 строк — в «Готово, когда».
- Правка `harness/` действует в установленной копии приложения после `pnpm install:stable` — шаг
  владельца.

## Итог

PR #565, merge 9f56c475. Платформенный PR (harness/bin): Mac gate full зелёный; на объединённом
дереве `harness-scripts` 44/44, `plugin-neutral` 26/26. Два rebase: после #549 (нейтральный текст
Harness) и после #552 (worfy-pipeline 08) — оба без потери правки.

- Выбран вариант В. `harness/bin/preflight` до fetch спрашивает `git remote`, и `workflow.finish`
  решает, допустимо ли отсутствие `origin`.
  - Нет `origin`, `local-green`: без fetch и без `gh`; одна строка
    `origin: none — local finish, the base is the local branch <branch>`; база — локальная ветка
    (`worktree.base` без `origin/`, затем `layout.repos.<repo>.default_branch`, затем `main`, `master`);
    шаг «open PRs» пропущен с причиной; итог `GO`.
  - Нет `origin`, другой finish или нет finish: ровно одна причина `BLOCKED`, которая называет оба
    факта, без `fetch failed` и `no ref` рядом.
  - `origin` есть: как раньше — fetch, и неудачный fetch блокирует, с `local-green` тоже.
- Было: `BLOCKED: fetch failed: fatal: 'origin' does not appear to be a git repository; no ref main`,
  exit 1 — у любого репозитория без remote, даже с `local-green`.
- Описание в `harness/profiles/README.md` (строка `worktree.base`) и в skill-ах `epic-wave`,
  `ship-ticket`.
- Test-ы: `harness/bin/tests/preflight.test.sh` — 54 (порядок выбора базы, строка `--no-fetch`, одна
  причина, нумерация Full mode от локального main); `harness-home.test.sh` 46/46; 4 мутанта красные.
