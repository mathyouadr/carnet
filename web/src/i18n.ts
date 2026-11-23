// Tiny i18n: English strings are the keys, French is a lookup table.
const FR: Record<string, string> = {
  "New page": "Nouvelle page", "Search": "Rechercher", "Favorites": "Favoris", "Pages": "Pages",
  "Templates": "Modèles", "Trash": "Corbeille", "Settings": "Paramètres", "Untitled": "Sans titre",
  "Add a page": "Ajouter une page", "Add a sub-page": "Ajouter une sous-page", "No pages inside": "Aucune page à l'intérieur",
  "Edit": "Édition", "Read": "Lecture", "Editing": "Édition", "Reading": "Lecture",
  "Add to favorites": "Ajouter aux favoris", "Remove from favorites": "Retirer des favoris",
  "Duplicate": "Dupliquer", "Move to": "Déplacer vers", "Delete": "Supprimer", "Move to trash": "Mettre à la corbeille",
  "Page history": "Historique de la page", "Export as Markdown": "Exporter en Markdown", "Export as PDF": "Exporter en PDF",
  "Export as CSV": "Exporter en CSV", "Full width": "Pleine largeur", "Small text": "Petit texte", "Font": "Police",
  "Lock page": "Verrouiller la page", "Unlock page": "Déverrouiller la page", "Turn into template": "Transformer en modèle",
  "Stop being a template": "Ne plus être un modèle", "Copy link": "Copier le lien", "Link copied": "Lien copié",
  "Share to the web": "Partager sur le web", "Shared to the web": "Partagée sur le web", "Public link": "Lien public",
  "Anyone with the link can read this page and its sub-pages. They can't edit anything or see your other pages.":
    "Toute personne qui a le lien peut lire cette page et ses sous-pages. Elle ne peut rien modifier ni voir vos autres pages.",
  "Public link created": "Lien public créé", "Public link removed": "Lien public retiré", "Copy": "Copier",
  "Already public through the link of": "Déjà publique via le lien de",
  "This link only works where Carnet itself is reachable: set CARNET_SHARE_URL to publish it.":
    "Ce lien ne marche que là où Carnet est joignable : réglez CARNET_SHARE_URL pour le publier.",
  "Turning the link off makes it stop working at once. Turning it on again gives a new link.":
    "Couper le lien le désactive tout de suite. Le réactiver donne un nouveau lien.",
  "Add icon": "Ajouter une icône", "Add cover": "Ajouter une couverture", "Change cover": "Changer la couverture",
  "Remove": "Retirer", "Remove icon": "Retirer l'icône", "Random": "Aléatoire", "Upload": "Importer",
  "Paste a link to an image": "Collez le lien d'une image", "Gallery": "Galerie", "Link": "Lien",
  "Backlinks": "Rétroliens", "Linked from": "Mentionnée dans", "Edited": "Modifiée", "Saved": "Enregistré", "Saving…": "Enregistrement…",
  "Offline: changes kept, retrying…": "Hors ligne : modifications gardées, nouvel essai…",
  "This page was changed elsewhere: reloaded.": "Cette page a été modifiée ailleurs : rechargée.",
  "Restore": "Restaurer", "Delete forever": "Supprimer définitivement", "Empty trash": "Vider la corbeille",
  "Trash is empty": "La corbeille est vide", "Pages in the trash are deleted after 30 days.": "Les pages de la corbeille sont supprimées au bout de 30 jours.",
  "This page is in the trash.": "Cette page est dans la corbeille.", "No results": "Aucun résultat",
  "Search pages…": "Rechercher dans les pages…", "Recent": "Récentes", "Jump to": "Aller à",
  "Theme": "Thème", "Light": "Clair", "Dark": "Sombre", "System": "Système", "Language": "Langue",
  "Import": "Importer", "Export": "Exporter", "Export everything (Markdown .zip)": "Tout exporter (Markdown .zip)",
  "Import from Obsidian, Notion or Markdown": "Importer depuis Obsidian, Notion ou Markdown",
  "A .zip of your vault / Notion \"Markdown & CSV\" export, or a .md file.": "Un .zip de votre coffre / de l'export Notion « Markdown & CSV », ou un fichier .md.",
  "Folders of notes with properties become databases": "Les dossiers de notes avec propriétés deviennent des bases de données",
  "Choose a file": "Choisir un fichier", "Importing…": "Import en cours…", "Imported": "Importé",
  "pages": "pages", "databases": "bases", "files": "fichiers", "About": "À propos", "Log out": "Se déconnecter",
  "Password": "Mot de passe", "Sign in": "Se connecter", "Wrong password": "Mot de passe incorrect",
  "Restore this version": "Restaurer cette version", "No history yet: versions are kept every 10 minutes while you edit.": "Pas encore d'historique : une version est gardée toutes les 10 minutes d'édition.",
  "Current version": "Version actuelle", "Version restored": "Version restaurée",
  "Use template": "Utiliser le modèle", "New from template": "Nouveau depuis un modèle", "Empty page": "Page vide",
  "No templates yet: open a page's ⋯ menu > Turn into template.": "Aucun modèle : menu ⋯ d'une page > Transformer en modèle.",
  "This page could not be displayed. Its content is kept: export it as Markdown from the ⋯ menu.": "Impossible d'afficher cette page. Son contenu est conservé : exportez-la en Markdown depuis le menu ⋯.",
  "Markdown file · read only": "Fichier Markdown · lecture seule",
  "Markdown file, read only": "Fichier Markdown en lecture seule, modifiable seulement dans le fichier",
  "Markdown files, read only": "Fichiers Markdown, lecture seule",
  "Audio": "Audio",
  "Equation": "Formule",
  "Block": "Bloc",
  "Nothing here yet": "Rien pour l'instant",
  "Start writing, or press / for commands": "Écrivez, ou tapez / pour les commandes",
  "Close": "Fermer", "Cancel": "Annuler", "OK": "OK", "Rename": "Renommer", "Open": "Ouvrir", "Open as page": "Ouvrir en pleine page",
  "Move here": "Déplacer ici", "Top level": "Racine", "Choose where to move": "Où déplacer la page ?",
  // editor & toolbar
  "Undo": "Annuler", "Redo": "Rétablir", "Text": "Texte", "Heading 1": "Titre 1", "Heading 2": "Titre 2", "Heading 3": "Titre 3",
  "Bold": "Gras", "Italic": "Italique", "Underline": "Souligné", "Strikethrough": "Barré", "Inline code": "Code",
  "Text color": "Couleur du texte", "Highlight": "Surlignage", "Align left": "Aligner à gauche", "Center": "Centrer",
  "Align right": "Aligner à droite", "Justify": "Justifier", "Bulleted list": "Liste à puces", "Numbered list": "Liste numérotée",
  "To-do list": "Liste de tâches", "Toggle list": "Liste dépliante", "Quote": "Citation", "Callout": "Encadré",
  "Code block": "Bloc de code", "Formula": "Formule", "Inline formula": "Formule en ligne", "Divider": "Séparateur",
  "Table": "Tableau", "Image": "Image", "File": "Fichier", "Video": "Vidéo", "Embed": "Intégration",
  "Indent": "Augmenter le retrait", "Outdent": "Diminuer le retrait", "Insert": "Insérer", "More": "Plus",
  "Clear formatting": "Effacer la mise en forme", "Page": "Page", "Sub-page": "Sous-page", "Link to page": "Lien vers une page",
  "Table of contents": "Table des matières", "Database": "Base de données", "Database - inline": "Base de données intégrée",
  "Columns": "Colonnes", "2 columns": "2 colonnes", "3 columns": "3 colonnes", "Mention a page": "Mentionner une page",
  "Type a LaTeX formula": "Tapez une formule LaTeX", "Empty formula": "Formule vide", "Click to edit": "Cliquer pour modifier",
  "Paste a link (YouTube, Google Maps, PDF, any page…)": "Collez un lien (YouTube, Google Maps, PDF, une page…)",
  "Add a table of contents: headings will appear here.": "Les titres de la page apparaîtront ici.",
  "Default": "Par défaut", "Gray": "Gris", "Brown": "Marron", "Orange": "Orange", "Yellow": "Jaune", "Green": "Vert",
  "Blue": "Bleu", "Purple": "Violet", "Pink": "Rose", "Red": "Rouge", "Background": "Fond", "Color": "Couleur",
  "Serif": "Serif", "Mono": "Mono", "Basic blocks": "Blocs de base", "Advanced": "Avancé", "Media": "Médias",
  "Insert link": "Insérer un lien", "Link URL": "Adresse du lien", "Pages linked here": "Pages liées",
  // databases
  "New": "Nouveau", "New row": "Nouvelle ligne", "Filter": "Filtrer", "Sort": "Trier", "Properties": "Propriétés",
  "Add a property": "Ajouter une propriété", "Property": "Propriété", "Property name": "Nom de la propriété", "Type": "Type",
  "Name": "Nom", "Number": "Nombre", "Select": "Sélection", "Multi-select": "Sélection multiple", "Status": "Statut",
  "Date": "Date", "Checkbox": "Case à cocher", "URL": "URL", "Email": "E-mail", "Phone": "Téléphone",
  "Relation": "Relation", "Created time": "Date de création", "Last edited time": "Dernière modification",
  "Options": "Options", "Add an option": "Ajouter une option", "Delete property": "Supprimer la propriété",
  "Hide in view": "Masquer dans la vue", "Show": "Afficher", "Hidden": "Masquées", "Sort ascending": "Tri croissant",
  "Sort descending": "Tri décroissant", "Ascending": "Croissant", "Descending": "Décroissant", "Add a filter": "Ajouter un filtre",
  "Add a sort": "Ajouter un tri", "Delete filter": "Supprimer le filtre", "Empty": "Vide", "Not empty": "Non vide",
  "contains": "contient", "does not contain": "ne contient pas", "is": "est", "is not": "n'est pas",
  "is empty": "est vide", "is not empty": "n'est pas vide", "is checked": "est cochée", "is not checked": "n'est pas cochée",
  "before": "avant", "after": "après", "on or before": "le ou avant", "on or after": "le ou après", "=": "=", "≠": "≠",
  ">": ">", "<": "<", "≥": "≥", "≤": "≤", "All rules (AND)": "Toutes les règles (ET)", "Any rule (OR)": "Une des règles (OU)",
  "Views": "Vues", "Add a view": "Ajouter une vue", "View name": "Nom de la vue", "Layout": "Disposition",
  "List": "Liste", "Board": "Tableau kanban", "Calendar": "Calendrier", "Delete view": "Supprimer la vue",
  "Duplicate view": "Dupliquer la vue", "Group by": "Grouper par", "Calendar by": "Calendrier selon",
  "Card preview": "Aperçu des cartes", "Cover": "Couverture", "Page content": "Contenu de la page", "None": "Aucun",
  "Card size": "Taille des cartes", "Small": "Petite", "Medium": "Moyenne", "Large": "Grande",
  "No": "Sans", "Today": "Aujourd'hui", "No date": "Sans date", "rows": "lignes", "Count": "Nombre",
  "Wrap cells": "Retour à la ligne", "Show page icon": "Afficher l'icône", "Link to database": "Base liée",
  "Choose a database": "Choisir une base", "This database is empty.": "Cette base est vide.",
  "Search in this database…": "Rechercher dans cette base…", "Include time": "Inclure l'heure", "End date": "Date de fin",
  "Clear": "Effacer", "Open in full page": "Ouvrir en pleine page", "Delete row": "Supprimer la ligne",
  "Search or create an option…": "Rechercher ou créer une option…", "Create": "Créer", "Search pages…?": "Rechercher une page…",
  "Format": "Format", "Percent": "Pourcentage", "Euro": "Euro", "Dollar": "Dollar", "Edit property": "Modifier la propriété",
  "To do": "À faire", "In progress": "En cours", "Done": "Terminé", "Description": "Description", "Add a description…": "Ajouter une description…",
  "Back": "Retour", "Menu": "Menu", "Close sidebar": "Fermer la barre latérale", "Open sidebar": "Ouvrir la barre latérale",
  "Welcome": "Bienvenue", "Drop to move": "Déposer pour déplacer", "Loading…": "Chargement…",
  "Page not found": "Page introuvable", "Go home": "Accueil", "Words": "Mots", "Calculate": "Calculer",
  "Sum": "Somme", "Average": "Moyenne", "Checked": "Cochées", "Percent checked": "% cochées", "Filled": "Remplies",
  "Upload failed": "Échec de l'envoi", "Copied": "Copié", "Print / PDF": "Imprimer / PDF", "Created": "Créée",
  "Quick note": "Note rapide",
};

