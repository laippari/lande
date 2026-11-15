# lande

## Avaaminen

```sh
python3 -m http.server 8000      # → http://localhost:8000
```

## Julkaisu

Jokainen `main`-haaran push julkaisee sivun GitHub Pagesiin
(`.github/workflows/pages.yml`): https://laippari.github.io/lande/

Kertaluonteinen asetus: repon *Settings → Pages → Build and deployment → Source: GitHub Actions*.

Sivu on staattinen, joten käännösvaihetta ei ole; julkaisuun menevät `index.html` sekä
hakemistot `src/` ja `assets/`, jos ne ovat olemassa.
