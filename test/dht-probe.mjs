// Minimal cross-process probe: one SHARED DHT, TWO swarms on two topics.
// Usage: node test/dht-probe.mjs <role> <topic1Hex> <topic2Hex>
import DHT from '@hyperswarm/dht'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
const [role, t1, t2] = [process.argv[2], b4a.from(process.argv[3], 'hex'), b4a.from(process.argv[4], 'hex')]
const dht = new DHT(); dht.on('error', () => {})
const s1 = new Hyperswarm({ dht }); s1.on('error', () => {})
const s2 = new Hyperswarm({ dht }); s2.on('error', () => {})
s1.on('connection', (c) => { console.log(`S1-CONN ${role}`); c.on('error', () => {}); c.write(`s1-${role}`) })
s2.on('connection', (c) => { console.log(`S2-CONN ${role}`); c.on('error', () => {}); c.write(`s2-${role}`) })
await s1.join(t1, { client: true, server: true }).flushed()
await s2.join(t2, { client: true, server: true }).flushed()
console.log(`READY ${role}`)
setTimeout(() => { s1.destroy(); s2.destroy(); dht.destroy().then(() => process.exit(0)) }, 25000)
