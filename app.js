/* ============================================================
   TAXI-LINK — Application (base partagée Supabase + temps réel)
   ============================================================ */

/* ---------- Clés de stockage local ---------- */
const LS_PROFIL = "taxilink.profil.v1";
const LS_OWNERS = "taxilink.owners.v1"; // { [annonceId]: jeton } -> mes annonces
const LS_CACHE = "taxilink.cache.v1";   // copie des annonces pour le mode hors-ligne

let state = {
  view: "annonces",
  annonces: [],
  profil: null,
  owners: {},
  online: false,
  loading: true,
  filtres: { categorie: "", type: "", zone: "", budgetMax: "", elec: false, tpmr: false, texte: "", tri: "recent" },
  detailId: null,
  formType: "LOCATION",
  revealed: new Set(), // ids des annonces dont on a affiché le numéro
  demandesRecues: [],  // [{annonce, demandes:[...]}] pour "Mon espace"
  demandeSent: new Set(), // ids d'annonces où j'ai déjà envoyé une demande
};

/* ---------- Utilitaires ---------- */
function uid() { return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function genToken() { return (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)); }
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const camelToSnake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

function fromDb(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  out.statut = "ACTIVE";
  return out;
}
function toDb(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[camelToSnake(k)] = v === "" ? null : v;
  }
  return out;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtEuro(n) { return Number(n).toLocaleString("fr-FR"); }
function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24); if (j < 31) return `il y a ${j} j`;
  return "le " + fmtDate(iso);
}
function toast(msg, kind = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = "toast"), 3000);
}
function dispoLabel(a) {
  if (a.dispoDebut && a.dispoFin) return `${fmtDate(a.dispoDebut)} → ${fmtDate(a.dispoFin)}`;
  if (a.dispoDebut) return `À partir du ${fmtDate(a.dispoDebut)}`;
  if (a.dispoImmediat) return "De suite";
  if (a.dispoTexte) return a.dispoTexte;
  if (a.longueDuree) return "Longue durée";
  return "Non précisée";
}
function tarifLabel(a) {
  if (a.tarifJour) return { val: fmtEuro(a.tarifJour) + " €", unit: "/ jour" };
  if (a.tarifMois) return { val: fmtEuro(a.tarifMois) + " €", unit: "/ mois" };
  if (a.tarifSemaine) return { val: fmtEuro(a.tarifSemaine) + " €", unit: "/ semaine" };
  return null;
}
function isUrgent(a) {
  if (a.dispoImmediat) return true;
  if (!a.dispoDebut) return false;
  const days = (new Date(a.dispoDebut) - new Date()) / 86400000;
  return days >= 0 && days <= 7;
}
const DUREE_VIE_JOURS = 30;
function isExpired(a) {
  const now = Date.now();
  if (a.dispoFin) {
    const f = new Date(a.dispoFin);
    if (!isNaN(f) && f.getTime() < now - 86400000) return true; // date de fin dépassée (>1 jour)
  }
  if (a.createdAt) {
    const c = new Date(a.createdAt);
    if (!isNaN(c) && now - c.getTime() > DUREE_VIE_JOURS * 86400000) return true; // publiée depuis +30 j
  }
  return false;
}

/* ---------- Modération ---------- */
function moderationCheck(texte) {
  const t = String(texte || "");
  const sansEmails = t.replace(/[\w.+-]+@[\w.-]+\.\w+/g, " ");
  for (const re of MODERATION_BLOCKLIST) {
    if (re.test(sansEmails)) return { ok: false, motif: "Lien externe ou contenu non professionnel détecté." };
  }
  return { ok: true };
}

/* ---------- Matching ---------- */
function matchScore(a) {
  const p = state.profil;
  if (!p) return null;
  let score = 0, max = 0;
  max += 40;
  if (p.zone && a.zone && p.zone === a.zone) score += 40;
  else if (p.zone && a.zone && (p.zone.includes("Paris") || a.zone.includes("Paris"))) score += 18;
  if (a.expMin) { max += 20; if (Number(p.experience) >= Number(a.expMin)) score += 20; }
  if (a.tpObligatoire) { max += 15; if (p.tp === "Oui") score += 15; else if (p.tp === "En cours") score += 7; }
  if (a.tpe === "REQUIS" || a.cbObligatoire) { max += 15; if (p.lectureCb) score += 15; }
  max += 10;
  if (isUrgent(a)) score += 10; else score += 5;
  if (max === 0) return 50;
  return Math.round((score / max) * 100);
}

/* ---------- Filtrage ---------- */
function filteredAnnonces() {
  const f = state.filtres;
  let list = state.annonces.filter((a) => a.statut !== "ARCHIVED" && !isExpired(a));
  if (f.categorie) list = list.filter((a) => TYPES[a.type] && TYPES[a.type].categorie === f.categorie);
  if (f.type) list = list.filter((a) => a.type === f.type);
  if (f.zone) list = list.filter((a) => a.zone === f.zone);
  if (f.elec) list = list.filter((a) => a.carburant === "Électrique");
  if (f.tpmr) list = list.filter((a) => a.tpmr);
  if (f.budgetMax) {
    const b = Number(f.budgetMax);
    list = list.filter((a) => { const j = a.tarifJour || (a.tarifMois ? a.tarifMois / 26 : null); return j == null || j <= b; });
  }
  if (f.texte) {
    const q = f.texte.toLowerCase();
    list = list.filter((a) =>
      [a.auteur, a.vehiculeModele, a.ville, a.conditions, TYPES[a.type] && TYPES[a.type].label]
        .filter(Boolean).join(" ").toLowerCase().includes(q));
  }
  const tri = state.filtres.tri || "recent";
  list.sort((x, y) => {
    if (tri === "match") {
      const sx = matchScore(x) ?? -1, sy = matchScore(y) ?? -1;
      if (sy !== sx) return sy - sx;
    }
    return new Date(y.createdAt) - new Date(x.createdAt); // plus récentes d'abord
  });
  return list;
}

