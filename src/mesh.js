// FanMesh — Peer-to-peer match room core (Pears Stack).
//
// Building blocks (all from the Pears Stack — NO WebRTC, NO central server):
//   • Hyperswarm  — peer discovery (a "rendezvous" swarm keyed by match name,
//                   and a "base" swarm keyed by the Autobase discovery key)
//   • Autobase    — multi-writer, eventually-consistent shared room state.
//                   Every fan is an indexer-writer (decentralised admission).
//                   Carries chat messages, reactions, match events + clip refs.
//   • Hypercore   — binary clip sync (each peer has a clip core; refs shared
//                   through the Autobase so peers replicate them on demand).
//   • Corestore   — on-disk store holding every core; store.replicate(conn)
//                   streams ALL cores over a connection.
//
// Two fans only need to agree on a match name (e.g. "ARG-FRA-FINAL") to meet.
// Rendezvous is race-free: the smallest-discovery-key peer present creates the
// room and others join it; a truly-alone peer creates after a longer timeout.
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import DHT from '@hyperswarm/dht'
import Autobase from 'autobase'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const hex = (b) => (b ? b.toString('hex') : '')
const fromHex = (h) => (h ? b4a.from(h, 'hex') : null)
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms))
const safeLeave = (swarm, key) => { if (!swarm || !key) return; try { const p = swarm.leave(key); if (p && typeof p.then === 'function') p.catch(() => {}) } catch {} }
const DBG = !['', '0', 'false'].includes(String(process.env.FANMESH_DEBUG || '').toLowerCase())
const log = (...a) => { if (DBG) console.log(...a) }

// Deterministic 32-byte Hyperswarm topic from a human match name.
export function matchTopic (matchKey) {
  return crypto.hash(b4a.from('fanmesh/room/v1/' + String(matchKey), 'utf8'))
}

// Deterministic reducer: linearises every writer's events into one ordered view.
// MUST be pure/deterministic (Autobase re-applies on reorder).
async function applyRoom (nodes, view, host) {
  for (const node of nodes) {
    const value = node.value
    if (!value || typeof value !== 'object') continue
    // In-band, decentralised writer admission: any indexer can vouch for a peer.
    if (value.type === 'addWriter' && value.key) {
      try { await host.addWriter(fromHex(value.key), { indexer: true }) } catch {}
      continue
    }
    // Normal room events land in the shared, ordered view.
    await view.append(value)
  }
}

/**
 * A serverless match room. Fans find each other by match name over Hyperswarm,
 * merge state with Autobase, and sync clips with Hypercore. No server anywhere.
 */
export class MatchRoom extends EventEmitter {
  constructor ({ matchKey, storage, name = 'Fan' }) {
    super()
    this.matchKey = String(matchKey)
    this.name = name
    this.storage = storage

    this.store = new Corestore(path.join(storage, 'corestore'))
    this.dht = new DHT() // shared by both swarms -> one bootstrap, fast discovery
    this.dht.on('error', () => {})
    this.swarmDisc = new Hyperswarm({ dht: this.dht }) // rendezvous: invite exchange
    this.swarmDisc.on('error', () => {})
    this.swarmBase = null            // replication: Autobase + clips (set later)
    this.base = null
    this.clipCore = null
    this.role = null
    this.peerKeys = new Set()
    this.seenPeers = new Set()
    this.discConns = new Set()
    this.knownWriters = new Set()
    this.admitted = new Set()
    this._pendingInvite = null
    this._lastViewLen = 0
    this._closed = false
    this._migrating = false
    this._helloTimer = null
  }

  get me () { return this.base ? hex(this.base.local.key).slice(0, 8) : '--------' }
  get roomKey () { return this.base ? hex(this.base.key) : null }
  get peerCount () { return this.peerKeys.size }

