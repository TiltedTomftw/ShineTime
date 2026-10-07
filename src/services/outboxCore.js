// The phone's outbox: the ONLY job data kept on the device.
//
// Rule: an entry exists on the phone only until Supabase confirms it, then it
// is deleted immediately (along with any photo file it carried). Nothing else
// about jobs is stored on the device — screens read from Supabase.
//
// Pure and dependency-injected (CommonJS) so the rule is unit-tested without
// React Native: pass an AsyncStorage-like `storage`, a `send(entry)` that
// talks to Supabase, a `deleteFile(uri)`, and `isTransient(error)`.

const defaultIsTransient = (error) => !(error && error.permanent);

function createOutbox({
  storage,
  send,
  deleteFile = async () => {},
  isTransient = defaultIsTransient,
  describeFailure = (error) => (error && error.message) || 'Something went wrong.',
  now = () => Date.now(),
  makeId = () => `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
}) {
  let key = null; // storage key for the signed-in person; null when signed out
  let entries = [];
  let failures = []; // in memory only: shown once, then dismissed
  let sending = false;
  let flushing = null;
  const listeners = new Set();

  // Serialize every read-modify-write of the entry list.
  let lock = Promise.resolve();
  const withLock = (fn) => {
    const run = lock.then(fn, fn);
    lock = run.then(
      () => {},
      () => {},
    );
    return run;
  };

  const snapshot = () => ({
    pending: entries.length,
    entries: entries.slice(),
    failures: failures.slice(),
    sending,
  });

  const emit = () => {
    const state = snapshot();
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // A broken subscriber must never break sending.
      }
    }
  };

  const persist = async () => {
    if (!key) return;
    if (entries.length === 0) {
      await storage.removeItem(key); // nothing pending => nothing on the phone
    } else {
      await storage.setItem(key, JSON.stringify(entries));
    }
  };

  const removeFile = async (entry) => {
    if (entry && entry.fileUri) {
      try {
        await deleteFile(entry.fileUri);
      } catch {
        // Already gone is fine.
      }
    }
  };

  // Bind the outbox to a person. Each person gets their own key, so one
  // detailer's unsent work can never be sent under someone else's session.
  const setOwner = (ownerKey) =>
    withLock(async () => {
      key = ownerKey || null;
      failures = [];
      entries = [];
      if (key) {
        try {
          const raw = await storage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : [];
          entries = Array.isArray(parsed) ? parsed : [];
        } catch {
          entries = [];
        }
      }
      emit();
    });

  const enqueue = (partial) =>
    withLock(async () => {
      if (!key) throw new Error('Not signed in.');
      const entry = { id: makeId(), createdAt: now(), attempts: 0, lastError: null, ...partial };
      entries.push(entry);
      await persist();
      emit();
      return entry;
    });

  const removeEntry = async (id) => {
    const entry = entries.find((e) => e.id === id);
    entries = entries.filter((e) => e.id !== id);
    await persist();
    await removeFile(entry);
    return entry;
  };

  // Send everything in order. Stops at the first transient failure (usually
  // "offline") so later actions never jump ahead of earlier ones. A permanent
  // failure is reported and removed, along with any later entries for the same
  // job that depended on it.
  const runFlush = async () => {
    const results = { sent: [], failed: [], stoppedOn: null };
    sending = true;
    emit();
    try {
      for (;;) {
        const entry = entries[0];
        if (!entry || !key) break;
        const ownerAtStart = key;
        try {
          await send(entry);
          if (key !== ownerAtStart) break; // signed out mid-send
          await withLock(() => removeEntry(entry.id));
          results.sent.push(entry.id);
        } catch (error) {
          if (key !== ownerAtStart) break;
          if (isTransient(error)) {
            await withLock(async () => {
              const target = entries.find((e) => e.id === entry.id);
              if (target) {
                target.attempts = (target.attempts || 0) + 1;
                target.lastError = String((error && error.message) || error);
                await persist();
              }
            });
            results.stoppedOn = entry.id;
            break;
          }
          const message = describeFailure(error, entry);
          await withLock(async () => {
            await removeEntry(entry.id);
            // Later actions on a job whose earlier action was rejected can't
            // apply cleanly (e.g. pausing a job that was never created).
            if (entry.type === 'create') {
              const dependents = entries.filter((e) => e.jobId === entry.jobId);
              for (const dep of dependents) await removeEntry(dep.id);
            }
          });
          failures.push({ id: entry.id, jobId: entry.jobId, type: entry.type, message, at: now() });
          results.failed.push(entry.id);
        }
        emit();
      }
    } finally {
      sending = false;
      emit();
    }
    return results;
  };

  // Concurrent callers share one in-flight flush.
  const flush = () => {
    if (flushing) return flushing;
    flushing = runFlush().finally(() => {
      flushing = null;
    });
    return flushing;
  };

  const dismissFailure = (id) => {
    failures = id ? failures.filter((f) => f.id !== id) : [];
    emit();
  };

  // Sign-out: delete everything for this person, files included.
  const clear = () =>
    withLock(async () => {
      const doomed = entries;
      entries = [];
      failures = [];
      if (key) await storage.removeItem(key);
      for (const entry of doomed) await removeFile(entry);
      key = null;
      emit();
    });

  const subscribe = (listener) => {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  };

  return {
    setOwner,
    enqueue,
    flush,
    clear,
    dismissFailure,
    subscribe,
    getState: snapshot,
    pendingFor: (jobId) => entries.filter((e) => e.jobId === jobId),
  };
}

module.exports = { createOutbox };
