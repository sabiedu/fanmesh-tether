// Focused debug: does a Hypercore opened by key on peer B replicate the block
// that peer A appended, over the same swarmBase (Corestore.replicate) connection?
import { MatchRoom } from '../src/mesh.js'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import b4a from 'b4a'

const ROOT = path.join(os.tmpdir(), `fanmesh-clip-${Date.now()}`)
for (const d of ['A', 'B']) fs.mkdirSync(path.join(ROOT, d), { recursive: true })
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms))

const A = await new MatchRoom({ matchKey: 'CLIP-DEBUG', storage: path.join(ROOT, 'A'), name: 'Alice' }).ready()
await WAIT(2500)
const B = await new MatchRoom({ matchKey: 'CLIP-DEBUG', storage: path.join(ROOT, 'B'), name: 'Bob' }).ready()
console.log('A base.writable=', A.base.writable, 'B base.writable=', B.base.writable)
console.log('A.peerCount=', A.peerCount, 'B.peerCount=', B.peerCount)

// admit loop
const t0 = Date.now(); while (!B.base.writable && Date.now()-t0<12000) await WAIT(200)
console.log('after admit: B base.writable=', B.base.writable)

const buf = b4a.from('HELLO-CLIP-DATA')
const ev = await A.shareClip(buf, { t: 'x' })
console.log('shared clip: key=', ev.key.slice(0,8), 'index=', ev.index, 'A.clipCore.length=', A.clipCore.length, 'A.clipCore.writable=', A.clipCore.writable)

await WAIT(1000)
// Bob opens the core by key
const core = B.store.get(b4a.from(ev.key, 'hex'))
await core.ready()
console.log('B opened core: writable=', core.writable, 'length=', core.length, 'sessions=', core.sessions?.length)
for (let i=0;i<20;i++){
  await core.update({ wait: true }).catch(e=>console.log('update err', e.message))
  console.log('  tick', i, 'len=', core.length)
  if (core.length > 0) break
  await WAIT(300)
}
try { const blk = await core.get(ev.index, { wait: true }); console.log('GOT BLOCK len=', blk.length, b4a.toString(blk)) }
catch(e){ console.log('GET FAILED', e.message) }

await A.close(); await B.close(); fs.rmSync(ROOT, { recursive:true, force:true })
