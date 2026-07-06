// FanMesh — browser client. Talks to the local app server over WebSocket and
// renders the live room: P2P chat, the on-device AI commentator (token stream),
// reactions, match events and Hypercore clips.
const $ = (id) => document.getElementById(id)
const feed = $('feed')
const fmtTime = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const AV_COLORS = ['#13c08b', '#f5c451', '#5db4ff', '#ff8fab', '#c79bff', '#7bd3a0']
function colorFor (s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length] }
function initial (s) { return (s || '?').trim().charAt(0).toUpperCase() || '?' }

const KINDS = [
  ['goal', '⚽ Goal'], ['penalty', '🥅 Penalty'], ['save', '🧤 Save'], ['chance', '🎯 Chance'],
  ['shot', '👞 Shot'], ['corner', '🚩 Corner'], ['yellow-card', '🟨 Yellow'], ['red-card', '🟥 Red'],
  ['substitution', '🔁 Sub'], ['foul', '🤚 Foul'], ['kickoff', ' kickoff'], ['halftime', '⏸ Half-time'], ['fulltime', '⏹ Full-time'], ['var', '📺 VAR']
]
let selectedKind = 'goal'
const kindsEl = $('kinds')
KINDS.forEach(([k, label]) => {
  const b = document.createElement('button')
  b.textContent = label
  if (k === selectedKind) b.classList.add('on')
  b.onclick = () => { selectedKind = k; [...kindsEl.children].forEach(c => c.classList.remove('on')); b.classList.add('on') }
  kindsEl.appendChild(b)
})

let myWriter = ''
let myName = ''
function scrollDown () { feed.scrollTop = feed.scrollHeight }

function renderMessage (ev) {
  const mine = ev.writer && myWriter && ev.writer === myWriter
  const row = document.createElement('div')
  row.className = 'row' + (mine ? ' mine' : '')
  const av = document.createElement('div')
  av.className = 'av'; av.style.background = colorFor(ev.from || '?'); av.textContent = initial(ev.from)
  const bub = document.createElement('div')
  bub.className = 'bubble'; bub.dataset.id = ev.id
  bub.innerHTML = `<div class="who">${mine ? 'you' : esc(ev.from)}</div><div class="body"></div>`
  bub.querySelector('.body').textContent = ev.text
  const t = document.createElement('span'); t.style.cssText = 'float:right;font-size:10px;color:var(--dim);margin-left:8px'; t.textContent = fmtTime(ev.ts)
  bub.querySelector('.body').appendChild(t)
  row.appendChild(av); row.appendChild(bub)
  feed.appendChild(row); scrollDown()
}

function esc (s) { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML }

function sys (text) {
  const el = document.createElement('div'); el.className = 'sys'; el.textContent = text
  feed.appendChild(el); scrollDown()
}

let commTimer = null
const commCard = $('commCard'), commText = $('commText')
function setCommentary (text, live) {
  commCard.classList.remove('idle')
  commText.textContent = text
  const caret = document.createElement('span'); caret.className = 'caret'; commText.appendChild(caret)
  if (!live) { commText.querySelector('.caret')?.remove(); clearTimeout(commTimer); commTimer = setTimeout(() => { /* keep last line a bit */ }, 0) }
}

function flashEvent (ev) {
  const el = document.createElement('div'); el.className = 'ev'
  const parts = []
  if (ev.minute != null) parts.push(`<b>${ev.minute}'</b>`)
  const label = (KINDS.find(([k]) => k === ev.kind) || [ev.kind, ev.kind])[1]
  parts.push(`<b>${esc(label)}</b>`)
  if (ev.player) parts.push(esc(ev.player))
  if (ev.team) parts.push(`(${esc(ev.team)})`)
  if (ev.score) parts.push(`· ${esc(ev.score)}`)
  el.innerHTML = `📣 ${parts.join(' ')} <span style="color:var(--dim)">— ${esc(ev.from)}</span>`
  feed.appendChild(el); scrollDown()
}

function renderClip (ev) {
  const card = document.createElement('div'); card.className = 'clipcard'
  const mine = ev.from === myName
  if (mine) card.classList.add('mine')
  card.innerHTML = `<div class="thumb">🎬</div><div><div style="font-weight:600">${esc(ev.from)} shared a clip</div>
    <div style="color:var(--dim);font-size:12px">${(ev.size / 1024).toFixed(0)} KB · Hypercore ${String(ev.key).slice(0, 8)}…</div>
    <a href="#" data-key="${esc(ev.key)}" data-index="${ev.index}">view</a></div>`
  card.querySelector('a').onclick = async (e) => {
    e.preventDefault()
    const a = e.target; a.textContent = 'fetching (P2P)…'
    send({ type: 'getClip', key: ev.key, index: ev.index, meta: ev.meta })
    pendingClipView = { key: ev.key, index: ev.index, a }
  }
  feed.appendChild(card); scrollDown()
}
let pendingClipView = null

