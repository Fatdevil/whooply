// ── Malta AI Support Engine (VIP Concierge & Betting Specialist) ──
// Provides intelligent AI responses for Whooply via Gemini API with a rich offline fallback.
import * as db from './db.js';

// What Malta Support knows about the app. Kept in one place and in the words the app
// uses on its buttons, so the AI and the offline answers never drift apart.
const APP_FACTS = `
Så fungerar Whooply (använd exakt dessa knappnamn):

1. EVENT: Ett event samlar gänget, t.ex. "Golfhelg Malta". Skapa via Admin → "SKAPA EVENT". Bjud in via "📱 Dela event" (länk/QR) eller "Bjud in vänner" (push).
2. SPEL I EVENTET: På eventsidan → "➕ Lägg till spel". Speltyper:
   - 🏆 Vem vinner? – betta på en spelare, odds från potten.
   - 👥 Vinnare tar allt – alla lägger lika, vinnaren tar potten.
   - ⚽ Match 1 X 2 – hemma, oavgjort eller borta.
   - 👍 Ja eller nej – en snabb fråga.
   - 🎯 Välj flera – alla väljer lika många (t.ex. "Vilka 4 kommer sist?"). Flest rätt tar potten, den delas vid lika, har ingen rätt går insatserna tillbaka. Andras tips syns först efter spelstopp.
   - 📋 Tipsrad – flera matcher (2–13), alla tippar 1, X eller 2 i varje (X kan tas bort per match, t.ex. tennis). Spelledaren rättar match för match (✕ = struken, räknas inte); första rättningen stänger tippningen och alla ser ställningen live. När alla är rättade: Avgör tipsraden. Flest rätt tar potten, delas vid lika, har ingen rätt går insatserna tillbaka.
3. AVGÖRA: Öppna spelet → "👑 Spelledare" → "🏆 Avgör matchen" → "Välj vinnare 🏆" (kryssa flera = delad seger). Går även från Admin → "🏆 Avgör". Potten delas ut direkt.
4. TA BORT / AVBRYTA: Ett spel utan bets kan tas bort ("🗑️ Ta bort spelet"). Har någon bettat: "🛑 Avbryt spelet" – alla insatser går tillbaka. Ett avgjort spel kan inte tas bort; det flyttas automatiskt till "✅ Avgjorda spel" längst ner på eventsidan.
5. AVSLUTA EVENTET: När alla spel är avgjorda trycker värden "🏆 Avsluta event & kora vinnare". Då räknas allt ihop och alla får en push med vad de ska swisha eller få.
6. THE TAB (hela avräkningen): Allt räknas ihop PER PERSON – event, BlixtBet, AnyBet, dueller och notor – i hela kronor. Man swishar en gång per person.
   - "Klart att swisha": skulder till folk du inte har ett pågående event med. Swish-knappen öppnar Swish med rätt nummer och belopp.
   - "Löpande – görs upp när eventet är slut": pengar i ett pågående event väntar tills eventet avslutas (så man swishar en gång). Vill man ändå betala direkt finns "Swisha ändå", och mottagaren trycker "Markera som betalt".
   - Mottagaren bekräftar alltid med "Markera som betalt ✓" när pengarna kommit.
   - Dela en nota (lunch, taxi, golfbil): THE TAB → "🧾 Dela på en nota".
7. BLIXTBET: Snabb ja/nej-fråga med tidsgräns till utvalda vänner. Tips: 2–3 minuter så alla hinner svara.
8. ANYBET: Ett eget vad med en domare, t.ex. "Vem gör flest birdies under resan?". Inbjudna svarar, domaren avgör.
9. MINISPEL: The Blind 10.00 (stoppa klockan på exakt 10.00 – närmast vinner), Space Blitz, Maffia, Not-Roulette, Singla slant, Gimme, Hjulet, Enarmad bandit (spelpengar), Livebet och Löven-spelet (för ishockeylaget Björklöven, inte golf). Spel med insats på egna mobiler (partyrum) hamnar på THE TAB; spelar ni på samma telefon gör ni upp sinsemellan. The Blind 10.00: vid lika på första plats väljer värden en avgörande omgång eller att dela potten.
10. NOTISER: Klockan uppe till höger. "Väntar på dig" = saker att göra (vänförfrågningar, swisha, BlixtBets, spel att avgöra). "Senaste" = vad som hänt, t.ex. dina resultat.
11. VÄNNER: Min profil → VÄNNER → "Lägg till" (skickar förfrågan som mottagaren godkänner) eller "Bjud in" (din personliga länk – den som öppnar blir vän direkt). Förfrågningar kan godkännas direkt i klockan. Skickade förfrågningar kan ångras.
12. GLÖMT PIN: En admin går till Admin, låser upp med admin-PIN, letar upp personen och trycker "🔑 Nollställ PIN". Personen får en engångskod och väljer "Glömt PIN" vid inloggning.
13. Appen flyttar aldrig pengar själv – den räknar ut vem som ska swisha vem.
`.trim();

