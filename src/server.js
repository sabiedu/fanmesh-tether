// FanMesh — local app server.
//
// Ties the two tracks together and exposes them to a browser UI:
//   • Pears track (src/mesh.js):      a serverless MatchRoom (Hyperswarm +
//                                     Autobase + Hypercore) for fan chat,
//                                     reactions, live match events and clips.
//   • QVAC track (src/commentator.js): an on-device AI commentator that
//                                     narrates every shared match event locally.
//
// A tiny HTTP server serves the single-page UI (web/); a WebSocket streams
// every room + commentary event to the browser live, and accepts chat messages,
// match events, reactions and clips from it. Two fans each run this server,
// open http://localhost:PORT and meet inside the same match room — no server
// in between their messages or their AI.
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { WebSocketServer } from 'ws'
import { MatchRoom } from './mesh.js'
import { Commentator } from './commentator.js'

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

export class FanMeshApp {
  constructor ({ matchKey, storage, name, language, port = 3000, host = '127.0.0.1', model }) {
    this.matchKey = matchKey
    this.name = name
    this.language = language || 'English'
    this.port = port
    this.host = host
    this.room = new MatchRoom({ matchKey, storage, name })
    this.commentator = new Commentator({ language: this.language, model })
    this.clients = new Set()
    this.server = null
    this.wss = null
    this._aiState = { loaded: false, loading: false, pct: 0 }
  }

  async start ({ ai = true } = {}) {
    // --- P2P room up first (so peers discover fast) ---
    await this.room.ready()
    this._wireRoom()
    this._serve()

    const url = `http://${this.host}:${this.port}`
    console.log(`\n  ⚽  FanMesh  —  "${this.matchKey}"`)
    console.log(`  👤  ${this.name}  (role: ${this.room.role}, me: ${this.room.me})  ·  peers: ${this.room.peerCount}`)
    console.log(`  🌐  Open the room in your browser:  ${url}\n`)

    if (ai) {
      // On-device AI loads in the background; UI shows live progress.
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
    // Local on-device commentary → stream to UI tokens as they arrive.
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
        if (p === '/' || p === '') p = '/index.html'
        const filePath = join(WEB, p)
        // basic path traversal guard
        if (!filePath.startsWith(WEB)) { res.statusCode = 403; return res.end('forbidden') }
        const data = await readFile(filePath)
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' })
        res.end(data)
      } catch (e) {
        res.statusCode = 404
        res.end('not found')
      }
    })
    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on('connection', (ws) => this._onClient(ws))
    this.server.listen(this.port, this.host)
  }

  async _onClient (ws) {
    this.clients.add(ws)
    // initial snapshot
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
      messages: this.room.allMessages ? await this.room.allMessages() : []
    }))
    ws.on('message', async (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      try {
        if (msg.type === 'chat') {
          this.room.send(String(msg.text || '').slice(0, 1000))
        } else if (msg.type === 'react') {
          this.room.react(String(msg.emoji || '👍'), msg.ref)
        } else if (msg.type === 'matchEvent') {
          // A fan logs a live event → shared over Autobase → every peer's
          // on-device commentator narrates it. This is real, human-driven input.
          const ev = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...msg.event }
          this.room.postMatchEvent(ev)
        } else if (msg.type === 'shareClip') {
          // msg.bytes = base64
          const bytes = Buffer.from(msg.bytes, 'base64')
          await this.room.shareClip(bytes, msg.meta || {})
        } else if (msg.type === 'getClip') {
          // Browser wants the bytes of a peer's clip (P2P fetch via Hypercore).
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
          // rebuild commentator with the new language; reload model (cached)
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
    try { this.wss && this.wss.close() } catch {}
    try { this.server && this.server.closeAllConnections && this.server.closeAllConnections() } catch {}
    try { this.server && await this.server.close() } catch {}
    try { await this.commentator.close() } catch {}
    try { await this.room.close() } catch {}
  }
}

export default FanMeshApp
