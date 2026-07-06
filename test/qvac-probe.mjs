// FanMesh — QVAC reality probe.
// Proves on-device LLM inference REALLY runs on this machine (no cloud).
import { loadModel, LLAMA_3_2_1B_INST_Q4_0, completion, unloadModel } from "@qvac/sdk";

console.log("[probe] QVAC import OK — loading model on-device (no cloud)…");
const t0 = Date.now();
const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0,
  onProgress: (p) => {
    const mb = (n) => (n / 1e6).toFixed(1);
    const line = `▸ ${p.percentage.toFixed(0)}% (${mb(p.downloaded)}/${mb(p.total)} MB)`;
    process.stderr.write(process.stderr.isTTY ? `\r${line}` : `${line}\n`);
  },
});
console.log(`\n[probe] model loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — modelId=${modelId}`);

const history = [
  { role: "system", content: "You are a football commentator. Reply in ONE short punchy sentence." },
  { role: "user", content: "Goal! Messi scores in the 90th minute. Commentate it." },
];
let out = "";
const result = completion({ modelId, history, stream: true });
for await (const token of result.tokenStream) { process.stdout.write(token); out += token; }
console.log("\n[probe] COMPLETION DONE.");
await unloadModel({ modelId });
console.log("[probe] SUCCESS — QVAC on-device inference works for real. 🎉");
process.exit(0);
