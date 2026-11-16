# 02 — Script `story-check` и его shell-test

Type: feature
Status: claimed 2026-11-16T01:10Z
Branch: worfy-code-stories/02
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», строка 02; «Решения владельца» 12, 24 (строки 106–108, 128);
«Решения по реализации» → Harness: «Script `story-check`» (строки 207–209); «Решения по test-ам», А (строки 279–281);
«Риски»: «Строки уезжают после rebase», «Публичный репозиторий» (строки 348–358); возражение 3
[критика](../../../docs/product/critic/worfy-code-stories-2026-11-15.md)

Кто: агент.

## Что происходит

- Проверить story сейчас нечем. Пять правил правдивости (решение 12) опираются на script: он сверяет фрагменты story с
  кодом, а guard (Ticket 05) не пропускает красный результат.
- Образцы в `harness/bin/`: `shortcut-ledger` (script с перечнем находок и exit code) и `evidence-check` (личные данные
  через `harness/lib/privacy.cjs`, находки маскируются).
- Новый shell-test в `harness/bin/tests/` раннер подхватывает сам, без правки раннера.
- Формат story и правило привязки фрагментов к commit-у задаёт Ticket 01 (`harness/bin/TICKETS.md`, fixture-ы
  `harness/bin/tests/fixtures/code-story/`).

## Что делаем

1. `harness/bin/story-check` по образцу `shortcut-ledger`: в начале файла комментарий с вызовом и exit code-ами;
   сообщения на английском.
2. Проверки:
   - каждый фрагмент `path:from-to` совпадает с кодом head-а PR (`TICKETS.md`, раздел «Story anchor»);
   - у каждого шага есть все поля формата;
   - шапка — по формату, без поля commit-а;
   - у story Epic-а список передач шага «Стыки между Ticket-ами» разбирается;
   - личные данные ищет `harness/lib/privacy.cjs`, как у `evidence-check`; находка в выводе маскируется.
3. Какой commit брать — только head PR, никогда не main (`TICKETS.md`, раздел «Story anchor»):
   - story в ветке — `HEAD` ветки PR;
   - documents PR, который дописал шаг review, — head PR, который влил `land`, а не своя ветка;
   - story ещё не закоммичена (implementer проверяет её до commit-а) — файлы рабочего дерева. Вывод называет, с чем
     сверял.
4. Exit 0 — зелёно. Exit 2 — красно, с перечнем `файл:шаг: что не так`. Если script не может проверить (нет git, нет
   файла, нет commit-а) — тоже не 0, с причиной.
5. Shell-test `harness/bin/tests/story-check.test.sh` на fixture-ах Ticket-а 01.

## Готово, когда

- [ ] Shell-test: story PR на русском и на английском — exit 0.
- [ ] Shell-test: фрагмент, который не совпал с кодом, — exit 2, в выводе путь, строки и номер шага.
- [ ] Shell-test: шаг без поля — exit 2, в выводе шаг и имя поля.
- [ ] Shell-test: личные данные в story (подставная home-папка из stand-in-ов `privacy.cjs`) — exit 2, значение в выводе
      замаскировано.
- [ ] `story-check` сверяет story только с head-ом PR; на main его не запускают (`TICKETS.md`, раздел «Story anchor»).
- [ ] Shell-test на fixture `repo-main-shifted/`: ветка не rebase-нута на main, в main строки над фрагментом сдвинулись.
      `story-check` на head-е ветки — exit 0: он сверяет head, а не main.
- [ ] Shell-test: documents PR дописал шаг review (Ticket 06) — `story-check` сверяет файл с head-ом, который влил
      `land`, а не со своей веткой; exit 0.
- [ ] Shell-test: story Epic-а с брошенной передачей разбирается и зелёная; передача без поля «сделано ли» — exit 2.
- [ ] Shell-test: незакоммиченная story сверяется с рабочим деревом, и вывод это называет.
- [ ] Все `harness/bin/tests/*.test.sh` зелёные, в том числе `plugin-neutral.test.sh`; `node scripts/check-personal.mjs` —
      exit 0.

## Тесты

- `harness/bin/tests/story-check.test.sh` (новый) — пункты выше, каждый test сначала красный.

## Где в коде

- `harness/bin/story-check` (новый)
- `harness/bin/tests/story-check.test.sh` (новый)
- `harness/bin/tests/fixtures/code-story/` (из Ticket-а 01; дополнить, если test-у нужен ещё случай)
- `harness/README.md` (строка о новом script-е, если там есть список `bin/`)

Только читать: `harness/bin/shortcut-ledger`, `harness/bin/evidence-check`, `harness/lib/privacy.cjs`,
`harness/bin/tests/shortcut-ledger.test.sh`, `harness/bin/tests/evidence-check.test.sh`.

## Вне скоупа

- Вызов `story-check` из `ship-ticket` и guard на merge — Ticket 05.
