-- ————————————————————————————————————————————————————————————
--  003 — Le classement des temps
-- ————————————————————————————————————————————————————————————
--
-- Une ligne par course TERMINÉE en ligne.
--
-- ⚠️ Seules les courses en ligne entrent ici, et c'est délibéré. Le chrono d'une
-- course solo est calculé par le navigateur : rien n'empêche de le réécrire. Le
-- chrono d'une course en ligne, lui, est déjà borné par le serveur au moment de
-- l'arrivée (RaceRoom, message 'finished' : un temps qui s'écarte de plus de
-- 1,5 s du temps mesuré côté serveur est remplacé par celui du serveur).
--
-- C'est toute la différence entre un tableau qu'on peut lire et un tableau où
-- trônerait un 10 s inatteignable. Les temps solo restent sur l'appareil, dans
-- l'onglet « local » — personne d'autre ne les voit, donc personne n'a de raison
-- de les truquer.

create table if not exists scores (
  id         bigserial primary key,
  -- L'identifiant du compte Better Auth. Pas de clé étrangère, pour la même
  -- raison qu'en 001 : les tables d'identité sont créées par un autre outil.
  joueur     text        not null,
  -- Le pseudo est RECOPIÉ ici, et non lu par jointure : on veut afficher le nom
  -- porté le jour de la course. Un joueur qui se renomme ne réécrit pas
  -- l'histoire du classement.
  pseudo     text        not null default '',
  -- En millisecondes, en entier : un flottant rendrait deux temps « égaux »
  -- impossibles à départager de façon stable d'une requête à l'autre.
  temps_ms   integer     not null check (temps_ms > 0),
  -- La longueur de la course. Un classement qui mêlerait deux longueurs ne
  -- voudrait rien dire — on filtre toujours dessus.
  longueur   integer     not null,
  -- Le guerrier utilisé : de quoi afficher son kanji à côté du temps.
  fighter    text        not null default 'yasuke',
  -- Le nombre de partants : finir 1er sur 5 n'est pas finir 1er sur 2.
  partants   smallint    not null default 1,
  rang       smallint    not null default 1,
  cree_le    timestamptz not null default now()
);

-- Le classement mondial : « les meilleurs temps sur cette longueur ». Sans cet
-- index, chaque ouverture de l'écran relirait toute la table.
create index if not exists scores_mondial on scores (longueur, temps_ms);

-- L'onglet « récentes » : les dernières courses d'UN joueur, les plus fraîches
-- d'abord.
create index if not exists scores_recentes on scores (joueur, cree_le desc);
