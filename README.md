# Lande – hirsimökki mäntykankaalla

Käsin piilutetuista mäntyhirsistä veistetty mökki lohenpyrstönurkin, loivalla mäntykangasrinteellä
järven rannassa, renderöitynä selaimessa WebGPU:lla. Sivuja on kaksi:

- **Mökki** (`index.html`): 12 × 8 m, sisäkorkeus 3 m, valettu sokkeli, neljä ikkunaa järvelle,
  terassi, ympäri lasitettu pergola ja palju. Mökkiä voi siirtää ja kääntää tontilla, ja maa
  muotoutuu sen alle.
- **Mallihirsi** (`hirsi.html`): yksi täyslaatuinen 5 m hirsi. Se on lähde, josta mökin kevyet
  hirret on johdettu, ja siihen verrataan, kun mökin hirsiä muutetaan.

## Avaaminen

```sh
python3 -m http.server 8000      # → http://localhost:8000
```

Sivu on staattinen, joten käännösvaihetta ei ole. three.js ladataan jsDelivr-CDN:stä
(`three@0.187.0`, lukittu versio).

**Julkaisu:** jokainen `main`-haaran push julkaisee sivun GitHub Pagesiin
(`.github/workflows/pages.yml`): https://laippari.github.io/lande/

| Ele tai painike | Toiminto |
| --- | --- |
| 1 sormi / hiiren vasen | kierto |
| 2 sormea / hiiren oikea | siirto; nipistys tai rulla lähentää osoitettuun kohtaan |
| kaksoisnapautus | tarkennus napautettuun kohtaan |
| säädinpainike (oikea alakulma) | avaa alapaneelin; sulkeutuu ruksista, Esc-näppäimellä tai vetämällä alas |

Alapaneelin välilehdet (`src/sheet.js`; viimeksi käytetty välilehti muistetaan):

| Välilehti | Sisältö |
| --- | --- |
| Näkymä | valmiit näkymät (Mökki, Tontti, Terassi, Nurkka, Ranta, Varvikko) ja puiden piilotus kameran ympäriltä 0–60 m kuvaamista varten |
| Valo | valon suunta ja auringon korkeus |
| Mökki | hirsien sävy (vastaveistetystä tummuneeseen), katto päälle tai pois, tyyppi, ylitykset |
| Terassi | terassi päälle tai pois, pergolan pää, palju / poreallas / ei allasta, liukulasit |
| Paikka | mökin siirto napauttamalla maastoa, mökin suunta, palautus |

## Mökki

**Runko** (`src/mokki/plan.js`)

- Ulkomitat 12 × 8 m, hirren paksuus 20 cm. Sisäkorkeus on 3 m lattiasta matalan seinän
  yläpäähän; pulpettikatossa etuseinä on noin 1,1 m korkeampi.
- Hirret kapenevat tyvestä latvaan, joten kerros on toisesta päästä paksumpi kuin toisesta
  (esimerkiksi 27 cm → 31 cm), ja seuraava kerros veistetään sen selkään. Tyvet vuorottelevat,
  joten seinä pysyy keskimäärin vaakasuorassa ja saumat viettävät vuorotellen kumpaankin
  suuntaan. Kerrosten korkeus vaihtelee 23–42 cm; joukossa on muutama järeä hirsi.
- Pitkillä seinillä hirsiä on kaksi tai kolme peräkkäin, ja jatkokset ovat limittäin.
  Päätyseinät ovat yhtä hirttä ja puoli kerrosta ylempänä kuin pitkät seinät.
- Nurkissa hirret lomittuvat lohenpyrstötapein. Tappien väliset tasot viettävät kahteen
  suuntaan ja ovat samat molemmille hirsille.
- Etuseinässä on neljä ikkunaa kahtena parina keskellä seinää: kukin 1,0 × 2,5 m, alareuna
  lattian rajassa, mäntykarmit ja vuorilaudat. Aukot katkaisevat hirret ja loveavat aukon
  ylä- ja alapuolisen hirren.
- Pulpettikatolle runkoon tulee 86 hirttä, harjakatolle 81.

