# Рынок приложений для параллельной работы агентов: кто делает то же, что worfy

- **Дата:** 2026-11-08, main `db89e600d`. Все источники прочитаны 2026-11-08. Цены — в USD в месяц на эту дату.
- **Ticket:** [03](issues/03-рынок-приложений-для-параллельных-агентов.md) темы `roadmap-worfy` — этот обзор рынка;
  карта — [map.md](map.md).
- **Статус:** исследование, не решение. Ticket-ов не заводит.
- **Вопрос.** Кто на ноябрь 2026 делает то же или похожее, что worfy, сколько это стоит, что из возможностей worfy
  Anthropic и OpenAI уже дают сами и на что жалуются пользователи?
- **Соседние заметки.** Продуктовые советники — в [рынке продуктовых советников](../../research/2026-11-07-рынок-продуктовых-советников.md),
  здесь их нет. Правила входа подпиской и история блокировок сторонних приложений — в
  [правилах входа для внешних пользователей](research-правила-входа-для-внешних-пользователей.md), здесь только ссылки.
- **Ответ коротко.**
  - **Параллельные Session-ы в worktree платформы уже дают сами.** Claude Code Desktop, Codex в ChatGPT desktop, GitHub Copilot
    app, Cursor 3, Antigravity 2.0 и Devin Desktop запускают много агентов параллельно в worktree, показывают diff,
    открывают PR, держат terminal и browser рядом. Всё это входит в обычные подписки, от бесплатных до $200.
  - **Anthropic идёт и в оркестрацию.** Dynamic workflows запускают десятки и сотни Subagent-ов по скрипту и ждут сброса
    лимита. Projects раздают поток задач параллельным облачным Session-ам. Agent view показывает все фоновые Session-ы.
    Есть расписание, Remote Control и облачный review.
  - **Сторонние приложения закрываются или меняются.** Conductor уходит в Meta (2026-11-04). Компания Vibe Kanban
    закрылась (2026-04-10). Terragon закрыт, Crystal заменён Nimbalyst, Superset стал Paradev. Google закрывает Jules
    2026-12-31. Остаются open source-проекты и те, кто продаёт командам и облако.
  - **Canvas есть у многих, сочетания worfy нет ни у кого из просмотренных.** Agor, OpenCove, Horizon, Whiteboard, Cate
    и Maestri кладут Session-ы, terminal-ы или browser на 2D-плоскость. Ближе всех к Autopilot — Maestro (Auto Run по
    markdown-чеклистам) и Emdash (задача → PR → CI, расписание с историей). Никто не соединяет Ticket-файлы, волны,
    локальный gate до PR, merge, очередь Epic-ов с учётом недельных лимитов и историю run-ов.
  - **Главные жалобы:** лимиты сгорают от параллельных агентов; вендоры ограничивают вход подпиской в чужих
    инструментах; приложения выходят сначала для Mac; desktop-приложения тяжёлые и теряют Session-ы; человек не успевает
    ревьюить; инструменты закрываются.
- **Как проверено.** Четыре research-агента читали страницы вендоров (docs, changelog, цены, блоги), GitHub (`gh api`:
  звёзды, релизы, последний push) и HN (Algolia API). Я сам перечитал docs Claude Code Desktop, workflows, agent view и
  Projects, анонс Conductor, changelog Copilot app, блог Cursor о SpaceX, changelog Jules, цены Paradev, закрытие Vibe
  Kanban и «What's new» Codex. Horizon, Whiteboard и цифры HN собрал сам. Остальное — по чтению агентов, мной не
  перечитано. Что не открылось — раздел 6.

## 1. С чем сравниваем: worfy сегодня

По [README](../../../README.md) и [docs/features](../../features/README.md):

- Desktop-приложение на Electron для macOS и Windows x64. Пакета для Linux нет. Скачать нельзя: сборка из исходников,
  без подписи, без лицензии.
- На Canvas проекта: Session-ы Claude Code и Codex с их Subagent-ами, Terminal с Terminal AI, Browser (им управляют и
  человек, и Session), Card (маленькое HTML-приложение от агента), Epic frame с Ticket-ами.
- Orchestrator-Session (Session, которая раздаёт Ticket-ы агентам) ведёт Epic из markdown Ticket-ов волнами — группами
  Ticket-ов, готовых к работе одновременно: worktree на Ticket, локальный gate (lint и test), PR на GitHub, merge.
- Autopilot ведёт Epic или очередь Epic-ов без человека: ждёт сброса лимитов, повторяет запрос после ошибки API, умеет
  режимы Budget-aware (дневной бюджет лимитов) и Start window (новые волны только в заданные часы). Flight Recorder и
  Work track показывают историю run-ов.
- Linked machine: второй компьютер по 6-значному коду в LAN, снаружи — через Tailscale. Product Session — советник с
  Mind map.
- Вход только подпиской: Claude Code обязателен, Codex по желанию, API key не принимается.
- Чего нет (по docs/features): облака, телефона, Linux, своего экрана diff, общей работы нескольких людей, агентов кроме
  Claude Code и Codex, запуска по событиям (cron, GitHub).

## 2. Что дают сами Anthropic, OpenAI и другие платформы

Одна строка — один продукт. Колонки «Общее», «Есть у worfy» и «Есть у него» — мои выводы по описаниям вендоров и
docs/features worfy.

