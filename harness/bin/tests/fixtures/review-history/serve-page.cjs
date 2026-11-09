// The page of pull requests the stand-in gh of review-history.test.sh answers when the fixture is one list
// (make-pages.cjs <dir> nodes <total>): the pull requests after the cursor, as many as the page size asked for, the
// way GitHub pages a connection. The cursor names the offset ("c<offset>"); "1" is the first page, as the stand-in
// calls a request without a cursor.
//
//   node serve-page.cjs <nodes.json> <cursor> <first>   prints the GraphQL answer
"use strict"
const fs = require("fs")

const [file, cursor, first] = process.argv.slice(2)
const nodes = JSON.parse(fs.readFileSync(file, "utf8"))
const from = cursor === "1" ? 0 : Number(String(cursor).replace(/^c/, ""))
const size = Number(first)
if (!Number.isInteger(from) || from < 0 || !Number.isInteger(size) || size < 1) {
    process.stderr.write(`serve-page: bad cursor "${cursor}" or page size "${first}"\n`)
    process.exit(1)
}
const to = Math.min(nodes.length, from + size)
const page = { data: { repository: { pullRequests: { pageInfo: { hasNextPage: to < nodes.length, endCursor: `c${to}` }, nodes: nodes.slice(from, to) } } } }
process.stdout.write(JSON.stringify(page))
