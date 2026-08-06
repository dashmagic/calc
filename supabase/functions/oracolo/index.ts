// VERIFY — oracolo: cambia miniatura + titolo di un video YouTube.
// POST { pin, profile, video_id, card: "7S", title: "Sceglierai il Sette di Picche…" }
// La miniatura viene presa da THUMBS_BASE/<profile>/<card>.jpg (bucket pubblico Supabase).

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

async function googleAccessToken(profile: string): Promise<string> {
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/verify_accounts?profile=eq.${profile}&provider=eq.google&select=refresh_token`,
    { headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` } },
  );
  const rows = await r.json();
  if (!rows[0]) throw new Error("YouTube non collegato per questo profilo (fai il collegamento nelle impostazioni)");
  const t = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: rows[0].refresh_token, grant_type: "refresh_token",
    }),
  });
  const j = await t.json();
  if (!j.access_token) throw new Error(`Refresh Google fallito: ${JSON.stringify(j)}`);
  return j.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now();
  try {
    const { pin, profile, video_id, card, title, lang } = await req.json();
    if (pin !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
    if (!video_id || !title) return json({ error: "video_id o title mancanti" }, 400);
    const prof = String(profile ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const access = await googleAccessToken(prof);
    const auth = { Authorization: `Bearer ${access}` };

    // 1) snippet attuale (per non perdere descrizione/categoria)
    const vr = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${video_id}`, { headers: auth });
    const vj = await vr.json();
    const snip = vj.items?.[0]?.snippet;
    if (!snip) throw new Error(`Video non trovato o non tuo: ${JSON.stringify(vj.error ?? vj)}`);

    // 2) titolo
    const ur = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: video_id,
        snippet: {
          title, description: snip.description ?? "", categoryId: snip.categoryId ?? "24",
          tags: snip.tags ?? [], defaultLanguage: snip.defaultLanguage,
        },
      }),
    });
    if (!ur.ok) throw new Error(`Update titolo: ${await ur.text()}`);

    // 3) miniatura (se card indicata; "NEUTRO" = solo miniatura neutra)
    if (card) {
      const file = String(card).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const lg = String(lang ?? "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 2);
      const path = lg ? `${prof}/${lg}/${file}.jpg` : `${prof}/${file}.jpg`;
      const img = await fetch(`${env("THUMBS_BASE")}/${path}`);
      if (!img.ok) throw new Error(`Miniatura non trovata nel bucket: thumbs/${path}`);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const tr = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video_id}`,
        { method: "POST", headers: { ...auth, "Content-Type": "image/jpeg" }, body: bytes },
      );
      if (!tr.ok) throw new Error(`Upload miniatura: ${await tr.text()}`);
    }

    return json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
