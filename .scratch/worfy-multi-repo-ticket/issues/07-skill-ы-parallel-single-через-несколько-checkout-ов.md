# 07 — Тексты skill-ов для `parallel: single` через несколько checkout-ов

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Для какого Project-а»; «Что видит пользователь», п. 2–6; «Как работает» → «Работа
implementer-а и ревью (Ticket 07; Q5)», «Release и подъём версии», «Половина влита (Q4, Q7)»; «Решено без владельца»;
«Ticket-ы», «Волны» (Wave 2); «Ответ на критику», п. 2; «Решения владельца 2026-11-09», Q2, Q3, Q5–Q7;
[ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), пункты 2–4, 6–9; места из
[Ticket 80 Epic-а worfy-polish](../../worfy-polish/issues/80-один-ticket-на-несколько-репозиториев.md)

Платформенный Ticket: нет (тексты skill-ов). Глубина ревью — `medium`.

Описывает команды `ticket` из Ticket-а 01.

## Что происходит

- `harness/skills/epic-wave/SKILL.md:106–107` — «each ticket works in the repository of its `Repo:` line (one ticket —
  one repository…)».
- `harness/skills/ship-ticket/implementer-silent-mode.md:19` — «you work in the repository of the ticket's `Repo:` line
  only».
- `harness/skills/ship-ticket/step-9-merge.md:37` — merge Ticket-а — «a set of one PR … `PRS=(<N>)`».
- `harness/skills/ship-ticket/SKILL.md:155` — в `parallel: single` worktree нет; ветку называет
  `harness/skills/ship-ticket/step-2-silent-branch.md`.

## Что делаем

Правила для Ticket-а с несколькими строками `Repo:` в Project-е `parallel: single` (тексты skill-ов — английские,
ADR-0074):

1. **Ветка.** Implementer создаёт ветку с одним именем (Q2) в main checkout-е каждого репозитория из строк `Repo:`
   (пути — `_resolved.repos`) и работает в них. Один Ticket за раз: Ticket занимает все свои checkout-ы. `silent-check`
   проверяет ветку в каждом репозитории.
2. **Gate fast** — в каждом checkout-е: у каждого репозитория своя запись в Gate (ADR-0018).
3. **Каждый PR безопасен сам по себе** (Q7): изменение библиотеки обратно совместимо, старые потребители после её
   merge-а и release работают. Implementer делает так, ревьюер проверяет.
4. **Одно ревью** (Q5): ревьюер получает diff-ы всех репозиториев и проверяет каждый и стык — совпадают ли вызовы с
   API, совместима ли библиотека со старыми потребителями. Отметка `review` — на head каждой ветки. Новый head любой
   ветки снимает verdict всего Ticket-а; новое ревью смотрит дельту и стык.
5. **PR вместе после `review success`**, в порядке строк `Repo:`, каждый записан `ticket pr <epic> <NN> <repo>#N`.
   Описание PR — о своей правке, о соседних PR ни ссылки, ни фразы (Q6); `silent-check` проверяет каждое.
6. **Release** (Q3): ветка потребителя несёт подъём версии библиотеки; implementer пишет строку `Release:`
   (`ticket release`). PR потребителя открывается draft. Release делает команда; когда он замечен, Orchestrator
   выводит PR потребителя из draft (`gh pr ready`). Если `rules.md` Project-а говорит, что команда делает это сама, —
   Orchestrator только сообщает. Обновление lockfile после release — новый head: ревью смотрит только эту дельту.
7. **Merge — люди** (`workflow.merge: null`). Частично влитый Ticket остаётся `claimed` и чинится вперёд в том же
   Ticket-е; worfy никогда не предлагает revert влитого PR (Q7). `ticket done --pr <repo>#N` на каждый PR — когда влиты
   все.
8. Ticket с одним репозиторием — тексты для него не меняются.

## Готово, когда

- [ ] `epic-wave/SKILL.md`, `ship-ticket/SKILL.md` (раздел 2), `implementer-silent-mode.md`, `step-2-silent-branch.md`,
      `step-9-merge.md` описывают п. 1–7 для Ticket-а с несколькими `Repo:` и не меняют путь Ticket-а с одним.
- [ ] Ни один текст не обещает `land` через несколько репозиториев, `parallel: worktrees` через несколько репозиториев
      или ссылки между PR (spec, «Не в этом Epic-е»).
- [ ] Test-ы Harness-а, которые читают эти skill-ы, — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Новых test-ов кода нет: Ticket правит тексты. Путь целиком проверяет приёмка (Ticket 08).

## Где в коде

- `harness/skills/epic-wave/SKILL.md`
- `harness/skills/ship-ticket/SKILL.md` (раздел 2)
- `harness/skills/ship-ticket/implementer-silent-mode.md`
- `harness/skills/ship-ticket/step-2-silent-branch.md`
- `harness/skills/ship-ticket/step-9-merge.md`