  async ready () {
    await this.store.ready()

    // --- Rendezvous swarm (match name -> meet other fans) --------------------
    this.topic = matchTopic(this.matchKey)
    this.swarmDisc.on('connection', (conn, info) => {
      if (info && info.publicKey) this.seenPeers.add(hex(info.publicKey))
      log(`[${this.name}] disc-conn from ${info && info.publicKey ? hex(info.publicKey).slice(0, 8) : '?'} seen=${this.seenPeers.size}`)
      this._onDiscoveryConn(conn)
    })
    await this.swarmDisc.join(this.topic, { client: true, server: true }).flushed()
    this._helloTimer = setInterval(() => this._broadcastHello(), 1000)

    await this._electAndOpen()
    await this.base.ready()
    this.knownWriters.add(hex(this.base.local.key))

    // Per-peer clip core (binary), replicated through the same store.
    this.clipCore = this.store.get({ name: 'fanmesh-clips' })
    await this.clipCore.ready()

    await this._attachBaseSwarm()

    this.base.on('update', () => this._onBaseUpdate())
    await this.base.update()
    await this._onBaseUpdate()

    // If we are already a writer, vouch for everyone we have heard of.
    await this._admitKnown()
    return this
  }

  // Race-free room creation:
  //  • if an invite appears -> JOIN immediately;
  //  • else the smallest-discovery-key peer among those present CREATES;
  //  • a truly-alone peer (no peers seen) creates after a longer timeout.
  async _electAndOpen () {
    const myPub = hex(this.swarmDisc.keyPair.publicKey)
    const start = Date.now()
    while (Date.now() - start < 9000) {
      if (this._pendingInvite) {
        log(`[${this.name}] JOIN room ${this._pendingInvite.key.slice(0, 8)}`)
        await this._openBase(this._pendingInvite.key, this._pendingInvite.enc)
        this.role = 'joiner'
        return
      }
      const elapsed = Date.now() - start
      const seen = [...this.seenPeers]
      const leader = seen.length === 0 || seen.every((p) => myPub <= p)
      if (seen.length > 0 && leader && elapsed > 1500) {
        log(`[${this.name}] CREATE (leader, seen=${seen.length})`)
        await this._openBase(null, crypto.randomBytes(32))
        this.role = 'creator'
        return
      }
      if (seen.length === 0 && elapsed > 6000) {
        log(`[${this.name}] CREATE (alone, no peers seen)`)
        await this._openBase(null, crypto.randomBytes(32))
        this.role = 'creator'
        return
      }
      await SLEEP(150)
    }
    log(`[${this.name}] CREATE (fallback)`)
    await this._openBase(null, crypto.randomBytes(32))
    this.role = 'creator'
  }

  // Open the replication swarm on the current base's discovery key.
  _onBaseConnection (conn, info) {
    log(`[${this.name}] base peer connected: ${info && info.publicKey ? hex(info.publicKey).slice(0, 8) : '?'}`)
    this.store.replicate(conn) // streams every core in the store
    const pk = hex(info.publicKey)
    this.peerKeys.add(pk)
    this.emit('peers', this.peerCount)
    conn.on('close', () => { this.peerKeys.delete(pk); this.emit('peers', this.peerCount) })
    conn.on('error', () => {})
  }

  _makeBaseSwarm () {
    const sw = new Hyperswarm({ dht: this.dht })
    sw.on('error', () => {})
    sw.on('connection', (conn, info) => this._onBaseConnection(conn, info))
    return sw
  }

  async _attachBaseSwarm () {
    this.swarmBase = this._makeBaseSwarm()
    await this.swarmBase.join(this.base.discoveryKey, { client: true, server: true }).flushed()
    this._broadcastHello()
  }

