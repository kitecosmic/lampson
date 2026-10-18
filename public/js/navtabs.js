// navtabs.js — las pestañas del hub (proyectos · equipos · tareas · plugins), iguales en las cuatro pantallas.
// Cada página pone <nav class="navtabs" data-on="<pestaña>"></nav>; esto las dibuja y les pone los contadores:
// ⚑ lo que te espera en equipos (preguntas y aprobaciones) y ✕ las tareas cuya última corrida falló.
(function () {
  const nav = document.querySelector('nav.navtabs'); if (!nav) return;
  const TABS = [['proyectos', '/', 'tus proyectos'], ['equipos', '/equipos', 'equipos y objetivos de todos tus proyectos'], ['tareas', '/tareas', 'tareas programadas de todos tus proyectos'], ['plugins', '/plugins', 'lo que podés sumarle a tus agentes']];
  const on = nav.dataset.on;
  nav.innerHTML = TABS.map(([id, href, title]) => `<a href="${href}" title="${title}"${id === on ? ' class="on" aria-current="page"' : ''}>${id}<span class="badge" data-badge="${id}" hidden></span></a>`).join('');
  const badge = (id, text) => { const b = nav.querySelector(`[data-badge="${id}"]`); b.hidden = !text; b.textContent = text || ''; };
  async function paint() {
    try {
      const t = await (await fetch('/api/teams-home')).json();
      const n = (t.workspaces || []).reduce((s, w) => s + w.objectives.filter(o => o.status === 'waiting').length + (w.approvals || []).length, 0);
      badge('equipos', n ? '⚑ ' + n : '');
    } catch (e) {}
    try {
      const t = await (await fetch('/api/tasks-home')).json();
      const n = (t.workspaces || []).reduce((s, w) => s + w.tasks.filter(x => x.enabled && String(x.last_status || '').startsWith('error')).length, 0);
      badge('tareas', n ? '✕ ' + n : '');
    } catch (e) {}
  }
  paint(); setInterval(paint, 15000);
})();