/* ============================================================
   DONNÉES — Supabase + cache local
   ============================================================ */
function loadLocal() {
  try { state.profil = JSON.parse(localStorage.getItem(LS_PROFIL)) || null; } catch { state.profil = null; }
  try { state.owners = JSON.parse(localStorage.getItem(LS_OWNERS)) || {}; } catch { state.owners = {}; }
  try { state.annonces = JSON.parse(localStorage.getItem(LS_CACHE)) || []; } catch { state.annonces = []; }
}
function saveProfil() { localStorage.setItem(LS_PROFIL, JSON.stringify(state.profil)); }
function saveOwners() { localStorage.setItem(LS_OWNERS, JSON.stringify(state.owners)); }
function saveCache() { localStorage.setItem(LS_CACHE, JSON.stringify(state.annonces)); }

async function fetchAnnonces() {
  try {
    const { data, error } = await sb.from("annonces").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    state.annonces = data.map(fromDb);
    state.online = true;
    saveCache();
  } catch (e) {
    console.warn("Supabase indisponible, mode hors-ligne :", e.message || e);
    state.online = false;
  } finally {
    state.loading = false;
  }
}

function subscribeRealtime() {
  sb.channel("annonces-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "annonces" }, (payload) => {
      if (payload.eventType === "INSERT") {
        const a = fromDb(payload.new);
        if (!state.annonces.find((x) => x.id === a.id)) state.annonces.unshift(a);
      } else if (payload.eventType === "DELETE") {
        state.annonces = state.annonces.filter((x) => x.id !== payload.old.id);
      } else if (payload.eventType === "UPDATE") {
        const a = fromDb(payload.new);
        const i = state.annonces.findIndex((x) => x.id === a.id);
        if (i >= 0) state.annonces[i] = a;
      }
      saveCache();
      if (state.view === "annonces") renderListOnly();
      else if (state.view === "espace" || state.view === "detail") render();
    })
    .subscribe();
}

/* ============================================================
   RENDU DES VUES
   ============================================================ */
const App = () => document.getElementById("app");

function setView(v) {
  state.view = v;
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  render();
  window.scrollTo(0, 0);
  if (v === "espace") loadDemandes();
}

function render() {
  const el = App();
  if (state.view === "annonces") el.innerHTML = viewAnnonces();
  else if (state.view === "publier") el.innerHTML = viewPublier();
  else if (state.view === "espace") el.innerHTML = viewEspace();
  else if (state.view === "profil") el.innerHTML = viewProfil();
  else if (state.view === "detail") el.innerHTML = viewDetail();
  else if (state.view === "aide") el.innerHTML = viewLegal("Comment ça marche ?", aideHTML());
  else if (state.view === "mentions") el.innerHTML = viewLegal("Mentions légales", legalMentions());
  else if (state.view === "confidentialite") el.innerHTML = viewLegal("Politique de confidentialité", legalConfidentialite());
  else if (state.view === "cgu") el.innerHTML = viewLegal("Conditions générales d'utilisation", legalCgu());
  bindViewEvents();
}

function badgesFor(a) {
  const t = TYPES[a.type];
  const out = [];
  if (t) out.push(`<span class="badge ${t.categorie === "OFFRE" ? "badge-offre" : "badge-recherche"}">${t.categorie}</span>`);
  if (isUrgent(a)) out.push(`<span class="badge badge-urgent">Urgent</span>`);
  if (a.tpmr) out.push(`<span class="badge badge-tpmr">TPMR</span>`);
  if (a.carburant === "Électrique") out.push(`<span class="badge badge-elec">Électrique</span>`);
  if (isExpired(a)) out.push(`<span class="badge badge-expire">Expirée</span>`);
  if (state.owners[a.id]) out.push(`<span class="badge badge-match">Mon annonce</span>`);
  return out.join("");
}

function cardTitle(a) {
  const t = TYPES[a.type] || { label: a.type };
  if (a.accessoireType) return a.accessoireType;
  if (t.licence) return "Licence ADS" + (a.conventionne ? " conventionnée" : "");
  return a.vehiculeModele || (a.licenceSeule ? "Licence ADS seule" : t.label);
}
function priceHTML(a) {
  const tarif = tarifLabel(a);
  if (tarif) return `<span class="price">${tarif.val} <small>${tarif.unit}</small></span>`;
  if (a.prix) return `<span class="price">${fmtEuro(a.prix)} €</span>`;
  const t = TYPES[a.type] || {};
  return `<span class="card-sub">${t.categorie === "RECHERCHE" ? "Demande" : "Prix à discuter"}</span>`;
}

function cardHTML(a) {
  const t = TYPES[a.type] || { icon: "📌", label: a.type };
  const tarif = tarifLabel(a);
  const score = matchScore(a);
  const matchHTML = score != null
    ? `<div class="match"><span>Match ${score}%</span><div class="match-bar"><div class="match-fill" style="width:${score}%"></div></div></div>`
    : "";
  return `
  <div class="card" data-id="${a.id}">
    <div class="card-top">
      <span class="card-type">${t.icon} ${esc(t.label)}</span>
      <div class="badges">${badgesFor(a)}</div>
    </div>
    <h3 class="card-title">${esc(cardTitle(a))}</h3>
    <div class="card-sub">${esc(a.auteur)} • ${esc(a.zone || "Zone n.c.")}${a.ville ? " — " + esc(a.ville) : ""}</div>
    <div class="card-row">
      ${a.accessoireType && a.etat ? `<span>🏷️ ${esc(a.etat)}</span>` : ""}
      ${t.licence && a.conventionne != null ? `<span>📋 ${a.conventionne ? "Conventionnée" : "Non conventionnée"}</span>` : ""}
      ${a.places ? `<span>🪑 <b>${a.places}</b> places</span>` : ""}
      ${a.carburant ? `<span>⛽ ${esc(a.carburant)}</span>` : ""}
      ${a.centrale ? `<span>📻 ${esc(a.centrale)}</span>` : ""}
      <span>📅 ${esc(dispoLabel(a))}</span>
    </div>
    <div class="hint" style="font-size:11.5px">🕒 Publié ${esc(timeAgo(a.createdAt))}</div>
    <div class="card-foot">
      ${priceHTML(a)}
      ${matchHTML}
    </div>
  </div>`;
}

