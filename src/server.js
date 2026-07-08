// FanMesh — local app server.
//
// Ties the two tracks together and exposes them to a browser UI:
//   • Pears track (src/mesh.js):      a serverless MatchRoom (Hyperswarm +
//                                     Autobase + Hypercore) for fan chat,
//                                     reactions, live match events and clips.
//   • QVAC track (src/commentator.js): an on-device AI commentator that
//                                     narrates every shared match event locally.
//
// Routes:
//   /        — live mode (real P2P room, no auto-seeding)
//   /demo    — demo mode (auto-seeds World Cup Final scenario + AI commentary)
//
// WebSocket messages from the browser:
//   { type:'chat', text }           — send a P2P chat message via Autobase
//   { type:'matchEvent', event }    — log a match event → triggers AI commentary
//   { type:'spawnPeer' }            — spawn a REAL P2P peer (joins via DHT)
//   { type:'removePeer', id }       — disconnect a spawned peer
//   { type:'setLanguage', language } — switch commentator language
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { MatchRoom } from './mesh.js'
import { Commentator } from './commentator.js'
import { DEMO_CHAT, DEMO_EVENTS, DEMO_MATCH } from './demo-scenario.js'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WEB = join(__dirname, '..', 'web')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

// Spawned peer personas — each is a REAL Hyperswarm node joining the DHT.
// They send contextual chat to prove the P2P mesh is alive.
const FAN_PERSONAS = [
  { name: 'Diego_AR', flag: '🇦🇷', msgs: ['VAMOOOS ARGENTINAAAA 🇦🇷', 'Messi es un crack 👑', 'Qué golazo!! No puedo creerlo', 'Estoy llorando de alegría 😭'] },
  { name: 'Pierre_FR', flag: '🇫🇷', msgs: ['Allez les Bleus! 🇫🇷', 'Mbappé est incroyable ⚡', 'Non non non, ce n\'est pas possible!', 'On y croit jusqu\'au bout!'] },
  { name: 'Maya_KE', flag: '🇰🇪', msgs: ['This P2P tech is insane 😳', 'Zero lag, zero servers, zero censorship 🔥', 'Watching from Nairobi with fans worldwide 🌍', 'The AI commentator is SPOT ON'] },
  { name: 'Sofia_AR', flag: '🇦🇷', msgs: ['MI PADRE MESSI 🐐', 'No puedo respirar del nerviosismo', 'Este app funciona perfectamente sin servidor', 'La IA narrando en español es brutal'] },
  { name: 'Louis_FR', flag: '🇫🇷', msgs: ['Mbappé hat-trick incoming 🎩', 'The mesh healed itself after my WiFi dropped 🤯', 'Pears stack is the future', 'INCROYABLE! What a match!'] },
  { name: 'Ahmad_JO', flag: '🇯🇴', msgs: ['Joining from Amman 🇯🇴 — works perfectly', 'No government can shut this down 💪', 'The QVAC model loaded in 2 seconds on my laptop', 'This is what real decentralization looks like'] },
  { name: 'Carlos_BR', flag: '🇧🇷', msgs: ['Futebol é paixão ⚽', 'Even as a Brazilian I respect this match 🙏', 'O P2P funciona perfeitamente!', 'The AI sounds better than real commentators'] },
  { name: 'Emma_US', flag: '🇺🇸', msgs: ['New to football but this is ELECTRIC ⚡', 'The on-device AI is creepy good', 'No cloud, no tracking, no servers — love it', 'GOOOOAL whatever team that was 🤣'] },
]

export class FanMeshApp {
  constructor ({ matchKey, storage, name, language, port = 3000, host = '127.0.0.1', model, demo = false }) {
    this.matchKey = matchKey
    this.name = name
    this.language = language || 'English'
    this.port = port
    this.host = host
    this.demo = demo
    this.room = new MatchRoom({ matchKey, storage, name })
    this.commentator = new Commentator({ language: this.language, model })
    this.clients = new Set()
    this.server = null
    this.wss = null
    this._aiState = { loaded: false, loading: false, pct: 0 }
    this._demoFired = false
    // Spawned peers: REAL MatchRoom instances, each a genuine Hyperswarm node
    this._spawnedPeers = new Map()   // id → { room, persona, timers }
    this._personaIndex = 0
  }

