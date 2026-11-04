# 02 — Privacy check `evidence-check` и модуль правил `privacy.cjs`

Type: task
Status: claimed 2026-11-04T00:40Z
Blocked by: —
Source: [spec.md](../spec.md), «Privacy check» (весь раздел, включая «Чего privacy check не ловит»), «Решено без владельца», п. 4, 5, 10–12, 14, «Вопросы владельцу», Q3, Q4, Q5, Q7; случай docs PR #1306; worfy-failures 01 (берёт `harness/lib/privacy.cjs` для записей о красных test-ах)

## Что происходит

- Evidence в docs PR #1306 унесла в публичный репозиторий Windows user name в путях, имена Mac и ПК, UUID аккаунтов
  claude.ai (installPath plugin-ов `@synced`) — в JSON и на снимках (имена Machine в sidebar, заголовок Project).
  Чистили force-push-ем; старый commit доступен по SHA.
- Проверки личных данных нет ни в Harness, ни в `pnpm lint` (`package.json:17`).
- Старое уже в истории: `/Users/<name>/` и `C:\Users\<name>` — в 84 файлах `.scratch/` (2026-11-04). Проверять надо то,
  что добавляет ветка.
- В `.scratch/` сотни файлов с кириллицей в имени. `scripts/ci-scope.mjs:440-443` берёт список файлов git с `-z`: без него git
  (`core.quotePath`) отдаёт такие имена в кавычках с восьмеричными кодами.
- Epic worfy-failures 01 чистит записи о красных test-ах теми же правилами; модуль правил один, и он здесь.

## Что делаем

1. **`harness/lib/privacy.cjs`** (CommonJS, без fs и git; правила spec-а, «Privacy check», «Текст»):
   - `findings(text, options?)` → `[{ rule, index, length }]`, `rule` — `home-path`, `host`, `tailscale-ip`, `uuid`, `email`, `token`,
     `deny`; `options` — `{ hostname?: string, deny?: string[] }`. Значения в результате нет: его достаёт вызывающий по `index`.
   - `mask(value)` → две первые буквы, `…`, длина (`Ab…(6)`).
   - `maskText(text, options?)` → текст, где каждая находка заменена `mask` — для чужих записей (worfy-failures 01).
   - `personal(harnessHome)` → `{ deny }` из `<harnessHome>/user/privacy.json`; нет файла или он сломан — `{ deny: [] }`.
   - Заглушки (не находки): имена `test`, `someone`, `user`, `you`, `runner`, `runneradmin`, `RUNNER~1`, `Shared`, `<…>`;
     UUID из одной цифры; noreply-адреса и `example.*`; `localhost`. Списка разрешений в репозитории нет (Ответ Q4).
   - API и правила описаны в шапке файла; правка правила — правка этого файла и его test-а.
2. **`harness/bin/evidence-check`** — Node, без новых зависимостей:
   `evidence-check [--changed] [--base <ref>] [--root <tickets root>] [<file>…]`.
   - `--changed`: файлы Tickets root, добавленные (`A`) или изменённые (`M`) между базой и `HEAD`, плюс staged и неотслеживаемые.
     База — `--base`; в GitHub Actions (`GITHUB_ACTIONS=true`) — `HEAD^1`; иначе `git merge-base HEAD <worktree.base>` (поле
     Profile-а, у worfy `origin/main`; без Profile-а — `origin/main`). Tickets root — `--root`, иначе `ticket root`.
   - Списки — `git -c core.quotePath=false diff --name-status -z --no-renames …`, `ls-files -z --others --exclude-standard`;
     добавленные строки — `git -c core.quotePath=false diff -U0`.
   - Корень вне репозитория (Silent mode) — `evidence-check: nothing to check (tickets root is outside the repository)`, exit 0.
   - У изменённого текстового файла — только добавленные строки; у нового и явно названного — весь файл (Ответ Q7).
3. **Пути файлов**: `findings` идёт и по пути каждого добавленного файла (снимок с именем хоста в имени — находка).
4. **Снимки и двоичные** (Ответ Q5): текст metadata PNG (`tEXt`, `iTXt`, `zTXt` через `node:zlib`, `eXIf`), JPEG (APP1 Exif и XMP,
   COM), WebP (`EXIF`, `XMP `), GIF (comment) — через `findings`. Затем, только для снимка, который ветка **добавляет** (`A` или
   неотслеживаемый), — отметка: среди строк, которые ветка добавила в Ticket-ы Tickets root, есть `- evidence: screenshot …` с полем
   `scrub: \d{4}-\d{2}-\d{2}`, и путь в backticks из её `ref`, разрешённый относительно папки этого Ticket-а, — тот же файл
   (сравнение нормализованных путей, на Windows без учёта регистра). Совпадение по одному имени файла не считается. Нет — находка
   `image needs a human check (no scrub: note)`. Изменённый или старый снимок этой находки не даёт. Другой двоичный файл, добавленный
   веткой, — то же без metadata. Разбор строки — свой, не из `evidence.cjs` (решение 5 spec-а).