function viewAnnonces() {
  const list = filteredAnnonces();
  const f = state.filtres;
  const opt = (arr, sel) => arr.map((v) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  const typeOpts = Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${esc(v.label)}</option>`).join("");

  const status = state.loading
    ? `<div class="banner">⏳ <div>Chargement des annonces partagées…</div></div>`
    : state.online
      ? `<div class="banner" style="background:var(--green-bg);border-color:#bfe6cd;color:#176a39">🟢 <div><b>Connecté</b> — annonces partagées en temps réel. Les nouvelles annonces de tes collègues apparaissent automatiquement.</div></div>`
      : `<div class="banner warn">🔌 <div><b>Hors-ligne</b> — affichage de la dernière copie connue. Reconnecte-toi pour voir les nouveautés.</div></div>`;

  const banner = state.profil ? "" :
    `<div class="banner">ℹ️ <div>Renseigne ton <b>profil</b> pour un <b>score de compatibilité</b> et un tri pertinent. <button class="btn btn-sm btn-navy" data-go="profil">Compléter mon profil</button></div></div>`;

  return `
  <div class="section-head">
    <div><h1>Annonces</h1><p class="subtitle">${list.length} annonce(s) — location, gérance, licence, remplacement.</p></div>
    <button class="btn btn-primary" data-go="publier">＋ Publier une annonce</button>
  </div>
  ${status}
  ${banner}
  <div class="filters">
    <div class="field"><label>Recherche</label><input id="f-texte" placeholder="Modèle, ville, auteur…" value="${esc(f.texte)}" /></div>
    <div class="field"><label>Catégorie</label><select id="f-cat"><option value="">Toutes</option><option value="OFFRE" ${f.categorie === "OFFRE" ? "selected" : ""}>Offres</option><option value="RECHERCHE" ${f.categorie === "RECHERCHE" ? "selected" : ""}>Recherches</option></select></div>
    <div class="field"><label>Type</label><select id="f-type"><option value="">Tous</option>${typeOpts}</select></div>
    <div class="field"><label>Zone</label><select id="f-zone"><option value="">Toutes</option>${opt(ZONES, f.zone)}</select></div>
    <div class="field"><label>Budget max €/jour</label><input id="f-budget" type="number" min="0" placeholder="ex. 90" value="${esc(f.budgetMax)}" /></div>
    <div class="field check-inline"><input type="checkbox" id="f-elec" ${f.elec ? "checked" : ""} /><label for="f-elec">Électrique</label></div>
    <div class="field check-inline"><input type="checkbox" id="f-tpmr" ${f.tpmr ? "checked" : ""} /><label for="f-tpmr">TPMR / PMR</label></div>
    <div class="field"><label>Trier</label><select id="f-tri"><option value="recent" ${f.tri === "recent" ? "selected" : ""}>Plus récentes</option><option value="match" ${f.tri === "match" ? "selected" : ""}>Compatibilité</option></select></div>
    <div class="field"><button class="btn btn-ghost" id="f-reset">Réinitialiser</button></div>
  </div>
  ${list.length ? `<div class="grid">${list.map(cardHTML).join("")}</div>` : `<div class="empty">${state.loading ? "Chargement…" : "Aucune annonce ne correspond à ces filtres."}</div>`}
  `;
}

function viewDetail() {
  const a = state.annonces.find((x) => x.id === state.detailId);
  if (!a) return `<div class="empty">Annonce introuvable.</div>`;
  const t = TYPES[a.type] || { icon: "📌", label: a.type, categorie: "" };
  const rows = [];
  const add = (k, v) => { if (v) rows.push(`<dt>${k}</dt><dd>${v}</dd>`); };
  add("Type", `${t.icon} ${esc(t.label)}`);
  add("Auteur", esc(a.auteur));
  add("Zone", esc(a.zone));
  add("Ville / base", esc(a.ville));
  add("Véhicule", esc(a.vehiculeModele));
  add("Places", a.places ? esc(a.places) : "");
  add("Carburant", esc(a.carburant));
  add("Équipement", [a.tpmr ? "Rampe TPMR" : "", a.tpe === "FOURNI" ? "TPE fourni" : a.tpe === "REQUIS" ? "TPE requis" : ""].filter(Boolean).join(" • "));
  add("Centrale", esc(a.centrale));
  add("Disponibilité", esc(dispoLabel(a)));
  if (a.tarifJour) add("Loyer / jour", fmtEuro(a.tarifJour) + " €" + (a.htTtc ? " " + a.htTtc : ""));
  if (a.tarifSemaine) add("Loyer / semaine", fmtEuro(a.tarifSemaine) + " €");
  if (a.tarifMois) add("Loyer / mois", fmtEuro(a.tarifMois) + " €" + (a.htTtc ? " " + a.htTtc : ""));
  if (a.tvaRecuperable) add("TVA", "Récupérable");
  if (a.cautionMontant) add("Caution", fmtEuro(a.cautionMontant) + " €" + (a.cautionEncaissee === true ? " (encaissée)" : a.cautionEncaissee === false ? " (non encaissée)" : ""));
  add("Assurance", a.assuranceIncluse ? "Incluse" : "");
  if (a.prix) add("Prix de vente", fmtEuro(a.prix) + " €");
  if (a.conventionne != null) add("Licence conventionnée", a.conventionne ? "Oui" : "Non");
  if (a.societeIncluse) add("Société incluse", "Oui (clé en main)");
  if (a.creditVendeur != null) add("Crédit vendeur", a.creditVendeur ? "Oui" : "Non");
  add("Type de matériel", esc(a.accessoireType));
  add("État", esc(a.etat));
  if (a.annee) add("Année véhicule", esc(a.annee));
  if (a.kilometrage) add("Kilométrage", fmtEuro(a.kilometrage) + " km");
  if (a.siteWeb) {
    const url = a.siteWeb.startsWith("http") ? a.siteWeb : "https://" + a.siteWeb;
    rows.push(`<dt>Site web</dt><dd><a href="${esc(url)}" target="_blank" rel="noopener">${esc(a.siteWeb)}</a></dd>`);
  }
  add("Publié le", fmtDate(a.createdAt));

  const score = matchScore(a);
  const scoreHTML = score != null
    ? `<div class="match" style="margin-top:14px"><span>Compatibilité ${score}%</span><div class="match-bar"><div class="match-fill" style="width:${score}%"></div></div></div>`
    : `<p class="hint" style="margin-top:14px">Complète ton profil pour estimer la compatibilité.</p>`;

  return `
  <button class="back-link" data-go="annonces">← Retour aux annonces</button>
  <div class="detail">
    <div class="panel">
      <div class="badges" style="margin-bottom:10px">${badgesFor(a)}</div>
      <h1>${esc(cardTitle(a))}</h1>
      <p class="subtitle">${esc(t.label)} — ${esc(a.zone || "")}</p>
      <dl class="dl">${rows.join("")}</dl>
      ${a.conditions ? `<hr class="divider"/><h2>Conditions & exigences</h2><p>${esc(a.conditions)}</p>` : ""}
      <hr class="divider"/>
      <a class="hint" style="color:var(--red);text-decoration:none" href="mailto:${esc(EDITEUR.email)}?subject=${encodeURIComponent("Signalement annonce Taxiloc")}&body=${encodeURIComponent("Je signale l'annonce " + a.id + " (" + (a.auteur || "") + "). Motif : ")}">🚩 Signaler cette annonce</a>
    </div>
    <aside>
      <div class="contact-card">
        ${a.telVisible
          ? `<h3>📞 Contacter</h3>
             ${state.revealed.has(a.id)
               ? `<div class="contact-big"><a href="tel:${esc((a.telephone || "").replace(/\s/g, ""))}">${esc(a.telephone)}</a></div>
                  ${a.email ? `<p style="margin:10px 0 0"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>` : ""}`
               : `<button class="btn btn-primary" data-reveal="${a.id}" style="width:100%">📞 Afficher le numéro</button>`}`
          : state.demandeSent.has(a.id)
            ? `<h3>✅ Demande envoyée</h3><p class="hint" style="color:#cdd7e6">Le chauffeur a reçu tes coordonnées, il te rappellera. Tu peux fermer cette fiche.</p>`
            : `<h3>✋ Laisser une demande</h3>
               <p class="hint" style="color:#cdd7e6;margin-bottom:10px">Ce chauffeur préfère rappeler lui-même. Laisse tes coordonnées 👇</p>
               <form id="demande-form" data-annonce="${a.id}">
                 <input name="nom" placeholder="Ton nom *" required style="width:100%;margin-bottom:8px;border:none;border-radius:9px;padding:10px 11px" />
                 <input name="telephone" placeholder="Ton téléphone *" required style="width:100%;margin-bottom:8px;border:none;border-radius:9px;padding:10px 11px" />
                 <textarea name="message" placeholder="Ton message (dates, besoin…)" style="width:100%;margin-bottom:8px;border:none;border-radius:9px;padding:10px 11px;min-height:64px;resize:vertical"></textarea>
                 <button type="submit" class="btn btn-primary" style="width:100%">Envoyer ma demande</button>
               </form>`}
        ${scoreHTML}
        <p class="hint" style="color:#cdd7e6;margin-top:14px">Échange entre professionnels. Vérifie la licence ADS et les documents avant tout accord.</p>
      </div>
    </aside>
  </div>`;
}

function viewPublier() {
  const ty = state.formType;
  const def = TYPES[ty];
  const typeBtns = Object.entries(TYPES).map(([k, t]) =>
    `<button type="button" class="btn btn-sm ${k === ty ? "btn-primary" : "btn-ghost"}" data-settype="${k}">${t.icon} ${esc(t.label)}</button>`).join("");

  return `
  <div class="section-head"><div><h1>Publier une annonce</h1><p class="subtitle">Visible par tous les chauffeurs, en temps réel.</p></div></div>
  <div class="banner warn">⚠️ <div>Outil <b>strictement professionnel</b> : location, gérance, licence, remplacement, matériel. Les liens externes et contenus hors usage sont refusés automatiquement.</div></div>
  ${(def.licence || ty === "LOCATION" || ty === "LOCATION_GERANCE" || ty === "LICENCE_SEULE_OFFRE" || ty === "LICENCE_SEULE_RECHERCHE") ? `<div class="banner warn">⚖️ <div><b>Rappel légal :</b> ${DISCLAIMER_TAXI}</div></div>` : ""}
  <div class="panel">
    <div class="field full"><label>Type d'annonce</label><div class="badges" style="gap:8px">${typeBtns}</div></div>
    <hr class="divider" />
    <form id="annonce-form" class="form-grid">
      <div class="field"><label>Catégorie</label><input value="${def.categorie === "OFFRE" ? "OFFRE — je propose" : "RECHERCHE — je cherche"}" disabled /></div>
      <div class="field"><label>Nom / Société *</label><input name="auteur" required /></div>
      <div class="field"><label>Téléphone *</label><input name="telephone" required placeholder="06 12 34 56 78" /></div>
      <div class="field"><label>E-mail (optionnel)</label><input name="email" type="email" /></div>
      <div class="field full"><label>Mon numéro de téléphone</label><select name="telVisible"><option value="false">🔒 Masqué — je reçois des demandes de contact (recommandé)</option><option value="true">👁️ Visible — afficher mon numéro sur l'annonce</option></select><div class="hint">Masqué : ton numéro n'apparaît pas ; les intéressés te laissent leurs coordonnées et tu les rappelles.</div></div>
      <div class="field"><label>Zone d'exercice *</label><select name="zone" required>${ZONES.map((z) => `<option>${esc(z)}</option>`).join("")}</select></div>
      <div class="field"><label>Ville / base</label><input name="ville" /></div>
      ${def.vehicule ? `
      <div class="field"><label>Véhicule (marque / modèle)</label><input name="vehiculeModele" /></div>
      <div class="field"><label>Places</label><input name="places" type="number" min="1" max="9" /></div>
      <div class="field"><label>Carburant</label><select name="carburant"><option value="">—</option>${CARBURANTS.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label>TPE (terminal CB)</label><select name="tpe"><option value="">—</option><option value="FOURNI">Fourni</option><option value="REQUIS">Requis du locataire</option></select></div>
      <div class="field check-inline"><input type="checkbox" name="tpmr" /><label>Rampe TPMR / PMR</label></div>
      <div class="field check-inline"><input type="checkbox" name="assuranceIncluse" /><label>Assurance incluse</label></div>
      ` : (ty === "LICENCE_SEULE_OFFRE" || ty === "LICENCE_SEULE_RECHERCHE") ? `
      <div class="field check-inline full"><input type="checkbox" name="licenceSeule" checked /><label>Licence ADS seule (sans véhicule)</label></div>` : ""}

      ${def.licence ? `
      <div class="field"><label>Licence conventionnée ?</label><select name="conventionne"><option value="">—</option><option value="true">Oui</option><option value="false">Non</option></select></div>
      ${def.vente ? `
      <div class="field check-inline"><input type="checkbox" name="societeIncluse" /><label>Société incluse (SASU clé en main)</label></div>
      <div class="field"><label>Crédit vendeur ?</label><select name="creditVendeur"><option value="">—</option><option value="true">Oui</option><option value="false">Non</option></select></div>
      <div class="field"><label>Véhicule inclus (modèle)</label><input name="vehiculeModele" placeholder="optionnel" /></div>
      <div class="field"><label>Année du véhicule</label><input name="annee" type="number" min="1990" max="2030" /></div>
      <div class="field"><label>Kilométrage</label><input name="kilometrage" type="number" min="0" /></div>
      <div class="field full"><label>Site web (optionnel)</label><input name="siteWeb" placeholder="ex. mon-site.com" /><div class="hint">Seul ce champ autorise une adresse web.</div></div>` : ""}` : ""}

      ${def.accessoire ? `
      <div class="field"><label>Type de matériel</label><select name="accessoireType"><option value="">—</option>${ACCESSOIRES.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
      ${def.vente ? `<div class="field"><label>État</label><select name="etat"><option value="">—</option>${ETATS.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>` : ""}` : ""}

      ${def.vente ? `<div class="field"><label>Prix de vente (€)</label><input name="prix" type="number" min="0" /></div>` : ""}

      ${(def.vehicule || def.tarif) ? `<div class="field"><label>Centrale / Radio</label><select name="centrale"><option value="">—</option>${CENTRALES.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>` : ""}
      ${def.tarif ? `
      <div class="field"><label>Loyer / jour (€)</label><input name="tarifJour" type="number" min="0" /></div>
      <div class="field"><label>Loyer / semaine (€)</label><input name="tarifSemaine" type="number" min="0" /></div>
      <div class="field"><label>Loyer / mois (€)</label><input name="tarifMois" type="number" min="0" /></div>
      <div class="field"><label>HT / TTC</label><select name="htTtc"><option value="">—</option><option>HT</option><option>TTC</option></select></div>
      <div class="field"><label>Caution (€)</label><input name="cautionMontant" type="number" min="0" /></div>
      <div class="field"><label>Caution encaissée ?</label><select name="cautionEncaissee"><option value="">—</option><option value="true">Oui, encaissée</option><option value="false">Non encaissée</option></select></div>
      ` : ""}
      <div class="field"><label>Disponible à partir du</label><input name="dispoDebut" type="date" /></div>
      <div class="field"><label>Jusqu'au</label><input name="dispoFin" type="date" /></div>
      <div class="field check-inline"><input type="checkbox" name="dispoImmediat" /><label>De suite</label></div>
      <div class="field check-inline"><input type="checkbox" name="longueDuree" /><label>Longue durée</label></div>
      <div class="field full"><label>Disponibilité (texte libre)</label><input name="dispoTexte" placeholder="ex. week-ends, jours de repos…" /></div>
      ${(def.vehicule || def.tarif) ? `
      <hr class="divider full" />
      <div class="field full"><label>Exigences sur le candidat</label></div>
      <div class="field"><label>Expérience min. (années)</label><input name="expMin" type="number" min="0" /></div>
      <div class="field check-inline"><input type="checkbox" name="tpObligatoire" /><label>TP (Titre Pro) obligatoire</label></div>
      <div class="field check-inline"><input type="checkbox" name="cbObligatoire" /><label>Lecture carte bleue exigée</label></div>` : ""}
      <div class="field full"><label>Conditions & documents</label><textarea name="conditions" placeholder="Caution, documents à jour, carte pro, état du véhicule…"></textarea><div class="hint">Pas de liens externes ni de contenu hors usage professionnel.</div></div>
      <div class="full error-text" id="form-error"></div>
      <div class="form-actions full">
        <button type="submit" class="btn btn-primary" id="submit-btn">Publier l'annonce</button>
      </div>
    </form>
  </div>`;
}

function viewEspace() {
  const mine = state.annonces.filter((a) => state.owners[a.id]);
  const all = state.annonces.filter((a) => a.statut !== "ARCHIVED" && !isExpired(a));
  const offres = all.filter((a) => TYPES[a.type] && TYPES[a.type].categorie === "OFFRE").length;
  const rech = all.length - offres;

  const mineHTML = mine.length
    ? `<div class="grid">${mine.map((a) => `
        <div class="card" data-id="${a.id}">
          <div class="card-top"><span class="card-type">${(TYPES[a.type] || {}).icon || "📌"} ${esc((TYPES[a.type] || {}).label || a.type)}</span><div class="badges">${badgesFor(a)}</div></div>
          <h3 class="card-title">${esc(a.vehiculeModele || (TYPES[a.type] || {}).label || a.type)}</h3>
          <div class="card-sub">Publié le ${fmtDate(a.createdAt)}</div>
          <div class="form-actions" style="margin-top:6px">
            <button class="btn btn-sm btn-danger" data-del="${a.id}">🗑 Supprimer</button>
          </div>
        </div>`).join("")}</div>`
    : `<div class="empty">Tu n'as pas encore publié d'annonce. <br/><button class="btn btn-primary btn-sm" data-go="publier" style="margin-top:10px">Publier une annonce</button></div>`;

  return `
  <div class="section-head"><div><h1>Mon espace</h1><p class="subtitle">Tes annonces et l'activité du réseau.</p></div></div>
  <div class="stats">
    <div class="stat"><div class="n">${all.length}</div><div class="l">Annonces partagées</div></div>
    <div class="stat"><div class="n">${offres}</div><div class="l">Offres</div></div>
    <div class="stat"><div class="n">${rech}</div><div class="l">Recherches</div></div>
    <div class="stat"><div class="n">${mine.length}</div><div class="l">Mes annonces</div></div>
  </div>
  <h2>Mes annonces</h2>
  ${mineHTML}
  <h2 style="margin-top:26px">📥 Demandes reçues</h2>
  ${demandesBlock()}`;
}

function demandesBlock() {
  if (!state.demandesRecues.length) {
    return `<div class="empty">Aucune demande pour l'instant. Quand quelqu'un laisse une demande de contact sur une de tes annonces, elle apparaît ici.<br/><span class="hint">(Visible uniquement sur l'appareil où tu as publié l'annonce.)</span></div>`;
  }
  return state.demandesRecues.map((g) => `
    <div class="panel" style="margin-bottom:12px">
      <div style="font-weight:800;color:var(--navy);margin-bottom:6px">${esc(g.annonce.vehiculeModele || (TYPES[g.annonce.type] || {}).label || g.annonce.type)} — ${g.demandes.length} demande(s)</div>
      ${g.demandes.map((d) => `
        <div style="border-top:1px solid var(--line);padding:9px 0">
          <span style="font-weight:700">${esc(d.nom)}</span> · <a href="tel:${esc((d.telephone || "").replace(/\s/g, ""))}" style="color:var(--blue);font-weight:700;text-decoration:none">${esc(d.telephone)}</a>
          ${d.message ? `<div class="card-sub" style="margin-top:2px">${esc(d.message)}</div>` : ""}
          <div class="hint">${fmtDate(d.created_at)}</div>
        </div>`).join("")}
    </div>`).join("");
}

function viewProfil() {
  const p = state.profil || {};
  const v = (k, d = "") => (p[k] != null ? p[k] : d);
  return `
  <div class="section-head"><div><h1>Mon profil</h1><p class="subtitle">Profil = annonces mieux ciblées (il reste privé sur ton téléphone).</p></div></div>
  <div class="panel">
    <form id="profil-form" class="form-grid">
      <div class="field"><label>Prénom *</label><input name="prenom" required value="${esc(v("prenom"))}" /></div>
      <div class="field"><label>Nom *</label><input name="nom" required value="${esc(v("nom"))}" /></div>
      <div class="field"><label>N° licence ADS *</label><input name="licenceAds" required value="${esc(v("licenceAds"))}" /></div>
      <div class="field"><label>Téléphone pro *</label><input name="telephone" required value="${esc(v("telephone"))}" /></div>
      <div class="field"><label>Zone d'exercice *</label><select name="zone" required>${ZONES.map((z) => `<option ${z === v("zone") ? "selected" : ""}>${esc(z)}</option>`).join("")}</select></div>
      <div class="field"><label>Expérience (années) *</label><input name="experience" type="number" min="0" required value="${esc(v("experience"))}" /></div>
      <div class="field"><label>TP (Titre Professionnel) *</label><select name="tp" required>${TP_OPTIONS.map((o) => `<option ${o === v("tp") ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>
      <div class="field check-inline"><input type="checkbox" name="lectureCb" ${v("lectureCb") ? "checked" : ""} /><label>Lecture carte bleue (TPE)</label></div>
      <div class="field"><label>Centrale / Radio</label><select name="centrale"><option value="">—</option>${CENTRALES.map((c) => `<option ${c === v("centrale") ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label>Type de permis</label><input name="permisType" placeholder="B" value="${esc(v("permisType", "B"))}" /></div>
      <div class="form-actions full"><button type="submit" class="btn btn-primary">Enregistrer mon profil</button></div>
    </form>
  </div>`;
}

/* ============================================================
   ÉVÉNEMENTS
   ============================================================ */
function aideHTML() {
  return `
  <p class="subtitle">Taxiloc met en relation les chauffeurs de taxi entre eux. Voici comment l'utiliser en 1 minute.</p>
  <h2>1. Parcourir les annonces</h2>
  <p>Onglet <b>Annonces</b> : filtre par type (location, gérance, licence, remplacement, matériel…), zone, budget, dates. Les plus récentes sont en haut.</p>
  <h2>2. Publier une annonce</h2>
  <p>Bouton <b>＋ Publier</b> → choisis le <b>type</b> → remplis → valide. Elle apparaît aussitôt chez tous les chauffeurs, en temps réel.</p>
  <h2>3. Protéger ton numéro</h2>
  <p>À la publication, choisis <b>« Masqué »</b> : ton numéro n'apparaît pas. Les intéressés laissent leurs coordonnées (formulaire), et tu les retrouves dans <b>Mon espace → Demandes reçues</b> pour les rappeler.</p>
  <h2>4. Ton profil</h2>
  <p>Remplis ton <b>profil</b> (zone, expérience, TP, CB) : les annonces s'affichent alors avec un <b>score de compatibilité</b> adapté à toi. Il reste privé sur ton téléphone.</p>
  <h2>5. Les règles</h2>
  <p>Outil <b>strictement professionnel</b> (taxi). Pas de liens externes ni de contenu hors sujet. Rappel : la location simple est interdite — voir les <a href="#" data-go="cgu">CGU</a>.</p>
  <h2>6. Signaler</h2>
  <p>Une annonce abusive ? Le bouton <b>🚩 Signaler</b> est sur chaque fiche.</p>
  <h2>7. L'installer comme une appli</h2>
  <p>Menu de ton navigateur → <b>« Ajouter à l'écran d'accueil »</b> : tu auras l'icône Taxiloc, en plein écran.</p>`;
}

function viewLegal(title, body) {
  return `
  <button class="back-link" data-go="annonces">← Retour aux annonces</button>
  <div class="panel" style="max-width:760px">
    <h1>${esc(title)}</h1>
    ${body}
  </div>`;
}

function bindViewEvents() {
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); setView(b.dataset.go); }));
  document.querySelectorAll(".card[data-id]").forEach((c) =>
    c.addEventListener("click", (e) => { if (e.target.closest("[data-del]")) return; state.detailId = c.dataset.id; setView("detail"); }));

  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("input", fn); };
  bind("f-texte", (e) => { state.filtres.texte = e.target.value; renderListOnly(); });
  bind("f-cat", (e) => { state.filtres.categorie = e.target.value; renderListOnly(); });
  bind("f-type", (e) => { state.filtres.type = e.target.value; renderListOnly(); });
  bind("f-zone", (e) => { state.filtres.zone = e.target.value; renderListOnly(); });
  bind("f-budget", (e) => { state.filtres.budgetMax = e.target.value; renderListOnly(); });
  bind("f-elec", (e) => { state.filtres.elec = e.target.checked; renderListOnly(); });
  bind("f-tpmr", (e) => { state.filtres.tpmr = e.target.checked; renderListOnly(); });
  bind("f-tri", (e) => { state.filtres.tri = e.target.value; renderListOnly(); });
  const reset = document.getElementById("f-reset");
  if (reset) reset.addEventListener("click", () => { state.filtres = { categorie: "", type: "", zone: "", budgetMax: "", elec: false, tpmr: false, texte: "", tri: "recent" }; render(); });

  document.querySelectorAll("[data-settype]").forEach((b) => b.addEventListener("click", () => { state.formType = b.dataset.settype; render(); }));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => onDelete(b.dataset.del)));
  document.querySelectorAll("[data-reveal]").forEach((b) => b.addEventListener("click", () => { state.revealed.add(b.dataset.reveal); render(); }));
  const df = document.getElementById("demande-form");
  if (df) df.addEventListener("submit", onSubmitDemande);

  const af = document.getElementById("annonce-form");
  if (af) af.addEventListener("submit", onSubmitAnnonce);
  const pf = document.getElementById("profil-form");
  if (pf) pf.addEventListener("submit", onSubmitProfil);
}

