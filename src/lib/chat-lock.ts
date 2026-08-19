/**
 * Why a thread has gone read-only, and what it says about it.
 *
 * On its own, with no import: `src/lib/chat.ts` reaches the database from its
 * first line, and this is the copy a student meets at the worst moment of their
 * year — it has to be readable, and testable, without one. (`node --test`
 * cannot load the lib modules either: they import each other without file
 * extensions, which Vite resolves and Node's ESM loader does not.)
 */

/**
 * Every way a pair can end up unable to write to each other.
 *
 * The composer used to close on one boolean, and the notice would have read
 * „nu mai există o coordonare activă” for all of them — which tells a student
 * whose thesis was defended in July the same thing as a student whose request
 * was refused. They are different facts and they have different next steps.
 */
export type LockReason =
  | 'request_rejected'
  | 'request_withdrawn'
  | 'request_expired'
  | 'invitation_declined'
  | 'invitation_expired'
  | 'defended'
  | 'peer_inactive'
  | 'never_linked'

interface LockAction {
  text: string
  href: string
}

export interface LockNotice {
  /** The uppercase marker of the record, as on every other event in the thread. */
  label: string
  body: string
  /** Only a refusal is drawn in the danger colour; an ending is not a failure. */
  tone: 'neutral' | 'bad'
  action?: LockAction
}

/**
 * What the closed thread says, and what it offers to do next.
 *
 * Kept apart from any query so it can be read — and tested — without a
 * database: this is the copy a student meets at the worst moment of their year,
 * and „conversația este închisă” was all of it.
 *
 * Nothing here names anybody's gender: the reader is addressed directly, and
 * the other person is named.
 */
export function lockNotice(
  reason: LockReason | null,
  peer: { name: string; forStudent: boolean },
): LockNotice | null {
  if (!reason) return null

  const name = peer.name
  const readable = 'Conversația rămâne de citit.'
  /* The way out is „choose somebody else”, and only a student has it: a
     coordinator whose student left does not go looking for another student. */
  const findAnother: LockAction | undefined = peer.forStudent
    ? { text: 'Caută alt coordonator', href: '/coordonatori' }
    : undefined

  switch (reason) {
    case 'request_rejected':
      return {
        label: 'Cerere respinsă',
        tone: 'bad',
        action: findAnother,
        body: peer.forStudent
          ? `Cererea către ${name} a fost respinsă, așa că nu îi mai poți scrie. ${readable}`
          : `Ai respins cererea trimisă de ${name}, așa că nu îi mai poți scrie. ${readable}`,
      }

    case 'request_withdrawn':
      return {
        label: 'Cerere retrasă',
        tone: 'neutral',
        action: findAnother,
        body: peer.forStudent
          ? `Ți-ai retras cererea către ${name}, așa că legătura dintre voi s-a închis. ${readable}`
          : `${name} a retras cererea de coordonare, așa că legătura dintre voi s-a închis. ${readable}`,
      }

    case 'request_expired':
      return {
        label: 'Cerere expirată',
        tone: 'neutral',
        action: findAnother,
        body: peer.forStudent
          ? `Cererea către ${name} a expirat fără răspuns, iar legătura s-a închis. ${readable}`
          : `Cererea trimisă de ${name} a expirat fără răspuns, iar legătura s-a închis. ${readable}`,
      }

    case 'invitation_declined':
      return {
        label: 'Propunere refuzată',
        tone: 'bad',
        action: findAnother,
        body: peer.forStudent
          ? `Ai refuzat propunerea de coordonare a ${name}. Nu mai există o legătură între voi, dar ${readable.toLowerCase()}`
          : `${name} a refuzat propunerea ta de coordonare. Nu mai există o legătură între voi, dar ${readable.toLowerCase()}`,
      }

    case 'invitation_expired':
      return {
        label: 'Propunere expirată',
        tone: 'neutral',
        action: findAnother,
        body: peer.forStudent
          ? `Propunerea de coordonare a ${name} a expirat fără răspuns. ${readable}`
          : `Propunerea ta de coordonare către ${name} a expirat fără răspuns. ${readable}`,
      }

    case 'defended':
      /* The normal, successful end of a supervision. It used to close the
         thread with exactly the same red notice as a refusal. */
      return {
        label: 'Coordonare încheiată',
        tone: 'neutral',
        body: `Lucrarea a fost susținută, iar coordonarea s-a încheiat. Conversația și fișierele rămân disponibile.`,
      }

    case 'peer_inactive':
      return {
        label: 'Cont închis',
        tone: 'neutral',
        body: `${name} nu mai are acces în portal, așa că nu îi poți trimite mesaje. ${readable}`,
      }

    case 'never_linked':
      return {
        label: 'Fără coordonare',
        tone: 'neutral',
        action: findAnother,
        body: `Nu există o coordonare între tine și ${name}. Poți citi conversația, dar nu poți scrie în ea.`,
      }
  }
}

