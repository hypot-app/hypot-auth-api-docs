// Stand-ins for browser APIs, so the same snippets that run in a page also run in Node.
// They model only what the snippets use. Real browser behaviour is NOT covered (see "Sobre esta documentación").

/** `navigator.locks.request` with exclusive mode: callers of the same name run one at a time, like several tabs. */
export function createLocks() {
  const tails = new Map();
  return {
    requests: 0,
    request(name, callback) {
      this.requests += 1;
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(() => callback());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

/** `Storage` (sessionStorage or localStorage). Pass the same instance to two "tabs" to share it. */
export function createStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
    snapshot: () => Object.fromEntries(data),
  };
}

/** A `location` + `history` pair. `history.replaceState` rewrites the URL and records the call. */
export function createPage(href) {
  const url = new URL(href);
  const calls = [];
  const location = {
    get hash() {
      return url.hash;
    },
    get pathname() {
      return url.pathname;
    },
    get search() {
      return url.search;
    },
    get href() {
      return url.href;
    },
  };
  const history = {
    replaceState(_state, _title, target) {
      calls.push(target);
      const next = new URL(target, url);
      url.pathname = next.pathname;
      url.search = next.search;
      url.hash = next.hash; // '' when the target has no fragment: the token is gone
    },
  };
  return { location, history, calls };
}

/** Wraps a fetch to count calls and let a test observe each request. */
export function spyFetch(baseFetch, onRequest = () => {}) {
  const spy = async (url, init) => {
    spy.calls.push({ url, init });
    onRequest(url, init);
    return baseFetch(url, init);
  };
  spy.calls = [];
  return spy;
}
