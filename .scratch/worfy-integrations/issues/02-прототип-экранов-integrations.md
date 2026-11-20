# 02 — Прототип экранов: раздел Integrations, Add integration, вход, строка Integration, фильтр tools, chip и Settings → Integrations

Type: prototype
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 2; «Волны», Wave 1; «Решение» (пункты 1–5, «Как пользователь идёт по
экранам», «Экран (набросок)»); «Решено без владельца», 2 и 5; «Вопросы владельцу», Q2, Q4, Q6, Q7, Q9

Кто: агент.

Не платформенный Ticket (Card, кода нет). Глубина ревью — `low`.

## Что происходит

- Добавить MCP-сервер из worfy сегодня нельзя; набросок экрана — ASCII в spec-е («Решение» → «Экран (набросок)»).
  Ticket-ы 08 и 09 строят экран, и им нужен образец вида, а не только схема.
- Прототипы экранов worfy — Card: HTML-файл в папке данных Project-а, его показывает Node Card
  (`docs/features/cards.md`); образец — `.scratch/worfy-pr-review/issues/01-*.md`.
- Тексты UI английские: «UI copy is ENGLISH» (`docs/design/BRIEF.md:4`; ADR-0017).
- Каталог первой версии («Решено без владельца», 5): Jira and Confluence (Atlassian), Linear, Notion, Sentry, GitHub,
  Figma (с пометкой «may refuse worfy»), Custom server. Slack в каталоге нет (Q6).

## Что делаем

1. Card «Prototype: Integrations» на Canvas Project-а worfy через Card API или tool `create_card` сервера
   worfy-canvas. Данные выдуманы: Project-ы `client-a-app` и `client-b-app`, site-ы `client-a.atlassian.net`,
   `client-b.atlassian.net`, аккаунты `a…@client-a.com`, `b…@client-b.com`.
2. Project settings → Integrations: группы «worfy integrations» и «From Claude Code»; строки Integration в состояниях
   signed in, Sign-in needed, error (текст сервиса), checking; «41 tools · ~9k tokens»; меню «…» (Test, Re-sign in,
   Rename, Sign out, Disable in this Project, Remove from Machine); предупреждение «two Jira tool sets» у connector-а
   claude.ai Atlassian и действие «Add as integration» (Q9).
3. Окно Add integration: каталог с «Sign in» или «API token» у каждого сервиса, строка «Use in this Project: Jira —
   client A (used in 2 Projects)» сверху (Q2); поля Label и способ входа; ввод API token-а (e-mail и token, ссылка на
   страницу token-ов); Custom server — адрес `https://…` или команда stdio (command, args, env, флажок Secret у
   переменной); у Atlassian API token — пометка «works only if your organization admin turned on API token sign-in».
4. Окно входа worfy со страницей входа сервиса (заглушка) и ссылкой «Open in system browser» (Q4).
5. Фильтр Tools: All, Read only, Choose… со списком tools и размером; Read only недоступен у сервиса без
   `readOnlyHint`, с причиной. Галочки Available to Autopilot (выключена по умолчанию, Q7) и Enabled in this Project.
6. Строки chip-а «MCP n/m» Session: Integration с источником «worfy integration», меткой и кнопкой Sign in в состоянии
   Sign-in needed.
7. Settings → Integrations: все Integration-ы Machine, где каждая используется, Sign out, Remove.
8. Кнопки на Card-е переключают состояния; логики нет. Цвета — tokens темы worfy, обе темы.
9. В «Итог»: id Card-а, список состояний и снимки экрана для брифов Ticket-ов 08 и 09 (снимки — в scratchpad, в
   репозиторий не кладутся).

## Готово, когда

- [ ] Card «Prototype: Integrations» открывается на Canvas Project-а и показывает все состояния из «Что делаем», 2–7,
      в светлой и тёмной теме; в консоли Card-а нет ошибок.
- [ ] Данные выдуманы: `grep -inE "canvasforai|idsad|src/main|src/renderer" <card>/index.html` не находит
      настоящих путей, имён и адресов.
- [ ] В каталоге Card-а нет Slack (Q6): `grep -ic slack <card>/index.html` — 0.
- [ ] В «Итог» — id Card-а и состояния; брифы Ticket-ов 08 и 09 ссылаются на него.

## Где в коде

Кода нет: Card лежит в папке данных Project-а (`docs/features/cards.md`), файлов репозитория Ticket не меняет.

Только читать: `docs/design/BRIEF.md`, `src/renderer/theme/tokens.css`, `src/renderer/shell/ProjectSettings.tsx`,
`src/renderer/session/McpChip.tsx`, `src/renderer/settings/` (как выглядят окна сейчас).

## Вне скоупа

- Код экрана — Ticket-ы 08 и 09.

## Итог

Пусто до завершения Ticket-а.
