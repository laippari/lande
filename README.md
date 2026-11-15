# Lande – piiluhirsi

Käsin piilutettu mäntyhirsi lohenpyrstöpäin, renderöitynä selaimessa WebGPU:lla. Tämä on
ensimmäinen vaihe: yksi hirsi. Myöhemmin samoista hirsistä kootaan kokonainen mökki.

Hirsi on 5,0 m pitkä ja 20 cm paksu. Korkeus on tyvellä 35 cm ja latvassa 30 cm, koska hirsi
on tehty kapenevasta rungosta (läpimitta noin 38 → 33 cm).

## Avaaminen

```sh
python3 -m http.server 8000      # → http://localhost:8000
```

Sivu on staattinen, joten käännösvaihetta ei ole. three.js ladataan jsDelivr-CDN:stä
(`three@0.187.0`, lukittu versio).

**Julkaisu:** jokainen `main`-haaran push julkaisee sivun GitHub Pagesiin
(`.github/workflows/pages.yml`): https://laippari.github.io/lande/

| Ele | Toiminto |
| --- | --- |
| 1 sormi / hiiren vasen | kierto |
| 2 sormea / hiiren oikea | siirto; nipistys tai rulla lähentää osoitettuun kohtaan |
| kaksoisnapautus | tarkennus napautettuun kohtaan hirressä |
| alareunan painikkeet | valmiit näkymät: koko hirsi, tyvipää, piilutus, latvapää |
| aurinkopainike | valon suunta ja auringon korkeus |

## Mitä mallissa on

**Muoto** (`src/log/shape.js`, `geometry.js`)

- Kyljet on veistetty tasoiksi 20 cm:n päähän toisistaan. Selkä on rungon kuorittua pyöreää
  pintaa, jossa näkyvät vuolun pitkät viisteet. Alapinnassa on varaus eli ura, jolla hirsi
  istuu alemman hirren selkään.
- Runko ei ole viivasuora eikä pyöreä: ydin vaeltaa noin sentin ja pinta on hieman soikea.
  Siksi veistetyn kyljen ja selän välinen särmä aaltoilee.
- Päissä on lohenpyrstötappi. Tapin ylä- ja alapinta ovat tasoja, jotka viettävät kahteen
  suuntaan (noin 11° seinän paksuussuunnassa ja 7° hirren suunnassa). Tappi on paksuimmillaan
  päässä ja seinän sisäpinnan puolella, joten nurkka lukittuu, ja yläpinta viettää ulospäin,
  joten vesi valuu pois liitoksesta. Tappi ulkonee 3,5 cm ristiin tulevan seinän pinnasta.

**Piilutus** (`src/log/hewing.js`)

- Jokainen piilukirveen isku on matala kouru: noin 7–11 cm leveä, 2–3 mm syvä ja terän
  mittainen. Terä on lähes pystyssä, joten kourujen väliset harjat kulkevat hirren poikki,
  ja terän kupera muoto piirtää harjan kaarelle.
- Veistetty pinta on kaikkien iskujen syvin kohta. Iskuja on noin 240, ja ne on arvottu
  niin kuin veistäjä etenee: väli, kallistus ja syvyys elävät iskusta toiseen.
- Varjostin laskee saman pinnan iskuista jokaiselle pikselille, joten harjat pysyvät terävinä
  läheltäkin eikä tarkkuus riipu tekstuurin koosta.

**Puuaines** (`src/log/wood.js`, `knots.js`)

- Puu on tilavuustekstuuri: väri lasketaan pikselin todellisesta paikasta rungon sisällä.
  Etäisyys ytimestä kertoo vuosirenkaan, ja renkaan vaihe kertoo, ollaanko vaaleassa
  kevätpuussa vai tummassa kesäpuussa. Mitään kuvaa ei ole liimattu pintaan.
- Tyvellä on 96 vuosirengasta. Renkaat ovat ytimen lähellä 4–5 mm ja pinnassa noin 1,6 mm
  leveitä, ja leveys vaihtelee vuodesta toiseen.
- Renkaat kulkevat rungon pinnan suuntaisesti, joten kapeneva runko leikkaa niitä kyljessä
  ja piirtää liekkikuvion. Piiluiskun kouru painuu pari milliä syvemmälle puuhun ja leikkaa
  renkaita omasta kohdastaan: kyljen keskelle syntyy saarekkeita ja silmiä, reunoilla viivat
  vain taipuvat. Tämä tulee geometriasta itsestään.
