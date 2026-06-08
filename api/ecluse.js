export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  try {
    const now = new Date();
    // Fuseau Europe/Paris (UTC+2 été, UTC+1 hiver)
    const parisTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
    const heureLocale = parisTime.getHours();

    const yyyy = parisTime.getFullYear();
    const mm = String(parisTime.getMonth() + 1).padStart(2, '0');
    const dd = String(parisTime.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const url = `https://www.passeportecluse-arzal-camoel.com/?date=${dateStr}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
    });
    const html = await response.text();

    // Extraire le bloc tableau entre "Avalante" et "Profondeur"
    const match = html.match(/Avalante[\s\S]*?(\d{2}h[\s\S]+?)Profondeur/);
    if (!match) {
      return res.status(200).send("Impossible de récupérer les horaires de l'écluse d'Arzal.");
    }

    const bloc = match[1];
    const lignes = bloc.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

    const ecluses = [];
    for (let i = 0; i < lignes.length; i++) {
      if (/^\d{2}h$/.test(lignes[i])) {
        const heure = parseInt(lignes[i]);
        const cote = lignes[i + 1];
        const montants = parseInt(lignes[i + 2]);
        const avalants = parseInt(lignes[i + 3]);
        if (cote && !isNaN(montants) && !isNaN(avalants)) {
          ecluses.push({ heure, heureStr: lignes[i], montants, avalants });
        }
      }
    }

    if (ecluses.length === 0) {
      return res.status(200).send("Aucune éclusée trouvée pour aujourd'hui.");
    }

    // Trouver l'éclusée courante (la plus récente dont l'heure <= heure actuelle)
    let ecluse = null;
    let type = 'courante';

    for (let i = ecluses.length - 1; i >= 0; i--) {
      if (ecluses[i].heure <= heureLocale) {
        ecluse = ecluses[i];
        break;
      }
    }

    // Pas encore d'éclusée passée → prendre la première
    if (!ecluse) {
      ecluse = ecluses[0];
      type = 'prochaine';
    }

    // Après la dernière éclusée du jour
    if (heureLocale > ecluses[ecluses.length - 1].heure) {
      ecluse = ecluses[ecluses.length - 1];
      type = 'derniere';
    }

    // Estimation durée
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