5. **Вывод**: `<file>:<line>: <rule>: <masked>`, значение — через `mask`; у снимка `line` — имя chunk-а. Путь файла печатается через
   `maskText`: находка в самом пути тоже замаскирована. Exit 0 — `evidence-check: ok (N files)`; 1 — находки и последняя строка
   `evidence-check: N findings`; 2 — ошибка запуска.
6. **`--help`** перечисляет, чего проверка не ловит (spec, «Чего privacy check не ловит»).

Не входит: подключение к `pnpm lint`, CI, `ticket` и `land` (03, 04).

## Готово, когда

- [ ] Unit-уровень `privacy.cjs` (в shell test-е через `node -e`): путь `/Users/<имя>/`, `C:\Users\<имя>\`, `C:\\Users\\<имя>\\` (JSON),
      `/c/Users/<имя>/` — находка; `/Users/test/`, `C:\Users\runneradmin\`, `C:\Users\RUNNER~1\`, `~/.claude`, `%USERPROFILE%` — нет.
- [ ] Имя `*-MacBook-Pro` с `.local`, имя в `*.ts.net`, `DESKTOP-` и семь знаков, адрес сети Tailscale, слово из `deny` временного
      `HARNESS_HOME` — находки (значения собраны в test-е из кусков); `localhost` — нет.
- [ ] UUID — находка, UUID из одной цифры — нет; email и шесть видов токенов — находки; noreply-адрес и адрес в `example.com` — нет.
- [ ] `mask` и `maskText`: в результате нет исходного значения; `personal` со сломанным файлом — `{ deny: [] }`.
- [ ] PNG с `tEXt`, `iTXt` и `zTXt` (собран в test-е через `node:zlib`), JPEG с Exif-строкой — находка в metadata.
- [ ] Добавленный PNG без отметки — `image needs a human check`; с добавленной строкой `screenshot … · scrub: <дата>`, где `ref` ведёт на
      него относительно Ticket-а, — чисто; строка, где `ref` ведёт на файл с тем же именем в другом Epic-е, — не отметка; старая
      (не добавленная веткой) строка — не отметка; изменённый PNG без отметки — не находка.
- [ ] Добавленный файл `evidence/16-<имя хоста>.png` — находка `host` по пути, в выводе путь замаскирован.
- [ ] `--changed` во временном git-репозитории: старая строка с путём не находка, добавленная — находка; новый файл целиком;
      неотслеживаемый файл `evidence/` — тоже; файл с кириллицей в имени найден и напечатан без восьмеричных кодов.
- [ ] В выводе нет полного значения ни одной находки (grep по каждому значению fixture — пусто).
- [ ] Tickets root вне репозитория — exit 0 и строка «nothing to check».
- [ ] Fixture-значения собраны в test-е из кусков; файлы fixture и этот Ticket сами проходят `evidence-check` (exit 0).
- [ ] `bash harness/bin/tests/evidence-check.test.sh` — exit 0; `node scripts/check-cyrillic.mjs` — exit 0; Windows verdict до merge
      (platform PR); ревью `high`.

## Тесты

- Shell `harness/bin/tests/evidence-check.test.sh` (новый): и `privacy.cjs` (через `node -e`), и сам скрипт; бинарные fixture-ы, если
  нужны готовые, — в `harness/bin/tests/fixtures/evidence-check/` без настоящих данных.
- Сначала падающий: `node harness/bin/evidence-check <файл с путём>` — сейчас файла нет, exit не 1 с находкой.

## Где в коде

- `harness/lib/privacy.cjs` (новый)
- `harness/bin/evidence-check` (новый)
- `harness/bin/tests/evidence-check.test.sh` (новый)
- `harness/bin/tests/fixtures/evidence-check/` (новая)

Только читать: `harness/hooks/eval-env.cjs` (`git`, `harnessHome`), `harness/bin/ticket` (`ticket root`), `harness/bin/tests/real-home.sh`,
`scripts/ci-scope.mjs:440-443` (список файлов с `-z`).
