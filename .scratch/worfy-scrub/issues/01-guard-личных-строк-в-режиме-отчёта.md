# 01 — Guard личных строк в режиме отчёта

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Guard личных строк»; «Решено без владельца», п. 1–4; Q3, Q6

Не платформенный: скрипт Node в `scripts/` и строка в `pnpm lint`, `harness/` не меняется. Глубина ревью — `medium`.

## Что происходит

- Личное в текущих файлах ищут только две проверки, обе узкие. `harness/bin/evidence-check --changed` смотрит то, что
  ветка добавляет в `.scratch`. `harness/bin/tests/plugin-neutral.test.sh` смотрит только `harness/`, по списку
  открытым текстом (сам список — след).
- Правила личного уже есть в `harness/lib/privacy.cjs`: `findings`, `mask`, `personal`. Stand-in домашнего пути
  (`STAND_IN_NAMES`, `:55`) там есть, stand-in-ов хоста и адреса Tailscale нет.
- `pnpm lint` (`package.json:17`) — цепочка `node scripts/check-*.mjs`; в CI его гоняет job `lint-typecheck`.

## Что делаем

1. Test первым: `test/unit/check-personal.test.ts` на временном git-репозитории — находки каждого правила в тексте и в
   имени файла, stand-in-ы не находятся, маска вместо значения, исключение работает, устаревшее исключение названо,
   `--report` — exit 0 при находках, без него — exit 1. Красный до скрипта.
2. `scripts/check-personal.mjs`: файлы из `git ls-files`; правила `home-path`, `host`, `tailscale-ip`, `email`,
   `token` из `privacy.cjs` (только `require`, без правок); правило `uuid` выключено.
3. Stand-in-ы Q6 — список в скрипте: вымышленный хост `someones-mac`, хосты вида `<host>.example.ts.net`, адрес
   quad-100 DNS-сервера самого Tailscale и ещё несколько адресов Tailscale, явно вымышленных, для test-ов, которым
   нужно больше одного адреса (Ticket 05 список не правит).
4. Хэш-список `scripts/check-personal.hashes.json`: SHA-256 слов в нижнем регистре. Сверка — каждое слово
   (`[^a-z0-9]+` режет) и склейки соседних слов через `-` до трёх подряд, в тексте и в пути.
5. `--hash-from <file>`: читает `{"deny": [...]}` (формат `<Harness home>/user/privacy.json`), печатает только
   хэши. Первый хэш-список строится так на машине владельца; в commit идут только хэши. Каждую запись `deny`
   `--hash-from` режет тем же правилом, что и текст (`[^a-z0-9]+`, части склеиваются через `-`). Запись, которую
   сверка по словам поймать не может (больше трёх частей, пустая после разрезки), — отказ с exit 1 и номером записи,
   без значения (возражение 3 критика, Q10).
   На Mac владельца 2026-11-08 файла `privacy.json` нет: его пишет orchestrator по списку разведки до сборки
   хэшей, владелец его просматривает; файл остаётся вне репозитория.
6. Исключения `scripts/check-personal.allow.json`: путь, правило, хэш значения. Неиспользованное исключение — находка.
7. Вывод: `путь:строка: правило: маска`, итог по категориям и по верхним папкам. Значение целиком не печатается
   нигде.
8. `package.json`, `lint`: `node scripts/check-personal.mjs --report`.
9. В «Итог» — отчёт guard-а по `main` (только счёт по папкам и правилам) как список работы для 02–05.

## Готово, когда

- [ ] Test-ы guard-а: красный до скрипта, зелёный после; каждое правило, stand-in-ы, маска, исключения, оба exit code.
- [ ] Test-ы `--hash-from`: запись с `.`, `_` или пробелом находится в тексте так же, как через `-`; запись из
      четырёх частей и пустая запись — отказ с exit 1.
- [ ] Ни в скрипте, ни в хэш-списке, ни в test-е нет открытого личного слова; test использует вымышленные слова и их
      хэши.
- [ ] `node scripts/check-personal.mjs --report` на `main` — exit 0, отчёт по папкам в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

## Тесты

- Unit `test/unit/check-personal.test.ts` (временный git-репозиторий, без настоящего `privacy.json`).
- Сначала падающий: весь файл test-а красный, пока скрипта нет.

## Где в коде

- `scripts/check-personal.mjs` (новый)
- `scripts/check-personal.hashes.json` (новый)
- `scripts/check-personal.allow.json` (новый)
- `test/unit/check-personal.test.ts` (новый)
- `package.json`

Только читать: `harness/lib/privacy.cjs`, `harness/bin/evidence-check`, `harness/bin/tests/plugin-neutral.test.sh`,
`scripts/check-cyrillic.mjs` (образец скрипта проверки).
