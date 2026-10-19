// The git stand-in of ./git as a Node script, for Windows (README.md): only `git --version`.
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('git', args)
if (args[0] === '--version') process.stdout.write('git version 2.39.5\n')
else unsupported('git', args)
