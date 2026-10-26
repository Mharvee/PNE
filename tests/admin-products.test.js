const test = require("node:test");
const assert = require("node:assert/strict");
const { installFakeSupabase, mockRes } = require("./helpers");

const db = { products: [] };
installFakeSupabase(db);
const handler = require("../api/admin-products.js");

const call = async (method, body, token = "admin-token") => {
  const res = mockRes();
  await handler({ method, body, headers: token ? { authorization: "Bearer " + token } : {} }, res);
  return res;
};
const seed = () => {
  db.products = [
    { id: "a", name: "Wig A", price: 62000, in_stock: true, image: "/i/a.jpg", description: "d", category: "Wig", sale_active: false, sale_percentage: null },
    { id: "b", name: "Wig B", price: 22000, in_stock: true, image: null, description: null, category: null, sale_active: false, sale_percentage: null }
  ];
};

test("unauthenticated and invalid-token requests cannot read or change anything", async () => {
  seed();
  for (const token of [null, "bad-token"]) {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) {
      const r = await call(m, { id: "a", name: "x", price: 1, sale_active: true, sale_percentage: 50 }, token);
      assert.equal(r.statusCode, 401, m);
    }
  }
  assert.equal(db.products[0].sale_active, false);
  assert.equal(db.products[0].price, 62000);
});

test("enable a sale on an existing product; original price is untouched", async () => {
  seed();
  const r = await call("PUT", { id: "a", sale_active: true, sale_percentage: 20 });
  assert.equal(r.statusCode, 200);
  assert.equal(db.products[0].sale_active, true);
  assert.equal(db.products[0].sale_percentage, 20);
  assert.equal(db.products[0].price, 62000);
  assert.equal(db.products[1].sale_active, false, "other products must not be affected");
});

test("edit the discount later, then disable: original price restored, nothing else changed", async () => {
  seed();
  await call("PUT", { id: "a", sale_active: true, sale_percentage: 20 });
  await call("PUT", { id: "a", sale_active: true, sale_percentage: 35 });
  assert.equal(db.products[0].sale_percentage, 35);
  const off = await call("PUT", { id: "a", sale_active: false });
  assert.equal(off.statusCode, 200);
  assert.equal(db.products[0].sale_active, false);
  assert.equal(db.products[0].price, 62000);
  assert.equal(db.products[0].in_stock, true);
  assert.equal(db.products[0].image, "/i/a.jpg");
});

test("invalid discounts are rejected server-side", async () => {
  seed();
  for (const pct of [0, 100, -10, 20.5, "20", null, undefined, NaN, 5000]) {
    const r = await call("PUT", { id: "a", sale_active: true, sale_percentage: pct });
    assert.equal(r.statusCode, 400, "pct " + String(pct));
  }
  const r2 = await call("PUT", { id: "a", sale_active: "yes", sale_percentage: 10 });
  assert.equal(r2.statusCode, 400);
  const r3 = await call("PUT", { id: "a", sale_active: false, sale_percentage: 150 });
  assert.equal(r3.statusCode, 400);
  assert.equal(db.products[0].sale_active, false);
  assert.equal(db.products[0].sale_percentage, null);
});

test("changing only the price of a product that is on sale is re-validated", async () => {
  seed();
  await call("PUT", { id: "a", sale_active: true, sale_percentage: 99 });
  const r = await call("PUT", { id: "a", price: 1 }); // 99% off N1 would be N0
  assert.equal(r.statusCode, 400);
  assert.equal(db.products[0].price, 62000);
  const ok = await call("PUT", { id: "a", price: 70000 });
  assert.equal(ok.statusCode, 200);
  assert.equal(db.products[0].price, 70000);
});

test("normal product edits without sale fields still work (name, stock, image)", async () => {
  seed();
  const r = await call("PUT", { id: "b", name: "Wig B2", in_stock: false, image: "/i/new.jpg" });
  assert.equal(r.statusCode, 200);
  assert.equal(db.products[1].name, "Wig B2");
  assert.equal(db.products[1].in_stock, false);
  assert.equal(db.products[1].image, "/i/new.jpg");
  assert.equal(db.products[1].sale_active, false);
});

test("create product without a sale, and with a sale", async () => {
  seed();
  const plain = await call("POST", { name: "Plain", price: 5000 });
  assert.equal(plain.statusCode, 201);
  assert.equal(plain.body.sale_active, false);
  assert.equal(plain.body.sale_percentage, null);
  const sale = await call("POST", { name: "Sale", price: 5000, sale_active: true, sale_percentage: 10 });
  assert.equal(sale.statusCode, 201);
  assert.equal(sale.body.sale_active, true);
  assert.equal(sale.body.price, 5000);
  const bad = await call("POST", { name: "Bad", price: 5000, sale_active: true });
  assert.equal(bad.statusCode, 400);
  const bad2 = await call("POST", { name: "Bad", price: 5000, sale_active: true, sale_percentage: 100 });
  assert.equal(bad2.statusCode, 400);
});