**Perustus** (`src/mokki/structure.js`)

- Mökki seisoo valetun betonisokkelin päällä: yhtenäinen kehä seinien alla, näkyvissä noin
  35 cm, muottilautojen jäljet pinnassa ja tuuletusluukut kyljissä. Sokkelin sisällä on
  tuulettuva ryömintätila (rossipohja); lattian pinta on 33 cm sokkelin yläpinnasta eli
  ensimmäisen hirsikerran yläreunan tasolla, ja sisäkorkeus mitataan siitä.
- Sokkelin ympärillä on puolen metrin kaista tummaa soraa. Sävy on tumma, jotta perustus ei
  erotu metsänpohjasta.
- Maa muotoillaan mökin ja terassin alta tasaiseksi (ks. Tontti), joten korkeita pilareita ei
  tarvita missään kohdassa tonttia.

**Kevyt hirsi** (`src/mokki/mesh.js`, `src/mokki/wood.js`)

- Hirret, laudat ja palkit ovat yksi verkko (noin 30 000 kolmiota terassin kanssa) ja yksi
  materiaali. Mallihirressä on yksinään 207 000 kolmiota.
- Hirsi on verkossa vain muutama taso. Piilutuksen aallot, vuosirenkaat ja oksat lasketaan
  varjostimessa pikseleittäin samalla periaatteella kuin mallihirressä: väri tulee pikselin
  paikasta rungon sisällä, ja piiluiskun kouru siirtää paikkaa pari milliä syvemmälle.
- Iskut ja oksat arvotaan varjostimessa hirren siemenestä, joten hirsikohtaisia tekstuureja
  ei tarvita. Sahatavara (laudat, palkit) käyttää samaa puuta ilman piilutusta.
- Hirsien sävyä voi säätää vastaveistetyn vaaleasta männystä vuosia ulkona olleeseen
  kullanruskeaan; oletus on siltä väliltä. Syykuvio ja vuosirenkaat säilyvät.
- Kaukaa katsottaessa hienoin rakenne (syyt, oksat) jätetään laskematta.

**Katto** (`src/mokki/roof.js`)

- Malli ja mitat ovat talo-projektista: tumma konesaumapelti, pystysaumat 0,5 m välein lappeen
  suuntaan, otsalaudat reunoissa. Pulpettikaton kaltevuus on 14 % ja harjakaton 1:2.
- Pulpettikatossa ylitystä voi säätää edessä ja takana (0–3 m) sekä sivuilla (0–1,5 m);
  harjakatossa päätyräystään ylitystä.

**Terassi** (`src/mokki/terrace.js`)

- Talo-projektin pienempi terassimalli sovitettuna mökin leveyteen: 150 mm laudoista tehty
  terassi kulkee etuseinän päästä päähän (12 m) ja on 4,4 m syvä.
- Toisessa päässä on 3,3 m leveä pergola (150 × 150 mm puuta, lasikatto, kallistus 5 % sivulle),
  joka jatkuu terassin ulkoreunan yli 2,6 m kasvihuoneena. Pergola on lasitettu ympäri:
  ulkosivulla on kiinteä lasi hoikkien pylväiden välissä, päädyssä ja terassin puolella
  liukulasit. Leveys on valittu niin, että pergola mahtuu mökin nurkan ja ikkunoiden väliin.
- Pergolan alla on terassiin upotettu palju (Ø 1,95 m, lämpöpuu, kamina ja savupiippu lasikaton
  läpi) tai poreallas (2,2 × 2,2 m). Terassilaudat on sahattu altaan muotoon.
- Pergolan voi peilata mökin kumpaan päähän tahansa.
- Terassi seisoo matalilla tummilla betoniharkoilla (240 × 240 mm). Harkot ja kannatinpalkit
  on vedetty 0,7–0,85 m reunoilta terassin alle, joten ne eivät näy etureunasta; terassin
  reuna on uloke. Portaat ulkoreunalta maahan mitoittuvat maaston mukaan, ja kaide tulee vain,
  jos pudotusta on yli 70 cm.

## Tontti

