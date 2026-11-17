import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { AutopiloteEtat, AutopiloteLigne, AutopiloteProjet, AutopiloteUsage } from '../types'

// Autopilote : mode autonome pour n'importe quel projet. L'utilisateur donne un objectif ;
// un fichier de suivi (AUTOPILOTE.md par défaut) tient l'objectif, les tâches et le journal.
// À chaque relance, Claude fait la première tâche non cochée, en ajoute quand la liste est
// vide, et écrit « Statut : terminé » une fois l'objectif atteint.
// Le forfait est lu sur api.anthropic.com avec la connexion de la session : le jeton reste
// chez Claude Code (poignée opaque de $.session.authorize), le plugin ne le voit jamais.

const PANNEAU = 'autopilote'
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const HEURE = 3_600_000
const SEMAINE = 7 * 24 * HEURE

const VIDE: AutopiloteEtat = {
  actif: false, prochaine: 0, occupe: false, enAttente: false, usage: null, prevu: null,
  avance: null, projet: null, saisieObjectif: false, journal: [], relances: 0,
}
const etat = atom({ plugin: 'autopilote', key: 'etat' } as const, VIDE, { shape: 'etat-2' })

type Reglages = {
  intervalle: number
  fichier: string
  extra: string
  rythme: 'semaine' | '5h' | 'aucun'
  cible: number
  plafond: number
  avanceMax: number
  demarrerSeul: boolean
  source: 'anthropic' | 'adresse' | 'aucune'
  adresse: string
}

function lireReglages(o: PluginOptions): Reglages {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const r = String(o.rythme ?? 'semaine')
  return {
    intervalle: Math.max(1, n(o.intervalle_minutes, 15)),
    fichier: String(o.fichier ?? '').trim() || 'AUTOPILOTE.md',
    extra: String(o.consigne_extra ?? '').trim(),
    rythme: r === '5h' || r === 'aucun' ? r : 'semaine',
    cible: Math.min(100, Math.max(1, n(o.cible_semaine, 90))),
    plafond: Math.min(100, Math.max(1, n(o.plafond_5h, 95))),
    avanceMax: Math.max(0, n(o.avance_max, 3)),
    demarrerSeul: o.demarrer_seul === true,
    source: o.source_forfait === 'adresse' || o.source_forfait === 'aucune' ? o.source_forfait : 'anthropic',
    adresse: String(o.adresse_forfait ?? '').trim(),
  }
}

const deux = (x: number) => String(x).padStart(2, '0')
const heure = (ms: number) => `${deux(new Date(ms).getHours())} h ${deux(new Date(ms).getMinutes())}`
const jourHeure = (ms: number) => `${['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][new Date(ms).getDay()]} ${heure(ms)}`
const date = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())} ${deux(d.getHours())}:${deux(d.getMinutes())}`
}
const pts = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1).replace('.', ',')}`

/** Lit le fichier de suivi : objectif, statut, tâches cochées ou non. */
function analyser(texte: string): AutopiloteProjet {
  const ligne = (nom: string) => (texte.match(new RegExp(`^\\s*\\**${nom}\\**\\s*:\\s*(.+)$`, 'im'))?.[1] ?? '').trim()
  let faites = 0
  let total = 0
  let prochaine = ''
  for (const l of texte.split('\n')) {
    const m = l.match(/^\s*(?:[-*]|\d+\.)\s*\[([ xX~-])\]\s*(.*)$/)
    if (!m) continue
    total++
    if (m[1] === 'x' || m[1] === 'X') faites++
    else if (prochaine === '' && m[1] === ' ') prochaine = (m[2] ?? '').replace(/\*\*/g, '').trim()
  }
  return { existe: true, objectif: ligne('Objectif'), statut: ligne('Statut').toLowerCase(), faites, total, prochaine }
}

function modele(objectif: string, quand: number): string {
  return `# Autopilote

Statut : en cours
Objectif : ${objectif}

Ce fichier est tenu par Claude en mode autonome (plugin Autopilote). Tu peux le modifier à la main à tout moment : changer l'objectif, ajouter, retirer ou réordonner des tâches.

## Règles
- Une tâche à la fois, la première non cochée ; la vérifier avant de la cocher.
- Quand il n'en reste plus et que l'objectif n'est pas atteint, ajouter les suivantes.
- Aucune donnée personnelle (noms, adresses, e-mails, mots de passe, clés) dans ce fichier ni dans les commits.
- Rien n'est envoyé, publié ou poussé hors de l'ordinateur sans que l'utilisateur l'ait demandé.

## Tâches
- [ ] Découper l'objectif en 3 à 8 tâches concrètes et les écrire ici.

## À valider par l'utilisateur

## Journal
- ${date(quand)} — Objectif donné.
`
}

