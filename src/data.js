// MUCHI — static data tables, ported VERBATIM from server.js (lines 683–1438).
// Same ids, titles, queries, colors, order — response shapes must not change.

export const LOCAL_CHARTS = {
  IN: "latest bollywood trending hits 2025 2026 new songs",
  US: "top 40 billboard hot 100 new hits official audio",
  GB: "official uk top 40 singles chart new hits",
  CA: "canada top hits 2025 new official audio",
  AU: "aria charts australia top hits new songs",
  DE: "offizielle deutsche single charts 2025 hits",
  FR: "top singles france 2025 hits officiels",
  JP: "billboard japan hot 100 new songs official",
  KR: "kpop new releases top hits official audio",
  BR: "top brasil hits 2025 novas musicas oficiais",
  MX: "mexico top hits 2025 musica nueva",
  NG: "latest afrobeats hits 2025 new releases",
  ZA: "south africa amapiano 2025 new hits",
  AE: "arabic top hits 2025 new songs",
  SA: "khaleeji new hits 2025 official audio",
  PK: "pakistani new hits 2025 official",
  BD: "bangla new songs 2025 hits official",
  ID: "indonesia viral hits 2025 lagu baru",
  MY: "malaysia top hits 2025 lagu baru official",
  SG: "singapore top hits new releases",
  PH: "opm top hits 2025 new releases",
  TH: "thai new hits 2025เพลงใหม่",
  VN: "vpop new hits 2025 nhac tre moi nhat",
  EG: "egypt new hits 2025 aghani gadida",
  IT: "classifica singoli italia 2025 nuove canzoni",
  ES: "top 50 canciones espana 2025 exitos nuevos",
  TR: "turkce pop yeni cikanlar 2025 hits",
  NZ: "new zealand top 40 singles chart new hits official",
  NL: "nederlandse top 40 dutch hits nieuwe muziek official",
  SE: "sverigetopplistan sweden top hits nya latar official",
  CN: "chinese new songs 2025 hot hits official",
  HK: "hong kong cantopop new hits official",
};

export const YT_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRAKEAMQBA==";

export const MOOD_CORE = [
  { id: "pop", title: "Pop", query: "english pop hits official audio", color: "#90e0ef", tags: "pop english hits" },
  { id: "hiphop", title: "Hip-Hop", query: "hip hop rap official audio", color: "#e9c46a", tags: "hiphop rap" },
  { id: "rnb", title: "R&B", query: "rnb soul hits official audio", color: "#c084fc", tags: "rnb soul" },
  { id: "rock", title: "Rock", query: "rock hits official audio", color: "#fb7185", tags: "rock alternative" },
  { id: "dance", title: "Dance", query: "edm dance hits official audio", color: "#4cc9f0", tags: "edm dance electronic" },
  { id: "indie", title: "Indie", query: "indie pop alternative official audio", color: "#80ed99", tags: "indie alternative" },
  { id: "lofi", title: "Lo-fi Focus", query: "lofi hip hop beats to relax", color: "#7c6cff", tags: "lofi chill study" },
  { id: "workout", title: "Workout", query: "workout gym motivation songs", color: "#c8f542", tags: "workout gym rap edm" },
  { id: "romance", title: "Late Night Love", query: "romantic english songs official audio", color: "#ff6b9d", tags: "romance love slow" },
  { id: "latin", title: "Latin", query: "latin hits official audio", color: "#f59e0b", tags: "latin reggaeton" },
];

export const ENGLISH_SHELVES = [
  { id: "today", title: "Today's Top Hits", query: "billboard hot 100 official audio" },
  { id: "pop", title: "Pop", query: "english pop hits official audio" },
  { id: "hiphop", title: "Hip-Hop", query: "hip hop rap hits official audio" },
  { id: "rnb", title: "R&B", query: "rnb soul hits official audio" },
  { id: "rock", title: "Rock", query: "classic and new rock hits official audio" },
  { id: "dance", title: "Dance & Electronic", query: "edm dance hits official audio" },
  { id: "indie", title: "Indie", query: "indie pop alternative official audio" },
];

export const COUNTRY_SHELF_QUERIES = {
  IN: {
    today: "india top 50 bollywood hindi hits official audio",
    pop: "indian pop hindi hits official audio",
    hiphop: "desi hip hop indian rap hits official audio",
    rnb: "indian rnb chill hindi songs official audio",
    rock: "indian rock bands hindi rock songs official audio",
    dance: "bollywood dance party hits official audio",
    indie: "indian indie songs hindi indie pop official audio",
  },
  PK: {
    today: "pakistan top hits new songs official audio",
    pop: "pakistani pop songs coke studio official audio",
    hiphop: "urdu rap pakistani hip hop official audio",
    rnb: "pakistani rnb chill songs official audio",
    rock: "pakistani rock bands songs official audio",
    dance: "pakistani dance party hits official audio",
    indie: "pakistani indie alternative songs official audio",
  },
  BD: {
    today: "bangla top hits new songs official audio",
    pop: "bangla pop hits official audio",
    hiphop: "bangla hip hop rap songs official audio",
    rnb: "bangla romantic rnb songs official audio",
    rock: "bangla rock bands warfaze artcell songs official",
    dance: "bangla dance party songs official audio",
    indie: "bangla indie songs coke studio bangla official",
  },
  PH: {
    today: "opm top hits philippines chart official audio",
    pop: "opm pop hits philippines bini zack tabudlo official audio",
    hiphop: "pinoy hip hop rap flow g hev abi official audio",
    rnb: "opm rnb soul arthur nery denise julia official audio",
    rock: "pinoy rock opm bands eraserheads iv of spades cup of joe official",
    dance: "opm dance pop philippines hits official audio",
    indie: "pinoy indie opm alternative ben&ben lola amour official audio",
  },
  HK: {
    today: "hong kong cantopop top hits official audio",
    pop: "cantopop hong kong pop hits eason chan hins cheung mirror official",
    hiphop: "hong kong cantonese hip hop rap official audio",
    rnb: "hong kong cantopop rnb soul gareth t terence lam official",
    rock: "hong kong rock band beyond dear jane supper moment rubberband official",
    dance: "hong kong cantopop dance electronic hits official",
    indie: "hong kong indie cantopop serrini moon tang my little airport official",
  },
  CN: {
    today: "mandopop china top hits official audio",
    pop: "mandopop chinese pop hits jay chou jj lin official",
    hiphop: "chinese rap c-rap hip hop hits official",
    rnb: "chinese rnb soul mandopop official audio",
    rock: "chinese rock bands mayday omnipotent youth society official",
    dance: "chinese electronic dance music hits official",
    indie: "chinese indie folk pop songs official audio",
  },
  KR: {
    today: "kpop top hits korea chart official audio",
    pop: "kpop hits newjeans bts blackpink aespa official audio",
    hiphop: "khiphop korean rap hits jay park zico official audio",
    rnb: "krnb korean rnb soul dean crush bibi official audio",
    rock: "korean rock band day6 wave to earth jannabi official audio",
    dance: "kpop dance electronic hits official audio",
    indie: "korean indie k-indie hyukoh wave to earth 10cm official audio",
  },
  JP: {
    today: "billboard japan hot 100 jpop hits official",
    pop: "jpop top hits yoasobi fujii kaze kenshi yonezu official",
    hiphop: "japanese hip hop rap creepy nuts bad hop official",
    rnb: "japanese rnb city pop fujii kaze official",
    rock: "jrock japanese rock bands king gnu mrs green apple one ok rock official",
    dance: "japanese electronic dance pop perfume capsule official",
    indie: "japanese indie rock vaundy lamp hitsujibungaku official",
  },
  TH: {
    today: "thai top hits tpop new songs official",
    pop: "tpop thai pop hits jeff satur bowkylion billkin official",
    hiphop: "thai hip hop rap milli youngohm official",
    rnb: "thai rnb soul songs jeff satur official",
    rock: "thai rock bands three man down tilly birds bodyslam official",
    dance: "thai dance pop hits official",
    indie: "thai indie popfellows dept anatomy rabbit official",
  },
  VN: {
    today: "vpop top hits vietnam new songs official",
    pop: "vpop hits son tung mtp mono ame official",
    hiphop: "rap viet hip hop den vau hieuthuhai tlinh official",
    rnb: "vpop rnb chill wren evans vu official",
    rock: "vietnam rock bands chillies ngọt cá hồi hoang official",
    dance: "vpop dance edm remix hits official",
    indie: "viet indie vu chillies trang official",
  },
  ID: {
    today: "indonesia top hits lagu viral official",
    pop: "lagu pop indonesia tulus mahalini lyodra bernadya official",
    hiphop: "hip hop rap indonesia rich brian ramengvrl official",
    rnb: "rnb soul indonesia tulus raisa teddy adhitya official",
    rock: "band rock indonesia dewa 19 sheila on 7 noah official",
    dance: "indonesia electronic dance weird genius official",
    indie: "indie indonesia hindia feast pamungkas nadin amizah official",
  },
  MY: {
    today: "malaysia top hits lagu baru official",
    pop: "malaysia pop hits siti nurhaliza ernie zakri dolla official",
    hiphop: "malaysia hip hop rap joe flizzow sova official",
    rnb: "malaysia rnb yuna aisha retno official",
    rock: "malaysia rock bands wings search bunkface insomniacks official",
    dance: "malaysia dance pop hits official",
    indie: "malaysia indie hujan kugiran masdo noh salleh official",
  },
  SG: {
    today: "singapore top hits official audio",
    pop: "singapore pop hits jj lin stefanie sun benjamin kheng official",
    hiphop: "singapore hip hop rap shigga shay official",
    rnb: "singapore rnb soul gentle bones seint official",
    rock: "singapore rock bands electrico caracal official",
    dance: "singapore dance electronic hits official",
    indie: "singapore indie linying subsonic eye pleasantry official",
  },
  NG: {
    today: "afrobeats top hits nigeria official audio",
    pop: "afrobeats pop hits burna boy wizkid rema ayra starr official",
    hiphop: "nigerian hip hop rap odumodublvck olamide phyno official",
    rnb: "afro rnb soul tems omah lay chike official",
    rock: "african rock alternative songs official",
    dance: "afrobeats dance club hits asake davido official",
    indie: "alte nigerian indie cruell santino lady donli cavemen official",
  },
  ZA: {
    today: "south africa amapiano top hits official",
    pop: "south africa pop hits tyla jeremy loops official",
    hiphop: "south african hip hop nasty c a-reece cassper nyovest official",
    rnb: "south africa rnb soul elaine lloydgoy official",
    rock: "south african rock seether prime circle Kongos official",
    dance: "amapiano dance hits kabza de small uncle waffles kelvin momo official",
    indie: "south africa indie alternative desmond and the tutus shortstraw official",
  },
  BR: {
    today: "top brasil hits novas musicas oficiais",
    pop: "pop brasil hits anitta ludmilla luisa sonza jao official",
    hiphop: "trap rap nacional brasil matue filipe ret orochi official",
    rnb: "rnb brasil iza liniker gloria groove official",
    rock: "rock nacional brasil charlie brown jr legiao urbana skank pita",
    dance: "brazilian bass dance alok vintage culture funk brasil official",
    indie: "indie brasil mpba lagum terno rei jovm dionisio official",
  },
  MX: {
    today: "mexico top hits musica nueva oficial",
    pop: "latin pop mexico belinda Reik camila natalia lafourcade official",
    hiphop: "rap hip hop mexicano santa fe klan aleman gera mx official",
    rnb: "rnb latino humbe girl ultra jesse baez official",
    rock: "rock en espanol mexico caifanes zoe mana cafe tacvba official",
    dance: "reggaeton latin dance hits mexico official",
    indie: "indie mexico kevin kaarl ed maverick siddhartha bratty official",
  },
  ES: {
    today: "top 50 espana exitos nuevos oficial",
    pop: "pop espanol aitana rosalia lola indigo pablo alboran official",
    hiphop: "rap trap espana quevedo dels Rels B morad c tangana official",
    rnb: "rnb espanol rels b sen senra maikel delacalle official",
    rock: "rock espanol vetusta morla izal fito cabrales extremoduro",
    dance: "latin dance reggaeton espana hits official",
    indie: "indie espanol vetusta morla arde bogota lori meyers viva suecia",
  },
  FR: {
    today: "top singles france hits officiels",
    pop: "variete pop francaise angele aya nakamura clara luciani stromae",
    hiphop: "rap francais jul ninho gazo tiakola booba pnl official",
    rnb: "rnb francais dadju tayc monsieur nov ronisia official",
    rock: "rock francais indochine shaka ponk telephone noir desir",
    dance: "french touch electro dance daft punk david guetta dj snake",
    indie: "indie pop francaise phoenix air l'imperatrice videoclub",
  },
  DE: {
    today: "offizielle deutsche charts hits official",
    pop: "deutschpop nina chuba apache 207 lea mark forster official",
    hiphop: "deutschrap apache 207 luciano bonez mc raf camora pashanim",
    rnb: "german rnb soul joy denalane cro aylo official",
    rock: "german rock rammstein die toten hosen kraftklub annenmaykantereit",
    dance: "german electronic dance robin schulz felix jaehn purple disco machine",
    indie: "german indie annenmaykantereit giant rooks milky chance jeremias",
  },
  IT: {
    today: "classifica singoli italia nuove canzoni",
    pop: "pop italiano annalisa marco mengoni elodie mahmood tiziano ferro",
    hiphop: "rap trap italiano geolier lazza sfera ebbasta guè marracash",
    rnb: "rnb italiano mahmood venerus frah quintale official",
    rock: "rock italiano maneskin pinguini tattici nucleari vasco rossi ligabue",
    dance: "italo dance electronic meduza gabry ponte bob sinclar",
    indie: "indie italiano calcutta gazzelle psicologi ariete fulminacci",
  },
  TR: {
    today: "turkce pop yeni cikanlar hits official",
    pop: "turkce pop hits tarkan sezen aksu simge edis mabel matiz",
    hiphop: "turkce rap hip hop ezhel cezza sago lvbel c5 uzu",
    rnb: "turkce rnb alternatif mert demir melike sahin Emir can igrek",
    rock: "turkce rock duman mor ve otesi manga teoman sebnem ferah",
    dance: "turkce dance club hits mahmut orhan burak yeter",
    indie: "turkce indie alternatif adamlar buyuk ev ablukada dktt",
  },
  AE: {
    today: "arabic top hits 2025 new songs official",
    pop: "arabic pop hits amr diab nancy ajram elissa tamer hosny",
    hiphop: "arabic hip hop rap wegz marwan pablo afroto dafencii",
    rnb: "arabic chill rnb saint levant elyanna dana salah",
    rock: "arabic rock indie cairokee mashrou leila jadal",
    dance: "arabic dance party hits saad lamjarred mohamed ramadan",
    indie: "arabic indie alternative cairokee Aziz maraka massar egbari",
  },
  SA: {
    today: "khaleeji new hits saudi top songs official",
    pop: "khaleeji pop hits abdul majeed abdullah majid al mohandis assala",
    hiphop: "saudi arabic hip hop dafencii klash wegz official",
    rnb: "arabic rnb chill songs official audio",
    rock: "arabic rock indie cairokee jadal official",
    dance: "khaleeji dance party hits official",
    indie: "arabic indie alternative aziz maraka cairokee",
  },
  EG: {
    today: "egypt top hits aghani gadida official",
    pop: "egyptian pop hits amr diab tamer hosny sherine hamaki",
    hiphop: "egyptian rap trap mahraganat wegz marwan pablo afroto",
    rnb: "egyptian chill rnb songs official",
    rock: "egyptian rock indie cairokee massar egbari sharmoofers",
    dance: "mahraganat egyptian party hits mohamed ramadan hassan shakosh",
    indie: "egyptian indie cairokee massar egbari disco misr",
  },
  GB: {
    today: "official uk top 40 singles chart hits",
    pop: "uk pop hits dua lipa ed sheeran harry styles raye charli xcx",
    hiphop: "uk drill grime rap central cee dave stormzy skepta",
    rnb: "uk rnb soul raye jorja smith cleo sol mahalia",
    rock: "uk rock bands arctic monkeys oasis coldplay muse the 1975",
    dance: "uk dance house garage calvin harris Fred again disclosure",
    indie: "uk indie rock the 1975 sam fender wolf alice beabadoobee",
  },
  AU: {
    today: "aria charts australia top hits official",
    pop: "australian pop hits troye sivan the kid laroi sia kylie minogue",
    hiphop: "australian hip hop the kid laroi hilltop hoods onefour",
    rnb: "australian rnb ruel tkay maidza jordan rakei",
    rock: "australian rock tame impala acdc gang of youths powderfinger",
    dance: "australian electronic dance rufus du sol flume dom dolla fisher",
    indie: "australian indie spacey jane vance joy royel otis ocean alley",
  },
  NZ: {
    today: "new zealand top 40 hits official",
    pop: "new zealand pop hits lorde benee Kimbra",
    hiphop: "new zealand hip hop savage scribe",
    rnb: "new zealand rnb soul six60 l.a.b stan walker",
    rock: "new zealand rock crowded house six60 the naked and famous",
    dance: "new zealand electronic dance shapeshifter netsky",
    indie: "new zealand indie the beths unknown mortal orchestra fazerdaze",
  },
  CA: {
    today: "canada top hits billboard canadian hot 100",
    pop: "canadian pop hits the weeknd justin bieber tate mcrae shawn mendes",
    hiphop: "canadian hip hop drake nav tory lanez",
    rnb: "canadian rnb soul the weeknd daniel caesar partynextdoor",
    rock: "canadian rock nickelback sum 41 billy talent the tragically hip",
    dance: "canadian electronic deadmau5 kaytranada loud luxury rezz",
    indie: "canadian indie arcade fire alvvays men i trust mac demarco",
  },
  NL: {
    today: "nederlandse top 40 hits official",
    pop: "dutch pop hits roxy dekker flemming suzan & freek davina michelle",
    hiphop: "dutch hip hop boef lil kleine frenna josylvio",
    rnb: "dutch rnb soul rimon joya moo",
    rock: "dutch rock kensington within temptation golden earring",
    dance: "dutch edm dance martin garrix tiesto armin van buuren hardwell",
    indie: "dutch indie pip blom eut son mieux",
  },
  SE: {
    today: "sverigetopplistan sweden top hits official",
    pop: "swedish pop hits zara larsson tove lo robyn benjamin ingrosso",
    hiphop: "swedish hip hop einar hov1 c.gambino",
    rnb: "swedish rnb snoh aalegra cherrie seinabo sey",
    rock: "swedish rock ghost the hives kent mando diao",
    dance: "swedish house mafia avicii alesso galantis",
    indie: "swedish indie lykke li peter bjorn and john viagra boys",
  },
};

export function shelfQueryForCountry(id, gl, fallbackQuery = "") {
  const code = regionCode(gl);
  const byCountry = COUNTRY_SHELF_QUERIES[code];
  if (byCountry && byCountry[id]) return byCountry[id];
  const shelf = ENGLISH_SHELVES.find((s) => s.id === id);
  return (shelf && shelf.query) || fallbackQuery || "top hits official audio";
}

export const MOODS_BY_COUNTRY = {
  IN: [
    { id: "bollywood", title: "Bollywood Gold", query: "best bollywood songs official", color: "#ff4d6d", tags: "bollywood hindi arijit" },
    { id: "punjabi", title: "Punjabi Heat", query: "punjabi hits official audio", color: "#ffb703", tags: "punjabi sidhu diljit" },
    { id: "tamil", title: "Kollywood", query: "tamil hits official", color: "#fb8500", tags: "tamil kollywood" },
    { id: "telugu", title: "Tollywood", query: "telugu hits official", color: "#ff6b35", tags: "telugu tollywood" },
    { id: "indie", title: "Indie India", query: "indian indie songs", color: "#4cc9f0", tags: "indie india" },
    { id: "romance-in", title: "Hindi Romance", query: "romantic hindi songs arijit singh", color: "#ff6b9d", tags: "romance hindi arijit" },
  ],
  PK: [
    { id: "pakistan", title: "Pakistani Hits", query: "pakistan hits official", color: "#22c55e", tags: "pakistan urdu" },
    { id: "qawwali", title: "Qawwali", query: "qawwali nusrat official", color: "#a78bfa", tags: "qawwali sufi" },
  ],
  BD: [{ id: "bangla", title: "Bangla Hits", query: "bangla hits official", color: "#22c55e", tags: "bangla bangladesh" }],
  US: [
    { id: "us-pop", title: "US Pop", query: "usa top 40 official audio", color: "#60a5fa", tags: "pop usa" },
    { id: "rnb", title: "R&B", query: "rnb hits official audio", color: "#c084fc", tags: "rnb soul" },
    { id: "country", title: "Country", query: "country hits official audio", color: "#f59e0b", tags: "country" },
    { id: "latin-us", title: "Latin", query: "latin hits official audio", color: "#fb7185", tags: "latin reggaeton" },
  ],
  GB: [
    { id: "uk-pop", title: "UK Hits", query: "uk top 40 official audio", color: "#818cf8", tags: "uk pop" },
    { id: "drill", title: "UK Drill", query: "uk drill official audio", color: "#64748b", tags: "drill grime uk" },
  ],
  KR: [
    { id: "kpop", title: "K-Pop", query: "kpop hits official audio", color: "#f72585", tags: "kpop korea" },
    { id: "krnb", title: "K-R&B", query: "k rnb official audio", color: "#c084fc", tags: "krnb kpop" },
  ],
  JP: [
    { id: "jpop", title: "J-Pop", query: "jpop hits official", color: "#fb7185", tags: "jpop japan" },
    { id: "anime", title: "Anime", query: "anime openings official", color: "#38bdf8", tags: "anime jpop" },
  ],
  NG: [{ id: "afrobeats", title: "Afrobeats", query: "afrobeats hits official", color: "#f59e0b", tags: "afrobeats nigeria" }],
  ZA: [{ id: "amapiano", title: "Amapiano", query: "amapiano hits official", color: "#84cc16", tags: "amapiano south africa" }],
  BR: [
    { id: "brazil", title: "Brazil Hits", query: "brazil top hits official", color: "#22c55e", tags: "brazil funk" },
    { id: "sertanejo", title: "Sertanejo", query: "sertanejo oficial", color: "#eab308", tags: "sertanejo brazil" },
  ],
  MX: [{ id: "mexico", title: "México", query: "mexico hits official", color: "#f97316", tags: "mexico latin regional" }],
  DE: [{ id: "german", title: "German Hits", query: "deutsche charts official", color: "#fbbf24", tags: "german pop" }],
  FR: [{ id: "french", title: "French Hits", query: "france top hits official", color: "#60a5fa", tags: "french pop" }],
  TR: [{ id: "turkish", title: "Türkçe Pop", query: "turkce pop hits official", color: "#ef4444", tags: "turkish pop" }],
  PH: [{ id: "opm", title: "OPM", query: "opm hits official", color: "#22d3ee", tags: "opm philippines" }],
  TH: [{ id: "tpop", title: "T-Pop", query: "thai hits official", color: "#f472b6", tags: "thai tpop" }],
  VN: [{ id: "vpop", title: "V-Pop", query: "vpop hits official", color: "#34d399", tags: "vpop vietnam" }],
  ID: [{ id: "indo", title: "Indonesia", query: "indonesia hits official", color: "#fb7185", tags: "indonesia pop" }],
  AE: [{ id: "arabic", title: "Arabic Hits", query: "arabic hits official", color: "#fbbf24", tags: "arabic khaleeji" }],
  SA: [{ id: "khaleeji", title: "Khaleeji", query: "khaleeji hits official", color: "#22c55e", tags: "arabic khaleeji" }],
  EG: [{ id: "egypt", title: "Egypt Hits", query: "egypt hits official", color: "#f59e0b", tags: "arabic egypt" }],
  IT: [{ id: "italian", title: "Italia", query: "italy hits official", color: "#22c55e", tags: "italian pop" }],
  ES: [{ id: "spain", title: "España", query: "spain hits official", color: "#f97316", tags: "spanish latin" }],
  CN: [
    { id: "mandopop", title: "Mando Pop", query: "chinese mandopop hits official", color: "#f43f5e", tags: "chinese mandopop" },
    { id: "cpop", title: "C-Pop", query: "chinese pop hits official", color: "#fb7185", tags: "cpop china" },
  ],
  HK: [{ id: "cantopop", title: "Cantopop", query: "hong kong cantopop hits official", color: "#f59e0b", tags: "cantopop hong kong" }],
};

