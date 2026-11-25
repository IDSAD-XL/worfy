# Code story — worfy-polish 146: Аудит повторного review: файлы темы Product Session на Windows и mind-map.json

Kind: pr · Epic: worfy-polish · Ticket: 146 · PR: - · Language: ru

## 1. Что было не так

На Windows чтение через symlink на `\\host\share\…` отдаёт этому host-у NTLM-данные входа пользователя, без клика.
`readProductTopic` проверял ссылки только для папки темы; `map.md`, `mind-map.json`, `issues/` и каждый Ticket читались
без проверки. `mind_map_read` звал `readTopic` вовсе без проверки, а доля принятых советов делала `readdir` папки
Product Session до проверки и читала каждый `critic/*.md` без неё (находки аудита 58, 59, 78, 80). Ещё два места не
были закреплены test-ами: нечитаемый `mind-map.json` (79) и передача `productWrites` в опции Session (93).

- Требование: [Что происходит](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-происходит)

## 2. linkRefusal: одно правило отказа для каждого файла

Code: `src/main/product/topic.ts:60-70` · key lines: 67, 68, 69

```ts

/** What a topic error says of a file whose way leads to another host. */
export const LEADS_TO_ANOTHER_HOST = 'leads to another host through a link: not read'

/**
 * Why `path` must not be read under Windows rules: a link on the way to it leads to another host, or a
 * link could not be read; null to read it. Under any other rules null at once, with nothing asked.
 */
export async function linkRefusal(path: string, allowed: readonly string[], options: { paths: PathRules; links?: LinkFs | undefined }): Promise<string | null> {
  const verdict = await walkLinks(path, allowed, options)
  return verdict === 'remote' ? LEADS_TO_ANOTHER_HOST : verdict === 'unchecked' ? UNCHECKED : null
```

- Что делает: обходит ссылки на пути к файлу (`walkLinks`) и возвращает причину отказа: ссылка ведёт на другой host или ссылку нельзя прочитать; `null` — файл можно читать. Не под правилами Windows `walkLinks` сразу отвечает `local` и файловую систему не трогает.
- Почему здесь: Ticket предписывает проверять каждый файл темы `walkLinks` (`src/main/remote-links.ts:236`), как `resolveDocPath`; одна функция нужна трём читателям: теме, доле советов и `mind_map_read`.
- Без него: у каждого читателя своя версия отказа, и `unchecked` легко пропустить.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: на Mac правила Windows проверяются через `path.win32` и подменённые `links`; настоящий symlink на share проверяет только Windows CI косвенно — такого test-а с реальным share нет.

## 3. readTopic проверяет каждый файл перед чтением

Code: `src/main/product/topic.ts:216-222` · key lines: 219, 220, 221

```ts
/** Reads the topic in `folder`. Never throws for the topic's files: what is wrong with them is in `errors`. */
export async function readTopic(folder: string, options: TopicReadOptions = {}): Promise<ProductTopic> {
  const paths = options.paths ?? nativePath
  const links = cachedLinks(options.links)
  const allowed = options.allowed ?? [folder]
  const reader: Reader = { paths, fs: options.fs ?? nodeProductFs, refusal: (path) => linkRefusal(path, allowed, { paths, links }) }
  const errors: TopicError[] = []
```

- Что делает: `readTopic` принимает правила путей, `links`, вызовы файловой системы и папки `allowed`, от которых начинается обход. Каждое чтение идёт через `readText` с проверкой (`topic.ts:129-130`), `issues/` проверяется до `readdir` (`topic.ts:183-188`). Отказ становится ошибкой темы с именем файла.
- Почему здесь: Ticket называет `readText`, `readTickets` и `readTopic` (`topic.ts:62-70`, `:100-125`, `:150-165`).
- Без него: symlink `map.md` → `\\host\share\map.md` в склонированном repository отдаёт данные входа при открытии Product Session.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: по умолчанию обход начинается с папки темы: вызов без `allowed` (запись Mind map, `mind-map-server.ts:122`) ссылку выше папки темы не ищет.

## 4. readProductTopic передаёт корень Project-а и свои вызовы

Code: `src/main/docs/watch.ts:252-266` · key lines: 257, 263, 265

