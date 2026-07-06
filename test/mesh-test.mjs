// FanMesh — Milestone 2 integration test.
// Spins up TWO match rooms (creator + joiner) on the SAME match name, in-process,
// and verifies: Hyperswarm rendezvous -> Autobase multi-writer chat BOTH ways ->
// Hypercore clip sync P2P. No server anywhere.
import { MatchRoom } from '../src/mesh.js'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.join(os.tmpdir(), `fanmesh-test-${Date.now()}`)
const dir = (id) => path.join(ROOT, id)
for (const d of ['A', 'B']) fs.mkdirSync(dir(d), { recursive: true })

const WAIT = (ms) => new Promise((r) => setTimeout(r, ms))
function once (emitter, event, pred = () => true, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout)
    const handler = (...args) => {
      if (pred(...args)) { clearTimeout(t); emitter.off(event, handler); resolve(args[0]) }
    }
    emitter.on(event, handler)
  })
}

let pass = true
const ok = (cond, msg) => { console.log((cond ? '  ✅ ' : '  ❌ ') + msg); if (!cond) pass = false }

async function main () {
  const MATCH = 'WC-FINAL-ARG-FRA'
  console.log(`\nMatch room: "${MATCH}"\n`)

  // --- Creator starts first (creates the room) ---
  console.log('[1] Booting creator (Alice)…')
  const A = await new MatchRoom({ matchKey: MATCH, storage: dir('A'), name: 'Alice' }).ready()
  console.log(`    Alice ready — role=${A.role} room=${A.roomKey?.slice(0, 8)}… me=${A.me} writable=${A.base.writable}`)

  await WAIT(3000) // let the creator advertise before the joiner looks

  // --- Joiner boots, should discover Alice's room over the rendezvous swarm ---
  console.log('[2] Booting joiner (Bob)…')
  const B = await new MatchRoom({ matchKey: MATCH, storage: dir('B'), name: 'Bob' }).ready()
  console.log(`    Bob ready — role=${B.role} room=${B.roomKey?.slice(0, 8)}… me=${B.me} writable=${B.base.writable}`)

  // Wait for convergence: both peers end up in ONE room (via join OR migration).
  // This is timing-independent (rendezvous/migration handle any start order).
  console.log('[2b] Waiting for the two peers to converge on one room…')
  const tc = Date.now()
  while ((A.roomKey !== B.roomKey || !A.roomKey) && Date.now() - tc < 25000) await WAIT(300)
  ok(A.roomKey && A.roomKey === B.roomKey, `Peers converged on one room (key=${A.roomKey?.slice(0, 8)}…)`)
  if (!A.roomKey || A.roomKey !== B.roomKey) {
    console.log('\n❌ MILESTONE 2 FAILED: peers never converged.')
    await A.close(); await B.close(); fs.rmSync(ROOT, { recursive: true, force: true }); process.exit(1)
  }

  // Wait for both to be admitted as writers (decentralised admission).
  const t0 = Date.now()
  while ((!A.base.writable || !B.base.writable) && Date.now() - t0 < 20000) await WAIT(200)
  ok(A.base.writable && B.base.writable, 'Both peers are writers (addWriter over Autobase)')

  // --- Multi-writer chat BOTH ways ---
  console.log('[3] Multi-writer chat over Autobase…')
  const bGotA = once(B, 'message', (m) => m.from === 'Alice')
  await A.send('¡GOOOOOL! Argentina scores!')
  const m1 = await bGotA
  ok(m1 && m1.text.includes('Argentina'), 'Alice -> Bob: message delivered P2P via Autobase')

  const aGotB = once(A, 'message', (m) => m.from === 'Bob')
  await B.send('¡VAMOS! What a finish!')
  const m2 = await aGotB
  ok(m2 && m2.text.includes('VAMOS'), 'Bob -> Alice: message delivered P2P via Autobase (multi-writer)')

  // --- Reaction over shared state ---
  console.log('[4] Shared room state (reaction)…')
  const aGotReact = once(A, 'reaction', (r) => r.from === 'Bob')
  await B.react('🔥', m1.id)
  const r1 = await aGotReact
  ok(r1 && r1.emoji === '🔥', 'Bob -> Alice: reaction synced through Autobase view')

  // --- Hypercore clip sync, announced via Autobase, fetched P2P ---
  console.log('[5] Hypercore clip sync (P2P)…')
  const clipBytes = Buffer.from('FAKEMP4|highlight|arg-goal-87min|0xCAFEBABE|' + 'A'.repeat(2048))
  const aClip = once(A, 'clip', (c) => c.from === 'Bob')
  const bClip = once(B, 'clip', (c) => c.from === 'Alice')
  await A.shareClip(clipBytes, { title: 'ARG goal 87\'', mime: 'video/mp4' })
  const clipEv = await bClip
  ok(clipEv && clipEv.meta.title.includes('ARG goal'), 'Alice shared clip ref via Autobase')
  const fetched = await B.getClip(clipEv)
  ok(Buffer.isBuffer(fetched) && fetched.equals(clipBytes), 'Bob fetched Alice\'s clip bytes P2P via Hypercore (byte-identical)')

  // Bob also shares a clip back to prove symmetric clip sync.
  const back = Buffer.from('FAKEMP4|reaction|bob-celebration')
  await B.shareClip(back, { title: 'Bob celebrating' })
  const clipEv2 = await aClip
  const fetched2 = await A.getClip(clipEv2)
  ok(fetched2.equals(back), 'Alice fetched Bob\'s clip bytes P2P via Hypercore (symmetric)')

  // --- Eventual consistency: both rooms converge to the same view length ---
  console.log('[6] Eventual consistency…')
  await A.base.update(); await B.base.update()
  await A.base.view.update(); await B.base.view.update()
  await WAIT(500)
  ok(A.base.view.length === B.base.view.length, `Both peers converged to the same view length (${A.base.view.length} === ${B.base.view.length})`)

  console.log(pass ? '\n✅ MILESTONE 2 PASSED: P2P rendezvous + Autobase multi-writer chat + Hypercore clip sync. NO SERVER.' : '\n❌ MILESTONE 2 FAILED.')
  await A.close(); await B.close()
  fs.rmSync(ROOT, { recursive: true, force: true })
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error('TEST CRASHED:', e)
  try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
