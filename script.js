/* Peace Nature Empire - vanilla JS storefront */
const app = document.getElementById('app');
const fmt = n => '₦' + Number(n).toLocaleString('en-NG');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cfg = null, products = [], loadError = '', paying = false;
let cart = [];
try { cart = JSON.parse(localStorage.getItem('pne_cart') || '[]').filter(i => i && i.id && i.qty > 0); } catch (e) { cart = []; }
const saveCart = () => { try { localStorage.setItem('pne_cart', JSON.stringify(cart)); } catch (e) {} updateBadge(); };
const updateBadge = () => { document.getElementById('cart-count').textContent = cart.reduce((n, i) => n + i.qty, 0); };
const find = id => products.find(p => String(p.id) === String(id));
const img = p => `<img class="img" src="${esc(p.image || '/images/img1.jpeg')}" alt="${esc(p.name)}" loading="lazy">`;

/* ---------- data ---------- */
async function init() {
  document.getElementById('yr').textContent = new Date().getFullYear();
  updateBadge();
  try {
    const r = await fetch('/api/config');
    cfg = await r.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Store is not configured yet.');
    const pr = await fetch(`${cfg.supabaseUrl}/rest/v1/products?select=*&order=created_at.desc`, {
      headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey }
    });
    if (!pr.ok) throw new Error('Could not load products.');
    products = await pr.json();
  } catch (e) {
    loadError = "We couldn't load our products right now. Please refresh the page or try again shortly.";
  }
  window.addEventListener('hashchange', route);
  route();
}

/* ---------- views ---------- */
function productCard(p) {
  return `<article class="card"><a href="#/product/${esc(p.id)}">${img(p)}<div class="body">
    <h3>${esc(p.name)}</h3><div class="price">${fmt(p.price)}</div>
    <span class="tag ${p.in_stock ? '' : 'out'}">${p.in_stock ? 'In Stock' : 'Sold Out'}</span></div></a></article>`;
}
function productGrid(list) {
  if (loadError) return `<div class="msg err">${loadError}</div>`;
  if (!products.length) return `<div class="msg">Our products are coming soon. Please check back shortly.</div>`;
  if (!list.length) return `<div class="msg">No products found in this category.</div>`;
  return `<div class="grid">${list.map(productCard).join('')}</div>`;
}

function home() {
  return `<section class="hero"><h1>Peace Nature Empire</h1>
    <p>Welcome to our online store. Browse our collection, order in a few clicks and pay securely.</p>
    <a class="btn" href="#/shop">Shop Now</a></section>
  <section class="sec"><div class="sec-head"><h2>Featured Products</h2><a href="#/shop">View all</a></div>${productGrid(products.slice(0, 4))}</section>
  <section class="sec"><h2>Why shop with us</h2><div class="benefits">
    <div><h3>Simple ordering</h3><p>Pick your items, check out and you're done.</p></div>
    <div><h3>Secure payment</h3><p>Payments are processed and verified through Paystack.</p></div>
    <div><h3>Delivered to you</h3><p>Tell us where to send your order at checkout.</p></div></div></section>
  <section class="sec cta"><h2>Have a question?</h2><p>We'd love to hear from you.</p><a class="btn" href="#/contact">Contact Us</a></section>`;
}

let shopCat = 'All';
function shop() {
  const cats = ['All', ...new Set(products.map(p => p.category).filter(Boolean))];
  const list = shopCat === 'All' ? products : products.filter(p => p.category === shopCat);
  const filter = cats.length > 2 ? `<p>${cats.map(c => `<button class="btn ${c === shopCat ? '' : 'alt'}" data-cat="${esc(c)}" style="padding:6px 14px;margin:0 6px 6px 0">${esc(c)}</button>`).join('')}</p>` : '';
  return `<h2>Shop</h2>${filter}${productGrid(list)}`;
}

let detailQty = 1;
function productPage(id) {
  if (loadError) return `<div class="msg err">${loadError}</div>`;
  const p = find(id);
  if (!p) return `<div class="center"><h2>Product not found</h2><p>This product may no longer be available.</p><a class="btn" href="#/shop">Back to Shop</a></div>`;
  return `<a href="#/shop">&larr; Back to Shop</a><div class="detail" style="margin-top:16px">${img(p)}<div>
    <h1 style="font-size:2rem">${esc(p.name)}</h1><div class="price" style="font-size:1.4rem">${fmt(p.price)}</div>
    <p><span class="tag ${p.in_stock ? '' : 'out'}">${p.in_stock ? 'In Stock' : 'Sold Out'}</span>
    ${p.category ? ` <span class="tag">${esc(p.category)}</span>` : ''}</p>
    <p>${esc(p.description || '')}</p>
    ${p.in_stock ? `<p><span class="qty"><button data-dq="-1" aria-label="Decrease">&minus;</button><span id="dq">${detailQty}</span><button data-dq="1" aria-label="Increase">+</button></span></p>
    <button class="btn" data-add="${esc(p.id)}">Add to Cart</button>` : `<button class="btn" disabled>Sold Out</button>`}
    <div id="added"></div></div></div>`;
}