// "Made for you" curated playlists (server.js FY_QUERIES).
// EXACTLY 10, each a DIFFERENT mood, each tagged with `genres` (lowercase mood
// tags) so the client can reorder / personalise them by the user's taste
// profile. `query` is the English search that fills the playlist with the
// latest hits for that mood.
export const FY_QUERIES = [
  { mood: "pop",      genres: ["pop"],      title: "Pop Hits",       subtitle: "Top English pop, right now", query: "pop hits official audio" },
  { mood: "hiphop",   genres: ["hiphop"],   title: "Hip-Hop",        subtitle: "Fresh flows & new drops",      query: "hip hop rap hits official audio" },
  { mood: "rnb",      genres: ["rnb"],      title: "R&B",            subtitle: "Smooth grooves",               query: "rnb soul hits official audio" },
  { mood: "rock",     genres: ["rock"],     title: "Rock",           subtitle: "Earworms",                     query: "rock hits official audio" },
  { mood: "dance",    genres: ["dance"],    title: "Dance Hits",     subtitle: "Club-ready anthems",           query: "dance edm hits official audio" },
  { mood: "indie",    genres: ["indie"],    title: "Indie",          subtitle: "New discoveries",              query: "indie alternative hits official audio" },
  { mood: "trending", genres: ["trending"], title: "Trending",       subtitle: "What the world is playing",    query: "trending music hits" },
  { mood: "chill",    genres: ["chill"],    title: "Chill Vibes",    subtitle: "Easy listening, all day",      query: "chill vibes songs official audio" },
  { mood: "workout",  genres: ["workout"],  title: "Workout Energy", subtitle: "Push through the burn",        query: "workout motivation songs official audio" },
  { mood: "throwback", genres: ["throwback"], title: "Throwback",    subtitle: "90s & 2000s classics",        query: "throwback 90s 2000s hits official audio" },
];

// ISO Monday week key (YYYY-MM-DD) for deterministic weekly refresh of Made For You playlists.
export function utcWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMon);
  return d.toISOString().slice(0, 10);
}