const MALTA_SYSTEM_PROMPT = `
Du är "Malta Support 🇲🇹" – kundtjänsten i appen Whooply. Appen heter alltid Whooply, aldrig Whooply.

Personlighet: en solbränd, trevlig och professionell VIP-concierge i St. Julian's. Rapp, rolig och med glimten i ögat – golf, kall lager och hederliga vad där ingen smiter från sina skulder. Svara på svenska (engelska om användaren skriver engelska), kort och konkret, med några passande emojis.

Viktigast: ge KORREKTA instruktioner om appen, med knappnamnen nedan. Hitta aldrig på knappar eller funktioner. Vet du inte, säg det rakt och föreslå närmaste funktion.

${APP_FACTS}

Golfcoach: du ger gärna korta, peppiga svingtips (slice, duff, toppar, shank, puttning) med humor.

Aktuella frågor (resultat, väder, nyheter, börs): kan du söka, svara kort med fakta. Kan du inte söka, säg det ärligt – lova aldrig att "kolla upp och återkomma". Börsfrågor på en golfresa får gärna ett skämt om att lägga ner Avanza.

Officiella Malta-videon (https://youtu.be/0EoEY4fi3vo): nämn den bara om någon ber om pepp, stämning eller en video.
`.trim();

// ── Offline answers: a small knowledge base scored on whole words ──
// A keyword ending in * matches word beginnings (Swedish inflections: "avgör*" → "avgöra",
// "avgjord"); other keywords must match a whole word, so "tab" never matches "tabellen".
// A trailing ! counts double: what someone wants to DO ("ta bort") beats what the thing is
// ("avgjort").
const KB = [
  {
    id: 'decide', label: '🏆 Avgöra en match',
    keywords: ['avgör*', 'avgjor*', 'vinnare', 'vinnaren', 'kora', 'resultat*', 'vann', 'rätta'],
    answer: (n) => `Så avgör du en match, ${n}! 🏆
1. Öppna spelet och fäll ut **👑 Spelledare**.
2. Tryck **🏆 Avgör matchen**.
3. Tryck **Välj vinnare 🏆** vid rätt alternativ – eller kryssa i flera för delad seger.
Appen frågar innan något händer. Potten delas ut direkt och skulderna hamnar på THE TAB. Det går även från **Admin → 🏆 Avgör**. ⛳`
  },
  {
    id: 'remove', label: '🗑️ Ta bort eller avbryta spel',
    keywords: ['bort!', 'radera*!', 'avbryt*!', 'ångra', 'arkiv*', 'fel spel'],
    answer: (n) => `Bra fråga, ${n}! 🧹
- **Ingen har bettat än:** 👑 Spelledare/⋯ → **🗑️ Ta bort spelet**.
- **Någon har bettat:** **🛑 Avbryt spelet** – alla insatser går tillbaka och spelet räknas inte.
- **Avgjort spel:** kan inte tas bort (då skulle vinster och skulder försvinna). Det flyttas automatiskt till **✅ Avgjorda spel** längst ner på eventsidan, så det blir plats för nya matcher. 📦`
  },
  {
    id: 'picks', label: '🎯 Välj flera',
    keywords: ['välj flera', 'flest rätt', 'topp*', 'vilka*', 'sist', 'först', 'flera'],
    answer: (n) => `🎯 **Välj flera** är perfekt för "Vilka 4 kommer sist i loppet?", ${n}!
1. Eventet → **➕ Lägg till spel** → **🎯 Välj flera**.
2. Skriv frågan, lägg till alla alternativ med **＋ Namn** och välj hur många man ska välja.
3. Alla trycker i sina val och lägger tipset. Andras tips syns först efter spelstopp.
4. Spelledaren kryssar i vad som faktiskt hände. **Flest rätt tar potten** (delas vid lika). Har ingen rätt går insatserna tillbaka. 🏁`
  },
  {
    id: 'coupon', label: '📋 Tipsrad',
    keywords: ['tipsrad*', 'stryktips*', 'kupong*', 'rad!', 'matchspel', 'flera matcher', 'rätta*'],
    answer: (n) => `📋 **Tipsrad** är som en tipskupong, ${n}: flera matcher, ett tecken per match.
1. Eventet → **➕ Lägg till spel** → **📋 Tipsrad**. Lägg till matcherna (2–13). Tryck på **X** i en match som alltid får en vinnare, t.ex. tennis.
2. Alla tippar **1, X eller 2** i varje match och lägger sin rad. Andras rader syns när tippningen har stängt.
3. Spelledaren **rättar match för match** när de blir klara (✕ = struken). Första rättningen stänger tippningen, och alla ser ställningen live.
4. När alla matcher är rättade: **🏆 Avgör tipsraden**. Flest rätt tar potten (delas vid lika). Har ingen rätt går insatserna tillbaka. 🏁`
  },
  {
    id: 'games', label: '➕ Lägga till spel',
    keywords: ['lägg* till spel', 'nytt spel', 'skapa spel', 'speltyp*', '1x2', 'ja eller nej', 'match', 'matchen', 'odds'],
    answer: (n) => `Nytt spel i eventet, ${n}? ⚽ Eventsidan → **➕ Lägg till spel** och välj typ:
- 🏆 **Vem vinner?** – betta på en spelare, odds från potten
- 👥 **Vinnare tar allt** – alla lägger lika, vinnaren tar allt
- ⚽ **Match 1 X 2** – hemma, oavgjort eller borta
- 👍 **Ja eller nej** – en snabb fråga
- 🎯 **Välj flera** – flest rätt tar potten
- 📋 **Tipsrad** – flera matcher 1 X 2, flest rätt tar potten
Sätt insats och gärna ett spelstopp, så stänger bettningen av sig själv. ⏱️`
  },
  {
    id: 'event', label: '🏌️ Event & gå med',
    keywords: ['event*', 'turnering*', 'gå med', 'bjud* in', 'inbjud*', 'qr', 'länk*', 'golfresa*', 'rund*', 'ronder'],
    answer: (n) => `Så funkar event, ${n}! 🏌️
1. Skapa via **Admin → SKAPA EVENT**, t.ex. *"Golfhelg Malta"*.
2. Få med gänget via **📱 Dela event** (länk eller QR) – eller **Bjud in vänner** så får de en push.
3. Lägg upp spelen med **➕ Lägg till spel** allteftersom.
4. När allt är avgjort: **🏆 Avsluta event & kora vinnare** – då räknas allt ihop på THE TAB. 🇲🇹`
  },
  {
    id: 'running', label: '⏳ Löpande skulder',
    keywords: ['löpande', 'pågå*', 'fast eventet', 'swisha nu', 'redan swisha*', 'mitt i', 'vänta*'],
    answer: (n) => `Smart fråga, ${n}! ⏳ Pengar i ett **pågående event** är *löpande* – de räknas ihop när eventet avslutas, så att ni bara swishar **en gång per person**.
- Eventkortet på startsidan och toppen av eventsidan visar "Ditt resultat hittills", men ber dig inte swisha än.
- När värden trycker **🏆 Avsluta event & kora vinnare** får alla en push med exakt belopp.
- Vill du ändå betala direkt: THE TAB → **Swisha ändå**, och mottagaren trycker **Markera som betalt ✓**. Senare resultat räknas bara på det som är kvar. 💸`
  },
  {
    id: 'swish', label: '💸 Swish & THE TAB',
    keywords: ['swish*', 'betala*', 'skuld*', 'saldo', 'peng*', 'skyldig', 'kvitt', 'the tab', 'tab', 'tabben', 'avräkning*'],
    answer: (n) => `THE TAB i korthet, ${n}! 💸
- Allt räknas ihop **per person** – event, BlixtBet, AnyBet, dueller och notor – i hela kronor. Du swishar **en gång per person**.
- **Klart att swisha:** tryck Swish-knappen, så öppnas Swish med rätt nummer och belopp.
- **Löpande:** pengar i pågående event väntar tills eventet avslutas.
- Mottagaren trycker **Markera som betalt ✓** när pengarna kommit – då försvinner raden.
Appen flyttar aldrig pengar själv, den räknar bara ut vem som ska swisha vem. 📊`
  },
  {
    id: 'bill', label: '🧾 Dela en nota',
    keywords: ['nota*', 'utlägg*', 'lunch', 'middag', 'taxi', 'golfbil*', 'öl', 'bärs', 'kvitto', 'dela på', 'notan'],
    answer: (n) => `Dela notan, ${n}! 🍻
1. **THE TAB → 🧾 Dela på en nota** (fristående eller i ett pågående event).
2. Ange beloppet och vilka som var med.
3. Allas del hamnar direkt på THE TAB och räknas ihop med allt annat – ingen smiter undan! 🧾`
  },
  {
    id: 'blixt', label: '⚡ BlixtBet',
    keywords: ['blixt*', 'flashbet', 'snabbt', 'snabbvad'],
    answer: (n) => `⚡ **BlixtBet** är en snabb ja/nej-fråga, ${n} – t.ex. *"Sänker Johan par-putten?"*.
Välj vilka som ska få den och sätt en tidsgräns. Tips från Malta-kontoret: **2–3 minuter**, så polarna med svag täckning i ruffen hinner svara. Resultatet hamnar på THE TAB. 🌲📱`
  },
  {
    id: 'anybet', label: '🎯 AnyBet & birdies',
    keywords: ['anybet', 'birdie*', 'domare', 'eget vad', 'vad om'],
    answer: (n) => `Tjena ${n}! 🏌️‍♂️ För t.ex. *"Mest birdies under resan"* är **AnyBet** perfekt:
1. Skapa AnyBet, skriv frågan och sätt insats.
2. Välj en opartisk domare som håller koll på scorekorten.
3. De inbjudna svarar, och domaren avgör vinnaren – potten hamnar på THE TAB. 🏆`
  },
  {
    id: 'bell', label: '🔔 Notiser',
    keywords: ['notis*', 'klock*', 'push*', 'meddelande*', 'aviser*'],
    answer: (n) => `🔔 **Klockan** uppe till höger är din inkorg, ${n}:
- **Väntar på dig:** vänförfrågningar (godkänn direkt), vad du ska swisha, BlixtBets att svara på och spel att avgöra.
- **Senaste:** vad som hänt, t.ex. *"Du vann 50 kr"*.
Slå gärna på pushnotiser under Min profil så missar du inget. 📲`
  },
  {
    id: 'friends', label: '👥 Vänner',
    keywords: ['vän', 'vänner', 'vänförfrågan', 'kompis*', 'polare*', 'lägga till'],
    answer: (n) => `Vänner, ${n}! 👥
- **Min profil → VÄNNER → Lägg till:** sök och skicka en förfrågan. Mottagaren godkänner (direkt i klockan 🔔).
- **Bjud in:** dela din personliga länk – den som öppnar den blir vän direkt.
- En skickad förfrågan kan **ångras** under VÄNNER.`
  },
  {
    id: 'blind10', label: '⏱️ The Blind 10.00',
    keywords: ['blind*', '10.00', 'stoppur', 'klockan 10'],
    answer: (n) => `⏱️ **The Blind 10.00**, ${n}: stoppa klockan på exakt 10.00 sekunder – blint! Den som kommer närmast vinner potten.
Kör **Egna mobiler** (partyrum med kod – insatserna hamnar på THE TAB) eller **Samma telefon** (turas om – där gör ni upp sinsemellan). Servern mäter tiden, så ingen kan fuska. Vid lika på första plats väljer värden **avgörande omgång** eller att **dela potten**. 🎯`
  },
  {
    id: 'minigames', label: '🎮 Minispel',
    keywords: ['minispel*', 'partyspel*', 'space', 'maffia', 'mafia', 'roulette', 'slant', 'gimme', 'hjulet', 'bandit', 'livebet'],
    answer: (n) => `Minispelen, ${n}! 🎮 The Blind 10.00, Space Blitz, Maffia, Not-Roulette, Singla slant, Gimme, Hjulet och Livebet – plus Enarmad bandit med spelpengar.
Spel med insats på **egna mobiler** hamnar automatiskt på THE TAB – spelar ni på **samma telefon** gör ni upp sinsemellan. Partyspelen funkar bäst över WiFi på hotellet eller i klubbhuset. 🍻`
  },
  {
    id: 'pin', label: '🔑 Glömt PIN',
    keywords: ['pin*', 'glömt', 'lösenord', 'login', 'logga*', 'inlogg*'],
    answer: (n) => `Ingen panik, ${n}! 🔑
1. En admin går till **Admin** och låser upp med admin-PIN.
2. Leta upp personen och tryck **🔑 Nollställ PIN** – en engångskod visas.
3. Personen väljer **"Glömt PIN"** vid inloggning, skriver koden och väljer en ny PIN. 🏖️`
  },
  {
    id: 'loven', label: '🏒 Löven-spelet',
    keywords: ['löven*', 'björklöven', 'hockey*'],
    answer: (n) => `Se upp, ${n}! 🏒 **Löven-spelet** är gjort för ishockeylaget Björklöven (mål, skott och så vidare). För golfen kör ni vanliga spel i eventet eller AnyBet istället! ⛳`
  },
  {
    id: 'swing', label: '🏌️‍♂️ Svingtips',
    keywords: ['sving*', 'slice*', 'hook*', 'shank*', 'duff*', 'grepp*', 'toppa*', 'putt*', 'driver'],
    answer: (n) => `Akut svinghjälp från Malta Pro Desk, ${n}! 🏌️‍♂️
1. **Slice:** starkare grepp (2–3 knogar synliga) och sving inifrån-och-ut mot klockan 13.
2. **Duff/toppar:** vikten på främre foten, behåll ryggvinkeln – lita på loften.
3. **Shank:** kliv bak 2 cm och låt armarna hänga fritt.
4. **Puttar:** lås handlederna och pendla från axlarna.
Guldregeln: grepptryck 4 av 10 och 80 % tempo! 🍻
🎬 Behöver ni pepp? https://youtu.be/0EoEY4fi3vo`
  },
  {
    id: 'stocks', label: '📈 Börsen',
    keywords: ['börs*', 'aktie*', 'omx*', 'fond*', 'avanza', 'finans*'],
    answer: (n) => `Hallå där ${n}! 🏌️‍♂️💼 Live-kurser kan jag inte hämta just nu – och ärligt talat, du är ju på golfresa! Lägg ner Avanza, träffa fairway och ta hem potten i Whooply istället. Ölen på 19:e smakar lika gott oavsett om börsen är röd eller grön! ⛳🍻`
  },
  {
    id: 'internet', label: '📶 Internet',
    keywords: ['internet', 'surf*', 'wifi', 'söka', 'google'],
    answer: (n) => `Haha ${n}! 🌴📶 Just nu kör Malta-kontoret utan surf – men jag kan fortfarande allt om Whooply: event, spel, THE TAB, notiser och svingen. Vad vill du ha hjälp med? 🏌️‍♂️`
  },
  {
    id: 'video', label: '🎬 Malta-videon',
    keywords: ['video*', 'film*', 'youtube', 'pepp*', 'hype', 'tagga*', 'låt', 'musik'],
    answer: (n) => `Jajamän ${n}! 🔥🎬 Officiella Whooply-videon som sätter stämningen: https://youtu.be/0EoEY4fi3vo 🏌️‍♂️🍻`
  }
];

