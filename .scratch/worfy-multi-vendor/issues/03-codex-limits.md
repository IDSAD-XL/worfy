# 03 — Codex: Limits подписки

Type: research
Status: done 2026-11-02
Blocked by:
Source: [map.md](../map.md), Ticket 01

## Question

Какие окна лимита подписки ChatGPT действуют для Codex (длительности, сброс, планы Plus / Pro / Business), и откуда worfy может их узнать: событие в потоке Session (аналог `rate_limit_event` с `five_hour` / `seven_day`, `src/shared/agent/events.ts:364`), запрос без траты лимита (аналог пробы `src/main/agent/limits-usage.ts`), файл, команда `/status`? Что Codex делает, когда лимит кончился (ошибка, ожидание, время сброса — аналог `src/shared/autopilot/resume-at.ts`)? Хватит ли этих данных Autopilot-у (бюджет Wave) и Resource Planner-у (прогноз доли окна)?

## Answer

Проверено 2026-11-02. Код — `openai/codex` на теге `rust-v0.166.0` (release 2026-10-29), ниже `G/` = `https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/`. Документы — страница Pricing ([learn.chatgpt.com/docs/pricing](https://learn.chatgpt.com/docs/pricing), сюда ведёт developers.openai.com/codex/pricing) и App Server ([learn.chatgpt.com/docs/app-server](https://learn.chatgpt.com/docs/app-server)), обе без даты правки, прочитаны 2026-11-02. Статья help center [11369540](https://help.openai.com/en/articles/11369540) отдала 403, не прочитана. `codex` на Mac не установлен, локально ничего не запускалось.

**Окна по планам (Pricing, 2026-11-02).**
- Plus и Standard Business: окно «five-hour period»; таблица — оценка local messages за 5 часов по Model (GPT-6 Astra 5–45, GPT-6.1 Sol 15–160, GPT-6.1 Terra 35–285, GPT-6 Luna 350–3000). Это «estimates», «not fixed message limits».
- Pro ($100 / $200 / $500): «Pro plans currently have no five-hour limit».
- Для всех: «Weekly limits may also apply» — длительность и размер недельного окна не названы.
- Enterprise/Edu с flexible pricing: «no fixed rate limits», расход идёт в credits. Без flexible pricing — per-seat лимиты как у Plus.
- Free / Go: цифр нет.
- Лимит общий для Codex и ChatGPT Work. Fast mode тратит лимит в 2.5x, Ultrafast — в 8x, генерация картинок — в 3–5x.
- Точные лимиты и время сброса страница отсылает смотреть в usage dashboard (`chatgpt.com/codex/settings/usage`) или командой `/status` в CLI.

**Вывод про окна.** Набор окон не зашит ни в документ, ни в код. Сервер сам присылает до двух окон, `primary` и `secondary`, с длительностью в минутах. TUI подбирает подпись по длительности: 5h, daily, weekly, monthly, annual (`G/tui/src/chatwidget/rate_limits.rs:109`). Модель worfy с ключами `five_hour` / `seven_day` для Codex не подходит. У Pro, судя по Pricing, 5-часового окна нет — значит, у него будет одно недельное.

**Откуда брать данные.**
1. Протокол (`G/protocol/src/protocol.rs`):
   - `EventMsg::TokenCount(TokenCountEvent { info, rate_limits: Option<RateLimitSnapshot> })` (:1581, :2572);
   - `RateLimitSnapshot { limit_id, limit_name, normal_model_slug, primary, secondary, credits, individual_limit, spend_control_reached, plan_type, rate_limit_reached_type }` (:2578);
   - `RateLimitWindow { used_percent: f64 (0–100), window_minutes, resets_at (Unix seconds) }` (:2621).
   - В этом виде поля есть с `rust-v0.50.0` (2025-10-25). В `rust-v0.40.0` (2025-09-23) их ещё нет.
2. Откуда Codex их берёт: из заголовков каждого ответа модели и из SSE-события `codex.rate_limits` (`G/codex-api/src/rate_limits.rs:57`, `:135`):
   - `x-codex-primary-used-percent`, `-primary-window-minutes`, `-primary-reset-at`, то же для `secondary`;
   - `x-codex-rate-limit-reached-type`, `x-codex-active-limit`;
   - для других счётчиков (bucket-ов) используется префикс `x-<limit_id>`.
   Значит, данные обновляются на каждом запросе к модели.
3. App Server (JSON-RPC по stdio, это интерфейс для своих клиентов; см. `G/app-server-protocol/src/protocol/common.rs:1386`, `:2071` и документ App Server):
   - request `account/rateLimits/read` → `{ ordinaryUsageAllowed, rateLimits, rateLimitsByLimitId, rateLimitResetCredits, accountId, rateLimitUpsell }`;
   - notification `account/rateLimits/updated` `{ rateLimits }` — по документу «emitted whenever a user’s ChatGPT rate limits change»;
   - окно в v2: `{ usedPercent: i32, windowDurationMins, resetsAt }` (`G/app-server-protocol/src/protocol/v2/account.rs:361`, `:687`, `:782`);
   - метод не помечен `experimental`.
   Это прямой аналог `rate_limit_event` в потоке и request-а из `limits-usage.ts` вместе.
4. Request без траты лимита: `account/rateLimits/read` идёт в `GET {base}/wham/usage` (для API-хоста — `/api/codex/usage`, `G/backend-client/src/client/rate_limit_resets.rs:126`). Это чтение учёта, запроса к модели нет, thread не создаётся. Параметр `excludeResetCreditDetails` нужен для фоновых опросов (`account.rs:345`). Что этот request не тратит лимит, документ прямо не говорит — это вывод из кода.
5. Файлы: событие `TokenCount` (а с ним `rate_limits`) пишется в rollout-файлы сессий в `$CODEX_HOME/sessions` (по умолчанию `~/.codex`; `G/rollout/src/policy.rs:134`, `G/rollout/src/lib.rs:86`). Это пассивный источник, аналог транскриптов. Событие `Error` туда не пишется.
6. `/status` — команда TUI, у неё нет машинного вывода; TUI считает снимок устаревшим через 15 минут (`G/tui/src/status/rate_limits.rs:66`). В `codex exec --json` лимитов нет: `turn.completed.usage` содержит только токены (`G/exec/src/exec_events.rs:61`). Значит, worfy нужен App Server, а не `exec`.

**Когда лимит кончился.**
- Backend отвечает HTTP 429 с телом `{error:{type:"usage_limit_reached", plan_type, resets_at, limit_window_minutes}}` и заголовками `x-codex-*` (`G/codex-api/src/api_bridge.rs:199`). Codex превращает это в `UsageLimitReachedError { plan_type, resets_at, limit_window_minutes, rate_limits, promo_message, rate_limit_reached_type }` (`G/protocol/src/error.rs:723`).
- Повторов нет: `retry_delay` для этой ошибки возвращает `None` (`error.rs:421`). Ожидания тоже нет. Перед ошибкой Codex отправляет свежий снимок лимитов (`G/core/src/session/turn.rs:1846`), turn заканчивается со `status: "failed"`.
- Клиент получает: `error` `{ error: { message, codexErrorInfo: "usageLimitExceeded", additionalDetails? }, willRetry: false, threadId, turnId }` (`v2/notification.rs:62`, `v2/shared.rs:76`). Отдельного поля с временем сброса там нет. Время сброса есть только в тексте сообщения, в локальном формате («…try again at 3:15 PM.» или «Nov 3rd, 2026 3:15 PM»), и в `resetsAt` у снимка.
- Тем же `usageLimitExceeded` приходят `QuotaExceeded` и `UsageNotIncluded` — план не включает Codex (`error.rs:505-507`, проверено ревью PR #1233). Ждать `resetsAt` по такой ошибке можно бесконечно: сброса не будет.
- `rateLimitReachedType` различает случаи: `rate_limit_reached`, `workspace_{owner,member}_{credits_depleted,usage_limit_reached}`.
- По Pricing, turn, который уже идёт, может доработать после исчерпания лимита («subject to fair use limits»). У Plus и Pro есть докупка credits. Документ App Server предупреждает: по `ordinaryUsageAllowed` «clients must not infer recovery from percentages or reset times».
- Аналог `resume-at.ts`: брать `resetsAt` того окна, у которого `usedPercent` дошёл до 100 (или `rateLimitReachedType` не null), и перед продолжением спрашивать `account/rateLimits/read` → `ordinaryUsageAllowed`.

**Хватит ли данных.**
- Бюджет Wave в Autopilot — хватит: есть доля окна в процентах, время сброса и длительность, поток во время работы плюс отдельный request. Нужно обобщить модель Limits до списка окон с ключом `limitId` + длительность вместо `five_hour` / `seven_day`, учесть bucket-ы по моделям (`rateLimitsByLimitId`, `normalModelSlug`) и credits. В v2 `usedPercent` — целое число, точность 1 %.
- Прогноз Resource Planner — только частично. Абсолютного размера окна нет: OpenAI даёт лишь проценты, а оценки в сообщениях отличаются в 10–100 раз по Model, Fast mode и cloud. Прогноз возможен только на собственной калибровке: прирост `usedPercent` на токены turn-а (`thread/tokenUsage/updated`) для каждой пары Model + speed. Ровно так же, как сейчас у Claude.

**Чего не знаем.**
- Длительность и размер недельного окна по планам; какие окна реально приходят у Plus, Pro, Business (Pricing говорит «may»). Нужен живой снимок `account/rateLimits/read` с подпиской владельца.
- Тратит ли `/wham/usage` что-то и есть ли на него свой rate limit (из кода видно только, что это GET без запроса к модели).
- Может ли `usedPercent` быть больше 100, когда turn дорабатывает после исчерпания лимита.
- Как часто приходит `account/rateLimits/updated` без активного turn-а.
- Совпадает ли учёт Codex CLI с desktop-приложением и ChatGPT Work: лимит общий, но worfy увидит только снимок.
- Статья help center 11369540 не прочитана (403).