Esikuvana ovat Metsähallituksen Laatumaan myynnissä olevat Mäntyharjun rantatontit (Korpijärven
Iso Kuivinniemi, Peruvesi, Huuhtjärvi): tasaikäinen hoikka männikkö, yhtenäinen sammal- ja
varpumatto sammaleisine kivineen ja ranta, jossa metsä ulottuu vesirajaan.

**Maasto** (`src/tontti/terrain.js`)

- Tontti on 90 m leveä ja ulottuu rannasta 118 m rinteeseen (noin 1,06 ha). Rinne on noin
  9 %, ja maa nousee rannasta tontin perälle noin 12 m.
- Ranta: metsä ja varvikko jatkuvat vesirajaan asti. Rannassa on matala törmä, kivinen
  rantaviiva ja lehtipuureunus (leppiä, koivuja, pajupensaita), jotka kurottavat veden ylle.
  Paljasta hiekkaa on vain kapea märkä kaista; hiekkapohja kuultaa matalassa, kirkkaassa mutta
  ruskehtavassa vedessä muutaman metrin matkalla, ja matalikossa kasvaa harvaa kortetta.
- Rakennuspaikan muotoilu: mökin ja terassin alta maa tasataan jalanjäljen luonnollisen maan
  keskikorkeuteen (leikkaus ja täyttö tasan) ja liitetään ympäröivään rinteeseen noin kuuden
  metrin matkalla. Muotoilu seuraa mökkiä, minne tahansa se siirretään: maaston verkon
  korkeudet päivitetään, ja puut, kivet ja mättäät nousevat tai laskevat maan mukana
  varjostimessa.
- Korkeus lasketaan yhdestä funktiosta (`heightAt`), jota käyttävät maaston verkko, mökin
  perustus ja kamera.
- Metsänpohja: kellanvihreä sammalmatto (seinä- ja kerrossammal), sen päällä mustikka ja
  puolukka; kanervaa ja poronjäkälää vain kuivimmilla paikoilla, puiden tyvillä
  neulaskariketta. Läheltä näkyy sammalen, neulasten ja risujen rakenne.

**Metsä** (`src/tontti/forest.js`, `src/tontti/atlas.js`)

- Tontilla on noin 500 puuta, joista kaksi kolmasosaa on mäntyjä. Tavalliset männyt ovat
  hoikkia ja suoria (16–23 m, rinnankorkeusläpimitta 17–30 cm): tyvellä harmaanruskea
  kilpikaarna, muutaman metrin korkeudelta oranssi hilseilevä kaarna, pieni latvus korkealla ja
  sen alla kuolleita oksantynkiä. Noin joka kahdeksas mänty on järeä vanha petäjä (24–29 m,
  läpimitta 48–83 cm), jolla on leveä, laakea latvus. Vertailuksi: kangasmetsän vanhat männyt
  ovat tyypillisesti 50–80 cm paksuja, ja Suomen suurimpien mäntyjen ympärysmitta on lähes
  4 m eli läpimitta yli metrin. Männyn oksat ovat oksan suuntaisia neulasviuhkoja.
  Seassa on nuoria mäntyjä, alikasvoskuusia, koivuja, haaparyhmä, katajia ja pihlajia.
  Tontin ympärillä on noin 1 500 kevyempää puuta taustana.
- Kiviä on noin 650: parikymmentä isoa siirtolohkaretta seuralaisineen, sammaleisia maakiviä
  ryhminä ja rantaviivan kivikko. Metsässä kivet ovat sammalen ja rupijäkälän peitossa, vesirajassa
  paljaita ja märkiä.
- Varvikko peittää kangasmetsän pohjan lähes yhtenäisesti: noin 63 000 mätästä (puhelimessa
  vähemmän) mustikkaa, puolukkaa, kanervaa ja metsälauhaa luonnollisessa koossaan (puolukka
  10–20 cm, mustikka 20–30 cm, kanerva 25–40 cm); rannassa heinää ja saraa. Laji valitaan
  kasvupaikan kuivuudesta. Tontin sivuilla mättäitä on harvemmin mutta isompina.
