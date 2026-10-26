/* Browser end-to-end check of the per-product sale feature.
 *
 * Runs the REAL storefront (index.html/script.js), the REAL admin page, and the REAL
 * api/admin-products.js + api/verify-payment.js handlers against an in-memory fake of
 * Supabase and Paystack. No network, no real database, no real payments.
 *
 * Needs Playwright + Chromium (not a project dependency):  node tests/e2e/run-e2e.js
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { chromium } = require("playwright");
const { installFakeSupabase } = require("../helpers");

const ROOT = path.resolve(__dirname, "../..");
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const db = {
  products: [
    { id: "a1", name: "Silk Wig", price: 62000, in_stock: true, image: "/images/img1.jpeg", description: "Soft", category: "Wig", created_at: "2026-01-03", sale_active: false, sale_percentage: null },
    { id: "b2", name: "Closure Hair", price: 22000, in_stock: true, image: "/images/img2.jpeg", description: "Nice", category: "Hair", created_at: "2026-01-02", sale_active: false, sale_percentage: null },
    { id: "c3", name: "Bundle", price: 42000, in_stock: true, image: "/images/img3.jpeg", description: "Bundle", category: "Hair", created_at: "2026-01-01", sale_active: false, sale_percentage: null }
  ],
  orders: [], order_items: []
};
installFakeSupabase(db);
let lastCharge = null; // what the (stub) Paystack popup was asked to charge
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.paystack.co/transaction/verify/")) {
    const ref = decodeURIComponent(String(url).split("/verify/")[1]);
    const ok = lastCharge && lastCharge.ref === ref;
    return { ok: true, status: 200, json: async () => ok
      ? { status: true, data: { status: "success", currency: "NGN", amount: lastCharge.amount, customer: { email: lastCharge.email } } }
      : { status: false, message: "Transaction reference not found" } };
  }
  return realFetch(url, opts);
};
process.env.PAYSTACK_SECRET_KEY = "sk_test_fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-fake";
const adminProducts = require("../../api/admin-products.js");
const verifyPayment = require("../../api/verify-payment.js");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let body = ""; for await (const c of req) body += c;
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const adapt = () => { const r = { status(c) { res.statusCode = c; return r; }, json(o) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); }, setHeader: (k, v) => res.setHeader(k, v) }; return r; };
  const parsed = body ? JSON.parse(body) : undefined;
  if (u.pathname === "/api/config") return send(200, { supabaseUrl: `http://127.0.0.1:${server.address().port}`, supabaseAnonKey: "anon", paystackPublicKey: "pk_test_fake" });
  if (u.pathname === "/api/admin-products") return adminProducts({ method: req.method, headers: req.headers, body: parsed, query: {} }, adapt());
  if (u.pathname === "/api/verify-payment") return verifyPayment({ method: req.method, headers: req.headers, body: parsed }, adapt());
  if (u.pathname === "/api/admin-orders") return send(200, db.orders);
  if (u.pathname === "/__charge") { lastCharge = parsed; return send(200, {}); }
  if (u.pathname === "/rest/v1/products" && req.method === "GET") {
    const ids = (u.search.match(/id=in\.\(([^)]*)\)/) || [])[1]; // verify-payment asks for specific ids
    const rows = ids ? db.products.filter(p => ids.split(",").includes(p.id)) : [...db.products].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return send(200, rows);
  }
  if (u.pathname.startsWith("/rest/v1/")) { // used by api/verify-payment.js (service role)
    const table = u.pathname.split("/")[3];
    if (req.method === "GET" && table === "products") {
      const ids = (u.search.match(/id=in\.\(([^)]*)\)/) || [])[1];
      return send(200, db.products.filter(p => ids.split(",").includes(p.id)));
    }
    if (req.method === "GET" && table === "orders") {
      const ref = decodeURIComponent((u.search.match(/payment_reference=eq\.([^&]*)/) || [])[1] || "");
      return send(200, db.orders.filter(o => o.payment_reference === ref).map(o => ({ id: o.id })));
    }
    if (req.method === "POST" && table === "orders") { const row = { id: "order-" + (db.orders.length + 1), ...parsed }; db.orders.push(row); return send(201, [row]); }
    if (req.method === "POST" && table === "order_items") { db.order_items.push(...parsed); return send(201, []); }
  }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end("nf"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(fs.readFileSync(f));
});

const results = [];
const check = (name, fn) => async () => { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name + " :: " + e.message.split("\n")[0]]); } };

(async () => {
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  const base = process.env.SUPABASE_URL;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Stub third-party scripts (supabase-js CDN for admin auth, Paystack popup, fonts). Nothing real is contacted.
  await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.request().url().includes("supabase")
    ? r.fulfill({ contentType: "text/javascript", body: `window.supabase={createClient:()=>({auth:{
        signInWithPassword:async()=>({data:{session:{access_token:"admin-token",user:{email:"admin@pne.test"}}},error:null}),
        getSession:async()=>({data:{session:{access_token:"admin-token",user:{email:"admin@pne.test"}}}}),
        onAuthStateChange:()=>{},signOut:async()=>{}}})};` })
    : r.fulfill({ contentType: "text/css", body: "" }));
  await ctx.route("https://js.paystack.co/**", r => r.fulfill({ contentType: "text/javascript", body: `
    window.__paystackCalls=[];
    window.PaystackPop={setup:function(c){window.__paystackCalls.push(c);fetch("/__charge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ref:c.ref,amount:c.amount,email:c.email})});return{openIframe:function(){}}}};` }));

  const store = await ctx.newPage();
  const admin = await ctx.newPage();
  const errors = [];
  for (const p of [store, admin]) p.on("pageerror", e => errors.push(e.message));
  if (process.env.E2E_DEBUG) store.on("response", async r => { if (r.url().includes("/api/verify")) console.log("VERIFY", r.status(), (await r.text().catch(() => "")).slice(0, 300)); });
  if (process.env.E2E_DEBUG) admin.on("response", async r => { if (r.url().includes("/api/")) console.log("API", r.request().method(), r.url().replace(base, ""), r.status(), (await r.text().catch(() => "")).slice(0, 150)); });
  if (process.env.E2E_DEBUG) for (const p of [store, admin]) { p.on("console", m => console.log("console:", m.text())); p.on("requestfailed", r => console.log("reqfailed:", r.url())); }

  const cardOf = (name) => store.locator(".card", { hasText: name });
  const fresh = async (hash) => { await store.goto("about:blank"); await store.goto(base + "/index.html" + hash); }; // full page load (a hash-only goto would not reload)
  const loadStore = async (hash = "#/shop") => { await fresh(hash); await store.waitForSelector(".card, .detail, .msg, .row, .two"); };
  const goAdminProducts = async () => {
    await admin.goto(base + "/admin/index.html");
    await admin.click('.nav-item[data-view="products"]'); // products tab is hidden until selected
    await admin.waitForSelector(".product-card", { timeout: 5000 }).catch(async e => {
      if (process.env.E2E_DEBUG) console.log("ADMIN DUMP:", (await admin.locator("#products-container").innerHTML()).slice(0, 400), await admin.locator("#toast-wrap").innerText());
      throw e;
    });
  };
  const openAdminEdit = async (name) => {
    await goAdminProducts();
    await admin.locator(".product-card", { hasText: name }).locator("[data-edit]").click();
    await admin.waitForSelector("#product-modal-overlay.show");
  };
  const saveAdmin = async () => {
    await admin.click("#product-save-btn");
    await admin.waitForSelector("#product-modal-overlay:not(.show)", { state: "attached", timeout: 4000 }).catch(async e => {
      const vals = await admin.evaluate(() => ({ on: document.getElementById("p-sale-active").checked, pct: document.getElementById("p-sale-percentage").value, price: document.getElementById("p-price").value, cls: document.getElementById("product-form-error").className }));
      throw new Error("modal did not close; form error: " + JSON.stringify(await admin.locator("#product-form-error").innerText()) + " " + JSON.stringify(vals));
    });
  };

  await check("1. existing products load; none on sale; plain prices", async () => {
    await loadStore();
    assert.equal(await store.locator(".card").count(), 3);
    assert.equal(await store.locator(".sale-badge, .price-was").count(), 0);
    assert.match(await cardOf("Silk Wig").locator(".price").innerText(), /^₦62,000$/);
  })();

  await check("2. admin: sale controls hidden by default, preview + validation", async () => {
    await openAdminEdit("Silk Wig");
    assert.equal(await admin.locator("#p-sale-fields").isVisible(), false);
    await admin.locator("#p-sale-active").evaluate(el => el.click()); // switch's input is visually hidden
    await admin.fill("#p-sale-percentage", "20");
    assert.match(await admin.locator("#p-sale-preview").innerText(), /₦62,000.*₦49,600.*20% off/s);
    await admin.fill("#p-sale-percentage", "100");
    assert.match(await admin.locator("#p-sale-preview").innerText(), /whole number from 1 to 99/);
    // 1) the browser's own constraint validation (min=1 max=99 step=1) blocks the submit
    await admin.click("#product-save-btn");
    await admin.waitForTimeout(400);
    assert.equal(await admin.locator("#p-sale-percentage").evaluate(el => el.validity.valid), false);
    assert.equal(await admin.locator("#product-modal-overlay.show").count(), 1, "modal stays open");
    assert.equal(db.products[0].sale_active, false, "invalid percentage must not be saved");
    // 2) with browser validation bypassed, our JS check and then the SERVER still reject it
    await admin.locator("#product-form").evaluate(f => { f.noValidate = true; });
    for (const bad of ["100", "20.5", "0"]) {
      await admin.fill("#p-sale-percentage", bad);
      await admin.click("#product-save-btn");
      await admin.waitForSelector("#product-form-error.show");
      assert.equal(db.products[0].sale_active, false, bad + " must not be saved");
      assert.equal(db.products[0].sale_percentage, null);
    }
    await admin.locator("#p-sale-percentage").fill("100");
    const srv = await admin.evaluate(async () => (await fetch("/api/admin-products", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer admin-token" }, body: JSON.stringify({ id: "a1", sale_active: true, sale_percentage: 100 }) })).status);
    assert.equal(srv, 400, "server rejects 100 even if the browser check is bypassed");
    await admin.locator("#product-form").evaluate(f => { f.noValidate = false; });
    await admin.screenshot({ path: path.join(SHOTS, "admin-modal-invalid.png") });
  })();

  await check("3. admin: save 20% sale; DB keeps original price; persists after reload", async () => {
    await admin.fill("#p-sale-percentage", "20");
    await admin.screenshot({ path: path.join(SHOTS, "admin-modal-sale.png") });
    await saveAdmin();
    assert.equal(db.products[0].price, 62000);
    assert.equal(db.products[0].sale_active, true);
    assert.equal(db.products[0].sale_percentage, 20);
    await openAdminEdit("Silk Wig"); // fresh page load = "refresh"
    assert.equal(await admin.locator("#p-sale-active").isChecked(), true);
    assert.equal(await admin.inputValue("#p-sale-percentage"), "20");
    assert.equal(await admin.inputValue("#p-price"), "62000");
    await admin.click('[data-close="product-modal-overlay"] >> nth=1').catch(() => {});
  })();

  await check("4. storefront: sale product shows struck-through original, prominent sale price, badge; others unchanged", async () => {
    await loadStore();
    const c = cardOf("Silk Wig");
    if (process.env.E2E_DEBUG) console.log("CARD:", await c.innerHTML(), JSON.stringify(db.products[0]));
    assert.match(await c.locator(".price-now").innerText({ timeout: 3000 }), /^₦49,600$/);
    assert.match(await c.locator("s.price-was").innerText(), /^₦62,000$/);
    assert.equal((await c.locator(".sale-badge").innerText()).trim(), "20% OFF");
    assert.equal(await cardOf("Closure Hair").locator(".sale-badge, .price-was").count(), 0);
    assert.match(await cardOf("Closure Hair").locator(".price").innerText(), /^₦22,000$/);
    assert.match(await cardOf("Bundle").locator(".price").innerText(), /^₦42,000$/);
    await store.screenshot({ path: path.join(SHOTS, "storefront-shop.png") });
    await fresh("#/product/a1"); await store.waitForSelector(".detail");
    assert.match(await store.locator(".detail .price").innerText(), /₦49,600.*₦62,000.*20% OFF/s);
    await store.screenshot({ path: path.join(SHOTS, "storefront-detail.png") });
  })();

  await check("5. cart + checkout totals use the sale price; Paystack asked for the right kobo amount; order recorded", async () => {
    await fresh("#/product/a1"); await store.waitForSelector(".detail");
    await store.click("[data-add=a1]");
    await fresh("#/product/b2"); await store.waitForSelector(".detail");
    await store.click("[data-add=b2]");
    await fresh("#/cart"); await store.waitForSelector(".row");
    assert.match(await store.locator(".totals .t").innerText(), /₦71,600/);
    assert.match(await store.locator(".row", { hasText: "Silk Wig" }).innerText(), /₦49,600[\s\S]*₦62,000/);
    await store.screenshot({ path: path.join(SHOTS, "storefront-cart.png") });
    await fresh("#/checkout"); await store.waitForSelector("#co");
    assert.match(await store.locator(".summary").innerText(), /₦49,600[\s\S]*₦22,000[\s\S]*₦71,600/);
    await store.fill("#f-name", "Ada Obi"); await store.fill("#f-email", "ada@example.com");
    await store.fill("#f-phone", "08012345678"); await store.fill("#f-addr", "12 Some Street, Lagos");
    await store.click("#pay");
    await store.waitForFunction(() => window.__paystackCalls.length === 1);
    const call = await store.evaluate(() => window.__paystackCalls[0]);
    assert.equal(call.amount, 7160000);
    assert.equal(call.currency, "NGN");
    await store.waitForTimeout(150); // let the stub register the charge
    await store.evaluate(() => window.__paystackCalls[0].callback({ reference: window.__paystackCalls[0].ref }));
    await store.waitForSelector("text=Thank you for your order", { timeout: 5000 });
    assert.equal(db.orders.length, 1);
    assert.equal(db.orders[0].total_amount, 71600);
    assert.deepEqual(db.order_items.map(i => i.price).sort((a, b) => a - b), [22000, 49600]);
  })();

  await check("6. sale changed after page load: checkout refreshes prices and does NOT open Paystack at a stale amount", async () => {
    await fresh("#/product/a1"); await store.waitForSelector(".detail");
    await store.click("[data-add=a1]");
    await fresh("#/checkout"); await store.waitForSelector("#co");
    assert.match(await store.locator(".summary").innerText(), /₦49,600/);
    // admin raises the discount to 50% while the customer is on the checkout page
    const r = await store.evaluate(async () => (await fetch("/api/admin-products", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer admin-token" }, body: JSON.stringify({ id: "a1", sale_active: true, sale_percentage: 50 }) })).status);
    assert.equal(r, 200);
    await store.fill("#f-name", "Ada Obi"); await store.fill("#f-email", "ada@example.com");
    await store.fill("#f-phone", "08012345678"); await store.fill("#f-addr", "12 Some Street, Lagos");
    const before = await store.evaluate(() => window.__paystackCalls.length);
    await store.click("#pay");
    await store.waitForSelector("#co-msg .msg.err");
    assert.equal(await store.evaluate(() => window.__paystackCalls.length), before, "Paystack must not be opened");
    assert.match(await store.locator(".summary").innerText(), /₦31,000/);
    assert.equal(await store.inputValue("#f-email"), "ada@example.com", "typed details preserved");
    await store.click("#pay"); // second attempt uses the refreshed amount
    await store.waitForFunction(n => window.__paystackCalls.length === n + 1, before);
    assert.equal((await store.evaluate(() => window.__paystackCalls.at(-1))).amount, 3100000);
  })();

  await check("7. admin: disable sale restores normal displayed price; original price still intact", async () => {
    await openAdminEdit("Silk Wig");
    assert.equal(await admin.inputValue("#p-sale-percentage"), "50");
    await admin.locator("#p-sale-active").evaluate(el => el.click());
    assert.equal(await admin.locator("#p-sale-fields").isVisible(), false);
    await saveAdmin();
    assert.equal(db.products[0].sale_active, false);
    assert.equal(db.products[0].price, 62000);
    await loadStore();
    assert.match(await cardOf("Silk Wig").locator(".price").innerText(), /^₦62,000$/);
    assert.equal(await store.locator(".sale-badge, .price-was").count(), 0);
  })();

  await check("8. admin: create product with sale and without; edit stock/name still work", async () => {
    await goAdminProducts();
    await admin.click("#add-product-btn"); await admin.waitForSelector("#product-modal-overlay.show");
    assert.equal(await admin.locator("#p-sale-active").isChecked(), false);
    await admin.fill("#p-name", "Plain Item"); await admin.fill("#p-price", "5000");
    await saveAdmin();
    await admin.click("#add-product-btn"); await admin.waitForSelector("#product-modal-overlay.show");
    await admin.fill("#p-name", "Promo Item"); await admin.fill("#p-price", "5000");
    await admin.locator("#p-sale-active").evaluate(el => el.click()); await admin.fill("#p-sale-percentage", "10");
    assert.match(await admin.locator("#p-sale-preview").innerText(), /₦4,500/);
    await saveAdmin();
    const plain = db.products.find(p => p.name === "Plain Item"), promo = db.products.find(p => p.name === "Promo Item");
    assert.equal(plain.sale_active, false); assert.equal(promo.sale_active, true); assert.equal(promo.sale_percentage, 10); assert.equal(promo.price, 5000);
    await admin.screenshot({ path: path.join(SHOTS, "admin-grid.png") });
    await openAdminEdit("Closure Hair");
    await admin.locator("#p-in-stock").evaluate(el => el.click()); await admin.fill("#p-name", "Closure Hair v2");
    await saveAdmin();
    const b = db.products.find(p => p.id === "b2");
    assert.equal(b.name, "Closure Hair v2"); assert.equal(b.in_stock, false); assert.equal(b.price, 22000); assert.equal(b.sale_active, false);
  })();

  await check("9. unauthorized: no/invalid token cannot change sale settings", async () => {
    const r = await store.evaluate(async () => {
      const out = [];
      for (const h of [{}, { Authorization: "Bearer nope" }]) out.push((await fetch("/api/admin-products", { method: "PUT", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify({ id: "c3", sale_active: true, sale_percentage: 90 }) })).status);
      return out;
    });
    assert.deepEqual(r, [401, 401]);
    assert.equal(db.products.find(p => p.id === "c3").sale_active, false);
  })();

  await check("10. mobile layout of sale card renders", async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 800 } });
    await m.route(/googleapis|gstatic/, r => r.fulfill({ contentType: "text/css", body: "" }));
    await m.route("https://js.paystack.co/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
    const mp = await m.newPage();
    await mp.goto(base + "/index.html#/shop"); await mp.waitForSelector(".card");
    await mp.screenshot({ path: path.join(SHOTS, "storefront-mobile.png") });
    await m.close();
  })();

  assert.equal(errors.length, 0, "page JS errors: " + errors.join(" | "));
  await browser.close(); server.close();
  for (const [s, n] of results) console.log(s, n);
  const failed = results.filter(r => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
