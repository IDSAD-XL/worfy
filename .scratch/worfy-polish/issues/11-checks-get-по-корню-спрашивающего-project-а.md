# 11 — `checks.get` знает, какой Project спрашивает: бейджи Gate, PR, CI у репозитория, который ещё и отдельный Project

Type: task
Status: done — 2026-10-15, [PR #350](https://github.com/IDSAD-XL/worfy/pull/350)
Blocked by: —
Source: [spec.md](../spec.md), кандидат R8 (формулировка scout-а «Project по первому совпадению пути
вместо длинного префикса» не подтвердилась; верный долг — ниже); «Итог»
[`worfy-harness` 23](../../worfy-harness/issues/23-worfy-читает-silent-project-и-несколько-репозиториев.md),
долг [med] про `src/main/ipc/checks.ts:69-70`, `:102-104`; `HANDOFF.md`, «Дальше» — «Кандидаты в Ticket-ы»;
[ADR-0045](../../../docs/adr/0045-one-ticket-one-repository.md) (строка `Repo:` Ticket-а).

## Что происходит

- `checks.get` принимает только `root` и `branches` (`src/shared/ipc/checks.ts:126-131`). main ищет,
  чей это `root`, функцией `targetOf` (`src/main/ipc/checks.ts:68-77`): сначала среди корней Project-ов
  (`:69-70`), потом среди репозиториев Project-ов над несколькими репозиториями (`:71-75`).
- Если репозиторий `B` входит в Project `M` (над несколькими репозиториями) и **ещё** добавлен в worfy
  отдельным Project-ом, то вопрос Canvas-а Project-а `M` о `B` main разбирает как вопрос Project-а `B`:
  `namedBranches` берёт ветки из модели Project-а `B` (`:102`), а не `M`. Ветка из строки `Branch:`
  Ticket-а `M` (например, `fix/x`) там не названа, и `checks.get` отказывает (`:103-104`): у Ticket-ов
  `M` в репозитории `B` нет бейджей Gate, PR и CI.
- renderer хранит снимки по пути папки (`src/renderer/canvas/badges/use-checks.ts:164-176`,
  `branchesByRoot`): Canvas-ы `M` и `B` делят один ключ и затирают друг другу список веток.

## Что делаем

1. `checks.get` получает необязательное поле `project` — корень спрашивающего Project-а. Есть оно — main
   ищет `root` только в этом Project-е: его корень или один из его репозиториев; иначе — отказ «not a
   folder of this Project». Нет поля — как сейчас (старые вызовы и Linked machine старой версии).
2. renderer (`useChecks`) передаёт корень активного Project-а и ключует снимки парой «Project + папка».
3. Проверка доступа Linked machine (`insideProjects`) не меняется: `project` тоже должен быть
   Project-ом, к которому у вызывающего есть доступ.

## Готово, когда

- [x] Contract test: Project `M` над двумя репозиториями, один из них (`B`) — ещё и отдельный Project;
      `checks.get` с `project = M`, `root = B` и веткой `fix/x` из `Branch:` Ticket-а `M` — снимок, не отказ.
- [x] Contract test: тот же вызов без `project` — прежний результат (отказ), чтобы старый клиент вёл
      себя как раньше; `project`, в котором нет `root`, — отказ.
- [x] Unit test: два Canvas-а (`M` и `B`) с одной папкой держат разные списки веток.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/contract/github-prs.test.ts` — новые случаи рядом с test-ами `checks.get`.
- `test/unit/checks-badges.test.tsx` — ключ снимков.
- Сначала красный: первый contract test на нынешнем коде (поля нет, отказ).
- Мутанты: игнорировать `project`; ключ снимка без Project-а; принимать `project` без проверки доступа.
  Каждый краснит свой test.

## Где в коде

- `src/main/ipc/checks.ts`
- `src/shared/ipc/checks.ts`
- `src/renderer/canvas/badges/use-checks.ts`
- `test/contract/github-prs.test.ts`
- `test/unit/checks-badges.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/main/link/caller.ts`, `test/contract/link-access.test.ts`, `src/shared/workflow/types.ts`.

## Вне скоупа

- `checks.repos` (`src/main/ipc/checks.ts:107-113`): он и так ищет только корень Project-а.
- Сам `gh` и интервал опроса.

## Итог

- `checks.get` принимает необязательное поле `project` — корень Project-а, чей Canvas спрашивает
  (`src/shared/ipc/checks.ts`). С ним main ищет `root` только в этом Project-е (`targetIn`,
  `src/main/ipc/checks.ts`): его корень или его репозиторий, иначе отказ «is not a folder of the
  Project»; ветки берёт из модели спрашивающего Project-а. Без поля — прежний `targetOf`: старый
  клиент и Linked machine старой версии ведут себя как раньше (схема zod отбрасывает лишний ключ,
  так что новый клиент со старым main тоже работает по-старому).
- Доступ: `project` проходит `insideProjects`, как `root`, и должен быть Project-ом из списка этой
  Machine — иначе отказ «is not a Project of this Machine», `gh` и `git` не запускаются.
- renderer (`use-checks.ts`) ключует poller, ветки и снимки парой «Project + папка» и всегда
  передаёт `project` — корень Project-а своего Canvas-а.
- Test-ы: четыре случая в `test/contract/github-prs.test.ts` (describe «checks.get knows which
  Project asks»), два в `test/unit/checks-badges.test.tsx`. Первый contract test был красным на
  прежнем коде. Мутанты «игнорировать `project`», «принимать `project` без проверки, что это
  Project», «ключ снимка без Project-а» — каждый краснит свой test.
- Решено без владельца, подтвердить: `project`, равный самому `root`, при `root` — репозитории
  другого Project-а, судится по модели `project` (Canvas `B` видит ветки только Ticket-ов `B`).
- `pnpm lint`, `pnpm typecheck` — exit 0; `pnpm test` под нагрузкой соседних implementer-ов упал на
  двух test-ах `test/contract/workflow-reader.test.ts` по таймауту 15 с, отдельно файл зелёный
  (44/44). gate full и Linux CI — за оркестратором и PR.

### Gate оркестратора (2026-10-15)

- Wave Epic-а под Autopilot: Ticket-ы 01–05, 07–11 параллельно, общих файлов в «Где в коде» нет; 06 и 12 в команду не входили. Worktree — `.claude/worktrees/pol-<NN>`: пути `04`, `10`, `11` заняты деревьями других Epic-ов. Нагрузку CPU (`yes > /dev/null`) по своему «Готово, когда» дают 04 и 05; оркестратор пустил их параллельно с остальными, и timeout-ы под этой нагрузкой краснили gate соседей — ошибка плана, не implementer-ов.
- Гейт — один круг: `VERIFIED` на `f35c3e5` ([комментарий в PR #350](https://github.com/IDSAD-XL/worfy/pull/350#issuecomment-6188560946)). Verifier сам: `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0 (gate fast из кэша); с `project` поле `root` — подмножество того, что пускал `targetOf`, отказ до запуска `gh` и `git`: Linked machine новой папки и чужих веток не получает; смена ключа снимка читателей не ломает.
- Мерж: база `12b46d8`, head `f35c3e5`; `GATE_SCOPE=all gate full` — код 0, не из кэша, `[gate] зелено (full)` с `test:e2e` и `test:package`; CI зелёный, CLEAN; влит `056c32a`.
- Act on, Consider, Dismissed — нет.
- Noted ([low]): `src/main/ipc/checks.ts:117` — `insideProjects` для `project` повторяет проверку `targetIn` (`:84-85`), строку не держит ни один test (regex `test/contract/github-prs.test.ts:968` принимает оба отказа). **Решено без владельца, подтвердить:** при `project = B`, `root = B` ветки — из модели самого B.