// The chips shown in the chat and when nothing matched
export const SUPPORT_TOPICS = ['decide', 'swish', 'running', 'games', 'picks', 'friends', 'bell', 'pin']
  .map(id => KB.find(t => t.id === id)).map(t => ({ id: t.id, label: t.label }));

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}.\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function keywordHits(words, text, rawKeyword) {
  const weight = rawKeyword.endsWith('!') ? 2 : 1;
  const keyword = weight === 2 ? rawKeyword.slice(0, -1) : rawKeyword;
  return weight * keywordMatch(words, keyword);
}

function keywordMatch(words, keyword) {
  if (keyword.includes(' ')) {
    // Phrase: every word must follow in order ("lägg* till spel")
    const parts = keyword.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (parts.every((p, j) => (p.endsWith('*') ? words[i + j].startsWith(p.slice(0, -1)) : words[i + j] === p))) return 2;
    }
    return 0;
  }
  if (keyword.endsWith('*')) return words.some(w => w.startsWith(keyword.slice(0, -1))) ? 1 : 0;
  return words.includes(keyword) ? 1 : 0;
}

// Best matching topics for a question, best first
export function matchSupportTopics(message) {
  const text = normalize(message);
  const words = text.split(' ').filter(Boolean);
  return KB
    .map(t => ({ topic: t, score: t.keywords.reduce((sum, k) => sum + keywordHits(words, text, k), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * Offline answer (no AI key, AI unreachable): the best matching topic, or a short
 * "pick a topic" list instead of a dead end.
 */
export function getMaltaFallbackReply(message, userName = 'Kompis') {
  const best = matchSupportTopics(message)[0];
  if (best) return best.topic.answer(userName);
  return `Tjena ${userName}! 🌴 Det där hittar jag inget färdigt svar på i Whooply-handboken just nu. Välj ett ämne nedan – eller skriv med andra ord, t.ex. *"hur avgör jag en match?"* ⛳`;
}

// Suggestions to show under an offline answer: other close topics, else the main ones
export function getSupportSuggestions(message) {
  const matched = matchSupportTopics(message).map(x => x.topic);
  const pool = matched.length > 1 ? matched.slice(1, 4) : KB.filter(t => SUPPORT_TOPICS.some(s => s.id === t.id)).slice(0, 4);
  return pool.map(t => ({ id: t.id, label: t.label }));
}

export function getSupportTopicQuestion(id) {
  const t = KB.find(x => x.id === id);
  return t ? t.label.replace(/^\S+\s/, '') : null;
}

export const MAX_MONTHLY_SEARCHES = 5000;

/**
 * Get current monthly search quota status.
 */
export function getSearchQuotaInfo() {
  const count = db?.getMonthlySearchCount ? db.getMonthlySearchCount() : 0;
  return {
    count,
    max: MAX_MONTHLY_SEARCHES,
    remaining: Math.max(0, MAX_MONTHLY_SEARCHES - count),
    exhausted: count >= MAX_MONTHLY_SEARCHES
  };
}

let lastApiDiagnostic = null;
// How the latest AI attempt went, so the chat badge shows what people will actually get
let lastReplyMode = null;
let lastReplyAt = 0;

export function getSupportMode() {
  if (!isGeminiLive()) return 'offline';
  // A failure is remembered for 10 minutes; after that the AI is given a new chance
  if (lastReplyMode && lastReplyMode !== 'live' && Date.now() - lastReplyAt < 10 * 60 * 1000) return lastReplyMode;
  return 'live';
}

function rememberMode(mode) {
  lastReplyMode = mode;
  lastReplyAt = Date.now();
  return mode;
}

export function getLastApiDiagnostic() {
  return lastApiDiagnostic;
}

/**
 * Check if Gemini API is configured and ready.
 */
export function isGeminiLive() {
  const key = process.env.GEMINI_API_KEY || (db?.getSetting ? db.getSetting('gemini_api_key') : null);
  return Boolean(key && String(key).trim());
}

const MAX_MESSAGE_CHARS = 500;
const MAX_HISTORY_CHARS = 1000;
const PER_MODEL_TIMEOUT_MS = 8000;
const TOTAL_TIMEOUT_MS = 15000;

/**
 * Calls Gemini (with Google Search grounding while the monthly quota lasts).
 * Returns { text, mode: 'live' | 'offline' | 'resting' }.
 */
export async function generateMaltaSupportReply(message, history = [], userName = 'Kompis') {
  const apiKey = (process.env.GEMINI_API_KEY || (db?.getSetting ? db.getSetting('gemini_api_key') : null) || '').trim();
  const question = String(message || '').slice(0, MAX_MESSAGE_CHARS);

  lastApiDiagnostic = {
    time: new Date().toISOString(),
    apiKeyPresent: Boolean(apiKey),
    quota: getSearchQuotaInfo(),
    attempts: []
  };

  if (!apiKey) {
    lastApiDiagnostic.offlineReason = 'No API key provided';
    return { text: getMaltaFallbackReply(question, userName), mode: 'offline' };
  }

  const quota = getSearchQuotaInfo();

  // Only the last few turns, trimmed; anything that is not the user is the assistant
  const formattedContents = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-6)) {
      if (h && typeof h.text === 'string' && h.text.trim()) {
        formattedContents.push({
          role: h.role === 'user' ? 'user' : 'model',
          parts: [{ text: h.text.slice(0, MAX_HISTORY_CHARS) }]
        });
      }
    }
  }
  formattedContents.push({ role: 'user', parts: [{ text: `[Användare: ${userName}]: ${question}` }] });

  let systemInstructionText = MALTA_SYSTEM_PROMPT;
  if (quota.exhausted) {
    systemInstructionText += '\n\n[Månadens sökkvot är slut: du kan INTE söka på nätet just nu. Säg det ärligt om någon frågar om aktuella saker.]';
  }

  const primaryPayload = {
    system_instruction: { parts: [{ text: systemInstructionText }] },
    contents: formattedContents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 600 }
  };
  if (!quota.exhausted) primaryPayload.tools = [{ google_search: {} }];

  const models = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash'
  ];

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  for (const model of models) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < 1000) {
      lastApiDiagnostic.attempts.push({ model, skipped: 'total timeout' });
      break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(PER_MODEL_TIMEOUT_MS, timeLeft));
    try {
      // The key goes in a header, never in the URL (URLs end up in logs)
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(primaryPayload),
        signal: controller.signal
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[malta-support] Gemini API error on ${model} (${response.status}): ${errText.slice(0, 300)}`);
        lastApiDiagnostic.attempts.push({ model, status: response.status, ok: false, error: errText.slice(0, 500) });
        continue;
      }

      const data = await response.json();
      const cand = data?.candidates?.[0];
      const candidateText = (cand?.content?.parts || []).map(p => p.text || '').join('').trim();
      const gm = cand?.groundingMetadata || cand?.grounding_metadata;
      const queries = gm?.webSearchQueries || gm?.web_search_queries;

      lastApiDiagnostic.attempts.push({ model, status: response.status, ok: true, candidateLength: candidateText.length, queries: queries || [] });

      if (candidateText) {
        if (Array.isArray(queries) && queries.length > 0 && db?.incrementMonthlySearchCount) {
          db.incrementMonthlySearchCount(queries.length);
        }
        return { text: candidateText, mode: rememberMode('live') };
      }
    } catch (fetchErr) {
      const reason = fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message;
      console.warn(`[malta-support] ${model} failed: ${reason}`);
      lastApiDiagnostic.attempts.push({ model, exception: reason });
    } finally {
      clearTimeout(timer);
    }
  }

  // Google's own limit hit: answer from the handbook, and say the AI rests for a while
  if (lastApiDiagnostic.attempts.some(a => a.status === 429)) {
    return { text: getMaltaFallbackReply(question, userName), mode: rememberMode('resting') };
  }
  return { text: getMaltaFallbackReply(question, userName), mode: rememberMode('offline') };
}

/**
 * Rich offline/fallback templates for Malta Support push notifications.
 */
export function getMaltaPushFallback({ eventType, userName = 'Kompis', details = {} }) {
  const { opponentName = 'polaren', gameType = 'duellen', stakeAmount = 50, netAmount = 0, creditorName = 'kompisen', tournamentName = 'Turneringen' } = details;

  switch (eventType) {
    case 'duel_loss': {
      const templates = [
        `Svider det, ${userName}? Torsk mot ${opponentName} i ${gameType}! Grabben i supporten gråter i sin espresso. Tryck Revansch och ta tillbaka hedern! ☕🔥`,
        `Aj aj aj, ${stakeAmount} kr rakt i fickan på ${opponentName}! 🏌️‍♂️ Supporten råder dig att kräva omedelbar revansch innan han skryter i baren! 🍻`,
        `Tuff förlust i ${gameType}, ${userName}! Även Tiger Woods har slagit i ruffen. In och utmana på nytt direkt! ⛳💥`
      ];
      return {
        title: '🇲🇹 Malta Support: Aj aj aj...',
        body: templates[Math.floor(Math.random() * templates.length)],
        url: '/#arcade'
      };
    }
    case 'duel_win': {
      const templates = [
        `Kungligt spelat, ${userName}! 🏆 ${stakeAmount} kr in från ${opponentName} i ${gameType}. Supporten skålar i en iskall Cisk! 🍻💰`,
        `Där satt den! Du krossade ${opponentName} i ${gameType}. Glöm inte att kräva in dina ${stakeAmount} kr på Swish! 💸🏖️`
      ];
      return {
        title: '🇲🇹 Malta Support: Kungligt! 🏆',
        body: templates[Math.floor(Math.random() * templates.length)],
        url: '/#arcade'
      };
    }
    case 'duel_challenge': {
      return {
        title: '🇲🇹 Malta Support: Duell utlyst! ⚔️',
        body: `${opponentName} tror han kan tvåla dit dig i ${gameType} om ${stakeAmount} kr! Vågar du anta eller fegar du ur? 🏌️‍♂️🎲`,
        url: '/#arcade'
      };
    }
    case 'debt_reminder': {
      return {
        title: '🇲🇹 Malta Support: Swish väntar... 💸',
        body: `Psst ${userName}! Du ligger back ${Math.abs(netAmount || stakeAmount)} kr mot ${creditorName}. Sköt det snyggt så bjuder hen kanske på nästa runda på 19:e! 🏖️🍹`,
        url: '/#swishlist'
      };
    }
    case 'tournament_settled': {
      if (netAmount > 0) {
        return {
          title: '🇲🇹 Malta Support: Slutavräkning klar! 🥂',
          body: `Grattis ${userName}! ${tournamentName} är avgjord och du går plus ${netAmount} kr. Dags att hålla fram Swish! 🏆💰`,
          url: '/#swishlist'
        };
      } else if (netAmount < 0) {
        return {
          title: '🇲🇹 Malta Support: Slutavräkning klar! 📊',
          body: `${tournamentName} är avgjord och du ligger back ${Math.abs(netAmount)} kr. In på 'Vem swishar vem' och städa upp innan kvällen spårar! 🍻`,
          url: '/#swishlist'
        };
      } else {
        return {
          title: '🇲🇹 Malta Support: Jämnt skägg! ⚖️',
          body: `${tournamentName} är avgjord och du går ut på exakt nollan! Inte en krona back. Grabben i supporten lyfter på hatten! ⛳`,
          url: '/#swishlist'
        };
      }
    }
    case 'test_push':
    default: {
      return {
        title: '🇲🇹 Malta Support: Tjena kompis!',
        body: `Halloj ${userName}! Grabben i supporten kollar bara att telefonen plingar som den ska. Läget är under kontroll i St. Julian's! 🌴☕🏌️‍♂️`,
        url: '/'
      };
    }
  }
}

