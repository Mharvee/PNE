// Verifies a Paystack payment server-side, re-prices the cart from Supabase, then creates the order.
module.exports = async (req, res) => {
  const fail = (code, message) => res.status(code).json({ ok: false, message });
  if (req.method !== 'POST') return fail(405, 'Method not allowed.');

  const { PAYSTACK_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return fail(500, 'The store is not fully configured yet.');

  const { reference, customer = {}, items } = req.body || {};
  const name = String(customer.name || '').trim(), email = String(customer.email || '').trim();
  const phone = String(customer.phone || '').trim(), address = String(customer.address || '').trim();
  if (!/^[\w.-]{6,100}$/.test(String(reference || ''))) return fail(400, 'Invalid payment reference.');
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.length < 7 || address.length < 8) return fail(400, 'Please check your checkout details.');
  if (!Array.isArray(items) || !items.length || items.length > 50) return fail(400, 'Your cart is empty.');

  const clean = new Map();
  for (const i of items) {
    const id = String(i.id || ''), q = Number(i.quantity);
    if (!/^[\w-]{1,64}$/.test(id) || !Number.isInteger(q) || q < 1 || q > 99) return fail(400, 'Invalid cart items.');
    clean.set(id, (clean.get(id) || 0) + q);
  }

  const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });

  try {
    // 1. Idempotency: same reference already recorded -> return that order.
    const ex = await (await sb(`orders?payment_reference=eq.${encodeURIComponent(reference)}&select=id`)).json();
    if (Array.isArray(ex) && ex.length) return res.status(200).json({ ok: true, orderId: ex[0].id });

    // 2. Real prices from Supabase.
    const ids = [...clean.keys()].map(encodeURIComponent).join(',');
    const pr = await sb(`products?id=in.(${ids})&select=id,name,price,in_stock`);
    const prods = await pr.json();
    if (!pr.ok || !Array.isArray(prods)) return fail(502, 'We could not check product prices. Please try again.');
    if (prods.length !== clean.size) return fail(400, 'One or more products are no longer available.');
    let total = 0;
    for (const p of prods) {
      if (!p.in_stock) return fail(400, `"${p.name}" is sold out.`);
      total += Number(p.price) * clean.get(String(p.id));
    }

    // 3. Verify with Paystack.
    const pv = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
    const pd = await pv.json().catch(() => ({}));
    if (!pv.ok || !pd.status || !pd.data) return fail(402, 'We could not verify your payment with Paystack.');
    const t = pd.data;
    if (t.status !== 'success') return fail(402, 'Your payment was not successful.');
    if (t.currency !== 'NGN' || t.amount !== Math.round(total * 100)) return fail(400, 'The amount paid does not match your order total.');
    if (String(t.customer && t.customer.email).toLowerCase() !== email.toLowerCase()) return fail(400, 'The payment email does not match your order.');

    // 4. Create order + items (only now).
    const or = await sb('orders', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ customer_name: name, email, phone, address, total_amount: total, payment_reference: reference, payment_status: 'paid', order_status: 'processing' })
    });
    const od = await or.json();
    if (!or.ok || !od[0]) {
      const again = await (await sb(`orders?payment_reference=eq.${encodeURIComponent(reference)}&select=id`)).json();
      if (Array.isArray(again) && again.length) return res.status(200).json({ ok: true, orderId: again[0].id });
      return fail(500, 'Your payment was verified but we could not save your order.');
    }
    const orderId = od[0].id;
    const ir = await sb('order_items', {
      method: 'POST',
      body: JSON.stringify(prods.map(p => ({ order_id: orderId, product_id: p.id, quantity: clean.get(String(p.id)), price: p.price })))
    });
    if (!ir.ok) return fail(500, 'Your payment was verified but we could not save your order items.');
    return res.status(200).json({ ok: true, orderId });
  } catch (e) {
    return fail(500, 'Something went wrong while confirming your order.');
  }
};
