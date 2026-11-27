# Code story — worfy-polish 162: Markdown в чате Assistant-а

Kind: pr · Epic: worfy-polish · Ticket: 162 · PR: - · Language: ru

## 1. Что было не так

Вкладка Chat раздела Assistant показывала текст Assistant-а сырым: `**Главное: …**`, обратные кавычки вокруг `open`,
строки списка с `- `. `Chat` клал `message.text` в `<span>` как есть, утренняя сводка на Summary — в `<p>`, а пузырь
держит `white-space: pre-wrap`. Session view тот же текст ассистента рисует общим renderer-ом `Markdown.tsx`.

- Требование: [Что происходит](../issues/162-markdown-в-чате-assistant-а.md#что-происходит)

## 2. Один кусок «текст сообщения Assistant-а» на общем renderer-е

Code: `src/renderer/assistant/parts.tsx:25-31` · key lines: 27, 28

```tsx
export function AssistantWords({ text }: { text: string }): ReactElement {
  return (
    <div className="w-asst-text w-asst-md">
      <Markdown text={text} breaks showLinkHost />
    </div>
  )
}
```

- Что делает: рисует текст Assistant-а компонентом `Markdown` из `src/renderer/markdown/Markdown.tsx` с `breaks`, как
  `Transcript.tsx` рисует ответ ассистента, и с `showLinkHost` (шаг 3). Без `projectId`: ссылка на файл не называет
  файл Project-а и рисуется текстом без действия.
- Почему здесь: Ticket называет `parts.tsx` в «Где в коде» как место общего куска; один компонент держит одно правило
  для Chat и Summary.
- Без него: второй способ рисовать текст в Summary и Chat, и правило «что Markdown, что нет» разошлось бы.
- Требование: [Что строить, п. 1, 5](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: сырой HTML, картинки и опасные ссылки гасит сам `Markdown.tsx` (без rehype-raw,
  `img` — alt-текст, `classifyLink` пускает только http(s)://); правка эти правила не меняет, test-ы панели их
  проверяют на тексте Assistant-а.

## 3. Ссылка цитаты открывает браузер, а рядом виден её настоящий host

Code: `src/renderer/markdown/links.ts:102-123` · key lines: 110, 115, 122

```ts
export function linkHost(text: string, url: string): string | null {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  const shown = text.trim()
  if (shown === url || shown === target.href) return null
  // A text that reads as an address of the same host — with its scheme or without, as an autolinked `www.…` — names it.
  if (/^\S+$/u.test(shown)) {
    for (const candidate of [shown, `https://${shown}`]) {
      try {
        const named = new URL(candidate)
        if ((named.protocol === 'http:' || named.protocol === 'https:') && named.host === target.host) return null
      } catch {
        // not an address in this reading
      }
    }
  }
  return target.host
}
```

- Что делает: решает, какой host показать рядом со ссылкой. Ничего — когда текст ссылки и есть её адрес или адрес того же
  host-а (с схемой или без, как autolink `www.…`). Host адреса — во всех остальных случаях: «Approve», текст-адрес
  другого host-а `https://jira.example/SHOP-12` при цели `evil.example`.
- Почему здесь: review первого раунда нашёл, что ссылка цитаты из Slack или Jira может назвать одно место и открыть
  другое — в строке и ссылкой-сноской `[Approve][2]`. Решение review: показывать host рядом, опцией общего renderer-а,
  включённой только в `AssistantWords`. `links.ts` — модуль ссылок renderer-а; из `Markdown.tsx` функцию вынесли по
  правилу lint `react-refresh/only-export-components`.