| Продукт | Что делает | Цена | Общее с worfy | Есть у worfy, нет у него | Есть у него, нет у worfy |
|---|---|---|---|---|---|
| **Claude Code Desktop**, вкладка Code (Anthropic; macOS, Windows, Linux beta) | С 2025-11-24, переделан под параллельную работу 2026-04-14. Session-ы в sidebar и split view; worktree — переключатель на Session, по умолчанию выключен; diff с комментариями к строкам; Create PR, статус CI, Auto-fix, Merge when ready; Browser pane с dev server; Session локально, по SSH, в WSL или в облаке; mods рисуют свои панели | Входит в Pro $20, Max $100, Ultra $200 (бывший Max 20x), Team $20–125 за место, Enterprise | Параллельные Session-ы Claude Code, worktree, PR, browser рядом с агентом | Canvas, Epic из Ticket-ов волнами, gate до PR, Autopilot, Codex рядом, Cards, Flight Recorder | Экран diff, облако, SSH и WSL, Linux, computer use, запуск с телефона (Dispatch) |
| **Cloud sessions и Projects** (бывший Claude Code on the web) | Session в VM Anthropic; запуск с claude.ai/code, из приложений iOS и Android, из desktop или `claude --cloud`; clone и PR только с GitHub; `claude --teleport` переносит Session в terminal. Projects (public beta с 2026-09-17): одна беседа ведёт поток задач и запускает на каждую параллельную облачную Session на своей ветке | VM без доплаты, расход из лимитов плана; Projects — Pro, Max, Ultra | Беседа-оркестратор раздаёт задачи параллельным Session-ам — как Orchestrator-Session с волнами | Работа на своей машине с её окружением, gate, Ticket-ы как файлы в репозитории, Codex | Работа при закрытом ноутбуке, управление с телефона |
| **Remote Control** (с 2026-02-24) | Session работает на твоей машине, а управляется с claude.ai/code или телефона; `claude remote-control --spawn worktree` даёт каждой Session свой worktree, до 32 Session-ов | Pro, Max, Ultra, Team, Enterprise; с API key не работает | Работа с Session-ами своей машины с другого устройства — как Linked machine | Весь Canvas другой машины, Autopilot на ней | Телефон и браузер через облако Anthropic, без LAN и Tailscale |
| **Subagents, agent teams, dynamic workflows, agent view** | Subagent по умолчанию в фоне, может получить свой worktree; `/batch` делит правку на 5–30 Subagent-ов. Agent teams (experimental): lead и teammates с общим task list. Dynamic workflows: Claude пишет JS-скрипт на десятки и сотни Subagent-ов (16 одновременно, можно до 256; 1000 за run), без ввода посреди run-а; при лимите подписки run ждёт сброса и продолжает; run можно возобновить и сохранить как команду. Agent view (`claude agents`, research preview; в issues зовётся FleetView): один экран всех фоновых Session-ов, у каждой worktree и статус PR | Входит в платные планы; на Pro workflows включаются в `/config`; расход заметно выше обычного | Оркестрация многих агентов, ожидание сброса лимитов как у Autopilot, обзор всех Session-ов | Ticket-ы — файлы в репозитории, волны, gate, PR и merge, Canvas, Run history, Codex | Сотни агентов за run, повторяемые сохранённые workflows, всё внутри CLI и desktop |
| **Фоновые и плановые задачи, облачный review** | `Ctrl+B` уводит команду или агента в фон. Scheduled tasks в облаке (бывшие routines, research preview с 2026-04-14): по расписанию, по API POST или событию GitHub, до 100 run-ов в час. `/loop` повторяет prompt до 7 дней. `/code-review ultra`: группа reviewer-агентов в облачной sandbox. Managed Code Review для PR: общедоступен (GA) с 2026-10-15, Team и Enterprise | Ultrareview: 3 run-а бесплатно, потом обычно $5–25; Code Review в среднем $15–25 за review, из usage credits | Работа без человека, review агентами | Локальный gate, Team reviewer (review-skill в голосе команды), очередь Epic-ов | Запуск по расписанию и событиям в облаке, review PR в облаке |
| **Claude Code GitHub Actions** (`anthropics/claude-code-action`) | `@claude` в issue и PR, prompt на любое событие GitHub, включая cron; issue → PR. 9,854★, v1.0.269 от 2026-11-06 | Минуты Actions плюс токены; вход API key или токеном подписки | Ticket → PR | Canvas, волны, gate до PR, Codex | Работа в CI без своей машины |
| **Codex в ChatGPT desktop** (OpenAI) | Приложение Codex: macOS 2026-02-02, Windows 2026-03-04; 2026-07-09 слито в ChatGPT desktop; Linux preview с 2026-08-11. Параллельные чаты в worktree; Automations (GA в марте 2026; локальные требуют включённого компьютера, облачные — по событиям Gmail, Slack, GitHub); skills и plugins; terminal; browser и desktop-приложения; `/review` с diff. Перенос в облачное окружение не поддержан | В планах ChatGPT: Free $0, Go $8, Plus $20, Pro $100/200/500, Business $20–25 за место; сверх лимита — credits | Параллельные агенты в worktree, terminal, browser, расписание | Claude Code рядом, Canvas, волны Ticket-ов, gate, PR и merge, Autopilot | Linux, экран diff, Automations по событиям, работа с desktop-приложениями |
| **Codex cloud, IDE, CLI** | Облачная задача в своём workspace (Plus 2 vCPU/8 GB, Pro и выше 4/16) работает при спящем компьютере; PR; best-of-N до 4 (`codex cloud exec --attempts`). IDE extension: VS Code, Cursor, Windsurf. Review PR на GitHub, `@ChatGPT` в Slack, issue в Linear. CLI open source: 133,792★, rust-v0.167.0 от 2026-11-06 | В планах ChatGPT | Задача → PR | Локальный gate, Canvas, Claude Code | Best-of-N, облако, Slack и Linear |
| **Cursor 3** (с 2026-08-14 принадлежит SpaceX) | Agents Window (3.0, 2026-04-02): много агентов локально, в worktree, в облаке, по SSH; агента можно перенести из облака на машину и обратно. Cloud Agents в VM: запуск из iOS, web, desktop, Slack, GitHub, Bitbucket, Linear, API; PR «merge-ready»; automations по расписанию и событиям; Bugbot. С 2026-10-16 облачные агенты строят интерактивные canvases | Free $0 и Plus $8 — только модели Grok, без cloud agents; Premium $30, Super $100, Ultra $200; Teams от $30 за место; чужие модели на Premium и выше — по ценам API | Много агентов, worktree, интерактивные артефакты агента — как Cards | Claude Code и Codex на их подписке, Canvas, волны Ticket-ов, gate, Autopilot | IDE, облако, SSH, интеграции, best-of-n |
| **GitHub Copilot app, cloud agent, Agent HQ** | Copilot app (GA 2026-06-17; macOS, Windows, Linux): параллельные Session-ы по репозиториям, у каждой своя ветка и worktree; diff; встроенные terminal и browser; canvases, общие для человека и агента; облачные automations. Cloud agent: issue → draft PR в облачной sandbox. Agent HQ: агенты Claude и Codex прямо в GitHub (public preview) | Free $0, Pro $10, Pro+ $39, Max $100, Business $19, Enterprise $39 за место; с 2026-06-01 AI Credits по токенам. Copilot app на GA — Business и Enterprise, сейчас docs: «all Copilot plans». Claude и Codex в Agent HQ — без отдельной подписки | Параллельные Session-ы в worktree, terminal, browser, canvases, Claude и Codex в одном месте | Canvas проекта, волны Ticket-ов, gate, Autopilot, прямые подписки Anthropic и OpenAI | Linux, облако, мобильный клиент, issues и Actions рядом |
| **Google Antigravity 2.0** (Jules закрывается) | С 2026-05-19 отдельное desktop-приложение Agent Manager: много автономных агентов параллельно по разным проектам; Scheduled Tasks, в v2.29.0 — Automations; remote agents для AI Pro и Ultra с 2026-11-03; macOS, Windows, Linux. Jules: Session-ы до 2026-11-11, потом read-only, закрытие 2026-12-31 | Free $0 с недельными лимитами; Google AI Pro $19.99, Ultra $99.99 (5x) или $200 (20x); Business через Google Cloud от $30 за место | Много агентов параллельно, расписание | Claude Code и Codex, Canvas, gate, волны Ticket-ов | Бесплатный план, Linux, удалённые агенты, модели Gemini |

