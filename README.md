# Lande – hirsimökki rinnetontilla

Käsin piilutetuista mäntyhirsistä veistetty mökki lohenpyrstönurkin, loivalla harjurinteellä
järven rannassa, renderöitynä selaimessa WebGPU:lla. Sivuja on kaksi:

- **Mökki** (`index.html`): 12 × 8 m, sisäkorkeus 3 m, rossipohja betoniharkkopilareilla, neljä
  ikkunaa järvelle, terassi, pergola ja palju. Mökkiä voi siirtää ja kääntää tontilla.
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
| näkymärivi | valmiit näkymät: Mökki, Tontti, Terassi, Nurkka, Ranta, Varvikko |
| Valo | valon suunta ja auringon korkeus |
| Katto | katto päälle tai pois, tyyppi, pulpettikaton ylitys edessä, takana ja sivuilla |
| Terassi | terassi päälle tai pois, pergolan pää, palju / poreallas / ei allasta, liukulasit, näkösuoja |
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

**Rossipohja ja pilarit** (`src/mokki/structure.js`)

- Rossipohja on tuulettuva puurakenteinen alapohja: mökki seisoo pilarien päällä ja lattian alla
  on avoin ryömintätila. Alhaalta ylös: betoniharkkopilarit 300 × 300 mm anturoineen (22 kpl,
  jokaisen nurkan alla ja seinä- ja keskilinjoilla noin 2,3 m välein), bitumikaista,
  perustuspalkit 180 × 315 mm, lattiapalkit ja eriste, alla tuulensuojalevy, päällä 28 mm
  lattialaudat. Rakenteen paksuus on 33 cm, ja se on laskettu sisäkorkeuteen: lattian pinta on
  ensimmäisen hirsikerran yläreunan tasolla.
- Rinteessä mökki asettuu niin, että perustuspalkkien alle jää ylärinteen puolella 40 cm, ja
  alarinteen pilarit ovat sen verran pidempiä kuin maa laskee.

**Kevyt hirsi** (`src/mokki/mesh.js`, `src/mokki/wood.js`)

- Hirret, laudat ja palkit ovat yksi verkko (noin 32 000 kolmiota terassin kanssa) ja yksi
  materiaali. Mallihirressä on yksinään 207 000 kolmiota.
- Hirsi on verkossa vain muutama taso. Piilutuksen aallot, vuosirenkaat ja oksat lasketaan
  varjostimessa pikseleittäin samalla periaatteella kuin mallihirressä: väri tulee pikselin
  paikasta rungon sisällä, ja piiluiskun kouru siirtää paikkaa pari milliä syvemmälle.
- Iskut ja oksat arvotaan varjostimessa hirren siemenestä, joten hirsikohtaisia tekstuureja
  ei tarvita. Sahatavara (laudat, palkit) käyttää samaa puuta ilman piilutusta.
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
  joka jatkuu terassin ulkoreunan yli 2,6 m kasvihuoneena. Ulkosivulla on laudoitettu seinäke,
  päädyssä ja terassin puolella liukulasit. Leveys on valittu niin, että pergola mahtuu mökin
  nurkan ja ikkunoiden väliin.
- Pergolan alla on terassiin upotettu palju (Ø 1,95 m, lämpöpuu, kamina ja savupiippu lasikaton
  läpi) tai poreallas (2,2 × 2,2 m). Terassilaudat on sahattu altaan muotoon.
- Terassin toisessa päässä on valinnainen 2,5 m näkösuoja. Pergolan voi peilata mökin
  kumpaan päähän tahansa.
- Terassi seisoo omilla 240 × 240 mm harkkopilareillaan. Portaat ulkoreunalta maahan ja kaide
  (kun pudotusta on yli puoli metriä) mitoittuvat maaston mukaan.

## Tontti

**Maasto** (`src/tontti/terrain.js`)

- Esikuvana ovat Etelä-Savon ja Päijänteen harjurannat (Mäntyharju): lajittunutta hiekkaa ja
  soraa, kuivahko mäntykangas, loivasti syvenevä hiekkaranta ja kirkas, hieman ruskea vesi.
- Tontti on 90 m leveä ja ulottuu rannasta 118 m rinteeseen (noin 1,06 ha). Rannasta nousee
  matala törmä, sen jälkeen rinne on noin 4,5 % ja siinä on tasaisempi hylly, jolla mökki
  oletuksena seisoo; tontin takana on harjun laki.
- Korkeus lasketaan yhdestä funktiosta (`heightAt`), jota käyttävät maaston verkko, kasvien ja
  kivien sijoittelu, mökin pilarit ja kamera.
- Metsänpohjan väri tulee kasvupaikasta: kuivilla kummuilla kanervaa ja poronjäkälää,
  tavallisimmin puolukkaa ja seinäsammalta, notkoissa mustikkaa; puiden alla neulaskariketta,
  rannassa ja laikuittain paljasta hiekkaa. Läheltä näkyy sammalen, neulasten ja risujen rakenne.

