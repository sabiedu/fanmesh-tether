# FanMesh — Tether Developers Cup Submission

## Project Title
**FanMesh — P2P Fan Network + On-Device AI Commentator**

## One-liner
Decentralized watch parties: fans discover each other peer-to-peer (no server), chat with no middleman, and run a private on-device AI commentator that never phones home.

## Vision
During the World-Cup moment, central chat servers overload and fans in some regions get blocked. FanMesh removes the server entirely: fans discover each other **peer-to-peer with Hyperswarm**, share chat and clips on **append-only Hypercores**, and agree on shared room state with **Autobase** — all from the Pears Stack. A **QVAC** model runs on your own device to generate live commentary from match events, so even the AI is private and unstoppable.

*"No server. Anywhere."*

## Tracks Used

| Track | Building block | What it does in FanMesh |
|-------|----------------|--------------------------|
| **Pears** | Hyperswarm | Peer discovery by match-room topic (no signalling server) |
| **Pears** | Hypercore | Append-only chat log + binary clip sync, replicated P2P |
| **Pears** | Autobase | Multi-writer, eventually-consistent shared room state |
| **Pears** | Corestore | One connection streams ALL cores between peers |
| **QVAC** | `@qvac/sdk` | On-device LLM (Llama 3.2 1B) generates live commentary locally — no cloud, no API keys |

> Plain WebRTC is **NOT** used. All networking is the Pears Stack.

## How It Works

1. Two fans each run FanMesh and agree on a match name (e.g. `WC-FINAL-ARG-FRA`).
2. FanMesh hashes the match name into a deterministic 32-byte **Hyperswarm** DHT topic.
3. Peers discover each other over the DHT — no signalling server, no relay.
4. **Autobase** merges every fan's writes (chat, reactions, match events) into one ordered, eventually-consistent view. Writer admission is decentralized — any indexer can vouch for a peer.
5. **Hypercore** replicates highlight clips append-only, byte-identical, on-demand.
6. Each fan's **QVAC commentator** listens for match events flowing through the Autobase feed and generates live calls in their own language — streamed token-by-token, fully on-device.

## Differentiation
- **Censorship-resistant:** no central server to block or overload. The Pears DHT means fans connect directly.
- **Private by design:** the AI commentator never sends data anywhere. Your commentary, your language, your device.
- **Split-brain healing:** network splits auto-heal — peers migrate to the room with the smallest discovery key.
- **Decentralized writer admission:** any indexer vouches for a peer in-band — no gatekeeper.

## Verified Milestones
- ✅ **Milestone 1** — Hyperswarm peer discovery (two peers find each other + exchange messages over the DHT, no server).
- ✅ **Milestone 2** — Autobase multi-writer chat (both directions) + reactions + Hypercore clip sync (symmetric, byte-identical) + eventual consistency. All P2P.
- ✅ **Milestone 3** — QVAC on-device commentator runs Llama 3.2 1B locally and generates live multilingual commentary on match events. No cloud.

Run `node test/mesh-test.mjs` (P2P integration) and `node test/commentator-test.mjs` (QVAC) to verify.

## Links
- **GitHub:** https://github.com/sabiedu/fanmesh-tether
- **Pitch Deck:** `web/slides.html` (open in browser, ← → to navigate)
- **Live Demo:** _(add deployment URL)_
- **Demo Video:** _(add YouTube link)_
- **X Tweet:** _(add link)_

## Builder
**Eric** (sabiedu) — repo ships under GitHub account [`sabiedu`](https://github.com/sabiedu).

## Stack
Node.js · Pears Stack (Hyperswarm, Autobase, Hypercore, Corestore) · `@qvac/sdk` (Llama 3.2 1B Instruct) · vanilla JS web UI.

## License
MIT © 2026 sabiedu
