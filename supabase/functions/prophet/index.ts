// VERIFY — prophet: sostituisce il contenuto della playlist Spotify con il brano nominato.
// POST { pin, profile, playlist_id, query }            → cerca il brano e lo mette (unico) in playlist
// POST { pin, profile, action:"create_playlist" }      → crea la playlist "Prediction" e ritorna l'id

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

async function spotifyAccessToken(profile: string): Promise<string> {
  const r = await fetch(
    `${env("SUPABASE_URL")}/rest/v1/verify_accounts?profile=eq.${profile}&provider=eq.spotify&select=refresh_token`,
    { headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}` } },
  );
  const rows = await r.json();
  if (!rows[0]) throw new Error("Spotify non collegato per questo profilo");
  const t = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${env("SPOTIFY_CLIENT_ID")}:${env("SPOTIFY_CLIENT_SECRET")}`),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rows[0].refresh_token }),
  });
  const j = await t.json();
  if (!j.access_token) throw new Error(`Refresh Spotify fallito: ${JSON.stringify(j)}`);
  return j.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const t0 = Date.now();
  try {
    const { pin, profile, playlist_id, query, action } = await req.json();
    if (pin !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
    const prof = String(profile ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const access = await spotifyAccessToken(prof);
    const auth = { Authorization: `Bearer ${access}`, "Content-Type": "application/json" };

    if (action === "create_playlist") {
      const r = await fetch("https://api.spotify.com/v1/me/playlists", {
        method: "POST", headers: auth,
        body: JSON.stringify({ name: "Prediction", public: true, description: "Sigillata. Non la cambierò mai." }),
      });
      const j = await r.json();
      if (!j.id) throw new Error(`Creazione playlist: ${JSON.stringify(j)}`);
      return json({ ok: true, playlist_id: j.id, url: j.external_urls?.spotify });
    }

    if (!playlist_id || !query) return json({ error: "playlist_id o query mancanti" }, 400);

    const sr = await fetch(
      `https://api.spotify.com/v1/search?type=track&limit=1&q=${encodeURIComponent(query)}`, { headers: auth });
    const sj = await sr.json();
    const track = sj.tracks?.items?.[0];
    if (!track) throw new Error(`Nessun brano trovato per «${query}»`);

    const pr = await fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/tracks`, {
      method: "PUT", headers: auth, body: JSON.stringify({ uris: [track.uri] }),
    });
    if (!pr.ok) throw new Error(`Update playlist: ${await pr.text()}`);

    return json({
      ok: true, ms: Date.now() - t0,
      track: `${track.name} — ${track.artists?.map((a: { name: string }) => a.name).join(", ")}`,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
