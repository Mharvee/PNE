/* Peace Nature Empire - shared sale pricing rules.
 *
 * ONE implementation used by the storefront (loaded with a <script> tag, exposes
 * window.PNEPricing) and by the serverless functions (require("../pricing.js")),
 * so the price a customer sees and the price the server charges can never drift.
 *
 * The original product price is never modified. The sale price is always derived
 * from the stored original price:
 *     sale price = original price x (1 - discount / 100)
 * rounded to the nearest whole naira (the store displays whole naira).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PNEPricing = factory();
})(typeof self !== "undefined" ? self : this, function () {
  var MIN_PERCENT = 1;
  var MAX_PERCENT = 99;

  // A discount is valid only if it is a whole number from 1 to 99.
  function isValidPercent(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= MIN_PERCENT && v <= MAX_PERCENT;
  }

  // Sale price from an ORIGINAL price. Works in kobo integers so that browser and
  // server always agree, and so ".5" cases round the same way everywhere.
  function salePriceOf(price, percent) {
    var kobo = Math.round(Number(price) * 100);
    return Math.round((kobo * (100 - percent)) / 10000);
  }

  // A product is on sale only when the flag is explicitly true AND the stored
  // percentage is valid. Anything else (missing columns, null, bad data) = no sale.
  function isOnSale(p) {
    return !!p && p.sale_active === true && isValidPercent(p.sale_percentage) &&
      Number(p.price) > 0 && salePriceOf(p.price, p.sale_percentage) >= 1;
  }

  // The price a customer actually pays for ONE unit of this product.
  function unitPrice(p) {
    return isOnSale(p) ? salePriceOf(p.price, p.sale_percentage) : Number(p.price);
  }

  return {
    MIN_PERCENT: MIN_PERCENT,
    MAX_PERCENT: MAX_PERCENT,
    isValidPercent: isValidPercent,
    salePriceOf: salePriceOf,
    isOnSale: isOnSale,
    unitPrice: unitPrice
  };
});
