import { spawn } from 'node:child_process'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
const t1 = b4a.toString(crypto.randomBytes(32), 'hex')
const t2 = b4a.toString(crypto.randomBytes(32), 'hex')
console.log('topics:', t1.slice(0, 8), '/', t2.slice(0, 8))
function peer (role) {
  const p = spawn(process.execPath, ['test/dht-probe.mjs', role, t1, t2], { cwd: process.cwd() })
  p.stdout.on('data', d => process.stdout.write(`[${role}] ${d}`))
  p.stderr.on('data', d => process.stderr.write(`[${role}!] ${d}`))
  return p
}
const A = peer('A'); await new Promise(r => setTimeout(r, 5000)); const B = peer('B')
await new Promise(r => setTimeout(r, 22000))
try { A.kill() } catch {}; try { B.kill() } catch {}
process.exit(0)
