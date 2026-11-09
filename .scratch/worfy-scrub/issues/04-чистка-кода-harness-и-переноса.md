# 04 — Чистка кода: `src/`, `harness/`, `scripts/spikes/`, перенос старого Harness

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Что нашла разведка 2026-11-08» (две особые точки); «Как работает» → «Перенос старого Harness»; «Риски», п. 1, 5; Q3, Q4, Q5, Q6

Платформенный Ticket: меняются скрипты и test-ы Harness (`harness/bin/tests/plugin-neutral.test.sh`), они идут на Mac и
Windows — Windows verdict до merge (ADR-0056). Глубина ревью — `high`: поведение переноса старого Harness для
существующих пользователей.

Test-ы и fixture переноса — здесь, не в Ticket-е 05: они меняются вместе с `PERSONAL_BIN`.

## Что происходит

- `src/`: имена других проектов владельца — 8 строк, домашний путь с именем пользователя — 15; комментарий с именем
  хоста — `src/main/link/identity.ts:64-65`.
- `harness/`: имена других проектов — 2, домашний путь — 24. `harness/.claude-plugin/plugin.json` — поле `author` с
  именем владельца (Q4); `harness/.claude-plugin/marketplace.json` — проверить тоже.
- `harness/bin/tests/plugin-neutral.test.sh` держит список личных имён открытым текстом и исключение для автора
  plugin-а (`:36-37`).
- `scripts/spikes/claude-home-survey.ts` — 14 строк с именами других проектов.
- `src/main/harness/migrate/plan.ts:35`, `PERSONAL_BIN` — три имени личных инструментов; читает их `plan.ts:319`.
  Те же имена — в `test/contract/harness-plugin.test.ts:75`, `test/contract/harness-migrate*.ts`,
  `test/contract/e3-owner-check.test.ts`, `test/e2e/harness-migrate.spec.ts` и в fixture
  `test/fixtures/claude-home-legacy/` (три файла в `home/.claude/bin/`, папки профилей и репозиториев с именами
  других проектов).

## Что делаем

1. Test первым: случай переноса «личный инструмент узнан по хэшу имени» с вымышленными именами и их хэшами,
   переданными параметром; и проверка, что `plan.ts` не содержит открытых имён (guard Ticket-а 01 по файлу). Красный
   до правки.
2. `PERSONAL_BIN` → список SHA-256 имён в нижнем регистре; функция сравнения берёт список параметром, по умолчанию —
   список из кода. Остальное поведение переноса не меняется.
3. Fixture `claude-home-legacy` — вымышленные имена по Q6: проекты, профили, личные инструменты; test-ы переноса — по
   ним. Счёт файлов, которые перенос оставляет и удаляет, тот же, что до правки.
4. Ручной шаг на машине владельца до merge: хэши из кода сверить с именами из `<Harness home>/user/privacy.json`
   (команда `--hash-from` Ticket-а 01), результат «совпало N из 3» — в «Итог», без имён.
5. `plugin-neutral.test.sh`: открытый список имён убрать, но проверка `harness/` не слабее нынешней (возражение 2
   критика, Q9). Сегодня test ловит и аккаунт репозитория, и имя внутри более длинного слова (подстрока без учёта
   регистра). После правки: аккаунт репозитория — в отдельном хэш-списке только для проверки plugin-а (общий guard
   его не ищет, решение 2 spec-а); подстроку test сохраняет. Проверка работает и из установленного plugin-а, где нет
   `scripts/`: хэш-список и сверка лежат внутри `harness/` (или test несёт их сам). Какой путь выбран — в «Итог».
6. `plugin.json`, `author` — по ответу Q4; при «нет» — исключение в `scripts/check-personal.allow.json` (файл
   Ticket-а 01, в Wave 2 его правит только этот Ticket).
7. Комментарии и строки `src/`, `harness/`, `scripts/spikes/` — по таблице spec-а («Чистка»); код, который читает
   аккаунт репозитория (`src/main/update/*`, `src/shared/ipc/update.ts`, `src/renderer/guide/links.ts`), не трогать.

## Готово, когда

