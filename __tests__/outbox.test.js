// The phone keeps job data ONLY until Supabase confirms it. These tests pin
// that rule down so it can't quietly regress.
const test = require('node:test');
const assert = require('node:assert');
const { createOutbox } = require('../src/services/outboxCore');

const memoryStorage = () => {
  const data = new Map();
  return {
    data,
    getItem: async (k) => (data.has(k) ? data.get(k) : null),
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
};

const transient = () => Object.assign(new Error('Network request failed'), { permanent: false });
const permanent = (msg = 'duplicate') => Object.assign(new Error(msg), { permanent: true });

const setup = (send) => {
  const storage = memoryStorage();
  const deleted = [];
  const outbox = createOutbox({
    storage,
    send,
    deleteFile: async (uri) => deleted.push(uri),
  });
  return { storage, deleted, outbox };
};

test('an entry is deleted from the phone as soon as Supabase confirms it', async () => {
  const { storage, outbox } = setup(async () => {});
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'pause', jobId: 'j1' });
  assert.ok(storage.data.has('outbox:user-1'), 'held on the phone until confirmed');

  await outbox.flush();
  assert.strictEqual(outbox.getState().pending, 0);
  assert.strictEqual(storage.data.has('outbox:user-1'), false, 'nothing left on the phone');
});

test("a confirmed photo's file is deleted from the phone too", async () => {
  const { deleted, outbox } = setup(async () => {});
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'photo', jobId: 'j1', fileUri: 'file:///outbox/p1.jpg' });
  await outbox.flush();
  assert.deepStrictEqual(deleted, ['file:///outbox/p1.jpg']);
});

test('a transient failure keeps the entry and stops, so order is preserved', async () => {
  const sent = [];
  const { outbox } = setup(async (entry) => {
    if (entry.type === 'pause') throw transient();
    sent.push(entry.type);
  });
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'pause', jobId: 'j1' });
  await outbox.enqueue({ type: 'complete', jobId: 'j1' });

  const result = await outbox.flush();
  assert.deepStrictEqual(sent, [], 'complete must not jump ahead of the unsent pause');
  assert.strictEqual(outbox.getState().pending, 2);
  assert.strictEqual(outbox.getState().entries[0].attempts, 1);
  assert.ok(result.stoppedOn);
});

test('entries survive an app restart until they are confirmed', async () => {
  let online = false;
  const storage = memoryStorage();
  const make = () =>
    createOutbox({
      storage,
      send: async () => {
        if (!online) throw transient();
      },
    });
  const first = make();
  await first.setOwner('outbox:user-1');
  await first.enqueue({ type: 'note', jobId: 'j1' });
  await first.flush();

  const afterRestart = make();
  await afterRestart.setOwner('outbox:user-1');
  assert.strictEqual(afterRestart.getState().pending, 1);
  online = true;
  await afterRestart.flush();
  assert.strictEqual(afterRestart.getState().pending, 0);
  assert.strictEqual(storage.data.size, 0);
});

test('a permanent failure is reported once and removed, not retried forever', async () => {
  const { storage, deleted, outbox } = setup(async () => {
    throw permanent('#P1 is already open on another job.');
  });
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'photo', jobId: 'j1', fileUri: 'file:///p.jpg' });
  await outbox.flush();

  const state = outbox.getState();
  assert.strictEqual(state.pending, 0);
  assert.strictEqual(state.failures.length, 1);
  assert.match(state.failures[0].message, /already open/);
  assert.deepStrictEqual(deleted, ['file:///p.jpg']);
  assert.strictEqual(storage.data.size, 0, 'failure notices are not stored on the phone');

  outbox.dismissFailure(state.failures[0].id);
  assert.strictEqual(outbox.getState().failures.length, 0);
});

test('when a create is rejected, later actions on that job are dropped with it', async () => {
  const sent = [];
  const { outbox } = setup(async (entry) => {
    if (entry.type === 'create') throw permanent();
    sent.push(`${entry.jobId}:${entry.type}`);
  });
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'create', jobId: 'j1' });
  await outbox.enqueue({ type: 'pause', jobId: 'j1' });
  await outbox.enqueue({ type: 'note', jobId: 'j2' });
  await outbox.flush();

  assert.deepStrictEqual(sent, ['j2:note'], "the other job's action still goes through");
  assert.strictEqual(outbox.getState().pending, 0);
  assert.strictEqual(outbox.getState().failures.length, 1);
});

test("each person has their own outbox; one person's work never sends as another", async () => {
  const sentAs = [];
  let current = null;
  const { outbox } = setup(async () => {
    sentAs.push(current);
    throw transient();
  });
  current = 'alice';
  await outbox.setOwner('outbox:alice');
  await outbox.enqueue({ type: 'note', jobId: 'a1' });

  current = 'bob';
  await outbox.setOwner('outbox:bob');
  assert.strictEqual(outbox.getState().pending, 0, "Bob doesn't inherit Alice's queue");
  await outbox.flush();
  assert.deepStrictEqual(sentAs, []);
});

test('sign-out clears the outbox, including photo files', async () => {
  const { storage, deleted, outbox } = setup(async () => {
    throw transient();
  });
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'photo', jobId: 'j1', fileUri: 'file:///a.jpg' });
  await outbox.enqueue({ type: 'note', jobId: 'j1' });
  await outbox.clear();

  assert.strictEqual(outbox.getState().pending, 0);
  assert.strictEqual(storage.data.size, 0);
  assert.deepStrictEqual(deleted, ['file:///a.jpg']);
  await assert.rejects(outbox.enqueue({ type: 'note' }), /Not signed in/);
});

test('concurrent flushes share one pass (no double sends)', async () => {
  let calls = 0;
  const { outbox } = setup(async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 5));
  });
  await outbox.setOwner('outbox:user-1');
  await outbox.enqueue({ type: 'note', jobId: 'j1' });
  await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
  assert.strictEqual(calls, 1);
});

test('subscribers hear about pending counts and failures', async () => {
  const seen = [];
  const { outbox } = setup(async () => {});
  await outbox.setOwner('outbox:user-1');
  outbox.subscribe((s) => seen.push(s.pending));
  await outbox.enqueue({ type: 'note', jobId: 'j1' });
  await outbox.flush();
  assert.ok(seen.includes(1) && seen[seen.length - 1] === 0, `saw ${seen}`);
});