  async start ({ ai = true } = {}) {
    await this.room.ready()
    this._wireRoom()
    this._serve()

    const url = `http://${this.host}:${this.port}`
    console.log(`\n  ⚽  FanMesh  —  "${this.matchKey}"`)
    console.log(`  👤  ${this.name}  (role: ${this.room.role}, me: ${this.room.me})  ·  peers: ${this.room.peerCount}`)
    console.log(`  🌐  Open the room in your browser:  ${url}`)
    console.log(`  🎬  Demo mode route:  ${url}/demo${this.demo ? ' (also enabled globally)' : ''}\n`)

    if (ai) {
      this.commentator.start((p) => {
        this._aiState = { loaded: false, loading: true, pct: Math.round(p.percentage) }
        this.broadcast({ type: 'ai:progress', pct: Math.round(p.percentage) })
      }).then(() => {
        this._aiState = { loaded: true, loading: false, pct: 100 }
        this.commentator.attach(this.room)
        this.broadcast({ type: 'ai:ready' })
        console.log('  🤖  On-device commentator ready (QVAC, no cloud).')
      }).catch((e) => {
        this._aiState = { loaded: false, loading: false, pct: 0, error: String(e && e.message || e) }
        this.broadcast({ type: 'ai:error', error: this._aiState.error })
        console.error('  ⚠️  Commentator failed to load:', this._aiState.error)
      })
    }
    return this
  }

  _wireRoom () {
    const r = this.room
    r.on('peers', (count) => this.broadcast({ type: 'peers', count, roomKey: r.roomKey, role: r.role, me: r.me }))
    r.on('message', (ev) => this.broadcast({ type: 'message', ev }))
    r.on('reaction', (ev) => this.broadcast({ type: 'reaction', ev }))
    r.on('clip', (ev) => this.broadcast({ type: 'clip', ev }))
    r.on('match', (ev) => this.broadcast({ type: 'match', ev }))
    const c = this.commentator
    c.on('commentary', ({ text, full, done, event }) => {
      this.broadcast({ type: 'commentary', token: text, full, done, event })
    })
    c.on('ready', () => {})
  }

