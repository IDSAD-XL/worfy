// Writes GraphQL answers of `review-history` pages for the cases too big to keep as files: invented pull
// requests, logins and texts only. Each page goes to <dir>/page-<cursor>.json, the first one to page-1.json.
//
//   node make-pages.cjs <dir> voice <n>                    one pull request with n substantive comments of the
//                                                          team (n - 3 plain, two approvals with a remark, one short
//                                                          ```suggestion block) and six
//                                                          that do not count (LGTM, +1 thanks, an emoji, too short,
//                                                          and two plain approvals over 20 characters)
//   node make-pages.cjs <dir> cap <total>                  <total> reviewed pull requests, 100 a page
//   node make-pages.cjs <dir> pages <per page> <pages> <k> <pages> pages of <per page> reviewed pull requests with
//                                                          k substantive comments each
//   node make-pages.cjs <dir> since                        three pull requests updated 2026-05-20, 2026-05-10 and
//                                                          2026-04-20, and a next page
//   node make-pages.cjs <dir> chars                        one pull request with two comments: 40 Cyrillic
//                                                          letters and 40 Latin ones
//   node make-pages.cjs <dir> nodes <total>                <total> reviewed pull requests as one list,
//                                                          <dir>/nodes.json: the stand-in gh pages it by the page
//                                                          size asked for (serve-page.cjs)
// The "now" of the tests is 2026-06-01; every pull request here is inside the 12 months before it.
"use strict"
const fs = require("fs")
const path = require("path")

const TEAM = [
    ["mira-dev", "MEMBER"],
    ["tomas-k", "COLLABORATOR"],
    ["jun-o", "OWNER"],
]
const empty = { pageInfo: { hasNextPage: false, endCursor: "x" }, nodes: [] }
const day = (offsetMinutes) => new Date(Date.parse("2026-05-31T00:00:00Z") - offsetMinutes * 60000).toISOString()

let serial = 0
function comment(body, n) {
    serial++
    const [login, association] = TEAM[serial % TEAM.length]
    return { id: `K${n}-${serial}`, url: `https://github.com/acme/shop/pull/${n}#issuecomment-${serial}`, body, createdAt: day(1), authorAssociation: association, author: { __typename: "User", login } }
}
const say = (i) => `Remark ${i}: please keep the retry limit in one named constant here.`

function pull(n, updatedAt, bodies) {
    return {
        number: n,
        url: `https://github.com/acme/shop/pull/${n}`,
        title: `Change ${n}`,
        state: "MERGED",
        createdAt: updatedAt,
        updatedAt,
        mergedAt: updatedAt,
        additions: 10,
        deletions: 2,
        changedFiles: 1,
        author: { __typename: "User", login: "pat-author" },
        files: { nodes: [{ path: "src/main.js" }] },
        reviews: {
            pageInfo: { hasNextPage: false, endCursor: "x" },
            nodes: [{ id: `R${n}`, url: `https://github.com/acme/shop/pull/${n}#pullrequestreview-${n}`, state: "APPROVED", body: "", submittedAt: updatedAt, authorAssociation: "MEMBER", author: { __typename: "User", login: "mira-dev" }, commit: { oid: `c${n}` } }],
        },
        reviewThreads: empty,
        comments: { pageInfo: { hasNextPage: false, endCursor: "x" }, nodes: bodies.map((b) => comment(b, n)) },
    }
}

function writePages(dir, pages) {
    fs.mkdirSync(dir, { recursive: true })
    pages.forEach((nodes, i) => {
        const last = i === pages.length - 1
        const page = { data: { repository: { pullRequests: { pageInfo: { hasNextPage: !last, endCursor: last ? null : String(i + 2) }, nodes } } } }
        fs.writeFileSync(path.join(dir, `page-${i + 1}.json`), JSON.stringify(page))
    })
}

const [dir, kind, ...args] = process.argv.slice(2)
const nums = args.map(Number)
if (kind === "voice") {
    const n = nums[0]
    const bodies = [...Array.from({ length: n - 3 }, (_, i) => say(i + 1)), "LGTM, but rename retryLimit to maxRetries here.", "Thanks! One thing: the timeout should be a named constant.", "```suggestion\nx\n```", "LGTM 👍", "+1 thanks!", "🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉", "> a quoted line that is long enough\nok", "LGTM, thanks for the fix! Looks good to me.", "Thanks a lot, looks great. Nice work!"]
    writePages(dir, [[pull(1, day(10), bodies)]])
} else if (kind === "cap") {
    const total = nums[0]
    const pages = []
    for (let i = 0; i < total; i++) {
        if (i % 100 === 0) pages.push([])
        pages[pages.length - 1].push(pull(total - i, day(i + 10), [say(i + 1)]))
    }
    writePages(dir, pages)
} else if (kind === "pages") {
    const [per, count, k] = nums
    const pages = []
    let at = 0
    for (let p = 0; p < count; p++) {
        pages.push([])
        for (let i = 0; i < per; i++, at++) pages[p].push(pull(1000 - at, day(at + 10), Array.from({ length: k }, (_, j) => say(at * 10 + j))))
    }
    writePages(dir, pages)
} else if (kind === "nodes") {
    const total = nums[0]
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "nodes.json"), JSON.stringify(Array.from({ length: total }, (_, i) => pull(total - i, day(i + 10), [say(i + 1)]))))
} else if (kind === "chars") {
    writePages(dir, [[pull(1, day(10), ["Ж".repeat(40), "a".repeat(40)])]])
} else if (kind === "since") {
    writePages(dir, [
        [pull(3, "2026-05-20T00:00:00Z", [say(1)]), pull(2, "2026-05-10T00:00:00Z", [say(2)]), pull(1, "2026-04-20T00:00:00Z", [say(3)])],
        [pull(0, "2026-04-01T00:00:00Z", [say(4)])],
    ])
} else {
    process.stderr.write(`make-pages: unknown kind ${kind}\n`)
    process.exit(2)
}
