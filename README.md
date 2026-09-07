# Undercover — entre potes

Jeu multijoueur privé : rooms par code, Imposteur / Mr White, indices, votes secrets, départages, présence et spectateurs.

## Déploiement Vercel

1. Sur Vercel : **Add New → Project** puis importe ce repo.
2. Ajoute une base **Upstash Redis** depuis le Marketplace Vercel et connecte-la au projet.
3. Vérifie que Vercel a créé :
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
4. Redéploie le projet.

Le site accepte aussi les anciens noms `KV_REST_API_URL` et `KV_REST_API_TOKEN`.

Aucune table SQL, aucun compte utilisateur et aucune migration ne sont nécessaires.

## Règles implémentées

- 3 joueurs minimum, pas de limite codée.
- Nombre d'infiltrés automatique : `floor((joueurs + 1) / 3)`, minimum 1.
- 3–4 joueurs = 1 infiltré ; 5 = 2 ; 6–7 = 2 ; 8–10 = 3, etc.
- Mode Imposteur : mot civil + mot proche pour tous les imposteurs.
- Mode Mr White : les Mr White savent leur rôle mais n'ont aucun mot.
- Mr White éliminé : une tentative pour deviner le mot civil ; chaque Mr White éliminé a sa tentative.
- Mots personnalisés : l'hôte entre 2 mots, leur attribution civil/imposteur est aléatoire et le mode « imposteur inconscient » est forcé.
- 1 à 4 manches avant vote, 2 par défaut.
- 15 à 60 secondes par action, 30 par défaut.
- Ordre aléatoire à chaque manche.
- Doublons d'indices interdits pendant toute la partie.
- Votes secrets jusqu'au résultat ; auto-vote autorisé au vote normal.
- Égalité : indices bonus des joueurs à égalité puis revote sans eux. Si absolument tous les survivants sont à égalité, ils revotent exceptionnellement entre eux sans auto-vote pour éviter un blocage.
- Joueur absent : son tour est sauté et ses votes non envoyés sont ignorés.
- Retour : récupération de la session et message de retour.
- Hôte absent : transfert au joueur connecté avec le plus ancien ordre d'arrivée.
- Joueur qui rejoint en cours : spectateur jusqu'à la prochaine partie.
- Infiltrés gagnent dès qu'ils sont aussi nombreux que les civils encore vivants.
- Indices effacés après chaque vote par défaut, option pour les conserver.
- Rooms conservées 12 h après la dernière activité.

## Local (optionnel)

Copie `.env.example` vers `.env.local`, ajoute les deux variables Upstash puis :

```bash
npm install
npm run dev
```
