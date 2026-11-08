# 06 — Guard блокирует в CI, находок ноль

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05
Source: [spec.md](../spec.md), «Как работает» → «Guard личных строк»; «Волны», Wave 3; «Риски», п. 7; Q3

Не платформенный: строка `pnpm lint` и скрипт Node. Глубина ревью — `medium`.

## Что происходит

- После Ticket-а 01 guard стоит в `pnpm lint` с `--report`: находки печатаются, exit 0.
- После Ticket-ов 02–05 отчёт по `main` должен быть пуст. Пока guard не блокирует, чужие PR-ы Wave 2 могли добавить
  новое личное.
- Job `lint-typecheck` (`.github/workflows/ci.yml:155`) гоняет `pnpm lint` на каждом PR; описание шагов `pnpm lint` —
  в комментарии в начале файла (`:14-18`).

## Что делаем

1. Свежий отчёт guard-а по `main`. Находки — убрать в этом PR (те же правила, что в 02–05); новое запрещённое слово —
   его хэш в `scripts/check-personal.hashes.json` (`--hash-from` на машине владельца).
2. Устаревшие исключения в `scripts/check-personal.allow.json` — убрать.
3. `package.json`, `lint`: убрать `--report`. Находка — exit 1.
4. Test `test/unit/check-personal.test.ts`: случай «по умолчанию находка — exit 1» уже есть с Ticket-а 01; добавить
   случай, что `pnpm lint` зовёт guard без `--report` (чтение `package.json`).
5. Комментарий в начале `.github/workflows/ci.yml` — guard в списке того, что делает `pnpm lint`.
6. `HANDOFF.md` — одна строка: guard личных строк блокирует `pnpm lint`; открытый список — только
   `<Harness home>/user/privacy.json` на машине владельца, хэши строит `--hash-from`.

## Готово, когда

- [ ] `node scripts/check-personal.mjs` на `main` с этим PR — exit 0, находок ноль.
- [ ] Проверка блокировки: ветка с одной вымышленной находкой (домашний путь с именем пользователя) — `pnpm lint` exit 1 локально;
      в «Итог» — exit code и маска из вывода.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
- [ ] `node scripts/check-handoff.mjs` — exit 0.

## Тесты

- Unit `test/unit/check-personal.test.ts`.

## Где в коде

- `package.json`
- `.github/workflows/ci.yml`
- `scripts/check-personal.mjs`
- `scripts/check-personal.hashes.json`
- `scripts/check-personal.allow.json`
- `test/unit/check-personal.test.ts`
- `HANDOFF.md`