```ts
export async function readProductTopic(root: string, dir: readonly string[], name: string, options: ProductReadOptions = {}): Promise<ProductTopic | null> {
  if (!isProductTopicName(name)) throw new Error(`not a Product Session topic name: ${JSON.stringify(name)}`)
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeProductFs
  // The walks of the folder and of each file share their first segments: each link is asked about once.
  const links = cachedLinks(options.links)
  const folder = paths.join(root, ...dir, name)
  let allowed: readonly string[] = [root]
  if (paths.sep === '\\') {
    const base = await fs.realpath(root).catch(() => null)
    if (base === null || (await leadsToRemote(folder, [root, base], { paths, links }))) return null
    allowed = [root, base]
  }
  return (await fs.isFolder(folder)) ? readTopic(folder, { paths, links, fs, allowed }) : null
}
```

- Что делает: одна копия `links` с кэшем на всё чтение темы; на Windows `allowed` — корень Project-а как написан и его real path, папка проверяется до `isFolder`, а каждый файл — внутри `readTopic`. Вызовы файловой системы подменяемы, как `DocOptions.fs` у документов.
- Почему здесь: Ticket называет `readProductTopic` (`watch.ts:245-261`) и образец `resolveDocPath` (`watch.ts:105-116`).
- Без него: проверка файлов шла бы от папки темы и пропустила бы ссылку выше неё.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 5. Доля принятых советов: проверка до readdir и до readFile

Code: `src/main/ipc/product.ts:84-96` · key lines: 85, 88, 93

```ts
export async function readAdviceShare(root: string, dir: readonly string[], options: ProductReadOptions = {}): Promise<AdviceShare> {
  const read: ShareRead = { paths: options.paths ?? nativePath, fs: options.fs ?? nodeProductFs, links: cachedLinks(options.links) }
  const folder = read.paths.join(root, ...dir)
  const allowed = await allowedFolders(root, read)
  if (allowed === null || (await linkRefusal(folder, allowed, read)) !== null) return adviceShare({ topics: [], reviews: [] })
  const topics = []
  // `critic` and hidden names are no topic names; a file (README.md) reads as no topic.
  for (const name of (await names(read.fs, folder)).sort()) {
    if (!isProductTopicName(name)) continue
    const topic = await readProductTopic(root, dir, name, read)
    if (topic !== null) topics.push(topic)
  }
  return adviceShare({ topics, reviews: await readReviews(root, dir, read) })
```

