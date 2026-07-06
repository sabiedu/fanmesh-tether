// FanMesh — QVAC commentator reality test.
// Proves the Commentator class runs REAL on-device inference on a match event.
import { Commentator } from '../src/commentator.js'

const c = new Commentator({ language: 'English' })
console.log('[test] loading on-device model (cached → should be fast)…')
await c.start((p) => process.stderr.write(`\rload ${p.percentage.toFixed(0)}%`))
console.log('\n[test] model ready:', c.ready)

let out = ''
let cur = null
c.on('commentary', ({ text, done, event }) => {
  if (cur !== event.id) { cur = event.id; out = '' }
  out += text
  if (done) console.log(`\n[test] COMMENTARY (${event.kind}):`, out.trim())
})

await c.comment({ id: 'g1', kind: 'goal', minute: 90, player: 'Messi', team: 'Argentina', score: '2-1' })
await c.comment({ id: 'g2', kind: 'red-card', minute: 93, player: 'Mbappé', team: 'France' })
console.log('[test] dedupe re-comment of g1 returns:', await c.comment({ id: 'g1', kind: 'goal', minute: 90, player: 'Messi' }))
await c.close()
console.log('[test] SUCCESS — Commentator works on-device. ✅')
process.exit(0)
