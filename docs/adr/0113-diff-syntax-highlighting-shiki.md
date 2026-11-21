# 0113 — Подсветка синтаксиса в diff-е — Shiki с движком на JavaScript
Дата: 2026-11-21. Статус: принят.

**Контекст.** Владелец 2026-11-21 (spec Epic-а `worfy-changes-view`, «Ответы владельца 2026-11-21», D4): код в diff-е
подсвечен, как на GitHub, — и в Changes Ticket-а, и в diff-е PR (Review mode): после Ticket-а 08 это один экран,
`src/renderer/changes/DiffPane.tsx`. Решение Q5 (а) «без подсветки» отменено. Библиотеки подсветки в `package.json` не
было. CSP renderer-а — `script-src 'self'` без `'wasm-unsafe-eval'` (`src/renderer/index.html`): WebAssembly там не
компилируется, и ослаблять CSP ради подсветки не нужно. Решение принято вместе с Ticket-ом 10 Epic-а.

**Решение.**

1. **Зависимости — четыре пакета Shiki 4.6.0** в `dependencies` с точной версией: `@shikijs/core`,
   `@shikijs/engine-javascript`, `@shikijs/langs`, `@shikijs/themes`, а не пакет `shiki`: тот тянет ещё
   `@shikijs/engine-oniguruma` (WebAssembly), которым worfy не пользуется. Версия вышла 2026-11-02 (старше суток —
   правило `minimumReleaseAge` pnpm). `pnpm add --save-exact @shikijs/core@4.6.0 @shikijs/engine-javascript@4.6.0
   @shikijs/langs@4.6.0 @shikijs/themes@4.6.0` добавил в lockfile 14 пакетов: `@shikijs/core` 4.6.0,
   `@shikijs/engine-javascript` 4.6.0, `@shikijs/langs` 4.6.0, `@shikijs/themes` 4.6.0, `@shikijs/primitive` 4.6.0,
   `@shikijs/types` 4.6.0, `@shikijs/vscode-textmate` 10.1.0, `hast-util-to-html` 9.0.7, `html-void-elements` 3.0.0,
   `oniguruma-parser` 0.12.2, `oniguruma-to-es` 4.3.6, `regex` 6.1.0, `regex-recursion` 6.0.2, `regex-utilities` 2.3.0.
   - Лицензия у всех 14 — MIT.
   - Ни у одного нет `preinstall`, `install`, `postinstall` и `binding.gyp`. У `regex-utilities` 2.3.0 есть `prepare`
     (`npm test`): pnpm запускает `prepare` только у зависимости из git или из папки, не у пакета из registry, и
     `pnpm install` его не запускал. Проверено чтением `package.json` каждого в `node_modules/.pnpm`.
   - `allowBuilds` в `pnpm-workspace.yaml` не меняется, `pnpm install` прошёл без `ERR_PNPM_IGNORED_BUILDS`.
2. **Движок — регулярные выражения JavaScript** (`createJavaScriptRegexEngine({ forgiving: true })`): грамматики
   TextMate переводятся в `RegExp`, без WebAssembly, `eval` и `new Function`; CSP renderer-а не меняется. В собранном
   renderer-е нет ни `WebAssembly`, ни `new Function(` (поиск по `out/renderer/assets/*.js`). `forgiving`: шаблон
   грамматики, который движок перевести не может, ничего не находит, а грамматика работает дальше.
3. **Темы — `github-light-default` и `github-dark-default`**, нынешние цвета github.com (ключевое слово `#CF222E` и
   `#FF7B72`), а не старые `github-light` и `github-dark` из рекомендации Ticket-а. Обе сразу: каждый token несёт оба
   цвета как CSS variables (`--hl-light`, `--hl-dark`), `src/renderer/changes/highlight.css` выбирает один по
   `prefers-color-scheme`, как `tokens.css`. Фон добавленных и удалённых строк — прежние tokens `--ready-bg` и
   `--blocked-bg`.
4. **Загрузка — только по требованию.** `src/renderer/changes/highlight.ts` импортирует Shiki только через `import()`:
   ядро, движок, обе темы и каждая из 37 грамматик — отдельные chunk-и сборки. Окно стартует без них (test
   `the window starts without Shiki` в `test/unit/changes-highlight.test.ts`; e2e test бюджета старта
   `test/e2e/epic-frame.spec.ts` зелёный). Язык — по расширению или имени файла; незнакомый язык — простой текст.
5. **Разбор — по стороне hunk-а целиком**: старая сторона (контекст и удалённые строки) и новая (контекст и
   добавленные) — каждая одним текстом, так что многострочный комментарий внутри hunk-а окрашен на всех строках, а
   комментарий, открытый на удалённой строке, не красит добавленные. Hunk, который начинается внутри такого
   комментария, красится неверно: файл целиком ради каждого hunk-а не читается.
6. **Пределы** (числа — `src/renderer/changes/highlight.ts`, замеры — ниже, «Цена разбора»).
   - Строка длиннее 400 символов — простой текст, в Shiki она не передаётся (в разбор идёт пустой строкой).
   - Сторона hunk-а длиннее 100 000 символов и hunk длиннее 2 000 строк — простой текст целиком.
   - Свёрнутый файл (большой, lock-, сгенерированный) красится только после Show, binary-файл — никогда.
   - Красится только hunk, который нарисован (окно `diff-window.ts`), по одному hunk-у за раз. Сторона hunk-а
     читается шагами — целые строки, около 2 000 символов; каждый шаг — своя задача event loop-а, состояние грамматики
     (`grammarState` Shiki) переходит от шага к шагу. Запрос hunk-а, ушедшего из окна, останавливается на следующем
     шаге и ничего не оставляет в кэше.
   - Кэш tokens — по языку и тексту hunk-а, всего не больше 1 000 000 символов hunk-ов; старые уходят первыми.
