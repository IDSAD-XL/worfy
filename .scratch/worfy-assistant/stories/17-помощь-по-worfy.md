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

## 3. Поиск находит страницу, только если в ней все слова вопроса

Code: `src/main/assistant/help/feature-pages.ts:84-108` · key lines: 87, 97, 104, 105

```ts
/** The words of a question, lower case, each as the prefix it matches. */
function terms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(words.filter((word) => word.length >= 2).map((word) => (word.length > 5 ? word.slice(0, -2) : word)))]
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** How many words of `text` start with `term`. */
function hits(text: string, term: string): number {
  return text.toLowerCase().match(new RegExp(`(?<![\\p{L}\\p{N}])${escape(term)}`, 'gu'))?.length ?? 0
}

/** The score of a page for the terms: null when a term is not in it; the title counts most, then the headings. */
function score(text: string, words: readonly string[]): number | null {
  const page = outline(text)
  const headings = page.headings.map((heading) => heading.title).join('\n')
  let total = 0
  for (const term of words) {
    const inText = hits(text, term)
    if (inText === 0) return null
    total += inText + 10 * hits(page.title ?? '', term) + 3 * hits(headings, term)
  }
  return total
}
```

- Что делает: слово вопроса совпадает с началом слова страницы (у слов длиннее пяти букв отрезаются две последние,
  чтобы находились другие окончания); страница без хоть одного слова не годится; заголовок страницы весит больше
  заголовков разделов, а те — больше текста.
- Почему здесь: Ticket требует, чтобы поиск без подходящей страницы отдавал пустой ответ, а не чужую страницу; правило
  «все слова» — решение без владельца.
- Без него: вопрос, на который нет страницы, получал бы ближайшую по одному слову страницу, и Assistant отвечал бы не
  по теме вместо «не знаю».
- Требование: [Готово, когда, п. 2 и 3](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: поиск по словам, не по смыслу; вопрос, сформулированный другими словами, чем страница, не
  найдёт её — правила велят модели попробовать другие слова один раз. Индекс `README` в результаты не попадает.

## 4. Ответ — страница на языке Guide со ссылкой

Code: `src/main/assistant/help/feature-pages.ts:137-150` · key lines: 140, 142, 150

```ts
export function searchFeaturePages(files: readonly FeaturePageFile[], query: string, limit: number, options: FeatureHelpOptions): FeatureHit[] {
  const words = terms(query)
  if (words.length === 0) return []
  const best = new Map<string, number>()
  for (const file of files) {
    if (file.name === INDEX) continue
    const found = score(file.text, words)
    if (found !== null && found > (best.get(file.name) ?? 0)) best.set(file.name, found)
  }
  return [...best.entries()]
    .sort(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .slice(0, limit)
    .map(([name]) => {
      const file = pageIn(files, name, options.language)!
```

- Что делает: страница подходит, если слова есть в английской версии или в переводе; в ответ идёт версия на языке
  Guide, а без перевода — английская; путь и ссылка на GitHub на commit сборки строятся так же, как «Full page» в Guide.
- Почему здесь: spec, «Знакомство и помощь»: ответ со ссылкой на страницу описания, язык — язык Guide.
- Без него: при Guide на русском английский термин вопроса (`badge`) не нашёл бы русскую страницу, а ответ ссылался бы
  на английскую.
- Требование: [Готово, когда, п. 5](../issues/17-помощь-по-worfy.md#готово-когда)
- Риски и пробелы test-ов: ссылка ведёт на GitHub, а не на файл внутри сборки; без commit-а в версии сборки — на `main`.

## 5. Два tool-а `worfy-app`

Code: `src/main/mcp/app-server.ts:346-360` · key lines: 346, 349, 356

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
  язык из `guideLanguage` настроек, без выбора — из языка системы.
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

1. Почему вопрос «shelf espresso» не возвращает страницу Epic frames, хотя слово `shelf` в ней есть?
   - Ответ: страница годится, только если в ней есть все слова вопроса; без одного слова `score` отдаёт null.
   - Lines: `src/main/assistant/help/feature-pages.ts:102-104`
2. Guide на русском, у страницы нет перевода. Что ответит `features_read`?
   - Ответ: английскую страницу с `language: 'en'` и `guideLanguage: 'ru'`, путь без `ru/`.
   - Lines: `src/main/assistant/help/feature-pages.ts:137-150`
3. Откуда main знает язык, если пользователь ни разу не переключал EN / RU в Guide?
   - Ответ: из первого языка системы, по тому же правилу, что и Guide в renderer-е (`guideLanguage` из `src/shared/guide/language.ts`).
   - Lines: `src/main/mcp/app-server.ts:536-555`
