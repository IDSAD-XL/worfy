# 01 — Формат Code story: шапка без commit-а, шаги, список передач, общие fixture-файлы

Type: task
Status: claimed 2026-11-15T23:45Z
Branch: worfy-code-stories/01
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 01; «Решения владельца» 3, 4, 8, 9, 16, 17, 24, 27 (строки 94–135);
«Решения по реализации» → Harness: «Формат», «Где лежит» (строки 195–206); «Решения по test-ам», А (строки 279–281);
возражение 3 [критика](../../../docs/product/critic/worfy-code-stories-2026-11-15.md)

Кто: агент.

## Что происходит

- Схемы папки Epic-а в `harness/bin/TICKETS.md` нет. Рядом с форматом story там уже описан Evidence (раздел
  **Evidence**): строки доказательств под пунктами «Готово, когда».
- Черновик давал story шапку `Commit: <head PR>`. Так нельзя (возражение 3 критика): story коммитится в тот же PR и не
  может знать hash своего commit-а; правки по review его меняют; `land` вливает PR через
  `gh pr merge <N> --squash --match-head-commit <head>` (`harness/bin/land`, комментарий в начале файла), и head PR в
  main не попадает.
- На этот формат опираются `story-check` (Ticket 02), reader worfy (Ticket 08) и вид Story (Ticket 09). Если формат
  поменяется после них, переделывать придётся три Ticket-а.

## Что делаем

1. Описать формат в `harness/bin/TICKETS.md`, в разделе рядом с **Evidence**, на английском (Harness — English-only,
   ADR-0074):
   - Markdown, который читается и на GitHub, и в worfy.
   - Шапка: вид (`pr` или `epic`), Epic, Ticket, PR, язык. **Поля commit-а нет.**
   - Шаг — заголовок и поля: фрагмент `path:from-to` с номерами главных строк и самим кодом; «Что делает»; «Почему
     здесь»; «Без него»; «Требование» — ссылка на раздел Ticket-а или spec-а; «Риски и пробелы test-ов». Когда причины
     нет, поле так и пишет: «не записано» (`not recorded` в английской story).
   - Порядок шагов — порядок объяснения (решение 16): первый — что было не так; последние — что сознательно не
     меняли, как проверено, «Что нашёл review и что осталось».
   - Размер: 1–3 шага у маленького PR, до 10 у большого; у story Epic-а 5–10 главных шагов (решение 8).
   - Story Epic-а: главы — PR-ы Epic-а; экраны «Начало», «Итог», «Проверка»; шаг «Стыки между Ticket-ами» со списком
     передач — от какого Ticket-а, какому, что передано, сделано ли. По этому списку worfy рисует схему (решение 27).
   - Необязательный раздел вопросов «Проверить себя»: 2–3 вопроса, правильный ответ, ссылки на строки (читает
     Ticket 13).
2. Правило привязки фрагментов вместо commit-а в шапке:
   - В ветке PR фрагменты сверяются с деревом commit-а, в котором лежит сама story.
   - В main worfy находит этот commit через commit, который принёс файл story в main. PR вливаются squash-ем, поэтому
     это один commit.
   - Spec называет команду `git log -1 -- <путь story>`. Но Ticket 06 потом дописывает в story PR шаг review через
     documents PR, и `-1` вернёт уже commit documents PR, когда main мог уйти дальше. Ticket выбирает точную команду —
     например, commit, который добавил файл: `git log --diff-filter=A -1 -- <путь>`. Эту команду записывает
     `TICKETS.md`, по ней же работают Ticket-ы 02 и 08.
3. Где лежит (решения 4 и 9): story PR Ticket-а NN — `<tickets root>/<epic>/stories/NN-<slug>.md`, story Epic-а —
   `<tickets root>/<epic>/story.md`. В режиме Silent — папка Workflow, ветка ничего не получает (как Evidence-строки).
4. Общие fixture-файлы — граница Harness-а и worfy. Их читают shell-test `story-check` (Ticket 02), unit test reader-а и
   e2e вида Story (Ticket-ы 08 и 09). Так уже устроен `harness/bin/tests/fixtures/ticket-title`: два reader-а, одни
   файлы. Набор файлов:
   - story PR на русском;
   - story PR на английском;
   - story Epic-а со списком передач, одна передача брошена;
   - фрагмент не совпадает с кодом;
   - у шага нет поля;
   - файлы кода, на которые указывают фрагменты, чтобы test собрал из них временный git repo.
5. Имена и пути в fixture-ах — придуманные: репозиторий публичный.

## Готово, когда

- [ ] В `harness/bin/TICKETS.md` описан формат story: шапка без поля commit-а, поля шага, «не записано», порядок шагов,
      размеры, глава-PR, список передач шага «Стыки между Ticket-ами», раздел «Проверить себя», пути `stories/` и
      `story.md`, режим Silent.
  - evidence: commit pass · Define the Code story format, its anchor rule and shared fixtures · - - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9
- [ ] В `TICKETS.md` записано правило привязки: дерево commit-а со story в ветке; в main — commit, который принёс файл, с
      точной командой. Случай, когда documents PR позже дописал шаг review в тот же файл, разобран.
  - evidence: commit pass · Story anchor in TICKETS.md: git log --first-parent --follow --diff-filter=A -1 <main> -- <path> · - - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9
- [ ] Fixture-ы в `harness/bin/tests/fixtures/code-story/`: два story PR (ru, en), story Epic-а с брошенной передачей,
      несовпавший фрагмент, шаг без поля, код для временного repo; в README папки — по строке на файл: что он
      проверяет.
  - evidence: commit pass · harness/bin/tests/fixtures/code-story: pr-en, pr-ru, epic-ru, bad-fragment, missing-field, repo/src, README · - - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9
- [ ] `harness/bin/tests/plugin-neutral.test.sh` и `agents-text.test.sh` зелёные (английский текст Harness-а; русский
      fixture — данные, как в `fixtures/ticket-title`).
  - evidence: test-run pass · `bash harness/bin/tests/plugin-neutral.test.sh` exit 0, `bash harness/bin/tests/agents-text.test.sh` exit 0 · mac - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9
- [ ] `node scripts/check-personal.mjs` — exit 0; `pnpm lint` (проверки документов) — exit 0.
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0, `pnpm lint` exit 0 · mac - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9
  - evidence: gate pass · `gate fast` exit 0 · mac - · 626782f8b9566dc6ba1a43e4ae1d3f506139e1d9

## Тесты

- Поведение формата проверяют test-ы Ticket-ов 02 и 08 на этих fixture-ах. Здесь — только проверки текста Harness-а и
  personal-data check.

## Где в коде

- `harness/bin/TICKETS.md`
- `harness/bin/tests/fixtures/code-story/` (новая папка)
- `harness/bin/tests/fixtures/ticket-title/` (только читать: образец общих fixture-ов)
- `harness/bin/tests/plugin-neutral.test.sh`, `harness/bin/tests/agents-text.test.sh` (только запускать)

## Вне скоупа

- Script `story-check` — Ticket 02. Reader worfy — Ticket 08.
