// FanMesh — browser client (broadcast dashboard edition).
// Talks to the local app server over WebSocket.
// Renders: live scoreboard, P2P chat, on-device AI commentary (token stream),
// match event log, network visualization, scrolling ticker.
const $ = (id) => document.getElementById(id)
const feed = $('feed')
const fmtTime = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const AV_COLORS = ['#13c08b', '#f5c451', '#5db4ff', '#ff8fab', '#c79bff', '#7bd3a0', '#ff9a3c', '#5ce1e6']
function colorFor (s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length] }
function initial (s) { return (s || '?').trim().charAt(0).toUpperCase() || '?' }
function esc (s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML }

// === STATE ===
let ws = null
let myWriter = ''
let myName = ''
let msgCount = 0
let demoMode = false
let scoreHome = 0, scoreAway = 0
let tickerItems = []

const KINDS = [
  ['goal', '⚽ Goal'], ['penalty', '🥅 Penalty'], ['save', '🧤 Save'], ['chance', '🎯 Chance'],
  ['shot', '👞 Shot'], ['corner', '🚩 Corner'], ['yellow-card', '🟨 Yellow'], ['red-card', '🟥 Red'],
  ['substitution', '🔁 Sub'], ['foul', '🤚 Foul'], ['kickoff', ' kickoff'], ['halftime', '⏸ Half-time'], ['fulltime', '⏹ Full-time'], ['var', '📺 VAR']
]
const KIND_ICONS = {}
KINDS.forEach(([k, label]) => { KIND_ICONS[k] = label.split(' ')[0] })

let selectedKind = 'goal'
const kindsEl = $('kinds')
KINDS.forEach(([k, label]) => {
  const b = document.createElement('button')
  b.className = 'ek-btn'
  b.textContent = label
  if (k === selectedKind) b.classList.add('on')
  b.onclick = () => { selectedKind = k; [...kindsEl.children].forEach(c => c.classList.remove('on')); b.classList.add('on') }
  kindsEl.appendChild(b)
})

// === SCOREBOARD ===
function updateScore (h, a) {
  scoreHome = h; scoreAway = a
  const el = $('sbScore')
  el.textContent = `${h} - ${a}`
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump')
}

// === EVENT LOG ===
function addEventLog (ev) {
  const log = $('eventLog')
  const row = document.createElement('div')
  row.className = 'event-row'
  const icon = KIND_ICONS[ev.kind] || '▸'
  const player = ev.player ? `<b>${esc(ev.player)}</b>${ev.team ? ` <span style="color:var(--dim)">(${esc(ev.team)})</span>` : ''}` : esc(ev.kind)
  const detail = ev.detail ? ` — ${esc(ev.detail).slice(0, 120)}` : ''
  const score = ev.score ? `<span class="event-score">${esc(ev.score)}</span>` : ''
  row.innerHTML = `<span class="event-min">${ev.minute != null ? ev.minute + "'" : ''}</span><span class="event-icon">${icon}</span><span class="event-text">${player}${detail}${score}</span>`
  log.appendChild(row)
  log.scrollTop = log.scrollHeight

  // Goal flash
  if (ev.kind === 'goal') {
    const flash = $('goalFlash')
    flash.classList.add('show')
    setTimeout(() => flash.classList.remove('show'), 800)
  }

  // Add to ticker
  if (ev.detail) {
    tickerItems.push(`${KIND_ICONS[ev.kind] || ''} ${ev.minute || ''}' ${ev.player || ''} — ${ev.detail.slice(0, 80)}`)
    refreshTicker()
  }
}

// === COMMENTARY ===
const commCard = $('commCard'), commText = $('commText'), commLive = $('commLive')
let currentComm = ''

function startCommentary (event) {
  commCard.classList.remove('idle')
  commCard.classList.add('active')
  commText.classList.remove('idle')
  commLive.style.display = 'flex'
  currentComm = ''
  const icon = KIND_ICONS[event.kind] || '🎙️'
  commText.innerHTML = `${icon} `
}

