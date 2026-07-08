# ⚽ FanMesh — Peer-to-Peer Fan Network + On-Device AI Commentator

> **Decentralized watch parties. Talk to fans worldwide — no server, no censorship. With an on-device AI commentator.**
>
> A **Tether Developers Cup** entry that combines **two tracks**:
> - 🟣 **Pears Stack (P2P)** — fans find each other by match and chat/share clips with **no central server** (censorship-resistant; works when stadium WiFi or central apps fail).
> - 🟢 **QVAC (Local AI)** — an on-device **AI commentator** that narrates highlights locally, in your language. **No cloud.**

*"No server. Anywhere."*

---

## Why FanMesh

During the World-Cup moment, central chat servers overload and fans in some regions get blocked. FanMesh removes the server entirely: fans discover each other **peer-to-peer with Hyperswarm**, share chat and clips on **append-only Hypercores**, and agree on shared room state with **Autobase** — all from the Pears Stack. A **QVAC** model runs on your own device to generate live commentary from match events, so even the AI is private and unstoppable.

## Tracks used

| Track | Building block | What it does in FanMesh |
|-------|----------------|--------------------------|
| **Pears** | Hyperswarm | Peer discovery by match-room topic (no signalling server) |
| **Pears** | Hypercore | Append-only chat log + binary clip sync, replicated P2P |
| **Pears** | Autobase | Multi-writer, eventually-consistent shared room state |
| **QVAC** | `@qvac/sdk` | On-device LLM generates live commentary/translation, locally |

> Plain WebRTC is **not** used. All networking is the Pears Stack.

## Architecture

```
            ┌──────────── Match Room (Hyperswarm topic) ────────────┐
            │                                                         │
   Fan A ───┤   Autobase (chat + reactions + match state)             ├─── Fan B
   (laptop) │   Hypercore (clip blobs, replicated)                     │   (phone)
            │   QVAC commentator runs LOCALLY on each device           │
            └─────────────────────────────────────────────────────────┘
                          No central server. Anywhere.
```

## Status

- ✅ **Milestone 1** — Hyperswarm peer discovery verified (two peers find each other + exchange messages over the DHT, no server).
- ✅ **Milestone 2** — Autobase multi-writer chat (both directions) + reactions + **Hypercore clip sync (symmetric, byte-identical)** + eventual consistency. All P2P, no server.
- ✅ **Milestone 3** — QVAC on-device commentator runs a real Llama 3.2 1B model locally (no cloud) and generates live multilingual commentary on match events.
- ✅ **Milestone 4** — Web UI + 10-slide pitch deck (`web/slides.html`) + SUBMISSION.md.

## Pitch deck
Open [`web/slides.html`](web/slides.html) in a browser — use ← → or click the edges to navigate the 10-slide deck.

## Quick start

```bash
npm install

# Full P2P integration test: two peers discover each other, Autobase multi-writer
# chat BOTH ways, reactions sync, Hypercore clip sync symmetric + eventual consistency.
node test/mesh-test.mjs

# QVAC on-device commentator: loads a local model and narrates match events (no cloud).
node test/commentator-test.mjs
```

## Run the app

Two fans each run this on the same match key and meet inside the room — no server, no cloud.

```bash
# Fan A (laptop)
npm start
# → opens http://127.0.0.1:3000

# Fan B (phone / second machine)
node bin/fanmesh.js --match "WC-FINAL-ARG-FRA" --name Bob --lang Español --port 3001
# → opens http://127.0.0.1:3001
```

Both fans discover each other over Hyperswarm, chat via Autobase, sync clips via Hypercore, and each runs a private on-device AI commentator.

## License

MIT © 2026 sabiedu