- Без него: «Approve» или подпись с адресом Jira открывали бы `evil.example`, и это видно только в tooltip.
- Требование: [Что строить, п. 2, 3](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: адрес того же host-а с другим путём host не показывает; поддомен считается другим host-ом.
  Ссылки другой схемы и ссылки на файл без Project-а до `linkHost` не доходят: `Link` рисует их текстом без действия.

## 4. Ссылка на файл без Project-а — текст, host — после ссылки

Code: `src/renderer/markdown/Markdown.tsx:112-133` · key lines: 113, 120, 133

```tsx
  // A file link without a Project opens nothing, so it does not look like a link either (review of worfy-polish ticket 162).
  if (target.kind === 'none' || (target.kind === 'file' && projectId === undefined)) {
    return (
      <span className={className === undefined ? 'w-md__inert-link' : `w-md__inert-link ${className}`} title={href}>
        {children}
      </span>
    )
  }
  const host = showHost && target.kind === 'external' ? linkHost(text, target.url) : null
  const onClick = (event: MouseEvent) => {
    // The window itself never navigates: the link always leaves through main.
    event.preventDefault()
    // A Project file lies on the window's Linked machine: the toast instead of its editor.
    if (target.kind === 'file' && projectId !== undefined && file.elsewhere) file.show()
    else open(href, projectId, baseDir, setNote)
  }
  return (
    <>
      <a href={href} className={className} title={target.kind === 'external' ? target.url : target.path} onClick={onClick}>
        {children}
      </a>
      {host !== null && <span className="w-md__link-host">({host})</span>}
```

- Что делает: ссылка на файл без Project-а (`foo.md`, `/etc/passwd`, `C:\…`) рисуется как прочие ссылки без действия —
  `w-md__inert-link`. При `showHost` после ссылки http(s):// стоит `(host)` приглушённым цветом.
- Почему здесь: оба пункта — решения review первого раунда. Session view и PR inbox `showLinkHost` не включают.
  PR inbox (`CommentBody.tsx`) рисует без Project-а, поэтому ссылка на файл и там стала текстом.
- Без него: в чате Assistant-а ссылка на файл выглядела бы живой и ничего не делала.
- Требование: [Что строить, п. 2](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: остальные пользователи renderer-а без Project-а (Code story, SelfCheck, LineQuestion) тоже
  получают текст вместо мёртвой ссылки; отдельных test-ов для них нет.

## 5. Chat: сообщение Assistant-а — Markdown, сообщение пользователя — текст

Code: `src/renderer/assistant/AssistantPanel.tsx:352-375` · key lines: 355, 375

```tsx
        if (message.who === 'you') {
          return (
            <div key={message.id} className="w-asst-message w-asst-message--you">
              <div className="w-asst-bubble">{message.text}</div>
            </div>
          )
        }
        const handed = message.proposalId === undefined || message.proposalId === null ? undefined : view.proposals.find((proposal) => proposal.id === message.proposalId)
        return (
          <Fragment key={message.id}>
            <div className="w-asst-message" data-testid="assistant-message" data-state={message.state} data-reason={message.reason}>
              <span className="w-asst-avatar w-asst-avatar--small">
                <Spark size={11} />
              </span>
              <div className="w-asst-bubble">
                {message.state === 'pending' ? (
                  <span className="w-asst-typing" aria-label="Assistant is writing">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <>
                    <AssistantWords text={message.text} />
```

- Что делает: готовое или неудачное сообщение Assistant-а идёт через `AssistantWords`; сообщение пользователя
  остаётся строкой в пузыре.
- Почему здесь: Session view рисует строку пользователя (`w-tr__prompt`) без Markdown, Ticket велит следовать ему.
- Без него: утреннее сообщение с жирным, кодом и списком оставалось бы сырым — замечание владельца.
- Требование: [Что строить, п. 1, 4](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: текст ошибки (`NO_ANSWER`) тоже идёт через Markdown; это обычные фразы, отдельного test-а нет.

## 6. Стили под узкую панель

Code: `src/renderer/assistant/assistant.css:760-807` · key lines: 761, 793, 794, 798, 800

```css
.w-asst-md {
  white-space: normal;
  min-width: 0;
}
.w-asst-md .w-md {
  font-size: inherit;
  line-height: inherit;
}
.w-asst-md .w-md p,
.w-asst-md .w-md ul,
.w-asst-md .w-md ol,
.w-asst-md .w-md pre,
.w-asst-md .w-md table,
.w-asst-md .w-md blockquote {
  margin-bottom: 6px;
}
.w-asst-md .w-md h1,
.w-asst-md .w-md h2,
.w-asst-md .w-md h3,
.w-asst-md .w-md h4,
.w-asst-md .w-md h5,
.w-asst-md .w-md h6 {
  margin: 8px 0 4px;
  font-size: var(--text-13);
}
.w-asst-md .w-md ul,
.w-asst-md .w-md ol {
  padding-left: 16px;
}
.w-asst-md .w-md code {
  font-size: var(--text-11);
}
.w-asst-md .w-md pre {
  max-width: 100%;
  overflow-x: auto;
  padding: 6px 8px;
}
.w-asst-md .w-md table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.w-asst-md .w-md > :first-child {
  margin-top: 0;
}
.w-asst-md .w-md > :last-child {
  margin-bottom: 0;
}
```

- Что делает: снимает `pre-wrap` пузыря с Markdown (react-markdown ставит переводы строк между блоками, и `pre-wrap`
  дал бы пустую строку между ними); текст — размера пузыря; отступы плотнее; блок кода и широкая таблица
  прокручиваются по горизонтали внутри пузыря. Префикс `.w-md` поднимает вес правил над `markdown.css`, порядок
  загрузки двух файлов не важен; первый и последний блок — без внешних отступов, как в `markdown.css`.
- Почему здесь: Ticket требует плотные отступы и прокрутку кода внутри пузыря («Что строить», п. 6). Пузырь получил
  `min-width: 0` (`assistant.css:728`): у flex-элемента `min-width: auto` по длинной строке кода победил бы
  `max-width: 88%`.
- Без него: блок кода растягивал бы пузырь за край панели, между абзацами стояли бы лишние пустые строки.
- Требование: [Что строить, п. 6](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: jsdom не раскладывает страницу, test читает правила как текст; как пузырь выглядит в
  Electron, проверяет только ручной пункт в Stable copy.

## 7. Что сознательно не меняли

Speech card у rail (`AssistantSpeech.tsx`) показывает только шапку карточки — заголовок, «почему», чипы, источник — и
не менялся; его логику закрытия правит polish 161. Заголовок и «почему» карточек, строки Journal, правила — однострочные
подписи, остаются текстом. Второй библиотеки Markdown нет. Session view не меняется: `showLinkHost` там не включён, а
ссылки на файл он рисует с Project-ом.

## 8. Как проверено

Пять новых test-ов в `test/unit/assistant-panel.test.tsx` были красными до правки; два (сырой HTML и сообщение
пользователя) — защитные, зелёные и до правки, потому что сырой текст и так ничего не исполнял. Test-ы renderer-а
Assistant-а и общего Markdown (12 файлов, 208 test-ов, unit и contract) — exit 0; `pnpm lint && pnpm typecheck && pnpm
test` — exit 0 (955 файлов, 21456 test-ов); gate fast — exit 0, green.

После review первого раунда четыре новых test-а были красными до правки: host рядом со ссылкой в `markdown.test.tsx` и
в `assistant-panel.test.tsx` (ссылка с адресом Jira в тексте и ссылка-сноска `[Approve][2]`), ссылка на файл без
Project-а в обоих файлах. Test «ссылка с текстом-адресом — без host-а» зелёный и до правки; он краснеет на mutant-е,
который убирает проверку того же host-а в `linkHost`. Test-ы assistant-panel, assistant-speech, markdown,
markdown-github, autolink-edges, pr-inbox-comment-body, pr-inbox-view и пять contract-тестов Assistant-а (12 файлов,
283 test-а) — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, green.
e2e локально не запускали (правило владельца); `test/e2e/assistant.spec.ts` сверяет текст сообщений через
`toContainText`, который Markdown не ломает: в словах introduction нет разметки.

## Проверить себя

1. Ссылка из процитированного Slack называет Jira, а ведёт на чужой сайт. Что увидит человек до щелчка?
   - Ответ: рядом со ссылкой приглушённо стоит настоящий host, «(evil.example)»: текст ссылки — адрес другого host-а,
     и `linkHost` возвращает host цели; `AssistantWords` включает это через `showLinkHost`.
   - Строки: `src/renderer/markdown/links.ts:102-123`, `src/renderer/assistant/parts.tsx:25-31`
2. Зачем пузырю `min-width: 0`, если у блока кода уже есть `overflow-x: auto`?
   - Ответ: flex-элемент по умолчанию не уже своего min-content; без `min-width: 0` длинная строка кода растянула бы
     пузырь сверх `max-width: 88%`, и прокрутка не включилась бы.
   - Строки: `src/renderer/assistant/assistant.css:726-728`, `src/renderer/assistant/assistant.css:792-796`
3. Почему сообщение пользователя не идёт через Markdown?
   - Ответ: Session view рисует строку пользователя как обычный текст, и Ticket велит следовать ему.
   - Строки: `src/renderer/assistant/AssistantPanel.tsx:352-357`

## 9. Что нашёл review и что осталось

> VERIFIED — worfy-polish 162 (the Assistant's chat messages and the morning summary render as Markdown through the shared Session-view renderer; user messages stay plain text; raw HTML stays text, images show their alt, only http(s) links act, and in the Assistant a link whose text is not its own address shows its real host), head 5c83102c9163b5bbd7d90968da7b0dfd89c46797
>
> Gate (depth medium, two rounds):
> - Round 1, reviewer (lens: correctness and safety of outside text) — FIX.
>   - med: a quoted link could name one address and open another. `[https://jira.example/SHOP-12](https://evil.example/steal)` and reference-style links both did this, and the docs and the test claimed that quotes act on nothing.
>   - low: a file link without a Project looked live but did nothing.
>   - Checked fine:
>     - no rehype-raw;
>     - script and img onerror stay text;
>     - images load nothing;
>     - javascript:, file:, data: and mailto: links are inert;
>     - removing pre-wrap breaks no existing message;
>     - the e2e spec still matches;
>     - 5 of the 7 new tests fail on the old code;
>     - a mutation that renders img turns a test red.
> - Fix 5c83102c9:
>   - a showLinkHost option in Markdown.tsx with linkHost in links.ts:102-123, on only in AssistantWords;
>   - a file link without a Project is inert;
>   - docs, comment and test name corrected;
>   - 4 tests red first.
> - Round 2: the renderer diff read by the orchestrator. The Session view is unchanged. The PR inbox gets only the inert file link. Closes the findings.
> Evidence:
> - 12 test files (283 tests), exit 0;
> - lint and typecheck, exit 0;
> - gate fast green;
> - story-check, exit 0.
> Not verified: the look in real Electron (owner rule); the owner's manual item 4.
