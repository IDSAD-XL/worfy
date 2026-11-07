# worfy-evidence: у каждого пункта «Готово, когда» есть доказательство и состояние

Status: принят владельцем 2026-11-04 по рекомендации: Q1–Q7 («Со всем согласен»), Qv1–Qv4 и пункты 15–18 («Да, всё»).
Epic принят владельцем 2026-11-07 (приёмка 09: Mac 2026-11-06, ПК 2026-11-07), закрыт 13/13 —
[«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
Взят в работу по поручению владельца («можешь сразу брать в работу первый и делать его автономно»).
Source: идея 2 «Proof-Carrying Tickets» из PR #1314 (`docs/proposals/eight-autonomy-features.md`); оценка Orchestrator-а
2026-11-04, принятая владельцем (форма MVP, случаи worfy-windows 16 и docs PR #1306); [CONTEXT.md](../../CONTEXT.md) —
термины Ticket, Epic, Wave, Stage, Gate, Stable copy, Machine, Silent mode, Workflow folder, Orchestrator;
[ADR-0002](../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy читает факт, а не копирует),
[ADR-0005](../../docs/adr/0005-worfy-own-state-inventory.md) (своё состояние — в папке данных),
[ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md) (скрипты Harness — Node),
[ADR-0067](../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md) (отметки агентов привязаны к SHA),
[ADR-0074](../../docs/adr/0074-harness-neutral-by-language-and-project.md) (Harness — только английский),
[ADR-0088](../../docs/adr/0088-feature-pages-in-english.md) (страницы функций), [ADR-0089](../../docs/adr/0089-update-builds-main-in-own-clone.md) (Stable copy).
Ticket-ы: Epic `worfy-evidence`, 12 Ticket-ов, нумерация с `01`. Шапка — `Type:` / `Status:` / `Blocked by:` / `Source:`.
Дополнение 2026-11-04: снимки и клипы как доказательство, слово владельца — «worfy должен уметь делать скриншоты и даже записывать
видео как доказательство, если задача того требует». Ticket-ы 10–12, вопросы Qv1–Qv4.

## Цель и что видит пользователь

Сейчас «Готово, когда» — список checkbox-ов. `[x]` ставит тот, кто сделал работу; чем пункт доказан и где проверен,
видно только из свободного текста раздела «Итог», если вообще видно. Два случая 2026-11-03/04:

- **Не та копия.** Пункт 2 Ticket-а worfy-windows 16 требует Stable copy (`%LOCALAPPDATA%\worfy-stable`,
  `docs/adr/0089-update-builds-main-in-own-clone.md:5`), а проверен в установленной копии: «Копия: установленная из
  `Programs\worfy` … а не Stable copy, как требует пункт» (`.scratch/worfy-windows/issues/16-приёмка-worfy-windows.md:184`).
  Это поймал человек при чтении.
- **Утечка в публичный PR.** Evidence в docs PR #1306 несла Windows user name в путях, имена Mac и ПК и UUID аккаунтов
  claude.ai (installPath plugin-ов `@synced`) — в JSON и на снимках (имена Machine в sidebar, заголовок Project на Canvas).
  Чистили force-push-ем; старый commit доступен по SHA.

С Epic-ом:

1. Под каждым пунктом «Готово, когда» — строки Evidence: вид доказательства, исход, ссылка, где проверено (платформа,
   копия приложения, SHA). Пишет их `ticket evidence …`, читают Harness и worfy.
2. У пункта вычисляется состояние: **проверено**, **не проверено** (с причиной: нет доказательства, только ревью,
   не та платформа или копия) или **красное**. Пункт с `needs: windows stable` и доказательством из `windows installed`
   — «не проверено: needs windows stable, got windows installed».
3. `ticket done` печатает, какие пункты не проверены (Q1).
4. На карточке Ticket-а на Canvas — chip «Evidence 3/5»; в focus mode над текстом Ticket-а — матрица: пункты,
   состояния, строки Evidence; ссылки открывают сам источник (commit, PR, CI run, снимок).
5. Privacy check (`evidence-check`) не пускает в публичный PR пути домашней папки с именем пользователя, имена хостов,
   UUID, email и токены в файлах Tickets root; у снимков читает metadata, а пиксели требует проверить глазами —
   с обязательной отметкой `scrub:` в строке Evidence.
6. Когда пункт о том, как что-то выглядит, агент снимает окно своей сборки helper-ом e2e; когда пункт о движении (анимация, drag,
   последовательность экранов, timing) — пишет клип (вид `video`) и рядом contact sheet. Матрица показывает снимок поверх окна и
   проигрывает клип прямо в focus mode. Остальные пункты картинок не требуют.

LLM доказательства не оценивает. CI artifacts не копируются: Evidence — ссылка на них.

## Что есть сейчас

- **Шапка Ticket-а** пишется только `harness/bin/ticket` (`harness/bin/ticket:2-8`; глоссарий —
  `harness/bin/TICKETS.md:19`, «Header»). Команды — `done`, `claim`, `open`, `block`, `show`, `migrate`, `root`, `mark`
  (`harness/bin/ticket:130`). Раздел «Готово, когда» `ticket` не разбирает.
- **Разбор «Готово, когда» в worfy уже есть**, но только для ручных пунктов: `manualChecks`
  (`src/shared/workflow/manual-checks.ts:22`) берёт пункты `(<manual_mark>)` раздела `tickets.done_section`; строки
  продолжения до пустой строки, следующего пункта списка или заголовка приклеиваются к тексту; вложенный пункт списка
  (`LIST_ITEM`, `manual-checks.ts:9`, с отступом тоже) закрывает текущий. Заголовки по умолчанию — `## Done when` и
  `manual`, старые русские тоже читаются (`src/shared/workflow/doc-headings.ts:17-31`). Результат — поле
  `manualChecks` модели Ticket-а (`src/shared/workflow/types.ts:67-74`, `:90`), заполняет `reader.ts`
  (`src/main/workflow/reader.ts:332-335`); его читает Command palette (`src/renderer/palette/commands.ts:536-556`).
- **Отметки агентов** `review` и `check/<name>` привязаны к SHA (ADR-0067): commit status на GitHub в Full mode,
  `<Harness home>/runs/<project>/marks/<epic>-<NN>.json` в Silent mode (`src/main/workflow/marks.ts:1-10`,
  `harness/bin/ticket:699-707`).
- **Verdict ревьюера** — первая строка `VERIFIED` или `REJECTED: …` (`harness/agents/reviewer.md:230-231`); отчёт
  implementer-а несёт `claims` с полем `evidence` (`harness/agents/implementer.md:156`). Это утверждения, а не доказательства.
- **Снимки-доказательства** — `.scratch/<epic>/evidence/NN-что.png`, ссылка из «Итог» (rules.md Profile-а worfy, решение
  владельца Р4 2026-10-06). В папках `evidence/` 2026-11-04: 857 png, 4 webp, 3 json, 7 txt и другие.
- **Слоты карточки Ticket-а**: badge — файл `src/renderer/canvas/badges/<Name>.tsx`, подхватывается сам
  (`src/renderer/canvas/badges/index.ts:1-11`, `:42`); место под chips — две строки (`src/renderer/canvas/ticket-card.ts:49-55`,
  `SLOTS_HEIGHT`). Текст Ticket-а в focus mode — `TicketBody` (`src/renderer/canvas/nodes/TicketNode.tsx:199`).
- **Двойные правила с contract test-ом согласия** — уже есть пример: `harness/lib/pipeline.cjs` и
  `src/shared/workflow/pipeline.ts`, test `test/contract/pipeline-rules-agree.test.ts:1`.
- **Где privacy check мог бы бежать.** `pnpm lint` — цепочка скриптов (`package.json:17`). CI на PR только с документами
  гоняет job `lint-typecheck` (`.github/workflows/ci.yml:8-13`, `:147`; `scripts/ci-scope.mjs:64`), checkout этого job-а
  без `fetch-depth` (`.github/workflows/ci.yml:133-135`). Gate fast на Mac запускает `lint` только когда изменённые файлы
  подходят под `root_if` записи `worfy` реестра gate: `.scratch/` и картинки туда не входят — на docs PR gate fast
  пишет «nothing ran». CI идёт после push: в публичном репозитории это уже поздно, нужен шаг до push (Q2).
  `land` открывает свой documents PR: `ticket done`, `docs_check`, commit, push (`harness/bin/land:32-36`, `:431-448`).
- **Масштаб старых путей.** `/Users/<name>/` и `C:\Users\<name>` уже стоят в 84 файлах `.scratch/` (grep 2026-11-04). Проверка
  всего дерева утонула бы в старом; Epic проверяет только то, что добавляет ветка.
- **Снимки и клипы (2026-11-04, после 01, 02, 04–06).** Helper-а снимка для доказательств нет: каждый e2e spec снимает сам в свой
  output (`bothThemes`, `test/e2e/ticket-evidence.spec.ts:83-89`). Клипов нет: `launchApp` зовёт `_electron.launch` без `recordVideo`
  (`test/e2e/helpers.ts:290-293`, `LaunchOptions` — `:145-153`); Playwright 1.63 его умеет, но клипу нужен Playwright ffmpeg, а CI не
  зовёт `playwright install`. Вида `video` нет (`harness/lib/evidence.cjs:25`, `src/shared/workflow/evidence.ts:18`); `evidence-check`
  отмечает любой добавленный двоичный файл, `.mp4` тоже, строкой `screenshot` (`harness/bin/evidence-check:77`, `:297`) и не читает
  metadata контейнеров видео. Матрица открывает снимок программой системы (`EvidenceMatrix.tsx:117-120`). `worfy-card://` отдаёт
  `.webm`/`.mp4` только из папки Card-а (`src/main/cards/protocol.ts:13-14`, `:97-98`); `worfy-image://` — только картинки из store-ов
  (`src/main/images/protocol.ts:38`); у CSP окна нет `media-src` (`src/renderer/index.html:5`). Когда пункту нужна картинка, не сказано
  нигде: `step-6-manual-gui-checks.md:11-13` говорит только, чем снимать.

## Модель

### Строка Evidence

Вложенный пункт списка под пунктом «Готово, когда». Ключи английские (машинные строки, как `Branch:` в шапке):

```markdown
- [x] Unit test `chat-command` таблицей: …
  - evidence: test-run pass · `pnpm test test/unit/autopilot-chat-command.test.ts` exit 0 · mac dev · 3f2a1b9c
  - evidence: review pass · PR #1190 · - - · 3f2a1b9c
- [ ] (вручную) Canvas с Epic-ами worfy на ПК …
  - needs: windows stable
  - evidence: screenshot pass · `../evidence/16-canvas.webp` · windows installed · bacbbcef · scrub: 2026-11-04
```

Грамматика (одна на Harness и worfy):

- `- evidence: <kind> <verdict> · <ref> · <platform> <copy> · <sha>[ · scrub: <YYYY-MM-DD>]`, поля через ` · `.
- `kind`: `commit`, `test-run`, `ci-check`, `gate`, `review`, `screenshot`, `video`, `owner-check`. `video` — Ticket 10.
- `verdict`: только `pass` или `fail`, у всех видов. Verdict ревьюера `VERIFIED` пишется как `pass`, `REJECTED` — как `fail`;
  слов `VERIFIED` и `REJECTED` в поле нет.
- `ref`: свободный текст без ` · `: команда с exit code, `PR #N`, URL, путь в backticks — относительно файла Ticket-а.
- `platform`: `mac`, `windows`, `linux`, `ci`; `-` — только у `commit` и `review`. Это платформа, а не имя хоста: имя хоста —
  то, что утекло в #1306.
- `copy`: `stable`, `installed`, `dev`, `ci`; `-` — нет приложения (у `commit` и `review` всегда `-`).
- `sha`: 7–40 hex, обязателен (ADR-0067: факт привязан к commit-у).
- `scrub: <дата>` — обязателен у `screenshot` с путём к файлу: человек проверил пиксели (Q5). У `video` — всегда: проверен каждый
  кадр его contact sheet (Qv1).
- `- needs: <platform> [<copy>]` — необязательная строка требования пункта; пишет автор Ticket-а.

Нумерация пунктов: каждый checkbox-пункт раздела на любой глубине вложенности получает номер по порядку в файле, с 1 — так же,
как `manualChecks` читает пункты с любым отступом (`manual-checks.ts:9`). Строка `- evidence:` и `- needs:` относится к ближайшему
checkbox-пункту над ней. Заголовок раздела — `tickets.done_section` Profile-а, а также старые `## Готово, когда` и `(вручную)`, как
`OLD_DOC_HEADINGS` в worfy (`doc-headings.ts:23-31`).

Строки внутри code fence не читаются. Неразобранная строка `- evidence:` — ошибка разбора пункта, видна в `ticket evidence`
и в матрице, пункт «не проверен».

### Состояние пункта

- **красное** — последняя по порядку строка Evidence пункта имеет `fail`.
- **проверено** — не красное; есть хотя бы одна строка `pass` вида-доказательства; если есть `needs`, хотя бы одна такая
  строка совпадает с ним по платформе (и копии, если названа). Виды-доказательства — все, кроме `review`. Для пункта
  `(вручную)` доказательство — только `owner-check`, `screenshot` или `video` (`video` — с Ticket-а 10).
- **не проверено** — всё остальное, с причиной: `no evidence`, `review only`, `needs <p> <c>, got <p> <c>`,
  `unreadable evidence line`.

Счёт «n из m» — по всем checkbox-пунктам раздела, `m` включает пункты без строк Evidence. Старые Ticket-ы без строк
Evidence — «0 из m»; ничего не ломается, chip просто серый.

Цвет chip-а «Evidence n/m»: зелёный (token ready) — все пункты проверены; оранжевый (token blocked) — есть хотя бы один
красный пункт; серый — остальное. Chip красного пункта остаётся оранжевым, не красным (решение владельца 2026-11-06,
«ок»).

### Кто пишет какие строки

- Implementer — `test-run`, `gate`, `commit` в своей ветке, вместе с кодом (они в diff PR и проходят ревью).
- Orchestrator — `review` (verdict ревью) и `ci-check` (зелёный `ci-ok`) при закрытии, в том же documents PR, где
  `Status: done` (Q6): через поле `prs[].evidence` state-файла `land`. Строка в ветке после CI дала бы новый head и ещё
  один полный CI run.
- Owner-check — Orchestrator со слов владельца (`ref` — дата и слово владельца), снимки и клипы — тот, кто снимал, с `scrub:`.
- **Silent mode.** Ticket-ы лежат в Workflow folder, у `land` при `tickets_root: null` documents PR нет (`harness/bin/land:48-51`).
  `review` и `ci-check` Orchestrator пишет сам: `ticket evidence …` в Workflow folder после verdict-а и CI. Ревьюер читает строки
  Evidence из файла Ticket-а в Workflow folder (путь — `ticket root`), а не из diff PR.

### Клип и contact sheet

- Клип — `.scratch/<epic>/evidence/<NN>-<что>.webm` (Qv2, Qv3), не дольше 60 с и не больше 8 MB, без звука. Рядом — contact sheet
  `<NN>-<что>.sheet.png`: одна PNG, сетка кадров, по кадру на каждую секунду, под кадром номер секунды. Sheet — то, что человек или
  агент проверяет глазами перед `scrub:`; клип смотрят, когда sheet вызвал вопрос.
- Кадры sheet снимает helper записи раз в секунду, пока идёт сценарий (`page.screenshot`), а не вынимает из клипа: так Harness не
  нужен декодер видео и новая зависимость (решение 15).
- Пишет оба файла только helper e2e worfy (11) из fixture-сборки; строку — `ticket evidence … video … --scrub <дата>` (10).

```markdown
- [ ] (вручную) Drag карточки Ticket-а в другую колонку Epic-а: карточка едет за курсором и встаёт на место без прыжка.
  - evidence: video pass · `../evidence/11-card-drag.webm` · mac dev · 3f2a1b9c · scrub: 2026-11-05
```

### Когда пункту нужен снимок или клип

Правило в `harness/skills/ship-ticket/step-6-manual-gui-checks.md` (11):

- пункт о том, **как что-то выглядит** (вёрстка, цвет, подпись, состояние control-а, тема) — снимок окна в обеих темах, `screenshot`;
- пункт о **движении** — анимация, drag, последовательность через несколько экранов, timing — клип с contact sheet, `video`;
- **всё остальное** — без картинки: доказывает test с exit code. Лишняя картинка — лишний файл на ручную проверку пикселей.

## Privacy check

`harness/bin/evidence-check` — Node, без новых зависимостей, работает на Windows. Правила и маскирование — в
`harness/lib/privacy.cjs` (Ticket 02): его же берёт worfy-failures 01 для записей о красных test-ах, своего модуля чистки там нет.

- **Что читает.** Файлы Tickets root, которые ветка добавила или изменила: `--changed` (база — `--base`; в GitHub Actions
  `HEAD^1`; иначе `git merge-base HEAD <worktree.base>`, поле Profile-а, у worfy `origin/main`), staged и неотслеживаемые файлы
  Tickets root; или явный список файлов. Список файлов git отдаёт с `-z` и `-c core.quotePath=false`, как `scripts/ci-scope.mjs:440-443`:
  в `.scratch/` сотни имён с кириллицей. У изменённого текстового файла — только добавленные строки; у нового — весь файл (Q7).
- **Пути файлов.** Те же правила текста идут по пути каждого добавленного файла: имя снимка с именем хоста — тоже утечка.
- **Текст** (`.md`, `.json`, `.jsonl`, `.txt`, `.log`, `.cpuprofile`, любой файл без NUL в первых 8 KiB):
  - путь домашней папки с именем: `/Users/<name>/`, `/home/<name>/`, `C:\Users\<name>\` (любое число `\`, и `/`),
    `/c/Users/<name>/`; имена-заглушки разрешены: `test`, `someone`, `user`, `you`, `runner`, `runneradmin`, `RUNNER~1`
    (короткий путь Windows runner-а CI), `Shared`, `<…>` (Q3);
  - имена хостов: `*.local`, `*.ts.net` (MagicDNS), `DESKTOP-` и семь букв или цифр, `*-MacBook*`, `*s-Mac*`, `*-PC`, адреса
    Tailscale (сеть 100.64/10), короткое имя `os.hostname()` машины, где идёт проверка, и слова из личного списка
    `<Harness home>/user/privacy.json` (`{"deny": ["…"]}`, вне репозитория);
  - UUID любой версии, кроме заглушек из одной цифры (`00000000-…`, `44444444-4444-4444-8444-444444444444`);
  - email, кроме `noreply@anthropic.com`, `*@users.noreply.github.com`, `git@github.com`, доменов `example.*`;
  - токены: `gh[pousr]_…`, `github_pat_…`, `sk-ant-…`, `sk-…`, `AKIA…`, `xox?-…`, JWT, начало PEM-блока закрытого ключа,
    `Bearer …`.
- **Снимки** (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`): читает текст metadata — PNG `tEXt`/`iTXt`/`zTXt` (через
  `node:zlib`) и `eXIf`, JPEG APP1 (Exif, XMP) и COM, WebP `EXIF`/`XMP `, GIF comment — и гоняет по нему те же правила.
  Пиксели не читает. Снимок, который ветка **добавляет**, должен иметь отметку: строку `- evidence: screenshot …`, тоже
  добавленную веткой, где путь `ref` (относительно файла Ticket-а) ведёт на этот файл, и поле `scrub: <дата>`. Совпадение по
  одному имени файла не считается: `14-toolbar-light.png` лежит в двух Epic-ах. Нет отметки — находка `image needs a human check`.
  Изменённые и старые снимки этой находки не дают — она не красит PR-ы, где снимок не новый.
- **Другие двоичные** (`.pdf`, `.zip`, …), добавленные веткой, — как снимок без metadata: только с отметкой.
- **Клипы** (`.webm`, `.mp4`; Ticket 10): metadata контейнера — webm `Title`, `MuxingApp`, `WritingApp`, теги `SimpleTag`, имена
  вложений; mp4 `udta`, `meta/ilst`, XMP — через те же правила. Дорожка звука — находка. Больше 8 MB, дольше 60 с или без длительности в
  заголовке — находка. Добавленный клип отмечает только добавленная строка `- evidence: video … · scrub:` с `ref` на него (строка
  `screenshot` — нет), и рядом должен быть добавленный той же веткой `<имя>.sheet.png`; sheet покрыт отметкой клипа, его metadata
  проверяется как у снимка.
- **Вывод.** `<file>:<line>: <rule>: <masked>`: значение замаскировано (две первые буквы, `…`, длина) — лог CI публичный,
  полное значение в нём было бы той же утечкой. Путь файла с находкой в самом пути печатается с той же маской на месте
  находки. Exit 0 — `evidence-check: ok (N files)`; 1 — находки; 2 — ошибка запуска (нет git, нет базы).
- **Silent mode.** Tickets root — в Workflow folder вне репозитория: публиковать нечего, `--changed` находит 0 файлов и
  выходит 0 со строкой «nothing to check».

**Чего privacy check не ловит** (это пишется в справке скрипта и на странице функции):

- текст на пикселях снимка: имена Machine в sidebar, заголовок Project, вывод terminal на картинке — только глаз и `scrub:`;
- кадры клипа между секундами contact sheet: то, что мелькнуло меньше чем на секунду, на sheet может не попасть (поэтому Qv1 — клипы
  только из fixture-сборки);
- имя хоста или пользователя в непредсказуемой форме (сокращение, другое написание), если его нет в личном списке;
- имя ПК на Mac (и наоборот), пока его нет в личном списке: `os.hostname()` знает только свою машину; на CI — ни одной;
- секрет, разорванный переносом строки, base64 и другие кодировки;
- файлы вне Tickets root (Q7), историю git (что уже запушено — останется по SHA), текст PR и комментариев на GitHub.

## Где privacy check бежит (Q2)

1. `ticket evidence` проверяет файл из `ref` до записи строки и отказывает при находках; `screenshot` без `--scrub` — отказ.
   В Silent mode, когда Tickets root вне репозитория, проверка файла пропускается: публиковать нечего.
2. `land` — перед push своего documents PR.
3. Skills `ship-ticket` и `epic-wave`: перед push docs PR, который пишет Session руками, — `evidence-check --changed`, exit 0.
4. `pnpm lint` — `node harness/bin/evidence-check --changed`: gate fast (когда шаг `lint` идёт) и CI job `lint-typecheck` на
   каждом PR, документы тоже. CI — последний рубеж: красный `ci-ok` не даёт merge, но push уже был. Этот шаг включается
   последним (Ticket 03 ждёт 07): пока агенты не умеют писать отметки `scrub:`, он красил бы PR-ы других Epic-ов.

Hook `PreToolUse` на `git push` в этот Epic не входит: `harness/hooks/guard.mjs` и список шагов gate fast только что
изменил worfy-multi-vendor 36, их закрепляет Codex parity suite (PR #1313). Если по итогам Epic-а отказ на push понадобится,
— отдельный Ticket после согласования с Orchestrator-ом worfy-multi-vendor.

## Решено без владельца

1. **Строки Evidence — в файле Ticket-а, вложенными пунктами под пунктом, не в отдельном файле.** Источник правды — файл
   Ticket-а (ADR-0002); строки видны в diff и ревью; в Silent mode они живут там же, где Ticket, в Workflow folder. Вложенный
   пункт списка не попадает в текст ручного пункта `manualChecks` (`manual-checks.ts:9`, `:47-55`).
2. **Машина — платформа, а не имя хоста.** Иначе сама строка Evidence — утечка.
3. **Грамматика в двух копиях** — `harness/lib/evidence.cjs` (Harness, CommonJS как `pipeline.cjs`) и
   `src/shared/workflow/evidence.ts` (worfy) — с contract test-ом согласия на общих fixture-строках, как у Pipeline.
4. **Проверяются только добавленные строки и новые файлы.** Старые 84 файла с путями не трогаются; история не чинится.
5. **Privacy check ищет отметку `scrub:` своим разбором строки `- evidence: screenshot`**, не через `evidence.cjs`: так Ticket-ы
   01 и 02 Wave 1 не делят файлов. Повтор — одно выражение, его держит test 02.
6. **Ссылки не сверяются с источником.** worfy открывает commit, PR, CI run и снимок, но не проверяет, что CI run зелёный:
   MVP — честная запись и видимое состояние. Сверка — «Не в этом Epic-е».
7. **Ручной пункт доказывают только `owner-check` и `screenshot`.** test-run агента не доказывает того, что должен увидеть человек.

Пункты 8–14 — ответы на «Вопросы владельцу»: решено Orchestrator-ом 2026-11-04 по поручению владельца («можешь сразу брать в
работу первый и делать его автономно»); владелец подтвердил 2026-11-04 («Со всем согласен»).

8. **Q1 — вариант (а).** `ticket done` при непроверенных пунктах только предупреждает, exit 0.
9. **Q2 — вариант (а).** Проверка до push — `ticket evidence`, `land`, правило skills; `pnpm lint` и CI — последний рубеж. Hook на
   push не делается.
10. **Q3 — вариант (а).** Любое имя в пути домашней папки, кроме заглушек, — находка, имя владельца тоже.
11. **Q4 — вариант (а).** Списка разрешений в репозитории нет; ложное срабатывание исправляется формой-заглушкой.
12. **Q5 — вариант (а).** Metadata снимков проверяется; снимок, добавленный веткой без отметки `scrub:`, — находка, exit 1.
13. **Q6 — вариант (а).** `review` и `ci-check` пишутся при закрытии: в Full mode — `land` из `prs[].evidence`, в Silent mode —
    Orchestrator сам в Workflow folder.
14. **Q7 — вариант (а).** Проверяется только Tickets root.

Пункты 15–18 — дополнение 2026-11-04 (снимки и клипы), решено Orchestrator-ом; владелец подтвердил 2026-11-04 вместе с Qv1–Qv4 («Да, всё»).

15. **Кадры contact sheet снимает helper во время записи**, а не вынимает из клипа: декодер видео — новая зависимость, а
    `evidence-check` и `ticket` живут без новых зависимостей (02, 10). Цена — кадры между секундами (раздел «Чего privacy check не ловит»).
16. **Chip «Evidence n/m» ничего не открывает.** Это счёт пунктов, файла за ним нет; снимок и клип открываются из матрицы в focus mode.
17. **Просмотр — через `worfy-image://`, store `evidence.<project label>`, а не через `worfy-card://`.** Cards protocol отдаёт только
    файлы папки Card-а; у image protocol уже есть store-ы с проверкой пути, symlink и предела размера. Видео — только у этого store-а.
18. **Звук в клипе — находка.** Playwright пишет клип без звука; звук мог прийти только с микрофона машины.

## Вопросы владельцу

Ответы приняты владельцем 2026-11-04: везде рекомендация, вариант (а). Ticket-ы написаны по ней (помечено «Ответ Q…» там, где
Ticket от неё зависит).

- **Q1. `ticket done` при непроверенных пунктах.** (а) предупреждение в stderr, exit 0; (б) отказ exit 1, обход `--unverified`;
  (в) отказ только у Ticket-ов, где уже есть строки Evidence. **Рекомендую (а):** `done` ставится после merge (`land`,
  documents PR), отказ там оставил бы влитый Ticket незакрытым и остановил Autopilot. Отказ — следующим шагом, когда
  матрица поживёт.
- **Q2. Где проверка до push.** (а) `ticket evidence` + `pnpm lint` + `land` + правило в skills (раздел «Где privacy check
  бежит»); (б) (а) и hook `PreToolUse` на `git push` / `gh pr create`; (в) (а) и git `pre-push` hook в clone (`core.hooksPath`
  — постоянная настройка репозитория). **Рекомендую (а)**: не трогает `guard.mjs` и список шагов gate fast; (б) — позже,
  с Orchestrator-ом worfy-multi-vendor.
- **Q3. Своё имя пользователя Mac** (`/Users/<имя владельца>/` уже в 84 файлах). (а) ловить любое имя, кроме заглушек; запись — `~`,
  `%USERPROFILE%`, `<home>`; (б) разрешить имена владельца. **Рекомендую (а):** Windows user name из #1306 — то же имя;
  правило без исключений проще и одинаково на CI, где личного списка нет.
- **Q4. Ложные срабатывания.** (а) списка разрешений в репозитории нет: значение заменяют формой-заглушкой (`<uuid>`, `~`,
  `<host>`); (б) файл разрешений в папке `evidence/` Epic-а с причинами. **Рекомендую (а):** файл разрешений сам публикует
  значение и копится.
- **Q5. Снимки.** (а) metadata проверяется, снимок без `scrub:` — находка, exit 1; (б) снимки только перечисляются, exit 0;
  (в) снимки настоящих Machine в репозиторий не кладутся, только Demo project. **Рекомендую (а)** — минимум, который просил
  Orchestrator соседнего Epic-а, и он ловит забытый снимок, а не только утечку в metadata.
- **Q6. Когда пишутся строки `review` и `ci-check`.** (а) при закрытии, в documents PR `land`, из `prs[].evidence`; (б) в ветке
  до merge. **Рекомендую (а):** (б) меняет head после CI и ревью — ещё один полный CI run на каждый Ticket.
- **Q7. Какие файлы проверять.** (а) только Tickets root (Ticket-ы, `spec.md`, `evidence/`); (б) весь diff, кроме `test/fixtures/`.
  **Рекомендую (а)** для MVP: там evidence и утекло; `docs/` и `HANDOFF.md` — следующим шагом по данным первых недель.

Вопросы дополнения 2026-11-04 (снимки и клипы). Приняты владельцем 2026-11-04 («Да, всё»): вариант (а).

- **Qv1. Кто ставит `scrub:` у клипа.** (а) агент, после проверки каждого кадра contact sheet, и только у клипа из fixture-сборки e2e
  (временный проект, fake agent, без данных машины); владелец выборочно смотрит клипы в приёмке 09; (б) только владелец — агент
  клип пишет, строку `video` без `scrub:` не пишет, privacy check держит PR до слова владельца; (в) агент для любого клипа.
  **Рекомендую (а):** в fixture-сборке нет имён Machine, путей и аккаунтов — утекать нечему, а (б) останавливает каждую Wave с клипом
  до утра. Helper отказывается записывать установленную копию и Stable copy (Ticket 11).
- **Qv2. Где лежат клипы.** (а) в репозитории, `.scratch/<epic>/evidence/`, с пределом 8 MB и 60 с на клип; (б) вне git: CI artifacts
  или Workflow folder, в Ticket-е — ссылка; (в) в репозитории через Git LFS. **Рекомендую (а):** ссылка в Ticket-е открывается всегда,
  CI artifacts живут 90 дней, LFS — новая настройка репозитория и квота. Предел держит рост истории; если за месяц клипов больше
  100 MB — пересмотр.
- **Qv3. Формат клипа.** (а) webm (VP8), как его пишет Playwright `recordVideo`; (б) mp4 (H.264) — перекодировать ffmpeg-ом; (в) GIF.
  **Рекомендую (а):** без перекодирования и новых зависимостей; Chromium в Electron и GitHub в браузере его проигрывают. mp4
  privacy check всё равно читает — на случай клипа не из Playwright.
- **Qv4. Playwright ffmpeg на CI.** Клипу нужен ffmpeg Playwright (`playwright install ffmpeg`, небольшая загрузка с CDN Playwright);
  CI его не ставит. (а) шаг установки в e2e job-ах macOS и Windows, test helper-а записи идёт на CI; (б) test клипа без ffmpeg
  пропускается с причиной, на CI идёт только снимок. **Рекомендую (а):** test, который на CI всегда пропущен, перестаёт что-то
  проверять. Цена — 11 правит `.github/workflows/ci.yml`, как 03, и идёт Wave-ой позже.

## Ticket-ы

- **01 — Строка Evidence и `ticket evidence`.** Грамматика в `harness/lib/evidence.cjs`; `ticket evidence <epic> <NN>` —
  матрица; `ticket evidence <epic> <NN> <item> <kind> <pass|fail> --ref …` — запись строки; `ticket done` предупреждает
  (Ответ Q1); `TICKETS.md`. Blocked by: —. Не UI. [Ticket](issues/01-строка-evidence-и-ticket-evidence.md).
- **02 — Privacy check `evidence-check`.** Правила и маска в `harness/lib/privacy.cjs` (их берёт worfy-failures 01), текст, пути
  файлов, metadata снимков, отметка `scrub:`, маскированный вывод, личный список. Blocked by: —.
  Не UI. [Ticket](issues/02-privacy-check-evidence-check.md).
- **03 — Privacy check в `pnpm lint`, CI и `ticket evidence`.** Включается последним: ждёт 07, чтобы не красить PR-ы других
  Epic-ов. Blocked by: 01, 02, 07. Не UI. [Ticket](issues/03-privacy-check-в-lint-ci-и-ticket.md).
- **04 — `land`: строки Evidence при закрытии и проверка до push.** Blocked by: 01, 02. Не UI. [Ticket](issues/04-land-evidence-и-проверка-до-push.md).
- **05 — worfy читает Evidence.** `src/shared/workflow/evidence.ts`, поле `evidence` модели Ticket-а, contract test согласия.
  Blocked by: 01. Не UI. [Ticket](issues/05-worfy-читает-evidence.md).
- **06 — Chip и матрица Evidence.** Blocked by: 05. UI. [Ticket](issues/06-chip-и-матрица-evidence.md).
- **07 — Агенты и skills пишут Evidence.** Blocked by: 01, 02, 04. Не UI. [Ticket](issues/07-агенты-и-skills-пишут-evidence.md).
- **08 — Документация.** Blocked by: 03, 04, 06, 07, 10, 11, 12. Не UI. [Ticket](issues/08-документация.md).
- **09 — Приёмка с владельцем на Mac и Windows.** Blocked by: 01–08, 10–12. UI (снимки и клип). [Ticket](issues/09-приёмка-с-владельцем.md).
- **10 — Вид `video` и privacy check клипов.** `video` в обеих копиях грамматики, `ticket evidence … video … --scrub`, metadata webm/mp4,
  звук, пределы 8 MB и 60 с, contact sheet рядом. Blocked by: —. Не UI, платформенный.
  [Ticket](issues/10-вид-video-и-privacy-check-клипов.md).
- **11 — Снимок и клип из e2e и правило «когда картинка».** `captureScreenshot`, `recordClip` с contact sheet, `recordVideo` у
  `launchApp`, правило в `step-6-manual-gui-checks.md`. Blocked by: 07, 10. Не UI, платформенный.
  [Ticket](issues/11-снимки-и-клипы-из-e2e-и-правило-когда.md).
- **12 — Просмотр снимка и клипа в матрице.** Store `evidence` в `worfy-image://`, `Range` и `media-src`, overlay снимка и `<video>`
  в focus mode. Blocked by: 10. UI. [Ticket](issues/12-просмотр-снимка-и-клипа-в-матрице.md).

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов нет. Таблица — план. Wave, которую
берут в работу, вычисляется заново в момент запуска (CONTEXT.md, термин Wave).

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `harness/lib/evidence.cjs`, `harness/bin/ticket`, `harness/bin/TICKETS.md`, `harness/bin/tests/ticket-evidence.test.sh`, `harness/bin/tests/fixtures/evidence/` | 1 |
| 02 | `harness/lib/privacy.cjs`, `harness/bin/evidence-check`, `harness/bin/tests/evidence-check.test.sh`, `harness/bin/tests/fixtures/evidence-check/` | 1 |
| 03 | `package.json`, `.github/workflows/ci.yml`, `test/contract/ci-workflow.test.ts`, `harness/bin/ticket`, `harness/bin/tests/ticket-evidence.test.sh` | 4 |
| 04 | `harness/bin/land`, `harness/bin/tests/land.test.sh` | 2 |
| 05 | `src/shared/workflow/evidence.ts`, `src/shared/workflow/types.ts`, `src/main/workflow/reader.ts`, `test/unit/evidence.test.ts`, `test/contract/evidence-rules-agree.test.ts`, `test/contract/workflow-reader.test.ts` | 2 |
| 06 | `src/renderer/canvas/badges/Evidence.tsx`, `src/renderer/canvas/badges/evidence.css`, `src/renderer/canvas/nodes/EvidenceMatrix.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/canvas/ticket-card.ts`, `src/renderer/canvas/epic-frame.css`, `docs/design/F-SPEC.md`, `test/unit/evidence-matrix.test.tsx`, `test/e2e/ticket-evidence.spec.ts`, `scripts/e2e-specs.table.json` | 3 |
| 07 | `harness/agents/implementer.md`, `harness/agents/reviewer.md`, `harness/skills/ship-ticket/implementer-report.md`, `harness/skills/ship-ticket/implementer-finish.md`, `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/skills/ship-ticket/step-9-merge.md`, `harness/skills/ship-ticket/step-11-close.md`, `harness/skills/epic-wave/SKILL.md`, `harness/bin/tests/agents-text.test.sh` | 3 |
| 08 | `docs/features/evidence.md`, `docs/features/ru/evidence.md`, `docs/features/README.md`, `docs/features/workflow.md`, `docs/features/ru/workflow.md` | 6 |
| 09 | `.scratch/worfy-evidence/spec.md`, `.scratch/worfy-evidence/evidence/09/` | 7 |
| 10 | `harness/lib/evidence.cjs`, `src/shared/workflow/evidence.ts`, `harness/bin/ticket`, `harness/bin/evidence-check`, `harness/bin/TICKETS.md`, `harness/bin/tests/ticket-evidence.test.sh`, `harness/bin/tests/evidence-check.test.sh`, `harness/bin/tests/fixtures/evidence/`, `test/unit/evidence.test.ts`, `test/contract/evidence-rules-agree.test.ts` | 3 |
| 11 | `test/e2e/evidence-capture.ts`, `test/e2e/evidence-capture.spec.ts`, `test/e2e/helpers.ts`, `scripts/e2e-specs.table.json`, `.github/workflows/ci.yml` (Ответ Qv4 (а)), `harness/skills/ship-ticket/step-6-manual-gui-checks.md`, `harness/agents/implementer.md`, `harness/bin/tests/agents-text.test.sh` | 5 |
| 12 | `src/shared/images.ts`, `src/main/images/stores.ts`, `src/main/images/protocol.ts`, `src/renderer/index.html`, `src/renderer/canvas/nodes/EvidenceMatrix.tsx`, `src/renderer/canvas/nodes/EvidencePreview.tsx`, `src/renderer/session/MessageAttachments.tsx`, `docs/design/F-SPEC.md`, `test/unit/image-protocol.test.ts`, `test/unit/evidence-matrix.test.tsx`, `test/e2e/ticket-evidence.spec.ts`, `test/fixtures/evidence-clip/` | 4 |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры. Если у двух Ticket-ов одной Wave общий файл,
Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01, 02.** Блокеров нет. 01 — грамматика и команда в `ticket`, 02 — отдельный скрипт; общих файлов нет (решение 5).
  Обе сразу дают пользу: строку можно писать, утечку — ловить вручную.
- **Wave 2 — 04, 05.** 04 ждёт 01 и 02, 05 — 01. Общих файлов нет: 04 — `land`, 05 — `src/`.
- **Wave 3 — 06, 07, 10.** 06 ждёт 05; 07 — 01, 02 и 04; 10 блокеров не имеет и добавлен 2026-11-04, пока 07 в работе (PR #1329).
  Общих файлов нет: 10 — грамматика, `ticket`, `evidence-check`; 07 — тексты агентов и skills.
- **Wave 4 — 03, 12.** 03 ждёт 07: шаг `pnpm lint` в CI красит каждый PR со снимком без `scrub:`, поэтому включается, когда агенты и
  skills уже пишут отметки. 12 ждёт 10. Общих файлов нет: 03 — `package.json`, `ci.yml`, `ticket`; 12 — `src/` и
  `ticket-evidence.spec.ts`. `harness/bin/ticket` 10 и 03 правят в разных Wave.
- **Wave 5 — 11.** Ждёт 07 и 10; при Ответе Qv4 (а) правит `.github/workflows/ci.yml`, как 03, поэтому идёт после него. При Ответе
  Qv4 (б) `ci.yml` не трогает и встаёт в Wave 4.
- **Wave 6 — 08.** **Wave 7 — 09** (владелец).

Ни один Ticket не правит `harness/hooks/*`, список шагов gate fast, `src/main/autopilot/run.ts` и
`src/shared/autopilot/journal.ts` (их правят worfy-multi-vendor 36 и 37–39).

## Не в этом Epic-е

- Hook на `git push` / `gh pr create` (Q2, вариант б) — после согласования с worfy-multi-vendor.
- OCR снимков (macOS Vision, `Windows.Media.Ocr`): тяжёлый путь и по зависимости на платформу; MVP просит глаз и `scrub:`.
- Сверка ссылок с источником: что CI run зелёный, что SHA — предок merge-commit-а, что gate verdict есть в state gate.
- Автоматическое сопоставление CI checks и пунктов: какой пункт доказывает `ci-ok`, решает тот, кто пишет строку.
- Автоопределение копии приложения (`runsFromStableCopy`, `src/main/update/stable-copy.ts:53-55`) и передача её в Session.
- Отказ `ticket done` (Q1, вариант б) и проверка `docs/`, `HANDOFF.md` (Q7, вариант б).
- Чистка уже запушенной истории и старых 84 файлов.
- LLM-оценка доказательств — не делаем вовсе.
- Клипы не из e2e: запись экрана ОС, клип установленной копии или Stable copy, клип второго окна; перекодирование в mp4 и GIF.
- Просмотр снимков и клипов Linked machine и проигрывание вне focus mode.

## Риски

1. **Строки Evidence раздувают Ticket.** Пункт с тремя строками — четыре строки вместо одной. Строки короткие, `ref` без
   пересказа вывода; «Итог» остаётся для рассказа.
2. **Ложные срабатывания на CI.** UUID и `*.local` встречаются в законных выдержках. Рекомендация Q4 — заглушка; если
   за неделю ложных больше настоящих — пересмотр Q4.
3. **Агенты забудут строки.** Без 07 матрица останется «0 из m». Поэтому 07 — в той же Epic, а `ticket done` предупреждает.
4. **Platform PR-ы** — 01, 02, 03, 04 (и `harness/lib/privacy.cjs`, который берёт worfy-failures 01): скрипты Harness с путями и git; Windows verdict до merge. `harness/` в diff гоняет e2e по
   таблице `scripts/e2e-specs.table.json` (ADR-0081).
5. **Codex parity suite** (PR #1313, в base `af731d59a` ещё нет `test/contract/codex-parity.test.ts`). Если он закрепляет текст
   `harness/agents/*.md`, Ticket 07 сначала согласуется с Orchestrator-ом worfy-multi-vendor.
6. **Клип без длительности в заголовке.** Предел 60 с privacy check (10) берёт из заголовка webm; если Playwright пишет webm без
   `Duration`, любой его клип — находка `video duration unknown`. 10 проверяет на собранных байтах, 11 — на настоящем клипе
   Playwright; не сошлось — 11 дописывает длительность в заголовок или 10 считает её по числу кадров sheet.
7. **Рост репозитория.** Каждый клип до 8 MB остаётся в истории навсегда (Qv2). Правило «когда картинка» (11) режет клипы «на всякий
   случай».
8. **Platform PR-ы дополнения** — 10 и 11: Windows verdict до merge.

## Соглашения для Ticket-ов этого Epic-а

- Ветка `worfy-evidence/<NN>`, worktree `.claude/worktrees/<NN>`. Глубина ревью — по общему правилу; 02 (privacy check) —
  `high`: его ошибка — утечка в публичный репозиторий. Дополнение: 10 и 12 — `high` (privacy check клипов; protocol, который
  отдаёт окну файлы Project-а), 11 — `medium`.
- Сначала падающий test. Shell test-ы Harness — `harness/bin/tests/*.test.sh` (временный HOME и `HARNESS_HOME`, `real-home.sh`);
  они идут и в Windows job-ах (`test/harness-shell-tests.ts:1-7`).
- Скрипты Harness — Node (ADR-0055), работают на Windows (пути через `node:path`, git через `eval-env.cjs`). Текст Harness и
  plugin-а — только английский (ADR-0074); заголовок раздела — из `tickets.done_section` Profile-а, не зашит по-русски.
- worfy только читает Ticket-ы (ADR-0002) и ничего не пишет в репозиторий Project-а (ADR-0005); строку пишет только `ticket`.
- Fixture-ы без настоящих имён, хостов, UUID и токенов: значения для test-ов privacy check собираются в test-е из кусков
  (`"/Us" + "ers/"…`), чтобы сам репозиторий проходил свою проверку.
- Репозиторий публичный: без секретов в workflows, без `pull_request_target`, только бесплатные runners.
- Test-ы не запускают настоящие Claude и Codex с аккаунтом владельца; `gh` — stand-in (`TICKET_GH`, `LAND_*`).
- Снимки UI — обе темы, в `.scratch/worfy-evidence/evidence/<NN>/`, с `scrub:` в строке Evidence.
- Агенты не оставляют фоновых процессов.

## Новые термины (предложение для CONTEXT.md)

- **Evidence** — строка `- evidence: …` под пунктом «Готово, когда»: вид, исход, ссылка, платформа, копия, SHA.
- **Evidence state** — состояние пункта: verified (проверено), not verified (не проверено, с причиной), failed (красное).
- **Evidence matrix** — таблица пунктов Ticket-а с состояниями и строками Evidence в focus mode.
- **Privacy check** — `evidence-check`: поиск личных данных в том, что ветка добавляет в Tickets root.
- **Scrub note** — поле `scrub: <дата>` строки Evidence: человек проверил пиксели снимка (у клипа — каждый кадр contact sheet).
- **Contact sheet** — PNG рядом с клипом: сетка кадров, по кадру на секунду; по нему проверяют клип глазами.

## Готово, когда

- [x] `ticket evidence` пишет и показывает строки Evidence; `ticket done` предупреждает о непроверенных пунктах (01).
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] `evidence-check` ловит пути с именем, хосты, UUID, email, токены в тексте и metadata снимков; снимок без `scrub:` — находка;
      вывод замаскирован (02). [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Privacy check идёт в `pnpm lint` и CI на каждом PR, в `ticket evidence` и в `land` до push (03, 04).
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Карточка Ticket-а показывает «Evidence n/m», focus mode — матрицу; ссылки открывают источник (05, 06).
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Implementer, ревьюер и Orchestrator пишут строки по правилам skills (07); страница функции на двух языках (08).
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Вид `video`: клип с contact sheet проходит privacy check только со `scrub:`, в пределах 8 MB и 60 с, без звука (10); helper-ы e2e
      пишут снимок и клип на Mac и Windows, `step-6-manual-gui-checks.md` говорит, когда какой (11); матрица показывает снимок и
      проигрывает клип (12). [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Случай worfy-windows 16 воспроизведён: `needs: windows stable` + Evidence из `installed` — «не проверено» (09, вручную).
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
- [x] Приёмка владельца на Mac (2026-11-06) и Windows-ПК (2026-11-07) (09): принята 2026-11-07,
      [«Итог» 09](issues/09-приёмка-с-владельцем.md#итог).