function appendCommentaryToken (token) {
  currentComm += token
  // Strip wrapping quotes that the model sometimes adds
  let display = currentComm.replace(/^["'\s]+|["'\s]+$/g, '')
  commText.innerHTML = esc(display) + '<span class="caret"></span>'
}

function finishCommentary (full) {
  let text = full || currentComm
  text = text.replace(/^["'\s]+|["'\s]+$/g, '')
  commText.textContent = text
  commCard.classList.remove('active')
  commLive.style.display = 'none'
}

// === CHAT ===
function scrollDown () { feed.scrollTop = feed.scrollHeight }

function renderMessage (ev) {
  msgCount++
  $('chatCount').textContent = msgCount
  $('netMessages').textContent = msgCount

  const mine = ev.writer && myWriter && ev.writer === myWriter
  const row = document.createElement('div')
  row.className = 'msg' + (mine ? ' mine' : '')

  if (ev.type === 'reaction') {
    row.innerHTML = `<div class="body"><span class="txt" style="color:var(--dim)">${esc(ev.from)} reacted ${esc(ev.emoji)}</span></div>`
  } else {
    const av = document.createElement('div')
    av.className = 'av'; av.style.background = colorFor(ev.from || '?'); av.textContent = initial(ev.from)
    const body = document.createElement('div')
    body.className = 'body'
    const t = new Date(ev.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    body.innerHTML = `<span class="who">${mine ? 'you' : esc(ev.from)}</span> <span style="font-size:10px;color:var(--dim)">${t}</span><div class="txt">${esc(ev.text)}</div>`
    row.appendChild(av); row.appendChild(body)
  }
  feed.appendChild(row); scrollDown()
}

function sys (text) {
  const el = document.createElement('div'); el.className = 'msg sys'
  el.innerHTML = `<span class="txt">${esc(text)}</span>`
  feed.appendChild(el); scrollDown()
}

// === NETWORK VIZ ===
function renderNetViz (peerCount) {
  const viz = $('netViz')
  viz.innerHTML = ''
  const w = viz.offsetWidth || 300, h = 80
  const cx = w / 2, cy = h / 2

  // Me (center)
  const me = document.createElement('div')
  me.className = 'net-node me'
  me.style.left = (cx - 7) + 'px'; me.style.top = (cy - 7) + 'px'
  viz.appendChild(me)

  // Peer nodes around
  for (let i = 0; i < Math.min(peerCount, 6); i++) {
    const angle = (i / Math.min(peerCount, 6)) * Math.PI * 2 - Math.PI / 2
    const r = 28
    const px = cx + Math.cos(angle) * r
    const py = cy + Math.sin(angle) * r

    // Link
    const dx = px - cx, dy = py - cy
    const len = Math.sqrt(dx * dx + dy * dy)
    const angleDeg = Math.atan2(dy, dx) * 180 / Math.PI
    const link = document.createElement('div')
    link.className = 'net-link'
    link.style.left = cx + 'px'; link.style.top = cy + 'px'
    link.style.width = len + 'px'
    link.style.transform = `rotate(${angleDeg}deg)`
    viz.appendChild(link)

    // Node
    const node = document.createElement('div')
    node.className = 'net-node peer'
    node.style.left = (px - 5) + 'px'; node.style.top = (py - 5) + 'px'
    node.style.transitionDelay = (i * 0.1) + 's'
    viz.appendChild(node)
  }
}

// === TICKER ===
function refreshTicker () {
  const track = $('tickerTrack')
  const base = [
    'Welcome to <b>FanMesh</b> — the fan network with no server',
    '🟣 <b>Pears Stack</b> — Hyperswarm + Autobase + Hypercore',
    '🟢 <b>QVAC</b> — On-device AI commentator, no cloud',
    '⚽ Match events trigger <b>real local AI commentary</b>',
    '🌐 Every message is <b>P2P, encrypted, serverless</b>'
  ]
  const items = [...tickerItems.slice(-5).map(t => esc(t)), ...base]
  const html = items.map(t => `<span>${t}</span>`).join('')
  track.innerHTML = html + html // duplicate for seamless loop
}

// === SEND ===
function sendChat () {
  const inp = $('chatInput')
  const text = inp.value.trim()
  if (!text || !ws) return
  ws.send(JSON.stringify({ type: 'chat', text }))
  inp.value = ''
}

function postEvent () {
  const player = $('evPlayer').value.trim()
  const minute = parseInt($('evMinute').value) || null
  const detail = $('evDetail').value.trim()
  if (!ws) return
  const event = { kind: selectedKind, minute, detail: detail || undefined }
  if (player) event.player = player
  ws.send(JSON.stringify({ type: 'matchEvent', event }))
  $('evPlayer').value = ''; $('evMinute').value = ''; $('evDetail').value = ''
}

// === SPAWNED PEERS ===
function renderPeerList () {
  const list = $('peerList')
  list.innerHTML = ''
  spawnedPeers.forEach(p => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;background:var(--panel2);border-radius:7px;font-size:12px'
    row.innerHTML = `<span style="font-size:14px">${p.flag}</span><span style="flex:1;color:var(--soft)">${esc(p.name)}</span><span style="color:var(--pitch);font-size:10px">● connected</span><button onclick="removePeer('${p.id}')" style="cursor:pointer;border:none;background:none;color:var(--red);font-size:14px;padding:0 4px">×</button>`
    list.appendChild(row)
  })
}

function spawnPeer () {
  if (!ws) return
  ws.send(JSON.stringify({ type: 'spawnPeer' }))
}

function removePeer (id) {
  if (!ws) return
  ws.send(JSON.stringify({ type: 'removePeer', id }))
}

function removeAllPeers () {
  spawnedPeers.forEach(p => removePeer(p.id))
}

// Make functions global for inline onclick
window.removePeer = removePeer
let spawnedPeers = []   // { id, name, flag }

function connect () {
  // Connect WebSocket with the current path (so /demo is detected server-side)
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const wsUrl = `${proto}://${location.host}${location.pathname}`
  ws = new WebSocket(wsUrl)

  ws.onopen = () => { sys('Connected to the P2P mesh') }

  ws.onmessage = (e) => {
    let msg
    try { msg = JSON.parse(e.data) } catch { return }

    switch (msg.type) {
      case 'hello':
        myWriter = msg.writer; myName = msg.name
        demoMode = msg.demo || false
        $('peerCount').textContent = msg.peers
        $('netPeers').textContent = msg.peers
        renderNetViz(msg.peers)

        // Show demo badge
        if (demoMode) {
          const badge = document.createElement('div')
          badge.className = 'badge live'
          badge.style.borderColor = 'var(--gold)'; badge.style.color = 'var(--gold)'
          badge.innerHTML = '<span class="dot" style="background:var(--gold)"></span> Demo Mode'
          document.querySelector('header').insertBefore(badge, document.querySelector('header .spacer'))
        }

        // AI status
        if (msg.ai) updateAI(msg.ai)

        // Existing messages
        if (msg.messages) msg.messages.forEach(renderMessage)

        // Spawned peers from previous sessions
        if (msg.spawnedPeers) {
          spawnedPeers = msg.spawnedPeers
          renderPeerList()
        }

        // Demo seeding
        if (msg.demoChat) {
          msg.demoChat.forEach((c, i) => {
            setTimeout(() => renderMessage({ from: c.from, text: c.text, ts: Date.now() - (msg.demoChat.length - i) * 5000 }), i * 300)
          })
        }
        if (msg.demoMatch) {
          $('sbHomeName').textContent = msg.demoMatch.home
          $('sbAwayName').textContent = msg.demoMatch.away
          $('sbHomeFlag').textContent = msg.demoMatch.homeFlag
          $('sbAwayFlag').textContent = msg.demoMatch.awayFlag
          $('sbMatch').textContent = msg.demoMatch.matchName
        }
        break

      case 'peers':
        $('peerCount').textContent = msg.count
        $('netPeers').textContent = msg.count
        renderNetViz(msg.count)
        break

      case 'message':
        renderMessage(msg.ev)
        break

      case 'reaction':
        renderMessage(msg.ev)
        break

      case 'match':
        addEventLog(msg.ev)
        break

      case 'score':
        updateScore(msg.home, msg.away)
        $('sbClock').textContent = msg.minute + "'"
        break

      case 'commentary':
        if (msg.token) appendCommentaryToken(msg.token)
        if (msg.done) finishCommentary(msg.full)
        else if (!msg.token && !msg.done) startCommentary(msg.event)
        break

      case 'ai:progress':
        updateAI({ loading: true, pct: msg.pct })
        break

      case 'ai:ready':
        updateAI({ loaded: true, pct: 100 })
        if (!demoMode) sys('🤖 AI commentator loaded on your device (QVAC)')
        break

      case 'ai:error':
        updateAI({ error: msg.error })
        break

      case 'language':
        // language changed
        break

      case 'peerSpawned':
        spawnedPeers.push(msg.peer)
        renderPeerList()
        break

      case 'peerRemoved':
        spawnedPeers = spawnedPeers.filter(p => p.id !== msg.id)
        renderPeerList()
        break

      case 'demoChat':
        if (msg.chat) {
          msg.chat.forEach((c, i) => {
            setTimeout(() => renderMessage({ from: c.from, text: c.text, ts: Date.now() - (msg.chat.length - i) * 5000 }), i * 300)
          })
        }
        if (msg.match) {
          $('sbHomeName').textContent = msg.match.home
          $('sbAwayName').textContent = msg.match.away
          $('sbHomeFlag').textContent = msg.match.homeFlag
          $('sbAwayFlag').textContent = msg.match.awayFlag
          $('sbMatch').textContent = msg.match.matchName
        }
        break
    }
  }

  ws.onclose = () => { sys('Disconnected — reconnecting…'); setTimeout(connect, 2000) }
  ws.onerror = () => { try { ws.close() } catch {} }
}

function updateAI (st) {
  const status = $('aiStatus')
  const bar = $('aiBar')
  if (st.loaded) {
    status.textContent = 'Ready · Running locally'
    bar.style.width = '100%'
  } else if (st.loading) {
    status.textContent = 'Loading model…'
    bar.style.width = (st.pct || 0) + '%'
  } else if (st.error) {
    status.textContent = 'Error: ' + st.error.slice(0, 40)
  }
}

// === EVENTS ===
$('sendBtn').onclick = sendChat
$('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat() })
$('postEventBtn').onclick = postEvent
$('addPeerBtn').onclick = spawnPeer
$('removeAllPeersBtn').onclick = removeAllPeers

// Match clock ticker (cosmetic — advances the displayed minute)
let displayMinute = 0
setInterval(() => {
  if (displayMinute > 0 && displayMinute < 120) {
    displayMinute++
    $('sbClock').textContent = displayMinute + "'"
  }
}, 45000) // advance 1 min every 45s

// Listen for match minutes from events to sync clock
const origAddEventLog = addEventLog
// (handled inline above when score events arrive)

// Start
refreshTicker()
connect()
