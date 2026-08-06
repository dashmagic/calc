# VERIFY — setup completo

App di mentalismo personale. Progetto indipendente: **tutti gli account sono del mago**, tutti gratuiti.

## Architettura

```
GitHub Pages (PWA "Calcolatrice")  →  Supabase Edge Functions  →  YouTube / Spotify API
                                          ↑ refresh token in DB
```

- `index.html` — la PWA: calcolatrice vera che nasconde la console (tieni premuto **C** 1 secondo)
- `supabase/functions/oauth` — collega YouTube e Spotify (OAuth, salva i refresh token)
- `supabase/functions/oracolo` — cambia miniatura + titolo del video YouTube
- `supabase/functions/prophet` — sostituisce il brano nella playlist Spotify
- `tools/thumbnails.html` — genera le 52 miniature (e le icone della PWA)

## ⚡ DA FARE OGGI (prima di tutto il resto)

Il mago registra e carica sul **suo canale YouTube** un video di 30–60 secondi:
> "Questa è la mia predizione. È sigillata nella copertina di questo video e non la cambierò mai."

Visibilità **Pubblico**. La data di pubblicazione deve invecchiare: ogni giorno che passa lavora per l'effetto. Segnarsi l'**ID del video** (la parte dopo `watch?v=`).

## Checklist account (tutti gratis, ~30 min in due)

### 1. Supabase
1. Account su supabase.com → New project (nome neutro, es. `calc-tools`)
2. SQL Editor → incolla ed esegui `supabase/schema.sql`
3. Storage → New bucket → nome `thumbs`, **Public**
4. Segnarsi: `Project URL` (https://XXXX.supabase.co)

### 2. Google Cloud (per YouTube)
1. console.cloud.google.com con l'account Google del mago → New project
2. "API e servizi" → Libreria → abilita **YouTube Data API v3**
3. Schermata consenso OAuth → External → modalità **Testing** → aggiungi l'email del mago (e del secondo mago) come **test user**
4. Credenziali → Crea credenziali → **ID client OAuth** → Applicazione web
   - Redirect URI: `https://XXXX.supabase.co/functions/v1/oauth`
5. Segnarsi Client ID e Client Secret

### 3. Spotify Developer
1. developer.spotify.com/dashboard con l'account Spotify del mago → Create app
2. Redirect URI: `https://XXXX.supabase.co/functions/v1/oauth`
3. Segnarsi Client ID e Client Secret
4. (basta l'account Spotify **free**)

### 4. Deploy delle functions (dal Mac, in questa cartella)
```bash
brew install supabase/tap/supabase   # se manca
supabase login
supabase link --project-ref XXXX     # ref del progetto
supabase secrets set \
  ADMIN_PIN=<PIN a 4-6 cifre scelto da voi> \
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... \
  THUMBS_BASE=https://XXXX.supabase.co/storage/v1/object/public/thumbs
supabase functions deploy oauth oracolo prophet --no-verify-jwt
```
(`--no-verify-jwt` è necessario: i redirect di Google/Spotify non portano header di autorizzazione; la protezione è il PIN.)

### 5. Miniature
1. Apri `tools/thumbnails.html` nel browser
2. (Opzionale ma consigliato) carica una foto del mago che tiene una carta coperta
3. "Genera 52 miniature" → scarica lo zip → estrai
4. Supabase Storage → bucket `thumbs` → crea cartella col nome profilo (es. `nik`) → trascina dentro i 52 file
5. Sempre da lì scarica anche `icon-192.png` / `icon-512.png` e mettili nella cartella del progetto

### 6. PWA online
1. Repo GitHub **nuovo e con nome neutro** (es. `calc`) → push di questa cartella
2. Settings → Pages → deploy da branch main
3. Sul telefono del mago: apri l'URL → "Aggiungi a schermata Home"

### 7. Prima configurazione nell'app
Console (long-press su **C**) → ⚙︎ Impostazioni:
- URL backend: `https://XXXX.supabase.co`
- PIN, nome profilo (uguale alla cartella in `thumbs`), ID video YouTube
- "Collega YouTube" e "Collega Spotify" (si apre il consenso, un tap)
- "Crea playlist Prediction" → l'ID si salva da solo
- Prova con "ESEGUI" e verifica dal canale YouTube pubblico

## Due maghi
Stesso backend per entrambi: ogni mago usa un **nome profilo diverso**, collega il **suo** YouTube/Spotify, ha la **sua** cartella miniature e il **suo** video. Quota YouTube condivisa: ~90-100 esecuzioni/giorno in totale (larghissima).

## Note sceniche
- Non ripetere mai l'effetto allo stesso pubblico.
- Dopo lo show, riportare il video a miniatura/titolo neutri ("La mia predizione…") — c'è il bottone "Ripristina neutro" in console.
- L'URL della PWA e il nome del repo non devono tradire nulla: icona e titolo sono "Calcolatrice".
