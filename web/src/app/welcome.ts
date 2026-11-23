import { api } from "../api";
import { LANG } from "../i18n";

/** First run: a short tour page and an example database. */
export async function seedWelcome(): Promise<string> {
  const fr = LANG === "fr";
  const home = await api.post("/api/pages", {
    title: fr ? "Bienvenue dans Carnet" : "Welcome to Carnet", icon: "👋",
    cover: "linear-gradient(120deg,#a1c4fd,#c2e9fb)",
    markdown: fr ? `
Carnet fonctionne comme Notion : **tout est une page**, une page contient des blocs, et des pages peuvent vivre dans d'autres pages.

> [!tip] Pour commencer
> Tapez **/** pour insérer un bloc, **@** pour mentionner une page, **Ctrl+K** pour chercher.

## Écrire
- Le Markdown se transforme pendant la frappe : \`# \` titre, \`- \` liste, \`[] \` case à cocher, \`> \` citation, \`\`\` \` code.
- La barre du haut (comme Google Docs) donne la mise en forme : couleurs, alignement, listes, tableaux, formules.
- Glissez un bloc par sa poignée ⋮⋮ pour le déplacer, ou sur le côté d'un autre bloc pour faire des colonnes.
- [ ] Essayez de cocher cette case
- [x] Celle-ci est déjà faite

## Formules
Une formule en ligne $E = mc^2$ ou un bloc :

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Lire
Le bouton **Lecture** en haut à droite masque les outils pour relire tranquillement (et exporter en PDF).

## Bases de données
Une base de données est un tableau dont chaque ligne est une page : vues tableau, kanban, liste, galerie et calendrier, filtres et tris. Un exemple est juste en dessous dans la barre latérale.
` : `
Carnet works like Notion: **everything is a page**, pages hold blocks, and pages can live inside other pages.

> [!tip] Getting started
> Type **/** to insert a block, **@** to mention a page, **Ctrl+K** to search.

## Writing
- Markdown turns into blocks as you type: \`# \` heading, \`- \` list, \`[] \` to-do, \`> \` quote, \`\`\` \` code.
- The top toolbar (like Google Docs) has the formatting: colors, alignment, lists, tables, formulas.
- Drag a block by its ⋮⋮ handle to move it, or onto the side of another block to make columns.
- [ ] Try ticking this box
- [x] This one is already done

## Formulas
An inline formula $E = mc^2$ or a block:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

## Reading
The **Read** button at the top right hides the tools for distraction-free reading (and PDF export).

## Databases
A database is a table where every row is a page: table, board, list, gallery and calendar views, filters and sorts. There is an example right below in the sidebar.
`,
  });
  const db = await api.post("/api/pages", {
    kind: "database", title: fr ? "Projets" : "Projects", icon: "🗂️",
    title_name: fr ? "Nom" : "Name", view_name: fr ? "Tableau" : "Table",
    schema: {
      title_name: fr ? "Nom" : "Name",
      properties: [
        { id: "status", name: fr ? "Statut" : "Status", type: "status", options: [
          { id: "todo", name: fr ? "À faire" : "To do", color: "gray", group: "todo" },
          { id: "doing", name: fr ? "En cours" : "In progress", color: "blue", group: "doing" },
          { id: "done", name: fr ? "Terminé" : "Done", color: "green", group: "done" }] },
        { id: "tags", name: "Tags", type: "multi_select", options: [
          { id: "perso", name: fr ? "Perso" : "Personal", color: "purple" }, { id: "work", name: fr ? "Travail" : "Work", color: "orange" }] },
        { id: "due", name: fr ? "Échéance" : "Due", type: "date" },
      ],
    },
  });
  await api.post(`/api/pages/${db.id}`, {
    views: [
      { id: "table", name: fr ? "Tableau" : "Table", type: "table" },
      { id: "board", name: "Kanban", type: "board", group_by: "status" },
      { id: "cal", name: fr ? "Calendrier" : "Calendar", type: "calendar", date_prop: "due" },
    ],
  });
  const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const rows = fr
    ? [["Lire la doc de Carnet", "doing", ["perso"], d(0), "📖"], ["Importer mes notes", "todo", ["perso"], d(2), "📥"], ["Préparer la réunion", "done", ["work"], d(-1), "🗓️"]]
    : [["Read the Carnet docs", "doing", ["perso"], d(0), "📖"], ["Import my notes", "todo", ["perso"], d(2), "📥"], ["Prepare the meeting", "done", ["work"], d(-1), "🗓️"]];
  for (const [title, status, tags, due, icon] of rows) {
    await api.post(`/api/databases/${db.id}/rows`, { title, icon, props: { status, tags, due: { start: due } } });
  }
  return home.id;
}
