const https = require('https');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseEcluses(html) {
  // Extraire le bloc du tableau entre "Avalante" et "Profondeur"
  const match = html.match(/Avalante[\s\S]*?(\d{2}h[\s\S]+?)Profondeur/);
  if (!match) return null;

  const bloc = match[1];
  const lignes = bloc.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  const ecluses = [];
  for (let i = 0; i < lignes.length; i++) {
    if (/^\d{2}h$/.test(lignes[i])) {
      const heure = lignes[i];
      const cote = lignes[i + 1];
      const montants = parseInt(lignes[i + 2]);
      const avalants = parseInt(lignes[i + 3]);
      if (cote && !isNaN(montants) && !isNaN(avalants)) {
        ecluses.push({
          heure: parseInt(heure),
          heureStr: heure,
          cote: parseFloat(cote),
          montants,
          avalants
        });
      }
    }
  }
  return ecluses;
}

function estimerDuree(montants, avalants) {
  const total = montants + avalants;
  if (total <= 4) return '15 minutes';
  if (total <= 8) return '20 minutes';
  if (total <= 14) return '25 à 30 minutes';
  if (total <= 24) return '35 à 45 minutes';
  return '50 à 70 minutes';
}

function heureEnTexte(h) {
  if (h === 0) return 'minuit';
  return `${h} heure${h > 1 ? 's' : ''}`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');

  try {
    // Date du jour Paris (UTC+2 en été, UTC+1 en hiver)
    const now = new Date();
    const parisOffset = 2; // à ajuster selon saison
    const heureLocale = (now.getUTCHours() + parisOffset) % 24;

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const url = `https://www.passeportecluse-arzal-camoel.com/?date=${dateStr}`;
    const html = await fetchPage(url);
    const ecluses = parseEcluses(html);

    if (!ecluses || ecluses.length === 0) {
      return res.status(200).send("Impossible de récupérer les horaires de l'écluse d'Arzal.");
    }

    // Trouver l'éclusée courante ou la prochaine
    let ecluse = null;
    let type = 'courante';

    // Chercher l'éclusée dont l'heure est <= heure actuelle (la plus récente passée)
    for (let i = ecluses.length - 1; i >= 0; i--) {
      if (ecluses[i].heure <= heureLocale) {
        ecluse = ecluses[i];
        type = 'courante';
        break;
      }
    }

    // Si aucune n'est passée, prendre la première
    if (!ecluse) {
      ecluse = ecluses[0];
      type = 'prochaine';
    }

    // Si on est après la dernière
    const derniere = ecluses[ecluses.length - 1];
    if (heureLocale > derniere.heure) {
      ecluse = derniere;
      type = 'derniere';
    }

    const duree = estimerDuree(ecluse.montants, ecluse.avalants);
    const total = ecluse.montants + ecluse.avalants;
    const heureTexte = heureEnTexte(ecluse.heure);

    let phrase = '';

    if (type === 'prochaine') {
      phrase = `Prochaine éclusée à ${heureTexte}. `;
    } else if (type === 'derniere') {
      phrase = `Dernière éclusée du jour à ${heureTexte}. `;
    } else {
      phrase = `Éclusée de ${heureTexte}. `;
    }

    if (total === 0) {
      phrase += `Aucun bateau déclaré. `;
    } else {
      if (ecluse.montants > 0) {
        phrase += `${ecluse.montants} bateau${ecluse.montants > 1 ? 'x' : ''} montant${ecluse.montants > 1 ? 's' : ''}. `;
      }
      if (ecluse.avalants > 0) {
        phrase += `${ecluse.avalants} bateau${ecluse.avalants > 1 ? 'x' : ''} avalant${ecluse.avalants > 1 ? 's' : ''}. `;
      }
      phrase += `Durée estimée : ${duree}.`;
    }

    return res.status(200).send(phrase);

  } catch (err) {
    return res.status(200).send("Erreur lors de la récupération des horaires de l'écluse.");
  }
};
