# Whooply – Operativ Runbook för Beta & Drift

Denna lathund är en praktisk guide för dig som driftar och administrerar Whooply under den slutna betan (20 användare) och inför skarp matchkväll.

---

## 1. Miljövariabler & Konfiguration

Ställs in i driftmiljön (t.ex. **Railway → Settings → Variables**):

| Variabel | Standard | Beskrivning |
|---|---|---|
| `NODE_ENV` | `production` | Sätt alltid till `production` i skarp drift. |
| `PORT` | `3001` | Porten Express lyssnar på (Railway sätter detta automatiskt). |
| `WHOOPLY_INVITE_CODE` | *Ingen (öppen)* | **Viktig för betan:** Sätt en hemlig kod (t.ex. `BETAPALS2025`) så kan endast inbjudna kompisar registrera sig. |
| `ADMIN_PIN` | *Ingen* | **Obligatorisk i produktion.** Superadmin-lösenord, minst 8 tecken. Synkas in i databasen vid varje start (miljövariabeln gäller alltid). I produktion går det inte att sätta admin-lösenordet via appen. Felaktiga försök spärrar IP-adressen i 15 min efter 5 fel. |
| `RAILWAY_VOLUME_MOUNT_PATH` | `/data` | Sökväg till persistent disk. Säkerställer att SQLite-databasen överlever omstarter och deploys. |
| `DB_PATH` | `/data/whooply.db` | Alternativ explicit sökväg till databasfilen. |
| `CLOUDINARY_CLOUD_NAME` | *Valfri* | Cloudinary cloud name för mobil- och turneringsfoton. |
| `CLOUDINARY_API_KEY` | *Valfri* | Cloudinary API Key. |
| `CLOUDINARY_API_SECRET` | *Valfri* | Cloudinary API Secret. |
| `LIVEKIT_URL` | *Valfri* | WebSocket-URL till LiveKit Cloud (t.ex. `wss://xxx.livekit.cloud`). |
| `LIVEKIT_API_KEY` | *Valfri* | LiveKit Cloud API Key. |
| `LIVEKIT_API_SECRET` | *Valfri* | LiveKit Cloud API Secret. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | *Genereras automatiskt* | Nycklar för pushnotiser. Sätt dem i miljön så att de inte ändras om databasen återställs. Om nycklarna ändras slutar alla telefoners notiser att fungera tills appen öppnas igen (då registreras de om automatiskt). Värdena finns i tabellen `settings` (`vapid_public_key`, `vapid_private_key`). |
| `VAPID_SUBJECT` | `mailto:support@whooply.se` | Kontaktadress som skickas till push-tjänsterna (Apple/Google). |
| `GEMINI_API_KEY` | *Valfri* | Google Gemini API-nyckel för skarp AI-support (Gemini 2.0 Flash) i Malta AI-chatten. Hämtas från Google AI Studio. Om den saknas används offline fallback-motorn. Kan även ställas in via Admin API (/api/admin/gemini). |

---

## 2. Deploy på Railway

Whooply använder Railway med **Nixpacks**:

