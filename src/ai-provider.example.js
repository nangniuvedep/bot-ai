/* Copy to src/ai-provider.js and fill in ONE provider. run.js loads it only when config ai.mode = "veto".
   Export a function that takes the packet (see ai-gate.js buildPacket) and returns the model's answer as JSON text or an object:
     { "action": "take" | "skip" | "shrink", "size": 0.5 /* only for shrink, 0..1 */, "confidence": 0.7, "reason": "short" }
   Keep the key in a secret/env var, never in the repo. Ask the model to answer with that JSON only. */
module.exports = async function aiFn(packet) {
  throw new Error("ai-provider.js not written yet (copy this file and call your provider)");
};