- Sydänpuu (noin 60 % säteestä) on punertavampaa kuin pintapuu. Kyljessä se näkyy keskellä
  kulkevana tummempana vyönä ja päissä tummempana keskustana.
- Oksat lähtevät ytimestä kiehkuroina 35–60 cm välein. Oksa on latvaa kohti nouseva kartio;
  rungon renkaat kiertävät sen ympäri. Osa oksista on kuollut ja jäänyt puun sisään.
- Pinnan viimeistely riippuu työkalusta: kirveen jäljiltä kylki on sileä ja kiiltää, päätypuu
  on tummempaa ja mattaa ja siinä näkyvät sahanjäljet.

**Valo ja ympäristö** (`src/scene.js`, `src/main.js`)

- Aurinko on suunnattu valo, jolla on varjot; varjokartta sovitetaan hirren ja sen varjon
  ympärille. Taivas valaisee ympäristökartan kautta, ja kartan alapuolisko on auringon
  valaisemaa maata, joten alapinnat saavat lämpimän heijastusvalon.
- Ambient occlusion (GTAO) himmentää vain taivaan valoa, ei auringon suoraa valoa. Maassa
  hirren alla taivaan peittyminen lasketaan lisäksi suoraan hirren poikkileikkauksesta.
- Liikkeessä kuva piirretään 4 × MSAA:lla ja tarkkuus mukautuu laitteen nopeuteen. Kun kuva
  pysähtyy, se piirretään uudelleen 8 näytteen ylinäytteistyksellä (puhelimessa 4).
- Matala aurinko on lämmin ja himmeämpi, ja kameran valotus seuraa sitä.
- Ympärillä on hiekkapiha, kaksi harmaantunutta aluspuuta, veistolastuja ja kaukana metsän reuna.

## Tekniikka

- three.js `WebGPURenderer` ja TSL-varjostimet. Jos selain ei tue WebGPU:ta, sama koodi
  ajetaan WebGL 2:lla (`?webgl` pakottaa sen). Käytössä oleva tekniikka näkyy otsikon vieressä.
- Hirren verkossa on noin 207 000 kolmiota, ja se rakennetaan selaimessa noin 0,3 sekunnissa.
- Jos WebGPU antaa laitteella virheen käynnistyksen aikana, sivu latautuu itsestään uudelleen
  WebGL 2 -varatilaan. `?webgpu` kokeilee WebGPU:ta uudelleen.
- `?mittari` (tai `#mittari`): hirsi pyörii itsestään ja otsikon alla näkyy ruutuaika liikkeessä,
  kuvataajuus ja käytössä oleva tarkkuus. Tällä näkee, miten sivu jaksaa omalla laitteella.
- Osoiteparametrit: `?view=koko|tyvi|piilutus|latva`, `?az=…&el=…` (aurinko),
  `?q=mobile|desktop` (laatutaso), `?pr=…` (pikselisuhteen yläraja), `?ssaa=…`, `?noao`,
  `?nostill`, `?cam=x,y,z,tx,ty,tz`.

## Referenssit

Muoto ja pinta on tehty kuvien ja kuvausten pohjalta:

- [Hirsimies](http://www.hirsimies.fi/): käsin piilutettu seinä sivuvalossa ja lohenpyrstönurkka.
  Sivun mukaan käsin piilutetun pinnan ”maalut ovat epäsäännöllisiä ja jälki elävä, kirveen
  jäljiltä pinta kiiltää”.
- [Hirsitaito: hirsirakennuksen veistäminen](https://hirsitaito.fi/hirsirakennuksen-veistaminen/):
  piilukirveen jälki läheltä ja pelkkahirren veisto.
- [Blocklayer: log dovetail](https://www.blocklayer.com/woodjoints/log-dovetail): täyden
  lohenpyrstön tasot viettävät kahteen suuntaan.

## Rajoitukset

- Testaus on tehty headless-Chromiumissa ohjelmallisella WebGPU-laitteella (SwiftShader) ja
  WebGL 2 -varatilalla. Oikealla näytönohjaimella ja Safarissa sivua ei ole vielä ajettu, joten
  nopeus puhelimessa on mittaamatta.
- Hirsi on tuore: kuivumishalkeamia ja harmaantumista ei ole.
- Varauksen ja tapin tasojen pinta on yksinkertainen (ei työkalun jälkiä).
