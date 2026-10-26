const { createClient } = require("@supabase/supabase-js");
const { isValidPercent, salePriceOf } = require("../pricing.js");

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

// Validates the sale state that WOULD result from a create/update. Returns an
// error message, or null if fine. `price` is the original (stored) price.
function saleError(price, sale_active, sale_percentage) {
  if (sale_percentage !== null && sale_percentage !== undefined && !isValidPercent(sale_percentage)) {
    return "Discount must be a whole number between 1 and 99.";
  }
  if (sale_active) {
    if (!isValidPercent(sale_percentage)) {
      return "Enter a discount between 1% and 99% to put this product on sale.";
    }
    if (!(price > 0) || salePriceOf(price, sale_percentage) < 1) {
      return "The sale price would be below ₦1. Use a smaller discount or a higher price.";
    }
  }
  return null;
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
      const { name, description, price, category, image, in_stock, sale_active, sale_percentage } = req.body || {};
      if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({ error: "Product name is required." });
        return;
      }
      if (!isValidPrice(price)) {
        res.status(400).json({ error: "A valid, non-negative price is required." });
        return;
      }
      if (sale_active !== undefined && typeof sale_active !== "boolean") {
        res.status(400).json({ error: "Sale status must be on or off." });
        return;
      }
      const saleOn = sale_active === true;
      const msg = saleError(price, saleOn, sale_percentage);
      if (msg) {
        res.status(400).json({ error: msg });
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
          in_stock: in_stock === undefined ? true : !!in_stock,
          sale_active: saleOn,
          sale_percentage: sale_percentage === undefined ? null : sale_percentage
        })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
      return;
    }

    if (req.method === "PUT") {
      const { id, name, description, price, category, image, in_stock, sale_active, sale_percentage } = req.body || {};
      if (!id) {
        res.status(400).json({ error: "Product id is required." });
        return;
      }
      if (price !== undefined && !isValidPrice(price)) {
        res.status(400).json({ error: "A valid, non-negative price is required." });
        return;
      }
      if (sale_active !== undefined && typeof sale_active !== "boolean") {
        res.status(400).json({ error: "Sale status must be on or off." });
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

      // Sale settings are validated against the state the product will be in AFTER
      // this update (so changing only the price of a product on sale is re-checked too).
      // The original price is never derived from, or overwritten by, a sale price.
      const touchesSale = sale_active !== undefined || sale_percentage !== undefined || price !== undefined;
      if (touchesSale) {
        const { data: current, error: curErr } = await supabaseAdmin
          .from("products")
          .select("price, sale_active, sale_percentage")
          .eq("id", id)
          .single();
        if (curErr || !current) {
          res.status(404).json({ error: "Product not found." });
          return;
        }
        const nextPrice = price !== undefined ? price : Number(current.price);
        const nextActive = sale_active !== undefined ? sale_active : current.sale_active === true;
        const nextPercent = sale_percentage !== undefined ? sale_percentage : current.sale_percentage;
        const msg = saleError(nextPrice, nextActive, nextPercent);
        if (msg) {
          res.status(400).json({ error: msg });
          return;
        }
        if (sale_active !== undefined) update.sale_active = sale_active;
        if (sale_percentage !== undefined) update.sale_percentage = sale_percentage;
      }

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