function cartLines() {
  return cart.map(i => ({ ...i, p: find(i.id) }));
}
const validLines = () => cartLines().filter(l => l.p && l.p.in_stock);
const cartTotal = () => validLines().reduce((s, l) => s + Number(l.p.price) * l.qty, 0);

function cartPage() {
  if (!cart.length) return `<div class="center"><h2>Your cart is empty</h2><p>Add something you love to get started.</p><a class="btn" href="#/shop">Continue Shopping</a></div>`;
  if (loadError) return `<div class="msg err">${loadError}</div>`;
  const rows = cartLines().map(l => l.p ? `<div class="row">${img(l.p)}<div><strong>${esc(l.p.name)}</strong><div>${fmt(l.p.price)}</div>
    ${l.p.in_stock ? '' : '<div class="field-err">Sold out – please remove this item to continue.</div>'}
    <button class="link" data-rm="${esc(l.id)}">Remove</button></div>
    <div class="sub"><span class="qty"><button data-q="${esc(l.id)}" data-d="-1" aria-label="Decrease">&minus;</button><span>${l.qty}</span><button data-q="${esc(l.id)}" data-d="1" aria-label="Increase">+</button></span>
    <div><strong>${fmt(l.p.price * l.qty)}</strong></div></div></div>`
    : `<div class="row"><div></div><div><strong>Unavailable item</strong><div class="field-err">This product is no longer available.</div><button class="link" data-rm="${esc(l.id)}">Remove</button></div><div></div></div>`).join('');
  const blocked = cartLines().some(l => !l.p || !l.p.in_stock);
  return `<h2>Your Cart</h2>${rows}<div class="totals"><div>Subtotal: ${fmt(cartTotal())}</div><div class="t">Total: ${fmt(cartTotal())}</div></div>
    <div class="actions"><a class="btn alt" href="#/shop">Continue Shopping</a>
    <a class="btn" href="#/checkout" ${blocked ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ''}>Proceed to Checkout</a></div>`;
}

function checkoutPage() {
  if (loadError) return `<div class="msg err">${loadError}</div>`;
  if (!cart.length) return cartPage();
  if (cartLines().some(l => !l.p || !l.p.in_stock)) return `<div class="msg err">Some items in your cart are unavailable. Please review your cart.</div><a class="btn" href="#/cart">Back to Cart</a>`;
  const lines = validLines();
  return `<h2>Checkout</h2><div class="two"><form id="co" novalidate>
    <label for="f-name">Full name</label><input id="f-name" autocomplete="name"><div class="field-err" data-e="name"></div>
    <label for="f-email">Email</label><input id="f-email" type="email" autocomplete="email"><div class="field-err" data-e="email"></div>
    <label for="f-phone">Phone</label><input id="f-phone" type="tel" autocomplete="tel"><div class="field-err" data-e="phone"></div>
    <label for="f-addr">Delivery address</label><textarea id="f-addr" rows="3" autocomplete="street-address"></textarea><div class="field-err" data-e="addr"></div>
    <div id="co-msg"></div><p><button class="btn" id="pay" type="submit">Pay ${fmt(cartTotal())}</button></p></form>
    <aside class="summary"><h3>Order Summary</h3>
    ${lines.map(l => `<div class="l"><span>${esc(l.p.name)} × ${l.qty}</span><span>${fmt(l.p.price * l.qty)}</span></div>`).join('')}
    <hr style="border:0;border-top:1px solid var(--line)"><div class="l"><strong>Total</strong><strong>${fmt(cartTotal())}</strong></div>
    <a href="#/cart">Edit cart</a></aside></div>`;
}

function contactPage() {
  return `<h2>Contact</h2><p>We'd love to hear from you.</p><div class="benefits">
    <div><h3>Phone</h3><p>[Your phone number]</p></div><div><h3>Email</h3><p>[Your email address]</p></div>
    <div><h3>Instagram</h3><p>[Your Instagram handle]</p></div><div><h3>Location</h3><p>[Your location]</p></div></div>`;
}

function successPage(orderId, ref) {
  return `<div class="center"><h1>Thank you for your order!</h1><p>Your payment was verified and your order has been received.</p>
    <p><strong>Order ID:</strong> ${esc(orderId)}<br><strong>Payment reference:</strong> ${esc(ref)}</p>
    <p>A confirmation has been recorded for the email you provided.</p><a class="btn" href="#/shop">Continue Shopping</a></div>`;
}