function renderListOnly() {
  const grid = document.querySelector(".grid");
  const empty = document.querySelector(".empty");
  const list = filteredAnnonces();
  const html = list.length ? list.map(cardHTML).join("") : "";
  if (list.length) {
    if (grid) grid.innerHTML = html;
    else if (empty) empty.outerHTML = `<div class="grid">${html}</div>`;
  } else {
    if (grid) grid.outerHTML = `<div class="empty">Aucune annonce ne correspond à ces filtres.</div>`;
    else if (empty) empty.textContent = "Aucune annonce ne correspond à ces filtres.";
  }
  document.querySelectorAll(".card[data-id]").forEach((c) =>
    c.addEventListener("click", (e) => { if (e.target.closest("[data-del]")) return; state.detailId = c.dataset.id; setView("detail"); }));
  const sub = document.querySelector(".section-head .subtitle");
  if (sub) sub.textContent = `${list.length} annonce(s) — location, gérance, licence, remplacement.`;
}

async function onSubmitAnnonce(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const errEl = document.getElementById("form-error");
  errEl.textContent = "";
  const btn = document.getElementById("submit-btn");

  const conditions = fd.get("conditions");
  const mod = moderationCheck((conditions || "") + " " + (fd.get("vehiculeModele") || ""));
  if (!mod.ok) { errEl.textContent = "⛔ " + mod.motif + " Annonce refusée."; toast("Annonce refusée par la modération", "err"); return; }

  const num = (k) => { const x = fd.get(k); return x !== "" && x != null ? Number(x) : undefined; };
  const bool = (k) => fd.get(k) === "on";
  const triBool = (k) => { const x = fd.get(k); return x === "true" ? true : x === "false" ? false : undefined; };
  const token = genToken();
  const telVisible = fd.get("telVisible") === "true";
  const phone = fd.get("telephone")?.trim();

  const data = {
    type: state.formType,
    auteur: fd.get("auteur")?.trim(),
    telVisible,
    telephone: telVisible ? phone : undefined, // masqué => non stocké en base (contact via demande)
    email: telVisible ? (fd.get("email")?.trim() || undefined) : undefined,
    zone: fd.get("zone"),
    ville: fd.get("ville")?.trim() || undefined,
    vehiculeModele: fd.get("vehiculeModele")?.trim() || undefined,
    places: num("places"),
    carburant: fd.get("carburant") || undefined,
    tpe: fd.get("tpe") || undefined,
    tpmr: bool("tpmr"),
    assuranceIncluse: bool("assuranceIncluse"),
    licenceSeule: bool("licenceSeule"),
    centrale: fd.get("centrale") || undefined,
    tarifJour: num("tarifJour"), tarifSemaine: num("tarifSemaine"), tarifMois: num("tarifMois"),
    htTtc: fd.get("htTtc") || undefined,
    cautionMontant: num("cautionMontant"), cautionEncaissee: triBool("cautionEncaissee"),
    dispoDebut: fd.get("dispoDebut") || undefined, dispoFin: fd.get("dispoFin") || undefined,
    dispoImmediat: bool("dispoImmediat"), longueDuree: bool("longueDuree"),
    dispoTexte: fd.get("dispoTexte")?.trim() || undefined,
    expMin: num("expMin"), tpObligatoire: bool("tpObligatoire"), cbObligatoire: bool("cbObligatoire"),
    prix: num("prix"),
    conventionne: triBool("conventionne"),
    societeIncluse: bool("societeIncluse"),
    creditVendeur: triBool("creditVendeur"),
    siteWeb: fd.get("siteWeb")?.trim() || undefined,
    accessoireType: fd.get("accessoireType") || undefined,
    etat: fd.get("etat") || undefined,
    annee: num("annee"), kilometrage: num("kilometrage"),
    conditions: conditions?.trim() || undefined,
  };
  if (!data.auteur || !phone) { errEl.textContent = "Nom et téléphone sont obligatoires."; return; }

  if (btn) { btn.disabled = true; btn.textContent = "Publication…"; }
  try {
    const { data: rows, error } = await sb.from("annonces").insert(toDb(data)).select();
    if (error) throw error;
    const created = fromDb(rows[0]);
    // jeton propriétaire stocké dans une table à lecture interdite (jamais exposé via l'API)
    const { error: e2 } = await sb.from("annonce_secrets").insert({ annonce_id: created.id, owner_token: token });
    if (e2) console.warn("annonce_secrets:", e2.message);
    state.owners[created.id] = token; saveOwners();
    if (!state.annonces.find((x) => x.id === created.id)) state.annonces.unshift(created);
    saveCache();
    toast("Annonce publiée ✓ — visible par tous", "ok");
    setView("espace");
  } catch (err) {
    console.error(err);
    errEl.textContent = "Échec de la publication : " + (err.message || "réseau indisponible") + ". Réessaie.";
    if (btn) { btn.disabled = false; btn.textContent = "Publier l'annonce"; }
  }
}

