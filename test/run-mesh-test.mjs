// FanMesh — Milestone 1 orchestrator: spawns two Hyperswarm peers on one topic
// and waits until they discover each other + exchange a message (no server).
import { spawn } from 'node:child_process'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const topic = b4a.toString(crypto.randomBytes(32), 'hex')
console.log(`Generated topic: ${topic}`)

function spawnPeer(name) {
  const p = spawn(process.execPath, ['test/peer.mjs', name, topic], { cwd: process.cwd() })
  const lines = []
  p.stdout.on('data', (d) => {
    for (const line of d.toString().split(/\r?\n/)) {
      const t = line.trim()
      if (!t) continue
      lines.push(t)
      console.log(`  [${name}] ${t}`)
    }
  })
  p.stderr.on('data', (d) => console.log(`  [${name}!ERR] ${d.toString().trim()}`))
  return { p, lines, ok: () => lines.some((l) => l.startsWith('SUCCESS')) }
}

const A = spawnPeer('Alice')
await new Promise((r) => setTimeout(r, 1500))
const B = spawnPeer('Bob')

const deadline = Date.now() + 40000
await new Promise((resolve) => {
  const iv = setInterval(() => {
    if (A.ok() && B.ok()) { clearInterval(iv); resolve() }
    else if (Date.now() > deadline) { clearInterval(iv); resolve() }
  }, 500)
})

const passed = A.ok() && B.ok()
console.log(passed
  ? '\n✅ MILESTONE 1 PASSED: two peers discovered each other via Hyperswarm + exchanged a message. NO SERVER.'
  : '\n❌ MILESTONE 1 FAILED: peers did not exchange messages within timeout.')
try { A.p.kill('SIGTERM') } catch {}
try { B.p.kill('SIGTERM') } catch {}
process.exit(passed ? 0 : 1)
