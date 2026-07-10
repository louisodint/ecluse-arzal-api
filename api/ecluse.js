const MESSAGE_ERREUR = "Impossible de récupérer les horaires de l'écluse pour le moment.";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Méthode non autorisée');
  }

  // Réponse mise en cache par le CDN Vercel : le site de l'écluse n'est
  // sollicité qu'une fois toutes les 2 minutes quel que soit le trafic
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');

  try {
    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    const heureLocale = parseInt(p.hour, 10);
    const dateStr = `${p.year}-${p.month}-${p.day}`;

    const url = `https://www.passeportecluse-arzal-camoel.com/?date=${dateStr}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
    if (!response.ok) {
      console.error(`Réponse ${response.status} du site de l'écluse pour ${url}`);
      return res.status(200).send(MESSAGE_ERREUR);
    }
    const html = await response.text();

    // Extraire toutes les heures et leurs données depuis le HTML brut
    // Format dans le HTML : <td>08h</td> ... <td>3.33</td> ... <td>2</td> ... <td>2</td>
    const ecluses = [];
    
    // Chercher les cellules td contenant les heures
    const tdMatches = html.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
    const cellules = tdMatches.map(td => td.replace(/<[^>]+>/g, '').trim());
    
    for (let i = 0; i < cellules.length; i++) {
      if (/^\d{2}h$/.test(cellules[i])) {
        const heure = parseInt(cellules[i]);
        const cote = cellules[i + 1];
        const montants = parseInt(cellules[i + 2]);
        const avalants = parseInt(cellules[i + 3]);
        if (cote && !isNaN(montants) && !isNaN(avalants) && parseFloat(cote) > 0) {
          ecluses.push({ heure, heureStr: cellules[i], montants, avalants });
        }
      }
    }

    // Si pas de résultat avec les td, essayer avec le texte brut
    if (ecluses.length === 0) {
      const texte = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, '\n');
      const lignes = texte.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lignes.length; i++) {
        if (/^\d{2}h$/.test(lignes[i])) {
          const heure = parseInt(lignes[i]);
          // Chercher côte et bateaux dans les lignes suivantes (ignorer les lignes vides/parasites)
          const suivantes = [];
          for (let j = i + 1; j < lignes.length && suivantes.length < 4; j++) {
            if (/^[\d.]+$/.test(lignes[j])) suivantes.push(lignes[j]);
          }
          if (suivantes.length >= 3) {
            const montants = parseInt(suivantes[1]);
            const avalants = parseInt(suivantes[2]);
            if (!isNaN(montants) && !isNaN(avalants)) {
              ecluses.push({ heure, heureStr: lignes[i], montants, avalants });
            }
          }
        }
      }
    }

    // Parsing vide : le site a probablement changé de structure.
    // On logue l'extrait côté serveur (visible dans les logs Vercel) sans le renvoyer au client.
    if (ecluses.length === 0) {
      const extrait = html.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.error(`Parsing vide date=${dateStr} heure=${heureLocale} extrait=${extrait}`);
      return res.status(200).send(MESSAGE_ERREUR);
    }

    // Trouver l'éclusée courante
    let ecluse = null;
    let type = 'courante';

    for (let i = ecluses.length - 1; i >= 0; i--) {
      if (ecluses[i].heure <= heureLocale) {
        ecluse = ecluses[i];
        break;
      }
    }
    if (!ecluse) { ecluse = ecluses[0]; type = 'prochaine'; }
    if (heureLocale > ecluses[ecluses.length - 1].heure) { ecluse = ecluses[ecluses.length - 1]; type = 'derniere'; }

    const total = ecluse.montants + ecluse.avalants;
    let duree;
    if (total <= 4) duree = '15 minutes';
    else if (total <= 8) duree = '20 minutes';
    else if (total <= 14) duree = '25 à 30 minutes';
    else if (total <= 24) duree = '35 à 45 minutes';
    else duree = '50 à 70 minutes';

    const h = ecluse.heure;
    const heureTexte = `${h} heure${h > 1 ? 's' : ''}`;

    let phrase = '';
    if (type === 'prochaine') phrase = `Prochaine éclusée à ${heureTexte}. `;
    else if (type === 'derniere') phrase = `Dernière éclusée du jour à ${heureTexte}. `;
    else phrase = `Éclusée de ${heureTexte}. `;

    if (total === 0) {
      phrase += `Aucun bateau déclaré.`;
    } else {
      phrase += `${total} bateau${total > 1 ? 'x' : ''} au total. `;
      phrase += `Durée estimée : ${duree}. `;
      const dureeMin = total <= 4 ? 15 : total <= 8 ? 20 : total <= 14 ? 28 : total <= 24 ? 40 : 60;
      const minFin = ecluse.heure * 60 + 10 + dureeMin;
      const hFin = Math.floor(minFin / 60) % 24;
      const mFin = minFin % 60;
      const heureFin = hFin + 'h' + (mFin > 0 ? String(mFin).padStart(2, '0') : '');
      phrase += `Barrières ouvertes vers ${heureFin}.`;
    }

    // Ajouter l'éclusée suivante (heure + nombre de bateaux)
    if (type === 'courante') {
      const idx = ecluses.indexOf(ecluse);
      const suivante = ecluses[idx + 1];
      if (suivante) {
        const totalSuivante = suivante.montants + suivante.avalants;
        const hS = suivante.heure;
        const heureSuivanteTexte = `${hS} heure${hS > 1 ? 's' : ''}`;
        if (totalSuivante === 0) {
          phrase += ` Prochaine éclusée à ${heureSuivanteTexte}, aucun bateau déclaré.`;
        } else {
          phrase += ` Prochaine éclusée à ${heureSuivanteTexte} avec ${totalSuivante} bateau${totalSuivante > 1 ? 'x' : ''}.`;
        }
      } else {
        phrase += ` C'était la dernière éclusée du jour.`;
      }
    }

    return res.status(200).send(phrase);

  } catch (err) {
    console.error('Erreur lors de la récupération des horaires :', err);
    return res.status(200).send(MESSAGE_ERREUR);
  }
}
