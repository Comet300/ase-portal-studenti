# Portal Studenți — Sesiunea de Finalizare a Studiilor

## Register

product

Authenticated workflow surface: dashboards, data tables, request queues, chat,
scheduling. Design serves the task. The public pages (acasă, coordonatori, ghid)
are informational but live inside the same shell and use the same vocabulary —
they are not a marketing site and should not be designed like one.

## Platform

web

## Users & Purpose

**Primary — student (licență / master), Facultatea de Marketing, ASE București.**
Finishing their degree. Their context is anxious and deadline-driven: they need
to know which coordinator will take them, whether their request was accepted,
what they still owe, and by when. They open the portal a few times a week, often
on a phone, usually to check one thing.

**Primary — cadru didactic (professor / coordinator).** Handling a queue of
requests from students they mostly don't know yet, against a fixed capacity and
a fixed calendar. Their job on any given screen: triage requests, keep track of
where each coordinated student stands, answer questions, schedule consultations.
Desktop, in longer sessions, often between classes.

**Secondary — director de departament.** Not doing per-student work; watching the
session as a whole. Needs coverage and bottleneck answers: who is unassigned, who
is over capacity, which topics have no takers, export the lot. Also the only role
with authority over the shape of the session: how many students each coordinator
may take, which programmes exist, and when a new academic year opens.

Success: a student never has to email someone to find out where they stand, and a
professor never loses a request in an inbox.

## Positioning

The single place where a graduation session actually happens — request, approval,
coordination, consultation, submission — instead of being reconstructed from
scattered email threads, spreadsheets and corridor conversations.

## Design principles

1. **The calendar is the spine.** Every screen answers "where are we in the
   session" before it answers anything else. Etape (alegere coordonator →
   înscriere → antiplagiat → susținere) are the shared reference both roles
   navigate by. The session belongs to an academic year, and the year is named
   from the database on every screen — never written into the chrome.
2. **Status is never ambiguous.** A request is `în așteptare`, `aprobată` or
   `respinsă`, shown identically to both sides, with the same words and the same
   colour everywhere it appears.
3. **Parity between roles.** If a professor can chat, schedule, or upload, the
   student's side of that same interaction exists and looks like a sibling, not
   an afterthought.
4. **Institutional, not corporate.** ASE red is the seal, not the theme. It marks
   the primary action and the live state; it does not tint the furniture.
5. **Density where the work is.** Professor tables carry many rows and stay
   scannable. Student screens are calmer and carry fewer decisions per page.
6. **Scarcity is stated, not hidden.** A coordinator with no seats left stays in
   the catalogue, greyed, with the students they already supervise. Removing them
   would answer "where is my professor" with silence.
7. **The portal's own actions are not messages.** A decision, an invitation, a
   scheduled consultation all appear in the pair's thread — as records, full
   width and marked, never styled as somebody typing.

## Brand personality

Formal, precise, quietly modern. The register of a well-run registrar's office:
serious, unfussy, never playful. Romanian throughout, using the vocabulary the
faculty actually uses (cerere, coordonator, temă, consultație, susținere).

## Anti-references

- **SaaS dashboard.** Gradient hero metrics, "Welcome back 👋", cards with big
  numbers and percentage deltas as decoration.
- **University brochure.** Stock photography of smiling students, marketing copy,
  hero imagery on authenticated screens.
- **Government portal.** Dense grey forms, unstyled tables, dead ends without
  explanation.
- Anything that requires the reader to guess whether a thing was submitted.

## Accessibility

Romanian diacritics correct everywhere (ă â î ș ț), body text ≥4.5:1, full
keyboard paths through request triage and chat, respects `prefers-reduced-motion`.
Phone layout is a first-class target for students, not a fallback.
