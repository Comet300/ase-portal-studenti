# Portal Studenți — Sesiunea de Finalizare a Studiilor 2026

Facultatea de Marketing, Academia de Studii Economice din București.

Frontend static (doar HTML), fără backend. CSS și JavaScript sunt incluse în
fiecare fișier — fără dependențe externe, fără build. Fonturi via Google Fonts,
icoane SVG inline. Imaginile sunt găzduite (preluate din designul original).

## Pagini

| Fișier | Pagină |
|---|---|
| `acasa.html` | Acasă — hero, calendarul etapelor (tabel) și resurse academice |
| `coordonatori.html` | Coordonatori & Teme — catalog cadre didactice + teme propuse, cu filtrare |
| `cereri.html` | Cererile Mele — tabel cereri + popup „Depune Cerere Nouă" (Pasul 1 + Pasul 2) |
| `ghid.html` | Ghid & Regulament — 4 file: Redactare · Regulament AI · Antiplagiat · Download Hub |
| `autentificare.html` | Autentificare — ecran de login (cont instituțional) |

## Interacțiuni (front-end, fără backend)

- **Meniu mobil** — buton hamburger, meniu comun pe toate paginile.
- **Filtrare coordonatori** — căutare live + selecție departament (`filterCoord`).
- **Popup cerere nouă** — fereastră modală peste `cereri.html`, cu 2 pași:
  Pasul 1 = date lucrare (scopul și obiectivele unite într-un singur câmp),
  Pasul 2 = previzualizarea cererii oficiale. Toast „salvat automat" + închidere cu Esc.
- **File (taburi)** pe `ghid.html` — toate cele 4 file sunt desenate (`switchTab`).
- Animații mici: intrare eșalonată carduri, hover, tranziții modal/toast, puls stare.
  Respectă `prefers-reduced-motion`.

## Note de design

- Design nivelat la o singură identitate: aceeași bară de navigație, același footer,
  aceleași componente pe toate paginile (roșu ASE `#990000`, Source Serif 4 + Inter).
- **Fără locuri disponibile / capacitate** listate pentru profesori (cerință explicită).
- Layout verificat desktop + mobil (390px): zero scroll orizontal pe toate paginile.

## Rulare

Orice server static, ex:

```bash
python3 -m http.server 8000
# apoi deschide http://localhost:8000/acasa.html
```

## Wiring backend

Fiecare buton/link apelează o funcție placeholder (ex. `submitRequest()`,
`chooseCoord()`, `googleLogin()`, `downloadFile()`) marcată cu `[TODO backend]`,
pregătită pentru conectarea logicii reale.
