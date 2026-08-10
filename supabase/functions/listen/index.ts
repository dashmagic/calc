// VERIFY — listen: trascrive l'audio (Whisper) e interpreta la carta con un LLM (Groq).
// Capisce IT/EN/SQ, parlato veloce, forme storpiate. Contesto: si parla SOLO di carte.
// POST (audio)  ?pin=..&lang=it|en|sq
//   → { ok, text, card:"AH"|null, rank, suit }

const env = (k: string) => Deno.env.get(k) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_L = ["S", "H", "D", "C"];

// fallback a dizionario (se l'LLM non risponde)
const RANK_WORDS: Record<string, string[][]> = {
  it: [["asso","assi","aso"],["due"],["tre"],["quattro"],["cinque"],["sei"],["sette"],["otto"],["nove"],["dieci"],["fante","jack","j"],["donna","regina","dama"],["re"]],
  en: [["ace"],["two"],["three"],["four"],["five"],["six"],["seven"],["eight"],["nine"],["ten"],["jack"],["queen"],["king"]],
  sq: [["as","asi","asit","njishi","njeshi","njesh","një","nje","njeri"],["dy","dyshi","dysh","dyta"],["tre","treshi","tresh","treta"],["kater","katër","katërsh","katra","katr"],["pese","pesë","pesa","pes"],["gjashte","gjashtë","gjashta","gjasht"],["shtate","shtatë","shtata","shtat","shtatä","shtatë"],["tete","tetë","teta","tet","thete","thetë","theta","thetër","theter"],["nente","nëntë","nenta","nanta","nent"],["dhjete","dhjetë","dhjeta","dhjet","dieta","dietë","djeter","djetër","djet","xhet"],["fant","fanti","fante"],["dama","cupa","çupa","damë","cupe","çupë","shupa","shup","mbreteresha","mbretëresha","mbretreshe"],["mbret","mbreti","mbretit","derr","derri","deri","der"]],
};
const SUIT_WORDS: Record<string, string[][]> = {
  it: [["picche","picca","spade","spada"],["cuori","cuore","core"],["quadri","quadro","denari"],["fiori","fiore","bastoni"]],
  en: [["spades","spade"],["hearts","heart"],["diamonds","diamond"],["clubs","club"]],
  sq: [["maca","maça","maç","mac","matcha","matsha","macha","mata","maza"],["kupa","kupë","kupe","kup","zemer","zemër","zemra","zemre"],["karo","karro","kuadro"],["spathi","spath","spati","spade"]],
};
// normalizza: minuscolo + toglie gli accenti (ë→e, ç→c, ă/ä→a, ț→t…) così le varianti combaciano
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function dictParse(text: string, lang: string) {
  const t = " " + norm(text).replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ") + " ";
  const rw = RANK_WORDS[lang] ?? RANK_WORDS.en;
  const sw = SUIT_WORDS[lang] ?? SUIT_WORDS.en;
  let ri = -1, si = -1;
  // match a PAROLA INTERA (token tra spazi), accenti normalizzati → alta precisione
  rw.forEach((ws, i) => ws.forEach((w) => { if (t.includes(" " + norm(w) + " ")) ri = i; }));
  sw.forEach((ws, i) => ws.forEach((w) => { if (t.includes(" " + norm(w) + " ")) si = i; }));
  // Whisper scrive spesso le CIFRE ("7", "10") invece della parola
  const DIGITS: Record<string, number> = { "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8, "10": 9 };
  for (const d in DIGITS) if (t.includes(" " + d + " ")) ri = DIGITS[d];
  return ri >= 0 && si >= 0 ? RANKS[ri] + SUIT_L[si] : null;
}

// c'è almeno UNA parola-carta (valore o seme)? Se no, è pura conversazione → non chiamo l'LLM (risparmio Groq).
function hasSignal(text: string, lang: string) {
  const t = " " + text.toLowerCase().replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ") + " ";
  const rw = RANK_WORDS[lang] ?? RANK_WORDS.en;
  const sw = SUIT_WORDS[lang] ?? SUIT_WORDS.en;
  for (const ws of rw) for (const w of ws) if (t.includes(" " + w + " ")) return true;
  for (const ws of sw) for (const w of ws) if (t.includes(" " + w + " ")) return true;
  return false;
}

function codeToIdx(code: string) {
  const m = String(code).toUpperCase().match(/^(10|[2-9]|[AJQK])([SHDC])$/);
  if (!m) return { card: null, rank: -1, suit: -1 };
  return { card: m[1] + m[2], rank: RANKS.indexOf(m[1]), suit: SUIT_L.indexOf(m[2]) };
}

async function llmCard(text: string, lang: string): Promise<string | null> {
  const sys =
    "Sei un interprete di carte da gioco (italiano, inglese, albanese), robusto a trascrizioni " +
    "imperfette dello speech-to-text. Fai SEMPRE matching FONETICO: scegli il valore e il seme più " +
    "vicini per suono, anche se la parola è scritta male.\n" +
    "SEMI → S = picche/spade/spada/spades (storpiati: pitte, pitt, picca, spads) / maça/maca; " +
    "H = cuori/cuore/core/hearts / kupa/kupë/zemër/zemer (me zemër); " +
    "D = quadri/quadro/denari/diamonds (storpiato: quadre) / karo; " +
    "C = fiori/fiore/bastoni/clubs (storpiato: fiore) / spathi/spath.\n" +
    "VALORI → A = asso/ace/as/njishi/njeshi; 2 = due/two/dy/dyshi; 3 = tre/three/treshi; " +
    "4 = quattro/four/katër/katra/katr; 5 = cinque/five/pesë/pesa/pes; 6 = sei/six/gjashtë/gjashta/gjasht; " +
    "7 = sette/seven/shtatë/shtata/shtat; 8 = otto/eight/tetë/teta/tet; 9 = nove/nine/nëntë/nenta/nent; " +
    "10 = dieci/ten/dhjetë/dhjeta/dhjet; J = fante/jack/fant; Q = donna/regina/dama/queen/cupa/çupë/mbretëresha; " +
    "K = re/king/mbret/derr/derri. (Albanese: le figure colloquiali finiscono in -a o senza vocale finale. " +
    "Whisper può storpiare: 'thetër/theta'=tetë=8; 'dieta/djetër/xhet'=dhjetë=10; 'statë/stët'=shtatë=7; " +
    "'matcha/matsha'=maça=picche; 'zemër'=kupa=cuori.)\n" +
    "La carta può essere detta in QUALSIASI ordine (valore-seme o seme-valore), anche in mezzo a una " +
    "frase. Se il testo nomina CHIARAMENTE un valore E un seme, dai il codice (anche se storpiati). " +
    "MA se è solo conversazione e NON nomina una carta, o manca il valore o il seme, rispondi NONE: " +
    "non inventare MAI una carta dal nulla, non forzare. Esempi che danno NONE: 'po flasim pak', " +
    "'allora vediamo un attimo', 'buonasera a tutti', 'si tani', 'come va', 'facciamo un gioco'.\n" +
    "Rispondi SOLO con il codice a 2-3 caratteri (es: AH, 10S, KD, 7C, QC). Nient'altro.";
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("GROQ_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      max_tokens: 6,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Lingua: ${lang}. Frase: "${text}"` },
      ],
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const out = (j.choices?.[0]?.message?.content ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (out === "NONE" || !out) return null;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    if (url.searchParams.get("pin") !== env("ADMIN_PIN")) return json({ error: "PIN errato" }, 403);

    const inBytes = new Uint8Array(await req.arrayBuffer());
    if (!inBytes.length) return json({ error: "nessun audio" }, 400);

    // rileva il formato dai "magic bytes" (WAV / WebM / MP4-M4A / OGG / MP3)
    const b = inBytes;
    const asc = (o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));
    let ext = "webm", mime = "audio/webm";
    if (asc(0, 4) === "RIFF" && asc(8, 4) === "WAVE") { ext = "wav"; mime = "audio/wav"; }
    else if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) { ext = "webm"; mime = "audio/webm"; }
    else if (asc(4, 4) === "ftyp") { ext = "mp4"; mime = "audio/mp4"; }
    else if (asc(0, 4) === "OggS") { ext = "ogg"; mime = "audio/ogg"; }
    else if (asc(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) { ext = "mp3"; mime = "audio/mpeg"; }

    // Prompt di contesto (carte da gioco). WPROMPT[lang] per la lingua forzata, MULTI per l'auto-detect.
    const WPROMPT: Record<string, string> = {
      it: "Una carta da gioco italiana: asso, due, tre, quattro, cinque, sei, sette, otto, nove, dieci, fante, donna, re; di picche, cuori, quadri, fiori.",
      en: "A single playing card: ace, two, three, four, five, six, seven, eight, nine, ten, jack, queen, king; of spades, hearts, diamonds, clubs.",
      sq: "Një letër bixhozi: as, dy, tre, katër, pesë, gjashtë, shtatë, tetë, nëntë, dhjetë, fant, dama, mbret; maça, kupa, karo, spathi/spathi.",
    };
    const MULTI =
      "Una carta da gioco / a playing card / letër bixhozi. Valori: asso ace as, due two dy, tre three, " +
      "quattro four katër, cinque five pesë, sei six gjashtë, sette seven shtatë, otto eight tetë, nove nine nëntë, " +
      "dieci ten dhjetë, fante jack fant, donna queen dama, re king mbret. Semi: picche spades maça, " +
      "cuori hearts kupa zemër, quadri diamonds karo, fiori clubs spathi.";

    const whisper = async (language?: string): Promise<string> => {
      const fd = new FormData();
      fd.append("file", new Blob([inBytes], { type: mime }), `a.${ext}`);
      fd.append("model", "whisper-large-v3");            // il più preciso e multilingue
      if (language) fd.append("language", language);     // assente = RILEVAMENTO AUTOMATICO
      fd.append("temperature", "0");
      fd.append("prompt", (language && WPROMPT[language]) ? WPROMPT[language] : MULTI);
      const wr = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${env("GROQ_API_KEY")}` }, body: fd,
      });
      const wj = await wr.json();
      if (!wr.ok) throw new Error(`Whisper: ${JSON.stringify(wj)}`);
      return (wj.text ?? "").trim();
    };
    const interpret = async (text: string): Promise<string | null> => {
      let code = dictParse(text, "it") ?? dictParse(text, "en") ?? dictParse(text, "sq");
      if (!code) {
        // frase corta = probabile carta → interpreta sempre; frase lunga = conversazione → LLM solo se c'è un indizio
        const short = text.split(/\s+/).length <= 4;
        const signal = short || hasSignal(text, "it") || hasSignal(text, "en") || hasSignal(text, "sq");
        if (signal) { try { code = await llmCard(text, "auto"); } catch { /* ignore */ } }
      }
      return code;
    };

    // Lingua: "it"/"en"/"sq" = FORZATA (massima precisione, se il mago la imposta) · vuoto/"auto" = AUTOMATICA
    const pick = (url.searchParams.get("lang") ?? "").toLowerCase().slice(0, 2);
    const forced = (pick === "it" || pick === "en" || pick === "sq") ? pick : null;
    let text = "", code: string | null = null;
    if (forced) {
      text = await whisper(forced);
      code = await interpret(text);
    } else {
      // a) auto-detect  b) se non trova la carta ed è una frase corta, riprova in albanese (la più difficile)
      text = await whisper();
      code = await interpret(text);
      if (!code && text && text.split(/\s+/).length <= 4) {
        try { const t2 = await whisper("sq"); const c2 = await interpret(t2); if (c2) { code = c2; text = t2; } } catch { /* ignore */ }
      }
    }
    if (!text) return json({ ok: true, text: "", card: null, rank: -1, suit: -1 });

    const idx = code ? codeToIdx(code) : { card: null, rank: -1, suit: -1 };
    return json({ ok: true, text, ...idx });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
