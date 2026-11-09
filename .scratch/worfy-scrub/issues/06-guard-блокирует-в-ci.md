# 06 — Guard блокирует в CI, находок ноль

Type: task
Status: done 2026-11-09T03:03Z
PR: #1711
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
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0, no findings in 6275 files · mac - · 270372ff411d01bd083e89091ccc01d25fb5cb8f
  - evidence: test-run pass · `node scripts/check-personal.mjs` exit 0, no findings in 6275 files · mac - · 1ab814743017647945456a20baf53209e799a371
  - evidence: review pass · PR #1711 · - - · d45346c8b4c7df333ffef83f6c5cc2f95a15ed15
- [ ] Проверка блокировки: ветка с одной вымышленной находкой (домашний путь с именем пользователя) — `pnpm lint` exit 1 локально;
      в «Итог» — exit code и маска из вывода.
  - evidence: test-run pass · `pnpm lint` exit 1 on throwaway commit 8ae3337df with one invented home path, line home-path: qw…(7) · mac - · 270372ff411d01bd083e89091ccc01d25fb5cb8f
  - evidence: test-run pass · `pnpm lint` exit 1 on throwaway commit 16f51686d with one invented home path, line home-path: qw…(7) · mac - · 1ab814743017647945456a20baf53209e799a371
  - evidence: review pass · PR #1711 · - - · d45346c8b4c7df333ffef83f6c5cc2f95a15ed15
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0, 16564 passed; ci-ok on the PR pending · mac - · 270372ff411d01bd083e89091ccc01d25fb5cb8f
  - evidence: gate pass · `gate fast` exit 0 · mac - · 270372ff411d01bd083e89091ccc01d25fb5cb8f
  - evidence: gate pass · `gate fast` exit 0 (lint, typecheck, test); ci-ok on the PR pending · mac - · 1ab814743017647945456a20baf53209e799a371
  - evidence: review pass · PR #1711 · - - · d45346c8b4c7df333ffef83f6c5cc2f95a15ed15
- [ ] `node scripts/check-handoff.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-handoff.mjs` exit 0 · mac - · 270372ff411d01bd083e89091ccc01d25fb5cb8f
  - evidence: test-run pass · `node scripts/check-handoff.mjs` exit 0 · mac - · 1ab814743017647945456a20baf53209e799a371
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42551470931/job/128955418970 · ci - · d45346c8b4c7df333ffef83f6c5cc2f95a15ed15

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

- `harness/lib/privacy.cjs` не меняется. Ревью, раунд 1: исключение для чтения свойства в коде (`<name>.local` перед
  `)`, `,`, `;` и т. п.) прятало настоящие хосты в тексте, а мест в коде, которые оно спасало, после Ticket-а 04 не
  осталось. Исключение убрано, правка не платформенная. Test guard-а: хост `.local` в десяти формах текста (в скобках,
  в списке через запятую, перед `;`, `:`, `&&`, `=`, в ссылке Markdown, в фигурных скобках, с двумя метками, с
  заглавной буквой) находится.
- Слова guard режет двумя способами: по `a-z` и `0-9`, как раньше, и по буквам, знакам и цифрам любой письменности
  (`\p{L}`, `\p{M}`, `\p{N}`; NFC, нижний регистр). Файл только из ASCII — первым способом; любой другой — обоими, место,
  которое нашли оба, — одна находка. Запись списка режется вторым способом. Что теперь находится: кириллическое слово
  из списка (test с вымышленным словом, хэш передан параметром); латинское слово, приклеенное к не-ASCII символу
  (`é`, `Ï`, `²`, комбинируемый акцент, кириллическое окончание, `İ`), и запись из двух слов с таким символом (test-ы с
  вымышленными словами через `--hash-from`); запись с `-` или `.` (`quill-fen`, `brask.oy`). Для 10 записей открытого
  списка хэши не меняются: в них нет не-ASCII.
- Что не находится (записано в начале `scripts/check-personal.mjs`): латинская запись, приклеенная к латинской букве
  или цифре (множественное число); нелатинская запись, приклеенная к любой букве, знаку или цифре (кириллическое
  окончание); запись с буквой, у которой нижний регистр другой формы (`İ`, знак Кельвина), внутри самой записи; другое
  написание. Пустой отчёт не доказывает, что личного не осталось (риск 8 spec).
- Цена: guard на всём дереве — около 3,5 s вместо 2,5 s: файлы с не-ASCII режутся дважды.
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
- `test/unit/check-personal.test.ts` — 26 passed. Новые test-ы раунда 1 красные на коде `main`; два test-а раунда 2
  (хост `.local` в тексте, слово с не-ASCII символом) красные на head `772fd395b`; mutant без слияния мест двух
  разрезов — 2 test-а красные.
- `bash harness/bin/tests/evidence-check.test.sh` — passed 233, exit 0 (файл и `privacy.cjs` равны `main`).
- `pnpm lint` — exit 0, `no findings in 6275 files`; `pnpm typecheck` — exit 0.