- **Другие с экраном многих агентов.** Devin Desktop (так с 2026-06-02 называется Windsurf): kanban всех локальных и
  облачных агентов, Pro $20. Zed: Parallel Agents, у каждого thread свой worktree (с 2026-04-22), Pro $10. JetBrains Air:
  несколько проектов со своими Session-ами, AI Pro $20 (цена только из поиска). Kiro: autonomous agent до 10 задач
  одновременно и Kiro Crew, Pro $20. Warp Oz (Claude Code, Codex и Warp Agent в облаке) и Factory Missions — только по
  тексту поиска, от $20. Amp: «orbs», облачные компьютеры для агента, $20.
- **Для разработчиков на API** у Anthropic есть Claude Managed Agents (beta): агент работает в инфраструктуре Anthropic.
- **Цифры платформ.** Claude Code: годовой темп выручки больше $2.5 млрд (пост Anthropic 2026-02-12); более поздних
  цифр по Claude Code Anthropic не давала. Codex: больше 5 млн активных пользователей в неделю (OpenAI, 2026-06-02;
  только по тексту поиска).

Источники:
- Claude Code Desktop: <https://code.claude.com/docs/en/desktop>, <https://code.claude.com/docs/en/desktop-linux>, <https://www.anthropic.com/news/claude-opus-4-5>, <https://claude.com/blog/claude-code-desktop-redesign>, <https://code.claude.com/docs/en/plugins/mods/overview> — 2026-11-08.
- Cloud sessions и Projects: <https://claude.com/blog/claude-code-on-the-web>, <https://code.claude.com/docs/en/claude-code-on-the-web>, <https://code.claude.com/docs/en/cloud-environments>, <https://code.claude.com/docs/en/claude-projects>, <https://claude.com/blog/projects-redesigned> — 2026-11-08.
- Remote Control: <https://code.claude.com/docs/en/remote-control> — 2026-11-08.
- Оркестрация: <https://code.claude.com/docs/en/agents>, <https://code.claude.com/docs/en/sub-agents>, <https://code.claude.com/docs/en/agent-teams>, <https://code.claude.com/docs/en/workflows>, <https://claude.com/blog/introducing-dynamic-workflows-in-claude-code>, <https://code.claude.com/docs/en/agent-view>, <https://claude.com/blog/agent-view-in-claude-code> — 2026-11-08.
- Фоновые задачи и review: <https://code.claude.com/docs/en/interactive-mode>, <https://code.claude.com/docs/en/routines>, <https://code.claude.com/docs/en/scheduled-tasks>, <https://code.claude.com/docs/en/ultrareview>, <https://claude.com/blog/code-review>, <https://claude.com/blog/code-review-is-now-generally-available>, <https://code.claude.com/docs/en/code-review-costs> — 2026-11-08.
- GitHub Actions: <https://code.claude.com/docs/en/github-actions>, <https://github.com/anthropics/claude-code-action> — 2026-11-08.
- Цены и цифры Anthropic: <https://claude.com/pricing>, <https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan>, <https://support.claude.com/en/articles/12429409>, <https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation>, <https://platform.claude.com/docs/en/managed-agents/overview> — 2026-11-08.
- Codex: <https://community.openai.com/t/new-codex-app-have-you-tried-it-yet/1373156>, <https://community.openai.com/t/the-codex-app-is-now-on-windows/1375704>, <https://learn.chatgpt.com/docs/whats-new>, <https://learn.chatgpt.com/docs/environments/git-worktrees>, <https://learn.chatgpt.com/docs/automations>, <https://learn.chatgpt.com/docs/app>, <https://learn.chatgpt.com/docs/code-review>, <https://learn.chatgpt.com/docs/remote-connections>, <https://learn.chatgpt.com/docs/linux/linux-app>, <https://learn.chatgpt.com/docs/environments/cloud-environments>, <https://learn.chatgpt.com/docs/cloud>, <https://github.com/openai/codex/blob/main/codex-rs/cloud-tasks/src/cli.rs>, <https://learn.chatgpt.com/docs/ide>, <https://learn.chatgpt.com/docs/third-party/slack>, <https://learn.chatgpt.com/docs/third-party/linear>, <https://learn.chatgpt.com/docs/pricing>, <https://openai.com/index/codex-for-knowledge-work/> (только текст поиска) — 2026-11-08.
- Cursor: <https://cursor.com/blog/joining-spacex>, <https://x.ai/news/x-subscription>, <https://forum.cursor.com/t/introducing-the-x-subscription/174450>, <https://cursor.com/pricing>, <https://cursor.com/docs/cloud-agent>, <https://cursor.com/docs/cloud-agent/automations>, <https://cursor.com/changelog/3-0>, <https://cursor.com/docs/agent/agents-window>, <https://cursor.com/docs/configuration/worktrees>, <https://cursor.com/changelog>, <https://cursor.com/docs/bugbot> — 2026-11-08.
- GitHub: <https://github.blog/changelog/2026-06-17-github-copilot-app-generally-available/>, <https://docs.github.com/en/copilot/concepts/copilot-surfaces/github-copilot-app>, <https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github>, <https://github.blog/changelog/2026-10-28-work-from-anywhere-with-a-new-connected-copilot-cloud-experience/>, <https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/>, <https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/>, <https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents>, <https://docs.github.com/en/copilot/get-started/plans>, <https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/> — 2026-11-08.
- Google: <https://jules.google/docs/changelog/>, <https://jules.google/docs/usage-limits/>, <https://antigravity.google/blog/introducing-google-antigravity-2/>, <https://antigravity.google/product/antigravity-2/>, <https://antigravity.google/docs/changelog>, <https://antigravity.google/download>, <https://antigravity.google/pricing>, <https://one.google.com/intl/en_us/about/google-ai-plans/>, <https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/> — 2026-11-08.
- Остальные: <https://docs.devin.ai/desktop/devin-desktop-faq>, <https://devin.ai/blog/windsurf-is-now-devin-desktop>, <https://devin.ai/pricing>, <https://zed.dev/blog/parallel-agents>, <https://zed.dev/pricing>, <https://www.jetbrains.com/air/>, <https://kiro.dev/blog/introducing-kiro-autonomous-agent/>, <https://kiro.dev/crew/>, <https://kiro.dev/pricing/>, <https://www.warp.dev/pricing>, <https://ampcode.com/pricing>, <https://factory.com/pricing> — 2026-11-08.

