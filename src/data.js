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
export function buildForYouPlaylists(fyRes) {
  // EXACTLY 10 "Made for you" cards, each a different mood. No `kind:"mix"`
  // cards here — the client no longer filters mixes out (when the user has no
  // taste). Every card carries `mood` + `genres` so the client can reorder
  // them by the listener's taste profile as they keep listening. It also
  // carries up to 20 `tracks` so the card shows the real song count ("20
  // songs") even before it's opened, and so a fresh list is fully populated.
  return FY_QUERIES.map((f, i) => {
    const v = fyRes && fyRes[i] && fyRes[i].status === "fulfilled" ? fyRes[i].value : null;
    const tracks = (v && Array.isArray(v.tracks) ? v.tracks : []).slice(0, 20);
    return {
      id: `fy-${i}`,
      title: f.title,
      subtitle: f.subtitle,
      artwork: (v && v.artwork) || "",
      playlistId: (v && v.playlistId) || "",
      query: f.query,
      mood: f.mood,
      genres: f.genres,
      kind: "yt",
      tracks,
    };
  });
}
