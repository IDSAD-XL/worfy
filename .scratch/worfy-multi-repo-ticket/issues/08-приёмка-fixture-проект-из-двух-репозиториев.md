# 08 — Приёмка: fixture-проект из двух репозиториев со stub `gh` и `npm`; настоящий Ticket в рабочем проекте

Type: task
Status: blocked 2026-11-10T04:34Z
Blocked reason: fixture tests merged in #1767 (100acec94); item 2 waits: the owner runs a real Ticket of two repositories in Mac Stable
Waits: owner
Branch: worfy-multi-repo-ticket/08
Blocked by: 02, 06, 07
Source: [spec.md](../spec.md), «Что видит пользователь», п. 1–7; «Ticket-ы», «Волны» (Wave 5); «Решения владельца
2026-11-09», Q8; [ADR-0104](../../../docs/adr/0104-one-ticket-several-repositories.md), «Последствия»

Платформенный Ticket: нет. Глубина ревью — `low`.

Приёмка по готовому: идёт после Ticket-ов 01–07. Ни один Ticket с несколькими `Repo:` не пишется в настоящем Project-е,
пока не влиты 01–03 (spec, «Волны»).

## Что делаем

1. **Fixture test-ы** (Q8): stub-проект из двух репозиториев (библиотека и потребитель) под
   `harness/bin/tests/fixtures/multi-repo/`, stub `gh` и `npm`. Путь «Что видит пользователь», п. 1–7:
   - Ticket с двумя `Repo:`, библиотека первой; одна ветка в обоих checkout-ах;
   - `ticket pr` на оба PR; `ticket release`; `epic-status` показывает оба PR и «waits for release»;
   - `ticket done` с одним PR — отказ; release замечен (stub tag или stub `npm view`), оба PR влиты — `done`;
   - Ticket с одним `Repo:` в том же fixture — как сегодня.
2. **Один настоящий Ticket в рабочем проекте** (Q8) ведёт владелец: правка через библиотеку и потребителя от claim до
   `done`. Итог — `.scratch/worfy-multi-repo-ticket/evidence/08-*`, без имён репозиториев, хостов и людей рабочего
   проекта.

## Готово, когда

- [ ] Fixture test-ы проходят весь путь из п. 1 — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/bin/tests/multi-repo.test.sh` exit 0, passed 35, failed 0 · mac - · e9ead1b5df286705d14ac20be4b33bdda045516a
  - evidence: gate pass · `gate fast` exit 0 · mac - · e9ead1b5df286705d14ac20be4b33bdda045516a
  - evidence: test-run pass · `bash harness/bin/tests/multi-repo.test.sh` exit 0, passed 35, failed 0, also with a jq that ends lines with CRLF · mac - · c7bfa5117b06be436465310aa6f08209666e8873
  - evidence: gate pass · `gate fast` exit 0 · mac - · c7bfa5117b06be436465310aa6f08209666e8873
- [ ] Владелец провёл настоящий Ticket из двух репозиториев до `done`: одна карточка на Pipeline board, «1/2 merged»,
      «waits for release <version>», PR без ссылок друг на друга.
  - needs: mac stable
- [ ] Evidence в `.scratch/worfy-multi-repo-ticket/evidence/08-*` без данных рабочего проекта.
  - evidence: commit pass · Evidence of the fixture run of a ticket over two repositories · - - · e9ead1b5df286705d14ac20be4b33bdda045516a
- [ ] `ci-ok` на PR зелёный.

Шаги приёмки владельца — из `.scratch/owner-acceptance-guides.md` (перенесены 2026-11-24, `worfy-acceptance` 08): подготовка Orchestrator-а — пункты без метки, шаги владельца — пункты с меткой, по одному на шаг.

- [ ] Orchestrator: сверит Profile рабочего Project-а — оба репозитория должны быть в его списке репозиториев.
- [ ] Orchestrator: в `workflow.pipeline` нет стадии `release` (прочитано 2026-11-20), без неё карточка не покажет
      «waits for release …»; спросит одной строкой, добавить ли её через `profile-set` (место в списке — по
      `harness/profiles/README.md`).
- [ ] Orchestrator: проверит, что Session рабочего Project-а в Mac Stable видит новый `ticket` CLI (`ticket pr`,
      `ticket release`).
- [ ] (вручную) Сделай: выбери настоящую правку через библиотеку и её потребителя и скажи Orchestrator-у рабочего
      Project-а записать её одним Ticket-ом с двумя строками `Repo:`, библиотека первой → Должно быть: на Ticket Node
      chip называет оба репозитория в порядке строк `Repo:`.
  - needs: mac stable
- [ ] (вручную) Сделай: после ревью агентов открой Pipeline board (View switch в toolbar → «Pipeline») → Должно быть:
      одна карточка Ticket-а, по строке на репозиторий: `<библиотека> #N · open`, `<потребитель> #M · open`. На Ticket
      Node «Open PR» — меню с двумя пунктами.
  - needs: mac stable
- [ ] (вручную) Сделай: открой оба PR на GitHub → Должно быть: PR ничего не говорят друг о друге; PR потребителя —
      draft, в нём подъём версии библиотеки.
  - needs: mac stable
- [ ] (вручную) Сделай: когда коллеги вольют PR библиотеки, посмотри на карточку → Должно быть: `1/2 merged`, строка
      `waits for release <версия>`; Ticket ещё в работе. Красный CI потребителя до release карточку не красит.
  - needs: mac stable
- [ ] (вручную) Сделай: когда команда выпустит версию, посмотри снова → Должно быть: строка `waits for release …`
      ушла; PR потребителя вышел из draft. Если вместо неё `release <версия> not checked` — worfy не смог спросить
      remote или registry; скажи Orchestrator-у.
  - needs: mac stable
- [ ] (вручную) Сделай: когда коллеги вольют PR потребителя → Должно быть: `2/2 merged`, Ticket `done`.
  - needs: mac stable
- [ ] Orchestrator: после `done` заполнит раздел «Настоящий Ticket» в [evidence](../evidence/08-fixture.md): только
      роли (библиотека, потребитель) и номера PR, без имён репозиториев, хостов и людей. Снимки — с затёртыми именами.
- [x] (вручную) Сделай: подтверди решение без владельца — Ticket 05 (стадия `release`;
      [Ticket](../issues/05-стадия-release.md), «Итог»): «ошибка `npm view` с E404 (пакета ещё нет вовсе) — тоже `not
      checked`, а не `waiting`: частная registry без доступа отвечает так же». Пакет, который ни разу не публиковали,
      карточка покажет как `release <версия> not checked`, а не `waits for release` → Должно быть: Pass —
      «подтверждаю», Fail — «в Ticket».
  - needs: mac
  - evidence: owner-check pass · 2026-11-26: все да (decisions list 2026-11-25, item 14) · mac stable · eba77845a211c80d99160cc69be975917d3d29f9

## Тесты

- Fixture test-ы Harness-а над `harness/bin/tests/fixtures/multi-repo/` (stub `gh`, `npm`).

## Где в коде

- `harness/bin/tests/fixtures/multi-repo/**`
- `.scratch/worfy-multi-repo-ticket/evidence/08-*`