## 3. Сторонние приложения

Звёзды, релизы и последний push — `gh api` 2026-11-08. TUI — интерфейс внутри terminal. YC — Y Combinator.

| Продукт | Что делает | Цена, лицензия, платформы | Активность на 2026-11-08 | Общее с worfy | Есть у worfy, нет у него | Есть у него, нет у worfy |
|---|---|---|---|---|---|---|
| **Conductor** (Melty Labs) | Claude Code, Codex, Cursor и OpenCode параллельно; на задачу свой workspace, ветка, terminal, diff, review, PR, merge; Conductor Cloud на microVM для нескольких людей; приложение для iPhone и remote control (0.90–0.92, октябрь 2026) | Локальное приложение бесплатно, со своей подпиской Claude Pro/Max или API key; Cloud — план Pro ($50 не проверено); closed source; только macOS | 0.93.0 от 2026-11-04: «Conductor is joining Meta», регистрация закрыта; локальное приложение получает модели и критичные фиксы «until early 2027»; Cloud read-only с 2026-11-13, выключение 2026-11-20 | Claude Code и Codex параллельно в worktree, PR, merge | Windows, Canvas, волны Ticket-ов, gate, Autopilot | Экран diff, облако, iPhone |
| **Claude Squad** | TUI: у каждого агента своя tmux-сессия и worktree; Claude Code, Codex, Gemini, Aider; experimental auto-accept для фона; review перед push | Бесплатно, AGPL-3.0; terminal, нужны tmux и gh, ОС в README не названы | v1.0.20 от 2026-08-20, тогда же последний push; 8,751★; issue «abandoned» | Worktree на агента | GUI, Canvas, волны Ticket-ов, gate, PR, Autopilot | Gemini и Aider, лёгкий TUI |
| **Nimbalyst** (Stravu; заменил Crystal в феврале 2026) | Визуальное пространство для Codex и Claude Code (OpenCode и Copilot в alpha): параллельные Session-ы в worktree, kanban Session-ов, diff, редакторы markdown, mockup, Mermaid, Excalidraw | Приложение $0, своя подписка, API key или локальная модель; Wiki Teams $20 за человека (в beta бесплатно); MIT; macOS, Windows 10+, Linux, iOS | v0.81.7 от 2026-10-16 (на сайте 0.82.3 от 2026-10-25); push 2026-11-04; 2,045★. Crystal: v0.3.5 от 2026-02-26, 3,129★ | Claude Code и Codex рядом, worktree, визуальное пространство, markdown | волны Ticket-ов, gate, Autopilot, Linked machine, Flight Recorder | Linux, iOS, kanban, экран diff, редакторы диаграмм |
| **Vibe Kanban** (BloopAI) | Kanban для 10+ агентов (Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode и другие) в worktree: планировать, запускать, ревьюить; `npx vibe-kanban` | Бесплатно, Apache-2.0; облако и Pro $30 сняты, страница цен висит с баннером «sunsetting»; web UI | Компания закрылась 2026-04-10, проект ведёт сообщество; v0.1.44 от 2026-04-24; push 2026-11-04; 28,620★ | Доска задач → агент в worktree → review | Ticket-ы — файлы в репозитории, волны, gate, Autopilot | Больше агентов, kanban в браузере |
| **Sculptor** (Imbue) | Desktop: параллельные агенты в изолированных worktree, слежение за PR, experimental Docker и remote backend; Pairing Mode переносит файлы агента в твой IDE; встроены Claude Code и Pi, работает любой terminal-агент | Свои API keys («free in beta» не проверено); MIT; macOS Apple Silicon, Linux; Windows «on the way» | v0.49.0 от 2026-10-21; push 2026-11-08; 246★ | Параллельные агенты в worktree, PR | Windows, Codex по подписке, Canvas, волны Ticket-ов, gate | Контейнеры, Pairing Mode, Linux |
| **Terragon** | Был облачным сервисом фоновых агентов (Claude Code, Codex, Amp, Gemini) в sandbox-контейнерах | Закрыт; код опубликован «as-is», Apache-2.0 | Snapshot 2026-01-16; push 2026-02-10; 261★ | Фоновые агенты → PR | — | — |
| **Paradev** (бывший Superset; YC, набор P26; seed $11.5M) | Workspace для Claude Code, Codex, OpenCode, Cursor Agent, Gemini и любого CLI-агента; worktree на задачу; automations по расписанию и событиям; Remote Access к своей машине через relay; PR из встроенного diff viewer; setup/teardown-скрипты; облачные workspaces; iPhone и iPad | Free $0 (один человек, локально); Pro $20 ($16 при оплате за год); Team $60 ($54) за место, 150 облачных часов; Ultra $200; везде свои подписки агентов; MIT; macOS, Linux experimental, Windows нет | Переименован 2026-10-25; desktop-v2.0.6 от 2026-11-08; 16,103★ | Claude Code и Codex параллельно, worktree, PR, доступ к другой машине — как Linked machine | Windows, Canvas, волны Ticket-ов, gate, Autopilot с учётом лимитов, Flight Recorder | Облако, телефон, diff viewer, Linear и Slack, планы для команд |
| **opcode** (бывший Claudia; Asterisk) | GUI только для Claude Code: свои и фоновые агенты, checkpoints, аналитика расхода, MCP | Бесплатно, AGPL-3.0; Windows, macOS, Linux | Последний релиз v0.2.0 от 2025-08-31; PR сливаются (2026-11-06); 22,431★ | GUI над Claude Code, фоновые агенты | Codex, Canvas, worktree, волны, gate, PR | Checkpoints, аналитика расхода, Linux |
| **Agor** (Preset) — canvas | Web-пространство для команды: ветки и Session-ы агентов на 2D canvas; зона canvas — стадия работы, она запускает шаблонный prompt; worktree со своим окружением; cron; агенты управляют Agor через MCP (fork, spawn, schedule); курсоры коллег; Claude Code, Codex, Gemini CLI, Copilot, OpenCode, Cursor (beta) | Self-hosted (Node.js ≥ 22.12) или Agor Cloud без публичной цены; BUSL-1.1 (исходники открыты, но это не open source), станет Apache-2.0 2029-01-15 | Тег v0.27.0 от 2026-10-14 (последний GitHub release v0.15.0 от 2026-03-28); push 2026-11-06; 1,487★ | Canvas с Session-ами Claude Code и Codex, стадии работы, worktree, MCP для агентов — как Canvas MCP | Desktop, Ticket-файлы, gate, PR и merge волнами, Autopilot | Несколько людей на одном canvas, cron, web |
| **OpenCove** — canvas | Canvas с Session-ами Claude Code и Codex, terminal-ами, задачами и заметками; worktree | MIT; desktop и web UI | v0.4.0 от 2026-10-12; push 2026-11-08; 1,651★ | Почти тот же набор Node-ов: Session, Terminal, задача, заметка | волны Ticket-ов, gate, PR, Autopilot, Browser, Cards | Web UI |
| **Horizon** — canvas | GPU-terminal: shells, агенты (Claude Code, Codex, Gemini CLI, OpenCode и другие), browser и VNC-desktop на бесконечном canvas, группы по workspace, resume Session-ов | MIT; Linux и macOS | v0.2.7 от 2026-08-02; push 2026-11-08; 721★ | Terminal, Browser и Session на canvas | Windows, workflow поверх Canvas | Linux, VNC, больше агентов |
| **Whiteboard** (dev.fast, YC W26) — canvas | Desktop-canvas для проектирования вместе с агентом: агент через SDK рисует sequence- и ER-диаграммы, semantic diff, decision log и trace своей работы со ссылками на код; Claude Code, Codex и другие | MIT, работает локально, обещана hosted-версия для команд; macOS, Windows, Linux | v0.5.1 от 2026-11-01; push 2026-11-06; 3,475★ | Агент рисует на canvas — как Cards и Canvas MCP | Запуск и ведение агентов, волны Ticket-ов, gate, Autopilot | Диаграммы кода, semantic diff, decision log |
| **Maestro** (RunMaestro) | «Agent Orchestration Command Center»: Auto Run проходит markdown-чеклисты, на задачу свежая Session; Playbooks; sub-agents в worktree с PR в один клик; Maestro Cue запускает работу по изменению файла, таймеру, событию GitHub или окончанию агента; агенты по SSH; Director's Notes — timeline работы агентов; usage dashboard; CLI для headless | Бесплатно, AGPL-3.0; macOS, Windows, Linux; телефон через встроенный web server и Cloudflare tunnel | v1.0.2 от 2026-10-21; push 2026-11-08; 3,555★ | Ближе всех: markdown-задачи идут без человека, worktree, PR, timeline — как Autopilot и Flight Recorder | Canvas, Epic → волны, gate до PR, merge, учёт лимитов, Product Session | Триггеры Cue, SSH, Linux, телефон, больше агентов |
| **Emdash** (General Action, YC W26) | Агенты параллельно, у каждого свой worktree и ветка; задачи из Linear, GitHub, Jira, GitLab; diff review, PR, статус CI; SSH; automations по расписанию с историей run-ов, rerun и auto-approval; Claude Code, Codex, Cursor, OpenCode, Amp, Devin, Qwen Code, Droid, Copilot | Desktop бесплатно, Apache-2.0, теперь «Emdash Classic»; облако для команд в early access, цены нет; macOS, Windows, Linux | v1.2.11 от 2026-11-06; 6,218★ | Задача → worktree → PR → CI, расписание с историей, auto-approval | волны Ticket-ов, локальный gate, Autopilot по очереди Epic-ов, Canvas | Трекеры задач, Linux, SSH, экран diff, больше агентов |
| **Aperant** (бывший Auto-Claude) | Автономный путь spec → план → код → QA с kanban, worktree и merge; нужен Claude Code CLI и план Pro или Max | AGPL-3.0; «Pricing coming soon» | v2.7.6 от 2026-02-20; push 2026-06-14; 14,597★; 2.x в maintenance, 3.0 переписывается | Автономный путь от spec до merge — как Autopilot | Codex, Canvas, gate, Run history, активная разработка | Kanban, отдельный цикл QA |

