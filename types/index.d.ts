/** Ce que le forfait dit, tel que lu à la dernière vérification. */
export type AutopiloteUsage = {
  /** Fenêtre de 5 h, en %. */
  cinq: number
  /** Semaine, en %. */
  semaine: number
  /** Remises à zéro, en millisecondes depuis 1970. */
  resetCinq: number
  resetSemaine: number
  /** Quand c'est lu. */
  lu: number
}

/** Une ligne du journal : ce que l'autopilote a décidé et pourquoi. */
export type AutopiloteLigne = { quand: number; action: 'relance' | 'attente' | 'arret' | 'info'; texte: string }

/** Le fichier de suivi du projet, tel que lu. */
export type AutopiloteProjet = {
  existe: boolean
  objectif: string
  /** « en cours », « terminé », « bloqué », ou "" si absent. */
  statut: string
  faites: number
  total: number
  /** Texte de la première tâche non cochée. */
  prochaine: string
}

export type AutopiloteEtat = {
  actif: boolean
  /** Prochaine vérification (ms), 0 si à l'arrêt. */
  prochaine: number
  /** Un tour de Claude est en cours. */
  occupe: boolean
  /** Une relance a été envoyée et n'a pas encore commencé. */
  enAttente: boolean
  usage: AutopiloteUsage | null
  /** Rythme : où on devrait en être (%) et l'avance en points. */
  prevu: number | null
  avance: number | null
  projet: AutopiloteProjet | null
  /** Le champ « objectif » du panneau est ouvert. */
  saisieObjectif: boolean
  journal: AutopiloteLigne[]
  relances: number
}

declare module 'claude-code' {
  interface PluginState {
    autopilote: { etat: Shaped<AutopiloteEtat> }
  }
}
