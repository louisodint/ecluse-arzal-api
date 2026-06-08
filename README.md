# Écluse Arzal — API iOS Raccourcis

API serverless qui lit les horaires de l'écluse d'Arzal-Camoël et renvoie une phrase vocale pour Siri.

## Déploiement sur Vercel

1. Pousse ce dépôt sur GitHub
2. Va sur vercel.com → "Add New Project" → importe le dépôt
3. Clique "Deploy" (aucune config nécessaire)
4. Ton URL sera : `https://ton-projet.vercel.app/api/ecluse`

## Utilisation dans Raccourcis iOS

1. Action : **Obtenir le contenu de l'URL** → `https://ton-projet.vercel.app/api/ecluse`
2. Action : **Énoncer le texte** → Contenu de l'URL
