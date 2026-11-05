# 06 — Перенос записей между машинами: `export` и `import`

Type: task
Status: done 2026-11-05T01:53Z
PR: #1402
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test: `import -` из stdin даёт то же.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test: export 40 run-ов с длинными `error` — несколько частей, каждая ≤ 60000 символов; import всех
      частей даёт все 40; без последней части — отказ «export incomplete: part 3/3 missing».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test: `--gh` со stand-in `gh` — из трёх комментариев взят только блок нужного автора; комментарий без
      маркера пропущен.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test приватности: запись с `C:\Users\jdoe\…`, hostname машины, UUID и `ghp_…` в `error` — export
      exit 2, вывод пуст; тот же файл в import — отвергнут.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test: блок export не содержит пути корня worktree, домашней папки, hostname и имени пользователя
      машины, где шёл test (проверка по значениям `os.homedir()`, `os.hostname()`, `os.userInfo().username`).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Contract test: файл своего компьютера в import не попадает.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 · mac - · c1af438a5
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/gate-failures-transfer.test.ts test/contract/gate-failures-cli.test.ts test/unit/gate-failures-format.test.ts` exit 0 after the rebase · mac - · 4ae72be10
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] Платформенный PR, если так скажет `scripts/windows-verdict-scope.mjs`.
  - evidence: commit pass · node scripts/windows-verdict-scope.mjs origin/main HEAD prints runner: not a platform PR · - - · c1af438a5
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.
  - evidence: review pass · PR #1402 · - - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/41949110895/job/126995995328 · ci - · f2bfaa51d3b2e4ff7f2e42c1d1ae8cddc1e6db21

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

## Итог

Сделано в ветке `worfy-failures/06`.

- `harness/lib/gate-failures/export.mjs`: свои run-ы (не из `imported/`) вместе с их повторами — по `--run` (можно
  несколько), иначе за `--since <дней>`, иначе все. Части по форме ниже, каждая ≤ 60000 символов; run и его повторы не
  делятся между частями. Run длиннее части — `error` его записей укорачивается до 80 символов, stderr это называет; не
  влез и так — exit 2, ничего не выведено. Без `--out` части идут в stdout одна за другой, с `--out <file>` — в
  `<file>.<k>`. Перед выводом каждое поле каждой записи, имя компьютера и весь текст проверяются `findLeaks` плюс
  hostname, имя пользователя, домашняя папка и корень worktree этой машины; находка — строка «запись, поле, правило»
  (значение не печатается), exit 2, stdout пуст, файлы не пишутся.
- `harness/lib/gate-failures/import.mjs`: `<file>`, `-` (stdin), `--gh <owner/repo> --issue N | --pr N`. Блоки ищутся по
  строке-маркеру где угодно в тексте (в начале комментария, после отчёта в теле issue, подряд в файле). С `--gh` — тело и
  комментарии через `gh api repos/<o>/<r>/issues/<N>` и `…/comments?per_page=100&page=K` (у PR те же endpoint-ы); считаются
  только тексты автора `github.account` (без учёта регистра), блок чужого автора — строка `ignored`, текст без маркера
  пропускается молча. Каждый файл: формат 01 (`parseRecordFile`), та же проверка приватности, свой `computer.id` — пропуск,
  уже лежащий файл — «already imported», иначе `writeImported`. Итог `imported: N new, M skipped, K rejected`.
- `harness/lib/gate-failures/transfer-common.mjs`: маркер, форма части, разбор блоков, сборка частей, проверка приватности.
  `run` не экспортирует — `gate-failures --help` его не показывает.
- Test-ы: `test/contract/gate-failures-transfer.test.ts` (11), stand-in-ы `gh` и `bin/profile` и запись-образец —
  `test/fixtures/gate-failures/transfer/`. Первым test был красным: без `export.mjs` и `import.mjs` все 11 падали.

Форма части (машинный контракт, читает Ticket 05 только через `imported/`):

    gate-failures export v1 part <k>/<n>
    computer: <name> (<platform>)
    ```json
    {"export":"<8 hex>","at":"…","computer":{"id","name","platform"},"part":k,"parts":n,"files":[
    <запись run-а или повтора одной строкой>,
    …
    ]}
    ```

Решено без владельца, подтвердить:

1. Части одного export-а собираются по `export` (8 случайных hex-цифр в JSON части) и `computer.id`: маркер из ticket-а
   (`part <k>/<n>`) один не отличает два export-а одной машины в одном issue. Одна и та же часть дважды (комментарий
   повторён) считается один раз.
2. Неполный export отвергается целиком; в «rejected» идут все файлы пришедших частей (не меньше одного). Битый блок —
   один «rejected». Любой «rejected» — exit 2; прочитать источник не удалось (нет файла, `gh` упал, нет
   `github.account` для `--gh`) — exit 1, ticket этот код не называл.
3. Файл своего компьютера — «skipped», не «rejected»: exit 0, вреда в нём нет. Свой компьютер — по `machine.json`
   (`readComputer`); import его не создаёт.
4. Export включает только свои файлы; повторы без своего run-а (run уже удалён сроком хранения) не выгружаются.
5. Stand-in-ы для test-ов: `GATE_FAILURES_GH` (как `TICKET_GH`, `LAND_GH` у соседних скриптов, а не `WORFY_GH` приложения)
   и `CLAUDE_PROFILE_BIN` (как у `hooks/gh-token-env.mjs`).
6. Q6 = А (принято владельцем 2026-11-04): поле `error` в export остаётся, режима без него нет.
