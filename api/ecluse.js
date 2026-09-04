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

    // Extraire chaque éclusée depuis le HTML, ligne de tableau par ligne de tableau.
    // Structure réelle du site (une <tr> par créneau) :
    //   <th scope=row>08h</th>          → l'heure est dans un <th>, pas un <td>
    //   <td>4.15</td>                   → côte marine
    //   soit deux <td> (montante / avalante) contenant un bouton avec le nombre de bateaux,
    //   soit un seul <td colspan="2">…Ecluse annulée…</td> quand l'éclusée est annulée.
    const ecluses = [];

    // Nombre de bateaux d'une cellule : texte du 1er <a>/<button> (le nombre précède
    // toujours le contenu du modal). Renvoie 0 si aucun nombre exploitable.
    const nombreBateaux = (cellHtml) => {
      if (!cellHtml) return 0;
      const m = cellHtml.match(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/i);
      if (!m) return 0;
      const n = parseInt(m[1].replace(/<[^>]+>/g, ' ').trim(), 10);
      return isNaN(n) ? 0 : n;
    };

    const lignesTableau = html.split(/<tr[\s>]/i).slice(1);
    for (const ligne of lignesTableau) {
      const heureMatch = ligne.match(/<th[^>]*>\s*(\d{1,2})\s*h\s*<\/th>/i);
      if (!heureMatch) continue;
      const heure = parseInt(heureMatch[1], 10);
      const heureStr = `${String(heure).padStart(2, '0')}h`;

      const tds = ligne.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || [];
      const cote = parseFloat((tds[0] || '').replace(/<[^>]+>/g, ' ').replace(',', '.').trim());

      // Une éclusée annulée n'a pas de colonnes montante/avalante : on la garde dans la
      // timeline mais marquée comme annulée, sans jamais lui inventer de bateaux.
      if (/annul/i.test(ligne)) {
        ecluses.push({ heure, heureStr, montants: 0, avalants: 0, annulee: true });
        continue;
      }

      if (isNaN(cote) || cote <= 0) continue;
      const montants = nombreBateaux(tds[1]);
      const avalants = nombreBateaux(tds[2]);
      ecluses.push({ heure, heureStr, montants, avalants, annulee: false });
    }

    // Parsing vide : le site a probablement changé de structure.
    // On logue l'extrait côté serveur (visible dans les logs Vercel) sans le renvoyer au client.
    if (ecluses.length === 0) {
      const extrait = html.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.error(`Parsing vide date=${dateStr} heure=${heureLocale} extrait=${extrait}`);
      return res.status(200).send(MESSAGE_ERREUR);
    }

    // Prochaine éclusée non annulée strictement après l'index donné
    const prochaineNonAnnulee = (from) => {
      for (let i = from + 1; i < ecluses.length; i++) {
        if (!ecluses[i].annulee) return ecluses[i];
      }
      return null;
    };

    // Trouver l'éclusée courante (créneau correspondant à l'heure locale)
    let idx = -1;
    let type = 'courante';

    for (let i = ecluses.length - 1; i >= 0; i--) {
      if (ecluses[i].heure <= heureLocale) { idx = i; break; }
    }
    if (idx === -1) { idx = 0; type = 'prochaine'; }
    if (heureLocale > ecluses[ecluses.length - 1].heure) { idx = ecluses.length - 1; type = 'derniere'; }

    const ecluse = ecluses[idx];
    const h = ecluse.heure;
    const heureTexte = `${h} heure${h > 1 ? 's' : ''}`;

    // Créneau courant annulé : on l'annonce et on renvoie vers la prochaine éclusée qui a lieu.
    if (ecluse.annulee) {
      let phrase;
      if (type === 'prochaine') phrase = `Prochaine éclusée à ${heureTexte} annulée. `;
      else if (type === 'derniere') phrase = `Dernière éclusée du jour à ${heureTexte} annulée. `;
      else phrase = `Éclusée de ${heureTexte} annulée. `;

      const suivante = prochaineNonAnnulee(idx);
      if (suivante) {
        const totalSuivante = suivante.montants + suivante.avalants;
        const hS = suivante.heure;
        const heureSuivanteTexte = `${hS} heure${hS > 1 ? 's' : ''}`;
        if (totalSuivante === 0) {
          phrase += `Prochaine éclusée à ${heureSuivanteTexte}, aucun bateau déclaré.`;
        } else {
          phrase += `Prochaine éclusée à ${heureSuivanteTexte} avec ${totalSuivante} bateau${totalSuivante > 1 ? 'x' : ''}.`;
        }
      } else {
        phrase += `Plus d'éclusée prévue aujourd'hui.`;
      }
      return res.status(200).send(phrase);
    }

    const total = ecluse.montants + ecluse.avalants;
    let duree;
    if (total <= 4) duree = '15 minutes';
    else if (total <= 8) duree = '20 minutes';
    else if (total <= 14) duree = '25 à 30 minutes';
    else if (total <= 24) duree = '35 à 45 minutes';
    else duree = '50 à 70 minutes';

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

    // Ajouter l'éclusée suivante (heure + nombre de bateaux), en sautant les annulées
    if (type === 'courante') {
      const suivante = prochaineNonAnnulee(idx);
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
