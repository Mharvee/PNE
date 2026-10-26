// Test helpers: an in-memory fake of @supabase/supabase-js (only what the admin API uses).
const Module = require("module");

function installFakeSupabase(db) {
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@supabase/supabase-js") {
      return { createClient: () => makeClient(db) };
    }
    return orig.apply(this, arguments);
  };
  return () => { Module._load = orig; };
}

function makeClient(db) {
  return {
    auth: {
      async getUser(token) {
        if (token === "admin-token") return { data: { user: { id: "u1", email: "admin@pne.test" } }, error: null };
        return { data: { user: null }, error: { message: "invalid" } };
      }
    },
    from(table) {
      const q = { table, op: "select", filters: [], payload: null, single: false, orderBy: null };
      const run = () => {
        const rows = db[table];
        const match = r => q.filters.every(([k, v]) => String(r[k]) === String(v));
        if (q.op === "insert") {
          const row = { id: "p" + (rows.length + 1), created_at: new Date().toISOString(), ...q.payload };
          rows.push(row);
          return { data: q.single ? row : [row], error: null };
        }
        if (q.op === "update") {
          const hit = rows.filter(match);
          hit.forEach(r => Object.assign(r, q.payload));
          if (q.single && !hit.length) return { data: null, error: { message: "no rows" } };
          return { data: q.single ? hit[0] : hit, error: null };
        }
        if (q.op === "delete") { db[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
        let out = rows.filter(match);
        if (q.single) return out[0] ? { data: out[0], error: null } : { data: null, error: { message: "no rows" } };
        return { data: out, error: null };
      };
      const api = {
        select() { return api; }, order() { return api; },
        insert(p) { q.op = "insert"; q.payload = p; return api; },
        update(p) { q.op = "update"; q.payload = p; return api; },
        delete() { q.op = "delete"; return api; },
        eq(k, v) { q.filters.push([k, v]); return api; },
        single() { q.single = true; return api; },
        then(res, rej) { return Promise.resolve(run()).then(res, rej); }
      };
      return api;
    }
  };
}

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  res.setHeader = () => {};
  return res;
}

module.exports = { installFakeSupabase, mockRes };