- [ ] Test «узнан по хэшу»: красный до правки, зелёный после; перенос на fixture оставляет и удаляет те же файлы, что
      до правки.
  - evidence: test-run pass · `pnpm test test/contract/harness-migrate.test.ts -t "personal script"` exit 1 on plan.ts of origin/main, exit 0 after; module unit+contract tests (29 files) exit 0; move counts 447/408/39 before and after · mac - · b512e848f1a7e7bd7a256afe40c0878019693243
- [ ] Отчёт guard-а по `src/`, `harness/`, `scripts/` и по файлам test-ов этого Ticket-а — ноль находок, кроме
      аккаунта репозитория в коде, который его читает.
- [ ] Ручной шаг на машине владельца: хэши совпали 3 из 3.
  - evidence: test-run pass · orchestrator on the owner's Mac: the three PERSONAL_BIN hashes of plan.ts match 3 of 3 lowercase names in the old Harness bin folder; 1 of 3 also in the privacy.json deny list (the deny list holds project names, not tool names); no names printed · mac - · 5e50052a253e3cbcef9e2ed782337446328a80d9
- [ ] `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0 на Mac и на Windows (Git Bash).
  - evidence: test-run pass · `bash harness/bin/tests/plugin-neutral.test.sh` exit 0 (37 passed) · mac - · b512e848f1a7e7bd7a256afe40c0878019693243
- [ ] `plugin-neutral.test.sh` красный, если в `harness/` вписать аккаунт репозитория или вымышленное запрещённое имя
      внутри длинного слова (mutant), и красный так же при запуске вне git checkout.
  - evidence: test-run pass · mutants on copies of harness/, in a git checkout and outside one: account in README.md exit 1, invented listed word inside a longer word exit 1, unchanged copy exit 0 · mac - · b512e848f1a7e7bd7a256afe40c0878019693243
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e `test/e2e/harness-migrate.spec.ts` — exit 0; `ci-ok` на PR зелёный
      (Linux, macOS и Windows job-ы).
  - evidence: gate pass · `gate fast` exit 0 · mac - · b512e848f1a7e7bd7a256afe40c0878019693243
  - evidence: test-run pass · `pnpm lint` exit 0, `pnpm typecheck` exit 0, `pnpm test:e2e test/e2e/harness-migrate.spec.ts` exit 0 (2 passed) · mac - · b512e848f1a7e7bd7a256afe40c0878019693243

## Тесты

- Contract `test/contract/harness-migrate.test.ts`, `harness-migrate-boundaries.test.ts`,
  `harness-migrate-known-paths.test.ts`, `harness-plugin.test.ts`, `e3-owner-check.test.ts`.
- E2e `test/e2e/harness-migrate.spec.ts`.
- Shell `harness/bin/tests/plugin-neutral.test.sh`.
- Сначала падающий: случай «узнан по хэшу» красный на `main`.

## Где в коде

- `src/**`
- `harness/**`
- `scripts/spikes/**`
- `scripts/check-personal.allow.json` (только при ответе «нет» на Q4)
- `test/contract/harness-migrate.test.ts`
- `test/contract/harness-migrate-boundaries.test.ts`
- `test/contract/harness-migrate-known-paths.test.ts`
- `test/contract/harness-migrate-harness.ts`
- `test/contract/harness-plugin.test.ts`
- `test/contract/e3-owner-check.test.ts`
- `test/e2e/harness-migrate.spec.ts`
- `test/fixtures/claude-home-legacy/**`

## Итог

Ветка `worfy-scrub/04`, commit `b512e848f1a7e7bd7a256afe40c0878019693243`. Работу начал прошлый implementer (его
незавершённые правки — первый commit, потом rebase на свежий `origin/main` без конфликтов), закончил второй.

### Красный test до правки

Два новых test-а в `test/contract/harness-migrate.test.ts` на копии `plan.ts` из `origin/main` (остальное дерево — с
правкой): `pnpm test test/contract/harness-migrate.test.ts -t "personal script"` — exit 1, `Tests 2 failed | 50 skipped`.
«Узнан по хэшу»: строка `bin/` с вымышленным именем осталась в плане — старый код не берёт список параметром. «Нет
открытых имён в `plan.ts`»: guard Ticket-а 01 (`scripts/check-personal.mjs` со своим хэш-списком на репозитории из
одного `plan.ts`) нашёл находку в строке `PERSONAL_BIN`. С правкой — оба зелёные.

### Счёт файлов переноса

Перенос «remove везде» (выбор по умолчанию) на fixture, считаются файлы `~/.claude` песочницы. До правки (код,
fixture и песочница test-ов из `origin/main`): было 447, осталось 408, удалено 39, в `bin/` осталось 5, строк файлов
в форме 26. После правки (вымышленные имена, список хэшей fixture-а параметром): 447, 408, 39, 5, 26 — то же.

### Путь шага 5

Хэш-список и сверка лежат внутри `harness/`: `harness/bin/tests/plugin-neutral.words.json` (SHA-256 и длина слова в
нижнем регистре, без текста) и `harness/bin/tests/plugin-neutral-words.mjs`. Test не зависит от `scripts/` и от
git: файлы берёт из `git ls-files`, вне checkout-а — `find`. Сверка — подстрокой без учёта регистра (каждый отрезок
цепочки `[a-z0-9._-]` той же длины, что слово списка), как прежний `grep -i`. Аккаунт репозитория — в этом списке,
общий guard его не ищет (решение 2 spec-а). Все слова прежнего открытого списка есть в хэш-списке (проверено
хэшированием прежнего списка из `origin/main`, без печати слов); добавлены ещё tailnet, личный инструмент и личный
аккаунт GitHub. Единственное исключение — строка `author` в `plugin.json` (хэш строки); исключение, которое не
нужно, — находка. Сами test-ы списка: вымышленное слово своего списка внутри длинного слова и аккаунт внутри слова в
другом регистре — находятся в git checkout-е и вне его.

Mutant-ы на копиях `harness/` (tracked-файлы плюс правки дерева), каждый в git checkout-е и вне его:

- аккаунт репозитория дописан в `harness/README.md` — exit 1, находка `README.md:252` (маска);
- вымышленное слово добавлено в хэш-список и вписано внутрь длинного слова в `skills/qmd/SKILL.md` — exit 1;
- копия без изменений — exit 0 в обоих местах.

### Остальное

- `PERSONAL_BIN` (`src/main/harness/migrate/plan.ts:41-43`) — три SHA-256; хэши совпадают с прежними тремя именами
  `origin/main` по порядку (проверено без печати имён). `isPersonalBin(name, list)` сравнивает хэш имени в нижнем
  регистре, список по умолчанию — из кода; `PlanOptions.personalBin` передают test-ы. `scripts/e3-owner-check.sh`
  читает `PERSONAL_BIN` из `plan.ts` и сравнивает так же — файл вне «Где в коде», правка нужна, чтобы проверка
  владельца не сломалась.
- `plugin.json`, `author` — аккаунт репозитория (Q4 «да»); `scripts/check-personal.allow.json` не тронут.
- Fixture `claude-home-legacy`: проекты, профили, репозитории и личные инструменты — вымышленные имена Q6.
- `src/`: четыре чтения свойства `.local` (`registry.ts`, `ipc-adapter.ts` ×2, `pairing.ts` ×2) правило `host`
  guard-а принимало за имя хоста; теперь это деструктуризация, поведение то же.
- Отчёт guard-а (`node scripts/check-personal.mjs --report --list`): `src/` и `harness/` — 0 находок, файлы test-ов
  Ticket-а — 0. В `scripts/` остались 3 находки в `scripts/codex-capture.mjs` (вне «Где в коде»): это stand-in-ы
  записей Codex, вымышленный хост и домашняя папка, те же, что в `test/fixtures/codex-messages/` (Ticket 05 их
  оставил). Их место — список stand-in-ов guard-а (Ticket 06), не правка одного скрипта.
- Сверка подстрокой по хэш-списку plugin-а для `src/`, `scripts/spikes/`, fixture и test-ов Ticket-а: находок нет,
  кроме аккаунта репозитория в коде, который его читает (`src/main/update/*`, `src/shared/ipc/update.ts`,
  `src/renderer/guide/links.ts`).
- Ручной шаг 4 (хэши против `privacy.json` на машине владельца) — за orchestrator-ом после PR.
