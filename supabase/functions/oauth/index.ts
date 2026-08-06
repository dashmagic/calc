// VERIFY — oauth: collega YouTube (Google) e Spotify, salva i refresh token.
// Deploy con --no-verify-jwt (i redirect dei provider non hanno header auth). Protezione: ADMIN_PIN.

const env = (k: string) => Deno.env.get(k) ?? "";
const SELF = `${env("SUPABASE_URL")}/functions/v1/oauth`;

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <body style="font-family:-apple-system,sans-serif;background:#131016;color:#efe9dc;display:grid;place-items:center;min-height:90vh;text-align:center">
     <div>${body}</div></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

async function saveToken(profile: string, provider: string, refresh_token: string) {
  const r = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_accounts`, {
    method: "POST",
    headers: {
      apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ profile, provider, refresh_token, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`DB: ${r.status} ${await r.text()}`);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ---- START: /oauth?action=start&provider=google|spotify&profile=nik&pin=1234
  if (action === "start") {
    const provider = url.searchParams.get("provider") ?? "";
    const profile = (url.searchParams.get("profile") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const pin = url.searchParams.get("pin") ?? "";
    if (pin !== env("ADMIN_PIN")) return html("⛔ PIN errato", 403);
    if (!profile) return html("⛔ Profilo mancante", 400);
    const state = btoa(JSON.stringify({ provider, profile, pin }));

    if (provider === "google") {
      const p = new URLSearchParams({
        client_id: env("GOOGLE_CLIENT_ID"),
        redirect_uri: SELF,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.force-ssl",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 302);
    }
    if (provider === "spotify") {
      const p = new URLSearchParams({
        client_id: env("SPOTIFY_CLIENT_ID"),
        redirect_uri: SELF,
        response_type: "code",
        scope: "playlist-modify-public playlist-modify-private",
        state,
      });
      return Response.redirect(`https://accounts.spotify.com/authorize?${p}`, 302);
    }
    return html("⛔ Provider sconosciuto", 400);
  }

  // ---- CALLBACK: ?code=...&state=...
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) return html("Endpoint OAuth VERIFY. Usa l'app per collegare gli account.");

  let st: { provider: string; profile: string; pin: string };
  try { st = JSON.parse(atob(stateRaw)); } catch { return html("⛔ State non valido", 400); }
  if (st.pin !== env("ADMIN_PIN")) return html("⛔ PIN errato", 403);

  try {
    if (st.provider === "google") {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"),
          redirect_uri: SELF, grant_type: "authorization_code",
        }),
      });
      const j = await r.json();
      if (!j.refresh_token) throw new Error(`Google non ha dato il refresh token: ${JSON.stringify(j)}`);
      await saveToken(st.profile, "google", j.refresh_token);
      return html(`✅ <b>YouTube collegato</b> al profilo «${st.profile}».<br><br>Puoi chiudere questa pagina.`);
    }
    if (st.provider === "spotify") {
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + btoa(`${env("SPOTIFY_CLIENT_ID")}:${env("SPOTIFY_CLIENT_SECRET")}`),
        },
        body: new URLSearchParams({ code, redirect_uri: SELF, grant_type: "authorization_code" }),
      });
      const j = await r.json();
      if (!j.refresh_token) throw new Error(`Spotify non ha dato il refresh token: ${JSON.stringify(j)}`);
      await saveToken(st.profile, "spotify", j.refresh_token);
      return html(`✅ <b>Spotify collegato</b> al profilo «${st.profile}».<br><br>Puoi chiudere questa pagina.`);
    }
    return html("⛔ Provider sconosciuto", 400);
  } catch (e) {
    return html(`⛔ Errore: ${String(e)}`, 500);
  }
});