- **Ещё canvas.** Cate: canvas с editor, terminal и browser (MIT; v2.0.5 от 2026-09-30; 2,229★). Maestri: closed
  source; terminal-ы агентов на canvas связаны и передают работу друг другу; Claude Code, Codex, OpenCode; macOS 15.4+,
  Windows и Linux заявлены; Free или Pro $18 один раз. Collaborator: canvas terminal-ов и файлов (v0.8.4 от 2026-06-16;
  3,072★); сайт теперь ведёт на закрытую beta collab.hot. Drawgent: агент на живом canvas Excalidraw (видел только
  заголовок на HN, 178 points). tldraw агентов не запускает: tldraw offline (2026-07-16, бесплатно) даёт Claude Code и
  Codex править `.tldraw`-файлы, Fairies — эксперимент с рисующими агентами.
- **Ещё менеджеры агентов.** Agent Deck: TUI; «conductor»-Session-ы следят за другими и управляются из Telegram, Slack,
  Discord; SSH; web UI с расходом (MIT; v1.16.38 от 2026-11-07; 1,233★). Happy: телефон, web и desktop для Claude, Codex
  и Grok на своей подписке, сквозное шифрование, без worktree (MIT; cli-1.2.5 от 2026-09-22; 24,545★). CCManager: TUI
  над worktree для семи агентов (MIT; v4.4.11 от 2026-10-27; 1,278★). Xum (бывший Mux от Coder): свой agent loop на API
  keys вместо CLI Claude Code и Codex (AGPL-3.0; v0.32.1 от 2026-10-27; 2,070★). Omnara: теперь open source-замена
  Claude Managed Agents (Apache-2.0; omnarad-v0.2.17 от 2026-11-04; 3,366★). Catnip (W&B): репозиторий отдаёт 404.