- Mökin ympärillä on aina tiheä varvikko (noin 5 000 mätästä) sokkelin sorakaistan ulkoreunasta
  noin yhdeksän metrin päähän ja terassin ympärillä. Vyöhyke rakennetaan uudelleen, kun mökki
  siirtyy.
- Mättäät piirretään 170 metriin asti (puhelimessa 120). Kauempana niistä piirretään vain osa
  mutta isompina, joten varvikko näkyy myös kaukaa ilman että piirtäminen raskaantuu. Maan
  varjostin piirtää kauas mättäiden kuvion, jonka koko kasvaa etäisyyden mukana.
- Kasvien kuvat piirretään käynnistyksessä kanvaasille; kuvatiedostoja ei ole.

**Mökin siirto ja puiden väistö**

- Paikka-välilehdeltä mökin voi siirtää napauttamalla maastoa ja kääntää liukusäätimellä.
  Jalanjälki pysyy tontilla ja kuivalla maalla.
- Puu väistyy vain, jos sen runko osuu mökkiin, terassiin tai katon alle; kivet ja mättäät
  väistyvät mökin ja terassin alta. Muuten metsä jää mökin ympärille sellaisenaan.
- Kuvaamista varten Näkymä-välilehden liukusäätimellä puut voi piilottaa kameran ympäriltä
  (0–60 m). Piilotetut puut jäävät varjokarttaan, joten valo ja varjot pysyvät luonnollisina.
  Aivan kameran vierestä (2,5 m) puut piilotetaan aina, jottei runko peitä koko kuvaa.
- Kaikki tämä tehdään varjostimessa: jokainen kasvin kärki tietää tyvensä paikan, ja
  väistyvät kutistuvat pisteeksi. Siirrossa päivitetään maaston korkeudet ja rakennetaan
  uudelleen vain terassin harkot ja portaat.
- Mökki-näkymä hakee silmän korkeudelta kulman, josta mökki näkyy runkojen välistä.

**Keveys**

- Puut ovat kahdessa verkossa (rungot ja lehvästö), kivet yhdessä ja varvikko alueittain;
  maasto on harveneva ruudukko (46 000 kolmiota). Kohtauksessa on noin 720 000 kolmiota.
- Varjokartta piirretään vain, kun aurinko, mökki tai kuvattava alue muuttuu, ei joka ruudulla.
  Se seuraa kameran kohdetta: läheltä tarkka, kaukaa koko tontin kattava.
- Varvikko piirretään 170 metriin asti ja harvenee etäisyyden mukana. Jos laite ei pysy
  tahdissa alimmallakaan tarkkuudella, etäisyyttä lyhennetään.
- Kaukaa kaarnan kuvio sulautuu tasaiseksi sävyksi, ja kaarnan kohouma lasketaan vain läheltä.

## Mallihirsi

5,0 m pitkä ja 20 cm paksu, korkeus tyvellä 35 cm ja latvassa 30 cm.

- **Muoto** (`src/log/shape.js`, `geometry.js`): veistetyt kyljet, kuorittu pyöreä selkä, varaus
  ja lohenpyrstötappi molemmissa päissä. Runko kapenee eikä ole viivasuora eikä pyöreä.
- **Piilutus** (`src/log/hewing.js`): noin 240 piilukirveen iskua, kukin matala kouru. Veistetty
  pinta on kaikkien iskujen syvin kohta, ja varjostin laskee sen pikseleittäin.
- **Puuaines** (`src/log/wood.js`, `knots.js`): tilavuustekstuuri. Tyvellä on 96 vuosirengasta,
  sydänpuu on noin 60 % säteestä, ja oksat lähtevät ytimestä kiehkuroina.

## Yhteiset osat

- `src/viewer.js`: renderöinti ja silmukka. three.js `WebGPURenderer` ja TSL-varjostimet; jos
  selain ei tue WebGPU:ta tai laite antaa virheen käynnistyksessä, sama koodi ajetaan
  WebGL 2:lla. Käytössä oleva tekniikka näkyy otsikon vieressä.
