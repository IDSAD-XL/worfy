# Code story — worfy-polish 146: Аудит повторного review: файлы темы Product Session на Windows и mind-map.json

Kind: pr · Epic: worfy-polish · Ticket: 146 · PR: - · Language: ru

## 1. Что было не так

На Windows чтение через symlink на `\\host\share\…` отдаёт этому host-у NTLM-данные входа пользователя, без клика.
`readProductTopic` проверял ссылки только для папки темы; `map.md`, `mind-map.json`, `issues/` и каждый Ticket читались
без проверки. `mind_map_read` звал `readTopic` вовсе без проверки, а доля принятых советов делала `readdir` папки
Product Session до проверки и читала каждый `critic/*.md` без неё (находки аудита 58, 59, 78, 80). Ещё два места не
были закреплены test-ами: нечитаемый `mind-map.json` (79) и передача `productWrites` в опции Session (93).

- Требование: [Что происходит](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-происходит)

## 2. linkRefusal и projectFolders: одно правило для всех читателей

Code: `src/main/product/topic.ts:66-83` · key lines: 67, 69, 81, 82

```ts
 */
export async function projectFolders(root: string, options: { paths: PathRules; fs: Pick<ProductFs, 'realpath'> }): Promise<string[] | null> {
  if (options.paths.sep !== '\\') return [root]
  const base = await options.fs.realpath(root).catch(() => null)
  return base === null ? null : [root, base]
}

/** What a topic error says of a file whose way leads to another host. */
export const LEADS_TO_ANOTHER_HOST = 'leads to another host through a link: not read'

/**
 * Why `path` must not be read under Windows rules: a link on the way to it leads to another host, or a
 * link could not be read; null to read it. Under any other rules null at once, with nothing asked.
 */
export async function linkRefusal(path: string, allowed: readonly string[], options: { paths: PathRules; links?: LinkFs | undefined }): Promise<string | null> {
  const verdict = await walkLinks(path, allowed, options)
  return verdict === 'remote' ? LEADS_TO_ANOTHER_HOST : verdict === 'unchecked' ? UNCHECKED : null
}
```

- Что делает: `projectFolders` даёт папки, от которых начинается обход ссылок: корень документов Project-а как записан и, под правилами Windows, его real path; `null`, если real path не нашёлся. `linkRefusal` обходит ссылки на пути к файлу (`walkLinks`) и возвращает причину отказа: ссылка ведёт на другой host или её нельзя прочитать; `null` — файл можно читать. Не под правилами Windows `walkLinks` сразу отвечает `local` и файловую систему не трогает.
- Почему здесь: Ticket предписывает проверять каждый файл темы `walkLinks` (`src/main/remote-links.ts:236`), как `resolveDocPath`; одни и те же две функции нужны теме, доле советов, `mind_map_read` и записи Mind map.
- Без него: у каждого читателя своя версия отказа и своя пара папок; review round 1 нашёл именно такое расхождение у `mind_map_read`.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: на Mac правила Windows проверяются через `path.win32` и подменённые `links`; настоящего symlink на share в test-ах нет.

## 3. readTopic проверяет каждый файл перед чтением

Code: `src/main/product/topic.ts:228-233` · key lines: 230, 231, 232

```ts
/** Reads the topic in `folder`. Never throws for the topic's files: what is wrong with them is in `errors`. */
export async function readTopic(folder: string, options: TopicReadOptions = {}): Promise<ProductTopic> {
  const paths = options.paths ?? nativePath
  const links = cachedLinks(options.links)
  const allowed = options.allowed ?? [folder]
  const reader: Reader = { paths, fs: options.fs ?? nodeProductFs, refusal: (path) => linkRefusal(path, allowed, { paths, links }) }
```

- Что делает: `readTopic` принимает правила путей, `links`, вызовы файловой системы и папки `allowed`. Каждое чтение идёт через `readText` с проверкой (`topic.ts:141-142`), `issues/` проверяется до `readdir` (`topic.ts:195-200`). Отказ становится ошибкой темы с именем файла.
- Почему здесь: Ticket называет `readText`, `readTickets` и `readTopic` (`topic.ts:62-70`, `:100-125`, `:150-165`).
- Без него: symlink `map.md` → `\\host\share\map.md` в склонированном repository отдаёт данные входа при открытии Product Session.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: без `allowed` обход начинается от папки темы; все вызовы в main теперь передают папки корня документов.

