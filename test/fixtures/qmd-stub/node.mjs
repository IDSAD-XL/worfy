// The node stand-in of ./node as a Node script, for Windows: test/contract/harness-qmd.test.ts puts a
// node.cmd on the PATH that runs it with the tests' node. A change to the shell stand-in goes here too.
import process from 'node:process'

process.stdout.write(`${process.env.NODE_STUB_VERSION}\n`)
