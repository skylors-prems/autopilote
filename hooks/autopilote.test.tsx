import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const JOUR = 24 * 3_600_000
const MAINTENANT = Date.UTC(2026, 10, 18, 12, 0)

const PANNEAU = {
  plugin: 'autopilote',
  component: 'Pane',
  requestId: 'autopilote',
  props: {
    title: 'Autopilote',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SUIVI = `# Autopilote

Statut : en cours
Objectif : un site de recettes

## Tâches
- [x] Créer la page d'accueil
- [ ] Ajouter la recherche
- [ ] Ajouter les favoris
`

/** Le monde sous le plugin : fichiers du projet, connexion, forfait (semaine à mi-parcours), relances reçues. */
function monde(on: On, semaine: number, cinq = 20, suivi: string | null = SUIVI) {
  const relances: string[] = []
  const fichiers = new Map<string, string>()
  if (suivi !== null) fichiers.set('AUTOPILOTE.md', suivi)
  const horloge = mock.clock(on, { now: MAINTENANT })
  mock.store(on)
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'autopilote' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const nom = (p: string) => p.split(/[\\/]/).pop() ?? p
  on('fs.exists', (_, e) => ({ value: fichiers.has(nom(e.path)) }))
  on('fs.read', (_, e) => ({ value: fichiers.get(nom(e.path)) ?? '' }))
  on('fs.write', (_, e) => {
    fichiers.set(nom(e.path), e.text)
    return { value: undefined }
  })
  on('session.authorize', () => ({ value: { handle: 'poignee', kind: 'bearer' } }))
  on('http.fetch', (_, e) => {
    expect(e.url).toBe('https://api.anthropic.com/api/oauth/usage')
    const corps = {
      five_hour: { utilization: cinq, resets_at: new Date(MAINTENANT + 2 * 3_600_000).toISOString() },
      seven_day: { utilization: semaine, resets_at: new Date(MAINTENANT + 3.5 * JOUR).toISOString() },
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(corps) } }
  })
  on('prompt.submit', (_, e) => {
    relances.push(e.text)
    return { text: e.text }
  })
  return { relances, fichiers, horloge }
}

const OPTIONS = { options: { demarrer_seul: true, cible_semaine: 90, avance_max: 3 } }
const cmd = (args: string) => ({
  command: 'autopilote', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 },
} as const)
const DEBUT = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('en retard sur le rythme de la semaine : il relance Claude sur le fichier de suivi', OPTIONS, async ($, on) => {
  const { relances } = monde(on, 40) // prévu 45 % à mi-semaine : 5 points de retard
  await $.session.start(DEBUT)
  expect(relances.length).toBe(1)
  expect(relances[0]).toContain('AUTOPILOTE.md')
  expect(relances[0]).toContain('semaine 40 %')
  expect(relances[0]).toContain('prévu 45 %')
  expect(relances[0]).toContain('donnée personnelle')
})

test('en avance de plus de 3 points : il attend', OPTIONS, async ($, on) => {
  const { relances } = monde(on, 50)
  await $.session.start(DEBUT)
  expect(relances.length).toBe(0)
})

test('fenêtre de 5 h pleine : il attend la remise à zéro', OPTIONS, async ($, on) => {
  const { relances } = monde(on, 40, 97)
  await $.session.start(DEBUT)
  expect(relances.length).toBe(0)
})

test('sans fichier de suivi : pas de relance ; l’objectif crée le fichier', OPTIONS, async ($, on) => {
  const { relances, fichiers, horloge } = monde(on, 40, 20, null)
  await $.session.start(DEBUT)
  expect(relances.length).toBe(0)
  await $.command.run(cmd('objectif une appli de notes'))
  const cree = fichiers.get('AUTOPILOTE.md') ?? ''
  expect(cree).toContain('Objectif : une appli de notes')
  expect(cree).toContain('Statut : en cours')
  expect(cree).toContain('- [ ] ')
  await $.command.run(cmd('on'))
  expect(relances.length).toBe(0)
  await horloge.advance(2_000)
  expect(relances.length).toBe(1)
})

test('statut terminé : il s’arrête sans relancer', OPTIONS, async ($, on) => {
  const { relances } = monde(on, 40, 20, SUIVI.replace('en cours', 'terminé'))
  await $.session.start(DEBUT)
  expect(relances.length).toBe(0)
  const { text } = await $.command.run(cmd('etat'))
  expect(text).toContain('en pause')
})

test('le panneau se dessine partout', OPTIONS, async ($, on) => {
  monde(on, 40)
  await $.session.start(DEBUT)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANNEAU, surface })
    expect((await ui.find({ type: 'Text', text: /Actif/ }))?.text).toContain('Actif')
    expect(await ui.find({ type: 'Text', text: /un site de recettes/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Prévu à cette heure/ })).toBeDefined()
    await ui.unmount()
  }
})
