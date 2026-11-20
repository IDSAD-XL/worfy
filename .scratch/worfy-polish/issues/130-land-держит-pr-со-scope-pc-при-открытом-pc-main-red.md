# 130 — `bin/land` держит PR со scope `pc`, пока открыт issue `pc-main-red`

Type: bug
Status: claimed 2026-11-20T11:02Z
PR: #2088
Branch: worfy-polish/130
Blocked by: none
Source: решение владельца 2026-11-20 («со всем согласен»). ADR-0086, пункт 4, не исполнялся: с 2026-11-17 по
2026-11-19 не меньше 12 PR со scope `pc` влиты, пока был открыт issue #1513 с меткой `pc-main-red`.

Кто: агент. Глубина review — `medium`. Это правка script-а Harness-а — платформенный PR (ADR-0056): вердикт
Windows — job-ы Windows в CI.

## Что происходит

- ADR-0086, пункт 4: пока открыт issue GitHub с меткой `pc-main-red`, PR со scope `pc` не вливается и ждёт. Scope
  печатает `node scripts/windows-verdict-scope.mjs <base> <head>` из checkout-а `main` (`pc` и exit 1 или `runner` и
  exit 0). Пункт 5: исключение — PR, который чинит этот красный.
- Skill epic-wave пишет то же правило словами (раздел про gate на другой машине: «Before merging any PR that needs
  this check — in a wave or not — read that place»), но `harness/bin/land` его не проверяет. `land` держит PR только
  при красном `ci-ok` на `main` (`mainAllows`, `mainGreen`): исключения там — `main_fix` и PR только с документами.
- Правила проекта (`rules.md`) пускают PR со scope `pc` в merge по `ci-ok`, `review` и `check/windows` `success`.
  Orchestrator вливает через `land`, issue не читает никто — так PR и прошли мимо issue #1513.

## Что делаем

1. В `land` — проверка «красный `main` на другой машине»: перед merge PR, которому она нужна, читать открытые issue
   с меткой из настройки проекта (worfy: `gh issue list --label pc-main-red --state open`). Есть открытый — PR ждёт
   с причиной, которая называет issue: номер, заголовок (SHA) и URL.
2. Какие PR держит проверка — решает команда проекта, а не `land`: Harness не знает про Windows и ПК
   (ADR-0074, Harness без языка и без проекта). Worfy: PR со scope `pc` по `scripts/windows-verdict-scope.mjs`
   на base и head PR, запуск из checkout-а `main`. Exit code не 0 и не 1 — PR ждёт как непроверенный, не вливается.
3. Где настройка (поле profile или state file `land`) — выбрать по соседним полям (`docs_check`, `main_fix`) и
   записать в «Итог». Без настройки проверка выключена: проекты без другой машины не меняются.
4. Не держит: PR только с документами (то же правило `docs_only`, что при красном `main`) и PR с `main_fix: true`
   (ADR-0086, пункт 5). Строка лога говорит, почему PR влит при открытом issue.
5. Не прочитался `gh issue list` — PR ждёт (unverified), не вливается.
6. Обновить шапку-комментарий `land` и раздел epic-wave о gate на другой машине: держит теперь `land`.

## Готово, когда

- [ ] При открытом issue с меткой из настройки PR со scope `pc` ждёт; строка `#N waits:` называет issue (номер и URL).
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 99b2018718af8184109bbe8e0ad915a53eea6bd0
- [ ] PR со scope `runner`, PR только с документами и PR с `main_fix: true` вливаются при открытом issue.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 99b2018718af8184109bbe8e0ad915a53eea6bd0
- [ ] Ошибка `gh issue list` или команды scope — PR ждёт, `LAND=unverified` (exit 3), не merge.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 99b2018718af8184109bbe8e0ad915a53eea6bd0
- [ ] Без настройки поведение `land` не меняется: прежние test-ы `harness/bin/tests/land.test.sh` зелёные без правок
      ожиданий.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 99b2018718af8184109bbe8e0ad915a53eea6bd0
- [ ] Новые случаи — в `harness/bin/tests/land.test.sh` (stand-in gh из `land-world.sh`); mutant «не читать issue» —
      красный.
  - evidence: test-run pass · `bash harness/bin/tests/land.test.sh` exit 0 · mac - · 99b2018718af8184109bbe8e0ad915a53eea6bd0
- [ ] Job-ы Windows CI на PR зелёные (платформенный PR).

## Где в коде

