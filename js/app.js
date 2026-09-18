const CATEGORIES = ["Haut", "Bas", "Robe", "Veste/Manteau", "Chaussures", "Accessoire", "Autre"];
const MOYENS_PAIEMENT = ["CB", "Espèces", "Autre"];
const STATUTS_VENTE = ["a_venir", "en_cours", "passee"];
const STATUT_LABEL = { a_venir: "À venir", en_cours: "En cours", passee: "Passée" };

let state = { tab: "dashboard", achats: [], ventes: [], parametres: {} };

function eur(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
function dateFr(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR");
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadAll() {
  state.achats = await DB.dbGetAll("achats");
  state.ventes = await DB.dbGetAll("ventes");
  const params = await DB.dbGetAll("parametres");
  state.parametres = Object.fromEntries(params.map((p) => [p.key, p.value]));
}

function achatById(id) {
  return state.achats.find((a) => a.id === id);
}

function venteAchat(vente) {
  return achatById(vente.achatId);
}

function marge(vente) {
  const a = venteAchat(vente);
  if (!a) return { montant: 0, pct: 0 };
  const cout = (a.prixAchat || 0) + (a.fraisPort || 0);
  const montant = (vente.prixVente || 0) - cout;
  const pct = cout > 0 ? (montant / cout) * 100 : 0;
  return { montant, pct };
}

function stockAchats() {
  const venduIds = new Set(state.ventes.filter((v) => v.statut === "passee").map((v) => v.achatId));
  return state.achats.filter((a) => !venduIds.has(a.id));
}

// ---------- Navigation ----------
const TABS = [
  { id: "dashboard", label: "Tableau de bord" },
  { id: "achats", label: "Achats" },
  { id: "ventes", label: "Ventes" },
  { id: "stock", label: "Stock" },
  { id: "export", label: "Export" },
  { id: "parametres", label: "Paramètres" },
];

function renderNav() {
  const nav = document.getElementById("nav");
  nav.innerHTML = TABS.map(
    (t) => `<div class="nav-item ${state.tab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</div>`
  ).join("");
  nav.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.tab = el.dataset.tab;
      render();
    });
  });
}

function render() {
  renderNav();
  const main = document.getElementById("main");
  if (state.tab === "dashboard") main.innerHTML = viewDashboard();
  else if (state.tab === "achats") main.innerHTML = viewAchats();
  else if (state.tab === "ventes") main.innerHTML = viewVentes();
  else if (state.tab === "stock") main.innerHTML = viewStock();
  else if (state.tab === "export") main.innerHTML = viewExport();
  else if (state.tab === "parametres") main.innerHTML = viewParametres();
  bindPageEvents();
}

