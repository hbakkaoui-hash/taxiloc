/* ============================================================
   BAKTAXI — Informations éditeur & textes légaux
   (Brouillons à faire relire par un professionnel avant
    ouverture au grand public.)
   ============================================================ */
const EDITEUR = {
  nom: "Hassan BAKKAOUI",            // ⚠️ à confirmer (nom + prénom de l'entrepreneur)
  statut: "Entrepreneur individuel (EI)",
  siret: "478 346 166 00034",
  email: "bakkahassa@hotmail.com",
  telephone: "06 72 49 66 94",
  hebergeurSite: "GitHub, Inc. (GitHub Pages) — 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA — github.com",
  hebergeurDonnees: "Supabase — base de données hébergée dans l'Union européenne (région Irlande)",
  ville: "Paris",
};

// Rappel légal taxi (réutilisé : formulaire de publication + CGU)
const DISCLAIMER_TAXI = `La <b>location simple</b> d'une licence est interdite : seule la <b>location-gérance</b> est admise (ADS délivrées avant le 1ᵉʳ octobre 2014), et le contrat doit être <b>publié dans un journal d'annonces légales</b>. La <b>carte professionnelle</b> est obligatoire pour conduire. Le titulaire reste <b>solidairement responsable</b> des dettes d'exploitation pendant 6 mois après la publication. <b>BakTaxi n'est pas partie au contrat</b> et ne valide aucun arrangement.`;

function legalMentions() {
  return `
  <p class="hint">Dernière mise à jour : 2026.</p>
  <h2>Éditeur du site</h2>
  <p>${esc(EDITEUR.nom)} — ${esc(EDITEUR.statut)}<br/>
  SIRET : ${esc(EDITEUR.siret)}<br/>
  E-mail : <a href="mailto:${esc(EDITEUR.email)}">${esc(EDITEUR.email)}</a><br/>
  Téléphone : ${esc(EDITEUR.telephone)}</p>
  <h2>Directeur de la publication</h2>
  <p>${esc(EDITEUR.nom)}</p>
  <h2>Hébergeur du site</h2>
  <p>${esc(EDITEUR.hebergeurSite)}</p>
  <h2>Hébergement des données</h2>
  <p>${esc(EDITEUR.hebergeurDonnees)}</p>
  <h2>Nature du service</h2>
  <p>BakTaxi est un <b>tableau d'annonces</b> mettant en relation des chauffeurs de taxi professionnels. L'éditeur agit en qualité d'<b>hébergeur de contenus</b> au sens de la LCEN : il n'est pas partie aux transactions entre utilisateurs et n'exerce pas de contrôle éditorial sur les annonces.</p>`;
}

function legalConfidentialite() {
  return `
  <p class="hint">Dernière mise à jour : 2026.</p>
  <h2>Responsable du traitement</h2>
  <p>${esc(EDITEUR.nom)} (${esc(EDITEUR.statut)}) — <a href="mailto:${esc(EDITEUR.email)}">${esc(EDITEUR.email)}</a></p>
  <h2>Données collectées</h2>
  <p>Lors de la publication d'une annonce : nom ou raison sociale, téléphone, e-mail (facultatif), zone d'exercice et informations relatives à l'annonce. Lors d'une demande de contact : nom, téléphone et message du demandeur. Le profil (zone, expérience, etc.) reste stocké <b>localement sur votre appareil</b>.</p>
  <h2>Finalité & base légale</h2>
  <p>Les données servent uniquement à la <b>mise en relation professionnelle</b> entre chauffeurs. La base légale est l'<b>intérêt légitime</b> de la plateforme et la <b>publication volontaire</b> par l'utilisateur de son annonce.</p>
  <h2>Protection du numéro de téléphone</h2>
  <p>L'option « masquer mon numéro » est une <b>mesure technique de protection (privacy by design)</b> : elle évite l'affichage public du numéro. Il ne s'agit pas d'un contrôle éditorial du contenu.</p>
  <h2>Destinataires & hébergement</h2>
  <p>Les annonces sont visibles par les utilisateurs de la plateforme. Les <b>demandes de contact</b> ne sont accessibles qu'à l'auteur de l'annonce concernée. Les données sont hébergées dans l'<b>Union européenne</b> (${esc(EDITEUR.hebergeurDonnees)}).</p>
  <h2>Durée de conservation</h2>
  <p>Les annonces expirent automatiquement au bout de 30 jours (ou à leur date de fin). Les demandes de contact sont conservées le temps nécessaire à la mise en relation.</p>
  <h2>Vos droits</h2>
  <p>Vous disposez d'un droit d'accès, de rectification, d'effacement et d'opposition. Pour l'exercer : <a href="mailto:${esc(EDITEUR.email)}">${esc(EDITEUR.email)}</a>. Vous pouvez aussi saisir la <b>CNIL</b> (cnil.fr).</p>
  <h2>Cookies</h2>
  <p>BakTaxi n'utilise que du <b>stockage fonctionnel</b> (mémorisation locale de votre profil et de vos annonces). Aucun traceur publicitaire ni mesure d'audience tierce.</p>`;
}

function legalCgu() {
  return `
  <p class="hint">Dernière mise à jour : 2026.</p>
  <h2>1. Objet</h2>
  <p>BakTaxi est une plateforme d'annonces réservée aux chauffeurs de taxi professionnels : location, location-gérance, licence (ADS), remplacement, et matériel/accessoires.</p>
  <h2>2. Rôle de la plateforme</h2>
  <p>BakTaxi est un <b>intermédiaire neutre</b> : elle met en relation une offre et une demande mais <b>n'est pas partie aux contrats</b> conclus entre utilisateurs et ne perçoit <b>aucune commission</b> sur les transactions.</p>
  <h2>3. Contenus interdits</h2>
  <p>Sont interdits : les annonces hors usage professionnel taxi, les liens externes, les propos discriminatoires, et tout contenu illicite. La plateforme se réserve le droit de retirer promptement tout contenu illicite signalé.</p>
  <h2>4. Signalement</h2>
  <p>Tout utilisateur peut signaler une annonce via le bouton « Signaler » ou par e-mail à <a href="mailto:${esc(EDITEUR.email)}">${esc(EDITEUR.email)}</a>.</p>
  <h2>5. Cadre légal taxi</h2>
  <p>${DISCLAIMER_TAXI}</p>
  <h2>6. Responsabilité de l'utilisateur</h2>
  <p>Chaque utilisateur est seul responsable de l'exactitude de son annonce et du respect de la réglementation applicable (location-gérance conforme, publication au journal d'annonces légales, carte professionnelle, documents à jour…). BakTaxi ne garantit ni la véracité ni la légalité des annonces.</p>
  <h2>7. Données personnelles</h2>
  <p>Le traitement des données est décrit dans la Politique de confidentialité.</p>
  <h2>8. Droit applicable</h2>
  <p>Les présentes CGU sont soumises au droit français.</p>`;
}
