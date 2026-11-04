# Evidence

> Перевод [английской версии](../evidence.md), commit `same-pr`.

Три близких Feature. **Evidence** — строка под пунктом раздела «готово» Ticket-а: чем пункт доказан и где проверен; worfy
показывает состояние каждого пункта на карточке и в Focus mode. **Privacy check** не пускает личные данные в то, что ветка
добавляет в Tickets root публичного репозитория. **Снимки и клипы** — картинки, которые могут быть Evidence: когда пункту
нужна картинка и как её снимает test worfy. Термины объяснены в [Concepts](concepts.md); карточка Ticket-а и Focus mode — на
странице [Workflow](workflow.md). План и причины — в spec Epic-а [worfy-evidence](../../../.scratch/worfy-evidence/spec.md).

## Evidence

### Behaviour

**Строка.** Строка Evidence — вложенный пункт списка под checkbox-пунктом раздела «готово», по факту на строку:

```markdown
- [x] Unit test of the chat command
  - evidence: test-run pass · `pnpm test test/unit/chat.test.ts` exit 0 · mac dev · 3f2a1b9c
  - evidence: review pass · PR #1190 · - - · 3f2a1b9c
- [ ] (manual) The canvas on the PC
  - needs: windows stable
  - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
- [ ] (manual) A Ticket card dragged to another column follows the cursor and lands without a jump
  - evidence: video pass · `../evidence/11-card-drag.webm` · mac dev · 3f2a1b9c · scrub: 2026-11-05
```

Форма — `- evidence: <kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <YYYY-MM-DD>]`, поля разделены ` · `:

| Поле | Значения |
|---|---|
| `kind` | `commit`, `test-run`, `ci-check`, `gate`, `review`, `screenshot`, `video`, `owner-check` |
| `verdict` | `pass` или `fail`, у всех видов. `VERIFIED` ревьюера пишется как `pass`, `REJECTED` — как `fail`; сами эти слова не принимаются |
| `ref` | Свободный текст в одну строку без ` · `: команда с exit code, `PR #N`, URL или путь в backticks относительно файла Ticket-а |
| `platform` | `mac`, `windows`, `linux`, `ci`. Платформа, никогда не имя хоста |
| `copy` | Какая копия приложения работала: `stable`, `installed`, `dev`, `ci` или `-`, когда приложение не запускалось. У `commit` и `review` всегда `- -`; `screenshot`, `video` и `owner-check` обязаны назвать копию |
| `sha` | От 7 до 40 hex-цифр: commit, к которому привязан факт. Обязателен |
| `scrub:` | Дата, когда человек проверил пиксели снимка или каждый кадр contact sheet клипа. Обязателен у строки `video` и у строки `screenshot`, чей ref — путь |

`- needs: <platform> [<copy>]` — требование пункта, его пишет автор Ticket-а: пункт доказан только на этой платформе и, если
копия названа, в этой копии.

Каждый checkbox-пункт раздела на любой глубине получает номер по порядку файла, с 1. Строка Evidence или needs относится к
ближайшему checkbox-пункту над ней и не входит в текст пункта. Строки внутри блока кода не читаются. Раздел — `tickets.done_section`
Profile-а (`## Done when` без Profile-а), ручная пометка — `tickets.manual_mark` (`manual`); старые русские заголовок и пометка
тоже читаются, один релиз.

**Состояние пункта.**

| Состояние | Когда |
|---|---|
| Failed | Последняя строка Evidence пункта говорит `fail` |
| Verified | Не Failed, все строки читаются, и строка `pass` доказывающего вида совпадает с `needs` по платформе (и по копии, если `needs` её называет). Доказывает любой вид, кроме `review`; ручной пункт доказывают только `owner-check`, `screenshot` или `video` |
| Not verified | Всё остальное, с причиной: `no evidence`, `review only`, `needs <platform> <copy>, got <platform> <copy>`, `manual item needs owner-check, screenshot or video`, `unreadable evidence line` |

Счёт `n of m` идёт по всем checkbox-пунктам раздела: `m` включает пункты без строк. Старый Ticket без строк читается как
`0 of m`, и больше для него ничего не меняется.

