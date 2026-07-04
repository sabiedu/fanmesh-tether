// FanMesh — Milestone 1 probe: a single Hyperswarm peer.
// Joins a common topic, discovers peers via the DHT, greets + receives.
// Usage: node test/peer.mjs <name> <topicHex(64)>
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'

const name = process.argv[2] || 'anon'
const topicHex = process.argv[3]
if (!topicHex || topicHex.length !== 64) {
  console.error('TOPIC_ERR: need a 64-hex-char topic')
  process.exit(2)
}

const swarm = new Hyperswarm()
const me = b4a.toString(swarm.keyPair.publicKey, 'hex').slice(0, 8)
let gotMessage = false

swarm.on('connection', (conn) => {
  const peer = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 8)
  console.log(`CONNECTED ${name} <-> ${peer} (me=${me})`)
  conn.on('data', (data) => {
    const text = data.toString().trim()
    console.log(`RCVD [${name}] from ${peer}: ${text}`)
    if (!gotMessage) {
      gotMessage = true
      console.log(`SUCCESS ${name}`)
      setTimeout(() => { swarm.destroy().then(() => process.exit(0)) }, 300)
    }
  })
  conn.on('error', () => {})
  setTimeout(() => {
    try { conn.write(`MSG ${name}:hello from ${me}`) } catch {}
  }, 400)
})

process.once('SIGINT', () => swarm.destroy().then(() => process.exit(0)))
process.once('SIGTERM', () => swarm.destroy().then(() => process.exit(0)))

const topic = b4a.from(topicHex, 'hex')
const discovery = swarm.join(topic, { client: true, server: true })
await discovery.flushed()
console.log(`READY ${name} me=${me} topic=${topicHex.slice(0, 12)}… (announced to DHT)`)

setTimeout(() => {
  if (!gotMessage) {
    console.log(`TIMEOUT ${name}: no message received`)
    swarm.destroy().then(() => process.exit(1))
  }
}, 25000)