Источники:
- Conductor: <https://www.conductor.build/docs/>, <https://www.conductor.build/docs/faq>, <https://www.conductor.build/changelog>, <https://www.conductor.build/changelog/0.78.0-introducing-conductor-cloud>, <https://www.conductor.build/changelog/0.92.0-remote-control>, <https://www.conductor.build/changelog/0.93.0-conductor-is-joining-meta>, <https://www.conductor.build/announcement> — 2026-11-08.
- Claude Squad: <https://github.com/smtg-ai/claude-squad>, <https://github.com/smtg-ai/claude-squad/issues/250> — 2026-11-08.
- Nimbalyst и Crystal: <https://github.com/nimbalyst/nimbalyst>, <https://nimbalyst.com/pricing>, <https://nimbalyst.com/changelog/>, <https://github.com/stravu/crystal> — 2026-11-08.
- Vibe Kanban: <https://github.com/BloopAI/vibe-kanban>, <https://www.vibekanban.com/blog/shutdown>, <https://www.vibekanban.com/pricing> — 2026-11-08.
- Sculptor: <https://github.com/imbue-ai/sculptor>, <https://imbue.com/sculptor/> — 2026-11-08.
- Terragon: <https://github.com/terragon-labs/terragon-oss>, <https://www.terragonlabs.com/> — 2026-11-08.
- Paradev: <https://paradev.com/>, <https://paradev.com/changelog>, <https://paradev.com/pricing>, <https://docs.paradev.com/>, <https://github.com/ParadevAI/Paradev> — 2026-11-08.
- opcode: <https://github.com/winfunc/opcode> — 2026-11-08.
- Agor: <https://github.com/preset-io/agor>, <https://agor.live/>, <https://agor.live/cloud> — 2026-11-08.
- Другие canvas: <https://github.com/DeadWaveWave/opencove>, <https://github.com/peters/horizon>, <https://github.com/devdotfast/whiteboard>, <https://github.com/0-AI-UG/cate>, <https://www.themaestri.app/en>, <https://github.com/collabs-inc/collab-public>, <https://collab.hot/>, <https://tldraw.dev/blog/tldraw-offline>, <https://fairies.tldraw.com/>, <https://news.ycombinator.com/item?id=49857729> (Drawgent) — 2026-11-08.
- Maestro, Emdash, Aperant: <https://github.com/RunMaestro/Maestro>, <https://runmaestro.ai/>, <https://github.com/generalaction/emdash>, <https://emdash.com/>, <https://emdash.com/changelog>, <https://github.com/AndyMik90/Aperant>, <https://aperant.com/> — 2026-11-08.
- Остальные: <https://github.com/asheshgoplani/agent-deck>, <https://github.com/slopus/happy>, <https://happy.engineering/>, <https://github.com/kbwo/ccmanager>, <https://github.com/coder/xum>, <https://www.omnara.com/>, <https://github.com/omnara-ai/omnara> — 2026-11-08.
- Запуски на HN, points / комментарии: Claudia <https://news.ycombinator.com/item?id=44933255> 501/226; Whiteboard <https://news.ycombinator.com/item?id=49833867> 424/143; Conductor <https://news.ycombinator.com/item?id=44594584> 228/115; Emdash <https://news.ycombinator.com/item?id=47140322> 206/71; Vibe Kanban <https://news.ycombinator.com/item?id=44533004> 195/132; Sculptor <https://news.ycombinator.com/item?id=45427697> 176/85; Superset <https://news.ycombinator.com/item?id=48236770> 108/135; Horizon <https://news.ycombinator.com/item?id=47416227> 84/32. Платформы: Antigravity <https://news.ycombinator.com/item?id=45967814> 1,088/1,085; Codex App <https://news.ycombinator.com/item?id=46859054> 805/638; Claude Code on the web <https://news.ycombinator.com/item?id=45647166> 578/390; Remote Control <https://news.ycombinator.com/item?id=47148454> 544/313 — 2026-11-08.

## 4. На что жалуются пользователи

Порядок — по громкости (реакции, points) и по тому, сколько продуктов задевает жалоба. Числа: реакции / комментарии на
GitHub, points / комментарии на HN, на 2026-11-08. Все ссылки открыты 2026-11-08.

