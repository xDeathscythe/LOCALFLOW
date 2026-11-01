**LocalFlow: plan za Meeting Transcribe**

Istraživanje i dopuna od 7. oktobra 2026. Status: predlog integracije, bez implementacije. Pregledani su aktuelni LocalFlow izvorni kod u `X:\wORK cODEX\localflow`, Niwa Remote u `D:\Projects\niwa-remote`, Niwa Code 0.3.2 u `D:\Projects\.niwa-code-release-0125` i zvanična dokumentacija dobavljača. Dopuna obuhvata ograničavanje ponuda tokom glasovnih poruka, zajedničku Google prijavu sa kalendarom i osnovu za budući mobilni pristup notesima. Postojeće izmene verzije 0.2.6 ostaju netaknute. Stvarni pozivi, OAuth prijave i povezivanje telefona nisu pokretani tokom istraživanja.

Predlažem lokalnu detekciju razgovora iz više signala, snimanje mikrofona i zvuka razgovora posle korisničke potvrde, trajni zapis tokom razgovora i obradu kroz postojeći lokalni STT. Jedno povezivanje Google naloga obuhvata profil i kalendar, a isti LocalFlow nalog kasnije pronalazi korisnikov kućni računar sa telefona. Na završetku se u Notes / Meetings pojavljuje uređena beleška sa naslovom, zaključcima i celim transkriptom. Postojeći Niwa/Codex pristup može da obradi tekst za sažetak, kroz odvojen posao koji ne koristi aktivni chat. Google profil i nalog za AI obradu imaju odvojene namene.

