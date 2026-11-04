# 06 — Перенос записей между машинами: `export` и `import`

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 5, «Модель» (очистка текста, компьютер), «Вопросы владельцу», Q1 (рекомендация А и В) и Q6 (рекомендация А), «Риски», п. 4; [ADR-0086](../../../docs/adr/0086-pc-gate-full-once-per-wave.md), пункт 4 (issue `pc-main-red` с отчётом)

## Что происходит

- Отчёт gate full на ПК доходит до Mac текстом: сообщением между Session-ами или в теле issue `pc-main-red`
  (ADR-0086, пункт 4, строки 43-53: «в теле отчёт gate (код выхода, строка вердикта, упавшие test-ы `file:line`)»).
- Docs PR #1306 вынес в публичный репозиторий имя пользователя Windows в путях, hostname Mac и ПК и UUID аккаунтов;
  понадобился force-push.
- Комментарии отчётов в PR уже читаются по первой строке и автору (`harness/skills/gate-queue/SKILL.md:44-49`); сама
  очередь `needs-mac-gate` больше не работает (`rules-merge.md` Profile-а), но форма «маркер в первой строке» —
  проверенная.

## Что делаем

Подкоманды — свои модули, как их находит bin Ticket-а 01 по имени: `harness/lib/gate-failures/export.mjs` и
`import.mjs`; общее (маркер, разбор блока, проверка) — `harness/lib/gate-failures/transfer-common.mjs`.

1. Export и import:
   - `gate-failures export [--run <id> ...] [--since <days>] [--out <file>]` — текст: первая строка
     `gate-failures export v1 part <k>/<n>`, вторая — `computer: <name> (<platform>)`, затем блок ```` ```json ````
     с файлами run-ов и повторов. Комментарий GitHub держит не больше 65536 символов: часть — не больше 60000
     символов, файлы run-ов не режутся между частями; `--out <file>` пишет части в `<file>.<k>`; файл run-а
     длиннее части — `error` его записей укорачивается до 80 символов, и export это печатает. Перед выводом — `findLeaks` по всему тексту плюс поиск hostname, имени пользователя и домашней
     папки этой машины; находка — exit 2, строка с полем и шаблоном, ничего не выведено. При Q6 = Б — без поля
     `error`.
   - `gate-failures import <file> | - | --gh <owner/repo> (--issue N | --pr N)` — находит блоки по первой строке и
     собирает части; неполный набор частей (`3/4` без `4/4`) — отказ этого export-а, остальные принимаются;
     с `--gh` читает комментарии и тело через `gh api` и берёт только автора `github.account` Profile-а; каждый
     файл проверяет формат 01 и `findLeaks`; кладёт через `writeImported` Ticket-а 01 (папка
     `<state>/failures/imported/<computer.id>/`, её форму и чтение задаёт 01); повтор того же
     `run` того же компьютера — пропуск («already imported»). Файл своего же компьютера не импортируется.
   - Итог: число новых, пропущенных и отвергнутых файлов; exit 0 / 2 (хоть один отвергнут).
2. Чтение `imported/` (`listRuns`) и срок хранения — Ticket 01; отчёт — Ticket 05; здесь только запись. `rerun`
   импортированные записи не исполняет (Ticket 04).

## Готово, когда

- [ ] Contract test: export двух run-ов → import из файла на «другой машине» (вторая временная Harness home) — оба в
      `imported/<id>/`; второй import — «already imported».
- [ ] Contract test: `import -` из stdin даёт то же.
- [ ] Contract test: export 40 run-ов с длинными `error` — несколько частей, каждая ≤ 60000 символов; import всех
      частей даёт все 40; без последней части — отказ «export incomplete: part 3/3 missing».
- [ ] Contract test: `--gh` со stand-in `gh` — из трёх комментариев взят только блок нужного автора; комментарий без
      маркера пропущен.
- [ ] Contract test приватности: запись с `C:\Users\jdoe\…`, hostname машины, UUID и `ghp_…` в `error` — export
      exit 2, вывод пуст; тот же файл в import — отвергнут.
- [ ] Contract test: блок export не содержит пути корня worktree, домашней папки, hostname и имени пользователя
      машины, где шёл test (проверка по значениям `os.homedir()`, `os.hostname()`, `os.userInfo().username`).
- [ ] Contract test: файл своего компьютера в import не попадает.
- [ ] Платформенный PR, если так скажет `scripts/windows-verdict-scope.mjs`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Contract `test/contract/gate-failures-transfer.test.ts` (новый): две временные Harness home, stand-in `gh` (`.mjs`,
  как в других contract test-ах с `WORFY_GH`), без сети.
- Fixture — `test/fixtures/gate-failures/transfer/`.
- Сначала падающий: export → import — `imported/` пуст.

## Где в коде

- `harness/lib/gate-failures/export.mjs` (новый)
- `harness/lib/gate-failures/import.mjs` (новый)
- `harness/lib/gate-failures/transfer-common.mjs` (новый)
- `test/contract/gate-failures-transfer.test.ts` (новый)
- `test/fixtures/gate-failures/transfer/` (новый)

Только читать: `harness/hooks/gate-failures.mjs` (Ticket 01), `harness/bin/profile` (`github.account`),
`harness/hooks/gh-token-env.mjs` (как Harness зовёт `gh` от аккаунта Profile-а),
`harness/skills/gate-queue/SKILL.md:44-49`.
