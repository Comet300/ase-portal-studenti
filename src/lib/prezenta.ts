/**
 * Prezența, scrisă gros.
 *
 * Nu „acum 3 minute”: minutajul exact al altcuiva este supraveghere, nu ajutor.
 * Trei trepte, cât să răspundă la singura întrebare care contează — „are rost să
 * aștept răspuns acum?”. Peste o jumătate de zi nu se mai spune nimic, pentru că
 * nu mai înseamnă nimic.
 *
 * Stă în propriul fișier, fără nicio dependență: îl folosesc și pagina, pe
 * server, și firul de discuție, în browser. Din `repo.ts` nu se poate importa în
 * client — ar trage cu el conexiunea la bază și modulele de fișiere ale lui Node.
 */
export function prezenta(iso: string | null): string | null {
  if (!iso) return null
  const minute = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minute < 0) return null
  if (minute < 3) return 'în portal acum'
  if (minute < 60) return 'a fost în portal acum câteva minute'
  if (minute < 60 * 12) return 'a fost în portal astăzi'
  return null
}
