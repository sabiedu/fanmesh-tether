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
- 🚧 Milestone 2 — Hypercore/Autobase chat + room state + clip sync.
- 🚧 Milestone 3 — QVAC on-device commentator.
- 🚧 Milestone 4 — Pear app + UI + demo video.

## Quick start

```bash
npm install
# Milestone 1 smoke test: two peers discover each other peer-to-peer
node test/run-mesh-test.mjs
```

## License

MIT © 2026 sabiedu
