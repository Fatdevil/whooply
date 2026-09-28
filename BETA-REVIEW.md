# Whooply / Whooply – Granskning inför beta (20 användare)

**Datum:** 2026-09-24  
**Omfattning:** Hela serverlogiken (`server/server.js`, `server/db.js`) med fokus på pengaflöden, behörigheter och avräkning, plus stickprov i frontend (XSS).  
**Metod:** Kodgranskning. De allvarligaste fynden har bekräftats med ett riktigt HTTP-test mot servern i en tillfällig databas (markerat ✅ *verifierat*). Den befintliga testsviten (134 tester) går igenom.

---

## Utlåtande

**Rekommendation (uppdaterad):** Punkt 1–11 är åtgärdade, inklusive Space Blitz och Blind 10 med insats. Appen är redo för betan med 20 testare.

Grunden är bra för en app mellan kompisar: tokens rullas vid inloggning, PIN-koder hashas med salt (PBKDF2), avräkningen i THE TAB summerar exakt till noll med Hamilton-avrundning, SQLite körs med backup och det finns en strikt CSP. Den som skrivit koden har uppenbart tänkt på säkerhet.

Problemet är att flera spel och avräkningar i praktiken **litar blint på klienten**, och att **ingenting går att ångra**. I en app där folk faktiskt ska swisha varandra pengar räcker det att *en* kompis upptäcker att man kan skicka in `{"creatorScore": 12, "opponentScore": 2}` för att förtroendet ska vara borta. "Vi litar på varandra" skyddar mot fusk men inte mot felklick, stavfel i belopp, eller att någon testar gränser "på skoj".

---

## ✅ Status: punkt 1–6 är åtgärdade

| # | Åtgärd |
|---|---|
| 1 | Ett duellresultat räknas först när **motståndaren bekräftar samma resultat**. Undantaget är när den som rapporterar själv erkänner förlust. Om rapporterna skiljer sig åt avvisas resultatet (409) och ingen skuld skapas. |
| 2 | Insatsen i dueller är max 10 000 kr. Negativa och ogiltiga belopp avvisas. |
| 3 | Vänskap kräver **vänförfrågan och godkännande** (syns under "Mina Vänner" i profilen). Den personliga inbjudningslänken är signerad och ger direkt vänskap, eftersom den som delar länken redan har godkänt. En nota får vara max 50 000 kr. Den som lagt ut kan **ta bort notan** och deltagare kan **bestrida sin del** (knappar i kvittovyn). Redan kvitterade delar går inte att ta bort. |
| 4 | Admin-PIN kontrolleras på ett enda ställe med spärr per IP-adress (5 fel ger 15 min spärr) på **alla** vägar in. Lösenordet ska vara minst 8 tecken och sätts via `ADMIN_PIN`, som synkas in i databasen vid varje start. `/api/admin/setup` är avstängd i produktion. PIN skickas aldrig i en URL, och backup laddas ned med header. |
| 5 | Engångskoden för PIN-återställning spärras efter 5 fel per konto (och 10 per IP). En ny kod från admin nollställer spärren. |
| 6 | Om en avgjord match öppnas igen hamnar den i `locked` (resultatet kan rättas, men det går inte att betta). Det gäller även vid upprepad återöppning. En inställd match kan inte avgöras. I AnyBet går det inte att byta sida efter att man valt ja eller nej. |

Varje punkt verifieras av `test/beta-review-fixes.test.js` (12 tester). Hela sviten: 146 av 146 gröna.

## ✅ Status: Space Blitz och Blind 10 med insats (punkt 7–11)

| # | Åtgärd |
|---|---|
| 7 | **Space Blitz:** servern kontrollerar att poäng, antal träffar, våg och speltid går ihop med spelets regler (skottakt 220 ms, 28 invasörer per våg med 30/20/10 poäng, UFO tidigast efter 12 s och sedan högst var 18:e s). Ett omöjligt resultat räknas som **0 poäng** och markeras "Ogiltigt resultat". |
| 8 | **Blind 10:** tiden mäts **av servern** och klientens siffra ignoreras. Varje spelares nätverksfördröjning mäts med WebSocket-ping, som webbläsarens JavaScript inte kan fejka, och dras av (max 400 ms) så att dåligt nät inte ger nackdel. Klientklockan startar nu exakt vid "KÖR!", i takt med servern, och spelaren ser den officiella tiden. |
| 9 | Nya spelare kan bara gå med i lobbyn, inte mitt i en omgång eller ett skiljeomspel. Den som redan är med kan ansluta igen. |
| 10 | Hosten kan inte starta om en pågående omgång. Omgången avgörs automatiskt vid timeout (Blind 10: 30 s, Space Blitz: 70 s). Den som inte blev klar markeras "Ej klar" och förlorar sin insats. Om ingen blev klar blir det inga skulder, och i ett skiljeomspel delas potten. Oavgjort kan bara avgöras när rundan faktiskt är oavgjord. |
| 11 | Swish-knappen till vinnaren fungerar i båda spelen (tidigare felaktiga fältnamn och fel anrop till `createSwishUrl`). |

