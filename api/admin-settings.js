// api/admin-settings.js
//
// Authenticated admin operations for store settings (sale).
// GET -> current sale settings
// PUT -> update sale settings (body: { sale_active, sale_percentage })

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

module.exports = async (req, res) => {
  const user = await requireAdmin(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("store_settings")
        .select("sale_active, sale_percentage")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      res.status(200).json(data || { sale_active: false, sale_percentage: 0 });
      return;
    }

    if (req.method === "PUT") {
      const { sale_active, sale_percentage } = req.body || {};
      if (typeof sale_active !== "boolean") {
        res.status(400).json({ error: "Sale status must be on or off." });
        return;
      }
      if (typeof sale_percentage !== "number" || !isFinite(sale_percentage) || sale_percentage < 0 || sale_percentage > 100) {
        res.status(400).json({ error: "Discount must be a number between 0 and 100." });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from("store_settings")
        .upsert({ id: 1, sale_active, sale_percentage, updated_at: new Date().toISOString() })
        .select("sale_active, sale_percentage")
        .single();
      if (error) throw error;
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ error: "Method not allowed." });
  } catch (err) {
    console.error("admin-settings error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
