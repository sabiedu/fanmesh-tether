// Orchestrates two cross-process MatchRoom convergence probes.
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.join(os.tmpdir(), `fanmesh-cross-${Date.now()}`)
fs.mkdirSync(path.join(ROOT, 'A'), { recursive: true })
fs.mkdirSync(path.join(ROOT, 'B'), { recursive: true })
const MATCH = process.argv[2] || 'CROSSMATCH'
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))

function peer (name, dir) {
  const p = spawn(process.execPath, ['test/cross-peer.mjs', name, MATCH, dir], { cwd: process.cwd(), env: { ...process.env, FANMESH_DEBUG: '1' } })
  p.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`))
  p.stderr.on('data', (d) => process.stderr.write(`[${name}!] ${d}`))
  return p
}

const A = peer('Alice', path.join(ROOT, 'A'))
const B = peer('Bob', path.join(ROOT, 'B')) // NO stagger: prove migration convergence
await SLEEP(45000)
try { A.kill() } catch {}
try { B.kill() } catch {}
fs.rmSync(ROOT, { recursive: true, force: true })
process.exit(0)
