# 05 — Implementer пишет story PR перед PR (`ship-ticket`), ссылка в тексте PR, guard на merge

Type: feature
Status: claimed 2026-11-16T07:26Z
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), «Ticket-ы», строка 05; «Решения владельца» 7, 8, 10, 12, 14, 16, 25 (строки 98–116,
129–131); «Решения по реализации» → Harness: «Implementer», «Guard», «Язык» (строки 210–216, 236–237); «Решения по
test-ам», В (строки 285–289); «Риски»: «Отказ `reasoning_extraction`», «Guard остановит все PR…», «Codex»
(строки 346–356); истории 2, 3, 29–31

Кто: агент.

## Что происходит

- Implementer доводит Ticket до PR по skill `ship-ticket`. Evidence-строки он пишет перед PR
  (`harness/skills/ship-ticket/implementer-finish.md`); отчёт — по `harness/skills/ship-ticket/implementer-report.md`.
- Текст PR сейчас заполняет `gh pr create --fill` (`harness/skills/ship-ticket/step-8-pr-and-ci.md:14`). Шаблона нет.
  Свой раздел в тексте PR уже добавляет cross-machine checks: `gh pr edit --body-file` (там же, строки 20–61).
- PR Ticket-ов вливает `harness/bin/land`. Guard-а story нет.
- `story-check` (Ticket 02) и поле `code_stories.pr` (Ticket 03) уже есть.
- На просьбу вести «a running log of its reasoning» API отвечает отказом `reasoning_extraction`.

## Что делаем

1. Новый шаг `ship-ticket` перед PR, рядом с Evidence-строками, — только если `bin/profile --field code_stories.pr`
   включено:
   - написать story PR `<tickets root>/<epic>/stories/NN-<slug>.md` по формату `harness/bin/TICKETS.md`;
   - прогнать `story-check`; при красном исправить story и прогнать снова;
   - закоммитить story в тот же PR.
2. Инструкция просит решения и доказательства, а не ход рассуждений:
   - каждое поле шага;
   - «не записано», когда причины нет;
   - порядок объяснения: первый шаг — что было не так; последние — что не меняли и как проверено;
   - размер: 1–3 шага у маленького PR, до 10 у большого;
   - язык — `language.reports` из `bin/profile`; код, имена и термины — как в коде.
3. Правки по review — в той же ветке. Story обновляется вместе с кодом, `story-check` прогоняется на последнем head
   (решение 12).
4. Путь story — в отчёте implementer-а (`implementer-report.md`). Ссылка на story — в тексте PR, своим разделом через
   `gh pr edit --body-file`, как раздел cross-machine checks.
5. Режим Silent: story ложится в папку Workflow, ветка её не получает (`implementer-silent-mode.md`).
6. Guard в том же Ticket-е, не раньше: если `code_stories.pr` включено, PR Ticket-а без своей story или с красным
   `story-check` не вливается. Место — `land` (перед `gh pr merge`) или gate; выбор и причину записать в «Итог»
   (решение 25). PR без Ticket-а (`prs[].epic` пустой) guard не трогает.
7. Codex implementer работает по тому же skill. Как он держит инструкцию, проверит первый Ticket на Codex: это не
   условие готовности.
8. Решение review Ticket-а 02: guard в `land` не читает story из рабочего дерева. Он достаёт `<head PR>:<путь story>`
   через `git show` во временный файл и прогоняет на нём `story-check` с `--repo <checkout>` и `--head <head>`
   (`story-check` идёт только против head-а PR; номера строк — head-а PR).
9. Решение review Ticket-а 02, режим Silent: пока PR нет, якорь story — `HEAD` ветки. Implementer сначала коммитит код,
   потом пишет story; `story-check` отказывает story, чей код не закоммичен.

## Готово, когда

- [ ] `ship-ticket` (и его файлы `implementer-*.md`) содержит шаг story PR с `story-check` и условием `code_stories.pr`;
      skill-text test-ы Harness-а (`skill-blocks.test.sh`, `agents-text.test.sh`, `plugin-neutral.test.sh`) зелёные.
- [ ] В инструкции нет просьбы вести ход рассуждений; test текста skill-а ловит слова «reasoning log» и
      «running log of its reasoning», если их кто-то вернёт.
- [ ] Shell-test guard-а: PR Ticket-а без story при включённом `code_stories.pr` — не вливается, причина названа;
      с красным `story-check` — не вливается; с зелёной story — вливается; при выключенном поле — вливается без story;
      PR без Ticket-а — guard его не трогает.
- [ ] `implementer-report.md` называет путь story в отчёте; `step-8-pr-and-ci.md` — раздел ссылки на story через
      `--body-file`.
- [ ] Режим Silent: shell-test (по образцу `silent-mode.test.sh`) — ветка story не получает, guard ищет её в папке
      Workflow.
- [ ] Все `harness/bin/tests/*.test.sh` зелёные; gate fast — exit 0.

## Тесты

- Shell-test-ы guard-а и Silent из пунктов выше; каждый сначала красный. Поведение самого implementer-а ловит eval
  (Ticket 14).

## Где в коде

- `harness/skills/ship-ticket/SKILL.md`
- `harness/skills/ship-ticket/implementer-finish.md`
- `harness/skills/ship-ticket/implementer-report.md`
- `harness/skills/ship-ticket/implementer-silent-mode.md`
- `harness/skills/ship-ticket/step-8-pr-and-ci.md`
- `harness/agents/implementer.md`
- `harness/bin/land` (если guard в `land`) или `harness/hooks/gate.mjs` (если в gate)
- `harness/bin/tests/land.test.sh` (или новый `harness/bin/tests/story-guard.test.sh`)
- `harness/bin/tests/silent-mode.test.sh`

Только читать: `harness/bin/story-check`, `harness/bin/profile`, `harness/bin/TICKETS.md`.

## Вне скоупа

- Пункт verifier-а и шаг review в story — Ticket 06. Eval — Ticket 14.

## Итог

- Guard стоит в `land`, в условии merge (`ready`), перед `gh pr merge`, а не в gate. Причины: gate бежит на каждом
  head-е ветки, в том числе до того, как implementer написал story, и краснел бы на каждой промежуточной проверке;
  `land` — одно место, где PR Ticket-а вливается, он уже знает `epic` и `ticket` PR и его head, а условие перечитывается
  под замком main. Переключатель `code_stories.pr` `land` читает сам через `bin/profile -C <checkout>`: Orchestrator не
  может его забыть в state-файле. Profile не читается (exit 1) — PR ждёт; у checkout-а нет Profile (exit 3) — story не
  нужна.
- Story читается из head-а PR (`git show <head>:<путь>` во временный файл), в режиме Silent и при tickets root вне
  репозитория — из папки, которую печатает `ticket root`. `story-check` идёт с `--repo <checkout> --head <head>`; флаг
  `--pr-head` брифа — для глав story Epic-а, story PR он отвергает, поэтому здесь `--head`.
- `story-check` отказывает (exit 1), когда story читается против `HEAD`, а цитируемый файл изменён и не закоммичен;
  правило записано и в `harness/bin/TICKETS.md`, раздел «Story anchor».
- Шаг implementer-а — `harness/skills/ship-ticket/story-pr.md`; его называют `agents/implementer.md` (шаг 6),
  `implementer-finish.md` и `step-8-pr-and-ci.md`. Ссылка на story в тексте PR — блок шага 8 (`## Code story` через
  `--body-file`), в режиме Silent текст PR её не получает.