- `harness/bin/land`: шапка-комментарий (формат state file, вывод), `mainAllows`, `mainGreen`, `documentsOnly`.
- `harness/bin/tests/land.test.sh`, `harness/bin/tests/land-world.sh`.
- `scripts/windows-verdict-scope.mjs` — только читать.
- `harness/skills/epic-wave/SKILL.md`: правило `pc-main-red` перед merge и сборка state file `land` (`main-fix`).
- ADR-0086, пункты 4–6; ADR-0056.

## Итог

Код — commit `99b201871` на ветке `worfy-polish/130`.

**Что изменилось.**
- **`land` читает красный `main` на другой машине сам.** Новое необязательное поле state file
  `red_elsewhere: {label, needs}`. Перед merge (и ещё раз под lock-ом `main`) `land` спрашивает
  `gh issue list --label <label> --state open --json number,title,url`. Нет открытых issue — PR идёт дальше, команда
  `needs` не запускается. Есть — `land` запускает `needs` в checkout-е `main` (`repo` state file), подставив вместо
  `<base>` и `<head>` точку ответвления PR (`git merge-base <head> <remote>/<branch>`) и head. Exit 1 — PR ждёт с
  причиной `main is red elsewhere: open <label> issue #<N> "<title>" <URL> — the PR needs that machine …`
  (`kind: waits`, `LAND=unverified`). Exit 0 — PR вливается, в log строка `red_elsewhere.needs exit 0 — merged while
  <label> issue #N is open`. Любой другой exit code, ошибка `gh issue list` или head, которого нет у git, — PR ждёт
  (unverified), merge нет.
- **Исключения.** PR с `main_fix: true` (пункт 5 ADR-0086) — issue не читается, в log `main_fix — not held by open
  <label> issues`. PR только с документами (то же правило `docs_only` / tickets root, что при красном CI на `main`) —
  в log `documents only — merged while <label> issue #N is open`, команда `needs` не запускается.
- **Без `red_elsewhere`** (`null` или поля нет) `land` не читает issue вообще — поведение прежнее.
- **Skill epic-wave.** Блок, который пишет state file `land`, принимает два новых позиционных аргумента после
  `<documents-only command>`: `<red-elsewhere label>` и `<red-elsewhere command>` (worfy: `pc-main-red` и
  `node scripts/windows-verdict-scope.mjs <base> <head>`), оба пустые — `red_elsewhere: null`. Правило «Before merging
  any PR that needs this check» говорит, что на пути `land` его теперь держит `land`; список условий `land` получил
  пункт про `red_elsewhere`.

**Решения (решено без владельца).**
- Настройка — поле state file, а не поле profile: соседи `docs_check` и `docs_only` тоже поля state file, которые
  orchestrator заполняет по правилам проекта; profile и его README не меняются (ADR-0074: Harness не знает про ПК и
  Windows). Цена: orchestrator должен передать метку и команду в блок skill-а — без них проверка выключена, как и
  требует пункт 3 тикета.
- Порядок: сначала issue, потом команда scope. В обычном случае (issue закрыт) лишнего запуска нет; цена — при
  сбое `gh issue list` ждёт и PR со scope `runner` (как и при сбое чтения push run-ов `main`).
- `<base>` — SHA точки ответвления, а не `origin/main`: подстановка SHA одинаково читается в `sh` и в `cmd.exe`
  (Git Bash на Windows), а `windows-verdict-scope.mjs` считает diff `base...head` от точки ответвления — результат тот
  же.
- Несколько открытых issue — причина называет все через запятую.

**Пункт 4 («без правок ожиданий»).** Ожидания прежних case-ов `land.test.sh` не менялись. Изменился только вызов
блока skill-а в case-ах «skill: …» (два новых позиционных аргумента) и к ним добавлены проверки `red_elsewhere`.

**Проверки.** `bash harness/bin/tests/land.test.sh` — до кода exit 1 (14 FAIL новых case-ов), после — exit 0
(passed 137). Mutant «не читать issue» (вызов `elsewhereAllows` убран из `ready`) — exit 1, 9 FAIL. `land-story.test.sh`,
`land-epic-story.test.sh`, `agents-text.test.sh` — exit 0. `pnpm lint`, `pnpm typecheck` — exit 0. gate fast не
запускался: file-watcher test-ы на этом Mac красные из-за fseventsd (известная проблема машины).

**Не проверено.** Пункт 6 — job-ы Windows CI на PR: вердикт orchestrator-а по CI. Настоящий `gh issue list` и
настоящий `scripts/windows-verdict-scope.mjs` под `land` не запускались — в test-ах stand-in gh и stub команды scope.