**`ticket evidence`.** `ticket` Harness — единственный, кто пишет строки:

- `ticket evidence <epic> <NN>` печатает пункты как `<n>. <state> <reason> — <text>`, под каждым его строки, и последней —
  `evidence: N of M verified`. Exit 0.
- `ticket evidence <epic> <NN> <item> <kind> <pass|fail> --ref "<text>" [--platform P] [--copy C] [--sha S] [--scrub
  YYYY-MM-DD] [-n]` пишет одну строку после последней строки пункта `<item>`. Платформа по умолчанию — этой системы (`ci`
  под GitHub Actions), SHA — `HEAD`, копия — `-`. `-n` печатает строку и ничего не пишет. Остальной файл, включая byte order
  mark и концы строк, остаётся как был.
- Отказ с exit 2, ничего не записано: строка, которую не принимает грамматика; пункт вне раздела; флаг без значения;
  `screenshot`, чей ref — путь, без `--scrub` («check the pixels by eye first»); `video` без `--scrub`; `video`, чей ref — не
  файл `.webm` или `.mp4` в `<epic>/evidence/` Tickets root с PNG contact sheet `<name>.sheet.png` рядом, или чей клип или
  sheet — символическая ссылка. Неизвестный флаг — exit 1.
- Отказ с exit 1: privacy check нашёл что-то в файле, куда ведёт путь в backticks из `--ref`, или в contact sheet клипа.
  Его вывод с замаскированными значениями идёт в stderr. В Silent mode эта проверка пропускается: там ничего не публикуется.

`ticket done` печатает в stderr `evidence: N of M verified` и каждый пункт в состоянии Not verified или Failed. Его exit code
остаётся 0, статус записывается.

**Кто пишет какую строку.** Автора каждой строки называют skills и файлы агентов Harness. Сам `ticket` не спрашивает, кто его
запустил.

| Строка | Кто | Когда |
|---|---|---|
| `test-run`, `gate`, `commit` | Implementer | В своей ветке, вместе с кодом, до PR: строки попадают в diff PR и в ревью. Только `pass` и только для пунктов, которые доказали его проверки |
| `review` | Orchestrator | При закрытии: `pass` при `VERIFIED`, `fail` при `REJECTED`, ref `PR #N` |
| `ci-check` | Orchestrator | При закрытии: URL run-а итоговой проверки CI на head PR, платформа `ci` |
| `owner-check` | Orchestrator, со слов владельца | Ref — дата и слово владельца; копия — та, в которой смотрел владелец |
| `screenshot` | Тот, кто снимал | После того как человек проверил пиксели: дата этой проверки идёт в `scrub:` |
| `video` | Тот, кто записал | После проверки каждого кадра contact sheet. У клипа fixture-сборки эту проверку может сделать сам агент, а владелец смотрит такие клипы выборочно; любой другой клип ждёт человека |

Implementer не пишет строк под ручным пунктом, кроме той строки `video` клипа fixture-сборки. Ревьюер строк не пишет: он
проверяет, что каждый ref существует, SHA есть в ветке и `needs` совпадает.

`review` и `ci-check` пишутся при закрытии, а не в ветке: строка в ветке после CI дала бы новый head и ещё один CI run. В Full
mode Orchestrator кладёт их в state-файл `land` как `prs[].evidence`, и `land` пишет их через `ticket evidence` в своём
documents PR до `ticket done`. В Silent mode documents PR нет: Orchestrator сам запускает `ticket evidence` в Workflow folder,
а `land` печатает `evidence of #N is the orchestrator's (tickets outside the repository)`.