Varje punkt verifieras av `test/party-integrity.test.js` (13 tester).

**Kvarvarande begränsning:** Resultatet räknas fortfarande ut i spelarens egen mobil. Den som skriver ett eget skript kan därför skicka in ett resultat som följer reglerna men som hen inte spelat till sig, och i Blind 10 kan ett skript trycka exakt vid 10,000 s. Att helt stänga detta kräver att servern spelar om hela Space Blitz-matchen från spelarens knapptryckningar, vilket är en större ombyggnad. Mellan kompisar, med maxinsats 500 kr, bedömer jag nivån som rimlig.

**Att göra vid deploy:** Sätt `ADMIN_PIN` i Railway till ett lösenord på **minst 8 tecken**. En gammal 4-siffrig PIN ignoreras.

---

## 🔴 Måste fixas före beta (ursprungliga fynd)

### 1. Duellresultat bestäms helt av klienten ✅ *verifierat*
`server/server.js:3091` (`POST /api/duels/:id/result`)

Vilken som helst av de två deltagarna kan skicka in **båda** poängen och därmed välja vinnare. Det krävs ingen bekräftelse från motståndaren och tärningarna/slanten slås i webbläsaren. Servern "härleder" vinnaren från poängen, men poängen kommer från klienten.

*Test:* Alice utmanar Bob på 500 kr, Bob accepterar, Alice skickar `creatorScore:12, opponentScore:2` → Alice vinner, 500 kr i skuld för Bob.

**Åtgärd:** Slå tärning/slant **på servern** (`crypto.randomInt`) när duellen blir `active`, eller låt båda spelarna rapportera och kräv att det stämmer överens (annars "tvist"). Minst: kräv att förloraren bekräftar resultatet.

### 2. Insatsen i dueller saknar tak ✅ *verifierat*
`server/server.js:2967`: `stakeAmount: 1e9` accepteras. Kombinerat med punkt 1 kan man skapa en skuld på 1 miljard kr.
**Åtgärd:** `Math.min(MAX_STAKE, Math.round(stake))` precis som i AnyBet (10 000) och party (500).

### 3. Vem som helst kan göra sig till "vän" och sedan fakturera dig ✅ *verifierat*
- `server/db.js:2596` `addFriend`: vänskap skapas **ömsesidigt direkt** utan att den andra godkänner. Man hittar folk via bettarnamn (`POST /api/friends {nickname}`).
- Som "vän" ser man direkt personens **Swish-nummer** (`getFriends` returnerar `swishNumber`).
- `POST /api/tab/expenses` (`server.js:5196`) låter en "vän" lägga en nota **utan beloppsgräns och utan godkännande**. Det finns **ingen endpoint för att radera eller bestrida** en nota.

*Test:* Carl lägger till Alice (utan hennes medgivande) och lägger en nota på 200 000 kr → Alice står i Swishlistan med en skuld på 100 000 kr till Carl.

Det här gör även tävlingssynligheten "Endast vänner" verkningslös: vem som helst blir vän med arrangören med ett klick.

**Åtgärd:** Vänförfrågan → accept. Tak på notor. Låt deltagare **bestrida/avvisa** en nota, och låt skaparen radera den tills någon kvitterat.

### 4. Admin-PIN kan knäckas på några minuter ✅ *verifierat*
- Superadmin-PIN är **4 siffror** (10 000 kombinationer), hashat med osaltad SHA-256.
- `/api/admin/verify` har rate-limit, men `verifyEventAdmin` (`server.js:726`) och alla tävlings-endpoints tar också emot `pin` i body **utan rate-limit**. Samma gäller `/api/admin/gemini` och `/api/admin/livekit`.
- *Test:* Brute-force via `POST /api/events/:id/lock {pin}` hittade PIN:en utan en enda 429.
- Med admin-PIN kan man avgöra alla matcher, radera turneringar, nollställa andras PIN (och få engångskoden i svaret, se punkt 5) och ladda ned hela databasen (`/api/admin/backup/download`).
- `POST /api/admin/setup` (`server.js:749`): om `ADMIN_PIN` inte är satt i miljön kan **den första som anropar** sätta superadmin-PIN.

