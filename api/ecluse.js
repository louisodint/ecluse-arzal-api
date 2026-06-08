export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  try {
    const now = new Date();
    const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const heureLocale = parisTime.getHours();

    const yyyy = parisTime.getFullYear();
    const mm = String(parisTime.getMonth() + 1).padStart(2, '0');
    const dd = String(parisTime.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const url = `https://www.passeportecluse-arzal-camoel.com/?date=${dateStr}`;
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9'
      }
    });
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

    // Debug : renvoyer les infos si toujours vide
    if (ecluses.length === 0) {
      const extrait = html.substring(0, 2000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return res.status(200).send(`DEBUG date=${dateStr} heure=${heureLocale} extrait=${extrait}`);
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
      if (ecluse.montants > 0) phrase += `${ecluse.montants} bateau${ecluse.montants > 1 ? 'x' : ''} montant${ecluse.montants > 1 ? 's' : ''}. `;
      if (ecluse.avalants > 0) phrase += `${ecluse.avalants} bateau${ecluse.avalants > 1 ? 'x' : ''} avalant${ecluse.avalants > 1 ? 's' : ''}. `;
      phrase += `Durée estimée : ${duree}.`;
    }

    return res.status(200).send(phrase);

  } catch (err) {
    return res.status(200).send(`Erreur : ${err.message}`);
  }
}