function consigne(r: Reglages, usage: string): string {
  const f = r.fichier
  return `[Autopilote] Travail autonome sur ce projet. Fichier de suivi : ${f}.
1. Lis ${f}.
2. Prends la première tâche non cochée de la liste des tâches. Fais-la entièrement, vérifie-la (les tests du projet qui la concernent, s'il y en a), coche-la et ajoute une ligne datée au journal.
3. S'il ne reste aucune tâche et que l'objectif n'est pas atteint, découpe la suite en 3 à 8 nouvelles tâches concrètes et ajoute-les.
4. Si l'objectif est atteint, écris « Statut : terminé ». Si une décision que seul l'utilisateur peut prendre te bloque, note-la sous « À valider par l'utilisateur », passe à une autre tâche ; s'il n'y en a aucune, écris « Statut : bloqué ».
Règles : ne pose pas de question (personne ne répondra), tranche et note ce qui est à valider. N'écris aucune donnée personnelle (noms, adresses, e-mails, mots de passe, clés) dans les fichiers ni les commits. N'envoie rien à un service extérieur, ne publie rien et ne pousse rien sans que l'utilisateur l'ait demandé. Si le projet est un dépôt git, fais un commit local par tâche. Reste dans le dossier du projet. Termine par un message très court : ce qui a été fait, ce qui vient ensuite.${r.extra ? `\nConsignes de l'utilisateur : ${r.extra}` : ''}${usage}`
}

let reglages: Reglages = lireReglages({})
let minuterie: Timer | null = null

async function noter($: EngineInterface, action: AutopiloteLigne['action'], texte: string) {
  const quand = await $.clock.now()
  await update($, etat, e => ({ ...e, journal: [...e.journal, { quand, action, texte }].slice(-30) }))
}

async function afficherStatut($: EngineInterface) {
  const e = await read($, etat)
  if (!e.actif) {
    $.ui.status(undefined)
    return
  }
  const p = e.projet && e.projet.total > 0 ? ` · ${e.projet.faites}/${e.projet.total}` : ''
  const av = e.avance === null ? '' : ` · ${pts(e.avance)} pts`
  $.ui.status(`Autopilote actif${p}${av} · prochain ${heure(e.prochaine)}`)
}

async function lireProjet($: EngineInterface): Promise<AutopiloteProjet> {
  let projet: AutopiloteProjet = { existe: false, objectif: '', statut: '', faites: 0, total: 0, prochaine: '' }
  try {
    if (await $.fs.exists(reglages.fichier)) projet = analyser(await $.fs.read(reglages.fichier))
  } catch {
    // illisible : traité comme absent
  }
  await update($, etat, x => ({ ...x, projet }))
  return projet
}

async function fixerObjectif($: EngineInterface, objectif: string): Promise<string> {
  const texte = objectif.trim()
  if (texte === '') return 'Donne un objectif : /autopilote objectif <ce que tu veux obtenir>'
  const quand = await $.clock.now()
  if (await $.fs.exists(reglages.fichier)) {
    let ancien = await $.fs.read(reglages.fichier)
    ancien = /^\s*\**Objectif\**\s*:.*$/im.test(ancien)
      ? ancien.replace(/^(\s*\**Objectif\**\s*:).*$/im, `$1 ${texte}`)
      : `Objectif : ${texte}\n\n${ancien}`
    ancien = /^\s*\**Statut\**\s*:.*$/im.test(ancien) ? ancien.replace(/^(\s*\**Statut\**\s*:).*$/im, '$1 en cours') : ancien
    await $.fs.write(reglages.fichier, ancien)
  } else {
    await $.fs.write(reglages.fichier, modele(texte, quand))
  }
  await update($, etat, x => ({ ...x, saisieObjectif: false }))
  await lireProjet($)
  await noter($, 'info', `Objectif : ${texte}`)
  return `Objectif enregistré dans ${reglages.fichier}. Lance avec /autopilote on.`
}