**Metsä** (`src/tontti/forest.js`, `src/tontti/atlas.js`)

- Tontilla on noin 290 puuta: vanhoja, korkealta oksattomia mäntyjä (15–24 m, yläosan kaarna
  oranssi), nuoria mäntyjä, koivuja, haaparyhmä, alikasvoskuusia, katajia, pihlajia ja rannassa
  leppiä. Tontin ympärillä on noin 1 500 kevyempää puuta taustana.
- Siirtolohkareita on harjulle tyypillisesti harvakseltaan: seitsemän isoa lohkaretta
  seuralaisineen, pienempiä kiviä ja vesirajassa mukulakiviä (yhteensä noin sata).
- Varvikko on noin 33 000 mätästä (puhelimessa 23 000): puolukkaa, mustikkaa, kukkivaa
  kanervaa ja metsälauhaa luonnollisessa koossaan (puolukka 10–20 cm, mustikka 20–30 cm,
  kanerva 25–40 cm). Laji valitaan kasvupaikan kuivuudesta.
- Kasvien kuvat piirretään käynnistyksessä kanvaasille; kuvatiedostoja ei ole.

**Mökin siirto**

- Paikka-paneelista mökin voi siirtää napauttamalla maastoa ja kääntää liukusäätimellä.
  Jalanjälki pysyy tontilla ja kuivalla maalla.
- Puut, kivet ja mättäät katoavat mökin ja terassin alta. Mökin edessä on pihapiiri, josta puut
  on kaadettu, ja siitä rantaan näkymälinja, jolta on raivattu matalat puut mutta petäjät
  jätetty. Kaikki tämä tehdään varjostimessa: jokainen kasvin kärki tietää tyvensä paikan, ja
  jalanjäljen sisään jäävät kutistuvat pisteeksi. Siirrossa rakennetaan uudelleen vain pilarit,
  portaat ja kaide.

**Keveys**

- Puut ovat kahdessa verkossa (rungot ja lehvästö), kivet yhdessä ja varvikko alueittain;
  maasto on harveneva ruudukko (43 000 kolmiota). Kohtauksessa on noin 450 000 kolmiota.
- Varjokartta piirretään vain, kun aurinko, mökki tai kuvattava alue muuttuu, ei joka ruudulla.
  Se seuraa kameran kohdetta: läheltä tarkka, kaukaa koko tontin kattava.
- Varvikko piirretään vain kameran lähellä (60 m). Jos laite ei pysy tahdissa alimmallakaan
  tarkkuudella, etäisyyttä lyhennetään.

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
  `?lasit=0`, `?suoja=0` sekä mökin paikka `?x=…&z=…&suunta=…`.

## Referenssit

- [Hirsimies](http://www.hirsimies.fi/): käsin piilutettu seinä sivuvalossa ja lohenpyrstönurkka.
- [Hirsitaito: hirsirakennuksen veistäminen](https://hirsitaito.fi/hirsirakennuksen-veistaminen/):
  piilukirveen jälki läheltä.
- [Blocklayer: log dovetail](https://www.blocklayer.com/woodjoints/log-dovetail): täyden
  lohenpyrstön tasot viettävät kahteen suuntaan.
- [Luke: Metsätyypit – opas kasvupaikkojen luokitteluun](https://jukuri.luke.fi/server/api/core/bitstreams/30b663b3-9fbf-4b77-9dd9-9f2fbb7b64e3/content):
  puolukkatyypin (kuivahko kangas) puusto, varpujen peittävyydet ja pohjakerros.
- [Luontoportti](https://luontoportti.com/): puolukan, mustikan ja kanervan koko ja värit.
- [Retkipaikka: Kelventeen harjupolku](https://retkipaikka.fi/kelventeen-harjupolku-padasjoella/):
  kapea hiekkaranta harjumännikön alla Päijänteellä.

## Rajoitukset

- Testaus on tehty headless-Chromiumissa ohjelmallisella WebGPU-laitteella ja WebGL 2
  -varatilalla. Mallihirsi ja aiempi mökin runko on ajettu iPhonella WebGPU:lla; tonttia ei
  vielä. Ohjelmallisella laitteella tontti on noin neljä kertaa raskaampi kuin pelkkä runko.
- Tontti on alustava malli eikä mikään tietty kiinteistö. Vesi on tyyni eikä liiku, eikä
  tuulta ole.
- Mökissä ei ole ovia, väliseiniä, kattotuoleja eikä sisustusta. Ikkunoissa on karmit ja lasi
  mutta ei puitteita. Pitkien seinien jatkokset ovat suoria puskuliitoksia.
- Mökin hirsissä kyljen aallot ovat varjostuksessa ja puun kuviossa, eivät ääriviivassa.
- Liikkeessä mättäiden ohuet varret voivat näkyä rasterina; pysähtynyt kuva on sileä.
- Hirret ovat tuoreita: kuivumishalkeamia ja harmaantumista ei ole.