| # | Жалоба | Где и насколько громко | Цитата | Кого задевает |
|---|---|---|---|---|
| 1 | Лимиты плана сгорают от параллельных и фоновых агентов; любое изменение лимитов бьёт по ним первым | [Claude Code #16157](https://github.com/anthropics/claude-code/issues/16157) 728/1,499 (2026-01-03); [#38335](https://github.com/anthropics/claude-code/issues/38335) 546/879 (2026-03-24); [HN о недельных лимитах](https://news.ycombinator.com/item?id=44713757) 609/705 (2025-07-28; Anthropic назвала причиной «running Claude 24/7 in the background»); [форум Cursor](https://forum.cursor.com/t/118368) 4,602 просмотра; [Codex #28879](https://github.com/openai/codex/issues/28879) 557 реакций; [Copilot credits](https://github.com/orgs/community/discussions/198015) 270 голосов | «Now hitting usage limits after 2 hours of continous usage.» | Claude Code, Codex, Cursor, Copilot и приложения поверх них |
| 2 | Вендоры ограничивают вход подпиской в сторонних инструментах | [Claude Code #17118](https://github.com/anthropics/claude-code/issues/17118), блокировка OpenCode, 1,414/410 (2026-01-09); [HN: OpenClaw без лимитов подписки](https://news.ycombinator.com/item?id=47633396) 1,099/827 (2026-04-03), частично отменено — [511 points](https://news.ycombinator.com/item?id=47844269); [HN: условия Antigravity](https://news.ycombinator.com/item?id=49548452) 338/220 (2026-09-03); отдельный биллинг Agent SDK [поставлен на паузу 2026-06-15](https://letsdatascience.com/news/anthropic-pauses-claude-agent-sdk-billing-overhaul-1cff2071). Правила — в [заметке о входе](research-правила-входа-для-внешних-пользователей.md) | «headless usage will become 20-30 times more expensive, and all these high level orchestrator tools/workflows depend on it» ([HN](https://news.ycombinator.com/item?id=48239413)) | OpenCode, OpenClaw, оркестраторы на `claude -p` и Agent SDK (называли Conductor), вход Gemini в чужих инструментах |
| 3 | Сначала только Mac | [Codex app для Linux](https://github.com/openai/codex/issues/11023) 1,463/209 (2026-02-07, закрыт 2026-08-11); [Intel Mac](https://github.com/openai/codex/issues/10410) 376/190; [Claude Desktop для Linux](https://github.com/anthropics/claude-code/issues/65697) 655/55 (закрыт 2026-06-30); Conductor только для Mac; [Paradev для Linux](https://github.com/ParadevAI/Paradev/issues/405) открыт | «I'm feeling a bit left out on the Windows and Linux side» ([HN Codex App](https://news.ycombinator.com/item?id=46859054), 805/638) | Codex, Claude Desktop, Conductor, Paradev |
| 4 | Тяжёлые и нестабильные desktop-приложения, потерянные Session-ы | Codex: [логи до ~640 TB в год](https://github.com/openai/codex/issues/28224) 616/157, [CPU и RAM без предела](https://github.com/openai/codex/issues/25719) 454/91, [LibreOffice внутри](https://news.ycombinator.com/item?id=49527396) 495/262. Claude Desktop: [VM на 10 GB](https://github.com/anthropics/claude-code/issues/22543) 278, [Session-ы пропали после перезапуска](https://github.com/anthropics/claude-code/issues/26452) 33/53, [история не общая у CLI и desktop](https://github.com/anthropics/claude-code/issues/28791) 187 | «syspolicyd rises to very high CPU usage and grows to multiple GB of RAM» | Codex и ChatGPT app, Claude Desktop, Cursor, Paradev |
| 5 | Человек не успевает ревьюить | [HN: parallel coding agent lifestyle](https://news.ycombinator.com/item?id=45489884) 174/138 (2025-10-06); [Ask HN: agent orchestrators?](https://news.ycombinator.com/item?id=46993479) 41/60; [мейнтейнеры тонут в AI-PR](https://github.com/orgs/community/discussions/185387) 231/131; слово «review» — в 125 из 1,171 комментариев 10 тредов HN | «review is hands down the biggest bottleneck» | Все; сильнее всего облачные агенты, которые открывают PR |
| 6 | Worktree не переносит окружение и копится | Claude Desktop создавал worktree на каждую Session без выключателя: [#21236](https://github.com/anthropics/claude-code/issues/21236) 110, [#12513](https://github.com/anthropics/claude-code/issues/12513) 80/47 (закрыты 2026-05-19); [Codex: где лежат worktree](https://github.com/openai/codex/issues/10599) 77; [WSL на /mnt/c](https://github.com/openai/codex/issues/13762) 61; [Claude Squad: hook для зависимостей, env и портов](https://github.com/smtg-ai/claude-squad/issues/260) | «none of them mention databases» ([HN Superset](https://news.ycombinator.com/item?id=46368739), 96/90) | Claude Desktop, Codex, Conductor (порты), Vibe Kanban, Claude Squad, Paradev, Cursor |
| 7 | Параллельные агенты мешают друг другу | [r/ClaudeAI: «Stop running multiple Claude Code agents in the same repo»](https://reddit.sentinel-team.org/posts/1qzduim/snapshots/2026-02-09T12%3A13%3A33.884596Z) 194/48 (зеркало); [HN: Parallel AI agents](https://news.ycombinator.com/item?id=45110075) 77/81; [HN: tmux и Markdown-spec-и](https://news.ycombinator.com/item?id=47218318) 189/131 | «One agent reverts what another just wrote.» | Все: worktree разводит файлы, но не merge и не общие сервисы |
| 8 | Run без человека ломает систему или отвечает за человека | [Codex #59060](https://github.com/openai/codex/issues/59060) 3,491/440 (2026-11-03, CLI по SSH; число реакций может быть завышено); [HN: Antigravity стёр диск](https://news.ycombinator.com/item?id=46103532) 544/482; [Claude Code #73125](https://github.com/anthropics/claude-code/issues/73125) 414; [Codex #28969](https://github.com/openai/codex/issues/28969) 225 (вопросы сами отвечаются через 60 с); [Paradev #2419](https://github.com/ParadevAI/Paradev/issues/2419) — всегда пропускает permission prompts | «it destroyed systemd, destroyed containers, ran random scripts, cost me $10,000+» | Codex, Antigravity, Claude Code, приложения с auto-approve |
| 9 | Инструменты закрываются, продаются, меняются без предупреждения | [HN: Conductor is joining Meta](https://news.ycombinator.com/item?id=50369503) 218/225; [закрытие Vibe Kanban](https://www.vibekanban.com/blog/shutdown); [Claude Squad «abandoned»](https://github.com/smtg-ai/claude-squad/issues/250); [HN: Antigravity bait and switch](https://news.ycombinator.com/item?id=48222529) 771/345 (auto-update заменил IDE) | «Now I'm forced to look for alternatives. Why can't they open source it?» | Conductor, Vibe Kanban, Claude Squad, Antigravity, Codex app (слит в ChatGPT) |
| 10 | Облачное окружение не настраивается | Claude Code on the web: [secrets](https://github.com/anthropics/claude-code/issues/32733) 215, [только default branch](https://github.com/anthropics/claude-code/issues/10018) 160/59; [Codex cloud: «Unable to determine project root»](https://github.com/openai/codex/issues/49497) 33/23; Cursor: [setup failing](https://forum.cursor.com/t/96324) 843 просмотра, [fails every time](https://forum.cursor.com/t/152242) 454 | «Getting the environment set up in the cloud is a pain vs just running in your environment» ([HN Jules](https://news.ycombinator.com/item?id=44813854), 339/227) | Claude Code on the web, Codex cloud, Cursor cloud agents, Jules |

## 5. Что это значит для направления worfy

1. **Повтор (риск): «много Session-ов в одном окне» уже не отличие.** Факт: параллельные агенты в worktree с diff, PR,
   terminal и browser входят в подписки Anthropic, OpenAI, GitHub, Cursor и Google (раздел 2). Anthropic за 2026 год
   добавила workflows, agent view, Projects, Remote Control, расписание и облачный review. Мнение: ту часть worfy,
   которая только запускает и показывает Session-ы, платформы могут повторить следующим релизом; строить на ней
   направление рискованно.
2. **Отличие: процесс, а не окно.** Факт: никто из просмотренных не соединяет Ticket-файлы в репозитории, волны,
   локальный gate до PR, merge, Autopilot по очереди Epic-ов с учётом недельных лимитов, Flight Recorder и двух вендоров
   на одном Canvas. Платформы оркестрируют внутри беседы или скрипта (workflows, Projects), без файлов задач и без gate.
   Ближе всех Maestro, Emdash и Aperant, и у каждого нет части этой цепочки. Мнение: для направления «соло-разработка
   продукта» надёжнее опираться на дисциплину процесса (gate, волны, review, история run-ов), чем на Canvas.
3. **Цена: за оркестратор почти не платят.** Факт: почти все приложения бесплатные или open source. Пользователи платят
   вендору модели и ждут бесплатного оркестратора: «taxing it 20$/m is a bit steep» (HN, Superset). Vibe Kanban
   закрылся: «The vast majority are free users». Деньги ищут у команд и в облаке: Paradev Team $54–60 за место, Nimbalyst
   Wiki Teams $20, облака Emdash, Agor и Conductor. Мнение: модель «платное приложение для одного человека» рынок не
   подтверждает; для внешних пользователей реалистичнее бесплатно и open source. Рамки входа подпиской — в
   [заметке о правилах входа](research-правила-входа-для-внешних-пользователей.md).
4. **Аудитория и внимание.** Факт: жалобы и треды идут от соло-разработчиков и маленьких команд; «The sweet-spot is 2-3
   agents», единицы держат 10–20. Запуски платформ на HN собирают больше внимания, чем сторонние: Antigravity 1,088
   points, Codex App 805, Claude Code on the web 578 — против 84–501 у сторонних (раздел 3). Мнение: независимому
   приложению этой категории трудно расти без ниши, которую платформы не закрывают.
5. **Жалобы, на которые worfy уже отвечает, и пробелы.** Факт: первая жалоба — лимиты; Autopilot ждёт сброса лимитов,
   а Run planning перед каждой волной решает, стартовать сейчас или ждать. Третья жалоба — только Mac; worfy работает и
   на Windows. Против рынка у worfy нет Linux, телефона, облака, экрана diff и запуска по событиям. Мнение: облако и
   телефон дороги для проекта одного человека; учёт лимитов и Windows стоит показывать первыми, если worfy пойдёт к
   внешним пользователям.

## 6. Что не проверено

- **OpenAI.** openai.com и help.openai.com отдали 403. Запуск Codex app взят с форума OpenAI. 5 млн активных в неделю,
  Codex-only seats, их закрытие для новых Business 2026-06-24 и тарифы credits — только по тексту поиска. 10 млн в неделю
  у Codex вместе с ChatGPT Work (июль 2026) — только X и новости.
- **Cursor.** Слияние SpaceX и xAI и цена $60 млрд акциями — только новости; блог Cursor подтверждает покупку без цены.
  Годовые цены Cursor — из третьих источников, страница пишет «upon request». Дата версии 3.29.9 не найдена. Лимит
  параллельности Codex Cloud и локальных агентов Cursor не опубликован.
- **GitHub.** Может ли Copilot app запускать агентов Claude и Codex — не подтверждено. Агенты Google, Cognition и xAI
  объявлены для GitHub, но в docs их нет. Changelog GA Copilot app называет планы Business и Enterprise, docs — все
  планы; что верно сегодня, не проверено.
- **Google и другие.** Страницы Google открывались с геолокацией Украины и показывали местную валюту; цены в USD для
  Google AI Plus нет; waitlist новой Jules закрыт по региону. Warp Oz, Factory Missions и цена JetBrains — по тексту
  поиска. Статус autonomous agent Kiro после preview в декабре 2025 не проверен.
- **Anthropic.** Дата Linux beta desktop (2026-06-30) и то, что Remote Control сначала был preview только для Max, —
  только пресса. Дата переименования Max 20x в Ultra (2026-10-30) — пресса. «FleetView» = agent view — вывод по GitHub
  issues и списку агентов CLI, в docs этого слова нет. Цифр по Claude Code после февраля 2026 Anthropic не давала.
  Блокировки 2026 года: пост 2026-01-09 прочитан через threadreaderapp, названия затронутых инструментов — только
  пресса; письмо 2026-04-04 известно только по TechCrunch; правка страницы legal была уже 2026-02-18 по Wayback, пресса
  пишет 02-19.
- **Сторонние приложения.** Conductor Pro за $50 — только текст поиска: страница цен не показала цен, строка FAQ «Right
  now we don't [charge]» может быть старше Pro, финансирование не указано. Sculptor «free in beta» — только сторонние
  источники. Можно ли ещё купить Vibe Kanban Pro — неизвестно. Цены Agor Cloud и облака Emdash не опубликованы. ОС для
  Claude Squad в README не названы. Сборки Maestri для Windows и Linux заявлены, но не скачивались. Catnip: удалён,
  переименован или закрыт — неизвестно. tldraw Fairies — кроме заголовка страницы, только пересказы докладов. Помесячные
  цены Paradev ($20, $60) видел агент, годовые ($16, $54) — я.
- **Мои дополнения.** Horizon и Whiteboard — только README и HN. Drawgent — только заголовок на HN.
- **Жалобы.** reddit.com не отдаёт страницы: Reddit — через зеркало или текст поиска, два треда видны только в сниппетах
  и не ранжированы. Подсчёт слова «review» в тредах HN — regex, не чтение. Число реакций на Codex #59060 (жалоба 8) могло
  вырасти от шуточного интереса к issue, а не от самой проблемы. Данных issue tracker по Jules и Antigravity нет. Обсуждение Copilot о блокировке PR от Copilot видно только через The Register (2025-09-05). Сильного треда об
  Agents Window Cursor не найдено.
- **Общее.** Ни одно приложение не запускалось: всё — по описаниям вендоров, README и обсуждениям.
