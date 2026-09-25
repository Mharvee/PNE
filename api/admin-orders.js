// api/admin-orders.js
//
// Authenticated admin operations for orders.
// GET  (no query)   -> list all orders, newest first
// GET  ?id=<id>     -> a single order with customer/payment info and items
// PUT               -> update order_status only (body: { id, order_status })
//
// Payment status is intentionally never editable here — it is controlled
// by the payment system, not the admin dashboard.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const ALLOWED_STATUSES = ["processing", "shipped", "delivered", "cancelled"];

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

module.exports = async (req, res) => {
  const user = await requireAdmin(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    if (req.method === "GET") {
      const id = req.query && req.query.id;

      if (id) {
        const { data: order, error: orderErr } = await supabaseAdmin
          .from("orders")
          .select("*")
          .eq("id", id)
          .single();
        if (orderErr) throw orderErr;
        if (!order) {
          res.status(404).json({ error: "Order not found." });
          return;
        }

        const { data: items, error: itemsErr } = await supabaseAdmin
          .from("order_items")
          .select("id, quantity, price, product_id, products(name)")
          .eq("order_id", id);
        if (itemsErr) throw itemsErr;

        const formattedItems = (items || []).map((it) => ({
          id: it.id,
          quantity: it.quantity,
          price: it.price,
          product_id: it.product_id,
          product_name: it.products ? it.products.name : null
        }));

        res.status(200).json({ ...order, items: formattedItems });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.status(200).json(data);
      return;
    }

    if (req.method === "PUT") {
      const { id, order_status } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Order id is required." });
        return;
      }
      if (!ALLOWED_STATUSES.includes(order_status)) {
        res.status(400).json({ error: "Invalid order status." });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from("orders")
        .update({ order_status })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("admin-orders error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
