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
- [ ] Отчёт guard-а по `src/`, `harness/`, `scripts/` и по файлам test-ов этого Ticket-а — ноль находок, кроме
      аккаунта репозитория в коде, который его читает.
- [ ] Ручной шаг на машине владельца: хэши совпали 3 из 3.
- [ ] `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0 на Mac и на Windows (Git Bash).
- [ ] `plugin-neutral.test.sh` красный, если в `harness/` вписать аккаунт репозитория или вымышленное запрещённое имя
      внутри длинного слова (mutant), и красный так же при запуске вне git checkout.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, e2e `test/e2e/harness-migrate.spec.ts` — exit 0; `ci-ok` на PR зелёный
      (Linux, macOS и Windows job-ы).

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
