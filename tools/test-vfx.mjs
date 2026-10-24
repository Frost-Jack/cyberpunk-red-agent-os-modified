import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { runCallEffectLocal, stopCallEffectLocal } from "../scripts/vfx.js";

test("stopping a holophone during media loading waits for sprite creation before cleanup", async () => {
  let finishLoading, ready = false;
  const loading = new Promise(resolve => { finishLoading = resolve; });
  const ended = [], token = { id: "qa-token" };
  globalThis.__AgentDeviceCalling = new Set();
  globalThis.game = { settings: { get: () => true }, modules: new Map([["sequencer", { active: true }]]) };
  globalThis.canvas = { scene: { id: "qa-scene" }, tokens: new Map([[token.id, token]]) };
  globalThis.Sequencer = { Database: { entryExists: () => false }, Helpers: { wait: async () => setImmediate() }, EffectManager: {
    getEffects: () => [{ get ready() { return ready; } }],
    endEffects: async data => { assert.ok(ready, "Cannot destroy sprites while Sequencer is creating them"); ended.push(data.name); }
  } };
  globalThis.Sequence = class {
    constructor() {
      const chain = new Proxy({}, { get: (target, key) => key === "play" ? () => loading : () => chain });
      return chain;
    }
  };
  const start = runCallEffectLocal(token.id, "qa-scene");
  await setImmediate();
  assert.ok(__AgentDeviceCalling.has(token.id));
  const stop = stopCallEffectLocal(token.id);
  await setImmediate();
  assert.equal(__AgentDeviceCalling.has(token.id), false);
  assert.deepEqual(ended, [], "A stop must not race asynchronous media setup");
  finishLoading();
  await setImmediate();
  assert.deepEqual(ended, [], "Sequence.play may resolve before its sprites become ready");
  ready = true;
  await Promise.all([start, stop]);
  assert.deepEqual(ended.sort(), ["AgentCall", "AgentCallText"]);
});
