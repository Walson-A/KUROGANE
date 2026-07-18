/**
 * Node exige l'extension dans les imports ; Vite ne la demande pas, et tout le
 * code du jeu est écrit sans. Plutôt que d'alourdir les sources pour faire
 * plaisir aux outils, on apprend à Node à retrouver le fichier.
 *
 *   node --import ./tools/resolveur-ts.mjs tools/verifier-anims.ts
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(
  `data:text/javascript,
  export function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\\.(ts|js|json|mjs)$/.test(spec)) {
      try { return next(spec + '.ts', ctx) } catch {}
    }
    return next(spec, ctx)
  }`,
  pathToFileURL('./')
)
