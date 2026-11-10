# 104 — Pull requests: комментарии review показаны как markdown GitHub

Type: feature
Status: claimed 2026-11-10T22:39Z
Branch: worfy-polish/104
Blocked by: —
Source: владелец 2026-11-11: «парсинг маркдауна, чтобы как в гитхабе все было» (бриф Orchestrator-а).

## Что происходит

В view Pull requests тело комментария review — простой текст (`<p className="w-pr-inbox-comment__body">`): видны
сырые `**жирный**`, обратные кавычки, `- ` списки, абзацы сливаются. Так же показаны комментарии, на которые отвечает
черновик ответа, и текст уже отправленного ответа (`DraftThread.tsx`). На GitHub те же тексты читаются как markdown.

## Что делаем

1. Тело комментария в карточке PR и в черновике ответа (комментарии, на которые он отвечает, и текст отправленного
   ответа) рендерит единственный markdown-renderer приложения `src/renderer/markdown/Markdown.tsx` (remark-gfm).
   Второй библиотеки markdown нет. Поле редактирования черновика остаётся текстовым полем; диалог Send all
   показывает текст как он будет отправлен, без рендера.
2. GitHub-flavoured: жирный, курсив, зачёркнутый, inline code, абзацы, списки (вложенные, нумерованные), цитаты,
   блоки кода (подсветки синтаксиса в renderer-е нет — блок кода без неё), таблицы, task list (только чтение),
   заголовки размером под комментарий, горизонтальная линия. Одиночный перевод строки — перенос строки, как в
   комментариях GitHub.
3. Особенности GitHub — только при opt-in prop `github` у `Markdown` (текст агентов в остальных местах не меняется):
   - блок ```` ```suggestion ```` — подписанный блок «Suggested change», строки как добавленные строки diff-а;
     пустой блок — «удалить строки»;
   - `@login` — выделенное упоминание, ссылка на `https://github.com/<login>` (команда `@org/team` — на страницу
     команды);
   - `#123` — ссылка на issue/PR в репозитории самого PR (`https://github.com/<repo>/issues/123`, GitHub сам
     переводит на PR), `owner/name#123` — в том репозитории; в коде и внутри ссылок — не трогаются;
   - полные адреса GitHub остаются ссылками; HTML-комментарии `<!-- … -->` скрыты, как на GitHub.
4. Безопасность (решение Orchestrator-а, сказано владельцу): сырой HTML не рендерится и не выполняется — виден
   текстом (`<details>`, `<sub>` GitHub-а превращаются в текст); картинки не грузятся — картинка становится
   ссылкой с alt-текстом, без запроса в сеть из renderer-а. Ссылки открываются только через `shell.openExternal`
   (http/https), как остальные ссылки markdown.
5. Компактный стиль внутри карточки комментария: поля, горизонтальная прокрутка у блоков кода и таблиц, перенос
   длинных слов и адресов, обе темы.

## Готово, когда

- [ ] Тело комментария review и conversation в карточке PR — markdown GitHub: каждый тип элемента из п. 2 проверен
      unit test-ом (jsdom render).
  - evidence: test-run pass · `pnpm test test/unit/markdown-github.test.tsx test/unit/pr-inbox-view.test.tsx` exit 0 · mac - · a50a265cc
- [ ] Комментарии, на которые отвечает черновик, и текст отправленного ответа в `DraftThread` — тот же рендер;
      поле редактирования — textarea; unit test.
  - evidence: test-run pass · `pnpm test test/unit/draft-thread.test.tsx` exit 0 · mac - · a50a265cc
- [ ] Блок suggestion, `@login`, `#123` и `owner/name#123`, отсутствие ссылок в коде — unit test-ы; без prop `github`
      `Markdown` рендерит как раньше — unit test.
  - evidence: test-run pass · `pnpm test test/unit/markdown-github.test.tsx test/unit/markdown.test.tsx` exit 0 · mac - · a50a265cc
- [ ] Сырой HTML виден текстом, `<img>`/`<script>` не создаются; картинка — ссылка с alt-текстом, `<img>` нет и
      `fetch` не вызывается — unit test; клик по ссылке идёт в `shell.openExternal`.
  - evidence: test-run pass · `pnpm test test/unit/markdown-github.test.tsx` exit 0 · mac - · a50a265cc
- [ ] e2e spec Pull requests: комментарий с markdown показан жирным, списком и блоком кода. Запускается только в CI
      (локальный e2e не запускать: окна Electron забирают фокус).
- [ ] Снимки карточки комментария с настоящим CSS в headless Chromium: светлая и тёмная тема.
- [ ] Страница `docs/features/pr-inbox.md` описывает рендер комментариев.
  - evidence: commit pass · Pull requests: render comments as GitHub-flavoured markdown (worfy-polish 104) · - - · a50a265cc
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `src/renderer/markdown/Markdown.tsx` — opt-in prop `github`, блок suggestion, картинка-ссылка.
- `src/renderer/markdown/github.ts` (новый) — remark plugin: упоминания, `#N`, картинки как ссылки, HTML-комментарии.
- `src/renderer/markdown/markdown.css` — стиль `.w-md--github`.
- `src/renderer/pr-inbox/CommentBody.tsx` (новый) — тело комментария через `Markdown`.
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/DraftThread.tsx`, `src/renderer/pr-inbox/pr-inbox.css`.
- `test/unit/markdown.test.tsx`, `test/unit/markdown-github.test.tsx` (новый), `test/unit/pr-inbox-view.test.tsx`,
  `test/unit/draft-thread.test.tsx`, `test/e2e/pr-inbox.spec.ts`.
- `docs/features/pr-inbox.md`.

## Вне скоупа

- Подсветка синтаксиса в блоках кода (её нет во всём приложении).
- Рендер `<details>`, `<sub>` и другого HTML GitHub-а; загрузка картинок.
- Предпросмотр markdown в поле редактирования черновика.
