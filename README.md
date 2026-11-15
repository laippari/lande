# Lande – hirsimökki piiluhirsistä

Käsin piilutetuista mäntyhirsistä veistetty mökin runko lohenpyrstönurkin, renderöitynä
selaimessa WebGPU:lla. Sivuja on kaksi:

- **Mökki** (`index.html`): runko 14 × 6 m, sisäkorkeus 4 m, pulpetti- tai harjakatto.
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

| Ele | Toiminto |
| --- | --- |
| 1 sormi / hiiren vasen | kierto |
| 2 sormea / hiiren oikea | siirto; nipistys tai rulla lähentää osoitettuun kohtaan |
| kaksoisnapautus | tarkennus napautettuun kohtaan |
| alareunan painikkeet | valmiit näkymät |
| aurinkopainike | valon suunta ja auringon korkeus |
| talopainike (mökki) | katto päälle tai pois, katon tyyppi, pulpettikaton ylitykset |

## Mökki

**Runko** (`src/mokki/plan.js`)

- Ulkomitat 14 × 6 m, hirren paksuus 20 cm, sokkeli 30 cm. Sisäkorkeus on 4 m matalalla
  seinällä; pulpettikatossa etuseinä on noin 0,8 m korkeampi.
- Seinä on pino hirsikerroksia, joiden korkeus vaihtelee (keskimäärin 28,5 cm). Saumat eivät
  ole viivasuoria: hirsi on tyvestä paksumpi kuin latvasta, joten sauma viettää hieman ja
  tyvet vuorottelevat kerroksittain.
- Pitkillä seinillä on kolme hirttä peräkkäin, ja jatkokset ovat limittäin. Päätyseinät ovat
  yhtä hirttä, ja niiden kerrokset ovat puoli kerrosta ylempänä kuin pitkien seinien.
- Nurkissa hirret lomittuvat lohenpyrstötapein. Tappien väliset tasot viettävät kahteen
  suuntaan ja ovat samat molemmille hirsille, joten tapit istuvat toisiinsa.
- Katon tyyppi määrää rungon muodon: pulpettikatossa päätyseinien ylimmät hirret leikataan
  kaltevuuteen, harjakatossa päädyt jatkuvat kolmioina harjalle.
- Pulpettikatolle runkoon tulee 129 hirttä, harjakatolle 124.

**Kevyt hirsi** (`src/mokki/mesh.js`, `src/mokki/wood.js`)

- Koko runko on yksi verkko (noin 29 000 kolmiota) ja yksi materiaali. Mallihirressä on
  yksinään 207 000 kolmiota.
- Hirsi on verkossa vain muutama taso. Piilutuksen aallot, vuosirenkaat ja oksat lasketaan
  varjostimessa pikseleittäin samalla periaatteella kuin mallihirressä: väri tulee pikselin
  paikasta rungon sisällä, ja piiluiskun kouru siirtää paikkaa pari milliä syvemmälle.
- Iskut ja oksat arvotaan varjostimessa hirren siemenestä, joten hirsikohtaisia tekstuureja
  ei tarvita. Kohina luetaan yhdestä pienestä 3D-tekstuurista.
- Jokaisella hirrellä on oma siemen ja koko: iskut, oksat, renkaiden leveydet, sydänpuun
  osuus ja sävy vaihtelevat hirrestä toiseen.
- Kaukaa katsottaessa hienoin rakenne (syyt, oksat) jätetään laskematta.

**Katto** (`src/mokki/roof.js`)

- Malli ja mitat ovat talo-projektista: tumma konesaumapelti, pystysaumat 0,5 m välein lappeen
  suuntaan, otsalaudat reunoissa. Pulpettikaton kaltevuus on 14 % ja harjakaton 1:2.
- Katon voi ottaa pois ja sen tyypin voi vaihtaa. Pulpettikatossa voi säätää ylitystä edessä
  (0–2,5 m) ja sivuilla (0–1,5 m); harjakatossa päätyräystään ylitystä.

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
- `src/env.js`: aurinko varjoineen, taivas ympäristökarttana, maa ja kaukainen metsänreuna.
  Ambient occlusion himmentää vain taivaan valoa.
- `?mittari` (tai `#mittari`): kohde pyörii itsestään ja otsikon alla näkyy ruutuaika liikkeessä,
  kuvataajuus ja käytössä oleva tarkkuus.
- Osoiteparametrit: `?view=…`, `?az=…&el=…` (aurinko), `?q=mobile|desktop`, `?pr=…`, `?ssaa=…`,
  `?noao`, `?nostill`, `?webgl`, `?webgpu`, `?cam=x,y,z,tx,ty,tz`. Mökissä lisäksi `?katto=0`,
  `?tyyppi=harja`, `?etu=…` ja `?sivu=…`.

## Referenssit

- [Hirsimies](http://www.hirsimies.fi/): käsin piilutettu seinä sivuvalossa ja lohenpyrstönurkka.
- [Hirsitaito: hirsirakennuksen veistäminen](https://hirsitaito.fi/hirsirakennuksen-veistaminen/):
  piilukirveen jälki läheltä.
- [Blocklayer: log dovetail](https://www.blocklayer.com/woodjoints/log-dovetail): täyden
  lohenpyrstön tasot viettävät kahteen suuntaan.

## Rajoitukset

- Testaus on tehty headless-Chromiumissa ohjelmallisella WebGPU-laitteella ja WebGL 2
  -varatilalla. Mallihirsi on ajettu iPhonella WebGPU:lla; mökkiä ei vielä.
- Mökki on pelkkä runko: ei lattiaa, aukkoja, väliseiniä eikä kattotuoleja. Pitkien seinien
  jatkokset ovat suoria puskuliitoksia.
- Mökin hirsissä kyljen aallot ovat varjostuksessa ja puun kuviossa, eivät ääriviivassa.
- Hirret ovat tuoreita: kuivumishalkeamia ja harmaantumista ei ole.
