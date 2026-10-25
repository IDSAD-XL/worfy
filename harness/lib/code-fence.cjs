// The code blocks of a ticket file: the one rule by which bin/ticket, the writer of the header, and
// bin/epic-status, its reader, skip them. "Status: done" in a code example is not a field, and the two
// scripts must take the same lines for code, or a ticket `ticket done` closed reads as not done
// (TICKETS.md, "Header").
//
// A block opens with a line of indentation, three or more ` or ~ and anything after them (an info string).
// It closes only with a line of the same character, at least as long as the opening run, followed by
// nothing but spaces and tabs: a ~~~ line inside a ``` block, a ``` line inside a ```` block and a ```md
// line inside a ``` block are text of the block.
"use strict"

const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/

/**
 * A reader of code lines, fed the lines of one file in order, each without its line end. It answers
 * true for a line that is code: a fence line, or a line inside a block.
 */
function codeLines() {
    let open = "" // the run of ` or ~ that opened the block we are in; "" outside code
    return (line) => {
        const f = FENCE.exec(line)
        if (open !== "") {
            if (f && f[1][0] === open[0] && f[1].length >= open.length && /^[ \t]*$/.test(f[2])) open = ""
            return true
        }
        if (f) {
            open = f[1]
            return true
        }
        return false
    }
}

module.exports = { codeLines }