export function weekSeedOffset(weekKey, salt = "") {
  const s = `${weekKey || utcWeekKey()}:${salt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

// Comprehensive per-playlist identity profiles for the 10 "Made for you" playlists.
// Each profile carries:
// - `weeklyQueries`: 4 artist/mood-specific search queries rotated weekly
// - `catalogQuery`: studio catalog search query (avoids generic keyword traps)
// - `coreArtists`: canonical artists defining this playlist's identity
// - `allowedGenres` / `disallowedGenres`: strict genre/mood coherence rules
// - `curatedSongs`: 24 disjoint, genuine songs per playlist (240 unique songs total across all 10)
export const FY_MOOD_PROFILES = {
  pop: {
    mood: "pop",
    title: "Pop Hits",
    subtitle: "Top English pop, right now",
    cover: "/covers/cover-pop.jpg",
    targetGenre: "pop",
    targetMood: "upbeat",
    targetTempo: "upbeat",
    targetEnergy: 0.74,
    targetStyle: "vocal",
    allowedGenres: ["pop", "dance", "rnb", "indie"],
    disallowedGenres: ["rock", "hiphop", "lofi"],
    weeklyQueries: [
      "Sabrina Carpenter Dua Lipa The Weeknd official audio",
      "Taylor Swift Ariana Grande Harry Styles official audio",
      "Olivia Rodrigo Tate McRae Bruno Mars official audio",
      "Billie Eilish Miley Cyrus Ed Sheeran Charlie Puth official audio",
    ],
    catalogQuery: "Sabrina Carpenter Dua Lipa The Weeknd Taylor Swift",
    coreArtists: [
      "Sabrina Carpenter", "The Weeknd", "Dua Lipa", "Taylor Swift", "Harry Styles",
      "Ariana Grande", "Olivia Rodrigo", "Tate McRae", "Miley Cyrus", "Ed Sheeran",
      "Charlie Puth", "Billie Eilish", "Bruno Mars", "Shawn Mendes", "Troye Sivan",
      "Justin Bieber", "Camila Cabello", "Selena Gomez", "Katy Perry", "Lady Gaga",
    ],
    curatedSongs: [
      ["Espresso", "Sabrina Carpenter", 175, "Short n' Sweet", "https://cdn-images.dzcdn.net/images/cover/e3221287a77eb262944e6528766eeba4/500x500-000000-80-0-0.jpg"],
      ["Blinding Lights", "The Weeknd", 200, "After Hours", "https://cdn-images.dzcdn.net/images/cover/fd00ebd6d30d7253f813dba3bb1c66a9/500x500-000000-80-0-0.jpg"],
      ["Levitating", "Dua Lipa", 203, "Future Nostalgia", "https://cdn-images.dzcdn.net/images/cover/f8364f090ba04f1b19b381ec0390f3e4/500x500-000000-80-0-0.jpg"],
      ["As It Was", "Harry Styles", 167, "Harry's House", "https://cdn-images.dzcdn.net/images/cover/b0e936124f59e669ddba02ebe5893f95/500x500-000000-80-0-0.jpg"],
      ["Cruel Summer", "Taylor Swift", 178, "Lover", "https://cdn-images.dzcdn.net/images/cover/6111c5ab9729c8eac47883e4e50e9cf8/500x500-000000-80-0-0.jpg"],
      ["we can't be friends (wait for your love)", "Ariana Grande", 228, "eternal sunshine", "https://cdn-images.dzcdn.net/images/cover/9349b2fcb4bd060060a33f054a619e83/500x500-000000-80-0-0.jpg"],
      ["vampire", "Olivia Rodrigo", 219, "GUTS", "https://cdn-images.dzcdn.net/images/cover/4bb79214365c0049e031f5e2caae4752/500x500-000000-80-0-0.jpg"],
      ["greedy", "Tate McRae", 131, "THINK LATER", "https://cdn-images.dzcdn.net/images/cover/ef25b6bec265332a059879f45d33cd7e/500x500-000000-80-0-0.jpg"],
      ["Flowers", "Miley Cyrus", 200, "Endless Summer Vacation", "https://cdn-images.dzcdn.net/images/cover/98610629a40996b61b3d24bd5ab8c2e1/500x500-000000-80-0-0.jpg"],
      ["Shape of You", "Ed Sheeran", 233, "÷ (Divide)", "https://cdn-images.dzcdn.net/images/cover/107c2b43f10c249077c1f7618563bb63/500x500-000000-80-0-0.jpg"],
      ["Attention", "Charlie Puth", 208, "Voicenotes", "https://cdn-images.dzcdn.net/images/cover/da7eb4c99604b2fda5f123aba3897850/500x500-000000-80-0-0.jpg"],
      ["Bad Guy", "Billie Eilish", 194, "WHEN WE ALL FALL ASLEEP, WHERE DO WE GO?", "https://cdn-images.dzcdn.net/images/cover/6630083f454d48eadb6a9b53f035d734/500x500-000000-80-0-0.jpg"],
      ["24K Magic", "Bruno Mars", 226, "24K Magic", "https://cdn-images.dzcdn.net/images/cover/012b27906b430a37ec1d8f793d5c4fa6/500x500-000000-80-0-0.jpg"],
      ["Anti-Hero", "Taylor Swift", 200, "Midnights", "https://cdn-images.dzcdn.net/images/cover/f571cb780b339ec087201b1cea53c3d9/500x500-000000-80-0-0.jpg"],
      ["Watermelon Sugar", "Harry Styles", 174, "Fine Line", "https://cdn-images.dzcdn.net/images/cover/346c524c15ecccbc4a8a78e8972a352c/500x500-000000-80-0-0.jpg"],
      ["Please Please Please", "Sabrina Carpenter", 186, "Short n' Sweet", "https://cdn-images.dzcdn.net/images/cover/0fd6e3b346b959a8781ccfa89b63607a/500x500-000000-80-0-0.jpg"],
      ["Save Your Tears", "The Weeknd", 215, "After Hours", "https://cdn-images.dzcdn.net/images/cover/fd00ebd6d30d7253f813dba3bb1c66a9/500x500-000000-80-0-0.jpg"],
      ["Houdini", "Dua Lipa", 185, "Radical Optimism", "https://cdn-images.dzcdn.net/images/cover/12c05200e9097af48e0ad4fc259cee25/500x500-000000-80-0-0.jpg"],
      ["Into You", "Ariana Grande", 244, "Dangerous Woman", "https://cdn-images.dzcdn.net/images/cover/1a8f399e9ddbb8ec2530232c0dfd953f/500x500-000000-80-0-0.jpg"],
      ["deja vu", "Olivia Rodrigo", 215, "SOUR", "https://cdn-images.dzcdn.net/images/cover/e68da86fd7976135c2d2d1715afaef7c/500x500-000000-80-0-0.jpg"],
      ["Shivers", "Ed Sheeran", 207, "= (Equals)", "https://cdn-images.dzcdn.net/images/cover/82f1bc61739e54407f05674256747ae4/500x500-000000-80-0-0.jpg"],
      ["Stay", "The Kid LAROI & Justin Bieber", 141, "F*CK LOVE 3", "https://cdn-images.dzcdn.net/images/cover/dd6fe7fa9267185c4b835bd4f155d1d2/500x500-000000-80-0-0.jpg"],
      ["There's Nothing Holdin' Me Back", "Shawn Mendes", 199, "Illuminate", "https://cdn-images.dzcdn.net/images/cover/35d5f7dd0b398bb37287b3454f0b05b9/500x500-000000-80-0-0.jpg"],
      ["Rush", "Troye Sivan", 156, "Something to Give Each Other", "https://cdn-images.dzcdn.net/images/cover/025b8f193e9cb37b15c857956938ae4f/500x500-000000-80-0-0.jpg"],
    ],
  },
  hiphop: {
    mood: "hiphop",
    title: "Hip-Hop",
    subtitle: "Fresh flows & new drops",
    cover: "/covers/cover-hiphop.jpg",
    targetGenre: "hiphop",
    targetMood: "upbeat",
    targetTempo: "upbeat",
    targetEnergy: 0.80,
    targetStyle: "rhythmic",
    allowedGenres: ["hiphop", "rnb"],
    disallowedGenres: ["rock", "indie", "country", "lofi"],
    weeklyQueries: [
      "Kendrick Lamar Drake Travis Scott Future official audio",
      "J. Cole 21 Savage Metro Boomin Don Toliver official audio",
      "Tyler The Creator A$AP Rocky Gunna Baby Keem official audio",
      "Central Cee Jack Harlow Lil Uzi Vert JID official audio",
    ],
    catalogQuery: "Kendrick Lamar Travis Scott Drake Future J. Cole",
    coreArtists: [
      "Kendrick Lamar", "Travis Scott", "Drake", "Future", "Metro Boomin",
      "J. Cole", "21 Savage", "Tyler, The Creator", "A$AP Rocky", "Central Cee",
      "Jack Harlow", "Don Toliver", "Gunna", "Baby Keem", "Lil Uzi Vert",
      "Post Malone", "JID", "Lil Baby", "Kanye West", "Eminem", "Nicki Minaj", "Cardi B",
    ],
    curatedSongs: [
      ["Not Like Us", "Kendrick Lamar", 274, "Not Like Us", "https://cdn-images.dzcdn.net/images/cover/84345d29bc2ed8e713112425f8417e97/500x500-000000-80-0-0.jpg"],
      ["Sicko Mode", "Travis Scott", 312, "ASTROWORLD", "https://cdn-images.dzcdn.net/images/cover/b6fcb2355d00296ca037f17ed3463b40/500x500-000000-80-0-0.jpg"],
      ["God's Plan", "Drake", 198, "Scorpion", "https://cdn-images.dzcdn.net/images/cover/b69d3bcbd130ad4cc9259de543889e30/500x500-000000-80-0-0.jpg"],
      ["Like That", "Future, Metro Boomin & Kendrick Lamar", 267, "WE DON'T TRUST YOU", "https://cdn-images.dzcdn.net/images/cover/2d20cf6d65607e406213afbb3b62ce0d/500x500-000000-80-0-0.jpg"],
      ["No Role Modelz", "J. Cole", 292, "2014 Forest Hills Drive", "https://cdn-images.dzcdn.net/images/cover/f45c8916970597d390313833a9db0c61/500x500-000000-80-0-0.jpg"],
      ["redrum", "21 Savage", 270, "american dream", "https://cdn-images.dzcdn.net/images/cover/d1efd9562706fbc4facf4e86cbe78be4/500x500-000000-80-0-0.jpg"],
      ["FE!N", "Travis Scott", 191, "UTOPIA", "https://cdn-images.dzcdn.net/images/cover/6d7164fecb39ddee0cb15952e750d907/500x500-000000-80-0-0.jpg"],
      ["Superhero (Heroes & Villains)", "Metro Boomin & Future", 182, "HEROES & VILLAINS", "https://cdn-images.dzcdn.net/images/cover/862ab860ff69c30deeb5979db6e46b62/500x500-000000-80-0-0.jpg"],
      ["EARFQUAKE", "Tyler, The Creator", 190, "IGOR", "https://cdn-images.dzcdn.net/images/cover/041ab5ceb6fb6ebf9512966835be9e1b/500x500-000000-80-0-0.jpg"],
      ["Praise The Lord (Da Shine)", "A$AP Rocky", 205, "TESTING", "https://cdn-images.dzcdn.net/images/cover/f3b412a4f69c59dfb46583a93995f565/500x500-000000-80-0-0.jpg"],
      ["Sprinter", "Dave & Central Cee", 229, "Split Decision", "https://cdn-images.dzcdn.net/images/cover/d8cd79f825f1a87ec86443c934556df7/500x500-000000-80-0-0.jpg"],
      ["Lovin On Me", "Jack Harlow", 138, "Lovin On Me", "https://cdn-images.dzcdn.net/images/cover/6d4d4cbd4990a644a184b5f64ee01ebf/500x500-000000-80-0-0.jpg"],
      ["Bandit", "Don Toliver", 147, "Hardstone Psycho", "https://cdn-images.dzcdn.net/images/cover/bd7465c9bc2e952c83c7f168579aefcb/500x500-000000-80-0-0.jpg"],
      ["fukumean", "Gunna", 125, "a Gift & a Curse", "https://cdn-images.dzcdn.net/images/cover/35446b14e181f0a3fe415c06fec08d0b/500x500-000000-80-0-0.jpg"],
      ["Family Ties", "Baby Keem & Kendrick Lamar", 252, "The Melodic Blue", "https://cdn-images.dzcdn.net/images/cover/0681d0925e8463d1e7ad2377793cea81/500x500-000000-80-0-0.jpg"],
      ["First Person Shooter", "Drake & J. Cole", 247, "For All The Dogs", "https://cdn-images.dzcdn.net/images/cover/868162e87da67d647789ed7b6456840c/500x500-000000-80-0-0.jpg"],
      ["XO Tour Llif3", "Lil Uzi Vert", 182, "Luv Is Rage 2", "https://cdn-images.dzcdn.net/images/cover/77d464b429890070fecdf853bbe426ff/500x500-000000-80-0-0.jpg"],
      ["Mask Off", "Future", 204, "FUTURE", "https://cdn-images.dzcdn.net/images/cover/5186078c5bd5623ebec9b2753d8aaebe/500x500-000000-80-0-0.jpg"],
      ["Rockstar", "Post Malone", 218, "beerbongs & bentleys", "https://cdn-images.dzcdn.net/images/cover/c000a4d39f31f3716bf3f11aa5fab080/500x500-000000-80-0-0.jpg"],
      ["Surround Sound", "JID", 229, "The Forever Story", "https://cdn-images.dzcdn.net/images/cover/52c49df999ccf2844238672acccf2b7b/500x500-000000-80-0-0.jpg"],
      ["Money Trees", "Kendrick Lamar", 386, "good kid, m.A.A.d city", "https://cdn-images.dzcdn.net/images/cover/b5be27644d505bad7bdb516fe4165475/500x500-000000-80-0-0.jpg"],
      ["Drip Too Hard", "Lil Baby & Gunna", 145, "Drip Harder", "https://cdn-images.dzcdn.net/images/cover/3d845a35fd7849630324107baf07657b/500x500-000000-80-0-0.jpg"],
      ["Middle Child", "J. Cole", 213, "Revenge of the Dreamers III", "https://cdn-images.dzcdn.net/images/cover/9a0366a17a65c8479901b292a4077507/500x500-000000-80-0-0.jpg"],
      ["See You Again", "Tyler, The Creator", 180, "Flower Boy", "https://cdn-images.dzcdn.net/images/cover/a7a16b8f63b1ec0e9fbd327619966737/500x500-000000-80-0-0.jpg"],
    ],
  },
  rnb: {
    mood: "rnb",
    title: "R&B",
    subtitle: "Smooth grooves",
    cover: "/covers/cover-rnb.jpg",
    targetGenre: "rnb",
    targetMood: "chill",
    targetTempo: "mid",
    targetEnergy: 0.56,
    targetStyle: "vocal",
    allowedGenres: ["rnb", "pop", "indie"],
    disallowedGenres: ["rock", "dance", "country"],
    weeklyQueries: [
      "SZA Daniel Caesar Brent Faiyaz Summer Walker official audio",
      "Frank Ocean Giveon H.E.R. Bryson Tiller official audio",
      "Silk Sonic Miguel Kehlani Snoh Aalegra official audio",
      "Victoria Monet Jhene Aiko Lucky Daye PARTYNEXTDOOR official audio",
    ],
    catalogQuery: "SZA Daniel Caesar Brent Faiyaz Frank Ocean Giveon",
    coreArtists: [
      "SZA", "Frank Ocean", "Daniel Caesar", "Silk Sonic", "Giveon",
      "Brent Faiyaz", "Summer Walker", "Bryson Tiller", "Miguel", "Kehlani",
      "Victoria Monét", "Snoh Aalegra", "Jhené Aiko", "The Weeknd", "H.E.R.",
      "PARTYNEXTDOOR", "Lucky Daye", "Ella Mai", "Tems", "Khalid", "Anderson .Paak",
    ],
    curatedSongs: [
      ["Snooze", "SZA", 201, "SOS", "https://cdn-images.dzcdn.net/images/cover/328d68300e654b21831b261e413780e0/500x500-000000-80-0-0.jpg"],
      ["Pink + White", "Frank Ocean", 184, "Blonde", "https://cdn-images.dzcdn.net/images/cover/f798a866107715dd6dc1049e498ce21f/500x500-000000-80-0-0.jpg"],
      ["Best Part", "Daniel Caesar & H.E.R.", 209, "Freudian", "https://cdn-images.dzcdn.net/images/cover/4dff56488d13d0b5e96d93d895c9624b/500x500-000000-80-0-0.jpg"],
      ["Leave The Door Open", "Silk Sonic", 242, "An Evening With Silk Sonic", "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/c5/33/dc/c533dc8e-2baa-94f9-22be-e6e28945f932/075679754134.jpg/500x500bb.jpg"],
      ["Heartbreak Anniversary", "Giveon", 198, "When It's All Said And Done", "https://cdn-images.dzcdn.net/images/cover/5db10a9a3170871f3f4f9bbd01029b9a/500x500-000000-80-0-0.jpg"],
      ["Gravity", "Brent Faiyaz", 214, "Wasteland", "https://cdn-images.dzcdn.net/images/cover/51d0d130671262611c927bd63c192670/500x500-000000-80-0-0.jpg"],
      ["Girls Need Love", "Summer Walker", 142, "Last Day of Summer", "https://cdn-images.dzcdn.net/images/cover/4ba5878f51f5aa6f1995b2ba72878f0a/500x500-000000-80-0-0.jpg"],
      ["Exchange", "Bryson Tiller", 194, "T R A P S O U L", "https://cdn-images.dzcdn.net/images/cover/adde8485c3484a602f8f8a51d954b4ba/500x500-000000-80-0-0.jpg"],
      ["Kill Bill", "SZA", 153, "SOS", "https://cdn-images.dzcdn.net/images/cover/328d68300e654b21831b261e413780e0/500x500-000000-80-0-0.jpg"],
      ["Sure Thing", "Miguel", 195, "All I Want Is You", "https://cdn-images.dzcdn.net/images/cover/23f94611c678b0c16b2a8336fa420e3f/500x500-000000-80-0-0.jpg"],
      ["Nights Like This", "Kehlani", 201, "While We Wait", "https://cdn-images.dzcdn.net/images/cover/38f53c7ad2ef060d90f500a597e0f2f5/500x500-000000-80-0-0.jpg"],
      ["On My Mama", "Victoria Monét", 186, "JAGUAR II", "https://cdn-images.dzcdn.net/images/cover/2c64ab2309b86a1c96896193ac833c40/500x500-000000-80-0-0.jpg"],
      ["I Want You Around", "Snoh Aalegra", 232, "Ugh, those feels again", "https://cdn-images.dzcdn.net/images/cover/45579005ac5285cb351e5e7414267f82/500x500-000000-80-0-0.jpg"],
      ["Sativa", "Jhené Aiko", 276, "Trip", "https://cdn-images.dzcdn.net/images/cover/ad84a421d7190381989ea7a04f897381/500x500-000000-80-0-0.jpg"],
      ["Die For You", "The Weeknd", 260, "Starboy", "https://cdn-images.dzcdn.net/images/cover/134778e4c4f19ea71c82408300925a9a/500x500-000000-80-0-0.jpg"],
      ["Get You", "Daniel Caesar", 278, "Freudian", "https://cdn-images.dzcdn.net/images/cover/282e45bef1995c2c6f2901e34c4ab560/500x500-000000-80-0-0.jpg"],
      ["Focus", "H.E.R.", 200, "H.E.R.", "https://cdn-images.dzcdn.net/images/cover/4dff56488d13d0b5e96d93d895c9624b/500x500-000000-80-0-0.jpg"],
      ["Break from Toronto", "PARTYNEXTDOOR", 99, "PARTYNEXTDOOR", "https://cdn-images.dzcdn.net/images/cover/3046cd9e199255a7c9f64bf0f1cb246e/500x500-000000-80-0-0.jpg"],
      ["Over", "Lucky Daye", 212, "Candydrip", "https://cdn-images.dzcdn.net/images/cover/e66715b17e490fea982b66506d3a33b8/500x500-000000-80-0-0.jpg"],
      ["Boo'd Up", "Ella Mai", 256, "Ella Mai", "https://cdn-images.dzcdn.net/images/cover/9747893d144d612424ec129b71648bb0/500x500-000000-80-0-0.jpg"],
      ["Free Mind", "Tems", 247, "For Broken Ears", "https://cdn-images.dzcdn.net/images/cover/53e9db9663c87b34723c17bcf9c2a8e8/500x500-000000-80-0-0.jpg"],
      ["Talk", "Khalid", 197, "Free Spirit", "https://cdn-images.dzcdn.net/images/cover/f350b1fd2563c5f582d10914f8cbbe42/500x500-000000-80-0-0.jpg"],
      ["Thinkin Bout You", "Frank Ocean", 200, "channel ORANGE", "https://cdn-images.dzcdn.net/images/cover/e545e4c96ae929e8cce56808afd7756f/500x500-000000-80-0-0.jpg"],
      ["Good Days", "SZA", 279, "SOS", "https://cdn-images.dzcdn.net/images/cover/8aafccd5fc82acdebc88372bd1bef371/500x500-000000-80-0-0.jpg"],
    ],
  },
  rock: {
    mood: "rock",
    title: "Rock",
    subtitle: "Earworms",
    cover: "/covers/cover-rock.jpg",
    targetGenre: "rock",
    targetMood: "feelgood",
    targetTempo: "upbeat",
    targetEnergy: 0.78,
    targetStyle: "band",
    allowedGenres: ["rock", "indie"],
    disallowedGenres: ["hiphop", "rnb", "dance", "lofi"],
    weeklyQueries: [
      "Arctic Monkeys The Killers Foo Fighters Muse official audio",
      "Linkin Park Nirvana Green Day Red Hot Chili Peppers official audio",
      "The Strokes Paramore Kings of Leon Franz Ferdinand official audio",
      "Fleetwood Mac Radiohead The Black Keys Oasis official audio",
    ],
    catalogQuery: "Arctic Monkeys The Killers Foo Fighters Linkin Park Nirvana",
    coreArtists: [
      "Arctic Monkeys", "The Killers", "Foo Fighters", "Linkin Park", "Nirvana",
      "The White Stripes", "Green Day", "Red Hot Chili Peppers", "Muse", "The Strokes",
      "Paramore", "Kings of Leon", "Franz Ferdinand", "Fleetwood Mac", "Radiohead",
      "The Black Keys", "Twenty One Pilots", "Oasis", "Coldplay", "Queen",
    ],
    curatedSongs: [
      ["Do I Wanna Know?", "Arctic Monkeys", 272, "AM", "https://cdn-images.dzcdn.net/images/cover/64e54e307bd5e2bdb27ffeb662fd910d/500x500-000000-80-0-0.jpg"],
      ["Mr. Brightside", "The Killers", 222, "Hot Fuss", "https://cdn-images.dzcdn.net/images/cover/64e54e307bd5e2bdb27ffeb662fd910d/500x500-000000-80-0-0.jpg"],
      ["Everlong", "Foo Fighters", 250, "The Colour and the Shape", "https://cdn-images.dzcdn.net/images/cover/266f01f1c7a04843d11cd08f9c07d11f/500x500-000000-80-0-0.jpg"],
      ["In the End", "Linkin Park", 216, "Hybrid Theory", "https://cdn-images.dzcdn.net/images/cover/033a271b5ec10842c287827c39244fb5/500x500-000000-80-0-0.jpg"],
      ["Smells Like Teen Spirit", "Nirvana", 301, "Nevermind", "https://cdn-images.dzcdn.net/images/cover/f0282817b697279e56df13909962a54a/500x500-000000-80-0-0.jpg"],
      ["Seven Nation Army", "The White Stripes", 231, "Elephant", "https://cdn-images.dzcdn.net/images/cover/ed0929a4c44d77c4dc524a10748fc2f6/500x500-000000-80-0-0.jpg"],
      ["Boulevard of Broken Dreams", "Green Day", 260, "American Idiot", "https://cdn-images.dzcdn.net/images/cover/4a2497e819405074b107b3bce1d95cf9/500x500-000000-80-0-0.jpg"],
      ["Californication", "Red Hot Chili Peppers", 329, "Californication", "https://cdn-images.dzcdn.net/images/cover/5e61e8290a4d1d64ca58920656c9602d/500x500-000000-80-0-0.jpg"],
      ["Supermassive Black Hole", "Muse", 209, "Black Holes and Revelations", "https://cdn-images.dzcdn.net/images/cover/9169b09a2a789322d00b9a616a9f36b5/500x500-000000-80-0-0.jpg"],
      ["The Adults Are Talking", "The Strokes", 309, "The New Abnormal", "https://cdn-images.dzcdn.net/images/cover/523ac3e61759f365b9306fc44dd53eea/500x500-000000-80-0-0.jpg"],
      ["Misery Business", "Paramore", 211, "Riot!", "https://cdn-images.dzcdn.net/images/cover/1a48b36fe9dd29b2bef2f5058cbe0c25/500x500-000000-80-0-0.jpg"],
      ["Sex on Fire", "Kings of Leon", 203, "Only by the Night", "https://cdn-images.dzcdn.net/images/cover/a4d41f829fac22196b44e97824ee9180/500x500-000000-80-0-0.jpg"],
      ["Take Me Out", "Franz Ferdinand", 237, "Franz Ferdinand", "https://cdn-images.dzcdn.net/images/cover/f274cdbda80d97a785e001848378dd29/500x500-000000-80-0-0.jpg"],
      ["Dreams", "Fleetwood Mac", 257, "Rumours", "https://cdn-images.dzcdn.net/images/cover/9732751ce91d786dcf30069853697078/500x500-000000-80-0-0.jpg"],
      ["Creep", "Radiohead", 238, "Pablo Honey", "https://cdn-images.dzcdn.net/images/cover/1dd56fd8824492e1a5106c99a00a85ec/500x500-000000-80-0-0.jpg"],
      ["Lonely Boy", "The Black Keys", 193, "El Camino", "https://cdn-images.dzcdn.net/images/cover/f1e189eb93b8508d102931bcd9293ce8/500x500-000000-80-0-0.jpg"],
      ["Stressed Out", "Twenty One Pilots", 202, "Blurryface", "https://cdn-images.dzcdn.net/images/cover/dbbde1014cda9b101412a8e27add0ad2/500x500-000000-80-0-0.jpg"],
      ["Don't Look Back in Anger", "Oasis", 288, "(What's the Story) Morning Glory?", "https://cdn-images.dzcdn.net/images/cover/c607d5443ca9db2ae550f2081a3904e6/500x500-000000-80-0-0.jpg"],
      ["Yellow", "Coldplay", 266, "Parachutes", "https://cdn-images.dzcdn.net/images/cover/970dce98eeea6729244c0ae71707a83d/500x500-000000-80-0-0.jpg"],
      ["R U Mine?", "Arctic Monkeys", 201, "AM", "https://cdn-images.dzcdn.net/images/cover/64e54e307bd5e2bdb27ffeb662fd910d/500x500-000000-80-0-0.jpg"],
      ["Numb", "Linkin Park", 187, "Meteora", "https://cdn-images.dzcdn.net/images/cover/44df4f6fb2534768f4924365c103d0f7/500x500-000000-80-0-0.jpg"],
      ["Somebody Told Me", "The Killers", 197, "Hot Fuss", "https://cdn-images.dzcdn.net/images/cover/38bb1c3329d465a3e6d4ebfe579df121/500x500-000000-80-0-0.jpg"],
      ["The Pretender", "Foo Fighters", 269, "Echoes, Silence, Patience & Grace", "https://cdn-images.dzcdn.net/images/cover/266f01f1c7a04843d11cd08f9c07d11f/500x500-000000-80-0-0.jpg"],
      ["Under the Bridge", "Red Hot Chili Peppers", 264, "Blood Sugar Sex Magik", "https://cdn-images.dzcdn.net/images/cover/e3f1bee87b1d5d1313641762f375a3fb/500x500-000000-80-0-0.jpg"],
    ],
  },
  dance: {
    mood: "dance",
    title: "Dance Hits",
    subtitle: "Club-ready anthems",
    cover: "/covers/cover-dance.jpg",
    targetGenre: "dance",
    targetMood: "party",
    targetTempo: "fast",
    targetEnergy: 0.86,
    targetStyle: "electronic",
    allowedGenres: ["dance", "pop"],
    disallowedGenres: ["rock", "lofi", "country"],
    weeklyQueries: [
      "Calvin Harris Avicii David Guetta Tiesto official audio",
      "Fred again Disclosure Peggy Gou Dom Dolla official audio",
      "Swedish House Mafia Zedd Martin Garrix Kygo official audio",
      "Daft Punk Rufus Du Sol MEDUZA Galantis Alesso official audio",
    ],
    catalogQuery: "Calvin Harris Avicii David Guetta Tiesto Disclosure",
    coreArtists: [
      "Calvin Harris", "Avicii", "David Guetta", "Tiësto", "Fred again..",
      "Disclosure", "Swedish House Mafia", "Zedd", "Martin Garrix", "Kygo",
      "Daft Punk", "Peggy Gou", "Dom Dolla", "RÜFÜS DU SOL", "MEDUZA",
      "Galantis", "Alesso", "Clean Bandit", "Joel Corry", "FISHER", "The Chainsmokers",
    ],
    curatedSongs: [
      ["One Kiss", "Calvin Harris & Dua Lipa", 214, "One Kiss", "https://cdn-images.dzcdn.net/images/cover/0397baea24f861db7ee63fb1c70391f9/500x500-000000-80-0-0.jpg"],
      ["Wake Me Up", "Avicii", 247, "True", "https://cdn-images.dzcdn.net/images/cover/ec97306735b46ec334e0ce562290775b/500x500-000000-80-0-0.jpg"],
      ["Titanium", "David Guetta feat. Sia", 245, "Nothing but the Beat", "https://cdn-images.dzcdn.net/images/cover/52330286cb5008805253fd77c7111d3f/500x500-000000-80-0-0.jpg"],
      ["The Business", "Tiësto", 164, "The London Sessions", "https://cdn-images.dzcdn.net/images/cover/664cd2e671f05f3f8f1e0bbd710e082d/500x500-000000-80-0-0.jpg"],
      ["Delilah (pull me out of this)", "Fred again..", 250, "Actual Life 3", "https://cdn-images.dzcdn.net/images/cover/4417f9908f6657064dd554e8b64bcf2d/500x500-000000-80-0-0.jpg"],
      ["Latch", "Disclosure feat. Sam Smith", 256, "Settle", "https://cdn-images.dzcdn.net/images/cover/e44468007c45f2523d056a0b19eed80a/500x500-000000-80-0-0.jpg"],
      ["Don't You Worry Child", "Swedish House Mafia", 212, "Until Now", "https://cdn-images.dzcdn.net/images/cover/a6e59fada64940a751de6eaa01229e8b/500x500-000000-80-0-0.jpg"],
      ["Clarity", "Zedd feat. Foxes", 271, "Clarity", "https://cdn-images.dzcdn.net/images/cover/6b8a51cd4d5e2a277c8a1c4f88d59489/500x500-000000-80-0-0.jpg"],
      ["Scared to Be Lonely", "Martin Garrix & Dua Lipa", 220, "Scared to Be Lonely", "https://cdn-images.dzcdn.net/images/cover/8e6e0c8973442986572a2e8a5492fdd9/500x500-000000-80-0-0.jpg"],
      ["Firestone", "Kygo feat. Conrad Sewell", 273, "Cloud Nine", "https://cdn-images.dzcdn.net/images/cover/28a8beab24b92bcbbd1e80df83c4bd24/500x500-000000-80-0-0.jpg"],
      ["One More Time", "Daft Punk", 320, "Discovery", "https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/500x500-000000-80-0-0.jpg"],
      ["(It Goes Like) Nanana", "Peggy Gou", 231, "I Hear You", "https://cdn-images.dzcdn.net/images/cover/da81d86b3bc191357af8f86da1ad2751/500x500-000000-80-0-0.jpg"],
      ["Rhyme Dust", "MK & Dom Dolla", 180, "Rhyme Dust", "https://cdn-images.dzcdn.net/images/cover/4ef99be8f99decc23a9e2bd2b3c891e6/500x500-000000-80-0-0.jpg"],
      ["Innerbloom", "RÜFÜS DU SOL", 238, "Bloom", "https://cdn-images.dzcdn.net/images/cover/b3e3bc9f13817bd7878fb69831a4c307/500x500-000000-80-0-0.jpg"],
      ["Piece Of Your Heart", "MEDUZA", 152, "Piece Of Your Heart", "https://cdn-images.dzcdn.net/images/cover/2aa3a5de3aef945681ee002d3dbde756/500x500-000000-80-0-0.jpg"],
      ["Runaway (U & I)", "Galantis", 227, "Pharmacy", "https://cdn-images.dzcdn.net/images/cover/e26d05cc4a80b07bcb4182bb598eae9d/500x500-000000-80-0-0.jpg"],
      ["Heroes (we could be)", "Alesso feat. Tove Lo", 210, "Forever", "https://cdn-images.dzcdn.net/images/cover/3a436fc1dfb085581043417e1db3caad/500x500-000000-80-0-0.jpg"],
      ["Rather Be", "Clean Bandit feat. Jess Glynne", 227, "New Eyes", "https://cdn-images.dzcdn.net/images/cover/3193132d50c74a62d1cd419fa170139a/500x500-000000-80-0-0.jpg"],
      ["Head & Heart", "Joel Corry & MNEK", 166, "Head & Heart", "https://cdn-images.dzcdn.net/images/cover/6c30daf87841ac1c27a67b7ab4ba255d/500x500-000000-80-0-0.jpg"],
      ["Lose Control", "MEDUZA, Becky Hill & Goodboys", 168, "Lose Control", "https://cdn-images.dzcdn.net/images/cover/453595cce92efa85b6cade031f59cad6/500x500-000000-80-0-0.jpg"],
      ["Summer", "Calvin Harris", 222, "Motion", "https://cdn-images.dzcdn.net/images/cover/a72e5db10e9168cd6f5065fbe750cdbb/500x500-000000-80-0-0.jpg"],
      ["Levels", "Avicii", 199, "Levels", "https://cdn-images.dzcdn.net/images/cover/30bc3d8c348ddddb00c44f28d3120ac5/500x500-000000-80-0-0.jpg"],
      ["Moth To A Flame", "Swedish House Mafia & The Weeknd", 234, "Paradise Again", "https://cdn-images.dzcdn.net/images/cover/9bd2f0768b8b53cb3338f546526796ec/500x500-000000-80-0-0.jpg"],
      ["Losing It", "FISHER", 248, "Losing It", "https://cdn-images.dzcdn.net/images/cover/ebac3c7a4baff91f789cfdf053a11938/500x500-000000-80-0-0.jpg"],
    ],
  },
  indie: {
    mood: "indie",
    title: "Indie",
    subtitle: "New discoveries",
    cover: "/covers/cover-indie.jpg",
    targetGenre: "indie",
    targetMood: "chill",
    targetTempo: "mid",
    targetEnergy: 0.55,
    targetStyle: "acoustic",
    allowedGenres: ["indie", "rock", "pop"],
    disallowedGenres: ["hiphop", "dance"],
    weeklyQueries: [
      "Tame Impala The 1975 Glass Animals Clairo official audio",
      "Lana Del Rey Phoebe Bridgers Mitski Men I Trust official audio",
      "Mac DeMarco Wallows Cage the Elephant MGMT official audio",
      "Florence The Machine Lorde Vampire Weekend Beach House official audio",
    ],
    catalogQuery: "Tame Impala The 1975 Glass Animals Lana Del Rey Clairo",
    coreArtists: [
      "Tame Impala", "The 1975", "Glass Animals", "Clairo", "The Neighbourhood",
      "Lana Del Rey", "Phoebe Bridgers", "Mitski", "Men I Trust", "Mac DeMarco",
      "Wallows", "Cage the Elephant", "MGMT", "Florence + The Machine", "Lorde",
      "Vampire Weekend", "beabadoobee", "Beach House", "Empire of the Sun", "Dayglow", "Vance Joy", "Foster the People", "Bon Iver",
    ],
    curatedSongs: [
      ["The Less I Know The Better", "Tame Impala", 216, "Currents", "https://cdn-images.dzcdn.net/images/cover/de5b9b704cd4ec36f8bf49beb3e17ba2/500x500-000000-80-0-0.jpg"],
      ["Somebody Else", "The 1975", 347, "I Like It When You Sleep", "https://cdn-images.dzcdn.net/images/cover/97ab544fb96d693e44adb0cabda14e43/500x500-000000-80-0-0.jpg"],
      ["Heat Waves", "Glass Animals", 238, "Dreamland", "https://cdn-images.dzcdn.net/images/cover/04ea51c6eb90a6208f2e47da861cf1a5/500x500-000000-80-0-0.jpg"],
      ["Sofia", "Clairo", 188, "Immunity", "https://cdn-images.dzcdn.net/images/cover/ce9daf5b5d41cf2c8e1076b2a1e07787/500x500-000000-80-0-0.jpg"],
      ["Sweater Weather", "The Neighbourhood", 240, "I Love You.", "https://cdn-images.dzcdn.net/images/cover/521126388e95a1ad2cde7d0a3854cf3d/500x500-000000-80-0-0.jpg"],
      ["West Coast", "Lana Del Rey", 256, "Ultraviolence", "https://cdn-images.dzcdn.net/images/cover/b68adb6788dfa09a314f594aec287850/500x500-000000-80-0-0.jpg"],
      ["Motion Sickness", "Phoebe Bridgers", 229, "Stranger in the Alps", "https://cdn-images.dzcdn.net/images/cover/effa6216edf21cfefd5332a2899c6ec0/500x500-000000-80-0-0.jpg"],
      ["My Love Mine All Mine", "Mitski", 137, "The Land Is Inhospitable and So Are We", "https://cdn-images.dzcdn.net/images/cover/db69f7d3ea280f1155256705735648cd/500x500-000000-80-0-0.jpg"],
      ["Show Me How", "Men I Trust", 215, "Oncle Jazz", "https://cdn-images.dzcdn.net/images/cover/6f4f35fdc77ef818f0e0e29211cac77f/500x500-000000-80-0-0.jpg"],
      ["Chamber Of Reflection", "Mac DeMarco", 231, "Salad Days", "https://cdn-images.dzcdn.net/images/cover/fc8f82cf0eba7408386e365e538df8b2/500x500-000000-80-0-0.jpg"],
      ["Are You Bored Yet?", "Wallows feat. Clairo", 178, "Nothing Happens", "https://cdn-images.dzcdn.net/images/cover/e8d0adbc15a2bba2350ad40022733418/500x500-000000-80-0-0.jpg"],
      ["Cigarette Daydreams", "Cage the Elephant", 208, "Melophobia", "https://cdn-images.dzcdn.net/images/cover/fb29ac1b15d07f8c9d70003a9262fd14/500x500-000000-80-0-0.jpg"],
      ["Electric Feel", "MGMT", 229, "Oracular Spectacular", "https://cdn-images.dzcdn.net/images/cover/751372bcbd63a38e6ec6ef8bd448d687/500x500-000000-80-0-0.jpg"],
      ["Dog Days Are Over", "Florence + The Machine", 252, "Lungs", "https://cdn-images.dzcdn.net/images/cover/e4975860d7e182195ec9fb1464676b94/500x500-000000-80-0-0.jpg"],
      ["Ribs", "Lorde", 258, "Pure Heroine", "https://cdn-images.dzcdn.net/images/cover/7bb0b356418fbb275c0c3db7259128d7/500x500-000000-80-0-0.jpg"],
      ["A-Punk", "Vampire Weekend", 137, "Vampire Weekend", "https://cdn-images.dzcdn.net/images/cover/6fc963e3e5bd489dd82b0e02c3122792/500x500-000000-80-0-0.jpg"],
      ["Glue Song", "beabadoobee", 135, "Glue Song", "https://cdn-images.dzcdn.net/images/cover/8e64a61be14286be891afeef6b1aafbe/500x500-000000-80-0-0.jpg"],
      ["Space Song", "Beach House", 320, "Depression Cherry", "https://cdn-images.dzcdn.net/images/cover/ae6cd55de0f78ca8ac38ad6c6cff0c1f/500x500-000000-80-0-0.jpg"],
      ["Walking On A Dream", "Empire of the Sun", 198, "Walking On A Dream", "https://cdn-images.dzcdn.net/images/cover/63e0641afc551bf313b1e7027799a136/500x500-000000-80-0-0.jpg"],
      ["Can I Call You Tonight?", "Dayglow", 278, "Fuzzybrain", "https://cdn-images.dzcdn.net/images/cover/bd2f298f15908d7cff95e41ff955fbd0/500x500-000000-80-0-0.jpg"],
      ["Borderline", "Tame Impala", 237, "The Slow Rush", "https://cdn-images.dzcdn.net/images/cover/d8eb61bd4becf79a602a75b69eebde7d/500x500-000000-80-0-0.jpg"],
      ["Riptide", "Vance Joy", 204, "Dream Your Life Away", "https://cdn-images.dzcdn.net/images/cover/d3f67e81d134e4036fd2e68a062210c4/500x500-000000-80-0-0.jpg"],
      ["Pumped Up Kicks", "Foster the People", 239, "Torches", "https://cdn-images.dzcdn.net/images/cover/fc73624907c40d356ca26152754cef43/500x500-000000-80-0-0.jpg"],
      ["Holocene", "Bon Iver", 336, "Bon Iver", "https://cdn-images.dzcdn.net/images/cover/1457f0d27076538d484625fa706541b7/500x500-000000-80-0-0.jpg"],
    ],
  },
  trending: {
    mood: "trending",
    title: "Trending",
    subtitle: "What the world is playing",
    cover: "/covers/cover-trending.jpg",
    targetGenre: "pop",
    targetMood: "upbeat",
    targetTempo: "upbeat",
    targetEnergy: 0.76,
    targetStyle: "vocal",
    allowedGenres: ["pop", "rnb", "hiphop", "dance", "indie", "country", "afrobeats"],
    disallowedGenres: ["lofi", "throwback"],
    weeklyQueries: [
      "Lady Gaga Bruno Mars Die With A Smile Billie Eilish Birds of a Feather",
      "Chappell Roan Good Luck Babe Benson Boone Teddy Swims Hozier",
      "ROSE Bruno Mars APT Gracie Abrams Shaboozey Kendrick Lamar SZA",
      "Noah Kahan Post Malone Doja Cat Tyla Rema Jung Kook",
    ],
    catalogQuery: "Lady Gaga Bruno Mars Billie Eilish Chappell Roan Benson Boone",
    coreArtists: [
      "Lady Gaga", "Bruno Mars", "Billie Eilish", "Chappell Roan", "Benson Boone",
      "Teddy Swims", "Hozier", "ROSÉ", "Gracie Abrams", "Shaboozey",
      "Kendrick Lamar", "SZA", "Sabrina Carpenter", "Post Malone", "Noah Kahan",
      "Doja Cat", "Tyla", "Rema", "Jung Kook", "The Weeknd", "Dua Lipa", "Tate McRae", "Tommy Richman", "Myles Smith",
    ],
    curatedSongs: [
      ["Die With A Smile", "Lady Gaga & Bruno Mars", 251, "Die With A Smile", "https://cdn-images.dzcdn.net/images/cover/4bd5903f4ce8f2601916bfadb44efe8a/500x500-000000-80-0-0.jpg"],
      ["BIRDS OF A FEATHER", "Billie Eilish", 210, "HIT ME HARD AND SOFT", "https://cdn-images.dzcdn.net/images/cover/5d284b31cb9ddeb1a0c79aede5a94e1c/500x500-000000-80-0-0.jpg"],
      ["Good Luck, Babe!", "Chappell Roan", 218, "Good Luck, Babe!", "https://cdn-images.dzcdn.net/images/cover/377470fb0413c43587769a7dea37f691/500x500-000000-80-0-0.jpg"],
      ["Beautiful Things", "Benson Boone", 180, "Fireworks & Rollerblades", "https://cdn-images.dzcdn.net/images/cover/71ca8c4c88fdb45381c4291bd4233ff6/500x500-000000-80-0-0.jpg"],
      ["Lose Control", "Teddy Swims", 210, "I've Tried Everything But Therapy", "https://cdn-images.dzcdn.net/images/cover/a45814bc18561080e3170f7c8ba942aa/500x500-000000-80-0-0.jpg"],
      ["Too Sweet", "Hozier", 251, "Unheard", "https://cdn-images.dzcdn.net/images/cover/7a7c512b717a4aa7452f3c3e46675322/500x500-000000-80-0-0.jpg"],
      ["APT.", "ROSÉ & Bruno Mars", 169, "rosie", "https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg"],
      ["That's So True", "Gracie Abrams", 166, "The Secret of Us", "https://cdn-images.dzcdn.net/images/cover/967769c4612d74e8f5c7da8798b28e13/500x500-000000-80-0-0.jpg"],
      ["A Bar Song (Tipsy)", "Shaboozey", 171, "Where I've Been, Isn't Where I'm Going", "https://cdn-images.dzcdn.net/images/cover/d4f0d9289d6f68204dee8a22fe777c70/500x500-000000-80-0-0.jpg"],
      ["luther", "Kendrick Lamar & SZA", 177, "GNX", "https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg"],
      ["Taste", "Sabrina Carpenter", 157, "Short n' Sweet", "https://cdn-images.dzcdn.net/images/cover/0fd6e3b346b959a8781ccfa89b63607a/500x500-000000-80-0-0.jpg"],
      ["I Had Some Help", "Post Malone feat. Morgan Wallen", 178, "F-1 Trillion", "https://cdn-images.dzcdn.net/images/cover/b9c8cc4fd597a9bc516445e6573501cf/500x500-000000-80-0-0.jpg"],
      ["Stick Season", "Noah Kahan", 182, "Stick Season", "https://cdn-images.dzcdn.net/images/cover/1cf9edd5673e4f9a070054fbd6166134/500x500-000000-80-0-0.jpg"],
      ["Paint The Town Red", "Doja Cat", 231, "Scarlet", "https://cdn-images.dzcdn.net/images/cover/ad4bfc2a374741218dd6498d04e323cc/500x500-000000-80-0-0.jpg"],
      ["Water", "Tyla", 200, "TYLA", "https://cdn-images.dzcdn.net/images/cover/b246276eba02e22c9e08605924395480/500x500-000000-80-0-0.jpg"],
      ["Calm Down", "Rema & Selena Gomez", 239, "Rave & Roses", "https://cdn-images.dzcdn.net/images/cover/3071378af24d789b8fc69e95162041e4/500x500-000000-80-0-0.jpg"],
      ["Seven", "Jung Kook feat. Latto", 184, "GOLDEN", "https://cdn-images.dzcdn.net/images/cover/d1ddbc901bf7d7b43187fac1b1e6714e/500x500-000000-80-0-0.jpg"],
      ["CHIHIRO", "Billie Eilish", 303, "HIT ME HARD AND SOFT", "https://cdn-images.dzcdn.net/images/cover/5d284b31cb9ddeb1a0c79aede5a94e1c/500x500-000000-80-0-0.jpg"],
      ["Pink Pony Club", "Chappell Roan", 258, "The Rise and Fall of a Midwest Princess", "https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/bc/fb/41bcfb43-91d5-931d-5747-fb381803143f/23UMGIM21715.rgb.jpg/500x500bb.jpg"],
      ["Starboy", "The Weeknd", 230, "Starboy", "https://cdn-images.dzcdn.net/images/cover/134778e4c4f19ea71c82408300925a9a/500x500-000000-80-0-0.jpg"],
      ["Dance The Night", "Dua Lipa", 176, "Barbie The Album", "https://cdn-images.dzcdn.net/images/cover/67bbf9fc8e49fc8d373c91963061572b/500x500-000000-80-0-0.jpg"],
      ["exes", "Tate McRae", 159, "THINK LATER", "https://cdn-images.dzcdn.net/images/cover/6f05ad1f5ec636827d9db5683188d980/500x500-000000-80-0-0.jpg"],
      ["Million Dollar Baby", "Tommy Richman", 155, "Million Dollar Baby", "https://cdn-images.dzcdn.net/images/cover/26989b6704a8656f2ceb4e3a148a55cd/500x500-000000-80-0-0.jpg"],
      ["Stargazing", "Myles Smith", 172, "Stargazing", "https://cdn-images.dzcdn.net/images/cover/eaf89238495473e9d78eb75e7a181322/500x500-000000-80-0-0.jpg"],
    ],
  },
  chill: {
    mood: "chill",
    title: "Chill Vibes",
    subtitle: "Easy listening, all day",
    cover: "/covers/cover-chill.jpg",
    targetGenre: "indie",
    targetMood: "chill",
    targetTempo: "slow",
    targetEnergy: 0.44,
    targetStyle: "acoustic",
    allowedGenres: ["indie", "rnb", "pop", "lofi"],
    disallowedGenres: ["rock", "workout", "dance"],
    weeklyQueries: [
      "Jeremy Zucker Lauv keshi Pink Sweats official audio",
      "John Mayer Leon Bridges Laufey Norah Jones official audio",
      "Lord Huron Hollow Coves Novo Amor Surfaces official audio",
      "Joji Conan Gray LANY Rex Orange County Cigarettes After Sex",
    ],
    catalogQuery: "Jeremy Zucker Lauv keshi Laufey John Mayer Lord Huron",
    coreArtists: [
      "Jeremy Zucker", "Lauv", "keshi", "Pink Sweat$", "John Mayer",
      "Leon Bridges", "Khruangbin", "Laufey", "Norah Jones", "Lord Huron",
      "Hollow Coves", "Novo Amor", "Surfaces", "Joji", "Conan Gray",
      "LANY", "Rex Orange County", "Jack Johnson", "Cigarettes After Sex", "Khalid", "Petit Biscuit",
    ],
    curatedSongs: [
      ["comethru", "Jeremy Zucker", 181, "summer,", "https://cdn-images.dzcdn.net/images/cover/795daf4244e61b38656efb32f3fe5259/500x500-000000-80-0-0.jpg"],
      ["I Like Me Better", "Lauv", 197, "I met you when I was 18.", "https://cdn-images.dzcdn.net/images/cover/3db7eca4ee1a2effa0d353289b4b2bba/500x500-000000-80-0-0.jpg"],
      ["LIMBO", "keshi", 212, "GABRIEL", "https://cdn-images.dzcdn.net/images/cover/5de0eec56dbe0a0670f01826aaf32f1a/500x500-000000-80-0-0.jpg"],
      ["At My Worst", "Pink Sweat$", 170, "Pink Planet", "https://cdn-images.dzcdn.net/images/cover/cab97fdd320e4a821ca92ab3b5dcc37c/500x500-000000-80-0-0.jpg"],
      ["Gravity", "John Mayer", 245, "Continuum", "https://cdn-images.dzcdn.net/images/cover/a49f22668c3f7f26d9de7fcc93537742/500x500-000000-80-0-0.jpg"],
      ["Texas Sun", "Khruangbin & Leon Bridges", 252, "Texas Sun", "https://cdn-images.dzcdn.net/images/cover/ce74bca0d491ab7f24a6a21a752a1745/500x500-000000-80-0-0.jpg"],
      ["From The Start", "Laufey", 169, "Bewitched", "https://cdn-images.dzcdn.net/images/cover/497515366a19189203786c2315eb6609/500x500-000000-80-0-0.jpg"],
      ["Don't Know Why", "Norah Jones", 186, "Come Away With Me", "https://cdn-images.dzcdn.net/images/cover/d4cb6f8663af84d1db08a41a019065a0/500x500-000000-80-0-0.jpg"],
      ["The Night We Met", "Lord Huron", 208, "Strange Trails", "https://cdn-images.dzcdn.net/images/cover/19b14fa5b494e0e74332f7dbf8dab87d/500x500-000000-80-0-0.jpg"],
      ["Coastline", "Hollow Coves", 234, "Wanderlust", "https://cdn-images.dzcdn.net/images/cover/694999b0e2c9c832d2ab406f861f9a96/500x500-000000-80-0-0.jpg"],
      ["Anchor", "Novo Amor", 256, "Bathing Beach", "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/54/4b/e1/544be1ff-5505-56dc-2720-96da95313a8e/cover.jpg/500x500bb.jpg"],
      ["Sunday Best", "Surfaces", 158, "Where the Light Is", "https://cdn-images.dzcdn.net/images/cover/b2eee9b3bc6ad79ef160fd0e732054fa/500x500-000000-80-0-0.jpg"],
      ["Glimpse of Us", "Joji", 233, "SMITHEREENS", "https://cdn-images.dzcdn.net/images/cover/36aecc47636b326efc3987120dcf4c65/500x500-000000-80-0-0.jpg"],
      ["Heather", "Conan Gray", 198, "Kid Krow", "https://cdn-images.dzcdn.net/images/cover/0a5209aec8e37012eb07eb6ef01fa7e6/500x500-000000-80-0-0.jpg"],
      ["Malibu Nights", "LANY", 286, "Malibu Nights", "https://cdn-images.dzcdn.net/images/cover/f90692153e5d2a47033475d70e1d19dd/500x500-000000-80-0-0.jpg"],
      ["Loving Is Easy", "Rex Orange County", 155, "Loving Is Easy", "https://cdn-images.dzcdn.net/images/cover/d805dcdae2effd5781af2eb7662a3c4b/500x500-000000-80-0-0.jpg"],
      ["Banana Pancakes", "Jack Johnson", 191, "In Between Dreams", "https://cdn-images.dzcdn.net/images/cover/6fc75cf6170ae0ed9c6a40810c67ba87/500x500-000000-80-0-0.jpg"],
      ["Apocalypse", "Cigarettes After Sex", 290, "Cigarettes After Sex", "https://cdn-images.dzcdn.net/images/cover/2db20377876da16feb8ec9652e835a81/500x500-000000-80-0-0.jpg"],
      ["Location", "Khalid", 219, "American Teen", "https://cdn-images.dzcdn.net/images/cover/7fa1597e86f5b4283ea316f2ddb54008/500x500-000000-80-0-0.jpg"],
      ["Sunset Lover", "Petit Biscuit", 237, "Presence", "https://cdn-images.dzcdn.net/images/cover/e3390ef01b24150b70763cd1d1f7c628/500x500-000000-80-0-0.jpg"],
      ["Sunflower", "Post Malone & Swae Lee", 158, "Spider-Man: Into the Spider-Verse", "https://cdn-images.dzcdn.net/images/cover/1aa3dfe91b3e5d3bc71eca6b6e9c8d39/500x500-000000-80-0-0.jpg"],
      ["Paris in the Rain", "Lauv", 204, "I met you when I was 18.", "https://cdn-images.dzcdn.net/images/cover/020c438f93cd3317c1eccb1df1906e15/500x500-000000-80-0-0.jpg"],
      ["Best Friend", "Rex Orange County", 262, "Best Friend", "https://cdn-images.dzcdn.net/images/cover/9ccaea7ee5c2f1c370aad199ed21935a/500x500-000000-80-0-0.jpg"],
      ["Slow Dancing in a Burning Room", "John Mayer", 242, "Continuum", "https://cdn-images.dzcdn.net/images/cover/a49f22668c3f7f26d9de7fcc93537742/500x500-000000-80-0-0.jpg"],
    ],
  },
  workout: {
    mood: "workout",
    title: "Workout Energy",
    subtitle: "Push through the burn",
    cover: "/covers/cover-workout.jpg",
    targetGenre: "hiphop",
    targetMood: "workout",
    targetTempo: "fast",
    targetEnergy: 0.90,
    targetStyle: "rhythmic",
    allowedGenres: ["hiphop", "rock", "dance", "pop"],
    disallowedGenres: ["lofi", "indie", "country"],
    weeklyQueries: [
      "Eminem Till I Collapse Kanye West Stronger POWER official audio",
      "Imagine Dragons Believer Macklemore Cant Hold Us Skrillex official audio",
      "AC/DC Thunderstruck Survivor Eye of the Tiger Linkin Park Faint",
      "Fall Out Boy Centuries Meek Mill Lil Nas X Industry Baby DMX",
    ],
    catalogQuery: "Eminem Kanye West Imagine Dragons Macklemore AC/DC",
    coreArtists: [
      "Eminem", "Kanye West", "Imagine Dragons", "Macklemore & Ryan Lewis", "Kendrick Lamar",
      "Skrillex", "Survivor", "AC/DC", "Linkin Park", "Fall Out Boy",
      "Meek Mill", "Lil Nas X", "Dua Lipa", "DJ Snake", "DMX",
      "Fort Minor", "Rage Against the Machine", "The Prodigy", "Black Eyed Peas",
    ],
    curatedSongs: [
      ["Till I Collapse", "Eminem", 297, "The Eminem Show", "https://cdn-images.dzcdn.net/images/cover/ec3c8ed67427064c70f67e5815b74cef/500x500-000000-80-0-0.jpg"],
      ["Stronger", "Kanye West", 312, "Graduation", "https://cdn-images.dzcdn.net/images/cover/15012d974c6263aec95e52e6d86cba23/500x500-000000-80-0-0.jpg"],
      ["Believer", "Imagine Dragons", 204, "Evolve", "https://cdn-images.dzcdn.net/images/cover/247b228179aea3b083eef43522b78b45/500x500-000000-80-0-0.jpg"],
      ["Can't Hold Us", "Macklemore & Ryan Lewis", 258, "The Heist", "https://cdn-images.dzcdn.net/images/cover/238f1c36e8445fd162d1d53b8181ecb5/500x500-000000-80-0-0.jpg"],
      ["POWER", "Kanye West", 292, "My Beautiful Dark Twisted Fantasy", "https://cdn-images.dzcdn.net/images/cover/742aba8510ba803bea51d304cf2ca786/500x500-000000-80-0-0.jpg"],
      ["Lose Yourself", "Eminem", 326, "8 Mile", "https://cdn-images.dzcdn.net/images/cover/e2b36a9fda865cb2e9ed1476b6291a7d/500x500-000000-80-0-0.jpg"],
      ["HUMBLE.", "Kendrick Lamar", 177, "DAMN.", "https://cdn-images.dzcdn.net/images/cover/7ce6b8452fae425557067db6e6a1cad5/500x500-000000-80-0-0.jpg"],
      ["Bangarang", "Skrillex", 215, "Bangarang", "https://cdn-images.dzcdn.net/images/cover/3d5ef81b8e6c4b5c35ebe1dfa69a0463/500x500-000000-80-0-0.jpg"],
      ["Eye of the Tiger", "Survivor", 244, "Eye of the Tiger", "https://cdn-images.dzcdn.net/images/cover/e66b5d3a40f69690c1633afb73cc590c/500x500-000000-80-0-0.jpg"],
      ["Thunderstruck", "AC/DC", 292, "The Razors Edge", "https://cdn-images.dzcdn.net/images/cover/e715766b21a8db6076f6a9a89e25cf82/500x500-000000-80-0-0.jpg"],
      ["Faint", "Linkin Park", 162, "Meteora", "https://cdn-images.dzcdn.net/images/cover/882448ab63952aa16e502c82db2df160/500x500-000000-80-0-0.jpg"],
      ["Centuries", "Fall Out Boy", 228, "American Beauty/American Psycho", "https://cdn-images.dzcdn.net/images/cover/c0a1d1281570ad3becbb6146c6d54c0c/500x500-000000-80-0-0.jpg"],
      ["Dreams and Nightmares", "Meek Mill", 230, "Dreams and Nightmares", "https://cdn-images.dzcdn.net/images/cover/b9e64f0c2ebbf77a34dd58f49fe6a7ae/500x500-000000-80-0-0.jpg"],
      ["Industry Baby", "Lil Nas X & Jack Harlow", 212, "MONTERO", "https://cdn-images.dzcdn.net/images/cover/a65e86966cfd34b2aa292856136ef9ac/500x500-000000-80-0-0.jpg"],
      ["Back In Black", "AC/DC", 255, "Back in Black", "https://cdn-images.dzcdn.net/images/cover/41041b14873956eff0459c8ea2c296a8/500x500-000000-80-0-0.jpg"],
      ["Radioactive", "Imagine Dragons", 186, "Night Visions", "https://cdn-images.dzcdn.net/images/cover/7e8314f4280cffde363547a495a260bc/500x500-000000-80-0-0.jpg"],
      ["Physical", "Dua Lipa", 193, "Future Nostalgia", "https://cdn-images.dzcdn.net/images/cover/f8364f090ba04f1b19b381ec0390f3e4/500x500-000000-80-0-0.jpg"],
      ["Turn Down for What", "DJ Snake & Lil Jon", 213, "Turn Down for What", "https://cdn-images.dzcdn.net/images/cover/82c139e154a40073542914dfed468474/500x500-000000-80-0-0.jpg"],
      ["X Gon' Give It To Ya", "DMX", 218, "Cradle 2 the Grave", "https://cdn-images.dzcdn.net/images/cover/2738ddc7f2fa7d869438caf6a3d25a7b/500x500-000000-80-0-0.jpg"],
      ["Remember the Name", "Fort Minor", 230, "The Rising Tied", "https://cdn-images.dzcdn.net/images/cover/d4059c5525f643e2843b2f1e18e2d39f/500x500-000000-80-0-0.jpg"],
      ["Killing In The Name", "Rage Against the Machine", 314, "Rage Against the Machine", "https://cdn-images.dzcdn.net/images/cover/73a4d0cb2f3ec27583b9e0bc724b50c7/500x500-000000-80-0-0.jpg"],
      ["Breathe", "The Prodigy", 335, "The Fat of the Land", "https://cdn-images.dzcdn.net/images/cover/566d28d32080a6d82a2d4d145ea5ea7e/500x500-000000-80-0-0.jpg"],
      ["Pump It", "Black Eyed Peas", 213, "Monkey Business", "https://cdn-images.dzcdn.net/images/cover/595ae492a34647054ea30d805096d5b5/500x500-000000-80-0-0.jpg"],
      ["DNA.", "Kendrick Lamar", 185, "DAMN.", "https://cdn-images.dzcdn.net/images/cover/7ce6b8452fae425557067db6e6a1cad5/500x500-000000-80-0-0.jpg"],
    ],
  },
  throwback: {
    mood: "throwback",
    title: "Throwback",
    subtitle: "90s & 2000s classics",
    cover: "/covers/cover-throwback.jpg",
    targetGenre: "throwback",
    targetMood: "retro",
    targetTempo: "upbeat",
    targetEnergy: 0.75,
    targetStyle: "vocal",
    allowedGenres: ["throwback", "pop", "rnb", "hiphop", "rock"],
    disallowedGenres: ["lofi"],
    weeklyQueries: [
      "Usher Yeah OutKast Hey Ya Britney Spears Toxic Backstreet Boys",
      "Beyonce Crazy In Love Destiny's Child TLC Justin Timberlake",
      "Rihanna Umbrella Nelly 50 Cent In Da Club Shakira Hips Dont Lie",
      "Alicia Keys Ne-Yo Spice Girls NSYNC Christina Aguilera Avril Lavigne",
    ],
    catalogQuery: "Usher OutKast Britney Spears Backstreet Boys Beyonce TLC",
    coreArtists: [
      "Usher", "OutKast", "Britney Spears", "Backstreet Boys", "Beyoncé",
      "Destiny's Child", "TLC", "Justin Timberlake", "Rihanna", "Nelly",
      "50 Cent", "Shakira", "Alicia Keys", "Ne-Yo", "Spice Girls",
      "*NSYNC", "Christina Aguilera", "Avril Lavigne", "Gwen Stefani",
      "Black Eyed Peas", "Nelly Furtado", "Maroon 5", "Akon",
    ],
    curatedSongs: [
      ["Yeah!", "Usher feat. Lil Jon & Ludacris", 250, "Confessions", "https://cdn-images.dzcdn.net/images/cover/b89c20012cccb051c8a4e04d98386f95/500x500-000000-80-0-0.jpg"],
      ["Hey Ya!", "OutKast", 235, "Speakerboxxx/The Love Below", "https://cdn-images.dzcdn.net/images/cover/f81783b6cc6030733cd475f820855562/500x500-000000-80-0-0.jpg"],
      ["Toxic", "Britney Spears", 198, "In the Zone", "https://cdn-images.dzcdn.net/images/cover/8a2b95cda407d004d829831d20e2e20b/500x500-000000-80-0-0.jpg"],
      ["I Want It That Way", "Backstreet Boys", 213, "Millennium", "https://cdn-images.dzcdn.net/images/cover/d61eaad8f321ea876a5f5c7219aae892/500x500-000000-80-0-0.jpg"],
      ["Crazy in Love", "Beyoncé feat. Jay-Z", 236, "Dangerously in Love", "https://cdn-images.dzcdn.net/images/cover/1ea1a631aa5235bbd0063643beb96fa8/500x500-000000-80-0-0.jpg"],
      ["Say My Name", "Destiny's Child", 271, "The Writing's on the Wall", "https://cdn-images.dzcdn.net/images/cover/73da200f9335f752d2f7cb5ed8933cef/500x500-000000-80-0-0.jpg"],
      ["No Scrubs", "TLC", 214, "FanMail", "https://cdn-images.dzcdn.net/images/cover/6dd5f40e7688ba155a5ef557977e95d3/500x500-000000-80-0-0.jpg"],
      ["SexyBack", "Justin Timberlake", 242, "FutureSex/LoveSounds", "https://cdn-images.dzcdn.net/images/cover/615bb58abf2e5fd86741ed5311d364b1/500x500-000000-80-0-0.jpg"],
      ["Umbrella", "Rihanna feat. Jay-Z", 275, "Good Girl Gone Bad", "https://cdn-images.dzcdn.net/images/cover/91276466fbc876d96be9e6926060af60/500x500-000000-80-0-0.jpg"],
      ["Hot In Herre", "Nelly", 228, "Nellyville", "https://cdn-images.dzcdn.net/images/cover/632fa55096ecab62a0c2556fa9e958c1/500x500-000000-80-0-0.jpg"],
      ["In Da Club", "50 Cent", 193, "Get Rich or Die Tryin'", "https://cdn-images.dzcdn.net/images/cover/8f4dd4d8abf85ceda96b6b4adf217590/500x500-000000-80-0-0.jpg"],
      ["Hips Don't Lie", "Shakira feat. Wyclef Jean", 218, "Oral Fixation, Vol. 2", "https://cdn-images.dzcdn.net/images/cover/b570890728621ec68d5c5558164c3945/500x500-000000-80-0-0.jpg"],
      ["No One", "Alicia Keys", 253, "As I Am", "https://cdn-images.dzcdn.net/images/cover/b9f3ff7c0514902ec94751360154f25b/500x500-000000-80-0-0.jpg"],
      ["So Sick", "Ne-Yo", 207, "In My Own Words", "https://cdn-images.dzcdn.net/images/cover/ad97c751643e185a348fb13199c49944/500x500-000000-80-0-0.jpg"],
      ["Wannabe", "Spice Girls", 173, "Spice", "https://cdn-images.dzcdn.net/images/cover/18c4f2d9608910a2b8eb1835052e895b/500x500-000000-80-0-0.jpg"],
      ["...Baby One More Time", "Britney Spears", 211, "...Baby One More Time", "https://cdn-images.dzcdn.net/images/cover/f685d32254a59b6162be0d1082ff8805/500x500-000000-80-0-0.jpg"],
      ["Bye Bye Bye", "*NSYNC", 200, "No Strings Attached", "https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/95/e8/65/95e86597-6095-0f6c-f6b8-ba53c7b744a2/828767330723.jpg/500x500bb.jpg"],
      ["Genie in a Bottle", "Christina Aguilera", 217, "Christina Aguilera", "https://cdn-images.dzcdn.net/images/cover/98276416e4db0e5eb6fbb9c9f1a52bdc/500x500-000000-80-0-0.jpg"],
      ["Complicated", "Avril Lavigne", 244, "Let Go", "https://cdn-images.dzcdn.net/images/cover/1130d6301d5e87976279ea2f706fcc26/500x500-000000-80-0-0.jpg"],
      ["Hollaback Girl", "Gwen Stefani", 199, "Love. Angel. Music. Baby.", "https://cdn-images.dzcdn.net/images/cover/595ae492a34647054ea30d805096d5b5/500x500-000000-80-0-0.jpg"],
      ["Where Is the Love?", "Black Eyed Peas", 272, "Elephunk", "https://cdn-images.dzcdn.net/images/cover/0e4b70f9985801a0acbcef1782bd18eb/500x500-000000-80-0-0.jpg"],
      ["Promiscuous", "Nelly Furtado feat. Timbaland", 242, "Loose", "https://cdn-images.dzcdn.net/images/cover/1c0ab3163b031034e5b8155c10aada6d/500x500-000000-80-0-0.jpg"],
      ["She Will Be Loved", "Maroon 5", 257, "Songs About Jane", "https://cdn-images.dzcdn.net/images/cover/39fe38574c7af3181d1e56ad7c03fce3/500x500-000000-80-0-0.jpg"],
      ["Smack That", "Akon feat. Eminem", 212, "Konvicted", "https://cdn-images.dzcdn.net/images/cover/bc4d98904d61661cc6d7dd53745340d0/500x500-000000-80-0-0.jpg"],
    ],
  },
};

export function curatedForYouTracksForMood(mood, weekKey = "", count = 20) {
  const cleanMood = String(mood || "pop").toLowerCase().replace(/^mod:/, "");
  const key = cleanMood === "throw" ? "throwback" : cleanMood;
  const profile = FY_MOOD_PROFILES[key] || FY_MOOD_PROFILES.pop;
  const rows = profile.curatedSongs || [];
  if (!rows.length) return [];
  const offset = weekSeedOffset(weekKey || utcWeekKey(), key) % rows.length;
  const rotated = rows.slice(offset).concat(rows.slice(0, offset));
  const sources = ["youtube", "apple", "deezer"];
  return rotated.slice(0, count).map(([title, artist, duration, album, coverUrl], idx) => {
    const src = sources[idx % 3];
    const slug = `${title}_${artist}`.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    return {
      id: `${src}:fy:${key}:${slug}`,
      source: src,
      title,
      artist,
      album: album || "",
      duration: Number(duration) || 200,
      artwork: coverUrl || profile.cover || "/cover-default.jpg",
      playQuery: `${title} ${artist} official audio`.trim(),
      genre: profile.targetGenre,
      mood: profile.mood,
      _tag: profile.mood,
    };
  });
}

export const RADIO_HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://fi1.api.radio-browser.info",
  "https://at1.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];

export function regionCode(raw) {
  const gl = String(raw || "IN").toUpperCase();
  return /^[A-Z]{2}$/.test(gl) ? gl : "IN";
}

export function moodsForCountry(gl) {
  const local = (MOODS_BY_COUNTRY[gl] || []).slice(0, 2);
  const seen = new Set();
  const out = [];
  for (const m of [...MOOD_CORE, ...local]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.slice(0, 12);
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export function playlistsOf(v) {
  if (!v) return [];
  if (Array.isArray(v.playlists)) return v.playlists;
  if (Array.isArray(v) && Array.isArray(v.playlists)) return v.playlists;
  return [];
}

export function uniqPlaylists(list) {
  const seen = new Set();
  const out = [];
  for (const p of list || []) {
    const k = String((p && (p.playlistId || p.id || p.title)) || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export function pickPlaylistHit(pls, query) {
  const qw = String(query || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  let best = null;
  let bestScore = 0;
  for (const p of pls || []) {
    if (!p || !p.playlistId) continue;
    const t = String(p.title || "").toLowerCase();
    let s = 0;
    for (const w of qw) if (t.includes(w)) s += 1;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best || (pls && pls[0]) || null;
}

// ── "Viral / Trending worldwide" home shelf ────────────────────────────────
// EXACTLY 10, each a DIFFERENT viral taste (TikTok, Instagram, Facebook,
// Shorts, sudden-breakout songs, global charts), each tagged with a `taste`
// so the client can label/theme the card. `query` is the English search that
// fills the playlist with the newest viral hits for that taste. The shelf
// auto-refreshes with the rest of the home page: the server resolves these
// against the real catalog and KV-caches the home build per utc-day, so the
// cards pick up new trends every day without a code change.
export const VIRAL_QUERIES = [
  { taste: "tiktok",        title: "TikTok Hits",       subtitle: "Songs blowing up on TikTok right now",      query: "tiktok viral songs" },
  { taste: "instagram",     title: "Instagram Reels",   subtitle: "Reels you've heard on your feed",          query: "instagram reel trending songs" },
  { taste: "facebook",      title: "Facebook Trending", subtitle: "Viral audio flooding Facebook & Stories",  query: "facebook viral trending songs" },
  { taste: "shorts",        title: "Shorts & Snacks",   subtitle: "YouTube Shorts earworms on repeat",        query: "youtube shorts viral songs" },
  { taste: "spedup",        title: "Sped Up & Exploded", subtitle: "The sped-up versions everyone mouths",    query: "sped up viral songs" },
  { taste: "sudden",        title: "Suddenly Viral",    subtitle: "Songs that came out of nowhere",           query: "suddenly viral songs this week" },
  { taste: "global",        title: "Global Buzz",       subtitle: "The same chorus everywhere at once",       query: "global trending viral songs" },
  { taste: "soundtrack",    title: "Sound on",          subtitle: "Scenes you can't scroll past",             query: "trending soundtrack songs" },
  { taste: "dance",         title: "Viral Dance",       subtitle: "Challenge-ready beats",                    query: "viral dance challenge songs" },
  { taste: "breaks",        title: "Breakout Now",      subtitle: "Fresh breakouts crossing over to charts",  query: "new breakout viral hits" },
];

// viralRes = Promise.allSettled results aligned with VIRAL_QUERIES; may be [].
export function buildViralPlaylists(viralRes) {
  return VIRAL_QUERIES.map((f, i) => {
    const v = viralRes && viralRes[i] && viralRes[i].status === "fulfilled" ? viralRes[i].value : null;
    const tracks = (v && Array.isArray(v.tracks) ? v.tracks : []).slice(0, 20);
    return {
      id: `viral-${i}`,
      title: f.title,
      subtitle: f.subtitle,
      artwork: (v && v.artwork) || "",
      playlistId: (v && v.playlistId) || "",
      query: f.query,
      taste: f.taste,
      kind: "yt",
      tracks,
    };
  });
}

// fyRes = Promise.allSettled results aligned with FY_QUERIES; may be [].
export function buildForYouPlaylists(fyRes, weekKey = "") {
  // EXACTLY 10 "Made for you" cards, each a different mood. No `kind:"mix"`
  // cards here — the client no longer filters mixes out (when the user has no
  // taste). Every card carries `mood` + `genres` so the client can reorder
  // them by the listener's taste profile as they keep listening. It also
  // carries up to 20 `tracks` so the card shows the real song count ("20
  // songs") even before it's opened, and so a fresh list is fully populated.
  const wk = weekKey || utcWeekKey();
  return FY_QUERIES.map((f, i) => {
    const v = fyRes && fyRes[i] && fyRes[i].status === "fulfilled" ? fyRes[i].value : null;
    const rawTracks = (v && Array.isArray(v.tracks) && v.tracks.length)
      ? v.tracks.slice(0, 20)
      : curatedForYouTracksForMood(f.mood, wk, 20);
    const prof = FY_MOOD_PROFILES[f.mood] || {};
    return {
      id: `fy-${i}`,
      title: f.title,
      subtitle: f.subtitle,
      artwork: (v && v.artwork) || (rawTracks[0] && rawTracks[0].artwork) || prof.cover || "",
      playlistId: (v && v.playlistId) || "",
      query: f.query,
      mood: f.mood,
      genres: f.genres,
      week: wk,
      kind: "yt",
      tracks: rawTracks,
    };
  });
}

// ── "Trending in (Country)" — 17 Spotify-style Country-Specific Playlists ──
// Every country gets exactly 17 unique, human-curated-style playlists covering
// distinct genres, moods, release velocities, emerging artists, and local scenes.
export const COUNTRY_NAMES = {
  IN: "India", US: "United States", GB: "UK", CA: "Canada", AU: "Australia",
  DE: "Germany", FR: "France", JP: "Japan", KR: "South Korea", BR: "Brazil",
  MX: "Mexico", NG: "Nigeria", ZA: "South Africa", AE: "UAE", SA: "Saudi Arabia",
  PK: "Pakistan", BD: "Bangladesh", ID: "Indonesia", MY: "Malaysia", SG: "Singapore",
  PH: "Philippines", TH: "Thailand", VN: "Vietnam", EG: "Egypt", IT: "Italy",
  ES: "Spain", TR: "Turkey", NZ: "New Zealand", NL: "Netherlands", SE: "Sweden",
  CN: "China", HK: "Hong Kong",
};

export const COUNTRY_SCENE_CUSTOM = {
  IN: {
    flagship1: { title: "Bollywood Central", artist: "Biggest Hindi film & chart blockbusters", query: "bollywood new songs 2025 2026 arijit singh vishal mishra shreya ghoshal", keywords: ["bollywood", "hindi", "arijit", "vishal", "shreya", "pritam", "sachin-jigar", "tanishk"] },
    flagship2: { title: "Punjabi 101", artist: "Diljit Dosanjh, Karan Aujla & Punjabi heat", query: "punjabi new hits 2025 2026 karan aujla diljit dosanjh ap dhillon shubh", keywords: ["punjabi", "karan aujla", "diljit", "ap dhillon", "shubh", "sidhu", "guru randhawa", "badshah"] },
    hiphop: { title: "Rap 91", artist: "Desi hip-hop, Seedhe Maut, KR$NA & DIVINE", query: "desi hip hop indian rap 2025 seedhe maut krsna divine king", keywords: ["rap", "hip-hop", "hip hop", "divine", "kr$na", "krsna", "seedhe maut", "raftaar", "mc stan", "badshah", "king", "hanumankind"] },
    rnb: { title: "I-Pop & Desi R&B", artist: "Smooth modern Indian pop & R&B grooves", query: "indian pop rnb new songs king zaeden dhruv armann malik", keywords: ["r&b", "rnb", "soul", "armaan malik", "dhruv", "zaeden", "mitraz", "darshan raval", "king"] },
    indie: { title: "Indie India", artist: "Anuv Jain, Prateek Kuhad & fresh indie voices", query: "indian indie new songs anuv jain prateek kuhad aditya rikhari", keywords: ["indie", "anuv jain", "prateek kuhad", "aditya rikhari", "local train", "when chai met toast", "lifafa", "ritviz"] },
    dance: { title: "Bollywood Dance Party", artist: "High-energy desi club & wedding bangers", query: "bollywood party dance hits 2025 badshah tanishk bagchi official", keywords: ["dance", "party", "electronic", "badshah", "neha kakkar", "yo yo honey singh", "tanishk", "dj"] },
    rock: { title: "Indian Rock & Fusion", artist: "The Local Train, Parikrama & Desi rock anthems", query: "indian rock band hindi rock songs local train agnee", keywords: ["rock", "band", "local train", "agnee", "parikrama", "euphoria", "indian ocean", "yellow diary"] },
    chill: { title: "Late Night Desi Lo-Fi", artist: "Midnight Hindi chill & atmospheric vibes", query: "hindi chill acoustic slow songs arijit singh anuv jain", keywords: ["chill", "lofi", "lo-fi", "slow", "night", "anuv", "prateek", "mitraz", "arijit"] },
    romance: { title: "Romantic Bollywood", artist: "Heartfelt Hindi love songs & ballads", query: "romantic hindi songs 2025 arijit singh jubin nautiyal vishal mishra", keywords: ["romance", "love", "arijit", "jubin", "vishal mishra", "shreya", "atif", "darshan"] },
    emerging: { title: "Fresh Finds India", artist: "Breakout independent & regional risers", query: "new indian breakout songs 2025 aditya rikhari chani nattan talwiinder", keywords: ["talwiinder", "aditya rikhari", "chani nattan", "inderpal moga", "faheem abdullah", "kushagra", "arjan dhillon"] },
    radar: { title: "RADAR India", artist: "Next-wave Indian artists on the rise", query: "rising indian artists 2025 hanumankind talwiinder tsumyoki", keywords: ["hanumankind", "talwiinder", "tsumyoki", "reble", "chizai", "sanju rathod", "paresh pahuja"] },
  },
  US: {
    flagship1: { title: "RapCaviar", artist: "Kendrick Lamar, Future, Travis Scott & hip-hop heat", query: "new hip hop 2025 2026 kendrick lamar future travis scott drake", keywords: ["hip-hop", "rap", "kendrick", "future", "travis scott", "drake", "metro boomin", "21 savage", "tyler", "playboi carti"] },
    flagship2: { title: "Hot Country", artist: "Morgan Wallen, Shaboozey, Post Malone & country now", query: "hot country new hits 2025 morgan wallen shaboozey luke combs zach bryan", keywords: ["country", "morgan wallen", "shaboozey", "luke combs", "zach bryan", "jelly roll", "lainey wilson", "chris stapleton", "kacey musgraves"] },
    hiphop: { title: "Most Necessary", artist: "New wave street rap & trap anthems", query: "new trap rap hits 2025 glorilla gunna don toliver yeat", keywords: ["glorilla", "gunna", "don toliver", "yeat", "lil baby", "sexxy red", "central cee", "lazer dim", "bossman dlow"] },
    rnb: { title: "Are & Be", artist: "SZA, Tommy Richman, Kehlani & R&B pulse", query: "new rnb hits 2025 sza kehlani victoria monet brent faiyaz summer walker", keywords: ["r&b", "rnb", "soul", "sza", "kehlani", "victoria", "brent faiyaz", "summer walker", "muni long", "leon thomas", "giveon"] },
    indie: { title: "Lorem & Indie Pop", artist: "Clairo, Role Model, Gracie Abrams & alt-pop", query: "indie pop new songs 2025 clairo gracie abrams role model Sombr", keywords: ["indie", "alternative", "clairo", "gracie abrams", "role model", "beabadoobee", "mitski", "phoebe bridgers", "wallows", "men i trust"] },
    dance: { title: "mint", artist: "John Summit, Fred again.., Charli xcx & club anthems", query: "new dance electronic house 2025 john summit dom dolla fred again charli xcx", keywords: ["dance", "electronic", "house", "john summit", "dom dolla", "fred again", "charli xcx", "kaytranada", "subtronics", "tiesto"] },
    rock: { title: "Rock This", artist: "Linkin Park, Hozier, Blink-182 & modern rock", query: "new rock alternative hits 2025 linkin park hozier green day sleep token", keywords: ["rock", "metal", "alternative", "linkin park", "hozier", "sleep token", "bad omens", "green day", "pearl jam", "cage the elephant"] },
    chill: { title: "Chill Hits", artist: "Billie Eilish, Khalid, Noah Kahan & laid-back pop", query: "chill pop hits 2025 billie eilish noah kahan laufey finneas", keywords: ["chill", "billie eilish", "noah kahan", "laufey", "khalid", "daniel caesar", "d4vd", "cigars", "mac demarco"] },
    romance: { title: "Love Pop & Acoustic", artist: "Lady Gaga, Bruno Mars, Benson Boone & ballads", query: "love pop ballads 2025 lady gaga bruno mars benson boone teddy swims", keywords: ["lady gaga", "bruno mars", "benson boone", "teddy swims", "taylor swift", "ariana grande", "olivia rodrigo", "stephen sanchez"] },
    emerging: { title: "Fresh Finds US", artist: "Breakout independent & viral underground", query: "breakout indie viral songs 2025 sombr gigi perez alex warren", keywords: ["gigi perez", "alex warren", "lola young", "sombr", "malcolm todd", "ravyn lenae", "artemas", "mk.gee"] },
    radar: { title: "RADAR US", artist: "Emerging American artists on the rise", query: "rising artists 2025 doechii chappell roan shaboozey tate mcrae", keywords: ["doechii", "chappell roan", "shaboozey", "tate mcrae", "addison rae", "dasha", "tucker wetmore", "megan moroney"] },
  },
  GB: {
    flagship1: { title: "Who We Be", artist: "Central Cee, Dave, Stormzy & UK rap culture", query: "uk rap hip hop 2025 central cee dave stormzy nemzzz", keywords: ["central cee", "dave", "stormzy", "skepta", "nemzzz", "headie one", "knucks", "littlesimz", "aj tracey"] },
    flagship2: { title: "Britpop & UK Icons", artist: "Charli xcx, Lola Young, Dua Lipa & UK pop", query: "uk pop hits 2025 charli xcx lola young dua lipa raye sam fender", keywords: ["charli xcx", "lola young", "dua lipa", "raye", "sam fender", "ed sheeran", "jade", "olivia dean", "myles smith"] },
    dance: { title: "Massive Dance UK", artist: "Fred again.., Chase & Status, Disclosure & UK club", query: "uk dance garage dnb 2025 fred again chase status disclosure Sonny Fodera", keywords: ["fred again", "chase", "disclosure", "calvin harris", "sonny fodera", "pawal", "becky hill", "rudimental", "nia archives"] },
    indie: { title: "The Indie List", artist: "Sam Fender, The Last Dinner Party & UK indie", query: "uk indie rock 2025 sam fender the last dinner party fontaines dc wunderhorse", keywords: ["sam fender", "last dinner party", "fontaines", "wunderhorse", "beabadoobee", "arctic monkeys", "the 1975", "english teacher"] },
  },
  KR: {
    flagship1: { title: "K-Pop ON! (온)", artist: "ROSÉ, aespa, Jennie, Stray Kids & K-Pop now", query: "kpop new hits 2025 2026 rose aespa jennie stray kids newjeans", keywords: ["rose", "rosé", "aespa", "jennie", "lisa", "stray kids", "newjeans", "illit", "le sserafim", "seventeen", "jung kook", "ive", "babymonster", "g-dragon"] },
    flagship2: { title: "TrenChill K-R&B", artist: "BIBI, Crush, Jay Park & Korean R&B grooves", query: "krnb new songs 2025 bibi crush dean lee youngji", keywords: ["bibi", "crush", "dean", "jay park", "zion.t", "heize", "colde", "gemini", "lee youngji", "ph-1"] },
    rock: { title: "K-Band & Indie", artist: "DAY6, QWER, wave to earth & Korean bands", query: "korean band rock 2025 day6 qwer wave to earth lucy jannabi", keywords: ["day6", "qwer", "wave to earth", "lucy", "jannabi", "hyukoh", "silicagel", "10cm"] },
  },
  JP: {
    flagship1: { title: "Tokyo Super Hits!", artist: "Mrs. GREEN APPLE, Creepy Nuts, YOASOBI & J-Pop", query: "jpop hits 2025 mrs green apple creepy nuts yoasobi vaundy fujii kaze", keywords: ["mrs. green apple", "mrs green apple", "creepy nuts", "yoasobi", "vaundy", "fujii kaze", "kenshi yonezu", "back number", "tuki", "omoinotake"] },
    flagship2: { title: "Anime Now", artist: "Latest anime openings, endings & OST hits", query: "anime opening hits 2025 creepy nuts yoasobi tatsuya kitani", keywords: ["creepy nuts", "yoasobi", "tatsuya kitani", "king gnu", "lisa", "aimer", "ado", "kenshi yonezu", "man with a mission"] },
  },
  NG: {
    flagship1: { title: "Afrobeats Hits", artist: "Rema, Asake, Burna Boy, Ayra Starr & Naija heat", query: "afrobeats new hits 2025 2026 rema asake burna boy ayra starr wizkid", keywords: ["rema", "asake", "burna boy", "ayra starr", "wizkid", "davido", "tems", "omah lay", "shallipopi", "odumodublvck", "ckay", "fireboy"] },
    flagship2: { title: "Afro Street Pop", artist: "Shallipopi, Seyi Vibez, Odumodublvck & street vibes", query: "nigerian street pop 2025 shallipopi seyi vibez odumodublvck zlatan", keywords: ["shallipopi", "seyi vibez", "odumodublvck", "zlatan", "asake", "mohbad", "bella shmurda", "portable", "olamide"] },
  },
  ZA: {
    flagship1: { title: "AmaPiano Grooves", artist: "Kabza De Small, Tyler ICU, TitoM & Yuppe", query: "amapiano new hits 2025 kabza de small tyler icu titom yuppe", keywords: ["kabza", "tyler icu", "titom", "yuppe", "maphorisa", "uncle waffles", "kelvin momo", "young stunna", "focalistic", "scotts maphuma"] },
    flagship2: { title: "Afropop & Mzansi Hits", artist: "Tyla, Zee Nxumalo, Makhadzi & South African pop", query: "south africa pop hits 2025 tyla zee nxumalo ciza dlala thukzin", keywords: ["tyla", "zee nxumalo", "makhadzi", "dlala thukzin", "nasty c", "elaine", "lloyiso", "ami faku"] },
  },
  BR: {
    flagship1: { title: "Top Brasil", artist: "Anitta, Henrique & Juliano, Matuê & Brazil hits", query: "top brasil 2025 novas musicas henrique juliano anitta ludmilla", keywords: ["anitta", "ludmilla", "henrique", "matue", "matuê", "luisa sonza", "ana castela", "gusttavo lima", "pedro sampaio", "liniker"] },
    flagship2: { title: "Funk & Trap Brasil", artist: "Pedro Sampaio, MC Ryan SP, Veigh & baile funk", query: "funk trap brasil 2025 pedro sampaio veigh mc ryan sp", keywords: ["pedro sampaio", "veigh", "mc", "orochi", "filipe ret", "cabelinho", "kevin o chris", "dennis"] },
  },
  MX: {
    flagship1: { title: "Éxitos México", artist: "Peso Pluma, Fuerza Regida, Junior H & Música Mexicana", query: "musica mexicana 2025 peso pluma fuerza regida junior h natanael cano", keywords: ["peso pluma", "fuerza regida", "junior h", "natanael cano", "carin leon", "grupo frontera", "tito double p", "gabito ballesteros", "oscar maydon"] },
    flagship2: { title: "Reggaetón & Urbano MX", artist: "Bellakath, El Malilla, Yeri Mua & Perreo", query: "reggaeton mexa 2025 el malilla bellakath yeri mua bad bunny", keywords: ["bellakath", "el malilla", "yeri mua", "dani flow", "bad bunny", "feid", "karol g", "kenia os"] },
  },
  PK: {
    flagship1: { title: "Pakistani Pop & Coke Studio", artist: "Atif Aslam, Ali Sethi, Hasan Raheem & Coke Studio", query: "pakistan new songs 2025 coke studio atif aslam hasan raheem maanu", keywords: ["atif aslam", "ali sethi", "hasan raheem", "abdul hannan", "kaifi khalil", "asim azhar", "bilal saeed", "coke studio", "rovalio"] },
    flagship2: { title: "Urdu Rap & Hip-Hop", artist: "Talha Anjum, Talhah Yunus, Faris Shafi & Young Stunners", query: "urdu rap 2025 talha anjum talhah yunus young stunners faris shafi", keywords: ["talha anjum", "talhah yunus", "young stunners", "faris shafi", "umair", "jj47", "rap demon", "jokhay"] },
  },
  PH: {
    flagship1: { title: "Tatak Pinoy", artist: "BINI, Maki, Cup of Joe, TJ Monterde & OPM hits", query: "opm hits 2025 bini maki cup of joe tj monterde dionela", keywords: ["bini", "maki", "cup of joe", "tj monterde", "dionela", "zack tabudlo", "ben&ben", "juan karlos", "arthur nery", "sb19"] },
    flagship2: { title: "Pinoy Rap & R&B", artist: "Hev Abi, Flow G, Al James, Denise Julia & street OPM", query: "pinoy hip hop rnb 2025 hev abi flow g denise julia", keywords: ["hev abi", "flow g", "al james", "denise julia", "skusta clee", "shanti dope", "gloc-9", "illest morena"] },
  },
};

export function getCountryTrendingPlaylists(gl) {
  const code = regionCode(gl);
  const cName = COUNTRY_NAMES[code] || code;
  const baseQ = LOCAL_CHARTS[code] || "top hits new songs official audio";
  const sq = COUNTRY_SHELF_QUERIES[code] || {};
  const custom = COUNTRY_SCENE_CUSTOM[code] || {};

  const f1 = custom.flagship1 || {
    title: `${cName} Cultural Heat`,
    artist: `Signature hits & regional favorites in ${cName}`,
    query: `${sq.today || baseQ} 2025 2026`,
    keywords: ["pop", "hits"],
  };
  const f2 = custom.flagship2 || {
    title: `${cName} Street & Crossover`,
    artist: `Breakout crossover tracks dominating ${cName}`,
    query: `${sq.pop || baseQ} new releases`,
    keywords: ["pop", "rap", "dance"],
  };
  const hh = custom.hiphop || {
    title: `Hip-Hop & Rap ${cName}`,
    artist: `Fresh bars, trap & street anthems in ${cName}`,
    query: `${sq.hiphop || "hip hop rap hits"} 2025`,
    keywords: ["hip-hop", "hip hop", "rap", "trap", "drill"],
  };
  const rnb = custom.rnb || {
    title: `R&B & Soul ${cName}`,
    artist: `Smooth grooves, neo-soul & melodic vocals`,
    query: `${sq.rnb || "rnb soul new songs"} 2025`,
    keywords: ["r&b", "rnb", "soul"],
  };
  const ind = custom.indie || {
    title: `Indie & Alternative ${cName}`,
    artist: `Left-of-center discoveries & indie favorites`,
    query: `${sq.indie || "indie alternative new songs"} 2025`,
    keywords: ["indie", "alternative", "folk"],
  };
  const dnc = custom.dance || {
    title: `Club & Electronic ${cName}`,
    artist: `Dancefloor fillers, house & electronic heat`,
    query: `${sq.dance || "dance electronic club hits"} 2025`,
    keywords: ["dance", "electronic", "house", "club", "edm"],
  };
  const rck = custom.rock || {
    title: `Rock & Band Energy ${cName}`,
    artist: `Guitar-driven anthems & live band energy`,
    query: `${sq.rock || "rock alternative bands"} 2025`,
    keywords: ["rock", "band", "metal", "alternative"],
  };
  const chl = custom.chill || {
    title: `Late Night ${cName}`,
    artist: `After-hours mood, chill melodies & laid-back gems`,
    query: `${sq.rnb || sq.indie || baseQ} chill late night acoustic`,
    keywords: ["chill", "lofi", "slow", "ambient", "indie"],
  };
  const rom = custom.romance || {
    title: `Heartfelt & Acoustic ${cName}`,
    artist: `Stripped-back acoustic songs & emotional ballads`,
    query: `${sq.pop || baseQ} romantic acoustic love songs`,
    keywords: ["acoustic", "romance", "love", "singer-songwriter", "pop"],
  };
  const emg = custom.emerging || {
    title: `Fresh Finds ${cName}`,
    artist: `Breakout tracks from emerging artists in ${cName}`,
    query: `${sq.indie || baseQ} breakout new artist 2025`,
    keywords: ["indie", "new", "emerging"],
  };
  const rdr = custom.radar || {
    title: `RADAR ${cName}`,
    artist: `Next-wave artists on the cusp of breaking through`,
    query: `${sq.pop || baseQ} rising artists 2025 2026`,
    keywords: ["rising", "new", "pop", "hip-hop"],
  };

  const defs = [
    {
      slot: "top50",
      role: "chart_top",
      title: `Top 50 – ${cName}`,
      artist: `Daily update of the most played tracks in ${cName}`,
      query: `${sq.today || baseQ} top 50 chart`,
      targetGenres: ["pop", "hip-hop", "r&b", "dance", "bollywood", "punjabi", "k-pop", "j-pop", "afrobeats", "latin"],
      keywords: [...(f1.keywords || []), ...(f2.keywords || [])],
      preferChart: true,
      preferFresh: true,
    },
    {
      slot: "new_music_friday",
      role: "new_releases",
      title: `New Music Friday ${cName}`,
      artist: `The freshest new releases & drops this week in ${cName}`,
      query: `new music friday ${cName} 2025 2026 new releases`,
      targetGenres: ["pop", "hip-hop", "r&b", "indie", "dance"],
      keywords: ["2026", "2025", "new", ...(f1.keywords || [])],
      preferNewRelease: true,
      preferFresh: true,
    },
    {
      slot: "viral50",
      role: "viral",
      title: `Viral 50 – ${cName}`,
      artist: `Fastest-rising viral songs blowing up across ${cName}`,
      query: `viral 50 ${cName} trending tiktok reels hits 2025`,
      targetGenres: ["pop", "hip-hop", "dance", "electronic", "indie"],
      keywords: ["viral", "trending", ...(emg.keywords || []), ...(f2.keywords || [])],
      preferViral: true,
      preferFresh: true,
    },
    {
      slot: "hot_hits",
      role: "hot_pop",
      title: `Hot Hits ${cName}`,
      artist: `The biggest mainstream pop & radio anthems in ${cName}`,
      query: `${sq.pop || baseQ} hot hits 2025`,
      targetGenres: ["pop", "dance", "bollywood", "k-pop", "j-pop", "latin"],
      keywords: ["pop", ...(f1.keywords || [])],
      preferChart: true,
    },
    {
      slot: "trending_now",
      role: "trending_velocity",
      title: `Trending Now ${cName}`,
      artist: `Songs gaining the fastest momentum right now in ${cName}`,
      query: `${baseQ} trending now 2025 2026`,
      targetGenres: ["pop", "hip-hop", "r&b", "dance"],
      keywords: [...(f2.keywords || []), ...(rdr.keywords || [])],
      preferFresh: true,
      preferNewRelease: true,
    },
    {
      slot: "fresh_finds",
      role: "emerging",
      title: emg.title,
      artist: emg.artist,
      query: emg.query,
      targetGenres: ["indie", "alternative", "pop", "r&b"],
      keywords: emg.keywords || [],
      preferEmerging: true,
      preferNewRelease: true,
    },
    {
      slot: "radar",
      role: "radar",
      title: rdr.title,
      artist: rdr.artist,
      query: rdr.query,
      targetGenres: ["pop", "hip-hop", "indie", "r&b"],
      keywords: rdr.keywords || [],
      preferEmerging: true,
      preferFresh: true,
    },
    {
      slot: "flagship_1",
      role: "genre_flagship",
      title: f1.title,
      artist: f1.artist,
      query: f1.query,
      targetGenres: ["bollywood", "hip-hop", "pop", "k-pop", "j-pop", "afrobeats", "amapiano", "latin"],
      keywords: f1.keywords || [],
      preferChart: true,
    },
    {
      slot: "flagship_2",
      role: "genre_secondary",
      title: f2.title,
      artist: f2.artist,
      query: f2.query,
      targetGenres: ["punjabi", "country", "pop", "r&b", "anime", "sertanejo", "urbano"],
      keywords: f2.keywords || [],
      preferFresh: true,
    },
    {
      slot: "hiphop_heat",
      role: "hiphop",
      title: hh.title,
      artist: hh.artist,
      query: hh.query,
      targetGenres: ["hip-hop", "hiphop", "rap", "trap", "drill"],
      keywords: hh.keywords || ["hip-hop", "rap", "trap"],
    },
    {
      slot: "rnb_soul",
      role: "rnb",
      title: rnb.title,
      artist: rnb.artist,
      query: rnb.query,
      targetGenres: ["r&b", "rnb", "soul", "neo-soul"],
      keywords: rnb.keywords || ["r&b", "soul"],
    },
    {
      slot: "indie_alt",
      role: "indie",
      title: ind.title,
      artist: ind.artist,
      query: ind.query,
      targetGenres: ["indie", "alternative", "singer-songwriter", "folk"],
      keywords: ind.keywords || ["indie", "alternative"],
    },
    {
      slot: "dance_club",
      role: "dance",
      title: dnc.title,
      artist: dnc.artist,
      query: dnc.query,
      targetGenres: ["dance", "electronic", "house", "edm", "techno", "amapiano"],
      keywords: dnc.keywords || ["dance", "electronic", "house"],
    },
    {
      slot: "rock_energy",
      role: "rock",
      title: rck.title,
      artist: rck.artist,
      query: rck.query,
      targetGenres: ["rock", "alternative", "metal", "punk", "indie rock"],
      keywords: rck.keywords || ["rock", "band"],
    },
    {
      slot: "late_night_chill",
      role: "chill",
      title: chl.title,
      artist: chl.artist,
      query: chl.query,
      targetGenres: ["chill", "lofi", "indie", "r&b", "ambient"],
      keywords: chl.keywords || ["chill", "slow", "night"],
    },
    {
      slot: "romance_acoustic",
      role: "acoustic_romance",
      title: rom.title,
      artist: rom.artist,
      query: rom.query,
      targetGenres: ["pop", "singer-songwriter", "acoustic", "romance", "ballad"],
      keywords: rom.keywords || ["acoustic", "love", "romance"],
    },
    {
      slot: "workout_hype",
      role: "workout",
      title: `Beast Mode ${cName}`,
      artist: `High-octane workout & adrenaline anthems in ${cName}`,
      query: `${sq.dance || sq.hiphop || baseQ} workout gym motivation hype`,
      targetGenres: ["hip-hop", "dance", "electronic", "rock", "workout"],
      keywords: ["workout", "hype", "power", ...(hh.keywords || []).slice(0, 4), ...(dnc.keywords || []).slice(0, 4)],
    },
  ];

  return defs.slice(0, 17).map((d, idx) => ({
    id: `ctrend:${code}:${d.slot}`,
    slot: d.slot,
    role: d.role,
    index: idx,
    kind: "playlist",
    title: d.title,
    artist: d.artist,
    subtitle: d.artist,
    artwork: "",
    source: "youtube",
    playlistId: "",
    query: d.query,
    targetGenres: d.targetGenres || [],
    keywords: d.keywords || [],
    preferNewRelease: Boolean(d.preferNewRelease),
    preferChart: Boolean(d.preferChart),
    preferViral: Boolean(d.preferViral),
    preferEmerging: Boolean(d.preferEmerging),
    preferFresh: Boolean(d.preferFresh),
    _curatedTrending: true,
    tracks: [],
  }));
}

// Curated country-authentic recent releases & trending hits with releaseDate and role/genre tags
// [title, artist, duration, album, artwork, genre, releaseDate, roles]
export const COUNTRY_SEED_SONGS = {
  IN: [
    ["Aaj Ki Raat","Sachin-Jigar, Madhubanti Bagchi & Divya Kumar",228,"Stree 2","https://cdn-images.dzcdn.net/images/cover/1f8faf6b803911ad2d33ea66cacb3033/500x500-000000-80-0-0.jpg","bollywood","2025-08-01","chart_top,genre_flagship,dance"],
    ["Tauba Tauba","Karan Aujla",207,"Bad Newz","https://cdn-images.dzcdn.net/images/cover/ff6bb1420d9fcd2671cf6f86c2e49658/500x500-000000-80-0-0.jpg","punjabi","2025-07-02","chart_top,genre_secondary,dance"],
    ["Sajni","Ram Sampath & Arijit Singh",170,"Laapataa Ladies","https://cdn-images.dzcdn.net/images/cover/407e34575dc610b6592fda6d8210be18/500x500-000000-80-0-0.jpg","bollywood","2025-02-12","acoustic_romance,genre_flagship,chart_top"],
    ["Big Dawgs","Hanumankind & Kalmi",190,"Big Dawgs","https://cdn-images.dzcdn.net/images/cover/2d00c5a1488deb77bc1faa958f355b54/500x500-000000-80-0-0.jpg","hip-hop","2025-07-10","hiphop,viral,radar,workout"],
    ["Winning Speech","Karan Aujla & Mxrci",219,"Winning Speech","https://cdn-images.dzcdn.net/images/cover/b6ff41520784c1c1b8cbff7925817cd8/500x500-000000-80-0-0.jpg","punjabi","2025-03-20","genre_secondary,hiphop,workout"],
    ["born to shine","Diljit Dosanjh",213,"G.O.A.T.","https://cdn-images.dzcdn.net/images/cover/87516b74e8e95b373c57a5b74ff2a769/500x500-000000-80-0-0.jpg","punjabi","2025-01-15","genre_secondary,hot_pop,workout"],
    ["Husn","Anuv Jain",218,"Husn","https://cdn-images.dzcdn.net/images/cover/bdcf70737dc185ef7ec866fb29591137/500x500-000000-80-0-0.jpg","indie","2025-01-10","indie,chill,acoustic_romance"],
    ["Jo Tum Mere Ho","Anuv Jain",251,"Jo Tum Mere Ho","https://cdn-images.dzcdn.net/images/cover/d0e556f8fbdb2020f8cb4caf86611c2a/500x500-000000-80-0-0.jpg","indie","2025-08-02","new_releases,indie,trending_velocity"],
    ["Akhiyaan Gulaab","Mitraz",171,"Teri Baaton Mein Aisa Uljha Jiya","https://cdn-images.dzcdn.net/images/cover/8d786df765556de281ac3c502e49f643/500x500-000000-80-0-0.jpg","bollywood","2025-02-01","hot_pop,rnb,dance"],
    ["Pehle Bhi Main","Vishal Mishra",250,"Animal","https://cdn-images.dzcdn.net/images/cover/e8503eb01fce97c7427b794e8cd3c478/500x500-000000-80-0-0.jpg","bollywood","2024-12-01","acoustic_romance,genre_flagship"],
    ["Khat","Seedhe Maut & Bajao",198,"Lunch Break","https://cdn-images.dzcdn.net/images/cover/a9f93d7a3ab2ff3d1e2a6d4d1c47c105/500x500-000000-80-0-0.jpg","hip-hop","2025-05-14","hiphop,emerging,radar"],
    ["Prarthana","KR$NA",192,"For The Day Ones","https://cdn-images.dzcdn.net/images/cover/0c2035c5f905a7d31e192c2f113e2c6f/500x500-000000-80-0-0.jpg","hip-hop","2025-04-19","hiphop,workout"],
    ["Mirchi","DIVINE, MC Altaf & Stylo G",184,"Punya Paap","https://cdn-images.dzcdn.net/images/cover/209bb3f2ead009e3ea3c3265400a28cf/500x500-000000-80-0-0.jpg","hip-hop","2025-01-22","hiphop,dance,workout"],
    ["Maan Meri Jaan","King",194,"Champagne Talk","https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/90/9d/aa/909daa9a-3a47-9314-2855-39f5a157f1e3/5054197407734.jpg/500x500bb.jpg","r&b","2024-11-10","rnb,hot_pop,acoustic_romance"],
    ["Samjho Na","Aditya Rikhari",172,"Samjho Na","https://cdn-images.dzcdn.net/images/cover/8d54f8a03637b9f40ad387b6e46c8985/500x500-000000-80-0-0.jpg","indie","2025-06-11","emerging,indie,chill"],
    ["Wishes","Hasan Raheem & Talwiinder",188,"Nautanki","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c7/e5/02/c7e50222-40be-521e-b8e0-02df1aac4fde/17535.jpg/500x500bb.jpg","r&b","2025-07-18","rnb,emerging,radar,chill"],
    ["Choo Lo","The Local Train",233,"Aalas Ka Pedh","https://cdn-images.dzcdn.net/images/cover/8b26bfc0975e7c19dc45b3a0ee9360c9/500x500-000000-80-0-0.jpg","rock","2024-09-01","rock,indie"],
    ["Aaoge Tum Kabhi","The Local Train",312,"Aalas Ka Pedh","https://cdn-images.dzcdn.net/images/cover/8b26bfc0975e7c19dc45b3a0ee9360c9/500x500-000000-80-0-0.jpg","rock","2024-09-05","rock,acoustic_romance"],
    ["Kasoor","Prateek Kuhad",199,"In Tokens & Charms","https://cdn-images.dzcdn.net/images/cover/5703f7b99e90720b01978fbca7923e70/500x500-000000-80-0-0.jpg","indie","2024-10-12","indie,chill,acoustic_romance"],
    ["Udd Gaye","Ritviz",180,"Ved","https://cdn-images.dzcdn.net/images/cover/0d6a03d9ec7c93ad31203f09216cfbf1/500x500-000000-80-0-0.jpg","dance","2025-01-08","dance,indie,viral"],
    ["One Love","Shubh",159,"One Love","https://cdn-images.dzcdn.net/images/cover/9b315dd75419b5f893cb84a1ff2e8ef0/500x500-000000-80-0-0.jpg","punjabi","2025-05-02","genre_secondary,trending_velocity,viral"],
    ["King Shit","Shubh",207,"Leo","https://cdn-images.dzcdn.net/images/cover/412f1e05bbbc1d5f17018e9a4e6b40ec/500x500-000000-80-0-0.jpg","punjabi","2025-04-28","workout,hiphop,genre_secondary"],
    ["With You","AP Dhillon",154,"With You","https://cdn-images.dzcdn.net/images/cover/ff7878c3ecade62c69ea2e10d4ec1ce8/500x500-000000-80-0-0.jpg","punjabi","2025-06-25","rnb,chill,genre_secondary"],
    ["Chaleya","Arijit Singh & Shilpa Rao",200,"Jawan","https://cdn-images.dzcdn.net/images/cover/87965798331705639c8965c7fc100ffc/500x500-000000-80-0-0.jpg","bollywood","2025-01-19","genre_flagship,hot_pop,dance"],
    ["Nadaaniyan","Akshath",169,"Nadaaniyan","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b8/29/f1/b829f155-0534-0808-8a6d-f168f9df3d4a/24UMGIM56452.rgb.jpg/500x500bb.jpg","indie","2025-08-19","new_releases,viral,emerging,radar"],
    ["Ishq","Faheem Abdullah & Rauhan Malik",226,"Lost;Found","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a3/04/c1/a304c107-6887-c475-8377-d05e86cfe108/cover.jpg/500x500bb.jpg","indie","2025-07-30","new_releases,viral,chill,acoustic_romance"],
    ["Katchi Sera","Sai Abhyankkar",182,"Katchi Sera","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/80/df/08/80df0808-17e7-ab41-5972-fec5f83e3819/cover.jpg/500x500bb.jpg","pop","2025-06-14","viral,radar,dance,trending_velocity"],
    ["Illuminati","Sushin Shyam & Dabzee",215,"Aavesham","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/88/4e/29/884e290c-29ed-25d5-7b25-243b89097220/cover.jpg/500x500bb.jpg","dance","2025-05-29","workout,dance,viral,trending_velocity"],
    ["Naina","Diljit Dosanjh & Badshah",180,"Crew","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/7b/bf/bd7bbfbd-8711-b6da-473a-7dd35b2d753b/8901854099214.jpg/500x500bb.jpg","bollywood","2025-04-10","dance,hot_pop,genre_flagship"],
    ["Soulmate","Badshah & Arijit Singh",213,"Ek Tha Raja","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a9/c7/32/a9c732cc-d880-1ee4-ff22-d01593ac6341/24UMGIM22464.rgb.jpg/500x500bb.jpg","bollywood","2025-05-09","new_releases,hot_pop,rnb"],
    ["millionaire","Yo Yo Honey Singh",199,"Glory","https://is1-ssl.mzstatic.com/image/thumb/Music128/v4/cf/cd/24/cfcd248a-cbbd-10dd-7d25-894bbf9b9f20/8902633288584.jpg/500x500bb.jpg","hip-hop","2025-08-26","new_releases,trending_velocity,hiphop,workout"],
    ["Taras","Sachin-Jigar & Jasmine Sandlas",188,"Munjya","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/7d/91/c8/7d91c851-00b0-6d25-9af8-865c32a75393/8909024032016.png/500x500bb.jpg","dance","2025-06-07","dance,new_releases,genre_flagship"],
    ["Khudaya","Sagar Bhatia & Neeti Mohan",224,"Sarfira","https://cdn-images.dzcdn.net/images/cover/53bdfe2ba9539665069498cf4a44da4d/500x500-000000-80-0-0.jpg","bollywood","2025-07-04","acoustic_romance,chill"],
    ["Soni Soni","Darshan Raval & Jonita Gandhi",176,"Ishq Vishk Rebound","https://cdn-images.dzcdn.net/images/cover/86a67dbe69bd2769bf1e20f1f4a5ad27/500x500-000000-80-0-0.jpg","pop","2025-06-21","hot_pop,rnb,new_releases"],
    ["Khoobsurat","Vishal Mishra & Sachin-Jigar",244,"Stree 2","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/2d/e2/f7/2de2f7e0-b66f-50e8-ba18-e0ab41bec525/198846028354.jpg/500x500bb.jpg","bollywood","2025-08-09","new_releases,acoustic_romance,genre_flagship"],
    ["Tumhare Hi Rahenge Hum","Varun Jain, Shilpa Rao & Sachin-Jigar",230,"Stree 2","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/d3/37/eb/d337eb52-2663-826d-d213-335598b14743/198846005553.jpg/500x500bb.jpg","bollywood","2025-08-06","acoustic_romance,genre_flagship"],
    ["Aayi Nai","Sachin-Jigar, Pawan Singh & Simran Choudhary",178,"Stree 2","https://cdn-images.dzcdn.net/images/cover/c85e4d98787aa04833e9682f90e56fb5/500x500-000000-80-0-0.jpg","dance","2025-08-03","dance,viral,trending_velocity"],
    ["Khel Khel Mein","Guru Randhawa, Diljit Dosanjh & Badshah",195,"Khel Khel Mein","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","punjabi","2025-08-12","new_releases,dance,genre_secondary"],
    ["Hauli Hauli","Guru Randhawa, Yo Yo Honey Singh & Neha Kakkar",189,"Khel Khel Mein","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/27/58/c3275887-784f-4ad4-e05d-215c5f9dfbbc/8903431009845_cover.jpg/500x500bb.jpg","dance","2025-08-14","dance,hot_pop"],
    ["Guli Mata","Saad Lamjarred & Shreya Ghoshal",234,"Guli Mata","https://cdn-images.dzcdn.net/images/cover/d2b0e3341b6cabf610dec963e3d527da/500x500-000000-80-0-0.jpg","pop","2025-03-11","hot_pop,viral"],
    ["Heeriye","Jasleen Royal & Arijit Singh",194,"Heeriye","https://cdn-images.dzcdn.net/images/cover/6b06bbbf7c2d9c6bcb60763bccc0571d/500x500-000000-80-0-0.jpg","pop","2025-01-25","hot_pop,acoustic_romance,chart_top"],
    ["Satranga","Arijit Singh, Shreyas Puranik",271,"Animal","https://cdn-images.dzcdn.net/images/cover/e8503eb01fce97c7427b794e8cd3c478/500x500-000000-80-0-0.jpg","bollywood","2024-11-28","acoustic_romance,genre_flagship"],
    ["Arjan Vailly","Bhupinder Babbal",182,"Animal","https://cdn-images.dzcdn.net/images/cover/e8503eb01fce97c7427b794e8cd3c478/500x500-000000-80-0-0.jpg","punjabi","2025-01-04","workout,genre_secondary"],
    ["Apna Bana Le","Sachin-Jigar & Arijit Singh",261,"Bhediya","https://cdn-images.dzcdn.net/images/cover/5e2aaa0f0a9b4bccfdf01c447f2e169c/500x500-000000-80-0-0.jpg","bollywood","2024-10-15","acoustic_romance,chill"],
    ["Lalkara","Diljit Dosanjh & Sultaan",160,"Ghost","https://cdn-images.dzcdn.net/images/cover/91d4d713bec4015e35798c409425e7b7/500x500-000000-80-0-0.jpg","punjabi","2025-04-02","workout,hiphop,genre_secondary"],
    ["Hass Hass","Diljit Dosanjh, Sia & Greg Kurstin",153,"Hass Hass","https://cdn-images.dzcdn.net/images/cover/664682cefadc721cc099f1e652276eca/500x500-000000-80-0-0.jpg","punjabi","2025-03-19","hot_pop,genre_secondary,viral"],
    ["Softly","Karan Aujla & Ikky",155,"Making Memories","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","punjabi","2025-02-18","rnb,chill,genre_secondary"],
    ["Admirin' You","Karan Aujla & Ikky",214,"Making Memories","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/d3/08/bc/d308bc6a-20e1-6532-d933-35d1b429210e/5054197755538.jpg/500x500bb.jpg","punjabi","2025-03-08","rnb,genre_secondary"],
    ["IDK How","Karan Aujla",174,"Street Dreams","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c2/ce/a0/c2cea088-dbde-43db-346f-e536058fdcfb/5063483978438_cover.jpg/500x500bb.jpg","hip-hop","2025-07-24","hiphop,trending_velocity"],
    ["100 Million","DIVINE & Karan Aujla",191,"Street Dreams","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/bf/e1/19/bfe1195d-18c3-4f40-0a18-19beef6de0ca/197190848762.jpg/500x500bb.jpg","hip-hop","2025-06-16","hiphop,workout"],
    ["Baazigar","DIVINE & Armani White",177,"Gunehgar","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/97/d9/cf/97d9cf4f-abb1-c6b0-f4ea-be275658cc9b/197338226643.jpg/500x500bb.jpg","hip-hop","2025-02-09","hiphop,viral"],
    ["Joota Japani","KR$NA & Umair",165,"Joota Japani","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/53/6e/3d/536e3d41-fe71-9b51-d242-239d3050d66a/197190909999.jpg/500x500bb.jpg","hip-hop","2025-05-25","hiphop,trending_velocity"],
    ["Namastute","Seedhe Maut",160,"N","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/8c/3c/10/8c3c1016-be7e-666c-225d-00b671fb38e0/199066150108.jpg/500x500bb.jpg","hip-hop","2025-03-14","hiphop,workout"],
    ["Luka Chuppi","Seedhe Maut & Bandzo3rd",172,"Lunch Break","https://cdn-images.dzcdn.net/images/cover/a9f93d7a3ab2ff3d1e2a6d4d1c47c105/500x500-000000-80-0-0.jpg","hip-hop","2025-06-02","hiphop,radar,emerging"],
    ["Tu Hai Kahan","AUR",263,"Tu Hai Kahan","https://cdn-images.dzcdn.net/images/cover/12d66b492d1e4792fec0c4d0ad754ded/500x500-000000-80-0-0.jpg","indie","2025-04-05","indie,chill,viral"],
    ["Shikayat","AUR",242,"Shikayat","https://cdn-images.dzcdn.net/images/cover/525221c08c67990a64b3f7adb3c368c8/500x500-000000-80-0-0.jpg","indie","2025-05-19","indie,emerging,chill"],
    ["Alag Aasmaan","Anuv Jain",212,"Alag Aasmaan","https://cdn-images.dzcdn.net/images/cover/1ed1f36c80fe430ca97098f68fc074e6/500x500-000000-80-0-0.jpg","indie","2024-09-12","indie,chill,acoustic_romance"],
    ["Baarishein","Anuv Jain",207,"Baarishein","https://cdn-images.dzcdn.net/images/cover/b4fcda10b32a70d8b9248ca7f6459903/500x500-000000-80-0-0.jpg","indie","2024-08-20","indie,chill"],
    ["Co2","Prateek Kuhad",163,"The Way That Lovers Do","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/b2/5e/13b25e33-746d-9567-0c36-b11af5b55ab0/075679754943.jpg/500x500bb.jpg","indie","2025-02-14","indie,chill,rnb"],
    ["Dil Mere","The Local Train",211,"Aalas Ka Pedh","https://cdn-images.dzcdn.net/images/cover/8b26bfc0975e7c19dc45b3a0ee9360c9/500x500-000000-80-0-0.jpg","rock","2024-09-18","rock,indie"],
    ["Khudi","The Local Train",287,"Vaaqif","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/6e/4c/59/6e4c59e9-342c-3da7-fc09-61959c95dcb5/197189936456.jpg/500x500bb.jpg","rock","2024-10-02","rock,workout"],
    ["Roz","Ritviz & Nucleya",206,"Baaraat","https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/b2/86/a6/b286a68d-3b65-499f-03f0-6f32d96f7eb7/859750782298_cover.jpg/500x500bb.jpg","dance","2025-03-22","dance,indie"],
    ["Liggi","Ritviz",181,"Dev","https://cdn-images.dzcdn.net/images/cover/d5f7a76e0c682b5d17cdb9aee1aa4a14/500x500-000000-80-0-0.jpg","dance","2025-02-28","dance,hot_pop"],
    ["Khayaal","Talwiinder & NDS",168,"Khayaal","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/da/22/b8/da22b844-b237-c414-2111-79276423c340/196589947482.jpg/500x500bb.jpg","r&b","2025-08-08","new_releases,emerging,radar,rnb"],
    ["Dhundhala","Yashraj, Dropped Out & Talwiinder",174,"Dhundhala","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/30/63/c3/3063c36c-8537-ce66-4451-e9de6c2a13dc/23UM1IM04836.rgb.jpg/500x500bb.jpg","r&b","2025-06-30","radar,emerging,rnb,hiphop"],
    ["Daku","Chani Nattan & Inderpal Moga",131,"Daku","https://cdn-images.dzcdn.net/images/cover/4f6b75ee8d72644714ae5254efb27631/500x500-000000-80-0-0.jpg","punjabi","2025-04-12","workout,emerging,genre_secondary"],
    ["mvp","Shubh",195,"mvp","https://cdn-images.dzcdn.net/images/cover/412f1e05bbbc1d5f17018e9a4e6b40ec/500x500-000000-80-0-0.jpg","punjabi","2025-08-18","new_releases,trending_velocity,genre_secondary"],
    ["Bandana","Shubh",168,"Sicario","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/79/1d/f0791dcd-5415-61b1-cd67-94660c46e189/5021732271709.jpg/500x500bb.jpg","punjabi","2025-07-12","trending_velocity,workout,hiphop"],
    ["Tu Aake Dekhle","King",270,"The Carnival","https://cdn-images.dzcdn.net/images/cover/934455d83d61359aa0d904bdfe86e5f2/500x500-000000-80-0-0.jpg","r&b","2025-01-30","rnb,hot_pop"],
    ["Sarkaare","King",162,"New Life","https://cdn-images.dzcdn.net/images/cover/04a936117dd468270341c0df589781ea/500x500-000000-80-0-0.jpg","pop","2025-05-04","hot_pop,dance"],
    ["Faasle","Aditya Rikhari",215,"Faasle","https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/d5/29/29/d5292970-e6e4-1199-baed-22c8c9f60988/cover.jpg/500x500bb.jpg","indie","2025-07-09","emerging,indie,acoustic_romance"],
    ["Teri Yaad","Aditya Rikhari",198,"Teri Yaad","https://is1-ssl.mzstatic.com/image/thumb/Music113/v4/3d/45/11/3d451107-117e-c7b1-340a-bb730846c3d3/23UMGIM07285.rgb.jpg/500x500bb.jpg","indie","2025-08-21","new_releases,emerging,indie"],
    ["Gulabi Sadi","Sanju Rathod & G-SPXRK",177,"Gulabi Sadi","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/13/2d/eb/132deb17-aee2-6b64-d0cc-6446c213375d/cover.jpg/500x500bb.jpg","dance","2025-06-18","viral,radar,dance"],
    ["Aasa Kooda","Sai Abhyankkar & Sai Smriti",215,"Aasa Kooda","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/39/42/ba/3942ba45-40bd-5d0a-d7ad-0595f1336f3f/cover.jpg/500x500bb.jpg","pop","2025-08-11","new_releases,viral,radar,trending_velocity"],
    ["Paon Ki Jutti","Jyoti Nooran",183,"Paon Ki Jutti","https://cdn-images.dzcdn.net/images/cover/6f88346b2818313ccadbde509a411832/500x500-000000-80-0-0.jpg","punjabi","2025-06-05","viral,dance"],
    ["Mahिये Jinna Sohna","Darshan Raval",181,"Dard","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/4b/73/1e/4b731eb5-13ab-825a-d164-fc665b2f02e5/5054197730122.jpg/500x500bb.jpg","pop","2025-02-07","acoustic_romance,hot_pop"],
  ],
  GLOBAL: [
    ["APT.","ROSÉ & Bruno Mars",170,"rosie","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","pop","2025-08-25","chart_top,new_releases,viral,hot_pop"],
    ["luther","Kendrick Lamar & SZA",177,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-22","chart_top,new_releases,hiphop,rnb"],
    ["tv off","Kendrick Lamar feat. Lefty Gunplay",220,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-22","hiphop,new_releases,workout,genre_flagship"],
    ["squabble up","Kendrick Lamar",157,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-23","hiphop,trending_velocity,workout"],
    ["Sailor Song","Gigi Perez",211,"Sailor Song","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/25/d4/96/25d49699-acc0-401f-a7cc-d7697339a474/24UM1IM03751.rgb.jpg/500x500bb.jpg","indie","2025-07-26","emerging,radar,indie,viral"],
    ["Messy","Lola Young",284,"This Wasn't Meant For You Anyway","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5a/c6/b1/5ac6b183-8ff1-55e3-fa59-8cce5db3fc87/24UMGIM52751.rgb.jpg/500x500bb.jpg","indie","2025-08-14","viral,emerging,radar,indie"],
    ["That's So True","Gracie Abrams",166,"The Secret of Us (Deluxe)","https://cdn-images.dzcdn.net/images/cover/967769c4612d74e8f5c7da8798b28e13/500x500-000000-80-0-0.jpg","pop","2025-08-18","new_releases,trending_velocity,hot_pop,indie"],
    ["Close To You","Gracie Abrams",225,"The Secret of Us","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/52/9a/a7/529aa76f-5d60-cd81-9eb0-0eb521de861d/24UMGIM43968.rgb.jpg/500x500bb.jpg","indie","2025-06-07","indie,hot_pop"],
    ["DENIAL IS A RIVER","Doechii",159,"Alligator Bites Never Heal","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5f/a3/e8/5fa3e8b9-9065-47af-63e1-f213d3074580/24UMGIM88644.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-15","radar,emerging,hiphop,viral"],
    ["NISSAN ALTIMA","Doechii",126,"Alligator Bites Never Heal","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ec/cc/d6/ecccd6d4-2250-5caf-a98d-1ba10baf67f5/24UMGIM88644.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-04","radar,hiphop,workout"],
    ["Sports car","Tate McRae",165,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/51/8a/29/518a29f3-5915-662a-d861-663e6d0fbfe4/196872648911.jpg/500x500bb.jpg","pop","2025-08-24","new_releases,trending_velocity,dance,hot_pop"],
    ["It's ok I'm ok","Tate McRae",156,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","pop","2025-07-12","hot_pop,dance"],
    ["The Emptiness Machine","Linkin Park",190,"From Zero","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/85/cf/a1/85cfa1ed-d8f6-d021-2a9e-cb541b2bbe87/artwork.jpg/500x500bb.jpg","rock","2025-08-05","rock,new_releases,workout"],
    ["Heavy Is the Crown","Linkin Park",167,"From Zero","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/69/21/cf/6921cff3-7074-118a-ece2-4012450e6c75/093624839811.jpg/500x500bb.jpg","rock","2025-08-19","rock,workout,new_releases"],
    ["Love Somebody","Morgan Wallen",204,"Love Somebody","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","country","2025-08-10","genre_secondary,chart_top,new_releases"],
    ["Lies Lies Lies","Morgan Wallen",198,"Lies Lies Lies","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/0e/6d/e1/0e6de152-3ff5-84a3-7ce7-7dfbdcb2c3e1/24UMGIM96374.rgb.jpg/500x500bb.jpg","country","2025-07-05","genre_secondary,acoustic_romance"],
    ["Timeless","The Weeknd & Playboi Carti",256,"Hurry Up Tomorrow","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","r&b","2025-08-20","new_releases,rnb,hiphop,trending_velocity"],
    ["Dancing In The Flames","The Weeknd",220,"Hurry Up Tomorrow","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","pop","2025-08-13","new_releases,hot_pop,dance"],
    ["Abracadabra","Lady Gaga",223,"MAYHEM","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","dance","2025-08-26","new_releases,dance,hot_pop,trending_velocity"],
    ["Disease","Lady Gaga",229,"MAYHEM","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","pop","2025-08-02","hot_pop,dance"],
    ["Sticky","Tyler, The Creator feat. GloRilla, Sexyy Red & Lil Wayne",255,"CHROMAKOPIA","https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6d/31/ab/6d31abaf-7a07-05f1-13ad-72ec520b6bfb/22UMGIM67374.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-16","hiphop,new_releases,workout,genre_flagship"],
    ["St. Chroma","Tyler, The Creator feat. Daniel Caesar",197,"CHROMAKOPIA","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","hip-hop","2025-08-15","hiphop,rnb,indie"],
    ["Wildflower","Billie Eilish",261,"HIT ME HARD AND SOFT","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","indie","2025-05-17","chill,indie,acoustic_romance"],
    ["Chihiro","Billie Eilish",303,"HIT ME HARD AND SOFT","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/92/9f/69/929f69f1-9977-3a44-d674-11f70c852d1b/24UMGIM36186.rgb.jpg/500x500bb.jpg","indie","2025-05-17","chill,indie,dance"],
    ["Bed Chem","Sabrina Carpenter",171,"Short n' Sweet","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f6/15/d0/f615d0ab-e0c4-575d-907e-1cc084642357/24UMGIM61704.rgb.jpg/500x500bb.jpg","pop","2025-08-09","rnb,hot_pop,trending_velocity"],
    ["Juno","Sabrina Carpenter",223,"Short n' Sweet","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/1c/ca/a11ccab6-7d4c-e041-d028-998bcebeb709/24UMGIM61704.rgb.jpg/500x500bb.jpg","pop","2025-08-09","hot_pop,indie"],
    ["Pink Pony Club","Chappell Roan",258,"The Rise and Fall of a Midwest Princess","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/41/bc/fb/41bcfb43-91d5-931d-5747-fb381803143f/23UMGIM21715.rgb.jpg/500x500bb.jpg","pop","2025-04-18","viral,radar,hot_pop,dance"],
    ["HOT TO GO!","Chappell Roan",184,"The Rise and Fall of a Midwest Princess","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","pop","2025-05-01","dance,workout,viral"],
    ["Diet Pepsi","Addison Rae",169,"Diet Pepsi","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/01/ef/7a/01ef7a06-1b48-0460-efbf-983d6a0a37fa/196872309959.jpg/500x500bb.jpg","pop","2025-08-09","viral,emerging,radar,chill"],
    ["Ordinary","Alex Warren",186,"You'll Be Alright, Kid","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","pop","2025-08-21","new_releases,emerging,acoustic_romance,trending_velocity"],
    ["Carry You Home","Alex Warren",166,"You'll Be Alright, Kid","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","pop","2025-06-15","emerging,acoustic_romance"],
    ["back to friends","sombr",198,"back to friends","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-08-17","emerging,radar,indie,viral"],
    ["undressed","sombr",174,"undressed","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-08-01","emerging,indie,chill"],
    ["Mutts","Leon Thomas",192,"MUTT","https://cdn-images.dzcdn.net/images/cover/1c318762a31c79bd28e9f7951bdab5b4/500x500-000000-80-0-0.jpg","r&b","2025-07-29","rnb,emerging,radar,chill"],
    ["TGIF","GloRilla",164,"GLORIOUS","https://cdn-images.dzcdn.net/images/cover/a65e86966cfd34b2aa292856136ef9ac/500x500-000000-80-0-0.jpg","hip-hop","2025-07-19","hiphop,workout,viral"],
    ["Whatchu Kno About Me","GloRilla & Sexyy Red",149,"GLORIOUS","https://cdn-images.dzcdn.net/images/cover/a65e86966cfd34b2aa292856136ef9ac/500x500-000000-80-0-0.jpg","hip-hop","2025-08-11","hiphop,trending_velocity"],
    ["360","Charli xcx",133,"BRAT","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","dance","2025-06-07","dance,viral,trending_velocity"],
    ["Von dutch","Charli xcx",164,"BRAT","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","dance","2025-05-10","dance,workout"],
    ["Guess","Charli xcx feat. Billie Eilish",145,"BRAT","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cf/0b/2b/cf0b2bae-d4c1-49ce-de5c-b7c3fcd9e4cd/075679643087.jpg/500x500bb.jpg","dance","2025-08-02","dance,new_releases,viral"],
    ["Where You Are","John Summit & Hayla",236,"Comfort in Chaos","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/26/86/a9/2686a9dc-0a17-8e7f-82e3-9bb7c53c1494/23UMGIM19042.rgb.jpg/500x500bb.jpg","dance","2025-07-12","dance,workout"],
    ["Shiver","John Summit & Hayla",228,"Comfort in Chaos","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e7/21/67/e721675b-c3a3-9338-bf24-9adb295b7e90/24UMGIM58701.rgb.jpg/500x500bb.jpg","dance","2025-07-14","dance,chill"],
    ["places to be","Fred again.., Anderson .Paak & CHIKA",226,"ten days","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/fc/e8/81/fce8814b-c3c2-3cf1-8294-791326b9801e/cover.jpg/500x500bb.jpg","dance","2025-07-28","dance,new_releases"],
    ["BAND4BAND","Central Cee & Lil Baby",140,"BAND4BAND","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/e1/2d/c5/e12dc546-b50d-5a06-58cf-94227b0c78b9/196872154931.jpg/500x500bb.jpg","hip-hop","2025-05-24","hiphop,workout,genre_flagship"],
    [" Did It First","Ice Spice & Central Cee",118,"Y2K!","https://cdn-images.dzcdn.net/images/cover/8508be30ca355ef44597e9be0f834232/500x500-000000-80-0-0.jpg","hip-hop","2025-07-12","hiphop,viral"],
    ["KEHLANI","Jordan Adetunji",122,"KEHLANI","https://cdn-images.dzcdn.net/images/cover/1c318762a31c79bd28e9f7951bdab5b4/500x500-000000-80-0-0.jpg","r&b","2025-06-20","rnb,viral,emerging,radar"],
    ["After Hours","Kehlani",202,"CRASH","https://cdn-images.dzcdn.net/images/cover/1c318762a31c79bd28e9f7951bdab5b4/500x500-000000-80-0-0.jpg","r&b","2025-06-21","rnb,dance"],
    ["BMF","SZA",181,"SOS Deluxe: LANA","https://cdn-images.dzcdn.net/images/cover/992cc838b5f0cf0eebbd83011a979571/500x500-000000-80-0-0.jpg","r&b","2025-08-20","new_releases,rnb,trending_velocity"],
    ["30 For 30","SZA & Kendrick Lamar",278,"SOS Deluxe: LANA","https://cdn-images.dzcdn.net/images/cover/992cc838b5f0cf0eebbd83011a979571/500x500-000000-80-0-0.jpg","r&b","2025-08-20","new_releases,rnb,hiphop"],
    ["Pink Skies","Zach Bryan",194,"The Great American Bar Scene","https://cdn-images.dzcdn.net/images/cover/7060ea038f51fdeff23bc40eb5027663/500x500-000000-80-0-0.jpg","country","2025-05-24","genre_secondary,acoustic_romance,indie"],
    ["28","Zach Bryan",233,"The Great American Bar Scene","https://cdn-images.dzcdn.net/images/cover/7060ea038f51fdeff23bc40eb5027663/500x500-000000-80-0-0.jpg","country","2025-07-04","genre_secondary,acoustic_romance"],
    ["Ain't No Love In Oklahoma","Luke Combs",210,"Twisters","https://cdn-images.dzcdn.net/images/cover/473abf39f40221437fb7c590e36b7282/500x500-000000-80-0-0.jpg","country","2025-06-16","genre_secondary,rock,workout"],
    ["Pour Me A Drink","Post Malone feat. Blake Shelton",195,"F-1 Trillion","https://cdn-images.dzcdn.net/images/cover/473abf39f40221437fb7c590e36b7282/500x500-000000-80-0-0.jpg","country","2025-06-21","genre_secondary,hot_pop"],
    ["Guy For That","Post Malone feat. Luke Combs",164,"F-1 Trillion","https://cdn-images.dzcdn.net/images/cover/473abf39f40221437fb7c590e36b7282/500x500-000000-80-0-0.jpg","country","2025-07-26","genre_secondary,new_releases"],
    ["I Am Not Okay","Jelly Roll",198,"Beautifully Broken","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","country","2025-06-12","genre_secondary,rock,acoustic_romance"],
    ["Good News","Shaboozey",200,"Where I've Been, Isn't Where I'm Going","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/23/f2/d9/23f2d96d-b842-5f8b-1a09-bcc9a5cf7032/197342797344_cover.jpg/500x500bb.jpg","country","2025-08-15","new_releases,genre_secondary,radar"],
    ["Austin (Boots Stop Workin')","Dasha",171,"What Happens Now?","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/85/b5/b0/85b5b00b-ca94-dfa1-a3cf-2da4a1e3dd39/054391277657.jpg/500x500bb.jpg","country","2025-04-12","viral,radar,genre_secondary,dance"],
    ["Wind Up Missin' You","Tucker Wetmore",166,"Waves on a Sunset","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/a1/54/e2/a154e275-9a98-3491-26cf-a1c6f3fb4ea1/24UMGIM54949.rgb.jpg/500x500bb.jpg","country","2025-05-30","emerging,radar,genre_secondary"],
    ["Am I Okay?","Megan Moroney",235,"Am I Okay?","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/de/2a/43/de2a438b-bb7c-16db-64db-954057aca5aa/196872040302.jpg/500x500bb.jpg","country","2025-07-12","genre_secondary,radar"],
    ["Juna","Clairo",195,"Charm","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-07-12","indie,chill,emerging"],
    ["Nomad","Clairo",225,"Charm","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-07-12","indie,chill"],
    ["Take A Bite","beabadoobee",178,"This Is How Tomorrow Moves","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-08-09","indie,rock"],
    ["Beaches","beabadoobee",230,"This Is How Tomorrow Moves","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-08-09","indie,chill,new_releases"],
    ["Sally, When The Wine Runs Out","Role Model",188,"Kansas Anymore","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-07-19","indie,emerging,chill"],
    ["Love Me Not","Ravyn Lenae",213,"Bird's Eye","https://cdn-images.dzcdn.net/images/cover/1c318762a31c79bd28e9f7951bdab5b4/500x500-000000-80-0-0.jpg","r&b","2025-08-09","emerging,rnb,indie,viral"],
    ["Chest Pain (I Love)","Malcolm Todd",174,"Sweet Boy","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-08-04","emerging,radar,indie"],
    ["Alesis","Mk.gee",191,"Two Star & the Dream Police","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-05-15","emerging,indie,chill"],
    ["I like the way you kiss me","Artemas",142,"pretty","https://cdn-images.dzcdn.net/images/cover/ee890cf16d00c684be76b0087c7108c4/500x500-000000-80-0-0.jpg","indie","2025-04-29","viral,indie,dance"],
    ["Favourite","Fontaines D.C.",256,"Romance","https://cdn-images.dzcdn.net/images/cover/1e8ffbd401303b5693226c12ee0b84fb/500x500-000000-80-0-0.jpg","rock","2025-08-23","rock,indie,new_releases"],
    ["Starburster","Fontaines D.C.",221,"Romance","https://cdn-images.dzcdn.net/images/cover/1e8ffbd401303b5693226c12ee0b84fb/500x500-000000-80-0-0.jpg","rock","2025-07-18","rock,workout"],
    ["People Watching","Sam Fender",295,"People Watching","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bd/8c/24/bd8c2468-7978-cace-67b1-e0b3e5a643b8/24UM1IM05583.rgb.jpg/500x500bb.jpg","rock","2025-08-22","rock,indie,new_releases"],
    ["Nothing Matters","The Last Dinner Party",181,"Prelude to Ecstasy","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/69/74/ab/6974abd9-0415-aa60-240c-b2fac4c62e1b/23UMGIM23237.rgb.jpg/500x500bb.jpg","rock","2025-04-08","rock,indie,emerging"],
    ["The Summoning","Sleep Token",395,"Take Me Back To Eden","https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/e2/c6/0f/e2c60f68-7cec-fa08-6dd3-891aa72c247e/5401148000849_cover.jpg/500x500bb.jpg","rock","2025-02-11","rock,workout"],
    ["Just Pretend","Bad Omens",204,"THE DEATH OF PEACE OF MIND","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/f0/ce/0d/f0ce0d9c-934d-770d-e62f-74564fc410e1/00810016765424_Cover.jpg/500x500bb.jpg","rock","2025-03-05","rock,workout"],
    ["Slow It Down","Benson Boone",161,"Fireworks & Rollerblades","https://cdn-images.dzcdn.net/images/cover/e8947b2a3e00fde8763011ebee2a02fd/500x500-000000-80-0-0.jpg","pop","2025-05-11","acoustic_romance,hot_pop"],
    ["Bad Dreams","Teddy Swims",184,"I've Tried Everything But Therapy (Part 2)","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","r&b","2025-08-20","new_releases,rnb,acoustic_romance,trending_velocity"],
    ["The Door","Teddy Swims",212,"I've Tried Everything But Therapy","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","r&b","2025-04-19","rnb,acoustic_romance"],
    ["From The Start","Laufey",169,"Bewitched","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-02-14","chill,acoustic_romance,indie"],
    ["Goddess","Laufey",267,"Bewitched: The Goddess Edition","https://cdn-images.dzcdn.net/images/cover/6dfa4ea965a74b93870a85daa74b7ca3/500x500-000000-80-0-0.jpg","indie","2025-04-26","chill,acoustic_romance"],
    ["Whiplash","aespa",183,"Whiplash","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","k-pop","2025-08-18","new_releases,dance,workout,trending_velocity"],
    ["Mantra","JENNIE",136,"Ruby","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","k-pop","2025-08-11","new_releases,dance,hot_pop,viral"],
    ["Chk Chk Boom","Stray Kids",148,"ATE","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","k-pop","2025-07-19","workout,hiphop,dance"],
    ["Magnetic","ILLIT",160,"SUPER REAL ME","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","k-pop","2025-04-25","viral,radar,dance"],
    ["Bling-Bang-Bang-Born","Creepy Nuts",168,"LEGION","https://cdn-images.dzcdn.net/images/cover/74a47f9832735b37a41d8fd49cd23354/500x500-000000-80-0-0.jpg","j-pop","2025-03-10","viral,workout,hiphop"],
    ["Otonoke","Creepy Nuts",185,"LEGION","https://cdn-images.dzcdn.net/images/cover/74a47f9832735b37a41d8fd49cd23354/500x500-000000-80-0-0.jpg","j-pop","2025-08-04","new_releases,viral,trending_velocity"],
    ["Lilac","Mrs. GREEN APPLE",289,"Lilac","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/4c/3b/b2/4c3bb247-3be8-0c57-aa9a-7f1775a7b7a8/24UMGIM32931.rgb.jpg/500x500bb.jpg","j-pop","2025-05-12","rock,chart_top"],
    ["OZAKA","Rema",186,"HEIS","https://cdn-images.dzcdn.net/images/cover/cb415a59a7bc198ec4aab01f02600691/500x500-000000-80-0-0.jpg","afrobeats","2025-07-11","dance,workout,trending_velocity"],
    ["Active","Asake & Travis Scott",172,"Lungu Boy","https://is1-ssl.mzstatic.com/image/thumb/Music114/v4/dc/b7/78/dcb7782e-3100-b227-ed40-985954cfc6c8/artwork.jpg/500x500bb.jpg","afrobeats","2025-08-07","new_releases,dance,hiphop"],
    ["Kese (Dance)","Wizkid",174,"Morayo","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/82/60/3b/82603b3c-1aad-6e37-3b81-d5451046accf/196872637434.jpg/500x500bb.jpg","afrobeats","2025-08-22","new_releases,dance,rnb"],
    ["Push 2 Start","Tyla",156,"TYLA +","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/2a/cc/48/2acc48c7-e092-6b83-ce65-ff80ac6eb51c/196872520118.jpg/500x500bb.jpg","amapiano","2025-08-14","new_releases,dance,rnb,viral"],
    ["Tshwala Bam","TitoM & Yuppe",242,"Tshwala Bam","https://cdn-images.dzcdn.net/images/cover/e70f7518f5dbe0b0be643cbabc87ca4b/500x500-000000-80-0-0.jpg","amapiano","2025-05-15","dance,viral"],
    ["Si Antes Te Hubiera Conocido","KAROL G",195,"Si Antes Te Hubiera Conocido","https://cdn-images.dzcdn.net/images/cover/2a769f6f0cce0ca9e129ce4b61f83973/500x500-000000-80-0-0.jpg","latin","2025-06-21","dance,hot_pop,chart_top"],
    ["DtMF","Bad Bunny",237,"DeBÍ TiRAR MáS FOToS","https://cdn-images.dzcdn.net/images/cover/e4b16c1afe136140bba34368357e8f05/500x500-000000-80-0-0.jpg","latin","2025-08-26","new_releases,chart_top,viral,trending_velocity"],
    ["BAILE INoLVIDABLE","Bad Bunny",367,"DeBÍ TiRAR MáS FOToS","https://cdn-images.dzcdn.net/images/cover/e4b16c1afe136140bba34368357e8f05/500x500-000000-80-0-0.jpg","latin","2025-08-26","new_releases,dance,acoustic_romance"],
    ["Pantropiko","BINI",215,"Talaarawan","https://cdn-images.dzcdn.net/images/cover/0fd6e3b346b959a8781ccfa89b63607a/500x500-000000-80-0-0.jpg","pop","2025-04-10","hot_pop,dance,viral"],
    ["Salamin, Salamin","BINI",230,"Talaarawan","https://cdn-images.dzcdn.net/images/cover/0fd6e3b346b959a8781ccfa89b63607a/500x500-000000-80-0-0.jpg","pop","2025-05-08","viral,dance,radar"],
    ["Dilaw","Maki",192,"Dilaw","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-06-24","emerging,indie,viral"],
    ["Palagi","TJ Monterde",224,"Palagi","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","pop","2025-05-19","acoustic_romance,chill"],
    ["Abracadabra","Lady Gaga",223,"MAYHEM","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","pop","2025-08-25","new_releases,chart_top,hot_pop,dance,trending_velocity"],
    ["Disease","Lady Gaga",229,"MAYHEM","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/c5/43/8b/c5438b81-75e8-3a0a-05ee-4f29ae0b9bb3/25UMGIM07433.rgb.jpg/500x500bb.jpg","pop","2025-08-12","new_releases,hot_pop,dance"],
    ["luther","Kendrick Lamar & SZA",177,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-24","new_releases,chart_top,hiphop,rnb,trending_velocity"],
    ["tv off","Kendrick Lamar feat. Lefty Gunplay",220,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-24","new_releases,hiphop,workout,viral"],
    ["squabble up","Kendrick Lamar",157,"GNX","https://cdn-images.dzcdn.net/images/cover/da5256ff8cacfe9ad90521f6e3792259/500x500-000000-80-0-0.jpg","hip-hop","2025-08-23","new_releases,hiphop,chart_top"],
    ["Sports car","Tate McRae",165,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/51/8a/29/518a29f3-5915-662a-d861-663e6d0fbfe4/196872648911.jpg/500x500bb.jpg","pop","2025-08-22","new_releases,hot_pop,dance,trending_velocity"],
    ["It's ok I'm ok","Tate McRae",156,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","pop","2025-08-10","hot_pop,dance,workout"],
    ["2 hands","Tate McRae",181,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","pop","2025-08-16","new_releases,hot_pop,rnb"],
    ["Denial Is A River","Doechii",159,"Alligator Bites Never Heal","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5f/a3/e8/5fa3e8b9-9065-47af-63e1-f213d3074580/24UMGIM88644.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-19","viral,emerging,radar,hiphop,trending_velocity"],
    ["NISSAN ALTIMA","Doechii",126,"Alligator Bites Never Heal","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/ec/cc/d6/ecccd6d4-2250-5caf-a98d-1ba10baf67f5/24UMGIM88644.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-05","hiphop,workout,emerging"],
    ["Messy","Lola Young",284,"This Wasn't Meant For You Anyway","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/5a/c6/b1/5ac6b183-8ff1-55e3-fa59-8cce5db3fc87/24UMGIM52751.rgb.jpg/500x500bb.jpg","indie","2025-08-18","viral,emerging,radar,indie,rock,trending_velocity"],
    ["The Giver","Chappell Roan",202,"The Giver","https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/fb/65/cb/fb65cb0f-4260-d740-d6f5-bb80c9c27c1b/23UMGIM84225.rgb.jpg/500x500bb.jpg","pop","2025-08-26","new_releases,hot_pop,genre_secondary"],
    ["Cry For Me","The Weeknd",224,"Hurry Up Tomorrow","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/13/fd/a3/13fda38d-fc63-ddc3-1cf2-c09251adc532/25UMGIM09489.rgb.jpg/500x500bb.jpg","r&b","2025-08-25","new_releases,rnb,chart_top,trending_velocity"],
    ["Timeless","The Weeknd & Playboi Carti",256,"Hurry Up Tomorrow","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-14","new_releases,hiphop,rnb,chart_top"],
    ["São Paulo","The Weeknd & Anitta",301,"Hurry Up Tomorrow","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/c3/9f/c8/c39fc847-2d00-1b7f-7327-264436bd9957/24UM1IM21421.rgb.jpg/500x500bb.jpg","dance","2025-08-15","new_releases,dance,workout"],
    ["NOKIA","Drake",241,"$ome $exy $ongs 4 U","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","hip-hop","2025-08-24","new_releases,hiphop,rnb,dance"],
    ["GIMME A HUG","Drake",193,"$ome $exy $ongs 4 U","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/23/7c/a2/237ca270-9926-4b78-be81-410b6fc85f47/50291.jpg/500x500bb.jpg","hip-hop","2025-08-24","new_releases,hiphop,chart_top"],
    ["Sticky","Tyler, The Creator feat. GloRilla, Sexyy Red & Lil Wayne",255,"CHROMAKOPIA","https://is1-ssl.mzstatic.com/image/thumb/Music122/v4/6d/31/ab/6d31abaf-7a07-05f1-13ad-72ec520b6bfb/22UMGIM67374.rgb.jpg/500x500bb.jpg","hip-hop","2025-08-17","new_releases,hiphop,workout,viral"],
    ["Darling, I","Tyler, The Creator feat. Teezo Touchdown",253,"CHROMAKOPIA","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","hip-hop","2025-08-17","new_releases,hiphop,rnb,indie"],
    ["Like Him","Tyler, The Creator feat. Lola Young",278,"CHROMAKOPIA","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b6/ef/ee/b6efeefa-fc99-37d1-ad21-0d769b2a4958/196872796971.jpg/500x500bb.jpg","hip-hop","2025-08-17","viral,hiphop,chill,indie"],
    ["Revolving door","Tate McRae",180,"So Close To What","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/62/f6/6d/62f66d3b-9539-51b9-8b3a-31a7a9c598ca/196872470574.jpg/500x500bb.jpg","pop","2025-08-23","new_releases,hot_pop,chill"],
    ["Number One Girl","ROSÉ",216,"rosie","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","pop","2025-08-19","new_releases,acoustic_romance,hot_pop"],
    ["toxic till the end","ROSÉ",156,"rosie","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","pop","2025-08-21","new_releases,hot_pop,trending_velocity"],
    ["Born Again","LISA feat. Doja Cat & RAYE",231,"Alter Ego","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","pop","2025-08-25","new_releases,hot_pop,dance,trending_velocity"],
    ["New Woman","LISA feat. ROSALÍA",179,"Alter Ego","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","pop","2025-08-08","new_releases,dance,hot_pop"],
    [" Love Hangover","JENNIE & Dominic Fike",180,"Ruby","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","r&b","2025-08-24","new_releases,rnb,indie,chill"],
    ["ExtraL","JENNIE & Doechii",167,"Ruby","https://cdn-images.dzcdn.net/images/cover/258e6042338ce64bb4157c0c94b232ac/500x500-000000-80-0-0.jpg","hip-hop","2025-08-26","new_releases,hiphop,workout,trending_velocity"],
    ["Stargazing","Myles Smith",172,"A Minute...","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","indie","2025-06-10","emerging,radar,indie,acoustic_romance"],
    ["Nice To Meet You","Myles Smith",176,"A Minute...","https://cdn-images.dzcdn.net/images/cover/f4246416b5e3e71a35adf1e2cbe98bfb/500x500-000000-80-0-0.jpg","indie","2025-08-18","new_releases,emerging,acoustic_romance,hot_pop"],
    ["Sailor Song","Gigi Perez",211,"Sailor Song","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/25/d4/96/25d49699-acc0-401f-a7cc-d7697339a474/24UM1IM03751.rgb.jpg/500x500bb.jpg","indie","2025-08-15","viral,emerging,radar,indie,acoustic_romance"],
    ["Fable","Gigi Perez",224,"Fable","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/21/6f/68/216f6844-711c-84ea-a041-3f37635f6688/24UM1IM12889.rgb.jpg/500x500bb.jpg","indie","2025-08-22","new_releases,emerging,indie"],
    ["The Emptiness Machine","Linkin Park",190,"From Zero","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/85/cf/a1/85cfa1ed-d8f6-d021-2a9e-cb541b2bbe87/artwork.jpg/500x500bb.jpg","rock","2025-08-19","new_releases,rock,workout,chart_top"],
    ["Heavy Is The Crown","Linkin Park",167,"From Zero","https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/69/21/cf/6921cff3-7074-118a-ece2-4012450e6c75/093624839811.jpg/500x500bb.jpg","rock","2025-08-21","new_releases,rock,workout"],
    ["Two Faced","Linkin Park",183,"From Zero","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/cd/7b/91/cd7b9189-5c62-5f99-c39a-e268a31ec7c2/093624821380.jpg/500x500bb.jpg","rock","2025-08-23","new_releases,rock,workout"],
    ["High Road","Koe Wetzel & Jessie Murph",180,"9 Lives","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/a1/5a/2c/a15a2c42-ce9c-8c47-2b68-8cff0ab75708/196872445718.jpg/500x500bb.jpg","country","2025-07-06","genre_secondary,rock,acoustic_romance"],
    ["Liar","Jelly Roll",204,"Beautifully Broken","https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/95/b9/ca/95b9ca00-29cb-8edc-1ecb-5bda742f3177/24UMGIM62166.rgb.jpg/500x500bb.jpg","country","2025-08-12","new_releases,genre_secondary,rock"],
    ["4x4xU","Lainey Wilson",239,"Whirlwind","https://cdn-images.dzcdn.net/images/cover/473abf39f40221437fb7c590e36b7282/500x500-000000-80-0-0.jpg","country","2025-08-14","new_releases,genre_secondary,acoustic_romance"],
    ["I Never Lie","Zach Top",224,"Cold Beer & Country Music","https://cdn-images.dzcdn.net/images/cover/7060ea038f51fdeff23bc40eb5027663/500x500-000000-80-0-0.jpg","country","2025-08-05","emerging,radar,genre_secondary"],
    ["Kiss My Boots","Bakar",168,"Halo","https://cdn-images.dzcdn.net/images/cover/37a20b62f754b7ff5a9a29a8f2fe9d27/500x500-000000-80-0-0.jpg","indie","2025-06-14","indie,emerging,chill"],
    ["Kisses","BL3SS, CamrinWatsin & bbyclose",138,"Kisses","https://cdn-images.dzcdn.net/images/cover/e70f7518f5dbe0b0be643cbabc87ca4b/500x500-000000-80-0-0.jpg","dance","2025-07-28","dance,viral,emerging,workout"],
    ["Somedays","Sonny Fodera, Jazzy & D.O.D",207,"Somedays","https://cdn-images.dzcdn.net/images/cover/e70f7518f5dbe0b0be643cbabc87ca4b/500x500-000000-80-0-0.jpg","dance","2025-08-09","new_releases,dance,workout"],
  ],
};

export function getCountrySeedPool(gl) {
  const code = regionCode(gl);
  const out = [];
  let idx = 0;

  // 1) Country-specific seed songs (for IN/PK/BD, include IN regional seeds first)
  const regionalList = (code === "IN" || code === "PK" || code === "BD") ? (COUNTRY_SEED_SONGS.IN || []) : [];
  for (const [title, artist, dur, album, art, genre, releaseDate, roles] of regionalList) {
    idx++;
    const src = idx % 3 === 1 ? "apple" : (idx % 3 === 2 ? "deezer" : "youtube");
    out.push({
      id: `${src}:cseed:${code}:${idx}`,
      source: src,
      title,
      artist,
      album: album || "",
      duration: dur || 200,
      artwork: art || "/cover-default.jpg",
      genre: genre || "pop",
      year: releaseDate ? String(releaseDate).slice(0, 4) : "2025",
      releaseDate: releaseDate || "2025-07-01",
      _roles: String(roles || "").split(",").map((s) => s.trim()).filter(Boolean),
      playQuery: `${title} ${artist} official audio`.trim(),
    });
  }

  // 2) Add global 2025/2026 new releases, viral risers, RADAR & genre hits
  for (const [title, artist, dur, album, art, genre, releaseDate, roles] of (COUNTRY_SEED_SONGS.GLOBAL || [])) {
    idx++;
    const src = idx % 3 === 1 ? "apple" : (idx % 3 === 2 ? "deezer" : "youtube");
    out.push({
      id: `${src}:gseed:${idx}`,
      source: src,
      title,
      artist,
      album: album || "",
      duration: dur || 200,
      artwork: art || "/cover-default.jpg",
      genre: genre || "pop",
      year: releaseDate ? String(releaseDate).slice(0, 4) : "2025",
      releaseDate: releaseDate || "2025-08-01",
      _roles: String(roles || "").split(",").map((s) => s.trim()).filter(Boolean),
      playQuery: `${title} ${artist} official audio`.trim(),
    });
  }

  // 3) Add the 240 curated mood tracks from FY_MOOD_PROFILES with recency & role mapping
  // so every country has a massive 340+ song diverse catalog covering all 17 roles!
  const moodRoleMap = {
    trending: ["chart_top", "new_releases", "trending_velocity", "viral", "radar"],
    pop: ["hot_pop", "chart_top", "new_releases", "genre_flagship"],
    hiphop: ["hiphop", "genre_flagship", "workout", "trending_velocity"],
    rnb: ["rnb", "chill", "genre_secondary"],
    indie: ["indie", "emerging", "radar", "chill"],
    dance: ["dance", "workout", "viral"],
    rock: ["rock", "workout"],
    chill: ["chill", "acoustic_romance"],
    workout: ["workout", "dance", "hiphop"],
    throwback: ["hot_pop", "acoustic_romance"],
  };

  for (const [moodKey, prof] of Object.entries(FY_MOOD_PROFILES)) {
    const songs = (prof && prof.curatedSongs) || [];
    const roles = moodRoleMap[moodKey] || ["chart_top"];
    songs.forEach(([title, artist, dur, album, art], sIdx) => {
      idx++;
      const src = idx % 3 === 1 ? "apple" : (idx % 3 === 2 ? "deezer" : "youtube");
      const isRecent = moodKey === "trending" || sIdx < 8;
      const month = String(((sIdx % 8) + 1)).padStart(2, "0");
      const day = String(((sIdx * 3) % 27) + 1).padStart(2, "0");
      const releaseDate = isRecent ? `2025-${month}-${day}` : `2024-${month}-${day}`;
      out.push({
        id: `${src}:fyseed:${moodKey}:${sIdx}`,
        source: src,
        title,
        artist,
        album: album || "",
        duration: dur || 200,
        artwork: art || prof.cover || "/cover-default.jpg",
        genre: prof.targetGenre || moodKey,
        year: releaseDate.slice(0, 4),
        releaseDate,
        _roles: roles,
        _mood: moodKey,
        playQuery: `${title} ${artist} official audio`.trim(),
      });
    });
  }

  return out;
}