const lang = (() => {
  const forced = (window as any).CARNET?.lang;
  const saved = localStorage.getItem("carnet:lang");
  const l = saved || forced || navigator.language || "en";
  return l.toLowerCase().startsWith("fr") ? "fr" : "en";
})();

export const LANG: "fr" | "en" = lang;

export function t(s: string): string {
  return lang === "fr" ? FR[s] ?? s : s;
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (s < 45) return lang === "fr" ? "à l'instant" : "just now";
  if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
  if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
  if (s < 86400 * 7) return rtf.format(-Math.round(s / 86400), "day");
  return fmtDate(iso.slice(0, 10));
}

/** 2026-11-23 -> "23/11/2026" (fr) or "Nov 23, 2026" (en); with time when given. */
export function fmtDate(v: string, withYear = true): string {
  if (!v) return "";
  const hasTime = v.length > 10;
  const d = hasTime ? new Date(v) : new Date(v + "T00:00:00");
  if (isNaN(d.getTime())) return v;
  const opts: Intl.DateTimeFormatOptions = lang === "fr"
    ? { day: "2-digit", month: "2-digit", ...(withYear && d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }
    : { month: "short", day: "numeric", ...(withYear && d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) };
  let s = d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", opts);
  if (hasTime) s += " " + d.toLocaleTimeString(lang === "fr" ? "fr-FR" : "en-US", { hour: "2-digit", minute: "2-digit" });
  return s;
}
