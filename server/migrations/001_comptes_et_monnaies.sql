-- ————————————————————————————————————————————————————————————
--  001 — Le profil de jeu, les deux monnaies, la boutique
-- ————————————————————————————————————————————————————————————
--
-- ⚠️ Ce fichier décrit le PLAN de la base, pas son contenu. Il est versionné
-- dans git ; les données des joueurs, elles, ne le sont jamais.
--
-- ⚠️ ARCHITECTURE — le navigateur ne parle JAMAIS à cette base. Le jeu parle au
-- serveur Colyseus, et lui seul ouvre une connexion ici. Aucune clé, aucune
-- adresse de base ne part dans le navigateur.
--
-- ————— Le partage des tables avec Better Auth —————
-- L'IDENTITÉ (qui tu es) appartient à Better Auth : il crée et gère lui-même
-- ses tables « user », « session », « account » et « verification » — c'est là
-- que vivent l'email, le hachage du mot de passe et les jetons. On n'y touche
-- jamais à la main.
--
-- Ce fichier ne décrit que le PROFIL DE JEU (ce que tu possèdes) : les
-- monnaies, la boutique, les déblocages. Le lien entre les deux mondes est
-- `profils.joueur`, qui porte l'identifiant du compte Better Auth.
--
-- Volontairement PAS de clé étrangère vers « user » : ses tables sont créées
-- par un outil séparé, et rien ne garantit qu'elles existent déjà quand cette
-- migration tourne. Une contrainte qui dépend de l'ordre de deux outils est une
-- panne au premier démarrage. Le nettoyage d'un compte supprimé se fait donc
-- côté serveur, explicitement.

-- ————— Le profil de jeu —————
-- Une ligne par compte, créée à la première connexion (anonyme comprise).
create table if not exists profils (
  -- L'identifiant du compte Better Auth (texte : ce sont des identifiants
  -- opaques, pas des numéros qui se devinent en incrémentant).
  joueur    text primary key,

  pseudo    text not null default 'Guerrier'
            check (char_length(pseudo) between 1 and 12),

  -- Les deux monnaies. La contrainte >= 0 est une SÉCURITÉ, pas une politesse :
  -- même si le code du serveur avait un bug, la base refuserait un solde négatif.
  mon       integer not null default 0 check (mon >= 0),
  hisui     integer not null default 0 check (hisui >= 0),

  guerrier  text not null default 'yasuke',
  cree_le   timestamptz not null default now(),
  vu_le     timestamptz not null default now()
);

-- ————— La boutique —————
-- ⚠️ RÈGLE INTANGIBLE : on ne vend QUE de l'apparence. Jamais un passif, jamais
-- un parchemin, jamais un réglage de course. Les guerriers sont équilibrés
-- bonus/malus, la hitbox est identique pour tous et le sprint final se court à
-- armes égales — vendre de la puissance ferait s'effondrer tout ça, et le duel
-- deviendrait une question de portefeuille.
create table if not exists articles (
  code       text primary key,
  nom        text not null,
  categorie  text not null
             check (categorie in ('couleur', 'ornement', 'arme', 'emote', 'banniere')),
  prix_mon   integer check (prix_mon >= 0),
  prix_hisui integer check (prix_hisui >= 0),
  actif      boolean not null default true,
  -- Un article sans aucun prix ne serait achetable par rien
  check (prix_mon is not null or prix_hisui is not null)
);

-- ————— Ce que chaque joueur possède —————
-- La clé primaire (joueur, article) empêche de posséder deux fois la même
-- chose : un double achat par double-clic est refusé par la base elle-même.
create table if not exists deblocages (
  joueur    text not null references profils(joueur) on delete cascade,
  article   text not null references articles(code),
  obtenu_le timestamptz not null default now(),
  primary key (joueur, article)
);

-- ————— Le journal —————
-- Chaque gain et chaque dépense laisse une trace. Sert à comprendre un solde
-- qui semble faux, et à repérer un joueur qui gagnerait trop vite — le seul
-- moyen honnête de détecter la triche a posteriori.
create table if not exists mouvements (
  id      bigserial primary key,
  joueur  text not null references profils(joueur) on delete cascade,
  monnaie text not null check (monnaie in ('mon', 'hisui')),
  montant integer not null, -- négatif = dépense
  motif   text not null,    -- 'course', 'achat:couleur_sang', 'cadeau'…
  quand   timestamptz not null default now()
);
create index if not exists idx_mouvements_joueur on mouvements (joueur, quand desc);