**Åtgärd:** Sätt `ADMIN_PIN` i Railway innan deploy. Byt till en lång hemlighet (minst 12 tecken) eller en admin-flagga på användarkontot. Lägg rate-limit i `verifyPin` centralt så att den gäller alla vägar in. Ta bort PIN från query-strängar (`?pin=` hamnar i loggar).

### 5. Engångskoden vid PIN-återställning kan gissas ✅ *verifierat*
`server.js:1172` (`/api/users/reset-pin`) har **ingen rate-limit**. En 6-siffrig kod med 15 minuters giltighet går att gissa sig till med ett skript, och den som lyckas tar över kontot.
**Åtgärd:** Samma rate-limit som vid inloggning (5 försök → spärr), och ogiltigförklara koden efter N fel.

### 6. Resultat kan ändras och bets läggas efter att vinnaren är känd ✅ *verifierat*
- `POST /api/events/:id/reopen` (`server.js:2074`, `db.js:1339`) fungerar även på **avgjorda** matcher. Status blir `open`, vinnaren nollas och det går att betta igen. *Test:* bet efter avgörande + återöppning → `200 OK`.
- `POST /api/events/:id/finish` kontrollerar inte status, så en inställd match kan "avgöras" och vinnaren kan bytas hur många gånger som helst.
- AnyBet ja/nej (`db.js:2991`): deltagare kan **byta sida** fram till deadline. Utan deadline går det ända tills domaren avgör, alltså även *efter* att man vet utfallet. ✅ *verifierat*

**Åtgärd:** Återöppning av en avgjord match ska sätta status `locked` (bara rätta vinnaren), inte `open`. Lås sidvalet i AnyBet när man valt, eller kräv deadline för bets med insats.

---

## 🟠 Bör fixas (logiska fel som ger fel pengar eller förvirring)

| # | Problem | Plats |
|---|---|---|
| 7 | **Space Blitz-poäng rapporteras av klienten** (tak 5000). Den som skickar `score: 5000` vinner potten. | `server.js:3511` |
| 8 | **Blind 10:** klientens tid accepteras om den ligger inom ±1,5 s från serverns. Man kan stoppa när som helst mellan 8,5 och 11,5 s och skicka `stoppedTime: 10.000`, vilket ger perfekt resultat varje gång. | `server.js:3611` |
| 9 | **Party-rum:** man kan joina när rummet står på `tie`. Den som joinar blir då automatiskt **förlorare och skuldsatt** utan att ha spelat. | `server.js:3364` |
| 10 | **Party-rum:** hosten kan anropa `/start` mitt i en runda och nollställa allt, t.ex. när hen ser att hen håller på att förlora. Om någon aldrig trycker "stopp" hänger rummet för alltid, eftersom det saknas timeout. | `server.js:3436` |
| 11 | **Party-rum använder fel fältnamn** (`user.avatarUrl`, `user.swishNumber`, `user.avatarEmoji` i stället för `avatar_url`, `swish_number`, `avatar_emoji`). Därför visas aldrig **"Swisha vinnaren"-knappen** och avatarer saknas. | `server.js:3283`, `3373` |
| 12 | **"Alla vänner" i BlixtBet betyder i själva verket "alla användare".** `storedTargets = null` gör vadet synligt och spelbart för alla, och det broadcastas globalt. ✅ *verifierat* | `server.js:4666` |
| 13 | **Skaparens eget val i BlixtBet sparas aldrig.** `placeFlashBetEntry` kastar fel för skaparen, felet sväljs tyst och UI:t tror att valet är lagt. ✅ *verifierat* | `server.js:4674`, `db.js:3399` |
| 14 | **BlixtBet och Löven Game validerar inte `tournamentId`.** Vem som helst kan koppla ett vad till en främmande turnering, så att skulderna hamnar i dess THE TAB. Detta fungerar även efter att turneringen avslutats. | `server.js:4660`, `5360` |
| 15 | **Sidobets i "self"-läge kopplar spelare till användare via exakt bettarnamn.** Om spelarnamnet är "Johan" men bettarnamnet "JohanS" hamnar samma person på **två rader** i avräkningen (`user:` och `guest:`). Om *någon annan* heter "Johan" som bettarnamn blir fel person skuldsatt. | `server.js:2578`, `2763` |
| 16 | **Radera turnering tar bort matcherna men inte dueller, notor och AnyBets kopplade till den.** De skulderna försvinner då ur både THE TAB och Swishlistan (som filtrerar bort `tournament_id`). | `db.js:2410` |
| 17 | **Inloggningsuppslaget kan kapas.** Bettarnamn kontrolleras bara mot andra bettarnamn. Registrerar någon ett bettarnamn som är lika med ditt **telefonnummer** (eller riktiga namn), hamnar din inloggning på *deras* konto. ✅ *verifierat* | `db.js:1522`, `server.js:1021` |
| 18 | **Vem som helst kan låsa ditt konto i 15 min** genom 5 felaktiga PIN-försök med ditt bettarnamn. ✅ *verifierat*. Rimligt skydd mot brute force, men lägg även en rate-limit per IP. | `server.js:1134` |
| 19 | **Inga ångra-funktioner för pengar:** notor, dueller, AnyBet och Löven kan inte raderas eller rättas efter avgörande. Ett stavfel (5000 i stället för 500) ligger kvar. | – |
| 20 | **Ingen historik (audit log)** över vem som avgjort, återöppnat eller raderat bets. Om det uppstår bråk finns inget att visa. | – |