- Liikkeessä kuva piirretään 4 × MSAA:lla ja tarkkuus mukautuu laitteen nopeuteen (tavoite yli
  40 kuvaa sekunnissa). Kun kuva pysähtyy, se piirretään ylinäytteistettynä.
- `src/env.js`: aurinko varjoineen, taivas ympäristökarttana ja kaukainen metsänreuna
  (mallihirren sivulla myös hiekkapiha). Ambient occlusion himmentää vain taivaan valoa.
- `src/noise.js`: yksi pieni 3D-kohinatekstuuri varjostimille ja sama kohina JavaScriptille.
- `?mittari` (tai `#mittari`): kohde pyörii itsestään ja otsikon alla näkyy ruutuaika liikkeessä,
  kuvataajuus ja käytössä oleva tarkkuus.
- Osoiteparametrit: `?view=…`, `?az=…&el=…` (aurinko), `?q=mobile|desktop`, `?pr=…`, `?ssaa=…`,
  `?noao`, `?nostill`, `?webgl`, `?webgpu`, `?cam=x,y,z,tx,ty,tz`. Mökissä lisäksi `?katto=0`,
  `?tyyppi=harja`, `?etu=…`, `?taka=…`, `?sivu=…`, `?terassi=0`, `?paa=oikea`, `?allas=spa|ei`,
  `?lasit=0`, `?raivaus=…` (m), `?savy=0…1` sekä mökin paikka `?x=…&z=…&suunta=…`.

## Referenssit

- [Hirsimies](http://www.hirsimies.fi/): käsin piilutettu seinä sivuvalossa ja lohenpyrstönurkka.
- [Hirsitaito: hirsirakennuksen veistäminen](https://hirsitaito.fi/hirsirakennuksen-veistaminen/):
  piilukirveen jälki läheltä.
- [Blocklayer: log dovetail](https://www.blocklayer.com/woodjoints/log-dovetail): täyden
  lohenpyrstön tasot viettävät kahteen suuntaan.
- [Laatumaa: Mäntyharjun tontit](https://www.laatumaa.fi/tontit-ja-rakennukset/?mode=list&municipality%5B%5D=M%C3%A4ntyharju&itemgroup=tontit&orderby=price-desc):
  rantatonttien valokuvat (Korpijärvi, Peruvesi, Huuhtjärvi) männikön, metsänpohjan ja rannan
  esikuvina. Kuvia on käytetty vain vertailuun; mallissa ei ole niistä mitään.
- [Luke: Metsätyypit – opas kasvupaikkojen luokitteluun](https://jukuri.luke.fi/server/api/core/bitstreams/30b663b3-9fbf-4b77-9dd9-9f2fbb7b64e3/content):
  puolukkatyypin (kuivahko kangas) puusto, varpujen peittävyydet ja pohjakerros.
- [Luontoportti](https://luontoportti.com/): puolukan, mustikan ja kanervan koko ja värit.

## Rajoitukset

- Testaus on tehty headless-Chromiumissa ohjelmallisella WebGPU-laitteella ja WebGL 2
  -varatilalla. Mallihirsi ja aiempi mökin runko on ajettu iPhonella WebGPU:lla; tonttia ei
  vielä. Ohjelmallisella laitteella tontti on noin viisi kertaa raskaampi kuin pelkkä runko.
- Tontti on alustava malli eikä mikään tietty kiinteistö. Vesi on tyyni eikä liiku, eikä
  tuulta ole.
- Maan muotoilu on pelkkä tasaus: tukimuureja, salaojia tai ajotietä ei ole.
- Mökissä ei ole ovia, väliseiniä, kattotuoleja eikä sisustusta. Ikkunoissa on karmit ja lasi
  mutta ei puitteita. Pitkien seinien jatkokset ovat suoria puskuliitoksia.
- Mökin hirsissä kyljen aallot ovat varjostuksessa ja puun kuviossa, eivät ääriviivassa.
- Liikkeessä mättäiden ohuet varret voivat näkyä rasterina; pysähtynyt kuva on sileä.
- Hirret ovat tuoreita: kuivumishalkeamia ja harmaantumista ei ole.