- Что делает: `readAdviceShare` принимает `paths`, `links` и `fs`, проверяет папку Product Session до `readdir`; ссылка на другой host — доля пустая. `readReviews` проверяет папку `critic/` и каждый файл до `readFile` (`product.ts:57-70`); файл за такой ссылкой попадает в `skipped` с причиной.
- Почему здесь: Ticket, находки 59 и 80, называет `readReviews` и `readAdviceShare` (`product.ts:35-66`).
- Без него: `readdir` папки за ссылкой на share и чтение review за ней отдают данные входа; без параметров отказ нельзя проверить test-ом.
- Требование: [Что делаем, п. 2](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 6. mind_map_read идёт через ту же проверку

Code: `src/main/mcp/mind-map-server.ts:273-280` · key lines: 276, 278, 280

```ts
    mind_map_read: async ({ topic }) => {
      const root = folder()
      // One answer per link for every walk of this call, and each file checked before it is read.
      const files = { ...context.files, links: cachedLinks(context.files?.links), allowed: [context.root ?? root] }
      if (topic !== undefined) {
        const names = await topicNames(root, files)
        if (!names.includes(topic)) throw new ToolError(`There is no topic ${topic} yet. Topics: ${names.length === 0 ? '(none)' : names.join(', ')}.`)
        return topicAnswer(await readTopic(productTopicFolder(root, topic), files))
```

- Что делает: все обходы одного вызова делят кэш ссылок; обход начинается от корня Project-а (`root`, его даёт `mindMapForSession`: `project.path`), без него — от папки Product Session. `topicNames` проверяет саму папку Product Session до `readdir` (`mind-map-server.ts:369-371`).
- Почему здесь: Ticket называет `mind_map_read` (`mind-map-server.ts:260-270`).
- Без него: агент вызовом `mind_map_read` читает файлы за ссылкой на share.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: что `mindMapForSession` передаёт `root: project.path`, test не проверяет; contract test задаёт `root` сам.

## 7. Test-ы: правила Windows на любой машине

Code: `test/unit/product-topic.test.ts:167-184` · key lines: 168, 177, 180, 184

```ts
  it('reads none of map.md, mind-map.json and issues\\ when each is a link to a share, and names each file in errors', async () => {
    const system = fakeProductSystem({
      files: { [`${FOLDER}\\notes.txt`]: 'the folder is there' },
      links: {
        [`${FOLDER}\\map.md`]: '\\\\evil.example\\share\\map.md',
        [`${FOLDER}\\${MIND_MAP_FILE}`]: '\\\\evil.example\\share\\mind-map.json',
        [`${FOLDER}\\issues`]: '//evil.example/share/issues',
      },
    })

    const topic = await readProductTopic(ROOT, DIR, 'roadmap', system.options)

    expect(topic).not.toBeNull()
    expect(topic?.errors.map((error) => error.file).sort()).toEqual(['issues', 'map.md', MIND_MAP_FILE])
    for (const error of topic?.errors ?? []) expect(error.message).toMatch(/another host/)
    expect(topic).toMatchObject({ title: null, sections: [], tickets: [], nodes: [] })
    // The links themselves are looked at with lstat and readlink; nothing reads a path through them.
    expect(reads(system.calls)).toEqual([`realpath ${ROOT}`, `isFolder ${FOLDER}`])
```

- Что делает: `map.md`, `mind-map.json` и `issues` темы — ссылки на `\\evil.example\share`; тема есть, все три файла названы в ошибках, а из чтений остались только `realpath` корня и `isFolder` папки. Подменённая файловая система — `test/unit/product-fake-fs.ts`.
- Почему здесь: Ticket, «Готово, когда», пункт 58, 78; по образцу `test/unit/docs-remote-links.test.ts`.
- Без него: отказ `readProductTopic` на ссылке к удалённому host-у не закреплён (находка 78).
- Требование: [Готово, когда](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#готово-когда)
- Риски и пробелы test-ов: так же устроены test-ы `readAdviceShare` (`test/unit/product-share.test.ts`) и `mind_map_read` (`test/contract/mind-map-tools.test.ts`); все семь новых test-ов красные на origin/main. Test-ы находки 79 (папка вместо `mind-map.json`, `Status: someword`) и 93 (`productWrites` в `sdkQueryFactory`) закрепляют уже верный код: красными их делают mutant-ы.

## 8. Что сознательно не меняли

Запись Mind map (`MindMapWriter.apply`, `mind-map-server.ts:122`) читает тему без `allowed`: обход идёт от папки темы, а
не от корня Project-а. Ticket про запись не говорит; это вне скоупа. Чтение документов вне Product Session уже идёт через
`resolveDocPath`.

## 9. Как проверено

Семь новых test-ов отказа — красные на исходниках origin/main (exit 1), зелёные после правки. Mutant «убрать
`'error' in mindMap`», mutant «убрать `STATUS_WORDS.has`» и mutant «убрать `productWrites` в `query.ts:476`» — каждый
даёт красный test (exit 1). `pnpm lint`, `pnpm typecheck` — exit 0.

## Проверить себя

1. Почему обход ссылок в `readProductTopic` начинается от корня Project-а, а не от папки темы?
   - Ответ: обход от папки темы не смотрит на сегменты выше неё: ссылка `docs` → share осталась бы незамеченной, а
     `lstat` файла внутри всё равно прошёл бы через неё. От корня Project-а проверяется весь путь.
   - Строки: `src/main/docs/watch.ts:259-265`
2. Что видит пользователь, когда `map.md` темы — ссылка на share?
   - Ответ: тема читается, но без заголовка и разделов; `map.md` назван в её ошибках с причиной «leads to another host
     through a link: not read». Сам файл не читается.
   - Строки: `src/main/product/topic.ts:129-130`
3. Почему review за ссылкой попадает в `skipped`, а папка Product Session за ссылкой — нет?
   - Ответ: файл review назван отдельно, как любой нечитаемый review; папку целиком не читают и не перечисляют, доля
     просто пустая — так же, как раньше вела себя папка `critic/` за ссылкой.
   - Строки: `src/main/ipc/product.ts:84-88`