## 🟡 Mindre / hygien

- **HTML-injektion i frontend:** bildtexter (`src/pages/tournament.js:517`), bettarnamn i admin (`src/pages/admin.js:922`) och vinnarnamn i Space Blitz (`src/components/minigames.js:6282`) renderas oescapade med `innerHTML`. CSP:n (`script-src 'self'`) stoppar JavaScript, så det går inte att stjäla tokens, men man kan fortfarande injicera falska länkar och knappar. Använd `escapeHtml` (finns i `src/utils.js:82`) konsekvent, och sätt längdgränser på namn och bildtexter på servern.
- **`/api/support/health?test=1&model=…` är öppen för alla** (`server.js:5555`). Vem som helst kan då göra Gemini-anrop på din API-nyckel.
- **Utan Cloudinary sparas bilder som base64 (upp till 10 MB) direkt i SQLite.** Då blir databasen och varje API-svar som innehåller avatarer tunga. Konfigurera Cloudinary före beta.
- **En token per användare:** om man loggar in på en ny enhet loggas den gamla ut. Informera testarna.
- **WebSocket:** eventkanaler (`?event=KOD`) kräver ingen inloggning, och `webrtc_signal` kan skickas till vilken användare som helst.
- **`GET /api/tournaments/:code`** registrerar automatiskt varje besökare som deltagare. Personen får sedan push-notiser och kan dras in i turneringsdueller och notor.
- **`uncaughtException` sväljs** (`server.js:78`), så processen fortsätter i ett okänt tillstånd. Logga och starta om hellre (Railway har `restartPolicy`).
- **`server/data.json` ligger versionerad i git** trots `.gitignore`. Den innehåller testnamn och en admin-PIN-hash som motsvarar **`1234`**. Ta bort den ur repot med `git rm --cached` och använd inte 1234 som `ADMIN_PIN`.
- **Synligheten "private" betyder "alla med länken"**. Namnet är missvisande i UI:t.

---

## Checklista före utskick

1. [ ] Sätt `ADMIN_PIN` (och helst en längre hemlighet), `WHOOPLY_INVITE_CODE`, Cloudinary och en persistent volym i Railway.
2. [ ] Punkt 1–6 ovan.
3. [ ] Punkt 7–13, eller stäng av Space Blitz och Blind 10 **med insats** i betan (sätt insats = 0).
4. [ ] Lägg till en "rapportera fel/tvist"-knapp och säg till testarna att **inga riktiga pengar** ska swishas under första veckan.
5. [ ] Ta en manuell backup före start och verifiera att återställning fungerar.

## Vad som är bra

- PIN hashas med PBKDF2 och salt, tokens roteras och löper ut efter 30 dagar.
- Konsekvent kontroll av skapare/deltagare på de flesta endpoints.
- THE TAB:s nettning (minsta antal överföringar, avrundning till hela kronor som summerar till 0) är korrekt.
- Kvitteringar valideras mot serverns egen beräkning (litar inte på klientens `toUserId`).
- Återbetalning vid inställd match och när ingen spelat på vinnaren.
- Helmet/CSP, databasbackup och healthcheck är på plats.
