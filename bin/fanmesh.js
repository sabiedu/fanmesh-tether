#!/usr/bin/env node
// FanMesh — CLI entry point.
//
// Boots a serverless P2P match room (Pears) with an on-device AI commentator
// (QVAC) and serves a live web UI. Two fans run this on the same match key and
// meet — no server, no cloud.
//
//   node bin/fanmesh.js --match "WC-FINAL-ARG-FRA" --name Alice --lang English
//   node bin/fanmesh.js --match "WC-FINAL-ARG-FRA" --name Bob   --lang Español --port 3001
import os from 'node:os'
import path from 'node:path'
import { FanMeshApp } from '../src/server.js'

function arg (name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
function flag (name) { return process.argv.includes('--' + name) }

const matchKey = arg('match') || 'WC-FINAL-ARG-FRA'
const name = arg('name') || ('Fan-' + Math.random().toString(36).slice(2, 5))
const language = arg('lang', 'English')
const port = Number(arg('port', '3000'))
const storage = arg('storage', path.join(os.tmpdir(), 'fanmesh', name))
const useAI = !flag('no-ai')

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

let app
async function main () {
  app = await new FanMeshApp({ matchKey, storage, name, language, port }).start({ ai: useAI })
}
async function shutdown () {
  console.log('\n  shutting down…')
  try { await app && app.close() } catch {}
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