  // Split-brain healing: if two rooms exist on the network (e.g. two fans
  // started before the DHT routed them together), everyone migrates to the
  // lexicographically SMALLEST room key. Deterministic → all fans converge on
  // exactly one room regardless of who booted first or how slow discovery was.
  async _migrateTo (keyHex, encHex) {
    if (this._migrating || this._closed) return
    if (this.roomKey && keyHex >= this.roomKey) return
    this._migrating = true
    log(`[${this.name}] MIGRATE ${this.roomKey ? this.roomKey.slice(0, 8) : '-'} -> ${keyHex.slice(0, 8)} (smaller room)`)
    safeLeave(this.swarmBase, this.base && this.base.discoveryKey)
    try { this.swarmBase && await this.swarmBase.destroy() } catch {}
    try { this.base && await this.base.close() } catch {}
    this.base = null
    this.swarmBase = null
    this.peerKeys.clear()
    this.knownWriters.clear()
    this.admitted.clear()
    this._lastViewLen = 0
    try {
      await this._openBase(keyHex, encHex)
      await this.base.ready()
      this.knownWriters.add(hex(this.base.local.key))
      this.swarmBase = this._makeBaseSwarm()
      await this.swarmBase.join(this.base.discoveryKey, { client: true, server: true }).flushed()
      this.base.on('update', () => this._onBaseUpdate())
      await this.base.update()
      await this._onBaseUpdate()
      await this._admitKnown()
      this.emit('peers', this.peerCount)
    } catch (e) {
      log(`[${this.name}] migrate failed: ${e && e.message}`)
    } finally {
      this._migrating = false
    }
  }

  async _openBase (bootstrapHex, encKeyOrHex) {
    const opts = {
      open: (s) => s.get({ name: 'fanmesh-view', valueEncoding: 'json' }),
      apply: applyRoom,
      valueEncoding: 'json',
      ackInterval: 1000
    }
    if (encKeyOrHex) {
      opts.encryptionKey = typeof encKeyOrHex === 'string' ? fromHex(encKeyOrHex) : encKeyOrHex
      opts.encrypted = true
    }
    const bootstrap = bootstrapHex ? fromHex(bootstrapHex) : null
    this.base = new Autobase(this.store, bootstrap, opts)
  }