## 4. readProductTopic передаёт корень документов и свои вызовы

Code: `src/main/docs/watch.ts:252-262` · key lines: 257, 259, 260, 261

```ts
export async function readProductTopic(root: string, dir: readonly string[], name: string, options: ProductReadOptions = {}): Promise<ProductTopic | null> {
  if (!isProductTopicName(name)) throw new Error(`not a Product Session topic name: ${JSON.stringify(name)}`)
  const paths = options.paths ?? nativePath
  const fs = options.fs ?? nodeProductFs
  // The walks of the folder and of each file share their first segments: each link is asked about once.
  const links = cachedLinks(options.links)
  const folder = paths.join(root, ...dir, name)
  const allowed = await projectFolders(root, { paths, fs })
  if (allowed === null || (await leadsToRemote(folder, allowed, { paths, links }))) return null
  return (await fs.isFolder(folder)) ? readTopic(folder, { paths, links, fs, allowed }) : null
}
```

- Что делает: одна копия `links` с кэшем на всё чтение темы; папки обхода — `projectFolders(root)`, папка темы проверяется до `isFolder`, каждый файл — внутри `readTopic`. Вызовы файловой системы подменяемы, как `DocOptions.fs` у документов.
- Почему здесь: Ticket называет `readProductTopic` (`watch.ts:245-261`) и образец `resolveDocPath` (`watch.ts:105-116`).
- Без него: проверка файлов шла бы от папки темы и пропустила бы ссылку выше неё.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 5. Доля принятых советов: проверка до readdir и до readFile

Code: `src/main/ipc/product.ts:74-86` · key lines: 75, 77, 78, 84

