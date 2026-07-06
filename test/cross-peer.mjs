// FanMesh — cross-process convergence probe. Boots one MatchRoom.
// Usage: node test/cross-peer.mjs <name> <matchKey> <storageDir>
import { MatchRoom } from '../src/mesh.js'
const [name, matchKey, storage] = [process.argv[2], process.argv[3], process.argv[4]]
const r = await new MatchRoom({ matchKey, storage, name }).ready()
console.log(`BOOT ${name} role=${r.role} room=${(r.roomKey || '').slice(0, 8)} me=${r.me} peers=${r.peerCount} seen=${r.seenPeers.size} disc=${r.discConns.size}`)
r.on('peers', (c) => console.log(`PEERS ${name} count=${c} room=${(r.roomKey || '').slice(0, 8)}`))
setTimeout(() => { console.log(`FINAL ${name} role=${r.role} room=${(r.roomKey || '').slice(0, 8)} peers=${r.peerCount} seen=${r.seenPeers.size} disc=${r.discConns.size} writable=${r.base.writable}`); r.close().then(() => process.exit(0)) }, 40000)