// ---------- Dashboard ----------
function viewDashboard() {
  const stock = stockAchats();
  const valeurStock = stock.reduce((s, a) => s + (a.prixAchat || 0) + (a.fraisPort || 0), 0);
  const now = new Date();
  const ventesMois = state.ventes.filter((v) => {
    if (v.statut !== "passee" || !v.dateVente) return false;
    const d = new Date(v.dateVente);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const caMois = ventesMois.reduce((s, v) => s + (v.prixVente || 0), 0);
  const margeMois = ventesMois.reduce((s, v) => s + marge(v).montant, 0);
  const enAttente = state.ventes.filter((v) => v.statut !== "passee").length;

  return `
    <div class="page-title">Tableau de bord</div>
    <div class="page-sub">Vue d'ensemble de l'activité Café Rencontre</div>
    <div class="row">
      <div class="card kpi"><div class="label">Articles en stock</div><div class="value">${stock.length}</div></div>
      <div class="card kpi"><div class="label">Valeur du stock (achat)</div><div class="value">${eur(valeurStock)}</div></div>
      <div class="card kpi"><div class="label">Ventes ce mois</div><div class="value sage">${ventesMois.length}</div></div>
      <div class="card kpi"><div class="label">CA ce mois</div><div class="value">${eur(caMois)}</div></div>
      <div class="card kpi"><div class="label">Marge ce mois</div><div class="value ${margeMois >= 0 ? "sage" : "rust"}">${eur(margeMois)}</div></div>
      <div class="card kpi"><div class="label">Ventes en attente</div><div class="value">${enAttente}</div></div>
    </div>
  `;
}

// ---------- Achats ----------
function viewAchats(filter = "") {
  const rows = state.achats
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .filter((a) => !filter || `${a.article} ${a.marque} ${a.vendeurVinted}`.toLowerCase().includes(filter.toLowerCase()));
  const venduIds = new Set(state.ventes.filter((v) => v.statut === "passee").map((v) => v.achatId));

  return `
    <div class="page-title">Achats</div>
    <div class="page-sub">Fiches d'achat Vinted — chaque article a une référence unique</div>
    <div class="toolbar">
      <div class="search"><input id="achat-search" placeholder="Rechercher un article, une marque, un vendeur..." value="${esc(filter)}" style="width:280px"></div>
      <button class="btn" id="btn-new-achat">+ Nouvel achat</button>
    </div>
    ${
      rows.length === 0
        ? `<div class="card empty">Aucun achat enregistré pour l'instant.</div>`
        : `<table><thead><tr>
            <th>Référence</th><th>Date</th><th>Article</th><th>Marque</th><th>Catégorie</th>
            <th>Vendeur</th><th>Coût total</th><th>Statut</th><th></th>
          </tr></thead><tbody>
          ${rows
            .map((a) => {
              const cout = (a.prixAchat || 0) + (a.fraisPort || 0);
              const vendu = venduIds.has(a.id);
              return `<tr>
                <td>${esc(a.id)}</td><td>${dateFr(a.date)}</td><td>${esc(a.article)}</td>
                <td>${esc(a.marque) || "—"}</td><td>${esc(a.categorie)}</td><td>${esc(a.vendeurVinted) || "—"}</td>
                <td>${eur(cout)}</td>
                <td><span class="badge ${vendu ? "vendu" : "stock"}">${vendu ? "Vendu" : "En stock"}</span></td>
                <td><button class="btn secondary small" data-edit-achat="${a.id}">Modifier</button>
                    <button class="btn danger small" data-del-achat="${a.id}">Suppr.</button></td>
              </tr>`;
            })
            .join("")}
          </tbody></table>`
    }
  `;
}

function achatFormHtml(a) {
  const isEdit = !!a;
  a = a || { id: "", date: todayISO(), vendeurVinted: "", article: "", marque: "", categorie: CATEGORIES[0], taille: "", prixAchat: "", fraisPort: "", notes: "" };
  return `
    <div class="overlay" id="achat-overlay">
      <div class="modal">
        <h2>${isEdit ? "Modifier l'achat " + esc(a.id) : "Nouvel achat"}</h2>
        <div class="form-grid">
          <label>Date d'achat<input type="date" id="f-date" value="${a.date}"></label>
          <label>Vendeur Vinted<input type="text" id="f-vendeur" value="${esc(a.vendeurVinted)}" placeholder="pseudo"></label>
          <label class="full">Article<input type="text" id="f-article" value="${esc(a.article)}" placeholder="ex: Veste en jean Levi's"></label>
          <label>Marque<input type="text" id="f-marque" value="${esc(a.marque)}"></label>
          <label>Catégorie<select id="f-categorie">${CATEGORIES.map((c) => `<option ${a.categorie === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <label>Taille<input type="text" id="f-taille" value="${esc(a.taille)}"></label>
          <label>Prix d'achat (€)<input type="number" step="0.01" id="f-prixachat" value="${a.prixAchat}"></label>
          <label>Frais de port (€)<input type="number" step="0.01" id="f-frais" value="${a.fraisPort}"></label>
          <label class="full">Notes<textarea id="f-notes" rows="2">${esc(a.notes)}</textarea></label>
        </div>
        <div class="modal-actions">
          <button class="btn secondary" id="btn-cancel-achat">Annuler</button>
          <button class="btn" id="btn-save-achat">Enregistrer</button>
        </div>
      </div>
    </div>
  `;
}

async function saveAchatFromForm(existingId) {
  const val = (id) => document.getElementById(id).value;
  const achat = {
    id: existingId || (await DB.nextRef("ACH")),
    date: val("f-date"),
    vendeurVinted: val("f-vendeur").trim(),
    article: val("f-article").trim(),
    marque: val("f-marque").trim(),
    categorie: val("f-categorie"),
    taille: val("f-taille").trim(),
    prixAchat: parseFloat(val("f-prixachat")) || 0,
    fraisPort: parseFloat(val("f-frais")) || 0,
    notes: val("f-notes").trim(),
  };
  await DB.dbPut("achats", achat);
  await loadAll();
  document.getElementById("achat-overlay")?.remove();
  render();
}

// ---------- Ventes ----------
function viewVentes(filterStatut = "") {
  const rows = state.ventes
    .slice()
    .sort((a, b) => (b.dateVente || "").localeCompare(a.dateVente || ""))
    .filter((v) => !filterStatut || v.statut === filterStatut);

  return `
    <div class="page-title">Ventes</div>
    <div class="page-sub">Journal des ventes, reliées à leur fiche d'achat d'origine</div>
    <div class="toolbar">
      <div class="search">
        <select id="vente-filter">
          <option value="">Tous les statuts</option>
          ${STATUTS_VENTE.map((s) => `<option value="${s}" ${filterStatut === s ? "selected" : ""}>${STATUT_LABEL[s]}</option>`).join("")}
        </select>
      </div>
      <button class="btn" id="btn-new-vente" ${stockAchats().length === 0 ? "disabled title='Aucun article en stock'" : ""}>+ Nouvelle vente</button>
    </div>
    ${
      rows.length === 0
        ? `<div class="card empty">Aucune vente enregistrée.</div>`
        : `<table><thead><tr>
            <th>Réf. vente</th><th>Date</th><th>Article</th><th>Réf. achat</th><th>Prix vente</th>
            <th>Marge</th><th>Statut</th><th>Facture</th><th></th>
          </tr></thead><tbody>
          ${rows
            .map((v) => {
              const a = venteAchat(v);
              const m = marge(v);
              return `<tr>
                <td>${esc(v.id)}</td><td>${dateFr(v.dateVente)}</td>
                <td>${a ? esc(a.article) : "<em>article supprimé</em>"}</td>
                <td>${esc(v.achatId)}</td><td>${eur(v.prixVente)}</td>
                <td class="${m.montant >= 0 ? "" : ""}" style="color:${m.montant >= 0 ? "var(--sage)" : "var(--danger)"}">${eur(m.montant)} <small>(${m.pct.toFixed(0)}%)</small></td>
                <td><span class="badge ${v.statut === "passee" ? "vendu" : v.statut === "en_cours" ? "encours" : "avenir"}">${STATUT_LABEL[v.statut]}</span></td>
                <td>${v.numeroFacture ? `<button class="btn secondary small" data-pdf-vente="${v.id}">${esc(v.numeroFacture)}</button>` : "—"}</td>
                <td><button class="btn secondary small" data-edit-vente="${v.id}">Modifier</button>
                    <button class="btn danger small" data-del-vente="${v.id}">Suppr.</button></td>
              </tr>`;
            })
            .join("")}
          </tbody></table>`
    }
  `;
}

function venteFormHtml(v) {
  const isEdit = !!v;
  v = v || { id: "", achatId: "", dateVente: todayISO(), prixVente: "", moyenPaiement: MOYENS_PAIEMENT[0], numeroTicket: "", statut: "passee" };
  const disponibles = stockAchats().concat(v.achatId ? [achatById(v.achatId)].filter(Boolean) : []);
  const uniq = [...new Map(disponibles.map((a) => [a.id, a])).values()];
  return `
    <div class="overlay" id="vente-overlay">
      <div class="modal">
        <h2>${isEdit ? "Modifier la vente " + esc(v.id) : "Nouvelle vente"}</h2>
        <div class="form-grid">
          <label class="full">Article (fiche d'achat)
            <select id="f-achatid">
              ${uniq.map((a) => `<option value="${a.id}" ${v.achatId === a.id ? "selected" : ""}>${esc(a.id)} — ${esc(a.article)} (${eur((a.prixAchat || 0) + (a.fraisPort || 0))})</option>`).join("")}
            </select>
          </label>
          <label>Date de vente<input type="date" id="f-datevente" value="${v.dateVente}"></label>
          <label>Prix de vente (€)<input type="number" step="0.01" id="f-prixvente" value="${v.prixVente}"></label>
          <label>Moyen de paiement<select id="f-moyen">${MOYENS_PAIEMENT.map((m) => `<option ${v.moyenPaiement === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label>N° ticket de caisse<input type="text" id="f-ticket" value="${esc(v.numeroTicket)}"></label>
          <label>Statut<select id="f-statut">${STATUTS_VENTE.map((s) => `<option value="${s}" ${v.statut === s ? "selected" : ""}>${STATUT_LABEL[s]}</option>`).join("")}</select></label>
        </div>
        <div class="margin-preview full" id="margin-preview" style="margin-top:12px;"></div>
        <div class="modal-actions">
          <button class="btn secondary" id="btn-cancel-vente">Annuler</button>
          <button class="btn" id="btn-save-vente">Enregistrer</button>
        </div>
      </div>
    </div>
  `;
}

function updateMarginPreview() {
  const achatId = document.getElementById("f-achatid")?.value;
  const prixVente = parseFloat(document.getElementById("f-prixvente")?.value) || 0;
  const a = achatById(achatId);
  const el = document.getElementById("margin-preview");
  if (!el) return;
  if (!a) { el.innerHTML = ""; return; }
  const cout = (a.prixAchat || 0) + (a.fraisPort || 0);
  const m = prixVente - cout;
  const pct = cout > 0 ? (m / cout) * 100 : 0;
  el.innerHTML = `<span>Coût d'achat : ${eur(cout)}</span><b class="${m >= 0 ? "pos" : "neg"}">Marge : ${eur(m)} (${pct.toFixed(0)}%)</b>`;
}

async function saveVenteFromForm(existingId) {
  const val = (id) => document.getElementById(id).value;
  const statut = val("f-statut");
  let numeroFacture = existingId ? state.ventes.find((v) => v.id === existingId)?.numeroFacture : null;
  if (statut === "passee" && !numeroFacture) numeroFacture = await DB.nextRef("FACT");
  const vente = {
    id: existingId || (await DB.nextRef("VTE")),
    achatId: val("f-achatid"),
    dateVente: val("f-datevente"),
    prixVente: parseFloat(val("f-prixvente")) || 0,
    moyenPaiement: val("f-moyen"),
    numeroTicket: val("f-ticket").trim(),
    statut,
    numeroFacture: numeroFacture || null,
  };
  await DB.dbPut("ventes", vente);
  await loadAll();
  document.getElementById("vente-overlay")?.remove();
  render();
}

// ---------- Stock ----------
function viewStock() {
  const stock = stockAchats().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const valeur = stock.reduce((s, a) => s + (a.prixAchat || 0) + (a.fraisPort || 0), 0);
  return `
    <div class="page-title">Stock</div>
    <div class="page-sub">${stock.length} article(s) en stock — valeur d'achat totale : ${eur(valeur)}</div>
    ${
      stock.length === 0
        ? `<div class="card empty">Stock vide.</div>`
        : `<table><thead><tr><th>Référence</th><th>Article</th><th>Marque</th><th>Catégorie</th><th>Taille</th><th>Coût</th><th>En stock depuis</th></tr></thead><tbody>
        ${stock
          .map((a) => {
            const jours = Math.max(0, Math.round((Date.now() - new Date(a.date)) / 86400000));
            return `<tr><td>${esc(a.id)}</td><td>${esc(a.article)}</td><td>${esc(a.marque) || "—"}</td><td>${esc(a.categorie)}</td><td>${esc(a.taille) || "—"}</td><td>${eur((a.prixAchat || 0) + (a.fraisPort || 0))}</td><td>${jours} j</td></tr>`;
          })
          .join("")}
        </tbody></table>`
    }
  `;
}

// ---------- Export ----------
function viewExport() {
  return `
    <div class="page-title">Export comptable</div>
    <div class="page-sub">Pour ton expert-comptable, ou pour ta propre sauvegarde</div>
    <div class="row">
      <div class="card export-block">
        <h3>Période</h3>
        <label>Du <input type="date" id="exp-debut"></label>
        <label>Au <input type="date" id="exp-fin" value="${todayISO()}"></label>
        <div class="export-actions">
          <button class="btn" id="btn-export-achats-csv">Achats → CSV</button>
          <button class="btn secondary" id="btn-export-achats-xlsx">Achats → Excel</button>
        </div>
        <div class="export-actions">
          <button class="btn" id="btn-export-ventes-csv">Ventes → CSV</button>
          <button class="btn secondary" id="btn-export-ventes-xlsx">Ventes → Excel</button>
        </div>
      </div>
      <div class="card export-block">
        <h3>Sauvegarde complète</h3>
        <p class="page-sub" style="margin:0 0 6px;">Toutes les données de l'appli (achats, ventes, paramètres) dans un seul fichier — à garder précieusement, c'est ta seule copie.</p>
        <div class="export-actions">
          <button class="btn" id="btn-backup-json">Télécharger la sauvegarde</button>
          <label class="btn secondary small" style="display:inline-block;cursor:pointer;">Restaurer<input type="file" id="input-restore" accept=".json" style="display:none;"></label>
        </div>
      </div>
    </div>
  `;
}

function inRange(dateStr, debut, fin) {
  if (!dateStr) return false;
  if (debut && dateStr < debut) return false;
  if (fin && dateStr > fin) return false;
  return true;
}

function achatsExportRows(debut, fin) {
  return state.achats
    .filter((a) => inRange(a.date, debut, fin))
    .map((a) => ({
      Référence: a.id, Date: dateFr(a.date), Article: a.article, Marque: a.marque, Catégorie: a.categorie,
      Taille: a.taille, Vendeur: a.vendeurVinted, "Prix achat": a.prixAchat, "Frais de port": a.fraisPort,
      "Coût total": (a.prixAchat || 0) + (a.fraisPort || 0), Notes: a.notes,
    }));
}

function ventesExportRows(debut, fin) {
  return state.ventes
    .filter((v) => v.statut === "passee" && inRange(v.dateVente, debut, fin))
    .map((v) => {
      const a = venteAchat(v);
      const m = marge(v);
      return {
        "Référence vente": v.id, "N° facture": v.numeroFacture, Date: dateFr(v.dateVente),
        Article: a ? a.article : "", "Référence achat": v.achatId, "Prix vente": v.prixVente,
        "Moyen paiement": v.moyenPaiement, "N° ticket caisse": v.numeroTicket, Marge: m.montant.toFixed(2),
      };
    });
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toCSV(rows) {
  if (rows.length === 0) return "﻿";
  const headers = Object.keys(rows[0]);
  const escCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(";"), ...rows.map((r) => headers.map((h) => escCsv(r[h])).join(";"))];
  return "﻿" + lines.join("\r\n");
}

function toXLSX(rows, sheetName, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// ---------- Paramètres ----------
function viewParametres() {
  const p = state.parametres;
  return `
    <div class="page-title">Paramètres</div>
    <div class="page-sub">Informations utilisées sur tes factures</div>
    <div class="card" style="max-width:480px;">
      <div class="form-grid">
        <label class="full">Nom de la boutique<input type="text" id="p-nom" value="${esc(p.nom || "Café Rencontre")}"></label>
        <label class="full">Adresse<input type="text" id="p-adresse" value="${esc(p.adresse || "")}"></label>
        <label>SIRET<input type="text" id="p-siret" value="${esc(p.siret || "")}"></label>
        <label>Email<input type="text" id="p-email" value="${esc(p.email || "")}"></label>
        <label class="full">Mention légale (TVA)<input type="text" id="p-tva" value="${esc(p.tva || "TVA non applicable, art. 293 B du CGI")}"></label>
      </div>
      <p class="page-sub">Vérifie cette mention TVA avec ton expert-comptable selon ton statut (auto-entrepreneur, société...).</p>
      <div class="modal-actions" style="justify-content:flex-start;">
        <button class="btn" id="btn-save-params">Enregistrer</button>
      </div>
    </div>
  `;
}

async function saveParametres() {
  const fields = { nom: "p-nom", adresse: "p-adresse", siret: "p-siret", email: "p-email", tva: "p-tva" };
  for (const [key, id] of Object.entries(fields)) {
    await DB.dbPut("parametres", { key, value: document.getElementById(id).value.trim() });
  }
  await loadAll();
  render();
}

// ---------- PDF Facture ----------
function generateInvoicePDF(vente) {
  const a = venteAchat(vente);
  const p = state.parametres;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text(p.nom || "Café Rencontre", 20, 25);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(p.adresse || "", 20, 32);
  doc.text(p.siret ? `SIRET : ${p.siret}` : "", 20, 38);
  doc.text(p.email || "", 20, 44);

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text(`FACTURE N° ${vente.numeroFacture}`, 130, 25);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Date : ${dateFr(vente.dateVente)}`, 130, 32);
  doc.text(`Ticket de caisse : ${vente.numeroTicket || "—"}`, 130, 38);

  doc.setLineWidth(0.5); doc.line(20, 55, 190, 55);
  doc.setFont("helvetica", "bold");
  doc.text("Article", 20, 63); doc.text("Détail", 90, 63); doc.text("Prix", 170, 63);
  doc.setFont("helvetica", "normal");
  doc.text(a ? a.article : "Article", 20, 71);
  doc.text(a ? `${a.marque || ""} ${a.taille ? "- Taille " + a.taille : ""}`.trim() : "", 90, 71);
  doc.text(eur(vente.prixVente), 170, 71);
  doc.line(20, 80, 190, 80);

  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(`Total : ${eur(vente.prixVente)}`, 150, 90);

  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text("Vente d'article de seconde main.", 20, 105);
  doc.text(p.tva || "TVA non applicable, art. 293 B du CGI", 20, 111);

  doc.save(`${vente.numeroFacture}.pdf`);
}

// ---------- Event binding ----------
function bindPageEvents() {
  document.getElementById("btn-new-achat")?.addEventListener("click", () => {
    document.body.insertAdjacentHTML("beforeend", achatFormHtml(null));
    document.getElementById("btn-cancel-achat").addEventListener("click", () => document.getElementById("achat-overlay").remove());
    document.getElementById("btn-save-achat").addEventListener("click", () => saveAchatFromForm(null));
  });
  document.querySelectorAll("[data-edit-achat]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const a = achatById(btn.dataset.editAchat);
      document.body.insertAdjacentHTML("beforeend", achatFormHtml(a));
      document.getElementById("btn-cancel-achat").addEventListener("click", () => document.getElementById("achat-overlay").remove());
      document.getElementById("btn-save-achat").addEventListener("click", () => saveAchatFromForm(a.id));
    })
  );
  document.querySelectorAll("[data-del-achat]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer cette fiche d'achat ?")) return;
      await DB.dbDelete("achats", btn.dataset.delAchat);
      await loadAll(); render();
    })
  );
  document.getElementById("achat-search")?.addEventListener("input", (e) => {
    document.getElementById("main").innerHTML = viewAchats(e.target.value);
    bindPageEvents();
  });

  document.getElementById("btn-new-vente")?.addEventListener("click", () => {
    if (stockAchats().length === 0) return;
    document.body.insertAdjacentHTML("beforeend", venteFormHtml(null));
    updateMarginPreview();
    document.getElementById("f-achatid").addEventListener("change", updateMarginPreview);
    document.getElementById("f-prixvente").addEventListener("input", updateMarginPreview);
    document.getElementById("btn-cancel-vente").addEventListener("click", () => document.getElementById("vente-overlay").remove());
    document.getElementById("btn-save-vente").addEventListener("click", () => saveVenteFromForm(null));
  });
  document.querySelectorAll("[data-edit-vente]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const v = state.ventes.find((x) => x.id === btn.dataset.editVente);
      document.body.insertAdjacentHTML("beforeend", venteFormHtml(v));
      updateMarginPreview();
      document.getElementById("f-achatid").addEventListener("change", updateMarginPreview);
      document.getElementById("f-prixvente").addEventListener("input", updateMarginPreview);
      document.getElementById("btn-cancel-vente").addEventListener("click", () => document.getElementById("vente-overlay").remove());
      document.getElementById("btn-save-vente").addEventListener("click", () => saveVenteFromForm(v.id));
    })
  );
  document.querySelectorAll("[data-del-vente]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer cette vente ?")) return;
      await DB.dbDelete("ventes", btn.dataset.delVente);
      await loadAll(); render();
    })
  );
  document.querySelectorAll("[data-pdf-vente]").forEach((btn) =>
    btn.addEventListener("click", () => generateInvoicePDF(state.ventes.find((v) => v.id === btn.dataset.pdfVente)))
  );
  document.getElementById("vente-filter")?.addEventListener("change", (e) => {
    document.getElementById("main").innerHTML = viewVentes(e.target.value);
    bindPageEvents();
  });

  document.getElementById("btn-save-params")?.addEventListener("click", saveParametres);

  document.getElementById("btn-export-achats-csv")?.addEventListener("click", () => {
    const rows = achatsExportRows(document.getElementById("exp-debut").value, document.getElementById("exp-fin").value);
    downloadBlob(toCSV(rows), "achats.csv", "text/csv;charset=utf-8");
  });
  document.getElementById("btn-export-ventes-csv")?.addEventListener("click", () => {
    const rows = ventesExportRows(document.getElementById("exp-debut").value, document.getElementById("exp-fin").value);
    downloadBlob(toCSV(rows), "ventes.csv", "text/csv;charset=utf-8");
  });
  document.getElementById("btn-export-achats-xlsx")?.addEventListener("click", () => {
    const rows = achatsExportRows(document.getElementById("exp-debut").value, document.getElementById("exp-fin").value);
    toXLSX(rows, "Achats", "achats.xlsx");
  });
  document.getElementById("btn-export-ventes-xlsx")?.addEventListener("click", () => {
    const rows = ventesExportRows(document.getElementById("exp-debut").value, document.getElementById("exp-fin").value);
    toXLSX(rows, "Ventes", "ventes.xlsx");
  });
  document.getElementById("btn-backup-json")?.addEventListener("click", () => {
    const dump = { achats: state.achats, ventes: state.ventes, parametres: state.parametres, exportedAt: new Date().toISOString() };
    downloadBlob(JSON.stringify(dump, null, 2), `cafe-rencontre-sauvegarde-${todayISO()}.json`, "application/json");
  });
  document.getElementById("input-restore")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      if (!confirm("Restaurer remplacera toutes les données actuelles. Continuer ?")) return;
      for (const a of data.achats || []) await DB.dbPut("achats", a);
      for (const v of data.ventes || []) await DB.dbPut("ventes", v);
      for (const [key, value] of Object.entries(data.parametres || {})) await DB.dbPut("parametres", { key, value });
      await loadAll(); render();
      alert("Sauvegarde restaurée.");
    } catch (err) {
      alert("Fichier de sauvegarde invalide.");
    }
  });
}

(async function init() {
  await loadAll();
  render();
})();
