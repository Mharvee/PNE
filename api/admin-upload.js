
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "product-images";
const MAX_BYTES = 3 * 1024 * 1024; 
const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

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
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const user = await requireAdmin(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    const { contentType, fileData } = req.body || {};

    if (!contentType || !ALLOWED_TYPES[contentType]) {
      res.status(400).json({ error: "Only JPG, PNG, and WebP images are allowed." });
      return;
    }
    if (!fileData || typeof fileData !== "string") {
      res.status(400).json({ error: "No image data received." });
      return;
    }

    const base64 = fileData.includes(",") ? fileData.split(",")[1] : fileData;
    const buffer = Buffer.from(base64, "base64");

    if (buffer.length === 0) {
      res.status(400).json({ error: "Image data is empty." });
      return;
    }
    if (buffer.length > MAX_BYTES) {
      res.status(400).json({ error: "Image must be under 3MB." });
      return;
    }

    const ext = ALLOWED_TYPES[contentType];
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(uniqueName, buffer, { contentType, upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(uniqueName);

    res.status(200).json({ url: publicUrlData.publicUrl });
  } catch (err) {
    console.error("admin-upload error:", err);
    res.status(500).json({ error: "Image upload failed. Please try again." });
  }
};