7. **Текст не меняется.** Текст tokens строки всегда равен `line.text`; если нет — строка рисуется простым текстом.
   Выделение, Copy line, строки комментария и сообщение агенту берут текст из diff-а, не из DOM-цветов.
8. **Обновления — вручную**, как у остальных зависимостей: точная версия, все четыре пакета одной версией, не моложе
   суток; отдельный PR, в нём `test/unit/changes-highlight.test.ts` и `test/e2e/changes.spec.ts`.

**Размер** (`pnpm build`, сборка renderer-а без минификации, как в ADR-0106; байты, gzip — `gzip -c | wc -c`):

| | До | После |
|---|---|---|
| Входной chunk renderer-а (`index-*.js`, грузится при старте) | 5 389 637 / 1 181 858 gzip | 5 403 004 / 1 185 488 gzip (+3 630 gzip, +0,31 %) |
| Весь JS renderer-а, вместе с chunk-ами по требованию | 7 278 433 / 1 721 104 gzip | 10 242 483 / 2 115 279 gzip |
| Первый diff TypeScript: ядро 42 904 + движок 30 465 + темы 3 112 + 3 193 + грамматика `typescript` 16 161 | — | 95 835 gzip, один раз на окно |

Самые большие грамматики — `cpp` (55 712 gzip), `php` (28 736), `jsx`, `javascript`, `tsx`, `typescript` (по
16–17 тысяч); каждая грузится, только когда в diff-е есть файл этого языка.

**Отзывчивость.** e2e `test/e2e/changes.spec.ts` листает diff Ticket-а на 301 файл экран за экраном до конца (35
экранов): самый долгий экран — 18 ms, весь путь — 0,58 s; последний файл (`pkg/m29/file-299.ts`) окрашен через 10 ms
после того, как его patch прочитан (чтение patch-ей git-ом — 5,2 s, как и до подсветки).

**Цена разбора** (Shiki 4.6.0, обе темы, движок на JavaScript, под Node из Electron —
`ELECTRON_RUN_AS_NODE=1`, тот же V8, что в renderer-е; Mac под нагрузкой других агентов, load average 28):

- Текст TypeScript и TSX из `DiffPane.tsx`: 1 000 символов — 2 ms, 2 000 — 3,5 ms, 3 000 — 7–15 ms, 5 000 — 18–25 ms;
  при load average 49 те же 5 000 символов — 80–100 ms. Шаг в 2 000 символов держит одну задачу под 50 ms с запасом.
- Длина одной строки растёт быстрее линейной на строковых литералах: 400 символов — 10 ms, 500 — 15 ms, 800 — 38 ms,
  1 000 — 66 ms (при load average 49: 800 — 240 ms). Строка кода такой же длины — 2–3 ms. Отсюда предел 400.
- Без шагов и без предела стороны (раунд 2 ревью, замер ревьюера под Node): hunk `.ts` в 1 800 строк — около 650 ms
  одним куском, 1 999 строк по 990 символов — около 16 s; оба меньше предела свёртки файла (2 000 строк, 1 MB), то есть
  окно замирало при прокрутке к такому файлу без Show.

## Considered Options

Сравнение — npm registry 2026-11-21, проверено `npm view <пакет> version license dist.unpackedSize`.

| Пакет | Лицензия | Размер (unpacked) | Языки и точность | Темы light и dark | CSP |
|---|---|---|---|---|---|
| **Shiki** 4.6.0 — выбран | MIT | `@shikijs/core` 64 KB, `@shikijs/engine-javascript` 12 KB; грамматики по одной (`@shikijs/langs` целиком — 8,7 MB, 260 грамматик) | грамматики TextMate, как в VS Code | `github-light-default`, `github-dark-default` в комплекте | без WebAssembly |
| highlight.js 11.12.0 (через lowlight 3.3.0, MIT) | BSD-3-Clause | 5,5 MB | свои грамматики на регулярных выражениях; JSX и шаблоны — грубее | `github`, `github-dark` в CSS | без WebAssembly |
| Prism: refractor 5.0.0 / prismjs 1.30.0 | MIT | 1,1 MB / 2,1 MB | грамматики проще TextMate | темы GitHub — сторонние | без WebAssembly |
| starry-night 3.11.0 | MIT | 15 MB | грамматики самого GitHub — ближе всех | CSS GitHub | `vscode-oniguruma` на WebAssembly → `'wasm-unsafe-eval'` в CSP |

- **starry-night** — ближе всех к GitHub, но требует ослабить CSP renderer-а ради WebAssembly и весит больше всех.
- **highlight.js, Prism** — легче, но заметно грубее на TSX и шаблонах, и темы GitHub у Prism — не GitHub-а.
- **Пакет `shiki` вместо четырёх `@shikijs/*`** — тот же код, но лишний `@shikijs/engine-oniguruma` в lockfile.
- **Разбор файла целиком** вместо стороны hunk-а — верные цвета hunk-а, начатого внутри комментария, ценой чтения
  всего файла ради каждого hunk-а; отклонено (spec, Ticket 10, «Решено без владельца», пункт 2).
- **Web Worker для разбора** — шаг в 2 000 символов занимает миллисекунды (замер выше), шаги по одной задаче держат
  прокрутку; Worker добавил бы chunk, сообщения и копию tokens без видимой пользы.
- **Только предел стороны, без шагов** (первое предложение ревью) — чтобы один разбор оставался под 50 ms, предел
  пришлось бы держать около 5 000 символов: новый файл в 150 строк уже шёл бы простым текстом.