```ts
export async function readAdviceShare(root: string, dir: readonly string[], options: ProductReadOptions = {}): Promise<AdviceShare> {
  const read: ShareRead = { paths: options.paths ?? nativePath, fs: options.fs ?? nodeProductFs, links: cachedLinks(options.links) }
  const folder = read.paths.join(root, ...dir)
  const allowed = await projectFolders(root, read)
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

- Что делает: `readAdviceShare` принимает `paths`, `links` и `fs`, проверяет папку Product Session до `readdir`; ссылка на другой host — доля пустая. `readReviews` проверяет папку `critic/` до `readdir` и каждый файл до `readFile` (`product.ts:47-60`); файл за такой ссылкой попадает в `skipped` с причиной.
- Почему здесь: Ticket, находки 59 и 80, называет `readReviews` и `readAdviceShare` (`product.ts:35-66`).
- Без него: `readdir` папки за ссылкой на share и чтение review за ней отдают данные входа; без параметров отказ нельзя проверить test-ом.
- Требование: [Что делаем, п. 2](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: нет.

## 6. Mind map берёт тот же корень, что и экран

Code: `src/main/mcp/mind-map-server.ts:529-539` · key lines: 530, 537

```ts
  // The same root the screen reads the topics from (product.topic): the Workflow folder in Silent mode.
  const root = await (deps.documentsRoot ?? appDocumentsRoot)(project.path).catch((error: unknown) => {
    console.warn(`[mind-map] no documents root for ${project.path}; the links are checked from the Project root`, error)
    return project.path
  })
  const server = await claudeMcpServer(
    mindMapServer({
      productFolder: request.productFolder,
      root,
      ...(deps.files === undefined ? {} : { files: deps.files }),
      ...(deps.writer === undefined ? {} : { writer: deps.writer }),
```

- Что делает: `mindMapForSession` спрашивает корень документов Project-а (`docsRoot` из `src/main/ipc/docs.ts`, в Silent mode — Workflow folder) и отдаёт его серверу. Инструменты строят папки обхода от него через `projectFolders` (`checkedFrom`, `mind-map-server.ts:167-171`); `mind_map_read` и `topicNames` проверяют темы и саму папку Product Session до чтения.
- Почему здесь: Ticket называет `mind_map_read` (`mind-map-server.ts:260-270`); корень и пару «как записан и real path» потребовал review round 1 PR #2216 — так же, как `docsSource` для `product.topic`.
- Без него: Workflow folder на собственном share пользователя (`C:\Work` → `\\nas\work`) отклонялся бы `mind_map_read`, хотя экран его читает.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: `docsRoot` импортируется при вызове, чтобы не тянуть watcher документов в модуль; в test-ах его подменяет `documentsRoot`. Если он падает, проверка идёт от корня Project-а.

## 7. Запись mind-map.json: проверка до guard-а записи

Code: `src/main/mcp/mind-map-server.ts:125-132` · key lines: 127, 128, 129, 132

```ts
  private async apply<T>(productFolder: string, file: string, platform: NodeJS.Platform, change: MindMapChange<T>, root: string): Promise<T> {
    // Before the guard: it resolves the real path of the file, which follows a link to a share.
    const files = await checkedFrom(root, this.options.files)
    const refused = await linkRefusal(file, files.allowed, files)
    if (refused !== null) throw new ToolError(`The Mind map is not written: ${file} ${refused}.`)
    const place = productToolDecision('Write', { file_path: file }, { productDir: productFolder, cwd: null }, platform)
    if (!place.allow) throw new ToolError(`The Mind map is not written: ${place.reason}`)
    const topic = await readTopic(files.paths.dirname(file), files)
```

- Что делает: перед guard-ом записи (`productToolDecision`) путь к `mind-map.json` проверяется от корня документов; ссылка на другой host — ToolError, ничего не читается и не пишется. Затем тема читается с теми же папками. `product.layout` передаёт корень в `updateMindMap`.
- Почему здесь: review round 1 PR #2216, пункт 4: `MindMapWriter.apply` читал тему без корня. Guard записи сам ищет real path файла (`realForm` в `src/main/agent/product-guard.ts`), поэтому проверка стоит до него.
- Без него: `mind_map_update`, `decide`, `remove` и перетаскивание узла на экране читают и пишут `mind-map.json` через ссылку `docs\product` → share.
- Требование: [Что делаем, п. 1](../issues/146-аудит-повторного-review-файлы-темы-product-session-на-windows-и-mind-map-json.md#что-делаем)
- Риски и пробелы test-ов: на Mac guard записи смотрит на настоящий диск, поэтому test успешной записи под правилами Windows проверяет только то, что отказ даёт не ссылка.

## 8. Test-ы: правила Windows на любой машине

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
- Риски и пробелы test-ов: так же устроены test-ы `readAdviceShare` (`test/unit/product-share.test.ts`), `mind_map_read` и записи (`test/contract/mind-map-tools.test.ts`). Test-ы находки 79, 93, папки `critic/` за ссылкой и непрочитанной ссылки закрепляют код, который уже верен: красными их делают mutant-ы.

## 9. Что сознательно не меняли

Чтение документов вне Product Session уже идёт через `resolveDocPath`. Остальные находки `triage.md` — вне скоупа.

## 10. Как проверено

Новые test-ы отказа — красные на исходниках origin/main (exit 1), зелёные после правки. Mutant-ы «убрать
`'error' in mindMap`», «убрать `STATUS_WORDS.has`», «убрать `productWrites` в `query.ts:476`», «корень — `project.path`»,
«без проверки папки `critic/`», «`unchecked` → `null`», «без проверки записи» и «`product.layout` без корня» — каждый
даёт красный test (exit 1). `pnpm lint`, `pnpm typecheck`, test-ы product, mind-map, docs, query-factory и remote-links
(23 файла) — exit 0.

## Проверить себя

1. Почему обход ссылок начинается от корня документов Project-а и его real path, а не от папки темы?
   - Ответ: обход от папки темы не смотрит на сегменты выше неё: ссылка `docs` → share осталась бы незамеченной. Real
     path корня нужен, чтобы корень на собственном share пользователя (или ссылка на него) считался своим.
   - Строки: `src/main/product/topic.ts:66-70`
2. Почему запись `mind-map.json` проверяет ссылки до guard-а записи?
   - Ответ: guard ищет real path файла, а это уже идёт через ссылку и отдаёт host-у данные входа; проверка должна
     отказать раньше.
   - Строки: `src/main/mcp/mind-map-server.ts:126-130`
3. Что видит пользователь, когда `map.md` темы — ссылка на share?
   - Ответ: тема читается, но без заголовка и разделов; `map.md` назван в её ошибках с причиной «leads to another host
     through a link: not read». Сам файл не читается.
   - Строки: `src/main/product/topic.ts:141-142`
