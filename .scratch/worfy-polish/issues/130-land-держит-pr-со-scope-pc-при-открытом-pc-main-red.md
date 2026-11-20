# 130 — `bin/land` держит PR со scope `pc`, пока открыт issue `pc-main-red`

Type: bug
Status: claimed 2026-11-20T11:02Z
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
- [ ] PR со scope `runner`, PR только с документами и PR с `main_fix: true` вливаются при открытом issue.
- [ ] Ошибка `gh issue list` или команды scope — PR ждёт, `LAND=unverified` (exit 3), не merge.
- [ ] Без настройки поведение `land` не меняется: прежние test-ы `harness/bin/tests/land.test.sh` зелёные без правок
      ожиданий.
- [ ] Новые случаи — в `harness/bin/tests/land.test.sh` (stand-in gh из `land-world.sh`); mutant «не читать issue» —
      красный.
- [ ] Job-ы Windows CI на PR зелёные (платформенный PR).

## Где в коде

- `harness/bin/land`: шапка-комментарий (формат state file, вывод), `mainAllows`, `mainGreen`, `documentsOnly`.
- `harness/bin/tests/land.test.sh`, `harness/bin/tests/land-world.sh`.
- `scripts/windows-verdict-scope.mjs` — только читать.
- `harness/skills/epic-wave/SKILL.md`: правило `pc-main-red` перед merge и сборка state file `land` (`main-fix`).
- ADR-0086, пункты 4–6; ADR-0056.