**1. Šta je potvrđeno kod Notiona.** Desktop aplikacija prepoznaje da neki proces koristi mikrofon i tada nudi transkripciju. Za detekciju ne analizira govor. Snimanje se pokreće korisničkom akcijom, a desktop hvata mikrofon i sistemski zvuk. Sažetak nastaje po završetku. Funkcija trenutno ne radi offline; srpski nije naveden u zvaničnom spisku podržanih jezika. Ovo opisuje javno dokumentovano ponašanje, ne njihov interni kod. [Notion AI Meeting Notes](https://www.notion.com/help/ai-meeting-notes).

Kalendar je zasebna integracija: povezuje događaj i belešku, prenosi naziv, datum i vreme i omogućava izbor podrazumevanog mesta za beleške. [Notion Calendar integracija](https://www.notion.com/help/use-notion-calendar-with-notion). Notion ima i Chrome dodatak za Google Meet koji dodaje oznake govornika i obaveštenje učesnicima o transkripciji. [Notion Meetings Add-on](https://www.notion.com/help/install-the-notion-meetings-add-on).

**2. Tačan tok u LocalFlowu.** Na postojećem bočnom notchu Notes dugme postaje Transcribe. Notes ostaje dostupan u glavnoj aplikaciji. Detektovan poziv selektuje Transcribe i širi isti notch ulevo, uz zadržavanje desne ivice i postojećeg vertikalnog položaja.

| Stanje | Šta korisnik vidi | Ponašanje |
|---|---|---|
| Mirovanje | Sadašnji mali notch | Bez snimanja i bez pozivanja AI-ja |
| Ponuda | `Transcribe meeting?`, aplikacija ili naziv sastanka, zeleni ✓ i × | Jedna ponuda za isti razgovor; fokus ostaje u pozivu |
| Prihvaćeno | Kratko stanje pokretanja, zatim trajanje | Kreiranje trajne sesije i beleške, zatim potvrđen početak oba audio toka |
| Snimanje | Transcribe ostaje označen, trajanje i pokazatelji mikrofona/sagovornika | Kompaktno stanje; otvaranjem se vide Pause i Stop |
| Odbijeno | Notch se skupi | Isti poziv se više ne nudi; korisnik ga može ručno pokrenuti |
| Završavanje | Kratak prikaz obrade | Zatvaranje snimka, obrada preostalih delova, pa AI sažetak |
| Sačuvano | Potvrda i mogućnost otvaranja beleške | Beleška ostaje u Meetings; notch se vrati u uobičajeno stanje |
| Prekid ili greška | Precizno stanje izvora koji nedostaje | Već snimljeni delovi ostaju sačuvani; nema lažne poruke da se sve snima |

Snimanje počinje na ✓. Govor pre potvrde se ne može naknadno vratiti; automatska detekcija nije odobrenje za pozadinsko snimanje. Ponuda treba da se pojavi dovoljno rano, a kod zakazanih sastanaka kalendar može da je pripremi unapred. Obaveštenje sagovornicima i vidljiv indikator snimanja deo su toka; automatsko slanje poruka u tuđe aplikacije nije deo osnovne integracije.

Ručno pokretanje ostaje dostupno i kada poziv nije prepoznat. Ako LocalFlow startuje usred poziva, prvo popisuje postojeće audio sesije. Dupli klik na ✓, ponovno povezivanje uređaja ili drugi signal iz kalendara ne prave drugi snimak istog razgovora.

**3. Lokalna detekcija i glasovne poruke.** Windows sloj prati nastanak, aktivnost i zatvaranje audio sesija na mikrofonima, uz povezivanje sa procesima. Koristi događaje Core Audio interfejsa i promene uređaja, bez neprekidnog skeniranja prozora i bez traženja reči poput „meeting“, „poziv“ ili „join“. Microsoft dokumentuje audio sesije, njihovo povezivanje sa PID-om i obaveštenja o promenama. Ovi podaci otkrivaju audio aktivnost, ali sami ne potvrđuju poziv. [Audio sessions](https://learn.microsoft.com/en-us/windows/win32/coreaudio/audio-sessions), [session manager](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nn-audiopolicy-iaudiosessionmanager2), [session process ID](https://learn.microsoft.com/en-us/windows/win32/api/audiopolicy/nf-audiopolicy-iaudiosessioncontrol2-getprocessid).

Sam uključen mikrofon ne širi notch. Aplikacija dobija privremeno stanje kandidata, a ponuda zavisi od potvrde razgovora ili dovoljno povezanih signala. Najjači dokaz je strukturirano stanje poziva iz podržane aplikacije: stabilan ID sesije, povezivanje, aktivan razgovor i završetak. Adapter prvo koristi zvanični API ili događaje ako postoje. Identitet aplikacije služi za izbor adaptera, bez pretrage naziva prozora, poruka ili prevedenih oznaka dugmadi.

Za browser je kandidat mali dodatak koji prati stanje veze i audio tokove konkretnog taba. WebRTC statistika razlikuje dolazni i odlazni RTP, ali nije javni globalni spisak svih poziva: prvo treba dokazati da dodatak u Meetu i drugim podržanim servisima može pouzdano dobiti te signale. Otvoren tab, jedna peer veza ili data kanal sami nisu dokaz audio razgovora. Dodatak za detekciju i precizno hvatanje zvuka taba imaju različite dozvole. [W3C WebRTC statistika](https://www.w3.org/TR/webrtc-stats/).

| Dostupni signali | Odluka o automatskoj ponudi |
|---|---|
| Adapter potvrđuje aktivan poziv | Otvoriti ponudu i kada je lokalni mikrofon utišan; ne čekati da obe osobe progovore |
| Adapter potvrđuje glasovnu poruku, test ili čekaonicu | Bez automatskog širenja; pratiti eventualni prelazak u pravi poziv |
| Povezane ulazne i izlazne audio sesije, uz potvrđen kontekst razgovora | Kandidat za ponudu posle kratke stabilizacije; pouzdanost proveriti za tu aplikaciju |
| Samo mikrofon, bez drugog dokaza | Bez širenja notcha; ručni Transcribe ostaje dostupan |
| Samo reprodukcija poruke ili videa, bez potvrde poziva | Bez širenja notcha |
| Događaj iz kalendara bez aktivnosti poziva | Podsetnik sa ručnim startom; ne označavati da je razgovor počeo |

Obostrana audio aktivnost pomaže, ali može nastati i kada korisnik snima poruku dok druga kartica pušta video. Povezivanje signala radi po aplikaciji, sesiji i tabu gde je dostupan. Trajanje je pomoćni signal: duga glasovna poruka ne postaje poziv samo zato što traje 30 sekundi, niti je kratak poziv glasovna poruka. Prag stabilizacije određuje se merenjem, bez klasifikacije preko reči ili analize sadržaja govora. Pre ✓ koriste se metapodaci aktivnosti; audio se ne snima i ne šalje modelu radi pogađanja vrste razgovora.

Za WhatsApp, Viber i Zoom treba zasebno utvrditi postoji li dostupan pouzdan signal u desktop klijentu. Dostupnost se ne pretpostavlja. Tamo gde postoje samo nejasni OS signali, početno ponašanje je miran indikator mogućeg poziva uz ručni start. Automatsko širenje za takvu aplikaciju uključuje se tek kada prođe testove glasovnih poruka, čekaonice i testiranja mikrofona. Tako izbegavamo obećanje univerzalne detekcije bez lažnih ponuda.

LocalFlow i njegovi audio procesi isključuju se po identitetu procesa. Pamti se odbijanje za tekući razgovor, a korisnik može isključiti ponude za konkretnu aplikaciju. Ponovni signal iz kalendara ili uređaja ne poništava odbijanje. U dijagnostici se čuvaju razlog ponude i tipovi signala, bez sadržaja razgovora. Poziv sa utišanim mikrofonom od početka pokriva potvrđeno stanje poziva, kalendar ili ručni start; sam OS detektor ga može propustiti.

Gašenje mikrofona ili tišina ne završavaju snimanje odmah. Eksplicitan Stop završava sesiju. Pouzdan signal izlaska iz poziva može pokrenuti završavanje; kod nejasnog prestanka aktivnosti notch pita da li da završi, dok snimanje ostaje jasno označeno. Pauza i povratak u isti razgovor ne otvaraju novu belešku.

**4. Snimanje obe strane.** Predlog su dva odvojena toka sa zajedničkom vremenskom osnovom: izabrani mikrofon i zvuk aplikacije u kojoj je razgovor. WASAPI process loopback može ograničiti izlazni zvuk na proces i njegove potomke. Zahteva Windows build 20348 ili noviji; ovde je potvrđen Windows 11 build 26200. To potvrđuje preduslov, ne uspešan snimak u svim aplikacijama. Stariji Windows može imati posebno ponuđen režim snimanja celog izlaznog uređaja. [Microsoft application loopback](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/).

Ovo ne zahteva da bot uđe na sastanak niti podrazumeva instaliranje virtuelnog audio kabla. Običan WASAPI loopback je native Windows mogućnost. [Microsoft loopback recording](https://learn.microsoft.com/windows/win32/coreaudio/loopback-recording).

Kod Chromea i Edgea audio proces može služiti za više tabova. Hvatanje browser procesa zato nije obećanje da snimamo samo Meet tab. Osnovni režim mora jasno navesti izabranu aplikaciju. Precizno snimanje jednog taba može doći kroz dodatak, ali Chrome `tabCapture` traži korisničko aktiviranje dodatka; klik u native notchu ne treba unapred smatrati dovoljnim. Dodatak mora sačuvati i normalnu reprodukciju zvuka korisniku. [Chrome tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture).

Za slušalice su tokovi prirodno odvojeni. Sa zvučnicima mikrofon može ponovo uhvatiti sagovornika, pa su uklanjanje odjeka i provera dupliranja obavezni. Prvo proveriti native AEC na uređaju; podrška i kontrola referentnog izlaza nisu garantovane na svakom hardveru. Ako native obrada nije dovoljna, tek tada izabrati proverenu audio obradu. Ne praviti sopstveni algoritam za uklanjanje odjeka. [Windows AEC](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nn-audioclient-iacousticechocancellationcontrol).

Potrebno je pratiti promenu slušalica, Bluetooth profila, ulaznog uređaja i izlaza poziva. Izbor prati uređaj razgovora gde se može pouzdano utvrditi, uz ručno biranje izvora. Mute u Meetu ili Zoomu ne mora utišati nezavisno snimanje mikrofona u LocalFlowu; zato LocalFlow ima sopstvenu jasnu kontrolu mikrofona i ne pretpostavlja da zna stanje tuđeg mute dugmeta.

**5. Dug razgovor mora preživeti grešku.** Sadašnji [audio-recording.ts](<X:/wORK cODEX/localflow/src/lib/audio-recording.ts>) čuva MediaRecorder delove u nizu i sastavlja jedan Blob tek na kraju. Taj put odgovara postojećem diktiranju, ali nije osnova za višesatni sastanak.

Meeting recorder upisuje kratke, samostalno čitljive audio delove na disk dok razgovor traje. Predlog za početno merenje je 10 do 20 sekundi po delu, sa malim preklapanjem potrebnim ASR-u. Granice i trajanje nisu konačne dok se ne proveri kvalitet i brzina. Svaki deo ima ID, redni broj, izvor i tačne vremenske oznake. Obrada preklapanja koristi vremensko poravnanje, bez jezičkih lista ili uklanjanja rečenica po ključnim rečima.

Ograničen bafer odvaja snimanje od transkripcije. Sporiji ASR povećava red obrade, ali ne zaustavlja zapis zvuka. Sesija pamti poslednji trajno upisani deo, obrađene segmente i status sažetka. Posle pada aplikacije otvara se ista prekinuta sesija i nastavlja obrada sačuvanog materijala. Ponovljeni posao ne duplira transkript. Ako disk ili uređaj otkažu, snimanje dobija precizno stanje greške i beleži prekid.

Predlog je trajno čuvanje transkripta i sažetka. Audio ostaje lokalno najmanje dok obrada i oporavak nisu završeni. Trajno zadržavanje audio snimaka je odvojena postavka, koju treba zaključiti pre implementacije; nije isto što i korisnikov zahtev da svi transkripti ostanu sačuvani.

**6. Postojeći STT i AI.** [worker.py](<X:/wORK cODEX/localflow/backend/worker.py>) već vraća jezik i segmente sa početnim i završnim vremenom. [whisper-languages.json](<X:/wORK cODEX/localflow/backend/whisper-languages.json>) sadrži 100 kodova jezika. Taj model i postojeći worker treba ponovo koristiti, bez drugog velikog modela u memoriji. Broj kodova nije garancija podjednakog kvaliteta na svim jezicima.

Meeting poslovi dobijaju odvojene ID-jeve i red obrade. Trenutni host `cancel()` prekida sve transkripcione zahteve, pa otkazivanje diktata mora biti ograničeno na njegov posao. Diktiranje može dobiti prioritet između kraćih meeting delova. Koordinacija mikrofona sa Niwa voice i postojećim VTT-om mora očuvati aktivno meeting snimanje.

Transkript čuva jezik govora, uključujući prelazak između jezika. Jezik sažetka je zaseban izbor, sa razumnim početnim izborom jezika razgovora. Ne koristiti trenutni režim stilskog „cleanup“-a da prepravlja dokazni transkript.

AI za završnu obradu koristi postojeći Niwa/Codex nalog i izabrani tekstualni model, u izolovanom poslu. Postojeći [niwa-agent.mjs](<X:/wORK cODEX/localflow/host/niwa-agent.mjs>) ima alate, memoriju i aktivni razgovor, pa njegov običan `send()` nije dobar direktan ulaz za automatsko sumiranje sastanka. Sažimanje dobija samo relevantan transkript i kontekst, uz onemogućene operativne alate; host proverava rezultat i zapisuje belešku. Mogućnosti strukturiranog izlaza i zabrane alata treba proveriti na instaliranom runtime-u pre implementacije.

Snimanje i lokalni STT treba da rade bez interneta kada je model instaliran. Sažetak preko sadašnjeg Codex povezivanja zahteva vezu i raspoloživ nalog. Bez toga beleška pokazuje da sažetak čeka i omogućava ponovnu obradu. Lokalni LLM za sažetak može biti kasnija zasebna opcija, bez predstavljanja cele funkcije kao potpuno offline AI-ja.

**7. Beleška u Notes / Meetings.** Folder se kreira jednom, njegov ID se pamti u postavkama, a sesije ga koriste čak i ako korisnik promeni naziv. Ne prepoznavati folder po engleskoj reči „Meetings“. Svaka prihvaćena sesija odmah dobija svoj ID i belešku sa privremenim nazivom. Završna AI obrada predlaže kratak, konkretan naslov, uz očuvanje naziva koji je korisnik ručno izmenio.

Redosled sadržaja:

1. Naslov, datum, trajanje i potvrđeni podaci o razgovoru.
2. Kratak sažetak u nekoliko rečenica.
3. Key points, grupisani po temama razgovora.
4. Donete odluke, odvojene od predloga.
5. Action items sa odgovornom osobom i rokom samo kada su zaista pomenuti.
6. Otvorena pitanja, nedoumice i stvari za dodatno razmatranje.
7. Dogovoreni sledeći koraci.
8. Ceo vremenski označen transkript.

Zaključci i zadaci imaju vezu ka segmentima transkripta iz kojih su izvedeni. Nedostajuća imena, rokovi i odluke ostaju nepopunjeni. Dugi sastanci obrađuju se po vremenskim delovima, zatim se rezultati objedinjuju uz očuvanje izvora. AI ne sme da izvršava naloge iz razgovora niti automatski šalje zadatke ili beleške drugim ljudima.

Mikrofonski i udaljeni kanal daju razliku „ja / druga strana“, ali ne identitet svake osobe. Za grupne razgovore zasebno razmotriti diarizaciju i integraciju sa platformom. Dok nema pouzdanog identiteta, prikazati neutralnu oznaku. Lista pozvanih iz kalendara nije dokaz da su svi prisustvovali ili govorili.

Zapis koristi postojeći [Notes servis](<X:/wORK cODEX/localflow/host/notes-service.mjs>) i [SQLite store](<X:/wORK cODEX/localflow/host/notes/sqlite-store.mjs>), sa dodatnim strukturiranim zapisima o sesiji i segmentima. Audio ide u direktorijum sesije, ne u veliki SQLite blob. Beleška je prikaz tih podataka kroz postojeći Notes sistem, sa kontrolom revizija. Ručne dopune treba odvojiti od generisanih delova da ponovno sažimanje ne pregazi korisnikov tekst. Konačan vizuelni raspored uskladiti sa najavljenim Notion screenshotom.

**8. Jedan Google nalog za profil, kalendar i budući telefon.** U Settings postoji jedan ulaz „Continue with Google“. U tom toku jasno prikazati da se povezuju profil, kalendar za sastanke i ovaj računar za udaljeni pristup kada je ta mogućnost uključena. Nakon uspeha prikazati nalog, kalendare i povezane uređaje na istom mestu. Izbor kalendara je postavka već povezanog naloga, bez drugog procesa povezivanja.

**8.1. Šta je stvarno nađeno u Niwa Code.** U proverenom izvoru verzije 0.3.2, [ACCOUNT_LINKING.md](<D:/Projects/.niwa-code-release-0125/docs/ACCOUNT_LINKING.md>) i [AccountConnection.jsx](<D:/Projects/.niwa-code-release-0125/src/account/AccountConnection.jsx>) opisuju Clerk/Google prijavu, povezivanje računara i automatski izbor kada nalog ima jedan računar. [Capacitor OAuth transport](<D:/Projects/.niwa-code-release-0125/src/account/capacitor-oauth-transport.js>) otvara sistemski browser i vraća prijavu aplikaciji. [Account link](<D:/Projects/.niwa-code-release-0125/host/account-link.mjs>) i [Cloudflare tunnel](<D:/Projects/.niwa-code-release-0125/host/cloudflare-tunnel.mjs>) vezuju host, jednokratne ulaznice i izlazni tunel. To je potvrda implementacije u izvoru; povezivanje stvarnog telefona nije provereno u ovom istraživanju. Calendar integracija nije nađena u pregledanom toku.

Predlog za LocalFlow je isti obrazac korisničkog toka i jedan LocalFlow identitet za desktop i buduće mobilne klijente. Koristiti jednu Clerk aplikaciju za te LocalFlow površine, uz Google kao prijavu, i proveriti podržani Tauri tok. Ne prenositi Electron ili Capacitor implementaciju doslovno u Tauri. Postojeći Niwa Code nalog, produkciona podešavanja i endpointi ostaju referenca; njihove izmene nisu potrebne za ovu dopunu plana.

**8.2. Prijava i Calendar saglasnost u istom povezivanju.** Google veza traži identitet (`openid`, `email`, `profile`) i dozvole potrebne odmah za sastanke: `calendar.events.readonly` i `calendar.calendarlist.readonly`. Time se pokrivaju događaji i izbor kalendara. Sadržaj Gmail sandučeta nije deo ovog zahteva. Clerk podržava dodatne scope-ove u konfiguraciji Google veze sa sopstvenim OAuth kredencijalima. [Clerk dodatni OAuth scope-ovi](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/overview), [Calendar scope-ovi](https://developers.google.com/workspace/calendar/api/auth).

Cilj je jedno povezivanje i jedan trajni zapis odobrenih Google dozvola po nalogu. Broj Google ekrana zavisi od prethodnih saglasnosti i Workspace pravila. Proveriti stvarno odobrene scope-ove: korisnik može dozvoliti prijavu, a odbiti kalendar. Tada profil i lokalne funkcije rade, Calendar prikazuje da nema dozvolu, a eventualna dopuna ide iz istog naloga. Ne vraćati ceo onboarding pri svakom pokretanju. Opozvan grant ili promenjena pravila naloga mogu zahtevati novu potvrdu; „jednom poveži“ ne znači da aplikacija može ignorisati Google opoziv. [Google granularne dozvole](https://developers.google.com/identity/protocols/oauth2/web-server).

Prijava se odvija kroz sistemski browser ili podržani native SDK, uz proverene callback adrese i zaštite koje zahteva izabrani tok. U prvoj tehničkoj probi dokazati početnu prijavu, obnovu sesije, već postojeći Google nalog, otkazivanje i delimično odobrene dozvole. Za izdavanje pripremiti produkcione Google kredencijale, Calendar API i potrebnu verifikaciju. [Clerk Google povezivanje](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google).

**8.3. Gde žive nalog i tokeni.** Clerk sesija potvrđuje LocalFlow korisnika; Google token odobrava Calendar; potvrda uređaja dopušta pristup konkretnom hostu. To su odvojene nadležnosti unutar jednog korisničkog povezivanja. Vlasnik se vezuje za stabilan ID naloga i workspace-a, bez oslanjanja na prikazano ime ili email kao jedini dokaz.

Pristup Google tokenu kroz Clerk Backend API zahteva pouzdano serversko okruženje. Zbog toga plan uključuje mali servis za naloge, uređaje i Google pristup. Clerk secret i Google client secret ostaju na tom servisu odnosno u konfiguraciji provajdera, nikada u desktop paketu ili telefonu. [Clerk pristup provider tokenu](https://clerk.com/docs/reference/backend/user/get-user-oauth-access-token).

Predloženi početni raspored: servis proverava Clerk sesiju i registrovani uređaj, pribavlja Google token za isti potvrđeni nalog i izvršava samo potrebne Calendar zahteve. Vraća izabrane podatke hostu, bez izlaganja provider tokena UI-ju. Proveriti obnovu Google pristupa posle isteka tokena; nemati dva konkurentna skladišta refresh tokena. Servis ne prima audio ili sadržaj Notes beleški. Metapodaci kalendara prolaze kroz njega, što treba jasno navesti u opisu čuvanja podataka.

**8.4. Pristup kućnom računaru preko interneta.** Kada vlasnik u okviru početnog povezivanja uključi pristup ovom računaru, desktop registruje host i otvara izlazni tunel. Budući telefon se prijavi istim nalogom, registruje svoj uređaj i automatski izabere jedini raspoloživ, dozvoljen računar. Ako postoji više računara, bira se jedan i izbor se pamti. Nema ručnog unosa IP adrese, porta ili kopiranja host tokena u normalnom toku. Registracija uređaja i kratkotrajna ulaznica rade u pozadini nakon prijave.

OAuth daje identitet; mrežnu vezu obezbeđuje tunel. Predlog je upravljani Cloudflare Tunnel ili ekvivalentan održavan transport, uz HTTPS/WSS, ponovno povezivanje i obnovu endpointa. Izabrani transport treba automatski pripremiti kroz instalaciju ili uključivanje udaljenog pristupa, bez zahteva da svaki korisnik sam podešava ruter. Niwa Code u pregledanom izvoru koristi već instaliran `cloudflared` i privremeni `trycloudflare.com` URL. Za izdanje planirati upravljano provisioniranje tunela, njegove kredencijale i operativni trošak; Quick Tunnel je namenjen testiranju i razvoju. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Ne prenositi doslovno Niwa Code skladištenje zajedničkog environment secreta u klijentski čitljivom `unsafeMetadata`, vidljivo u [account-flow.js](<D:/Projects/.niwa-code-release-0125/src/account/account-flow.js>). U LocalFlowu pouzdan servis vodi vlasništvo nad uređajima i izdaje kratkotrajne ulaznice vezane za korisnika, uređaj, host, workspace i dozvoljene operacije. Host proverava potpis, rok i jednokratnost. Svaki uređaj ima zaseban opoziv; njegovo uklanjanje prekida i postojeću udaljenu sesiju. Privatni ključevi ostaju u OS zaštićenom skladištu. Za zaštitu sadržaja kroz posrednički transport koristiti proveren protokol i biblioteku sa potvrđenim identitetom hosta, bez pisanja sopstvene kriptografije.

Izložiti samo ovlašćeni LocalFlow Notes API, bez pristupa proizvoljnim fajlovima, shell-u ili endpointima AI provajdera. Postojeći lokalni Notes servis ostaje vlasnik operacija. Cloud deo čuva identitet, registry uređaja i podatke potrebne za vezu; originalni notesi i snimci ostaju na računaru. Nova Google prijava na istom računaru ne prevezuje postojeći workspace automatski drugom vlasniku.

**8.5. Osnova za mobilne Notes, bez izrade mobilne aplikacije sada.** Budući klijent koristi iste ID-jeve beleški i foldera, revizije, autorizovane operacije i tok promena. Pripremiti ugovor za početni snapshot, promene od poslednjeg kursora, priloge i oporavak posle prekida. [Notes store](<X:/wORK cODEX/localflow/host/notes-store.mjs>) već proverava reviziju pri snimanju; to je osnova za zaštitu od prepisivanja tuđih izmena. Potrebni su trajni dnevnik promena, zapis brisanja i ID operacije za bezbedno ponavljanje posle prekida veze. Ne sinhronizovati SQLite fajl direktno i ne uvoditi CRDT dok stvarni zahtevi ne opravdaju njegovu složenost.

Na telefonu planirati lokalni zaštićeni keš za prethodno preuzete beleške i red izmena za slanje kada se veza vrati. Konflikt čuva obe verzije za razrešenje; poslednji pristigli zapis ne sme neprimetno obrisati drugi. Dugi transkripti i prilozi prenose se po potrebi, sa nastavkom prekinutog preuzimanja. Meeting sažetak ne prepisuje ručnu mobilnu dopunu. Keš i red operacija pripadaju konkretnom nalogu i workspace-u, a promena naloga ne prikazuje prethodni keš.

Za nove podatke sa kućnog računara on mora biti uključen, budan, povezan na internet i LocalFlow host mora raditi. Kada je ugašen, telefon može koristiti ono što je već preuzeo i sačuvati izmene za kasnije. Pristup svim podacima uz ugašen računar zahtevao bi zasebnu cloud kopiju, koja trenutno nije deo zahteva. Opoziv uređaja zaustavlja budući pristup; ne može garantovati brisanje sadržaja koji je uređaj ranije već preuzeo dok je offline.

**8.6. Calendar koristi taj zajednički nalog.** Nakon odobrenja prikazati kalendare, uključiti primarni kao početni izbor i omogućiti promenu izbora. Postojeći Google grant koristi se i kada se drugi uređaj prijavi na isti LocalFlow nalog. Nema zasebnog Calendar naloga niti drugog dugmeta „Connect Google“ za istu vezu.

Događaj donosi naslov, vreme, konferencijski link i pozvane osobe. Povezivanje sa detektovanim pozivom koristi stabilne identifikatore događaja i konferencije, uz korisnički izbor kada postoji više kandidata. [Calendar event struktura](https://developers.google.com/workspace/calendar/api/v3/reference/events).

Keš i inkrementalna sinhronizacija omogućavaju lokalne podsetnike i odloženo osvežavanje. Istekao sync token obnavlja samo keš kalendara, nikada transkripte ili Notes. Obraditi otkazane i ponavljajuće događaje, promenu vremenske zone i opozvan pristup. [Google incremental sync](https://developers.google.com/workspace/calendar/api/guides/sync). Isključivanje Calendar sinhronizacije u LocalFlowu je lokalna postavka; puni opoziv Google veze može uticati na sve dozvole te veze i mora biti jasno označen. Automatska detekcija i ručno snimanje ostaju dostupni bez Google naloga.

**9. Morph po uzoru na Niwa Remote.** Proveren [SessionNotch.xaml.cs](<D:/Projects/niwa-remote/src/Niwa.Remote.Windows/SessionNotch.xaml.cs:145>) koristi promenu dimenzija kroz 620 ms, krivu `.4, 0, .2, 1`, odloženo pojavljivanje sadržaja i prekid prethodne animacije iz trenutnog položaja. Poštuje sistemsku postavku smanjene animacije. Lokalni referentni fajl je `D:\Projects\niwa-remote\src\Niwa.Remote.Windows\SessionNotch.xaml.cs`, naročito redovi 145 do 180.

Preneti tajming i ponašanje u postojeći WebView2/CSS/SVG notch. WPF i .NET runtime nisu potrebni LocalFlowu. Početna širina ponude može biti oko 280 do 340 logičkih piksela, uz proveru dužih prevoda i malih ekrana. Desna ivica ostaje nepomična, telo se širi ulevo, a tekst i ✓ / × ulaze tek kada imaju dovoljno prostora.

Native okvir proširiti jednom za otvaranje, animirati unutrašnji oblik i smanjiti okvir kada se zatvaranje završi. Ne pomerati HWND na svakom frejmu. Prozirni delovi proširenog prozora moraju propuštati klikove. Očuvati ispravku topmost položaja iz 0.2.6, ne otimati fokus pri ponudi i dati alternativan tastaturni pristup komandama. Stvarni klik, hover, brzo otvaranje/zatvaranje i promena DPI-ja ulaze u testove.

**10. Predložene granice koda.** Ovo su mesta odgovornosti, ne obaveza da se unapred naprave svi fajlovi. Prilikom implementacije prvo primeniti Ponytail: ukloniti suvišan kod, koristiti postojeći servis i native Windows funkcije, pa dodati samo potrebne male module.

| Deo | Predloženo mesto | Odgovornost |
|---|---|---|
| Detekcija | `src-tauri/src/meeting_detection.rs` | Audio sesije, procesi i promene uređaja |
| Snimanje | `src-tauri/src/meeting_capture.rs` | Dva izvora, vremenska osnova, upis audio delova |
| Životni ciklus | `host/meetings/session.mjs` | Ponuda, potvrda, odbijanje, završavanje i oporavak |
| Transkripcija | Postojeći worker i mali meeting koordinator | Poslovi po delovima i vremensko poravnanje |
| Notes i sažetak | `host/meetings/notes.mjs`, `summary.mjs` | Jedna beleška po sesiji, proveren AI rezultat |
| Nalog | `host/account/` i mali zajednički UI modul | Clerk sesija, native callback i stanje odobrenih mogućnosti |
| Servis naloga | Mali pouzdan serverski servis | Vlasništvo nad uređajima, kratkotrajne ulaznice i Google pristup |
| Udaljeni pristup | `host/remote/` | Životni ciklus tunela i ovlašćeni pristup Notes operacijama |
| Notes sinhronizacija | Postojeći Notes servis i mali sync modul | Revizije, trajne promene, nastavak i ponavljanje operacija |
| Kalendar | `host/meetings/calendar.mjs` | Događaji i podsetnici preko zajedničkog naloga, lokalni keš |
| Notch | Postojeći `edge.rs`, `edge-panel.js/css`, mali meeting prikaz | Morph, kontrole i prikaz stanja |

Renderer prikazuje stanje i šalje komande. Ne upravlja trajnim snimanjem. Host je vlasnik sesije, a UI zatvaranje ili navigacija u Notes ne prekidaju razgovor. Ne uvoditi drugi lokalni backend, opšti plugin sistem ili novu bazu za beleške. Mali servis za naloge i povezivanje ima konkretan razlog: serverske Google/Clerk kredencijale, evidenciju uređaja i pristup preko interneta. Ne pretvarati ga u drugi meeting ili Notes engine.

**11. Redosled izrade i dokaz završetka.** Sve tražene funkcije ostaju u planu. Redosled služi da se prvo provere najrizičniji delovi.

| Korak | Isporuka | Uslov za nastavak |
|---|---|---|
| 1. Dokaz detekcije i zvuka | Detekcija i oba izvora na probnim pozivima, zajedno sa negativnim primerima | Meet, Zoom, WhatsApp i Viber zasebno; glasovne poruke, čekaonica i mikrofon test ne otvaraju ponudu u podržanom automatskom režimu |
| 2. Dokaz jednog Google toka | Tauri prijava kroz Clerk, Calendar dozvole i obnova pristupa | Jedno povezivanje daje profil i događaje; delimičan grant, opoziv i ponovno otvaranje aplikacije pravilno obrađeni |
| 3. Trajna meeting sesija | Snimanje, red STT poslova, Notes beleška i oporavak | Duga sesija, pad procesa, ponovno pokretanje i scoped cancellation bez gubitka potvrđeno zapisanih delova |
| 4. AI obrada | Naslov, teme, odluke, zadaci, otvorena pitanja i izvori | Provera prema transkriptu, više jezika, dug razgovor i retry bez dupliranja ili pregazivanja dopuna |
| 5. Notch i kalendarski kontekst | Traženi morph, ✓ / ×, statusi i povezani događaji | Ručno i automatsko pokretanje, odbijanje bez ponavljanja, opoziv kalendara bez prekida lokalnog snimanja |
| 6. Desktop osnova za mobilni pristup | Registry uređaja, upravljani tunel, ovlašćeni Notes API i sync ugovor | Test klijent sa druge mreže čita i menja isti workspace; obnova veze, konflikt i opoziv uređaja provereni |
| 7. Završna provera i izdanje | Potpuna desktop funkcija u pakovanoj aplikaciji | Native UI, audio, Notes, OAuth i remote testovi; povećana verzija i bezbedno aktiviranje |

Android/iOS aplikacija ostaje kasnija isporuka. Sadašnji plan predviđa funkcionalan desktop modul i proverljiv protokol, kako mobilni klijent kasnije ne bi zahtevao drugi nalog, novi Notes format ili prepravljanje vlasništva nad podacima. Test klijent za protokol nije dokaz da je gotova mobilna aplikacija.

Matrica provere obuhvata slušalice i zvučnike, Bluetooth i USB, promenjen izlaz, mute, grupni govor, govor preko govora, prekide veze i povratak u isti razgovor. Posebno proveriti kratke i višeminutne glasovne poruke, snimanje poruke uz video u drugom tabu, puštanje i snimanje poruka naizmenično, čekaonicu, test mikrofona, sopstveni LocalFlow VTT, kratak stvarni poziv i ulazak sa ugašenim mikrofonom. Rezultate voditi po aplikaciji i verziji: broj lažnih ponuda, propuštenih poziva i kašnjenje ponude. Nijedan prag trajanja ne sme biti jedini dokaz. Za UI proveriti 100%, 150% i 200% DPI, više monitora, reduced motion, prozirni hit-test i očuvan fokus.

Za naloge i udaljeni pristup proveriti nov i već povezan Google nalog, odobren profil bez Calendar dozvole, obnovu tokena, opoziv samo uređaja, gašenje udaljenog pristupa i puni opoziv Google veze. Tuđi nalog, promenjen host/workspace u ulaznici, istekao ili ponovljen zahtev moraju biti odbijeni. Proveriti dva računara istog naloga, dva naloga na istom računaru, promenu javne mreže, uspavljivanje i buđenje hosta, prekid prenosa i konflikt desktop/mobilne izmene. Merenje preko druge internet mreže obavezno je pre tvrdnje da pristup radi van LAN-a.

Meriti vreme od početka audio aktivnosti do ponude, vreme od ✓ do snimanja, kontinuitet oba toka, ASR zaostajanje, RAM tokom dvosatne sesije, CPU u mirovanju i veličinu zapisa. Cilj je ograničena memorija i zapis koji nastavlja i kada obrada kasni. Brzinu transkripcije i preciznost automatske detekcije ne predstavljati kao dokazane pre tih merenja.

Otvorene odluke za implementaciju su trajno zadržavanje audio fajlova, potreba za tačnim imenima govornika u grupnim razgovorima, mogućnosti browser dodatka i konačan izgled beleške iz najavljenog screenshota. Za izdavanje treba odrediti hosting malog servisa naloga, produkcioni Clerk/Google projekat i provisioniranje tunela. Jedna Google veza za profil i Calendar, priprema udaljenog Notes pristupa i odlaganje mobilne aplikacije jesu deo prihvaćenog smera ovog plana. Ova dopuna ne pokreće implementaciju ili izmene produkcionih naloga.
