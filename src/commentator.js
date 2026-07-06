// FanMesh — On-device AI Commentator (QVAC track).
//
// Runs a REAL language model LOCALLY on the user's own machine via the QVAC
// SDK (llama.cpp under the hood). NO cloud, NO API keys, NO data ever leaves
// the device. Every fan carries their own private, sovereign commentator.
//
// The commentator listens for match events that flow through the P2P Autobase
// feed (see src/mesh.js `MatchRoom.postMatchEvent` / 'match' event), turns each
// one into a short, lively call, in the fan's own language, and streams the
// tokens out as they are generated (live "typing" feel).
//
//   const c = new Commentator({ language: 'Spanish' })
//   await c.ready(p => console.log(`${p.percentage}%`))
//   c.comment({ kind:'goal', minute:90, player:'Messi', team:'Argentina', score:'2-1' })
//   c.on('commentary', ({ text, done }) => process.stdout.write(text))
import { EventEmitter } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

// Lazy import: the QVAC addon pulls in a native server, so we only require it
// the first time a Commentator is actually used. Keeps mesh.js P2P-only.
let QVAC = null
async function loadQvac () {
  if (QVAC) return QVAC
  QVAC = await import('@qvac/sdk')
  return QVAC
}

// A focused, lightweight, multilingual default: Llama-3.2-1B-Instruct (Q4_0).
// Small enough to load on a laptop in seconds, good enough to call a match in
// many languages. Override with any QVAC model constant via Commentator({model}).
export async function defaultModel () {
  const { LLAMA_3_2_1B_INST_Q4_0 } = await loadQvac()
  return LLAMA_3_2_1B_INST_Q4_0
}

const VERBS = {
  goal: 'scores a GOAL',
  penalty: 'is taking a penalty',
  save: 'makes a crucial save',
  'yellow-card': 'receives a yellow card',
  'red-card': 'is shown a RED CARD',
  substitution: 'comes on as a substitution',
  kickoff: '— the match kicks off',
  halftime: '— half-time whistle',
  fulltime: '— full-time, the match ends',
  chance: 'has a goalscoring chance',
  corner: 'earns a corner',
  foul: 'commits a foul',
  shot: 'takes a shot',
  injury: 'is down injured',
  var: '— the referee checks VAR'
}

function humanize (ev) {
  const min = ev.minute != null ? `${ev.minute}'` : ''
  const who = ev.player || ev.team || 'A team'
  if (ev.kind === 'kickoff' || ev.kind === 'halftime' || ev.kind === 'fulltime' || ev.kind === 'var') {
    const base = VERBS[ev.kind] || `— event: ${ev.kind}`
    return `${min} ${who} ${base}.`
  }
  const verb = VERBS[ev.kind] || `event: ${ev.kind}`
  let s = `${min} ${who} ${verb}.`
  if (ev.team && ev.player) s += ` (${ev.team})`
  if (ev.score) s += ` Score is now ${ev.score}.`
  if (ev.detail) s += ` ${ev.detail}`
  return s
}

/**
 * On-device AI commentator. Generates live match calls locally with QVAC.
 */
export class Commentator extends EventEmitter {
  constructor ({ language = 'English', style = 'passionate stadium commentator', model, maxContext = 4, maxTokens = 96, temperature = 0.7 } = {}) {
    super()
    this.language = String(language || 'English').trim()
    this.style = style
    this.model = model || null // resolved lazily in ready()
    this.maxContext = maxContext
    this.maxTokens = maxTokens
    this.temperature = temperature
    this.modelId = null
    this.loading = false
    this.loaded = false
    this.recent = []          // rolling log of humanized events for continuity
    this._busy = null         // in-flight generation promise
    this._seen = new Set()    // dedupe by event id
  }

  get ready () { return this.loaded }

  /**
   * Load the model into memory (downloads once, then cached on-device).
   * @param {(p:{percentage:number,downloaded:number,total:number})=>void} [onProgress]
   */
  async start (onProgress) {
    if (this.loaded) return this
    if (this.loading) {
      // Coalesce concurrent start() calls.
      await this._startP
      return this
    }
    this.loading = true
    this._startP = (async () => {
      const qvac = await loadQvac()
      if (!this.model) this.model = qvac.LLAMA_3_2_1B_INST_Q4_0
      this.modelId = await qvac.loadModel({
        modelSrc: this.model,
        onProgress: onProgress || (() => {}),
        modelConfig: { ctx_size: 2048 }
      })
      this.loaded = true
      this.loading = false
      this.emit('ready')
    })()
    return this._startP
  }

  _systemPrompt () {
    return [
      `You are a ${this.style} calling a live football match on the radio.`,
      `Reply ONLY in ${this.language}, in at most TWO short sentences (under 40 words).`,
      `React to exactly the event described — name the player, team and minute.`,
      `Do NOT invent a scoreline, scorers or minutes that were not given.`,
      `Be vivid and energetic. Plain text only: no hashtags, no quotes, no markdown, no preamble.`
    ].join(' ')
  }

  // Compact one-line recap of what already happened, for continuity.
  _soFar () {
    if (this.recent.length <= 1) return ''
    return this.recent.slice(0, -1).map((f) => f.replace(/\.$/, '')).join('  |  ')
  }

  /**
   * Generate commentary for a match event. Streams tokens via 'commentary'.
   * @param {{kind:string,minute?:number,player?:string,team?:string,score?:string,detail?:string,id?:string}} ev
   */
  async comment (ev) {
    if (!this.loaded) return null
    const id = ev.id || `${ev.kind}:${ev.minute}:${ev.player}`
    if (this._seen.has(id)) return null
    this._seen.add(id)
    // serialise generations so the model context stays coherent
    if (this._busy) { try { await this._busy } catch {} }
    const release = new Promise(async (resolve) => {
      const qvac = await loadQvac()
      const fact = humanize(ev)
      this.recent.push(fact)
      if (this.recent.length > this.maxContext) this.recent.shift()
      // Small on-device models stay accurate & non-repetitive with a clean
      // single-turn per event (no cross-event state bleeding through the KV
      // cache). Continuity is conveyed by the event's own minute/score fields.
      const history = [
        { role: 'system', content: this._systemPrompt() },
        { role: 'user', content: `Commentate this match event live, in ${this.language}: "${fact}"` }
      ]
      let text = ''
      try {
        const run = qvac.completion({ modelId: this.modelId, history, stream: true, temperature: this.temperature, predict: this.maxTokens, kvCache: false })
        for await (const tok of run.tokenStream) {
          text += tok
          this.emit('commentary', { text: tok, full: text, done: false, event: ev })
        }
        this.emit('commentary', { text: '', full: text, done: true, event: ev })
        return text
      } catch (err) {
        this.emit('error', err)
        return null
      } finally {
        resolve()
      }
    })
    this._busy = release
    return release
  }

  /** Convenience: attach to a MatchRoom and narrate every shared match event. */
  attach (room) {
    this._roomDetach?.()
    const handler = (ev) => { this.comment(ev).catch((e) => this.emit('error', e)) }
    room.on('match', handler)
    this._roomDetach = () => room.off('match', handler)
    return this
  }

  async close () {
    this._roomDetach?.()
    if (this._busy) { try { await this._busy } catch {} }
    if (this.modelId) {
      try {
        const { unloadModel } = await loadQvac()
        await unloadModel({ modelId: this.modelId })
      } catch {}
    }
    this.loaded = false
    this.modelId = null
    this.emit('close')
  }
}

export default Commentator
