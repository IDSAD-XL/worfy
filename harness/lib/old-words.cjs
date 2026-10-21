// The old Russian words of the profile contract, read for one release (profiles/README.md,
// "Placeholders"): the placeholders in profile values and the two headings of rules.md that agents
// look for. Profiles written before the release carry them; bin/profile prints every value and
// rules.md with the English forms, and hooks/session-start.mjs mixes rules.md in with the English
// headings, so every reader knows one set of words.
//
// CommonJS, like pipeline.cjs: bin/profile `require`s it, and the ESM hook imports it.
"use strict"

// shortcut: accepts the old Russian token, remove after the next release
const OLD_WORDS = {
    placeholders: [["<эпик>", "<epic>"], ["<ветка>", "<branch>"], ["<имя-тикета>", "<ticket-name>"], ["<что-ревьюишь>", "<review-target>"], ["<файл>", "<file>"], ["<пакет>", "<package>"], ["<имя>", "<name>"], ["<каталог модуля>", "<module-dir>"]],
    headings: [["Обязательное чтение исполнителя", "Required reading for the implementer"], ["Ночной прогон и аудит", "Overnight run and audit"]],
}

// `v` with every old placeholder in its strings replaced by the English one, at any depth: strings
// are returned anew, arrays and objects are changed in place and returned.
function englishPlaceholders(v) {
    if (typeof v === "string") return OLD_WORDS.placeholders.reduce((s, [old, now]) => s.split(old).join(now), v)
    if (Array.isArray(v)) return v.map(englishPlaceholders)
    if (v !== null && typeof v === "object") for (const k of Object.keys(v)) v[k] = englishPlaceholders(v[k])
    return v
}

// The text of a rules.md with each old heading, a whole `## …` line (trailing blanks and a CR allowed),
// renamed to the English one. A heading with more words after it stays as written.
function englishHeadings(text) {
    return OLD_WORDS.headings.reduce((t, [old, now]) => t.replace(new RegExp(`^## ${old}(?=[ \\t]*\\r?$)`, "gm"), `## ${now}`), text)
}

module.exports = { englishPlaceholders, englishHeadings }
