// VERIFY — mosaic: la carta nominata emerge dal rullino foto (album iOS + Comandi Rapidi).
//
// POST json  { pin, profile, action:"arm", card:"10H", cols?:10 }  → memorizza la carta in attesa
// POST image /mosaic?action=learn&pin=..&profile=..&taken=..       → indicizza una foto reale (body = jpeg ridotto)
// GET        /mosaic?pin=..&profile=..                              → lista ordinata per il Comando Rapido:
//              { ok, mode:"own",  dates:[...] }  se ci sono foto indicizzate (foto REALI di Dash)
//              { ok, mode:"lib",  urls:[...]  }  fallback: tessere generate (per testare subito)

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });
const H = () => ({
  apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
  Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
  "Content-Type": "application/json",
});

const g = globalThis as { _rasters?: Record<string, Record<string, number[][]>>; _lib?: { f: string; c: number[] }[] };
async function rasters() {
  if (!g._rasters) g._rasters = await (await fetch(`${env("THUMBS_BASE")}/mosaic/rasters.json`)).json();
  return g._rasters!;
}
async function lib() {
  if (!g._lib) g._lib = await (await fetch(`${env("THUMBS_BASE")}/mosaic/index.json`)).json();
  return g._lib!;
}
function dist(a: number[], b: number[]) {
  const la = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const lb = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
  return 2 * (la - lb) ** 2 + (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const q = url.searchParams;

    // ---------- learn: indicizza una foto reale ----------
    if (q.get("action") === "learn") {
      if (q.get("pin") !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
      const prof = (q.get("profile") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const taken = q.get("taken") ?? "";
      if (!prof || !taken) return json({ error: "profile/taken mancanti" }, 400);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length) return json({ error: "nessuna immagine" }, 400);
      const img = await Image.decode(bytes);
      const small = img.resize(4, 4);
      let r = 0, gg = 0, b = 0;
      for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) {
        const [pr, pg, pb] = Image.colorToRGBA(small.getPixelAt(x, y));
        r += pr; gg += pg; b += pb;
      }
      const c = [Math.round(r / 16), Math.round(gg / 16), Math.round(b / 16)];
      const res = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_photos`, {
        method: "POST",
        headers: { ...H(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ profile: prof, taken, c }),
      });
      if (!res.ok) throw new Error(await res.text());
      return json({ ok: true, c });
    }

    // ---------- arm: memorizza la carta ----------
    if (req.method === "POST") {
      const body = await req.json();
      if (body.pin !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
      const prof = String(body.profile ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      const r0 = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config?profile=eq.${prof}&select=data`, { headers: H() });
      const rows = await r0.json();
      const data = rows[0]?.data ?? {};
      data.mosaic_card = String(body.card ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (body.cols) data.mosaic_cols = Number(body.cols);
      if (body.total != null && body.total !== "") data.mosaic_total = Number(body.total);
      const r1 = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config`, {
        method: "POST",
        headers: { ...H(), Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ profile: prof, data, updated_at: new Date().toISOString() }),
      });
      if (!r1.ok) throw new Error(await r1.text());
      return json({ ok: true, armed: data.mosaic_card });
    }

    // ---------- GET: lista per il Comando Rapido ----------
    if (q.get("pin") !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);
    const prof = (q.get("profile") ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const r0 = await fetch(`${env("SUPABASE_URL")}/rest/v1/verify_config?profile=eq.${prof}&select=data`, { headers: H() });
    const rows = await r0.json();
    const data = rows[0]?.data ?? {};
    const card = q.get("card") ?? data.mosaic_card;
    const cols = String(q.get("cols") ?? data.mosaic_cols ?? 10);
    if (!card) return json({ error: "nessuna carta armata" }, 400);
    const R = await rasters();
    let cells: number[][] | undefined = R[cols]?.[card];
    if (!cells) return json({ error: `raster mancante per ${card} a ${cols} colonne` }, 400);

    // allineamento a "Recenti": se il rullino ha già N foto, aggiungi tessere di
    // riempimento (colore sfondo) finché il blocco parte a inizio riga
    const total = Number(q.get("total") ?? data.mosaic_total ?? -1);
    let pad = 0;
    if (total >= 0) {
      pad = (Number(cols) - (total % Number(cols))) % Number(cols);
      if (pad > 0) cells = Array.from({ length: pad }, () => [23, 24, 28]).concat(cells);
    }

    // foto reali indicizzate?
    const rp = await fetch(
      `${env("SUPABASE_URL")}/rest/v1/verify_photos?profile=eq.${prof}&select=taken,c&limit=20000`, { headers: H() });
    const photos: { taken: string; c: number[]; used?: boolean }[] = await rp.json();

    if (photos.length >= cells.length) {
      const dates: string[] = [];
      for (const cell of cells) {
        let best = -1, bd = Infinity;
        for (let i = 0; i < photos.length; i++) {
          if (photos[i].used) continue;
          const d = dist(cell, photos[i].c);
          if (d < bd) { bd = d; best = i; }
        }
        photos[best].used = true;
        dates.push(photos[best].taken);
      }
      return json({ ok: true, mode: "own", card, cols: Number(cols), pad, count: dates.length, dates });
    }

    // fallback: tessere della libreria generata
    const L = await lib();
    const used = new Map<number, number>();
    const urls: string[] = [];
    for (const cell of cells) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < L.length; i++) {
        const d = dist(cell, L[i].c) * (1 + 0.35 * (used.get(i) ?? 0));
        if (d < bd) { bd = d; best = i; }
      }
      used.set(best, (used.get(best) ?? 0) + 1);
      urls.push(`${env("THUMBS_BASE")}/mosaic/lib/${L[best].f}`);
    }
    return json({ ok: true, mode: "lib", card, cols: Number(cols), pad, count: urls.length, urls, indexed_photos: photos.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
