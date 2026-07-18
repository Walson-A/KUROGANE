-- ————————————————————————————————————————————————————————————
--  002 — Le catalogue de la boutique
-- ————————————————————————————————————————————————————————————
--
-- ⚠️ RAPPEL DE LA RÈGLE INTANGIBLE : on ne vend QUE de l'apparence.
--
-- Concrètement, ici, cela veut dire : **des couleurs, et rien d'autre.**
-- Surtout PAS les ornements de tête (cornes, oreilles) : dans ce jeu ils ne
-- sont pas décoratifs, ils DÉCIDENT du style du guerrier perso (cf. CUSTOM_STYLE
-- dans src/roster.ts — les cornes donnent la peau d'oni, les oreilles la ruse du
-- renard). Les vendre reviendrait à vendre un passif, donc de la puissance.
--
-- Les 18 couleurs de la palette libre (SKIN_PALETTE) restent GRATUITES et ne
-- figurent pas ici : on n'a rien retiré à personne, la boutique ne fait
-- qu'ajouter.

-- La valeur de l'article : pour une couleur, son code '#rrggbb'.
-- Elle vit dans la BASE et non dans le jeu, pour qu'ajouter une couleur soit
-- une simple ligne de SQL — sans redéployer le client.
alter table articles add column if not exists valeur text;

-- Ordre d'affichage en boutique (les moins chères d'abord, à prix égal l'ordre
-- choisi ici).
alter table articles add column if not exists rang integer not null default 0;

-- ————— Les couleurs de maître —————
-- Des teintes traditionnelles japonaises, volontairement plus profondes ou plus
-- métalliques que la palette libre : elles doivent se remarquer en piste.
--
-- Le prix est calé sur le gain d'une course (100 Mon la victoire, 25 la
-- participation) : une couleur à 500 Mon, c'est cinq victoires — assez pour
-- valoir quelque chose, assez peu pour rester atteignable en une soirée.
--
-- `on conflict do nothing` : rejouer cette migration ne duplique rien et
-- n'écrase pas un prix qu'on aurait ajusté depuis.
insert into articles (code, nom, categorie, prix_mon, prix_hisui, valeur, rang) values
  ('coul_kurenai',   'Kurenai 紅',    'couleur',  500,  null, '#9b1b30',  10),
  ('coul_ai',        'Ai-zome 藍',    'couleur',  500,  null, '#1b3a6b',  20),
  ('coul_moegi',     'Moegi 萌黄',    'couleur',  500,  null, '#4b7f3a',  30),
  ('coul_murasaki',  'Murasaki 紫',   'couleur',  800,  null, '#5b3a8c',  40),
  ('coul_sakura',    'Sakura 桜',     'couleur',  800,  null, '#f2b8c6',  50),
  ('coul_shikkoku',  'Shikkoku 漆黒', 'couleur', 1500,  null, '#0b0b10',  60),
  -- Les deux dernières ne s'achètent qu'en jade : ce sont les seules pièces
  -- qu'on ne peut pas obtenir en courant.
  ('coul_kin',       'Kin 金',        'couleur', null,    40, '#c9a227',  70),
  ('coul_gin',       'Gin 銀',        'couleur', null,    40, '#c8ccd4',  80)
on conflict (code) do nothing;
