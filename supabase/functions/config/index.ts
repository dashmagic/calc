// VERIFY — config: backup cloud delle impostazioni dell'app (video_id, playlist_id, lingua).
// POST { pin, profile, action:"get" }            → { ok, data }
// POST { pin, profile, action:"set", data:{...} } → { ok }

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { pin, profile, action, data } = await req.json();
    if (pin !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
    const prof = String(profile ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!prof) return json({ error: "profilo mancante" }, 400);
    const H = {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
    };

    if (action === "set") {
      const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config`, {
        method: "POST",
        headers: { ...H, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ profile: prof, data: data ?? {}, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(await r.text());
      return json({ ok: true });
    }

    const r = await fetch(
      `${env("SUPABASE_URL")}/rest/v1/verify_config?profile=eq.${prof}&select=data`, { headers: H });
    const rows = await r.json();
    return json({ ok: true, data: rows[0]?.data ?? null });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