  // --- Rendezvous handshake (raw newline-JSON; not replicated) ---------------
  _onDiscoveryConn (conn) {
    this.discConns.add(conn)
    let buf = ''
    conn.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        try { this._handleHello(JSON.parse(line)) } catch {}
      }
    })
    conn.on('error', () => {})
    conn.on('close', () => this.discConns.delete(conn))
    this._sendHello(conn)
  }

  hello () {
    return {
      app: 'fanmesh', v: 1, name: this.name,
      haveRoom: !!(this.base && this.base.key),
      key: this.roomKey,
      enc: this.base && this.base.encryptionKey ? hex(this.base.encryptionKey) : '',
      writer: this.base && this.base.local ? hex(this.base.local.key) : ''
    }
  }

  _sendHello (conn) { try { conn.write(JSON.stringify(this.hello()) + '\n') } catch {} }
  _broadcastHello () { if (this._closed) return; for (const c of this.discConns) this._sendHello(c) }

  _handleHello (h) {
    if (!h || h.app !== 'fanmesh' || h.v !== 1) return
    log(`[${this.name}] hello from ${h.name || '?'} haveRoom=${h.haveRoom} key=${h.key ? h.key.slice(0, 8) : '-'}`)
    if (!this.base && h.haveRoom && h.key) this._pendingInvite = { key: h.key, enc: h.enc }
    if (h.writer && !this.knownWriters.has(h.writer)) {
      this.knownWriters.add(h.writer)
      this._admitKnown().catch(() => {})
    }
  }

  // Append addWriter records for every known peer we haven't vouched for yet.
  // Only writers/indexers can append. Once a joiner is admitted as indexer it
  // becomes writable and starts vouching too -> fully decentralised admission.
  async _admitKnown () {
    if (!this.base || !this.base.writable) return
    for (const w of [...this.knownWriters]) {
      if (w === hex(this.base.local.key) || this.admitted.has(w)) continue
      this.admitted.add(w)
      try {
        await this.base.append({ type: 'addWriter', key: w })
        await this.base.update()
      } catch {}
    }
  }

  async _onBaseUpdate () {
    if (!this.base || !this.base.view) return
    try { await this.base.view.update() } catch {}
    const len = this.base.view.length
    for (let i = this._lastViewLen; i < len; i++) {
      let ev
      try { ev = await this.base.view.get(i) } catch { continue }
      if (!ev) continue
      this.emit('event', ev)
      if (ev.type === 'chat') this.emit('message', ev)
      else if (ev.type === 'reaction') this.emit('reaction', ev)
      else if (ev.type === 'clip') this.emit('clip', ev)
      else if (ev.type === 'match') this.emit('match', ev)
    }
    this._lastViewLen = len
    // Newly admitted peers become writable here -> vouch for others.
    if (this.base.writable) this._admitKnown().catch(() => {})
  }

  // --- Public room actions ---------------------------------------------------
  async send (text) {
    const ev = { type: 'chat', id: crypto.randomBytes(8).toString('hex'), from: this.name, writer: hex(this.base.local.key), text: String(text), ts: Date.now() }
    await this.base.append(ev)
    await this.base.update()
    return ev
  }

  async react (emoji, refId = null) {
    const ev = { type: 'reaction', emoji, ref: refId, from: this.name, ts: Date.now() }
    await this.base.append(ev)
    await this.base.update()
    return ev
  }

  async postMatchEvent (event) {
    const ev = { type: 'match', ...event, from: this.name, ts: Date.now() }
    await this.base.append(ev)
    await this.base.update()
    return ev
  }

  // Append clip bytes to our own Hypercore + share a reference in the Autobase.
  async shareClip (bytes, meta = {}) {
    const buf = b4a.isBuffer(bytes) ? bytes : b4a.from(bytes)
    const index = this.clipCore.length // index of the block we are about to append
    await this.clipCore.append(buf)
    const ev = {
      type: 'clip', from: this.name,
      key: hex(this.clipCore.key), index, size: buf.length,
      meta, ts: Date.now()
    }
    await this.base.append(ev)
    await this.base.update()
    return ev
  }

  // Fetch a clip referenced in the Autobase from whoever has it (P2P, no server).
  // Opening the key in our store makes Corestore replicate it over an existing
  // connection; we then wait for the block to download.
  async getClip (clipEvent) {
    const core = this.store.get(fromHex(clipEvent.key))
    await core.ready()
    const deadline = Date.now() + 20000
    while (core.length <= clipEvent.index && Date.now() < deadline) {
      await core.update({ wait: true }).catch(() => {})
      if (core.length <= clipEvent.index) await SLEEP(150)
    }
    return core.get(clipEvent.index, { wait: true })
  }

  async allMessages () {
    if (!this.base || !this.base.view) return []
    await this.base.view.update()
    const out = []
    for (let i = 0; i < this.base.view.length; i++) {
      const v = await this.base.view.get(i)
      if (v && v.type === 'chat') out.push(v)
    }
    return out
  }

  async close () {
    if (this._closed) return
    this._closed = true
    // 1. Stop generating new traffic first (timer + accept no new conns).
    if (this._helloTimer) clearInterval(this._helloTimer)
    this._helloTimer = null
    // Stop advertising so no further peers try to dial us during teardown.
    safeLeave(this.swarmDisc, this.topic)
    safeLeave(this.swarmBase, this.base && this.base.discoveryKey)
    // 2. Destroy the replication + discovery swarms (their connections close).
    try { this.swarmBase && await this.swarmBase.destroy() } catch {}
    try { await this.swarmDisc.destroy() } catch {}
    // 3. Drain: Hyperswarm schedules connect/peer callbacks on the event loop
    //    during the destroys above. Give them a tick to resolve against the
    //    still-live DHT before we tear it down — this is the race that used to
    //    throw "Node destroyed" as an unhandled rejection.
    await SLEEP(250)
    // 4. Now the DHT itself is safe to destroy.
    try { await this.dht.destroy() } catch {}
    try { this.base && await this.base.close() } catch {}
    try { await this.store.close() } catch {}
    this.emit('close')
  }
}

export default MatchRoom
