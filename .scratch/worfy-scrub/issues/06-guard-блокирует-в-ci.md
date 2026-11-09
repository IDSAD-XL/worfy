# 06 — Guard блокирует в CI, находок ноль

Type: task
Status: claimed 2026-11-09T01:59Z
Branch: worfy-scrub/06
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

## Итог

Ветка `worfy-scrub/06`, commit правки `44921d02c`.

### Находки guard-а

`node scripts/check-personal.mjs --report --list` на свежем `main` (`784fa137b`): 37 находок в 9 файлах — home-path 23,
host 13, email 1. После правки `node scripts/check-personal.mjs` — exit 0, `no findings in 6275 files`.

- 36 находок — подстановки, которые пишет `scripts/codex-capture.mjs` в записи Codex: хост `capture-host` (с `.local`)
  и домашняя папка Linux с именем `owner`. Записи, их `README.md` и `test/contract/codex-compat.test.ts` не правились: оба
  значения стали stand-in-ами guard-а (`STAND_IN_HOSTS`, новый `STAND_IN_HOME_NAMES`). Одна находка — пример имени
  хоста Mac с заглавной буквы в комментарии скрипта, заменён на `<name>.local`, как в Ticket-е 04.
- 1 находка — адрес сопровождающего пакета glob в уведомлении `deprecated` в `pnpm-lock.yaml` (данные реестра npm).
  Lockfile руками не правится: запись в `scripts/check-personal.allow.json` с полем `reason`.
- Устаревших исключений не было: до Ticket-а список `allow` был пуст.
- `harness/bin/profile` и fixture flight-recorder guard не находит (путь с `acme` убрал Ticket 04, правило `uuid`
  guard не применяет): правки не нужны.

### Правила

- `harness/lib/privacy.cjs`: чтение свойства в коде (`side.local,`, `root.local !== true`, `this.options.local)`)
  больше не хост `*.local`. Условие: все метки — идентификаторы со строчной первой буквы, а после идёт то, что
  идёт после выражения в коде (`)`, `,`, `;`, `]`, `}`, сравнение, `&&`, `||`, `??`, `?.`, присваивание, двоеточие не
  перед портом). Хост одним словом в тексте, с портом, в пути или перед словом находится как раньше. Цена: хост одним
  словом в тексте перед `)` или `,` пропускается — записано на странице `docs/features/evidence.md`. Правка
  платформенная: `privacy.cjs` общий с `evidence-check`; test-ы в обе стороны — в `harness/bin/tests/evidence-check.test.sh`.
- Слова guard режет по буквам и цифрам любой письменности (`\p{L}`, `\p{M}`, `\p{N}`; NFC, нижний регистр), запись
  списка — тем же правилом. Кириллическое слово из списка теперь находится (test с вымышленным словом, хэш передан
  параметром), запись с `-` или `.` находится как прежде (test с вымышленными `quill-fen` и `brask.oy`). Для 10
  записей открытого списка хэши не меняются: в них нет не-ASCII. Цена: guard на всём дереве — около 3,3 s вместо 2,5 s,
  потому что кириллические слова теперь тоже хэшируются.
- Stand-in-ы хостов и Tailscale по-прежнему только в `scripts/` (spec, Q6): `evidence-check` их не знает. Свести
  два списка — отдельное решение, Ticket его не принимал.

### Блокировка

`lint` в `package.json` зовёт `node scripts/check-personal.mjs` без `--report`. Проверка: временная ветка с одним
commit-ом — файл `docs/throwaway-finding.md` с домашним путём macOS и вымышленным именем пользователя. `pnpm lint` —
exit 1, строка вывода `docs/throwaway-finding.md:1: home-path: qw…(7)`, затем `check-personal: 1 findings in 1 of
6276 files`. Ветка удалена, в PR её нет.

### Проверки

- `node scripts/check-personal.mjs` — exit 0; `node scripts/check-handoff.mjs` — exit 0; `pnpm lint` — exit 0;
  `pnpm typecheck` — exit 0.
- `test/unit/check-personal.test.ts` — 25 passed (5 новых, все пять красные на коде `main`); вместе с
  `gate-failures-transfer`, `harness-human-review-setup`, `harness-review-draft-lint`, `codex-compat` — 171 passed.
- `bash harness/bin/tests/evidence-check.test.sh` — passed 240, exit 0; `bash harness/bin/tests/ticket-evidence.test.sh` —
  passed 79, exit 0.
