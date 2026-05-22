# `frontend/src/`

Cartella riservata ai **sorgenti pre-build** del frontend.

## Stato attuale

Vuota di proposito. Il prompt iniziale prevedeva qui `css/` e `js/`, ma con il
nostro setup **vanilla senza build step** e con deploy Netlify via drag&drop,
`/public/` deve essere autoconsistente. Per questo i sorgenti CSS/JS vivono
direttamente in `frontend/public/{css,js}/`.

## Quando popoleremo `/src`

Appena introdurremo un build step (Vite, esbuild, …):
- i sorgenti CSS/JS si sposteranno qui;
- `frontend/public/` diventerà l'output di build (generato, non versionato);
- il drag&drop su Netlify verrà sostituito da un build su Git.

Fino ad allora, modificare solo i file in `frontend/public/`.
