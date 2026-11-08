# 01 — Guard личных строк в режиме отчёта

Type: task
Status: done 2026-11-08T18:40Z
PR: #1685
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
  - evidence: test-run pass · `pnpm test test/unit/check-personal.test.ts` exit 0 (18 passed; exit 1 with 16 failed before the script) · mac - · 83b0d0fee4fe673514abe8e20c127a3ca5468ded
  - evidence: test-run pass · `pnpm test test/unit/check-personal.test.ts` exit 0 (21 passed; review round 1: exit 1 with 2 failed before the fix) · mac - · 8e89c26d1ed63923f9b11fa9eb5a78c7b0425156
  - evidence: review pass · PR #1685 · - - · 84077367d3dc9e6106cbaf6a33cac84487763808
- [ ] Test-ы `--hash-from`: запись с `.`, `_` или пробелом находится в тексте так же, как через `-`; запись из
      четырёх частей и пустая запись — отказ с exit 1.
  - evidence: test-run pass · `pnpm test test/unit/check-personal.test.ts` exit 0 (describe check-personal --hash-from) · mac - · 83b0d0fee4fe673514abe8e20c127a3ca5468ded
  - evidence: test-run pass · `pnpm test test/unit/check-personal.test.ts` exit 0 (describe check-personal --hash-from, non-string entry too) · mac - · 8e89c26d1ed63923f9b11fa9eb5a78c7b0425156
  - evidence: review pass · PR #1685 · - - · 84077367d3dc9e6106cbaf6a33cac84487763808
- [ ] Ни в скрипте, ни в хэш-списке, ни в test-е нет открытого личного слова; test использует вымышленные слова и их
      хэши.
  - evidence: test-run pass · `node scripts/check-personal.mjs --report` exit 0, no finding in the script, the hash list, the allow list and the test · mac - · 83b0d0fee4fe673514abe8e20c127a3ca5468ded
  - evidence: test-run pass · `node scripts/check-personal.mjs --report --list` exit 0, no finding in the script, the hash list, the allow list and the test · mac - · 8e89c26d1ed63923f9b11fa9eb5a78c7b0425156
  - evidence: review pass · PR #1685 · - - · 84077367d3dc9e6106cbaf6a33cac84487763808
- [ ] `node scripts/check-personal.mjs --report` на `main` — exit 0, отчёт по папкам в «Итог».
  - evidence: test-run pass · `node scripts/check-personal.mjs --report` exit 0, 6717 findings in 436 files, counts in the summary · mac - · 83b0d0fee4fe673514abe8e20c127a3ca5468ded
  - evidence: test-run pass · `node scripts/check-personal.mjs --report` exit 0, 6717 findings in 436 files, counts in the summary · mac - · 8e89c26d1ed63923f9b11fa9eb5a78c7b0425156
  - evidence: review pass · PR #1685 · - - · 84077367d3dc9e6106cbaf6a33cac84487763808
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42508841739/job/128823614990 · ci - · 84077367d3dc9e6106cbaf6a33cac84487763808

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

## Итог

Ветка `worfy-scrub/01`, commit `83b0d0fee4fe673514abe8e20c127a3ca5468ded`.

### Красный test до скрипта

`pnpm test test/unit/check-personal.test.ts` на дереве без `scripts/check-personal.mjs` — exit 1, `Tests 16 failed (16)`,
у каждого test-а `Error: Cannot find module '<worktree>/scripts/check-personal.mjs'`. После скрипта — exit 0,
`Tests 18 passed (18)` (два test-а добавлены по ходу: список не JSON и цель symbolic link).

Ревью, раунд 1: новые test-ы до правки — exit 1, `Tests 2 failed | 19 passed (21)`: stand-in-имя под вымышленным
tailnet без метки `example` не находилось (проверялась только первая метка), и `--report` печатал строки находок.
После правки — exit 0, `Tests 21 passed (21)`. Mutant-ы — каждый красный (1 failed из 21): без проверки расширения
двоичного файла, без проверки NUL, без отказа записи-не-строки, stand-in по первой метке.

### Что сделано

- `scripts/check-personal.mjs` — файлы `git ls-files`, путь и текст. Правила `home-path`, `host`, `tailscale-ip`,
  `email`, `token` берутся из `harness/lib/privacy.cjs` через `require` (файл не менялся), `uuid` выключен. Stand-in-ы Q6 —
  списки `STAND_IN_HOSTS` и `STAND_IN_TAILSCALE` в скрипте: вымышленный хост во всех формах, которые ловят правила
  `host` (Mac, MacBook, PC, `.local`, Windows-имя из нулей), адрес quad-100 и первые двадцать адресов диапазона
  Tailscale для test-ов с несколькими peer-ами; хосты с меткой `example` (`<host>.example.ts.net`) — stand-in-ы уже в
  `privacy.cjs`. Сами значения здесь не выписаны: `evidence-check` (правила `privacy.cjs`) их stand-in-ами не считает.
  Stand-in — только значение целиком (имя одно или с `.local`): то же имя под настоящим tailnet
  (`<имя>.<tailnet>.ts.net`) — находка (ревью, раунд 1).
