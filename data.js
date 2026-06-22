/* ============================================================
   TAXILOC — Constantes métier
   (Les annonces proviennent de la base partagée Supabase ;
    aucune donnée personnelle réelle n'est stockée ici.)
   ============================================================ */

// Zones d'exercice (ADS)
const ZONES = [
  "Paris (75)",
  "Hauts-de-Seine (92)",
  "Seine-Saint-Denis (93)",
  "Val-de-Marne (94)",
  "Yvelines (78)",
  "Val-d'Oise (95)",
  "Seine-et-Marne (77)",
  "Province",
];

// Types d'annonces réels (déduits du terrain).
// Chaque type porte sa catégorie (OFFRE = je propose / RECHERCHE = je cherche).
const TYPES = {
  LOCATION: { label: "Location (véhicule + licence)", categorie: "OFFRE", vehicule: true, tarif: true, icon: "🚗" },
  LOCATION_GERANCE: { label: "Location-gérance", categorie: "OFFRE", vehicule: true, tarif: true, icon: "📄" },
  LICENCE_SEULE_OFFRE: { label: "Location licence seule (ADS)", categorie: "OFFRE", vehicule: false, tarif: true, icon: "🪪" },
  REMPLACEMENT: { label: "Remplacement — je me propose", categorie: "RECHERCHE", vehicule: false, tarif: false, icon: "🙋" },
  LICENCE_SEULE_RECHERCHE: { label: "Recherche location licence", categorie: "RECHERCHE", vehicule: false, tarif: false, icon: "🔎" },
  CHAUFFEUR: { label: "Recherche chauffeur (pour mon véhicule)", categorie: "RECHERCHE", vehicule: true, tarif: false, icon: "👤" },
  VENTE_LICENCE: { label: "Vente de licence ADS", categorie: "OFFRE", licence: true, vente: true, icon: "💰" },
  ACHAT_LICENCE: { label: "Recherche / achat de licence", categorie: "RECHERCHE", licence: true, icon: "🔎" },
  VENTE_MATERIEL: { label: "Vente de matériel (lumineux, TPE…)", categorie: "OFFRE", accessoire: true, vente: true, icon: "🔧" },
  RECHERCHE_MATERIEL: { label: "Recherche de matériel", categorie: "RECHERCHE", accessoire: true, icon: "🔧" },
};

const CARBURANTS = ["Diesel", "Hybride", "Électrique", "E85", "Essence"];
const CENTRALES = ["G7", "Taxis Bleus", "Alpha Taxis", "Autre", "Aucune"];
const TP_OPTIONS = ["Oui", "Non", "En cours"];
const ACCESSOIRES = ["Lumineux", "Taximètre", "Terminal CB (TPE)", "Imprimante", "Plaque / totem", "Compteur horokilométrique", "Autre"];
const ETATS = ["Neuf", "Très bon état", "Bon état", "Correct", "Pour pièces"];

// Modération : motifs bloqués (annonce hors usage pro)
const MODERATION_BLOCKLIST = [
  /https?:\/\//i,
  /www\./i,
  /\b\S+\.(com|net|org|io|fr|shop)\b/i,
  /\b(bitcoin|crypto|casino|loto|viagra|porn|sexe)\b/i,
];
