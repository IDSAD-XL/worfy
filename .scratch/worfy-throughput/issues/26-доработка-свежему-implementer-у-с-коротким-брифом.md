# 26 — Доработка — свежему implementer-у с коротким брифом, а не `SendMessage` прежнему с большим контекстом

Type: task
Status: done 2026-10-28T06:22Z
PR: #871
Blocked by: —
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», предложение 2, решение 9.

## Что происходит

- `REJECTED` verifier-а уходит «to the same implementer through `SendMessage`» (`harness/skills/epic-wave/SKILL.md:666-667`),
  так же — круг доработки по красному CI и по виновнику красного набора (`:839`, `:1051`).
- К этому моменту implementer обычно простаивал дольше 5 min (ревью, gate других PR): его cache subagent-а
  (TTL 5 min) умер, и первое же сообщение перезаписывает весь контекст — часто 100k+ token-ов — по 1,25 × цены
  входа. Короткий новый бриф — несколько тысяч token-ов.

## Что делаем

1. Правило skill-а: круг доработки — новый implementer (`F worktree.implementer`, та же ветка и worktree) с
   брифом: Ticket, PR, ветка, head, список находок группы «Act on», путь к отчёту verifier-а, напоминание о
   test-е на каждое новое поведение (та же фраза, что сейчас в `:668-670`).
2. Исключение: прежний implementer закончил меньше 5 min назад — можно `SendMessage` (его cache ещё жив).
   Время берётся из журнала Wave.
3. То же для кругов по красному CI и по виновнику набора.

Нужен ПК: нет. **Трогает Harness: да** — `harness/skills/epic-wave/SKILL.md`; слово владельца дано 2026-10-28
(решение 1). Вердикт Windows: не платформенный PR (текст skill-а).

## Готово, когда

- [ ] Текст skill-а в трёх местах (`:666`, `:839`, `:1051` или их новые строки) говорит «новый implementer с
      брифом», исключение 5 min и состав брифа; `harness/bin/tests/epic-wave-ship-ticket.test.sh` (или
      `skill-blocks.test.sh`) проверяет фразы — exit 0.
- [ ] Шаблон брифа доработки — блок в skill-е; test проверяет, что в нём есть строки Ticket, PR, Branch, Head,
      Findings, Verifier report.
- [ ] Shell test-ы Harness — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а).
- [ ] (вручную, после обновления Stable copy) Первые три круга доработки — свежим агентом; число кругов и
      стоимость круга до и после — по Ticket-у 19, в «Итог».

## Где в коде

