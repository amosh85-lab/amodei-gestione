// / (Home) — landing page once authenticated.
// Light dashboard with shortcuts to the implemented sections.

import { getCurrentUser, logout } from '../js/auth.js';
import { setHeader } from '../js/app-shell.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';
import { confirmDialog } from '../js/components.js';

export function mountHome(container) {
  const user = getCurrentUser();
  const isAdminOrManager = user && ['admin', 'manager'].includes(user.role);

  setHeader({
    title: 'Amodei',
    brand: true,
    actions: [
      {
        label: 'Esci',
        iconName: 'logout',
        onClick: async () => {
          const ok = await confirmDialog(
            'Vuoi uscire?',
            'Tornerai alla schermata di accesso.',
            { confirmLabel: 'Esci', cancelLabel: 'Annulla', danger: true },
          );
          if (ok) logout();
        },
      },
    ],
  });

  const greeting = user ? `Ciao ${escapeHtml(user.full_name || user.email)}` : 'Ciao';
  const roleBadge = user ? `<span class="badge badge--success" style="margin-left: var(--space-8); vertical-align: middle;">${user.role}</span>` : '';

  container.innerHTML = `
    <section class="container container--narrow" style="padding-block: var(--space-32);">
      <div class="card card--elevated stack-16">
        <h2 class="font-display text-2xl" style="margin:0">${greeting} ${roleBadge}</h2>
        <p class="muted">Cosa vuoi fare oggi?</p>

        <div class="stack-12" style="margin-top: var(--space-8);">
          <button type="button" data-go="/magazzino" class="btn btn--primary btn--lg full-width">
            ${icon('inventory', { size: 20 })}<span>Apri Magazzino</span>
          </button>
          <button type="button" data-go="/magazzino/carico" class="btn btn--secondary btn--lg full-width">
            ${icon('plus', { size: 20 })}<span>Carica un lotto</span>
          </button>
          <button type="button" data-go="/chiusura-serale" class="btn btn--secondary btn--lg full-width">
            ${icon('clock', { size: 20 })}<span>Chiusura serale</span>
          </button>
          ${isAdminOrManager ? `
            <button type="button" data-go="/fornitori" class="btn btn--ghost btn--lg full-width">
              ${icon('phone', { size: 20 })}<span>Fornitori</span>
            </button>
          ` : ''}
        </div>
      </div>

      <p class="muted text-xs center-text" style="margin-top: var(--space-24);">
        <a href="./src/style-guide.html" target="_blank" rel="noopener">Style guide</a> · v0.4.0
      </p>
    </section>
  `;

  container.querySelectorAll('[data-go]').forEach((b) => {
    b.addEventListener('click', () => navigate(b.dataset.go));
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
