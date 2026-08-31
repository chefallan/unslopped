#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv.slice(2), process.cwd()).then((code) => {
  process.exitCode = code;
});
