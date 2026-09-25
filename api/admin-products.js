const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}

function isValidPrice(v) {
  return typeof v === "number" && isFinite(v) && v >= 0;
}

module.exports = async (req, res) => {
  const user = await requireAdmin(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("products")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      res.status(200).json(data);
      return;
    }

    if (req.method === "POST") {
      const { name, description, price, category, image, in_stock } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Product name is required." });
        return;
      }
      if (!isValidPrice(price)) {
        res.status(400).json({ error: "A valid, non-negative price is required." });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from("products")
        .insert({
          name: name.trim(),
          description: description ? String(description).trim() : null,
          price,
          category: category ? String(category).trim() : null,
          image: image || null,
          in_stock: in_stock === undefined ? true : !!in_stock
        })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
      return;
    }

    if (req.method === "PUT") {
      const { id, name, description, price, category, image, in_stock } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Product id is required." });
        return;
      }
      if (price !== undefined && !isValidPrice(price)) {
        res.status(400).json({ error: "A valid, non-negative price is required." });
        return;
      }
      const update = {};
      if (name !== undefined) {
        const trimmedName = String(name).trim();

        if (!trimmedName) {
          res.status(400).json({ error: "Product name cannot be empty." });
          return;
        }

          update.name = trimmedName;
      }
      if (description !== undefined) update.description = description ? String(description).trim() : null;
      if (price !== undefined) update.price = price;
      if (category !== undefined) update.category = category ? String(category).trim() : null;
      if (image !== undefined) update.image = image || null;
      if (in_stock !== undefined) update.in_stock = !!in_stock;

      const { data, error } = await supabaseAdmin
        .from("products")
        .update(update)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      res.status(200).json(data);
      return;
    }

    if (req.method === "DELETE") {
      const { id } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Product id is required." });
        return;
      }
      const { error } = await supabaseAdmin.from("products").delete().eq("id", id);
      if (error) throw error;
      res.status(200).json({ success: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("admin-products error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
