# Code story — worfy-assistant 17: Помощь по worfy: описания функций в сборке, поиск и чтение через `worfy-app`, ответ со ссылкой, язык Guide

Kind: pr · Epic: worfy-assistant · Ticket: 17 · PR: - · Language: ru

## 1. Что было не так

Страниц `docs/features` в упакованной сборке не было, а у Session Assistant-а не было tool-а, который их ищет и
читает. На вопрос «как работает функция worfy» Assistant мог ответить только по памяти модели, без ссылки, и не знал,
на каком языке говорить с пользователем.

- Требование: [Что строить](../issues/17-помощь-по-worfy.md#что-строить)

## 2. Страницы кладутся в сборку

Code: `electron-builder.yml:42-49` · key lines: 46, 47, 49

```yaml
  # The feature pages of worfy, English and the Russian translation under ru/, sit in
  # Contents/Resources/features/: the Assistant's tools features_search and features_read read them
  # there (worfy-assistant ticket 17, src/main/assistant/help/feature-pages.ts, FEATURE_PAGES_RESOURCE).
  # Markdown only; test/contract/feature-pages-in-build.test.ts checks this entry.
  - from: docs/features
    to: features
    filter:
      - '**/*.md'
```

- Что делает: electron-builder копирует `docs/features` и `docs/features/ru` (только `.md`) в
  `Contents/Resources/features/`, вне `app.asar`; main читает их оттуда (`featurePagesDir`).
- Почему здесь: Ticket называет `electron-builder.yml` (`extraResources`) в разделе «Где в коде». Почему не внутрь
  бандла main: 2,9 МБ Markdown-а не нужны при старте приложения — решение без владельца.
- Без него: в собранном worfy поиск не нашёл бы ни одной страницы.
- Требование: [Готово, когда, п. 1](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: настоящая сборка `pnpm package` не запускалась (правило владельца); contract test сверяет
  запись в конфиге с константой папки main и с папками репозитория, а не содержимое `.app`.

## 3. Страница находится, только если её раздел — о вопросе

Code: `src/main/assistant/help/feature-pages.ts:180-198` · key lines: 190, 191, 196

```ts
/**
 * How much a section is about the question, or null when it is not. Every word of the question is in its headings (the
 * page's title and the headings above it count) or in its own text, and the words of its text stand close together
 * (NEAR_WORDS); the one word of a one-word question is in its headings or twice in its text — once is in passing.
 * The headings count most.
 */
function about(block: Block, words: readonly Term[]): number | null {
  const count = (where: readonly string[], matches: Term): number => where.filter(matches).length
  const inChain = words.map((matches) => count(block.chain, matches))
  const inBody = words.map((matches) => count(block.body, matches))
  if (words.some((_, index) => inChain[index]! + inBody[index]! === 0)) return null
  if (words.length === 1 && inChain[0] === 0 && inBody[0]! < 2) return null
  const near = span(
    block.body,
    words.filter((_, index) => inChain[index] === 0),
  )
  if (near === null || near > NEAR_WORDS) return null
  return inBody.reduce((sum, each) => sum + each, 0) + 3 * inChain.reduce((sum, each) => sum + each, 0)
}
```

- Что делает: все слова вопроса должны быть в одном разделе — в его заголовках (вместе с заголовком страницы и
  заголовками выше) или в его тексте, а слова из текста — не дальше 12 слов друг от друга; слово вопроса из одного слова
  — в заголовках или дважды в тексте. Латинское слово совпадает только с тем же словом в единственном или
  множественном числе (`term`), кириллическое — по основе без окончания; «ё» приравнена к «е».
- Почему здесь: Ticket требует, чтобы поиск без подходящей страницы отдавал пустой ответ, а не чужую страницу. Review
  1-го раунда нашёл, что правило «все слова где-то на странице» отдавало чужие страницы на настоящих вопросах («voice
  input», «spell check», «dark mode», «emoji»); правило раздела и близости слов — решение без владельца.
- Без него: вопрос, на который нет страницы, получал бы страницу, где те же слова сказаны мимоходом в разных местах, и
  Assistant отвечал бы не по теме вместо «не знаю».
- Требование: [Готово, когда, п. 2 и 3](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: поиск по словам, не по смыслу: вопрос другими словами, чем страница, её не найдёт — правила
  велят модели попробовать другие слова один раз. Латинские слова с другим окончанием («stopped» и «stop») не
  совпадают. Порог 12 слов подобран по запросам к настоящим страницам; test-ы — `test/contract/feature-pages-in-build.test.ts`.

## 4. Ответ — страница на языке Guide со ссылкой

Code: `src/main/assistant/help/feature-pages.ts:236-264` · key lines: 245, 261, 262

```ts
export function searchFeaturePages(files: readonly FeaturePageFile[], query: string, limit: number, options: FeatureHelpOptions): FeatureHit[] {
  const words = terms(query)
  if (words.length === 0) return []
  const best = new Map<string, { score: number; page: Outline; sections: number[] }>()
  for (const file of files) {
    if (file.name === INDEX) continue
    const page = outline(file.text)
    let score: number | null = null
    const sections: number[] = []
    for (const block of blocks(page)) {
      const found = about(block, words)
      if (found === null) continue
      score = Math.max(score ?? 0, found)
      if (block.heading >= 0) sections.push(block.heading)
    }
    if (score !== null && score > (best.get(file.name)?.score ?? 0)) best.set(file.name, { score, page, sections })
  }
  return [...best.entries()]
    .sort(([a, left], [b, right]) => right.score - left.score || a.localeCompare(b))
    .slice(0, limit)
    .map(([name, matched]) => {
      const file = pageIn(files, name, options.language)!
      const page = outline(file.text)
      const path = featurePagePath(name, file.language)
      // The words may have matched the other language's version: its sections, named as this page names them.
      const sections = headingsIn(matched.page, page, matched.sections)
      return { page: name, language: file.language, title: page.title ?? name, path, url: githubFileUrl(path, options.version), sections: sections.slice(0, HIT_SECTIONS_MAX) }
    })
}
```

- Что делает: страница подходит, если её раздел — о вопросе в английской версии или в переводе; в ответ идёт версия на
  языке Guide, а без перевода — английская. Разделы берутся из версии, где совпали слова, и называются так, как их
  называет отданная страница (`headingsIn`: то же место в оглавлении перевода). Путь и ссылка на GitHub на commit
  сборки строятся так же, как «Full page» в Guide.
- Почему здесь: spec, «Знакомство и помощь»: ответ со ссылкой на страницу описания, язык — язык Guide.
- Без него: при Guide на русском английский вопрос (`badge`) не нашёл бы русскую страницу или пришёл бы без разделов.
- Требование: [Готово, когда, п. 5](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: если у перевода другое число заголовков, разделы называются по-английски, и `features_read`
  читает такой раздел из английской версии. Ссылка ведёт на GitHub, а не на файл внутри сборки.

## 5. Два tool-а `worfy-app`

Code: `src/main/mcp/app-server.ts:346-360` · key lines: 347, 349, 355

```ts
    // The pages are worfy's own text, shipped in the build: not outside text. They pass redactSecrets like every answer.
    features_search: async ({ query, limit }) => {
      const options = { language: deps.guideLanguage(), version: deps.buildVersion() }
      return { guideLanguage: options.language, results: searchFeaturePages(await deps.featurePages(), query, limit ?? DEFAULT_FEATURE_HITS, options) }
    },

    features_read: async ({ page, section }) => {
      const files = await deps.featurePages()
      try {
        return readFeaturePage(files, page, section, { language: deps.guideLanguage(), version: deps.buildVersion() })
      } catch (error) {
        if (error instanceof FeaturePageMissing) throw new ToolError(error.message)
        throw error
      }
    },
```

- Что делает: `features_search` отвечает списком страниц (страница, заголовок, путь, ссылка, разделы со словами),
  `features_read` — текстом страницы или одного раздела, её разделами и темами Guide; нет страницы или раздела — отказ
  `isError` со списком того, что есть.
- Почему здесь: spec, «MCP-сервер `worfy-app`»: чтение включает поиск и чтение описаний функций worfy; ответ проходит
  `redactSecrets`, как у всех tool-ов сервера. Почему страницы не блок чужого текста: их пишет worfy, они едут в сборке —
  решение без владельца.
- Без него: модели нечем найти и прочитать страницу.
- Требование: [Что строить, п. 2](../issues/17-помощь-по-worfy.md#что-строить)
- Риски и пробелы test-ов: длинная страница режется на 40 000 символах (`truncated: true`); предел MCP-ответа Claude Code
  на настоящей Session не проверялся — модели не вызывались.

## 6. Правила Session: ссылка, «не знаю», язык Guide

Code: `src/main/mcp/agent-instructions-app.md:25-34` · key lines: 28, 31, 33, 34

```md
## Help about worfy

The user may always ask you how worfy works. The feature pages of worfy, bundled in this build, are the only source
of such an answer:

- Find the page with `features_search` (a few key words), then read it, or its section, with `features_read`.
- Answer from the page and give its link (`url`) with the answer. You may also name a Guide topic of `guideTopics`:
  the user opens it with Help ▸ worfy Guide.
- When `features_search` finds no page, try other words once. When still no page describes it, say so: you
  do not know, and no page of worfy describes it. Never answer a question about worfy from memory or by guessing.
```

- Что делает: правила велят отвечать по странице и со ссылкой, а без страницы — говорить «не знаю», не по памяти.
  `worfyAppInstructions(language)` добавляет раздел `## Language`: говорить на языке Guide; `worfyAppForSession` берёт
  язык из `guideLanguage` настроек, без выбора — из языка системы, один раз: правила и tool-ы этой Session держат его,
  даже если пользователь переключит Guide посреди Session (`src/main/mcp/app-server.ts:459-461`).
- Почему здесь: правила сервера уже добавляются к system prompt Session Assistant-а (Ticket 09, Ticket 10).
- Без него: модель отвечала бы по памяти и на языке вопроса.
- Требование: [Готово, когда, п. 4 и 5](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: поведение настоящей модели по этим правилам не проверялось: модели не вызывались.

## 7. Что сознательно не меняли

Tool-а, который сам открывает тему Guide, нет: ответ называет темы, проверенные по странице (`guideTopics`), и путь
Help ▸ worfy Guide; кнопка в разговоре — дело экрана Assistant-а. Проводка сервера к Session — Ticket 10: здесь в
`appWorfyAppDeps` добавлена только строка `...(await appHelpDeps())`. Правила языка Guide (`guideLanguage`), ссылки
Guide (`githubFileUrl`) и список тем (`GUIDE_TOPICS`) переехали в `src/shared/guide/`, чтобы их читал main; файлы
renderer-а их реэкспортируют. Страницы `docs/features` не менялись: ни одна не описывает `worfy-app`.

## 8. Как проверено

`test/contract/worfy-app-tools.test.ts` и `test/contract/feature-pages-in-build.test.ts` — exit 0, поиск по настоящим
страницам находит `epic-frames` на обоих языках и ничего для «espresso descaling»; `pnpm lint`, `pnpm typecheck`,
`pnpm test` и gate fast — коды выхода в отчёте PR.

## Проверить себя

1. Почему вопрос «dark mode» не находит страницу Sessions, хотя в её разделе есть и «dark», и «modes»?
   - Ответ: слова стоят дальше 12 слов друг от друга, а «model» и «mode» для латинского слова — разные слова; раздел не
     о вопросе, и `about` отдаёт null.
   - Lines: `src/main/assistant/help/feature-pages.ts:190-196`
2. Guide на русском, вопрос `badge` совпал только в английской версии. Какие разделы придут в ответе?
   - Ответ: разделы русской страницы на тех же местах оглавления («Значки CI»), если число заголовков совпадает.
   - Lines: `src/main/assistant/help/feature-pages.ts:230-233`, `src/main/assistant/help/feature-pages.ts:260-261`
3. Пользователь переключил Guide на EN посреди Session. На каком языке ответят tool-ы?
   - Ответ: на языке, взятом при создании Session: `worfyAppForSession` подменяет `guideLanguage` значением, взятым один раз.
   - Lines: `src/main/mcp/app-server.ts:459-461`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-assistant 17 (help about worfy: the feature pages shipped in the build, features_search and features_read in worfy-app, an answer from a page with a link, the Guide's language), head 62fa2f9a16218d97dbf2830b9f7389c83805c9d1
>
> Gate (depth medium, two rounds):
> - Round 1, reviewer (lens: correctness) — FIX:
>   - med: each query word could match the start of any word anywhere on a page, so «voice input», «spell check», «dark mode» and «emoji» returned unrelated pages, against ticket item 3;
>   - low: ё and е were not treated as the same letter;
>   - low: short Russian words kept their endings;
>   - low: sections were looked up in the wrong language version;
>   - low: the language was fixed in the rules but re-read by the tools on every call.
> - Round 2: checked by the Orchestrator against the implementer's report and the tests named there.
>
> - What it does (nothing runs in the app until ticket 10 connects worfy-app to the Assistant Session):
>   - electron-builder copies docs/features (.md only, ru/ too) into Resources/features. Main reads them there when packaged, and from the checkout in dev.
>   - features_search finds a page only when one of its sections is about the query: all words in that section's headings or text, within 12 words of each other; a one-word query must be in a heading or twice in the text. Latin words match singular or plural only; Cyrillic words match by stem; ё = е. A query with no page gives [].
>   - The result has the page, a GitHub link at the build's commit (main without a commit), and the matching sections named as on the page returned.
>   - features_read returns the page (cut at 40 000 characters, a section on request) and the Guide topics checked against it. Page names are matched against a fixed pattern, so no path traversal.
>   - The Session's rules: answer from a page with its link, otherwise say «I don't know», never from memory.
>   - The Guide's language is taken once per Session; Russian pages fall back to English when no translation exists.
>   - The Guide's language, links and registry code moved to src/shared/guide, with renderer re-exports.
> - Evidence:
>   - The new tests are red first: 12 failed in round 1, 8 in round 2.
>   - 7 round-2 mutants are caught: proximity, ё folding, short stems, sections, one-word rule, Session language, read fallback.
>   - The reviewer's queries against the real pages now give [] with the Guide in English and in Russian; real queries still find their page («Done shelf» → epic-frames, «dark theme» / «темная тема» / «тёмная тема» → app-shell).
>   - The reviewer checked: no path traversal; only 78 .md packaged; a main SSR build of the module bundles all Guide topic JSON (EXIT=0); the reviewer's run of 771 tests and typecheck EXIT=0.
>   - The implementer's round-2 run of 232 tests (worfy-app tools, feature pages, guide), lint and typecheck: EXIT=0. The round-1 full pnpm test: EXIT=0.
>   - gate fast green after the rebase onto ff74a7f54; story-check ok on ddb5d07a8.
> - Not verified:
>   - a packaged .app;
>   - a real model following the rules;
>   - the precision of search beyond the 18 queries tuned on.
> - Noted: search is stricter now («stopped» no longer finds «stop»; a word said once in passing finds nothing).
>
> Decided without the owner (to confirm):
> - pages ship as files in Resources/features;
> - search by one section, words within 12 words of each other; singular or plural for Latin, a stem for Cyrillic, ё = е;
> - 5 results by default, 10 at most;
> - a GitHub link at the build's commit;
> - no tool of its own to open a Guide topic;
> - an English page when no translation exists;
> - the language is fixed once per Session.
> - Round 3 (CI windows red, test/contract/feature-pages-in-build.test.ts:75 — a Windows checkout gives CRLF): readFeaturePages makes every line end \n once on read (src/main/assistant/help/feature-pages.ts:53); a unit test with CRLF and lone-CR pages, red before the fix, and a contract line that no page keeps \r; checked by the Orchestrator against the diff ddb5d07a8..62fa2f9a1; 249 tests of the help, guide and worfy-app tools, lint, typecheck EXIT=0, gate fast green on afbe4c387, story-check ok on 62fa2f9a1.

Code: `test/contract/feature-pages-in-build.test.ts:75-75` · key lines: 75

```ts
    // Whatever line ends the checkout has (CRLF on Windows), the pages are read with \n only.
```

Code: `src/main/assistant/help/feature-pages.ts:53-53` · key lines: 53

```ts
    return Promise.all(names.map(async (name) => ({ name: name.slice(0, -'.md'.length), language, text: (await readFile(join(folder, name), 'utf8')).replace(/\r\n?/gu, '\n') })))
```