**На Canvas.** Карточка Ticket-а показывает chip `Evidence n/m`: зелёный, когда проверены все пункты, красный, когда есть пункт в состоянии
Failed, нейтральный в остальных случаях; в tooltip — три счёта. В Focus mode над текстом Ticket-а матрица Evidence показывает
строку на каждый пункт с его состоянием и строками, и каждая ссылка открывает свой источник: SHA — свой commit, `PR #N` — свой
pull request на странице `origin` Project-а, URL `https://` — как есть (URL `http://` остаётся простым текстом), путь — в программе системы по умолчанию. У Ticket-а без
checkbox-пунктов в разделе «готово» нет ни chip-а, ни матрицы. Chip ничего не открывает. Карточка, место chip-а и матрица по
строкам — на странице [Workflow](workflow.md#ticket-и-epic-на-canvas); снимки и клипы в матрице — в разделе
[Снимки и клипы](#снимки-и-клипы).

worfy не сверяет строку с источником. Он не спрашивает, зелёный ли CI run, предок ли SHA merge-commit-а, есть ли verdict gate.
Строка — честная запись с видимым состоянием.

### How it works

- **Строка живёт в файле Ticket-а.** Файл Ticket-а — источник правды, worfy его только читает
  ([ADR-0002](../../adr/0002-worfy-is-a-view-over-the-workflow.md)). Строки видны в diff и в ревью, а в Silent mode живут в
  Workflow folder рядом с Ticket-ом.
- **Факт привязан к commit-у.** SHA обязателен, как у отметок агентов
  ([ADR-0067](../../adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md)).
- **Платформа, а не машина.** Имя хоста в строке само было бы той утечкой, ради которой есть privacy check.
- **Две копии одной грамматики.** Harness читает строки на CommonJS, worfy — на TypeScript. Обе читают одни общие случаи, и их
  держит вместе contract test, как у правил Pipeline.

### Implementation

| Что | Где |
|---|---|
| Грамматика и правила состояния, копия Harness | `harness/lib/evidence.cjs` |
| `ticket evidence`, предупреждение `ticket done` | `harness/bin/ticket`; описание для людей — `harness/bin/TICKETS.md`, «Evidence» |
| Строки закрытия, `prs[].evidence` | `harness/bin/land` |
| Кто пишет какую строку | `harness/skills/ship-ticket/implementer-finish.md`, `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/skills/ship-ticket/step-9-merge.md`, `harness/skills/epic-wave/SKILL.md`, `harness/agents/reviewer.md` |
| Грамматика и правила состояния, копия worfy; модель | `src/shared/workflow/evidence.ts`, `src/shared/workflow/types.ts` |
| Чтение пунктов вместе с Ticket-ом | `src/main/workflow/reader.ts` |
| Chip и матрица | `src/renderer/canvas/badges/Evidence.tsx`, `src/renderer/canvas/nodes/EvidenceMatrix.tsx` |

**Поток данных.** Reader разбирает раздел «готово» каждого файла Ticket-а функцией `evidenceItems` и отдаёт пункты с
состояниями в модели Ticket-а. Chip считает их через `evidenceSummary`, матрица их рисует. worfy никогда не пишет строку.

**Главные test-ы.**

- `harness/bin/tests/ticket-evidence.test.sh`: матрица, запись строки, каждый отказ, состояния, `ticket done`, заголовки.
- `harness/bin/tests/land.test.sh`: строки `prs[].evidence` и проверка до push.
- `harness/bin/tests/agents-text.test.sh`: тексты агентов и skills держат правила, кто пишет какую строку.
- `test/unit/evidence.test.ts` и `test/contract/evidence-rules-agree.test.ts` (на общих случаях
  `harness/bin/tests/fixtures/evidence/grammar.json`): копия worfy и её согласие с копией Harness.
- `test/unit/evidence-matrix.test.tsx`, `test/e2e/ticket-evidence.spec.ts`: chip, матрица и куда ведут её ссылки.

## Privacy check

### Behaviour

`evidence-check` Harness ищет личные данные в том, что ветка добавляет в Tickets root (у worfy `.scratch/`: Ticket-ы,
`spec.md`, папки `evidence/`). Сам он push не останавливает: он идёт в этих местах, и каждое останавливается на находке.

| Где | Что делает при находке |
|---|---|
| `ticket evidence` | Проверяет файл из ref до записи строки; отказ с exit 1 |
| `land` | Проверяет свой documents PR до push; ничего не commit-ит и не push-ит, результат красный |
| Skills `ship-ticket` и `epic-wave` | Перед push documents PR, сделанного руками: `evidence-check --changed` должен выйти с 0 |
| `pnpm lint` | Заканчивается на `evidence-check --changed --root .scratch`. CI гоняет его в job-е `lint-typecheck` на каждом PR, и на PR только с документами тоже. Это последний рубеж: красный `ci-ok` не даёт merge, но push уже был |

**Что читает.** С `--changed`: файлы Tickets root, которые ветка добавила или изменила, staged или нет, и неотслеживаемые. У
изменённого текстового файла — только добавленные строки; добавленный файл читается целиком, и его путь тоже: снимок, в имени
которого имя хоста, — тоже утечка. Файлы, названные в командной строке, читаются целиком. База — `--base`; под GitHub Actions —
`HEAD^1`; иначе `git merge-base HEAD <worktree.base>` Profile-а (`origin/main`). Старые файлы не проверяются — только то, что
добавляет ветка.

**Что находит.**

| Правило | Что | Не находка |
|---|---|---|
| `home-path` | Имя пользователя в пути домашней папки: `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\` (любое число `\`, или `/`), тот же путь в записи Git Bash (`/c/…`) и WSL (`/mnt/c/…`) | Имена `test`, `someone`, `user`, `you`, `runner`, `runneradmin`, `RUNNER~1`, `Shared`; любое `<…>`; многоточие; переменная (`$USER`, `%USERNAME%`); имя, которое начинается с точки (`/home/.cache`); `~` и `%USERPROFILE%` |
| `host` | Имя, которое кончается на `.local` (только в нижнем регистре) или `.ts.net` (Tailscale MagicDNS, в любом регистре), `DESKTOP-` и семь букв или цифр, имена с `-MacBook`, `s-Mac` или с концом `-PC`, и короткое имя хоста машины, на которой идёт проверка | `localhost`; хост с частью `example` |
| `tailscale-ip` | Адрес IPv4 сети Tailscale, 100.64.0.0/10 | Сама сеть, записанная как CIDR |
| `uuid` | UUID любой версии | UUID из одной повторённой цифры, `00000000-0000-0000-0000-000000000000`, и UUID, где все цифры, кроме цифр версии и варианта, — одна повторённая цифра, `44444444-4444-4444-8444-444444444444` |
| `email` | Адрес email | `noreply@…`, `no-reply@…`, адреса в `users.noreply.github.com`, `git@github.com`, любой адрес в `example.*`, имя файла с `@` |
| `token` | Токены GitHub, ключи `sk-` с цифрой внутри (и Anthropic; без цифры это читается как имя, например ветка `sk-learn-…`), ключи доступа AWS, токены Slack, JWT, первая строка закрытого ключа PEM, значение после `Bearer` | |
| `deny` | Слово личного списка `<Harness home>/user/privacy.json`, `{"deny": ["…"]}`, где угодно и в любом регистре | |

Списка разрешений в репозитории нет: ложная находка исправляется записью значения в форме-заглушке (`~`, `<home>`, `<host>`,
`<uuid>`), чтобы список разрешений сам не публиковал значение. Личный список лежит вне всех репозиториев и держит имена,
которых не знают шаблоны, например другую машину владельца.

**Снимки и другие двоичные файлы.** У снимка (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) проверка читает текст metadata: PNG
`tEXt`, `iTXt`, `zTXt` и `eXIf`, JPEG Exif, XMP и комментарии, WebP `EXIF` и `XMP `, комментарии GIF. Пиксели она не читает.
Снимку или другому двоичному файлу, который добавляет ветка, нужна строка `screenshot` со `scrub:`, тоже добавленная веткой,
чей путь в backticks ведёт из папки Ticket-а именно на этот файл; файл с тем же именем в другом Epic-е не считается. Без неё —
находка `image needs a human check (no scrub: note)`. Изменённый или старый снимок такой находки не даёт.

**Клипы** (`.webm`, `.mp4`, а также `.mov`, `.m4v`, `.mkv` — они читаются как клипы, чтобы их не отметила строка
`screenshot`). Проверка читает каждый элемент и box контейнера, кроме кадров, в UTF-8 и UTF-16, а соседние — ещё и вместе,
чтобы найти путь, разорванный между двумя. Клип — находка, если в нём дорожка звука (test звука не пишет, так что звук может
прийти только с микрофона машины), дорожка субтитров или данных, сжатая внутри metadata, больше 8 MB (8 × 1024 × 1024 байт),
больше 60 с, нет длительности в заголовке или контейнер не читается до конца. Клипу, который добавляет ветка, нужна строка
`video` со `scrub:` (строка `screenshot` его не отмечает): `video needs a human check (no scrub: note)`. И нужен его contact
sheet `<name>.sheet.png` — PNG, добавленный той же веткой: `video needs a contact sheet`. Строка клипа покрывает его sheet,
metadata sheet проверяется как у снимка. Символическая ссылка проверяется как её текст — так её публикует git; ссылка, которая
ведёт вне репозитория, — находка.

**Вывод.** Строка на находку, `<file>:<line>: <rule>: <masked value>`. От значения видны только две первые буквы, `…` и длина
(`Ab…(6)`): лог CI публичный. Находка в пути файла замаскирована и в пути. У снимка `<line>` — chunk metadata, у клипа —
элемент или box, у пути файла — `path`, у всего файла — `-`. Exit 0 печатает `evidence-check: ok (N files)`, 1 — находки и
последняя строка `evidence-check: N findings`, 2 — проверка не смогла запуститься (нет git, нет базы). В Silent mode Tickets
root вне репозитория: проверка печатает `nothing to check` и выходит с 0.

**Как исправить находку.** Заменить значение формой-заглушкой: `~` или `<home>` для домашней папки, `<host>` для машины,
`<uuid>` для UUID. Новый снимок или клип проверяет человек, и строка получает дату `scrub:`. Не push-ить, пока проверка не
выйдет с 0.

#### What it cannot catch

`evidence-check --help` перечисляет первые шесть пунктов. Страница добавляет то, что код тоже пропускает: имя `.local` в
верхнем регистре, сущности XML и percent-encoding, путь, разорванный в UTF-16, голый поток zlib, и последний пункт.

- Текст на пикселях снимка или клипа: имена Machine в sidebar, заголовок Project, вывод terminal на картинке. Их ловят только
  человек и отметка `scrub:`.
- Кадры клипа между секундами его contact sheet: то, что показалось меньше чем на секунду, может не попасть ни на один кадр
  sheet. Поэтому агент может сам проверять только клипы fixture-сборки, где нет данных машины.
- Имя хоста или пользователя в непредсказуемой форме — сокращение, другое написание, — если его нет в личном списке.
  Имя `.local` в верхнем регистре (`BOX.LOCAL`) — такая форма: это правило учитывает регистр.
- Имя другой машины (ПК на Mac и наоборот), пока его нет в личном списке: имя хоста известно только для машины, на которой идёт
  проверка, а на CI — ни для какой.
- Секрет, разорванный переносом строки, base64 и кодировки, кроме UTF-8 и UTF-16. Среди них: путь, записанный сущностями XML
  (`&#47;` вместо `/`) или percent-encoding (`%2F`), — правила их не раскодируют; путь, разорванный между двумя элементами клипа
  в UTF-16 (вместе читаются только чтения UTF-8); metadata, сжатая внутри клипа голым потоком zlib, — её не распаковывают и о ней
  не сообщают (находятся только элемент webm `ContentCompression`, QuickTime `cmov` и байты gzip, zip, xz, zstd, 7z и bzip2).
- Файлы вне Tickets root, история git (то, что запушено, остаётся доступным по SHA), текст PR и комментариев на GitHub.
- На push в `main` или на запуске руками job CI проверяет только последний commit (`HEAD^1..HEAD`): ранние commit-ы push-а из
  нескольких там не проверяются. PR каждого изменения был проверен против своей базы до merge.

#### Windows

Проверка — скрипт Node без зависимостей и работает на Windows. Пути там сравниваются без учёта регистра.

### How it works

- **Только то, что добавляет ветка.** В старых файлах Ticket-ов уже есть пути домашних папок; проверка всего дерева утонула бы в
  них, поэтому читаются только добавленные строки и новые файлы.
- **Правила — отдельный от скрипта модуль.** `privacy.cjs` держит шаблоны, заглушки и маску и не читает никаких файлов, кроме
  личного списка, так что другой скрипт может взять те же правила без чтения git.
- **Отметку разбирает своё выражение**, а не разбор Evidence Harness. Строка внутри блока кода тоже считается отметкой.

### Implementation

| Что | Где |
|---|---|
| Правила, маска, личный список | `harness/lib/privacy.cjs` |
| Проверка: файлы, metadata, клипы, отметки, вывод | `harness/bin/evidence-check` |
| В `pnpm lint` | `package.json`, скрипт `lint` |
| В CI, с checkout двух commit-ов | `.github/workflows/ci.yml`, job `lint-typecheck` |
| До push `land` | `harness/bin/land` |
| До push руками | `harness/skills/ship-ticket/step-11-close.md`, `harness/skills/epic-wave/SKILL.md` |

**Главные test-ы.**

- `harness/bin/tests/evidence-check.test.sh`: каждое правило и каждая заглушка, metadata снимков и клипов, отметки, `--changed`
  во временном репозитории, замаскированный вывод. Значения собираются в test-е из кусков, чтобы репозиторий проходил свою же
  проверку.
- `harness/bin/tests/ticket-evidence.test.sh`: отказы `ticket evidence` при находке.
- `test/contract/ci-workflow.test.ts`: два commit-а у job-а `lint-typecheck`.

## Снимки и клипы

### Behaviour

**Когда пункту нужна картинка.** По тому, что говорит пункт:

- Он о том, **как что-то выглядит**: вёрстка, цвет, подпись, состояние control-а, тема. Снимок окна приложения в обеих темах,
  вид `screenshot`.
- Он о **движении**: анимация, drag, последовательность через несколько экранов, timing. Клип с contact sheet, вид `video`.
- **Всё остальное** — без картинки: доказывает test с exit code. Картинка «на всякий случай» — ещё один файл, пиксели которого
  кто-то должен проверить руками.

Картинка берётся только из сборки самого worfy с fixture-данными (временный Project, fake agent, никаких данных машины) и
снимается Playwright через e2e test-ы; никогда — из установленной копии или Stable copy и никогда — снимком экрана через ОС.

**Клип и contact sheet.** Клип — `.scratch/<epic>/evidence/<NN>-<what>.webm`: VP8, как его пишет Playwright, не дольше 60 с,
не больше 8 MB, без звука. Рядом лежит `<NN>-<what>.sheet.png`: одна PNG, сетка кадров, по кадру на каждую секунду сценария с
номером секунды под ним, каждый кадр в размере окна. Перед `scrub:` глазами проверяют sheet; клип смотрят, когда sheet вызвал
вопрос. Клип включает ещё запуск и выход приложения — на несколько секунд дольше сценария; на sheet их нет.

**В матрице.** Под строкой `screenshot`, чей файл лежит в `<epic>/evidence/` (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`),
матрица показывает миниатюру; щелчок открывает картинку поверх окна, с «Open in default app». Под строкой `video` клип (`.webm`
или `.mp4`) играет на месте, без звука, с элементами управления, а «Contact sheet» открывает sheet поверх окна. Файл, который
не загрузился, говорит «File not found», «File over 8 MB» или «File cannot be shown» (отдан, но окно не рисует его как картинку
или клип), рядом с «Open in default app»; contact sheet, который не загрузился, закрывает overlay и говорит об этом рядом с
клипом.

#### On a Linked machine

Окно на Linked machine не показывает миниатюр и не играет клипов: store файлов Evidence по link-у не отдаётся, а путь в
матрице показывает «File is on <Machine>», как и другие ссылки Ticket-а.

#### Windows

Helper-ы пишут и на Windows. Contact sheet рисуется на canvas в скрытом окне: окно там, даже за пределами экрана, обрезается до
размера экрана.

### How it works

- **Sheet снимается, а не вынимается.** Helper снимает окно раз в секунду, пока идёт сценарий, а не достаёт кадры из
  клипа: так Harness не нужен декодер видео и новая зависимость. Цена — кадры между секундами, их privacy check называет своим
  пределом.
- **Файлы идут через `worfy-image://`.** Store файлов Evidence Project-а называется `evidence-<project label>` (project label —
  8 hex-цифр). Его корень — Tickets root Project-а, в Silent mode — Workflow folder, и он отдаёт только файлы под
  `<epic>/evidence/`, до 8 MB, картинки и клипы. В имени дефис, а не точка: Chromium читает хост, у которого последняя часть
  только из цифр, как адрес IPv4 и отвергает URL, а project label время от времени бывает весь из цифр. По той же причине хост
  картинки Canvas пишется как `canvas-<project label>` ([Canvas](canvas.md)).
- **Клип отдаётся по range-запросам.** Store отвечает на запрос `Range` кодом 206 и `Content-Range`, чтобы `<video>` мог перематывать;
  range за концом файла — 416, файл больше 8 MB — 413. Файл открывается один раз, и его дескриптор сверяется с путём, так что
  файл, подменённый после проверки, — 404. Символические ссылки не проходятся ни на одном шаге. Политика безопасности окна
  открывает `media-src` только этой схеме.
- **Отслеживаемый файл не заменяется.** Повторный запуск helper-а с тем же Ticket-ом отказывает на файле, который git уже
  отслеживает: проверенная картинка не должна меняться незаметно.

### Implementation

Helper-ы — для разработчиков worfy. `captureScreenshot(page или locator, what)` снимает `<NN>-<what>-light.png` и
`<NN>-<what>-dark.png` и потом возвращает странице её цветовую схему. `recordClip(what, scenario)` запускает fixture-сборку с
`recordVideo`, отказывает при `executablePath`, гонит сценарий с кадром в секунду и сохраняет клип и его sheet. Оба пишут в
`.scratch/<epic>/evidence/` worktree, когда задан `WORFY_EVIDENCE=<epic>/<NN>`, а иначе — в папку вывода самого test-а, так
что run на CI ничего не оставляет в репозитории. Каждый файл проходит `evidence-check` до возврата из helper-а, а при любой
ошибке ни один записанный им файл не остаётся. Для Ticket-а helper печатает команду `ticket evidence`, где номер пункта и дата
`scrub:` оставлены тому, кто проверит пиксели. `pnpm test:e2e` сначала ставит ffmpeg Playwright, нужный клипу, а `recordClip`
называет команду установки, когда его нет. Приложение под test-ом получает `WORFY_TAILSCALE` на несуществующий файл, чтобы в
картинку не попали имена tailnet машины разработчика. Они лежат в `test/e2e/evidence-capture.ts`.

| Что | Где |
|---|---|
| Helper-ы снимка и клипа | `test/e2e/evidence-capture.ts`; `recordVideo` у `launchApp` — `test/e2e/helpers.ts`; окружение приложения под test-ом — `test/e2e/launch-env.ts` |
| Правило «когда картинка» | `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/skills/ship-ticket/implementer-finish.md` |
| Имя store-а, адрес, предел 8 MB | `src/shared/images.ts` |
| Store Evidence, только для окна этой Machine | `src/main/images/stores.ts` |
| Отдача файлов, range, пределы | `src/main/images/protocol.ts` |
| Политика безопасности окна | `src/renderer/index.html` |
| Просмотр в матрице | `src/renderer/canvas/nodes/EvidencePreview.tsx`, `src/renderer/canvas/nodes/evidence-files.ts` |

**Главные test-ы.**

- `test/e2e/evidence-capture.spec.ts`: снимок в обеих темах и клип с sheet на настоящей записи Playwright, оба через
  `evidence-check`.
- `test/contract/evidence-image-protocol.test.ts`: store, пути, которые он отдаёт и отвергает, range, 413 и 416.
- `test/e2e/ticket-evidence.spec.ts` на fixture-клипе `test/fixtures/evidence-clip/`: миниатюра, overlay, проигрывание клипа и
  contact sheet в окне.
- `test/unit/evidence-matrix.test.tsx`: какие строки получают просмотр и подписи сбоев.