async function onDelete(id) {
  if (!confirm("Supprimer cette annonce ?")) return;
  const token = state.owners[id];
  if (!token) { toast("Tu ne peux supprimer que tes propres annonces", "err"); return; }
  try {
    const { error } = await sb.rpc("delete_own_annonce", { p_id: id, p_token: token });
    if (error) throw error;
    state.annonces = state.annonces.filter((a) => a.id !== id);
    delete state.owners[id]; saveOwners(); saveCache();
    toast("Annonce supprimée", "ok");
    render();
  } catch (err) {
    console.error(err);
    toast("Échec de la suppression : " + (err.message || "réseau"), "err");
  }
}

async function onSubmitDemande(e) {
  e.preventDefault();
  const form = e.target;
  const annonceId = form.dataset.annonce;
  const fd = new FormData(form);
  const nom = fd.get("nom")?.trim();
  const telephone = fd.get("telephone")?.trim();
  const message = fd.get("message")?.trim() || null;
  if (!nom || !telephone) { toast("Nom et téléphone obligatoires", "err"); return; }
  const btn = form.querySelector("button[type=submit]");
  if (btn) { btn.disabled = true; btn.textContent = "Envoi…"; }
  try {
    const { error } = await sb.from("demandes").insert({ annonce_id: annonceId, nom, telephone, message });
    if (error) throw error;
    state.demandeSent.add(annonceId);
    toast("Demande envoyée ✓ — le chauffeur te rappellera", "ok");
    render();
  } catch (err) {
    console.error(err);
    toast("Échec de l'envoi : " + (err.message || "réseau"), "err");
    if (btn) { btn.disabled = false; btn.textContent = "Envoyer ma demande"; }
  }
}