/**
 * Generate an intelligent, humorous push notification via Gemini or instant fallback.
 */
export async function generateMaltaSupportPush({ eventType, user, details = {}, apiKey = process.env.GEMINI_API_KEY }) {
  const userName = (typeof user === 'object' && user ? (user.nickname || user.name) : user) || 'Kompis';
  const fallback = getMaltaPushFallback({ eventType, userName, details });

  if (!apiKey) {
    return fallback;
  }

  const quota = getSearchQuotaInfo();
  if (quota.exhausted) {
    return fallback;
  }

  const contextDesc = `
Händelse: ${eventType}
Användare: ${userName}
Motståndare/Kompis: ${details.opponentName || details.creditorName || 'kompisen'}
Spel/Turnering: ${details.gameType || details.tournamentName || 'spelet'}
Belopp: ${details.stakeAmount || details.netAmount || 50} kr
`;

  const prompt = `Du är "Malta Support 🇲🇹" – den solbrända, kaxiga och sköna VIP Conciergen för appen Whooply.
Skriv en ultrakort, slagkraftig, rolig push-notis till spelaren baserat på denna händelse:
${contextDesc}

Krav:
- Max 120 tecken!
- Får INTE nämna "Whooply" någonsin (appen heter Whooply).
- Humör: Kaxig, skön humor, glimten i ögat, golf/bärs/espresso/revansch-pepp.
- Svara i exakt JSON-format: {"title": "🇲🇹 Malta Support: ...", "body": "..."}
- Skriv ingenting annat än JSON-objektet.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 100,
          responseMimeType: 'application/json'
        }
      })
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.title && parsed.body) {
          return {
            title: parsed.title.startsWith('🇲🇹') ? parsed.title : `🇲🇹 Malta Support: ${parsed.title}`,
            body: parsed.body,
            url: fallback.url
          };
        }
      }
    }
  } catch {
    // Timeout or network error -> seamlessly fall back
  }

  return fallback;
}

