# 162 — Markdown в чате Assistant-а

Type: bug
Status: claimed 2026-11-26T21:14Z
Branch: worfy-polish/162
Blocked by: —
Source: замечание владельца 2026-11-26 («В чате не хватает парсинга маркдауна», снимок экрана раздела Assistant, вкладка
Chat).

Кто: агент.

## Что происходит

Раздел Assistant в sidebar, вкладка Chat. Утреннее сообщение Assistant-а показано сырым текстом: видны `**Главное: …**`,
обратные кавычки вокруг `open` и `loop-log`, строки списка с `- ` в начале.

Причина в коде (origin/main 610e0230d): `Chat` в `src/renderer/assistant/AssistantPanel.tsx` кладёт `message.text` в
`<span className="w-asst-text">` как есть, а `.w-asst-bubble` держит `white-space: pre-wrap`. Утренняя сводка на вкладке
Summary (`<p className="w-asst-text">`) — так же. Session view рисует текст ассистента общим renderer-ом
`src/renderer/markdown/Markdown.tsx` (react-markdown + remark-gfm), чат Assistant-а его не использует.

## Что строить

1. Сообщения Assistant-а в чате — Markdown общим renderer-ом `Markdown.tsx` с `breaks`, как текст ассистента в Session
   view (`src/renderer/session/Transcript.tsx`): жирный и курсив, код в строке и блоком, списки, заголовки, ссылки,
   таблицы (remark-gfm их умеет). Второй библиотеки Markdown нет.
2. Ссылки — как в Session view: http(s):// открывается в браузере через `shell.openExternal`, окно приложения никуда не
   переходит; `javascript:`, `file:`, `data:` — текст без действия.
3. Сырой HTML остаётся текстом, картинки Markdown не загружаются (правила `Markdown.tsx`). Это важно: Assistant цитирует
   чужой текст из Slack и Jira (блок outside-text JSON, worfy-assistant 09), и такая цитата попадает в текст его
   сообщения.
4. Сообщения пользователя — обычный текст: Session view рисует свои сообщения пользователя тоже без Markdown.
5. Одно правило на все места раздела: текст, который Assistant пишет сообщением (чат, утренняя сводка на Summary), —
   Markdown; однострочные подписи (заголовок и «почему» карточки, строки Journal, чипы, speech card у rail) — обычный
   текст. Speech card (`AssistantSpeech.tsx`) показывает только шапку карточки, поэтому не меняется; его логику закрытия
   правит polish 161.
6. Стили под узкую панель: плотные отступы, блок кода прокручивается по горизонтали внутри пузыря, широкая таблица тоже,
   ничего не выходит за панель.

## Где в коде

- `src/renderer/assistant/AssistantPanel.tsx` — `Chat` и `Summary`.
- `src/renderer/assistant/parts.tsx` — общий кусок «текст сообщения Assistant-а».
- `src/renderer/assistant/assistant.css` — стили текста сообщения.
- Test: `test/unit/assistant-panel.test.tsx`.
- `docs/features/assistant.md` — строка о Markdown в чате (только английская страница).

## Test-ы

- сообщение Assistant-а с жирным, кодом в строке, списком и ссылкой: в DOM есть `strong`, `code`, `li`, `a`; щелчок по
  ссылке зовёт `shell.openExternal` и не переводит окно;
- сырые `<img onerror>` и `<script>` в сообщении — текст: элементов `img` и `script` нет, код не выполнился;
- цитата чужого текста (Slack) с HTML, картинкой Markdown и ссылкой `javascript:` — без действия: нет `img`, нет `a`
  с таким адресом, обработчик не выполнился;
- утренняя сводка на Summary — тем же renderer-ом; сообщение пользователя — обычный текст;
- правила `assistant.css` (файл читается как текст): у текста сообщения нет `pre-wrap`, у блока кода и таблицы —
  горизонтальная прокрутка;
- test-ы красные до правки.

## Готово, когда

- [ ] Сообщения Assistant-а в чате и утренняя сводка на Summary нарисованы как Markdown общим renderer-ом; ссылки
      открываются в браузере; сырой HTML и чужой текст без действия; сообщения пользователя — обычный текст.
- [ ] Unit test-ы в `test/unit/assistant-panel.test.tsx` проверяют разметку, безопасность сырого HTML и чужого текста и
      правила стилей; красные до правки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на head PR.
- [ ] (вручную) Владелец смотрит вкладку Chat раздела Assistant в Stable copy: утреннее сообщение с жирным, кодом и
      списком нарисовано как Markdown, блок кода не выходит за панель.
  - needs: mac stable