- `harness/skills/epic-wave/SKILL.md` (раздел 3 «Verification gate», `:666-670`; `:839`; раздел 4, `:1051`)
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`

## Вне скоупа

- Правило implementer-а об ожидании — Ticket 25.

## Итог

- Правило в `harness/skills/epic-wave/SKILL.md`, раздел 3 «Verification gate»: круг доработки — новый агент
  `worfy:implementer` на той же ветке, с коротким брифом, а не `SendMessage` прежнему
  implementer-у. Исключение — прежний отчитался меньше 5 min назад (его cache ещё жив); неизвестное время
  считается старше. Иначе Orchestrator удаляет простаивающий worktree прежнего круга и запускает нового
  агента с параметром Agent `isolation: "worktree"`. Ветка запушена (`pr-green-ci`) — `git worktree remove`
  и `git branch -D`, новый агент берёт ветку из origin (`git checkout -B <branch> origin/<branch>`).
  `local-green` или репозиторий без `origin` — ничего не запушено, локальная ветка — единственная копия
  commit-ов первого круга и commit-ов `gate: REJECTED`, по которым считаются круги: только
  `git worktree remove`, ветка остаётся, новый агент делает `git checkout <branch>` (worktree-ы делят ветки).
  Если `git worktree remove` отказывает (неотслеживаемые или изменённые файлы), Orchestrator смотрит, что
  там, а не удаляет силой. В обоих случаях новый агент первым делает rebase. Правило действует для всех кругов доработки skill-а: `REJECTED`, узкий круг, красный check,
  виновник красного набора, revert PR.
- Шаблон брифа доработки — блок «The rework brief» там же: строки Rework, Repository, Ticket, PR, Branch,
  Worktree (дерево запуска с `isolation "worktree"` и `git checkout -B`), Head (HEAD ветки до доработки),
  Findings, Verifier report и напоминание о test-е на каждое новое поведение; остальные строки — из первого
  брифа (раздел 2). `<sha>` для `git diff <sha>..HEAD` второго круга — head после rebase из комментария PR.
- Раздел 4: красный check и виновник красного набора идут «to a rework round (section 3, a fresh implementer)»
  вместо «back to its implementer».
- `harness/agents/implementer.md`: implementer круга доработки начинает в свежем дереве своего запуска
  (`isolation: "worktree"`), не вызывает `EnterWorktree` и не создаёт другое дерево, берёт ветку из origin (при `local-green` или без
  `origin` — локальную ветку),
  делает rebase от `Head` и пушит в тот же PR; отказ Edit не обходится через Bash.
- Test-ы: `harness/bin/tests/epic-wave-ship-ticket.test.sh`, блок 7e — фразы правила, исключение 5 min, шесть
  строк шаблона (Ticket, PR, Branch, Head, Findings, Verifier report), напоминание о test-е, правка раздела 4 и
  implementer.md. Первый круг: test круга 1 против документов main — 18 FAIL, после — exit 0 (389 проверок).
- Круг доработки 2 (head до него — dd38a4ff): бриф доработки получил `spec:` в строке Ticket, строки Files и
  Wave neighbours' files первого брифа; Worktree — абсолютный путь, «work in it, do not create one»; Head —
  HEAD ветки до rebase, implementer делает rebase первым. Исключение 5 min считается от финального отчёта
  до отправки брифа. `implementer.md`: в круге доработки нет `EnterWorktree` — правка по абсолютным путям,
  Bash как `cd <worktree> && …`, нет дерева или не та ветка — вопрос; шаги 1–2 ship-ticket пропускаются,
  head после rebase — в комментарии PR. Test-ы: метки Rework, Repository, Worktree, spec, Files, Head,
  строки правила и брифа ≤ 100 символов, новые фразы implementer.md; 12 mutant-ов — каждый даёт FAIL.
  Итог: 398 проверок, exit 0; против документов dd38a4ff — 10 FAIL, против main — 26 FAIL. Рост текста
  SKILL.md + implementer.md за круг — +429 байт. Правило о worktree этого круга (абсолютные пути без
  `EnterWorktree`, «work in it, do not create one») заменено кругом 3.
- Круг доработки 3, узкий (head до него — 48614ca3): `EnterWorktree` отказал subagent-у, запущенному из корня
  репозитория, и по `path`, и по `name`. Поэтому implementer круга доработки запускается с
  `isolation: "worktree"` и берёт ветку из origin; Orchestrator перед этим удаляет простаивающий worktree
  прежнего круга. Строка Worktree брифа и `implementer.md` переписаны под это; `<sha>` для diff второго
  круга — head после rebase из комментария PR. Test-ы: 13 новых или изменённых проверок, старые формулировки
  («do not create one», «already after the rebase», `EnterWorktree` с правкой по абсолютным путям) дают FAIL.
  Итог: 407 проверок, exit 0; против документов 48614ca3 — 13 FAIL; `agents-text.test.sh` — exit 0.
- Круг доработки 4 (head до него — 6f44cd03): находка high — правило удаляло ветку (`git branch -D`) и при
  `local-green` или без `origin`, где ничего не запушено, то есть стирало единственную копию commit-ов
  первого круга и commit-ов `gate: REJECTED`. Правило разделено: запушенная ветка — как раньше;
  `local-green` или без `origin` — только `git worktree remove`, ветка остаётся, новый агент делает
  `git checkout <branch>`. То же в строке Worktree брифа (комментарий для local-green) и в `implementer.md`
  (там же: при local-green head — в отчёте, push нет). Отказ `git worktree remove` — смотреть, что в дереве,
  не удалять силой. Уборка после merge удаляет и ветку изоляции круга доработки (`worktree-agent-<id>`).
  Test-ы: 13 новых или изменённых проверок (в том числе: в правиле local-green нет `git branch -D <branch>`
  и `origin/<branch>`); против документов 6f44cd03 — 13 FAIL; mutant «local-green снова удаляет ветку» —
  FAIL. Итог: 418 проверок, exit 0; `agents-text.test.sh` — exit 0.
- Не сделано: ручной пункт «первые три круга доработки — свежим агентом, число и цена кругов по Ticket-у 19» —
  после обновления Stable copy.
- Закрытие: PR #871, влит 2026-10-28 после четырёх кругов доработки (четвёртый разрешён правилом владельца о
  предельном числе кругов: оставалась находка high). Долг (low, из VERIFIED-комментариев): `git worktree remove`
  отказывает и на worktree, запертом `claude agent`, — текст должен сначала говорить `git worktree unlock`;
  ветка изоляции агента (`worktree-agent-<id>`) остаётся после `git checkout -B`.
