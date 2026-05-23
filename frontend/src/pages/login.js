// /login — public route.
//
// Form email + password → POST /auth/login → save token + currentUser →
// navigate to the path saved in ?next= (or to '/').

import { apiPost, ApiError } from '../js/api.js';
import { setToken, setCurrentUser } from '../js/auth.js';
import { navigate } from '../js/router.js';
import { icon } from '../js/icons.js';

export function mountLogin(container, _params, query) {
  const next = query.next || '/';

  container.innerHTML = `
    <section class="container container--narrow" style="padding-block: var(--space-48);">
      <div class="card card--elevated stack-20" style="padding: var(--space-32) var(--space-24);">
        <header class="center-text stack-8">
          <p class="muted uppercase text-xs fw-600" style="letter-spacing: var(--letter-spacing-xwide);">Amodei</p>
          <h1 class="font-display text-3xl" style="margin:0">Accesso al gestionale</h1>
          <p class="muted text-sm">Usa le credenziali admin/manager/staff.</p>
        </header>

        <form id="login-form" class="stack-16" novalidate>
          <div class="form-row">
            <label class="label" for="login-email">Email</label>
            <input id="login-email" name="email" class="input" type="email"
                   autocomplete="username" inputmode="email" required />
          </div>

          <div class="form-row">
            <label class="label" for="login-password">Password</label>
            <div class="input-group">
              <input id="login-password" name="password" class="input" type="password"
                     autocomplete="current-password" required style="padding-right: 48px;" />
              <button type="button" id="toggle-pw" class="btn btn--ghost btn--icon"
                      aria-label="Mostra/Nascondi password"
                      style="position:absolute; right: 4px; top:50%; transform:translateY(-50%);">
                ${icon('eye', { size: 18 })}
              </button>
            </div>
          </div>

          <div id="login-error" class="form-help form-help--error" style="display:none"></div>

          <button id="login-submit" type="submit" class="btn btn--primary btn--lg full-width">
            <span class="btn__label">Accedi</span>
          </button>
        </form>
      </div>
    </section>
  `;

  const form = container.querySelector('#login-form');
  const emailEl = container.querySelector('#login-email');
  const pwEl = container.querySelector('#login-password');
  const errorEl = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-submit');
  const submitLabel = submitBtn.querySelector('.btn__label');
  const toggleBtn = container.querySelector('#toggle-pw');

  emailEl.focus();

  toggleBtn.addEventListener('click', () => {
    const showing = pwEl.type === 'text';
    pwEl.type = showing ? 'password' : 'text';
    toggleBtn.innerHTML = icon(showing ? 'eye' : 'eye-off', { size: 18 });
  });

  function setError(message) {
    if (!message) {
      errorEl.style.display = 'none';
      errorEl.textContent = '';
      return;
    }
    errorEl.style.display = '';
    errorEl.textContent = message;
  }

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitLabel.textContent = busy ? 'Accesso in corso…' : 'Accedi';
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setError(null);

    const email = emailEl.value.trim().toLowerCase();
    const password = pwEl.value;
    if (!email || !password) {
      setError('Inserisci email e password.');
      return;
    }

    setBusy(true);
    try {
      const res = await apiPost('/auth/login', { email, password }, { auth: false });
      setToken(res.access_token, res.user);
      setCurrentUser(res.user);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Credenziali non valide.');
      } else {
        setError(err.message || 'Errore di rete. Riprova.');
      }
    } finally {
      setBusy(false);
    }
  });
}