async function loadDemandes() {
  const mine = state.annonces.filter((a) => state.owners[a.id]);
  const out = [];
  for (const a of mine) {
    try {
      const { data, error } = await sb.rpc("get_demandes_for_annonce", { p_annonce_id: a.id, p_token: state.owners[a.id] });
      if (!error && data && data.length) out.push({ annonce: a, demandes: data });
    } catch (e) { /* ignore */ }
  }
  state.demandesRecues = out;
  if (state.view === "espace") render();
}

function onSubmitProfil(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  state.profil = {
    prenom: fd.get("prenom")?.trim(), nom: fd.get("nom")?.trim(),
    licenceAds: fd.get("licenceAds")?.trim(), telephone: fd.get("telephone")?.trim(),
    zone: fd.get("zone"), experience: Number(fd.get("experience")) || 0,
    tp: fd.get("tp"), lectureCb: fd.get("lectureCb") === "on",
    centrale: fd.get("centrale") || undefined, permisType: fd.get("permisType")?.trim() || "B",
  };
  saveProfil();
  toast("Profil enregistré ✓ — annonces triées par compatibilité", "ok");
  setView("annonces");
}

/* ---------- Init ---------- */
const navEl = document.getElementById("nav");
const navToggle = document.getElementById("nav-toggle");
function closeMenu() { if (navEl) navEl.classList.remove("open"); if (navToggle) navToggle.setAttribute("aria-expanded", "false"); }
if (navToggle) navToggle.addEventListener("click", () => {
  const open = navEl.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", open ? "true" : "false");
});
document.getElementById("brand").addEventListener("click", () => { setView("annonces"); closeMenu(); });
document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => { setView(b.dataset.view); closeMenu(); }));

(async function init() {
  loadLocal();
  setView("annonces");      // affiche tout de suite (cache éventuel)
  await fetchAnnonces();    // récupère les annonces partagées
  if (state.view === "annonces") render();
  subscribeRealtime();      // écoute les nouveautés en direct
})();