1. **Konfigurationsfil**: [railway.json](file:///Users/sarahsackerud/Documents/antigravity/charming-mendel/whooply/railway.json)
   - Build-kommando: `npm install --include=dev && npm run build`
   - Start-kommando: `npm start`
   - Hälsokontroll: `GET /api/health` (svarar `{"status":"ok", "database":true}`)
2. **Persistent Disk (Volym)**:
   - Skapa en volym i Railway: Klicka på tjänsten → **Volumes** → **Add Volume**.
   - Sätt Mount Path till `/data`.
   - Databasen sparas automatiskt i `/data/whooply.db` och automatiserade säkerhetskopior i `/data/backups/`.

---

## 3. Säkerhetskopiering (Backup & Restore)

SQLite körs i **WAL-läge (Write-Ahead Logging)** och använder native icke-blockerande säkerhetskopiering (`better-sqlite3` backup API).

### A. Automatisk backup
Servern skapar automatiskt en ny säkerhetskopia en gång per dygn och sparar den i `backups/whooply-backup-YYYY-MM-DD-HHmmss.db`. De senaste 7 dagarnas kopior sparas automatiskt, äldre raderas.

### B. Manuell backup och nedladdning
1. Logga in i Admin-panelen (`/admin`) med Superadmin-PIN.
2. Scrolla ned till sektionen **"💾 Databas & Säkerhetskopiering"**.
3. Klicka på **"💾 Säkerhetskopiera nu"** för att skapa en omedelbar snapshot.
4. Klicka på **"⬇️ Ladda ned senaste backup (.db)"** för att spara en fullständig `.db`-kopia lokalt på din egen dator.

### C. Återställning från backup
Om databasen någonsin skulle behöva återställas till en tidigare tidpunkt:
1. Stoppa tjänsten i Railway (eller pausa deploy).
2. Ersätt `/data/whooply.db` med den nedladdade backupfilen via Railway CLI eller SSH:
   ```bash
   # Ta bort eventuella kvarvarande WAL-filer:
   rm -f /data/whooply.db-wal /data/whooply.db-shm
   # Kopiera in din backup:
   cp /data/backups/whooply-backup-XXXX.db /data/whooply.db
   ```
3. Starta servern igen.

---

## 4. Övervakning & Felloggning

Whooply har inbyggd krasch- och felövervakning:
- **Serverhälsa**: `GET /api/health` returnerar serverns drifttid och bekräftar att databasen svarar.
- **Kraschskydd**: Globala process-guards (`unhandledRejection` och `uncaughtException`) fångar upp oväntade fel så att servern inte kraschar.
- **Klientfelrapportering**: Om en användares mobilwebbläsare stöter på ett JavaScript-fel skickas det automatiskt till servern och loggas med prefixet `[CLIENT-ERROR]` i Railways loggar.

Sök i Railway-loggarna efter:
- `[push] Delivery failed` – En notis kunde inte levereras. `403` betyder oftast att VAPID-nycklarna har ändrats; `410/404` rensas bort automatiskt.
- `[CLIENT-ERROR]` – Fel som uppstått i mobilen hos någon användare.
- `💥 [EXPRESS-ERROR]` – Oväntade serverfel på API-anrop.
- `[cleanup]` – Information om automatiskt städade rum.
- `[backup]` – Bekräftelse på genomförd databasbackup.

---

## 5. Användaradministration & Support under betan

### Kompis som glömt sin PIN-kod
1. Gå till `/admin` och lås upp med Admin-PIN.
2. Under användarlistan, leta upp kompisen och klicka på **"Nollställ PIN"**.
3. En 6-siffrig engångskod visas i en popup.
4. Skicka engångskoden till kompisen (t.ex. via SMS/WhatsApp).
5. Kompisen öppnar inloggningssidan, klickar på *"Glömt PIN? Klicka här för att återställa"*, anger sitt telefonnummer, engångskoden och väljer en ny 4-siffrig PIN.

### Nollställa testdata inför skarp kväll
Om ni har testbettat och vill nollställa alla saldon och spel inför en riktig match:
1. Ta en backup först via adminpanelen!
2. Kör via SQLite (eller admin-script):
   ```sql
   DELETE FROM bets;
   DELETE FROM events;
   DELETE FROM tournament_matches;
   DELETE FROM tournaments;
   DELETE FROM minigame_duels;
   DELETE FROM tab_expenses;
   DELETE FROM anybets;
   -- Användare, profiler och inloggnings-PIN behålls!
   ```

---

## 6. Checklista för Testkvällen (Kompisbetan)

Följ denna checklista när de 20 kompisarna kör första gången:

- [ ] **Miljövariabel satt**: `WHOOPLY_INVITE_CODE` är konfigurerad.
- [ ] **Persistent disk aktiv**: Railway-volym monterad på `/data`.
- [ ] **Inbjudan**: Dela app-länken och inbjudningskoden till kompisgruppen.
- [ ] **Registrering**: Låt alla registrera sig med namn, smeknamn, Swish-nummer och 4-siffrig PIN.
- [ ] **Test 1 – Vanligt spel**: Skapa ett match-event (t.ex. "Sverige vs Finland") och låt vännerna lägga bets.
- [ ] **Test 2 – Turnering**: Skapa en turnering och bjud in vännerna.
- [ ] **Test 3 – Dela utlägg (The Tab)**: Skapa ett utlägg (t.ex. pizza/öl) och dela upp mellan deltagarna.
- [ ] **Test 4 – Minispel i realtid**: Starta ett spel i "The Blind 10.00" eller "Mafia" och be 3–4 personer ansluta via fyrsiffrig rumskod.
- [ ] **Test 5 – Avräkning & Swish**: Avsluta ett spel, verifiera att Swish-knappen genererar rätt belopp och öppnar Swish-appen med förifyllt nummer.
- [ ] **Avslut**: Skapa en manuell backup via `/admin` efter kvällens slut.
