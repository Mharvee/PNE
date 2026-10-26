// Exercises api/verify-payment.js with fake Supabase REST + fake Paystack. No network, no real payments.
const test = require("node:test");
const assert = require("node:assert/strict");
const { mockRes } = require("./helpers");

process.env.PAYSTACK_SECRET_KEY = "sk_test_fake";
process.env.SUPABASE_URL = "http://supabase.fake";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-fake";
const handler = require("../api/verify-payment.js");

const PRODUCTS = () => ([
  { id: "p1", name: "Sale wig", price: 62000, in_stock: true, sale_active: true, sale_percentage: 20 },
  { id: "p2", name: "Normal wig", price: 22000, in_stock: true, sale_active: false, sale_percentage: null },
  { id: "p3", name: "Gone wig", price: 10000, in_stock: false, sale_active: false, sale_percentage: null }
]);

function setup({ products = PRODUCTS(), paystack }) {
  const state = { orders: [], items: [], paystackCalls: 0 };
  global.fetch = async (url, opts = {}) => {
    url = String(url);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (url.startsWith("https://api.paystack.co/transaction/verify/")) {
      state.paystackCalls++;
      return json(200, paystack);
    }
    const path = url.replace("http://supabase.fake/rest/v1/", "");
    if (path.startsWith("orders?payment_reference=eq.")) {
      const ref = decodeURIComponent(path.split("eq.")[1].split("&")[0]);
      return json(200, state.orders.filter(o => o.payment_reference === ref).map(o => ({ id: o.id })));
    }
    if (path.startsWith("products?id=in.(")) {
      const ids = decodeURIComponent(path.slice("products?id=in.(".length, path.indexOf(")"))).split(",");
      return json(200, products.filter(p => ids.includes(p.id)));
    }
    if (path === "orders" && opts.method === "POST") {
      const row = { id: "order-" + (state.orders.length + 1), ...JSON.parse(opts.body) };
      state.orders.push(row);
      return json(201, [row]);
    }
    if (path === "order_items" && opts.method === "POST") {
      state.items.push(...JSON.parse(opts.body));
      return json(201, []);
    }
    return json(404, { message: "unexpected " + path });
  };
  return state;
}

const customer = { name: "Ada Obi", email: "ada@example.com", phone: "08012345678", address: "12 Some Street, Lagos" };
const post = async body => { const res = mockRes(); await handler({ method: "POST", body }, res); return res; };
const ps = (amountNaira, over = {}) => ({ status: true, data: { status: "success", currency: "NGN", amount: Math.round(amountNaira * 100), customer: { email: "ada@example.com" }, ...over } });

test("sale product is charged its sale price; order item records the price paid", async () => {
  const st = setup({ paystack: ps(49600) });
  const r = await post({ reference: "PNE-REF-0001", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(st.orders[0].total_amount, 49600);
  assert.equal(st.items[0].price, 49600);
});

test("mixed cart: only the sale product is discounted", async () => {
  const st = setup({ paystack: ps(49600 * 2 + 22000) });
  const r = await post({ reference: "PNE-REF-0002", customer, items: [{ id: "p1", quantity: 2 }, { id: "p2", quantity: 1 }] });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(st.orders[0].total_amount, 121200);
  assert.deepEqual(st.items.map(i => i.price).sort((a, b) => a - b), [22000, 49600]);
});

test("customer who paid FULL price for a product that is on sale is rejected (amount mismatch)", async () => {
  const st = setup({ paystack: ps(62000) });
  const r = await post({ reference: "PNE-REF-0003", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r.statusCode, 400);
  assert.equal(st.orders.length, 0);
});

test("customer who paid the sale price for a product NOT on sale is rejected", async () => {
  const st = setup({ paystack: ps(22000 * 0.8) });
  const r = await post({ reference: "PNE-REF-0004", customer, items: [{ id: "p2", quantity: 1 }] });
  assert.equal(r.statusCode, 400);
  assert.equal(st.orders.length, 0);
});

test("prices / discounts / totals supplied by the browser are ignored", async () => {
  const st = setup({ paystack: ps(49600) });
  const r = await post({ reference: "PNE-REF-0005", customer, total: 1, amount: 1, items: [{ id: "p1", quantity: 1, price: 1, sale_percentage: 99, sale_active: true }] });
  assert.equal(r.statusCode, 200);
  assert.equal(st.orders[0].total_amount, 49600);
});

test("unverified / failed / abandoned Paystack transactions are rejected", async () => {
  for (const status of ["failed", "abandoned", "pending", "reversed"]) {
    const st = setup({ paystack: ps(49600, { status }) });
    const r = await post({ reference: "PNE-REF-0006", customer, items: [{ id: "p1", quantity: 1 }] });
    assert.equal(r.statusCode, 402, status);
    assert.equal(st.orders.length, 0);
  }
  const st2 = setup({ paystack: { status: false, message: "Transaction reference not found" } });
  const r2 = await post({ reference: "PNE-REF-0007", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r2.statusCode, 402);
  assert.equal(st2.orders.length, 0);
});

test("wrong currency or wrong payer email is rejected", async () => {
  let st = setup({ paystack: ps(49600, { currency: "USD" }) });
  let r = await post({ reference: "PNE-REF-0008", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r.statusCode, 400); assert.equal(st.orders.length, 0);
  st = setup({ paystack: ps(49600, { customer: { email: "someone@else.com" } }) });
  r = await post({ reference: "PNE-REF-0009", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r.statusCode, 400); assert.equal(st.orders.length, 0);
});

test("sold-out items are rejected before Paystack is even called", async () => {
  const st = setup({ paystack: ps(10000) });
  const r = await post({ reference: "PNE-REF-0010", customer, items: [{ id: "p3", quantity: 1 }] });
  assert.equal(r.statusCode, 400);
  assert.equal(st.paystackCalls, 0);
});

test("same reference twice returns the same order (no duplicate order)", async () => {
  const st = setup({ paystack: ps(49600) });
  const a = await post({ reference: "PNE-REF-0011", customer, items: [{ id: "p1", quantity: 1 }] });
  const b = await post({ reference: "PNE-REF-0011", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(a.body.orderId, b.body.orderId);
  assert.equal(st.orders.length, 1);
});

test("a product with an invalid stored discount is charged its normal price", async () => {
  const products = PRODUCTS(); products[0].sale_percentage = 100;
  const st = setup({ products, paystack: ps(62000) });
  const r = await post({ reference: "PNE-REF-0012", customer, items: [{ id: "p1", quantity: 1 }] });
  assert.equal(r.statusCode, 200);
  assert.equal(st.orders[0].total_amount, 62000);
});