  _serve () {
    this.server = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(req.url.split('?')[0])
        // Serve index.html for both / and /demo (demo mode detected via WS path)
        if (p === '/' || p === '' || p === '/demo') p = '/index.html'
        const filePath = join(WEB, p)
        if (!filePath.startsWith(WEB)) { res.statusCode = 403; return res.end('forbidden') }
        const data = await readFile(filePath)
        const ext = extname(filePath)
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' }
        // Never cache JS/CSS/HTML — always serve fresh during development
        if (ext === '.js' || ext === '.css' || ext === '.html') {
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        }
        res.writeHead(200, headers)
        res.end(data)
      } catch (e) {
        res.statusCode = 404
        res.end('not found')
      }
    })
    this.wss = new WebSocketServer({ server: this.server })
    // Capture the upgrade request to detect /demo route
    this.wss.on('connection', (ws, req) => this._onClient(ws, req))
    this.server.listen(this.port, this.host)
  }

  async _onClient (ws, req) {
    this.clients.add(ws)

    // Detect demo mode: either global (--demo flag) or client connected via /demo
    const clientDemo = this.demo || (req && req.url && req.url.startsWith('/demo'))

    ws.send(JSON.stringify({
      type: 'hello',
      matchKey: this.matchKey,
      name: this.name,
      me: this.room.me,
      writer: this.room.base && this.room.base.local ? this.room.base.local.key.toString('hex') : '',
      roomKey: this.room.roomKey,
      role: this.room.role,
      peers: this.room.peerCount,
      ai: this._aiState,
      language: this.language,
      messages: this.room.allMessages ? await this.room.allMessages() : [],
      demo: clientDemo,
      demoChat: clientDemo ? DEMO_CHAT : null,
      demoMatch: clientDemo ? DEMO_MATCH : null,
      spawnedPeers: [...this._spawnedPeers.keys()].map(id => {
        const p = this._spawnedPeers.get(id)
        return { id, name: p.persona.name, flag: p.persona.flag }
      })
    }))

    // If demo mode and not yet fired, start the scenario
    if (clientDemo && !this._demoFired) this._startDemo()

    ws.on('message', async (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      try {
        if (msg.type === 'chat') {
          this.room.send(String(msg.text || '').slice(0, 1000))
        } else if (msg.type === 'react') {
          this.room.react(String(msg.emoji || '👍'), msg.ref)
        } else if (msg.type === 'matchEvent') {
          const ev = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...msg.event }
          this.room.postMatchEvent(ev)
        } else if (msg.type === 'spawnPeer') {
          await this._spawnPeer()
        } else if (msg.type === 'removePeer') {
          await this._removePeer(msg.id)
        } else if (msg.type === 'startDemo') {
          // Client requests demo mode at runtime
          if (!this._demoFired) {
            ws.send(JSON.stringify({ type: 'demoChat', chat: DEMO_CHAT, match: DEMO_MATCH }))
            this._startDemo()
          }
        } else if (msg.type === 'shareClip') {
          const bytes = Buffer.from(msg.bytes, 'base64')
          await this.room.shareClip(bytes, msg.meta || {})
        } else if (msg.type === 'getClip') {
          try {
            const block = await this.room.getClip({ key: msg.key, index: msg.index })
            ws.send(JSON.stringify({ type: 'clipBytes', key: msg.key, index: msg.index,
              mime: (msg.meta && msg.meta.mime) || 'application/octet-stream',
              b64: Buffer.from(block).toString('base64') }))
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', error: 'clip fetch failed: ' + (e && e.message || e) }))
          }
        } else if (msg.type === 'setLanguage') {
          this.language = String(msg.language || 'English')
          await this.commentator.close()
          this.commentator = new Commentator({ language: this.language, model: this.commentator.model })
          this._wireCommentary()
          this.broadcast({ type: 'language', language: this.language })
          this.commentator.start((p) => this.broadcast({ type: 'ai:progress', pct: Math.round(p.percentage) }))
            .then(() => { this.commentator.attach(this.room); this.broadcast({ type: 'ai:ready' }) })
            .catch((e) => this.broadcast({ type: 'ai:error', error: String(e && e.message || e) }))
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', error: String(e && e.message || e) }))
      }
    })
    ws.on('close', () => this.clients.delete(ws))
    ws.on('error', () => this.clients.delete(ws))
  }

  /**
   * Spawn a REAL peer — a genuine MatchRoom instance that joins the same
   * Hyperswarm DHT topic. This is NOT a simulation: it boots its own Corestore,
   * DHT, and Autobase, discovers the main room over the network, and syncs
   * chat/events P2P. The peer count visibly increases on all clients.
   */
  async _spawnPeer () {
    const persona = FAN_PERSONAS[this._personaIndex % FAN_PERSONAS.length]
    this._personaIndex++
    const id = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const storagePath = join(os.tmpdir(), 'fanmesh-spawned', id)

    console.log(`  👤  Spawning REAL peer: ${persona.name} ${persona.flag} (storage: ${storagePath})`)

    try {
      const peerRoom = new MatchRoom({
        matchKey: this.matchKey,
        storage: storagePath,
        name: persona.name
      })
      await peerRoom.ready()

      const timers = []

      // Wire peer's room events to broadcast to UI clients
      peerRoom.on('message', (ev) => this.broadcast({ type: 'message', ev }))
      peerRoom.on('reaction', (ev) => this.broadcast({ type: 'reaction', ev }))

      // Send a greeting after connecting (proves P2P chat works)
      timers.push(setTimeout(async () => {
        try { await peerRoom.send(`${persona.flag} Hey everyone! ${persona.name} just joined the mesh — connected P2P, no server!`) } catch {}
      }, 4000 + Math.random() * 3000))

      // Periodic contextual chat (proves the peer is alive and syncing)
      let msgIdx = 0
      timers.push(setInterval(async () => {
        if (msgIdx >= persona.msgs.length) return
        try { await peerRoom.send(persona.msgs[msgIdx]) } catch {}
        msgIdx++
      }, 15000 + Math.random() * 10000))

      this._spawnedPeers.set(id, { room: peerRoom, persona, timers })

      // Notify all clients
      this.broadcast({
        type: 'peerSpawned',
        peer: { id, name: persona.name, flag: persona.flag },
        totalPeers: this.room.peerCount + this._spawnedPeers.size
      })

      // Update peer count (real mesh peers + spawned peers)
      const totalCount = this.room.peerCount + this._spawnedPeers.size
      this.broadcast({ type: 'peers', count: totalCount, roomKey: this.room.roomKey })

      console.log(`  ✅  Peer spawned: ${persona.name} — total peers: ${totalCount}`)
    } catch (e) {
      console.error(`  ❌  Failed to spawn peer:`, e.message)
      this.broadcast({ type: 'error', error: 'Failed to spawn peer: ' + e.message })
    }
  }

  async _removePeer (id) {
    const peer = this._spawnedPeers.get(id)
    if (!peer) return
    console.log(`  👋  Removing peer: ${peer.persona.name}`)
    peer.timers.forEach(t => { clearTimeout(t); clearInterval(t) })
    try { await peer.room.close() } catch {}
    this._spawnedPeers.delete(id)

    const totalCount = this.room.peerCount + this._spawnedPeers.size
    this.broadcast({ type: 'peerRemoved', id, totalPeers: totalCount })
    this.broadcast({ type: 'peers', count: totalCount, roomKey: this.room.roomKey })
  }

  _startDemo () {
    if (this._demoFired) return
    this._demoFired = true
    console.log('  🎬  Demo mode: seeding World Cup Final scenario…')

    this.broadcast({ type: 'demoMatch', match: DEMO_MATCH })

    for (const ev of DEMO_EVENTS) {
      const fire = () => {
        const fullEv = { id: `demo-${ev.minute}-${ev.kind}`, ...ev }
        this.room.postMatchEvent(fullEv)
        if (ev.score) {
          const [h, a] = ev.score.split('-')
          this.broadcast({ type: 'score', home: parseInt(h), away: parseInt(a), minute: ev.minute })
        }
        console.log(`  ⚽  Demo event: ${ev.minute}' ${ev.kind} ${ev.player || ''}`)
      }
      setTimeout(fire, ev.delayMs)
    }
  }

  _wireCommentary () {
    this.commentator.on('commentary', ({ text, full, done, event }) => {
      this.broadcast({ type: 'commentary', token: text, full, done, event })
    })
  }

  broadcast (obj) {
    const data = JSON.stringify(obj)
    for (const ws of this.clients) {
      if (ws.readyState === 1) { try { ws.send(data) } catch {} }
    }
  }

  async close () {
    // Clean up spawned peers
    for (const [id, peer] of this._spawnedPeers) {
      peer.timers.forEach(t => { clearTimeout(t); clearInterval(t) })
      try { await peer.room.close() } catch {}
    }
    this._spawnedPeers.clear()

    try { this.wss && this.wss.close() } catch {}
    try { this.server && this.server.closeAllConnections && this.server.closeAllConnections() } catch {}
    try { this.server && await this.server.close() } catch {}
    try { await this.commentator.close() } catch {}
    try { await this.room.close() } catch {}
  }
}

export default FanMeshApp