// --- WebSocket ---
let ws
function connect () {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(`${proto}://${location.host}`)
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data) } catch { return }
    handle(m)
  }
  ws.onclose = () => { setTimeout(connect, 1200) }
}
function send (obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)) }

function handle (m) {
  switch (m.type) {
    case 'hello':
      $('matchSub').textContent = `match: ${m.matchKey}`
      $('mk2').textContent = `node bin/fanmesh.js --match "${m.matchKey}" --name Bob --port 3001`
      myWriter = m.writer || ''; myName = m.name
      $('meBadge').textContent = 'me: ' + (m.me || '?')
      $('roleBadge').textContent = 'role: ' + (m.role || '?')
      $('peerLabel').textContent = (m.peers || 0) + ' peer' + (m.peers === 1 ? '' : 's')
      if (m.language) $('lang').value = m.language
      ;(m.messages || []).forEach(renderMessage)
      aiState(m.ai)
      break
    case 'peers':
      $('peerLabel').textContent = (m.count || 0) + ' peer' + (m.count === 1 ? '' : 's')
      $('roleBadge').textContent = 'role: ' + (m.role || '?')
      $('meBadge').textContent = 'me: ' + (m.me || '?')
      break
    case 'message': renderMessage(m.ev); break
    case 'match': flashEvent(m.ev); break
    case 'commentary': onCommentary(m); break
    case 'clip': renderClip(m.ev); break
    case 'clipBytes':
      if (pendingClipView && pendingClipView.key === m.key && pendingClipView.index === m.index) {
        const blob = new Blob([Uint8Array.from(atob(m.b64), c => c.charCodeAt(0))], { type: m.mime || 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank')
        pendingClipView.a.textContent = 'open again'
      }
      break
    case 'ai:progress': $('pbar').style.width = (m.pct || 0) + '%'; $('aiStatus').textContent = `downloading ${m.pct || 0}%`; break
    case 'ai:ready': $('pbar').style.width = '100%'; $('aiStatus').textContent = 'ready'; $('aiSub').textContent = 'Llama 3.2 · local'; break
    case 'ai:error': $('aiStatus').textContent = 'error'; $('aiSub').textContent = m.error; break
    case 'language': break
    case 'error': sys('⚠️ ' + m.error); break
  }
}

let commBuf = '', commActive = false
function onCommentary (m) {
  if (m.token) commBuf += m.token
  if (!commActive) { commActive = true; commBuf = m.full || commBuf }
  commBuf = m.full || commBuf
  setCommentary(commBuf, !m.done)
  if (m.done) {
    commActive = false
    // drop a commentary line into the feed history too
    const row = document.createElement('div'); row.className = 'row'
    const av = document.createElement('div'); av.className = 'av'; av.style.background = 'var(--gold)'; av.textContent = '🤖'
    const bub = document.createElement('div'); bub.className = 'bubble'; bub.style.borderColor = 'var(--gold)'
    bub.innerHTML = `<div class="who" style="color:var(--gold)">QVAC commentator · on-device</div>`
    const body = document.createElement('div'); body.textContent = commBuf.trim()
    bub.appendChild(body)
    row.appendChild(av); row.appendChild(bub); feed.appendChild(row); scrollDown()
    setTimeout(() => { commCard.classList.add('idle'); commText.textContent = 'Ready for the next moment…' }, 4000)
  }
}
function aiState (ai) {
  if (!ai) return
  if (ai.loaded) { $('pbar').style.width = '100%'; $('aiStatus').textContent = 'ready'; $('aiSub').textContent = 'Llama 3.2 · local' }
  else if (ai.loading) { $('pbar').style.width = (ai.pct || 0) + '%'; $('aiStatus').textContent = `downloading ${ai.pct || 0}%` }
  else $('aiStatus').textContent = 'starting…'
  if (ai.error) $('aiSub').textContent = ai.error
}

// --- inputs ---
$('composer').onsubmit = (e) => { e.preventDefault(); const i = $('msg'); const t = i.value.trim(); if (!t) return; send({ type: 'chat', text: t }); i.value = '' }
$('postEvent').onclick = () => {
  const ev = { kind: selectedKind, minute: Number($('mMinute').value || 0) }
  if ($('mPlayer').value) ev.player = $('mPlayer').value
  if ($('mTeam').value) ev.team = $('mTeam').value
  if ($('mScore').value) ev.score = $('mScore').value
  send({ type: 'matchEvent', event: ev })
}
$('lang').onchange = () => send({ type: 'setLanguage', language: $('lang').value })
$('shareClip').onclick = () => {
  const f = $('clipFile').files[0]; if (!f) return alert('pick a file first')
  const r = new FileReader()
  r.onload = () => {
    const b64 = r.result.split(',')[1]
    send({ type: 'shareClip', bytes: b64, meta: { mime: f.type, name: f.name } })
    sys(`📤 sharing "${f.name}" (${(f.size / 1024).toFixed(0)} KB) over Hypercore…`)
  }
  r.readAsDataURL(f)
}

connect()