async function lireForfait($: EngineInterface): Promise<AutopiloteUsage | null> {
  if (reglages.source === 'aucune') return null
  let rep
  if (reglages.source === 'adresse') {
    // Adresse de l'utilisateur : jamais de connexion envoyée, https seulement.
    if (!/^https:\/\//i.test(reglages.adresse)) return null
    rep = await $.http.fetch(reglages.adresse)
  } else {
    const auth = await $.session.authorize()
    if (auth === null || auth.kind !== 'bearer') return null
    rep = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
  }
  if (!rep.ok) return null
  const d = JSON.parse(rep.text) as Record<string, { utilization?: number; resets_at?: string } | null>
  const cinq = d.five_hour
  const sem = d.seven_day
  if (!cinq || !sem || typeof cinq.utilization !== 'number' || typeof sem.utilization !== 'number') return null
  return {
    cinq: cinq.utilization,
    semaine: sem.utilization,
    resetCinq: Date.parse(String(cinq.resets_at)),
    resetSemaine: Date.parse(String(sem.resets_at)),
    lu: await $.clock.now(),
  }
}

/** Où on devrait en être, en %, selon le rythme choisi. */
function prevu(u: AutopiloteUsage, maintenant: number): number | null {
  if (reglages.rythme === 'semaine' && Number.isFinite(u.resetSemaine)) {
    return reglages.cible * Math.min(1, Math.max(0, 1 - (u.resetSemaine - maintenant) / SEMAINE))
  }
  if (reglages.rythme === '5h' && Number.isFinite(u.resetCinq)) {
    return reglages.plafond * Math.min(1, Math.max(0, 1 - (u.resetCinq - maintenant) / (5 * HEURE)))
  }
  return null
}

async function rafraichirForfait($: EngineInterface): Promise<AutopiloteUsage | null> {
  let u: AutopiloteUsage | null = null
  try {
    u = await lireForfait($)
  } catch {
    u = null
  }
  const maintenant = await $.clock.now()
  const p = u ? prevu(u, maintenant) : null
  const avance = u && p !== null ? (reglages.rythme === 'semaine' ? u.semaine : u.cinq) - p : null
  await update($, etat, x => ({ ...x, usage: u ?? x.usage, prevu: p, avance }))
  return u
}

async function arreter($: EngineInterface, raison = 'Mis en pause.') {
  minuterie?.cancel()
  minuterie = null
  await update($, etat, x => ({ ...x, actif: false, prochaine: 0 }))
  await $.store.set('actif', false)
  await noter($, raison === 'Mis en pause.' ? 'info' : 'arret', raison)
  await afficherStatut($)
}

/** Une vérification : relancer Claude, attendre, ou s'arrêter. */
async function verifier($: EngineInterface, forcer = false) {
  const e = await read($, etat)
  const maintenant = await $.clock.now()
  if (!e.actif && !forcer) return
  await update($, etat, x => ({ ...x, prochaine: x.actif ? maintenant + reglages.intervalle * 60_000 : 0 }))
  if (e.occupe || e.enAttente) {
    await noter($, 'attente', 'Claude travaille déjà : rien à faire.')
    return afficherStatut($)
  }
  const projet = await lireProjet($)
  if (!projet.existe) {
    await noter($, 'attente', `Pas de fichier ${reglages.fichier} : donne un objectif (/autopilote objectif …).`)
    return afficherStatut($)
  }
  if (projet.statut.startsWith('termin')) {
    await arreter($, 'Objectif atteint : arrêt.')
    $.ui.toast('Autopilote : objectif atteint, arrêt.')
    return
  }
  if (projet.statut.startsWith('bloqu')) {
    await arreter($, `Claude est bloqué : voir « À valider » dans ${reglages.fichier}.`)
    $.ui.toast('Autopilote : Claude a besoin de toi (voir le fichier de suivi).')
    return
  }
  const u = await rafraichirForfait($)
  const x = await read($, etat)
  if (!forcer && u) {
    if (reglages.rythme !== 'aucun' && u.semaine >= reglages.cible) {
      await arreter($, `Objectif de la semaine atteint (${Math.round(u.semaine)} %) : arrêt.`)
      $.ui.toast('Autopilote : objectif de la semaine atteint, arrêt.')
      return
    }
    if (u.cinq >= reglages.plafond) {
      await noter($, 'attente', `Fenêtre de 5 h à ${Math.round(u.cinq)} % : attente de la remise à zéro (${heure(u.resetCinq)}).`)
      return afficherStatut($)
    }
    if (x.avance !== null && x.avance > reglages.avanceMax) {
      await noter($, 'attente', `En avance de ${pts(x.avance)} points sur le rythme : pause.`)
      return afficherStatut($)
    }
  }
  const resume = u
    ? `\n(Forfait : 5 h ${Math.round(u.cinq)} %, semaine ${Math.round(u.semaine)} %${x.prevu !== null ? `, prévu ${Math.round(x.prevu)} %` : ''}.)`
    : ''
  await update($, etat, y => ({ ...y, enAttente: true, relances: y.relances + 1 }))
  await noter($, 'relance', `Relance${x.avance !== null ? ` (${pts(x.avance)} pts)` : ''}${projet.prochaine ? ` : ${projet.prochaine.slice(0, 60)}` : ''}.`)
  void $.prompt.submit({ text: consigne(reglages, resume) })
  return afficherStatut($)
}

/** Vérifier juste après : une commande ou un bouton ne peut pas relancer Claude pendant qu'il tient le tour. */
function bientot($: EngineInterface, forcer = false) {
  $.clock.after(1_000, () => void verifier($, forcer))
}

async function demarrer($: EngineInterface, differer = false): Promise<string> {
  const projet = await lireProjet($)
  if (!projet.existe) {
    await update($, etat, x => ({ ...x, saisieObjectif: true }))
    return `Pas encore de fichier ${reglages.fichier} dans ce projet. Donne d'abord un objectif : /autopilote objectif <ce que tu veux obtenir> (ou dans le panneau).`
  }
  minuterie?.cancel()
  await update($, etat, x => ({ ...x, actif: true }))
  minuterie = $.clock.every(reglages.intervalle * 60_000, () => void verifier($))
  await $.store.set('actif', true)
  await noter($, 'info', `Démarré : toutes les ${reglages.intervalle} min, rythme « ${reglages.rythme} ».`)
  if (differer) bientot($)
  else await verifier($)
  return `Autopilote démarré : toutes les ${reglages.intervalle} min, rythme « ${reglages.rythme} », fichier ${reglages.fichier}.`
}

export const register: Register = (on, options) => {
  reglages = lireReglages(options)
  minuterie = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'autopilote',
      description: 'Mode autonome : objectif <texte> | on | off | maintenant | etat (sans rien : le panneau)',
      argumentHint: '[objectif <texte>|on|off|maintenant|etat]',
    })
    await lireProjet($)
    // Après un rechargement du plugin, la minuterie est perdue : la reprendre.
    const avant = await read($, etat)
    if (avant.actif || reglages.demarrerSeul) await demarrer($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, etat, x => ({ ...x, occupe: true, enAttente: false }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, etat, x => ({ ...x, occupe: false }))
      await lireProjet($)
      await afficherStatut($)
    }
    return next(e)
  })

  on('command.run', { command: 'autopilote' }, async ($, e) => {
    const brut = String(e.args ?? '').trim()
    const [mot = '', ...reste] = brut.split(/\s+/)
    const arg = mot.toLowerCase()
    if (arg === 'objectif' || arg === 'goal') return { text: await fixerObjectif($, reste.join(' ')) }
    if (arg === 'on' || arg === 'start' || arg === 'marche') return { text: await demarrer($, true) }
    if (arg === 'off' || arg === 'stop' || arg === 'pause') {
      await arreter($)
      return { text: 'Autopilote en pause.' }
    }
    if (arg === 'maintenant' || arg === 'now') {
      bientot($, true)
      return { text: 'Relance dans un instant.' }
    }
    if (arg === 'etat' || arg === 'état' || arg === 'status') {
      const x = await read($, etat)
      const p = await lireProjet($)
      const u = x.usage
      const f = u ? `5 h ${Math.round(u.cinq)} %, semaine ${Math.round(u.semaine)} %` : 'forfait pas encore lu'
      const t = p.existe ? `${p.faites}/${p.total} tâches` : `pas de ${reglages.fichier}`
      return { text: `Autopilote ${x.actif ? 'actif' : 'en pause'} · ${t} · ${f}${x.avance !== null ? ` · ${pts(x.avance)} pts` : ''} · ${x.relances} relance(s).` }
    }
    await lireProjet($)
    await $.ui.open({ id: PANNEAU, title: 'Autopilote' })
    return { text: 'Panneau de l’autopilote ouvert.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => {
    const { Box, Text, Button, Progress, Select, Input } = $.ui.resolve(e)
    const x = await read($, etat)
    const u = x.usage
    const p = x.projet
    const etroit = (e.props.bodyColumns ?? 60) < 44
    const changer = (cle: string, valeur: string | number | boolean) =>
      void $.config.set({ key: `autopilote.${cle}`, value: valeur }).then(r => {
        if ('deny' in r && r.deny) $.ui.toast(`Réglage refusé : ${r.deny}`)
      })
    const pas = (cle: string, valeur: number, delta: number, min: number, max: number) =>
      changer(cle, Math.min(max, Math.max(min, valeur + delta)))
    const saisir = !p?.existe || x.saisieObjectif

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection={etroit ? 'column' : 'row'} gap={1}>
          <Text bold color={x.actif ? 'success' : 'warning'}>{x.actif ? '● Actif' : '❚❚ En pause'}</Text>
          {x.actif && <Text dimColor>prochaine vérification {heure(x.prochaine)}</Text>}
          {x.occupe && <Text dimColor>· Claude travaille</Text>}
        </Box>

        <Box flexDirection="row" gap={1}>
          {x.actif
            ? <Button key="pause" hotkey="p" onPress={() => void arreter($)}>Pause</Button>
            : <Button key="demarrer" hotkey="d" variant="primary" onPress={() => void demarrer($, true).then(t => $.ui.toast(t))}>Démarrer</Button>}
          <Button key="maintenant" hotkey="r" onPress={() => bientot($, true)}>Relancer maintenant</Button>
          <Button key="lire" hotkey="v" onPress={() => void rafraichirForfait($).then(() => lireProjet($))}>Actualiser</Button>
        </Box>

        <Box flexDirection="column">
          <Text bold>Projet</Text>
          {p?.existe && (
            <Box flexDirection="column">
              <Text>Objectif : {p.objectif || '(pas de ligne « Objectif : » dans le fichier)'}</Text>
              {p.total > 0 && <Progress label="Tâches" value={p.faites} max={p.total} valueText={`${p.faites} sur ${p.total}`} />}
              {p.prochaine !== '' && <Text dimColor>Prochaine : {p.prochaine}</Text>}
              {p.statut.startsWith('termin') && <Text color="success">Objectif atteint.</Text>}
              {p.statut.startsWith('bloqu') && <Text color="warning">Claude attend une décision de ta part (voir le fichier).</Text>}
              <Text dimColor>Fichier : {reglages.fichier}</Text>
            </Box>
          )}
          {!p?.existe && <Text dimColor>Pas encore de fichier {reglages.fichier} ici. Écris ton objectif : Claude le découpera en tâches.</Text>}
          {saisir
            ? <Input key="objectif" label="Objectif " placeholder="ce que tu veux obtenir, en une phrase" value={p?.objectif ?? ''}
                submitLabel="enregistrer" onSubmit={v => void fixerObjectif($, v).then(t => $.ui.toast(t))} />
            : <Button key="changer-objectif" onPress={() => void update($, etat, y => ({ ...y, saisieObjectif: true }))}>Changer l'objectif</Button>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Forfait</Text>
          {u === null
            ? <Text dimColor>{reglages.source === 'aucune'
                ? 'Lecture du forfait désactivée : relance à chaque intervalle.'
                : reglages.source === 'adresse'
                  ? 'Pas encore lu à ton adresse (https, format JSON : voir le README).'
                  : "Pas encore lu. (Il faut être connecté avec un abonnement Claude ; avec une clé d'API, l'autopilote relance sans regarder le forfait.)"}</Text>
            : <Box flexDirection="column">
                <Progress label="Fenêtre de 5 h" value={u.cinq} max={100} valueText={`${Math.round(u.cinq)} % · remise à zéro ${heure(u.resetCinq)}`} color={u.cinq >= reglages.plafond ? 'error' : undefined} />
                <Progress label="Semaine" value={u.semaine} max={100} valueText={`${Math.round(u.semaine)} % · remise à zéro ${jourHeure(u.resetSemaine)}`} />
                {x.prevu !== null && x.avance !== null && (
                  <Text color={x.avance > reglages.avanceMax ? 'warning' : 'success'}>
                    Prévu à cette heure : {Math.round(x.prevu)} % · {x.avance > 0 ? 'en avance' : 'en retard'} de {Math.abs(x.avance).toFixed(1).replace('.', ',')} points
                  </Text>
                )}
                <Text dimColor>Lu à {heure(u.lu)}</Text>
              </Box>}
        </Box>

        <Box flexDirection="column">
          <Text bold>Réglages</Text>
          <Select key="rythme" label="Rythme " value={reglages.rythme}
            options={[
              { value: 'semaine', label: 'Étaler sur la semaine' },
              { value: '5h', label: 'Étaler sur chaque fenêtre de 5 h' },
              { value: 'aucun', label: 'Relancer à chaque fois' },
            ]}
            onSelect={v => changer('rythme', v)} />
          <Select key="source" label="Forfait lu " value={reglages.source}
            options={[
              { value: 'anthropic', label: 'Sur mon abonnement Claude' },
              { value: 'adresse', label: 'À mon adresse' },
              { value: 'aucune', label: 'Jamais (pas de rythme)' },
            ]}
            onSelect={v => changer('source_forfait', v)} />
          {reglages.source === 'adresse' && (
            <Input key="adresse" label="Adresse https " placeholder="https://…/forfait.json" value={reglages.adresse}
              submitLabel="enregistrer" onSubmit={v => changer('adresse_forfait', v.trim())} />
          )}
          <Box flexDirection="row" gap={1}>
            <Text>Toutes les {reglages.intervalle} min</Text>
            <Button key="int-moins" onPress={() => pas('intervalle_minutes', reglages.intervalle, -5, 1, 240)}>−5</Button>
            <Button key="int-plus" onPress={() => pas('intervalle_minutes', reglages.intervalle, 5, 1, 240)}>+5</Button>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text>Objectif semaine {reglages.cible} %</Text>
            <Button key="cible-moins" onPress={() => pas('cible_semaine', reglages.cible, -5, 5, 100)}>−5</Button>
            <Button key="cible-plus" onPress={() => pas('cible_semaine', reglages.cible, 5, 5, 100)}>+5</Button>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text>Plafond 5 h {reglages.plafond} %</Text>
            <Button key="plafond-moins" onPress={() => pas('plafond_5h', reglages.plafond, -5, 5, 100)}>−5</Button>
            <Button key="plafond-plus" onPress={() => pas('plafond_5h', reglages.plafond, 5, 5, 100)}>+5</Button>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Text>Avance tolérée {reglages.avanceMax} pts</Text>
            <Button key="avance-moins" onPress={() => pas('avance_max', reglages.avanceMax, -1, 0, 50)}>−1</Button>
            <Button key="avance-plus" onPress={() => pas('avance_max', reglages.avanceMax, 1, 0, 50)}>+1</Button>
          </Box>
          <Button key="seul" onPress={() => changer('demarrer_seul', !reglages.demarrerSeul)}>
            {reglages.demarrerSeul ? '☑' : '☐'} Démarrer à chaque session
          </Button>
          <Input key="extra" label="Consignes en plus " placeholder="ex. : fais un push après chaque tâche" value={reglages.extra}
            submitLabel="enregistrer" onSubmit={v => changer('consigne_extra', v.trim())} />
          <Input key="fichier" label="Fichier de suivi " value={reglages.fichier}
            submitLabel="enregistrer" onSubmit={v => { if (v.trim() !== '') changer('fichier', v.trim()) }} />
        </Box>

        <Box flexDirection="column">
          <Text bold>Journal ({x.relances} relance{x.relances > 1 ? 's' : ''})</Text>
          {x.journal.length === 0 && <Text dimColor>Rien encore.</Text>}
          {x.journal.slice(-8).reverse().map((l, i) => (
            <Text key={`j${i}`} dimColor={l.action === 'attente'} color={l.action === 'relance' ? 'success' : l.action === 'arret' ? 'warning' : undefined}>
              {heure(l.quand)} {l.texte}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
