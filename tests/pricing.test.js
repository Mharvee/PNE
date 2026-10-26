const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../pricing.js");

test("spec examples", () => {
  assert.equal(P.salePriceOf(62000, 20), 49600);
  assert.equal(P.salePriceOf(22000, 10), 19800);
  assert.equal(P.salePriceOf(42000, 25), 31500);
});

test("unitPrice: sale applies only when explicitly active with a valid percentage", () => {
  const base = { price: 62000, sale_active: true, sale_percentage: 20 };
  assert.equal(P.unitPrice(base), 49600);
  assert.equal(P.unitPrice({ ...base, sale_active: false }), 62000);
  assert.equal(P.unitPrice({ ...base, sale_active: "true" }), 62000);
  assert.equal(P.unitPrice({ ...base, sale_active: undefined }), 62000); // columns missing / old rows
  assert.equal(P.unitPrice({ price: 62000 }), 62000);
  for (const bad of [0, 100, -5, 20.5, null, undefined, "20", NaN, 1000]) {
    assert.equal(P.unitPrice({ ...base, sale_percentage: bad }), 62000, "pct " + String(bad));
  }
});

test("discount is always computed from the original price (never compounds)", () => {
  const p = { price: 42000, sale_active: true, sale_percentage: 25 };
  assert.equal(P.unitPrice(p), 31500);
  assert.equal(P.unitPrice(p), 31500); // repeated calls give the same answer
  assert.equal(p.price, 42000);         // original untouched
});

test("percent validation: whole numbers 1..99 only", () => {
  for (const ok of [1, 20, 50, 99]) assert.equal(P.isValidPercent(ok), true);
  for (const bad of [0, 100, -1, 1.5, 99.9, "20", null, undefined, NaN, Infinity]) assert.equal(P.isValidPercent(bad), false);
});

test("rounding is to whole naira and deterministic (.5 rounds up)", () => {
  assert.equal(P.salePriceOf(5555, 15), 4722);   // 4721.75
  assert.equal(P.salePriceOf(1001, 50), 501);    // 500.5
  assert.equal(P.salePriceOf(19999.99, 10), 18000); // 17999.991
});

test("a sale that would round to under N1 is not treated as a sale", () => {
  assert.equal(P.isOnSale({ price: 1, sale_active: true, sale_percentage: 99 }), false);
  assert.equal(P.unitPrice({ price: 1, sale_active: true, sale_percentage: 99 }), 1);
});
