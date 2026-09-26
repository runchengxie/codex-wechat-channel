import assert from "node:assert/strict";
import test from "node:test";

import { processUpdateBatch } from "../src/update-batch.mjs";

test("the update cursor is saved only after every dispatched message finishes", async () => {
  const events = [];
  let finishMessage;
  const messageDone = new Promise((resolve) => {
    finishMessage = resolve;
  });

  const processing = processUpdateBatch({
    response: { msgs: [{ id: "message-1" }], get_updates_buf: "cursor-2" },
    dispatch: async () => {
      events.push("message-started");
      await messageDone;
      events.push("message-finished");
    },
    saveCursor: (cursor) => events.push(`cursor-saved:${cursor}`),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["message-started"]);

  finishMessage();
  await processing;
  assert.deepEqual(events, [
    "message-started",
    "message-finished",
    "cursor-saved:cursor-2",
  ]);
});

test("a failed message prevents cursor advancement after the rest of the batch settles", async () => {
  const events = [];
  let finishSlowMessage;
  const slowMessageDone = new Promise((resolve) => {
    finishSlowMessage = resolve;
  });

  const processing = processUpdateBatch({
    response: {
      msgs: [{ id: "message-fails" }, { id: "message-slow" }],
      get_updates_buf: "cursor-2",
    },
    dispatch: async (message) => {
      events.push(`started:${message.id}`);
      if (message.id === "message-fails") {
        throw new Error("send failed");
      }
      await slowMessageDone;
      events.push(`finished:${message.id}`);
    },
    saveCursor: (cursor) => events.push(`cursor-saved:${cursor}`),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["started:message-fails", "started:message-slow"]);

  finishSlowMessage();
  await assert.rejects(processing, /1 update message task failed/);
  assert.deepEqual(events, [
    "started:message-fails",
    "started:message-slow",
    "finished:message-slow",
  ]);
});

test("an empty batch can advance a returned cursor", async () => {
  const saved = [];

  await processUpdateBatch({
    response: { msgs: [], get_updates_buf: "cursor-2" },
    dispatch: () => assert.fail("empty batches must not dispatch messages"),
    saveCursor: (cursor) => saved.push(cursor),
  });

  assert.deepEqual(saved, ["cursor-2"]);
});
