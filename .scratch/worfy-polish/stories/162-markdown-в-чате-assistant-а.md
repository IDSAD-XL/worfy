# Code story — worfy-polish 162: Markdown в чате Assistant-а

Kind: pr · Epic: worfy-polish · Ticket: 162 · PR: - · Language: ru

## 1. Что было не так

Вкладка Chat раздела Assistant показывала текст Assistant-а сырым: `**Главное: …**`, обратные кавычки вокруг `open`,
строки списка с `- `. `Chat` клал `message.text` в `<span>` как есть, утренняя сводка на Summary — в `<p>`, а пузырь
держит `white-space: pre-wrap`. Session view тот же текст ассистента рисует общим renderer-ом `Markdown.tsx`.

- Требование: [Что происходит](../issues/162-markdown-в-чате-assistant-а.md#что-происходит)

## 2. Один кусок «текст сообщения Assistant-а» на общем renderer-е

Code: `src/renderer/assistant/parts.tsx:24-30` · key lines: 26, 27

```tsx
export function AssistantWords({ text }: { text: string }): ReactElement {
  return (
    <div className="w-asst-text w-asst-md">
      <Markdown text={text} breaks />
    </div>
  )
}
```

- Что делает: рисует текст Assistant-а компонентом `Markdown` из `src/renderer/markdown/Markdown.tsx` с `breaks`, как
  `Transcript.tsx` рисует ответ ассистента. Без `projectId`: относительная ссылка не называет файл Project-а и ничего не
  открывает.
- Почему здесь: Ticket называет `parts.tsx` в «Где в коде» как место общего куска; один компонент держит одно правило
  для Chat и Summary.
- Без него: второй способ рисовать текст в Summary и Chat, и правило «что Markdown, что нет» разошлось бы.
- Требование: [Что строить, п. 1, 5](../issues/162-markdown-в-чате-assistant-а.md#что-строить)
- Риски и пробелы test-ов: сырой HTML, картинки и опасные ссылки гасит сам `Markdown.tsx` (без rehype-raw,
  `img` — alt-текст, `classifyLink` пускает только http(s)://); правка эти правила не меняет, test-ы панели их
  проверяют на тексте Assistant-а.

## 3. Chat: сообщение Assistant-а — Markdown, сообщение пользователя — текст

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

## 4. Стили под узкую панель

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

## 5. Что сознательно не меняли

Speech card у rail (`AssistantSpeech.tsx`) показывает только шапку карточки — заголовок, «почему», чипы, источник — и
не менялся; его логику закрытия правит polish 161. Заголовок и «почему» карточек, строки Journal, правила — однострочные
подписи, остаются текстом. Второй библиотеки Markdown нет, `Markdown.tsx` и `markdown.css` не правились.

## 6. Как проверено

Пять новых test-ов в `test/unit/assistant-panel.test.tsx` были красными до правки; два (сырой HTML и сообщение
пользователя) — защитные, зелёные и до правки, потому что сырой текст и так ничего не исполнял. Test-ы renderer-а
Assistant-а и общего Markdown (12 файлов, 208 test-ов, unit и contract) — exit 0; `pnpm lint`, `pnpm typecheck` — exit 0.
e2e локально не запускали (правило владельца); `test/e2e/assistant.spec.ts` сверяет текст сообщений через
`toContainText`, который Markdown не ломает: в словах introduction нет разметки.

## Проверить себя

1. Почему чужой текст из Slack, процитированный Assistant-ом, не может вставить картинку-маячок или ссылку `javascript:`?
   - Ответ: текст идёт через общий `Markdown`: HTML без rehype-raw остаётся текстом, `img` заменён alt-текстом, а
     ссылка не на http(s):// рисуется как span без действия.
   - Строки: `src/renderer/assistant/parts.tsx:24-30`
2. Зачем пузырю `min-width: 0`, если у блока кода уже есть `overflow-x: auto`?
   - Ответ: flex-элемент по умолчанию не уже своего min-content; без `min-width: 0` длинная строка кода растянула бы
     пузырь сверх `max-width: 88%`, и прокрутка не включилась бы.
   - Строки: `src/renderer/assistant/assistant.css:726-728`, `src/renderer/assistant/assistant.css:792-796`
3. Почему сообщение пользователя не идёт через Markdown?
   - Ответ: Session view рисует строку пользователя как обычный текст, и Ticket велит следовать ему.
   - Строки: `src/renderer/assistant/AssistantPanel.tsx:352-357`
