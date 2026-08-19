# Sistemul de design

Descrie ce face codul, nu ce ne-am propus. Dacă o regulă de aici nu se
regăsește în `src/styles/app.css`, documentul este cel greșit.

Tot ce urmează are o singură sursă: `src/styles/app.css`, 1.662 de linii cu 73 de
variabile. Nu există un al doilea fișier de teme și nici stiluri globale scrise în
pagini — ce e specific unui ecran stă în blocul `<style>` al acelui ecran, scopat
de Astro.

---

## Ce hotărăște identitatea

**Roșul ASE este un sigiliu, nu o culoare de decor.** `--red: #990000` marchează
acțiunea principală și starea vie. Nu colorează mobilierul: fundaluri, borduri și
bare rămân neutre. Un ecran în care jumătate din elemente sunt roșii nu mai are o
acțiune principală.

**Registrul este instituțional.** Colțuri aproape drepte (`--r-sm: 2px`,
`--r-md: 4px`, `--r-lg: 8px`), nu carduri rotunjite. Titlurile de pagină sunt cu
serife (Source Serif 4); tot restul este Inter. Serifa apare **doar** la titlu de
pagină și la cifra unei metrici — dacă ajunge și în tabele, portalul începe să
arate a broșură.

---

## Culoare

| Rol | Variabile |
|---|---|
| Identitate | `--red`, `--red-hover`, `--red-tint`, `--navy` |
| Suprafețe | `--bg`, `--surface`, `--surface-sunken` |
| Borduri | `--border` (desparte), `--border-strong` (desenează un control) |
| Cerneală | `--ink`, `--ink-soft`, `--ink-muted` |
| Semantic | `--ok`, `--warn`, `--danger`, `--info`, plus `-tint` pentru fiecare |
| Strat închis | `--dark-surface`, `--dark-ink`, `--dark-ink-soft`, `--dark-ink-muted`, `--dark-line`, `--dark-accent` |

**Cele două borduri au meserii diferite.** `--border` desparte rânduri și
secțiuni și poate rămâne discretă. `--border-strong` desenează marginea unui
control — câmp, buton, casetă — și intră sub WCAG 1.4.11, care cere 3:1. A fost
`#d3d8de`, adică 1.43:1 pe alb: câmpurile nu aveau practic contur.

**Culoarea nu poartă singură nicio informație.** Fiecare stare are și un cuvânt:
insignele scriu „Aprobată", „În așteptare", nu doar verde și galben. Notificările
au un semn (`✓` sau `!`) pe lângă culoare.

**Contrastele sunt verificate, nu presupuse.** `--ink-muted: #5b6169` este exact
pragul de 6:1 pentru text secundar pe `--bg`; sub el nu se coboară.

---

## Tipografie

Scală fixă, raport 1.125. Interfața nu se scalează fluid.

```
--t-xs .75rem   --t-sm .875rem   --t-base 1rem   --t-md 1.0625rem
--t-lg 1.1875rem   --t-xl 1.375rem   --t-2xl 1.75rem   --t-3xl 2.125rem
```

**Podeaua este 16px pentru orice text care se citește.** Scala avea opt trepte și
se folosea de fapt din două: 207 din 237 de declarații explicite erau 12 sau 13px.
Obiectivele unei lucrări și regulamentul erau scrise cu corpul unei note de
subsol. `--t-body` spune explicit ce treaptă folosește un text real.

`--t-xs` este pentru etichete și metadate, niciodată pentru proză.

Cifrele care se aliniază în coloane primesc `font-variant-numeric: tabular-nums`
(clasa `.numeric`).

---

## Spațiere și formă

Scara `--s-1` … `--s-8` (0.25rem → 4rem). Nimic între trepte.

`.stack` așază pe verticală cu `gap`; `.stack--tight` și `.stack--loose` sunt
singurele variante. Secțiunile unei pagini folosesc `--loose`, altfel „între
secțiuni" și „între rânduri" arată la fel.

**Un rând de câmpuri se aliniază sus, nu la mijloc.** O singură regulă:

```css
.row:has(> .field) { align-items: flex-start; }
```

A înlocuit 33 de corecturi punctuale. Când un câmp are un mesaj de ajutor
dedesubt, alinierea la mijloc ridică vecinii lui cu jumătate din înălțimea acelui
mesaj.

---

## Mișcare

Regula, ca să nu se reinventeze la fiecare componentă:

| Ce se întâmplă | Durată | Curbă |
|---|---|---|
| Culoare (hover, focus) | `--fast` 140ms | `--ease` |
| Ceva apare | `--base` 220ms | `--ease` |
| Ceva pleacă | `--exit` 150ms | `--ease-in` |
| Ceva se mută pe ecran | `--base` | `--ease-inout` |
| O confirmare | `--base` | `--ease-spring` |

Înainte exista o singură curbă și nicio durată de ieșire, deci nimic nu pleca:
dialogurile și notificările dispăreau dintr-un cadru în altul.