- Сверка слов: текст режется на слова `[A-Za-z0-9]+` в нижнем регистре; слово и склейки двух и трёх соседних слов через `-`.
  Соседи могут стоять на двух строках (перенос в прозе), находка — на строке первого слова. Двоичный файл
  (NUL в первых 8 KB или расширение картинки, шрифта, архива) — только по имени; symbolic link — по тексту цели.
- Скорость: первая версия хэшировала каждую склейку — 17 млн SHA-256 на 50 MB текста, 10 s. Теперь хэш-список —
  `{"sha256": [...], "first": [...]}`: `first` — первые четыре hex-знака хэша первого слова у записей из двух и трёх
  слов; склейка строится только после такого слова. Четыре hex-знака хэша слова говорят о слове меньше, чем полный хэш
  записи, который и так в файле (риск 4 принят). Список без `first` — exit 2.
- Вывод `путь:строка: правило: маска` (`name` вместо строки — находка в пути, путь печатается с маской), затем счёт по
  правилам и по верхним папкам. Значение целиком нигде не печатается; сообщение парсера JSON не печатается тоже (оно цитирует
  кусок файла). С `--report` (так в `pnpm lint`) — только итог и счёт; строки — с `--report --list` и всегда без
  `--report`. **Ticket-ы 02–05 берут список работы командой `node scripts/check-personal.mjs --report --list`.**
- Исключения `scripts/check-personal.allow.json`: `{"allow": [{"path", "rule", "sha256"}]}`, хэш значения как найдено
  (для `deny-word` — слов в нижнем регистре через `-`). Неиспользованное — находка `stale-allow` с номером `allow[i]`.
  Сейчас список пуст.
- `--hash-from <privacy.json>` печатает только хэши; запись без слов, из четырёх и больше слов или не строка — exit 1 и
  номер `deny[i]`, без значения.
- `scripts/check-personal.hashes.json` построен `--hash-from` из личного списка на машине владельца: 10 записей, все
  приняты, 10 хэшей и 2 префикса.
- `pnpm lint`: `node scripts/check-personal.mjs --report` стоит перед `evidence-check` — contract test
  `test/contract/ci-workflow.test.ts` требует, чтобы `evidence-check` был последним шагом.

### Время

`node scripts/check-personal.mjs --report` на всём дереве (6280 файлов, около 50 MB текста), Mac владельца:
3.3–4.0 s за три запуска (без нагрузки 2.6 s). Меньше 5 s; `pnpm lint` целиком — 28–30 s.

### Отчёт guard-а по `main` (93ae34333 + этот Ticket)

`check-personal: 6717 findings in 436 of 6280 files`, exit 0 в режиме `--report` (после правки ревью счёт тот же).

| Папка | deny-word | home-path | host | tailscale-ip | email | token | из них в пути |
|---|---|---|---|---|---|---|---|
| `.scratch` | 2632 | 2117 | 16 | 8 | 7 | 0 | 6 |
| `test` | 526 | 892 | 116 | 75 | 23 | 22 | 13 |
| `docs` | 153 | 8 | 2 | 0 | 0 | 0 | 0 |
| `src` | 18 | 33 | 11 | 1 | 1 | 0 | 0 |
| `harness` | 6 | 21 | 6 | 0 | 1 | 0 | 0 |
| `scripts` | 14 | 1 | 2 | 0 | 0 | 0 | 0 |
| корень | 4 | 0 | 0 | 0 | 1 | 0 | 0 |
| всего | 3353 | 3072 | 153 | 84 | 33 | 22 | 19 |

`token` 22 — все в `test/` (вероятно, вымышленные токены test-ов `privacy.cjs`; проверяет Ticket 05).

Совпадения по записям личного списка (номер записи, число слов, совпадений по словам; файлов с подстрокой):
`deny[0]` 1 слово, 2139 (111 файлов); `deny[1]` 1, 50 (17); `deny[2]` 1, 13 (6); `deny[3]` 1, 420 (85); `deny[4]` 1,
653 (147); `deny[5]` 1, 15 (4); `deny[6]` 3, 42 (14); `deny[7]` 2, 8 (3); `deny[8]` 3, 13 (8); **`deny[9]` 1 слово, 0 и
0** — запись не совпала ни разу, ни словом, ни подстрокой: возможно опечатка, владельцу проверить. `deny[0]` — больше
всего совпадений: если это и обычное слово английского, ложные находки (риск 2) — повод убрать запись, а не плодить
исключения.

### Проверки

- `pnpm test test/unit/check-personal.test.ts` — exit 0 (18 passed; после ревью, commit
  `8e89c26d1ed63923f9b11fa9eb5a78c7b0425156`, — 21 passed).
- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0; `pnpm test` — exit 0 (704 files passed, 7 skipped;
  16509 tests passed, 123 skipped; после ревью — 16512 passed).
- gate fast — exit 0, `[gate] green (fast)` (оба раунда).
- В скрипте, хэш-списке, списке исключений и test-е нет ни одной записи личного списка подстрокой (проверено на машине
  владельца скриптом вне репозитория, печатались только номера); guard по этим четырём файлам — 0 находок.