/* ---------- router ---------- */
let lastOrder = null;
function route() {
  const [, page = '', arg] = location.hash.replace('#', '').split('/');
  let html;
  if (page === 'shop') html = shop();
  else if (page === 'product') { detailQty = 1; html = productPage(arg); }
  else if (page === 'cart') html = cartPage();
  else if (page === 'checkout') html = checkoutPage();
  else if (page === 'contact') html = contactPage();
  else if (page === 'success' && lastOrder) html = successPage(lastOrder.orderId, lastOrder.reference);
  else html = home();
  app.innerHTML = html;
  const key = ['shop', 'contact', 'cart'].includes(page) ? page : (page === '' || page === 'success' ? 'home' : page === 'product' ? 'shop' : 'cart');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === key));
  window.scrollTo(0, 0);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.cat) { shopCat = t.dataset.cat; route(); }
  if (t.dataset.dq) { detailQty = Math.min(99, Math.max(1, detailQty + Number(t.dataset.dq))); document.getElementById('dq').textContent = detailQty; }
  if (t.dataset.add) {
    const p = find(t.dataset.add);
    if (!p || !p.in_stock) { document.getElementById('added').innerHTML = '<div class="msg err">Sorry, this item is sold out.</div>'; return; }
    const line = cart.find(i => String(i.id) === String(p.id));
    if (line) line.qty = Math.min(99, line.qty + detailQty); else cart.push({ id: p.id, qty: detailQty });
    saveCart();
    document.getElementById('added').innerHTML = '<div class="msg">Added to cart. <a href="#/cart">View cart</a> or <a href="#/shop">continue shopping</a>.</div>';
  }
  if (t.dataset.q) {
    const line = cart.find(i => String(i.id) === t.dataset.q);
    if (line) { line.qty = Math.min(99, Math.max(1, line.qty + Number(t.dataset.d))); saveCart(); route(); }
  }
  if (t.dataset.rm) { cart = cart.filter(i => String(i.id) !== t.dataset.rm); saveCart(); route(); }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'co') return;
  e.preventDefault();
  if (paying) return;
  const v = id => document.getElementById(id).value.trim();
  const d = { name: v('f-name'), email: v('f-email'), phone: v('f-phone'), address: v('f-addr') };
  const errs = {};
  if (d.name.length < 2) errs.name = 'Please enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errs.email = 'Please enter a valid email address.';
  if (d.phone.replace(/\D/g, '').length < 7) errs.phone = 'Please enter a valid phone number.';
  if (d.address.length < 8) errs.addr = 'Please enter your full delivery address.';
  document.querySelectorAll('[data-e]').forEach(el => el.textContent = errs[el.dataset.e] || '');
  if (Object.keys(errs).length) return;
  startPayment(d);
});

/* ---------- payment ---------- */
function setMsg(html, err) { const m = document.getElementById('co-msg'); if (m) m.innerHTML = html ? `<div class="msg ${err ? 'err' : ''}">${html}</div>` : ''; }
function startPayment(customer) {
  if (!window.PaystackPop || !cfg.paystackPublicKey) return setMsg('Payment is currently unavailable. Please try again later.', true);
  const items = validLines().map(l => ({ id: l.id, quantity: l.qty }));
  const total = cartTotal();
  const reference = 'PNE-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const btn = document.getElementById('pay');
  setMsg('');
  window.PaystackPop.setup({
    key: cfg.paystackPublicKey, email: customer.email, amount: Math.round(total * 100), currency: 'NGN', ref: reference,
    metadata: { custom_fields: [{ display_name: 'Customer', variable_name: 'customer', value: customer.name }] },
    callback: function (resp) { verify(resp.reference || reference, customer, items, btn); },
    onClose: function () { if (!paying) setMsg('Payment was cancelled. Your cart is still saved – you can try again.', true); }
  }).openIframe();
}
async function verify(reference, customer, items, btn) {
  paying = true; btn.disabled = true; btn.textContent = 'Verifying payment…';
  setMsg('Payment received. Please wait while we confirm your order – do not close this page.');
  try {
    const r = await fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference, customer, items }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) throw new Error(data.message || 'We could not confirm your payment.');
    lastOrder = { orderId: data.orderId, reference };
    cart = []; saveCart(); paying = false;
    location.hash = '#/success';
  } catch (err) {
    paying = false; btn.disabled = false; btn.textContent = 'Try again';
    setMsg(`${esc(err.message)} If you were charged, please contact us with your payment reference: <strong>${esc(reference)}</strong>.`, true);
  }
}

init();