**Mișcare redusă înseamnă fără deplasare, nu fără stare.** `prefers-reduced-motion`
oprește animațiile, dar rotița unui buton care încarcă rămâne, iar inelul care
marchează ținta unei legături devine un inel fix în loc să dispară — altfel cine a
cerut mișcare redusă ajunge într-o listă de douăzeci de rânduri fără să afle pe
care a fost trimis.

---

## Reguli care nu se negociază

**Ținta de atingere este 44px** (`--tap`). Niciun control nu cobora la ea înainte.

**Inelul de focus este unul singur** și culoarea lui se moștenește:

```css
:where(a, button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

`--focus` este roșul, dar bara laterală bleumarin îl schimbă pe alb: `#990000` pe
`#1a1e23` dă 1.88:1.

**Sublinierea marchează proza, nu interfața.** Aproape fiecare legătură din portal
este un control. Subliniate toate, ecranele devin un covor de linii. Rămân
subliniate `.prose a`, `.page-lede a`, `.empty__text a`, `.hint a` și `a.link`.

**Un tabel lat derulează în cutia lui, nu în pagină.** `.table-wrap` are
`overflow-x: auto` **și** `contain: paint` — fără al doilea, antetul lipicios
dinăuntru se raportează la pagină, iar documentul devine mai lat decât fereastra.

**Trei puncte de rupere, nu șase**: 640 telefon, 900 tabletă, 1200 lat. CSS nu
acceptă variabile în interogări media, deci este o convenție documentată, scrisă
în capul fișierului.

---

## Componente

Ce se repetă pe trei ecrane devine componentă. Nu mai devreme.

| Componentă | Ce rezolvă |
|---|---|
| `Metrica` | O cifră cu numele ei. Înlocuiește 25 de casete scrise de mână, în trei convenții de denumire și două mărimi. |
| `Avatar` | Inițiale sau poză, patru mărimi (`xs` 28 → `lg` 72). Nuanța de fundal se derivă din nume. |
| `Taburi` | Bara de secțiuni, cu contoare. |
| `Chat` | Firul, lista de conversații, sertarul de fișiere, contextul lucrării. |
| `Clopotel` | Notificările, cu destinația calculată din subiectul evenimentului și rolul cititorului. |
| `AlegeAn` | Selectorul de an universitar. |
| `AlegeData` | Un `<input type="date">` îmbrăcat: declanșator propriu, grilă de lună în românește, valoarea citită ca proză peste câmp. Cu `pereche`, capătul unui interval — `min` urmărește începutul și eticheta numără zilele. |
| `RandSlot` | Un interval de consultație, ca rând de tabel. |
| `Icon` | Pictogramele, dintr-un singur set. |

---

## Comportamente globale

Nouă scripturi, toate în `src/scripts/`, pornite din `BaseLayout`. Fiecare nu face
nimic pe paginile care nu îl privesc.

Al zecelea, `datepicker`, pornește din `AlegeData`, nu din `BaseLayout`: Astro îl
împachetează o singură dată per pagină care folosește componenta, deci ecranele
studenților — unde nu există niciun câmp de dată — nu îl descarcă deloc.

- `formulare` — o singură ascultare delegată pentru toate formularele: stare de
  încărcare pe butonul apăsat (`aria-disabled`, **niciodată** `disabled`, care ar
  arunca perechea nume/valoare de care depind formularele cu două verbe), gardă
  împotriva trimiterii duble, păstrarea valorilor în `sessionStorage` la eroare.
- `notificari` — două gazde de notificări: informațiile pleacă singure în 5,2s,
  erorile rămân până sunt închise și merg pe canalul asertiv. O notificare poate
  purta o acțiune „Anulează”.
- `validare` — mesaje de validare în românește, derivate din atributele câmpului.
- `dialoguri`, `meniu`, `retea`, `chat`, `poza`, `paleta`.

---

## Ce se scrie pe ecran

Textul este material de design, nu decor.

- Un buton spune exact ce se întâmplă: „Acceptă coordonarea", nu „Trimite".
- O eroare spune ce s-a întâmplat **și** ce se face: „Toate cele 12 locuri sunt
  ocupate. Cere locuri suplimentare directorului."
- O stare goală propune un pas următor, cu butonul lui. „Niciun rezultat" fără o
  cale înainte nu este o stare goală, este un capăt de drum.
- Nu se presupune genul nimănui. „Datele lui X au fost salvate", nu „a fost mutat".
- Numerele se acordă cu `numar()` din `lib/text.ts`: „19 ore", dar „20 de ore".

---

## Tipar

`@media print` scoate mobilierul și controalele și păstrează conținutul. Regulile
care contează, pentru că au fost greșite o dată:

- Nimic nu se trunchiază: pe hârtie nu există hover, deci un titlu tăiat cu „…"
  este informație pierdută.
- Câmpurile rămân și își tipăresc valoarea; doar butoanele pleacă. Ascunderea
  întregului `<form>` lua cu ea lista de teme și calendarul sesiunii, unde fiecare
  rând *este* un formular.
- Toate filele unui `[role=tabpanel]` se deschid: bara de file dispare, deci altfel
  s-ar tipări un sfert din ghid fără niciun semn că restul există.
- `.doar-tipar` arată pe hârtie ce se pierde odată cu un control ascuns.
