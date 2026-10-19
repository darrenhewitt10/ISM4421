// Sign in with Google, Apple (iCloud) or Yahoo through Supabase Auth.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PROVIDERS } from './config.js';

const $ = (id) => document.getElementById(id);

const PROVIDER_NAMES = { google: 'Google', apple: 'Apple', yahoo: 'Yahoo' };

let client = null;

function createClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !window.supabase) return null;
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

// ---------- Sign-in dialog ----------
function showError(message) {
  const box = $('signin-error');
  box.textContent = message || '';
  box.hidden = !message;
}

function openDialog() {
  const dialog = $('signin-dialog');
  showError(client ? '' : 'Sign-in isn’t set up yet. Add your Supabase project URL and publishable key to js/config.js.');
  setProvidersDisabled(!client);
  if (!dialog.open) dialog.showModal();
}

function setProvidersDisabled(disabled) {
  document.querySelectorAll('.provider').forEach((btn) => { btn.disabled = disabled; });
}

async function signIn(key) {
  if (!client) return;
  setProvidersDisabled(true);
  showError('');
  const { error } = await client.auth.signInWithOAuth({
    provider: PROVIDERS[key],
    options: { redirectTo: `${window.location.origin}/` },
  });
  // On success the browser is redirected to the provider, so we only get here on failure.
  if (error) {
    setProvidersDisabled(false);
    showError(`Couldn’t start ${PROVIDER_NAMES[key]} sign-in: ${error.message}`);
  }
}

// ---------- Account area in the header ----------
function displayName(user) {
  const m = user.user_metadata || {};
  return m.full_name || m.name || m.given_name || (user.email ? user.email.split('@')[0] : 'Owl');
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '🦉';
}

function renderAvatar(user, name) {
  const avatar = $('avatar');
  avatar.replaceChildren();
  avatar.textContent = initials(name);
  const url = (user.user_metadata || {}).avatar_url || (user.user_metadata || {}).picture;
  if (url && /^https:\/\//.test(url)) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => avatar.replaceChildren(img);
    img.src = url;
  }
}

function renderUser(user) {
  const signedIn = Boolean(user);
  $('signin-btn').hidden = signedIn;
  $('account').hidden = !signedIn;
  closeMenu();
  if (!signedIn) return;
  const name = displayName(user);
  $('account-name').textContent = name.split(' ')[0];
  $('account-full-name').textContent = name;
  $('account-email').textContent = user.email || '';
  const provider = (user.app_metadata || {}).provider || '';
  const key = Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === provider);
  $('account-provider').textContent = key ? `Signed in with ${PROVIDER_NAMES[key]}` : '';
  renderAvatar(user, name);
}

function closeMenu() {
  $('account-menu').hidden = true;
  $('account-btn').setAttribute('aria-expanded', 'false');
}

function toggleMenu() {
  const menu = $('account-menu');
  menu.hidden = !menu.hidden;
  $('account-btn').setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden) $('signout-btn').focus();
}

// Errors from the provider come back in the URL, e.g. ?error=access_denied&error_description=...
function readRedirectError() {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const message = params.get('error_description') || hash.get('error_description');
  if (!message && !params.has('error') && !hash.has('error')) return null;
  return message || params.get('error') || hash.get('error');
}

function cleanUrl() {
  const url = new URL(window.location.href);
  const authParams = ['code', 'error', 'error_code', 'error_description', 'state'];
  if (!authParams.some((p) => url.searchParams.has(p)) && !url.hash) return;
  authParams.forEach((p) => url.searchParams.delete(p));
  url.hash = '';
  window.history.replaceState(null, '', url.pathname + url.search);
}

// ---------- Boot ----------
export async function initAuth() {
  client = createClient();

  $('signin-btn').addEventListener('click', openDialog);
  $('signin-close').addEventListener('click', () => $('signin-dialog').close());
  $('signin-dialog').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close(); // click on backdrop
  });
  document.querySelectorAll('.provider').forEach((btn) => {
    btn.addEventListener('click', () => signIn(btn.dataset.provider));
  });

  $('account-btn').addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => {
    if (!$('account').contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('account-menu').hidden) { closeMenu(); $('account-btn').focus(); }
  });
  $('signout-btn').addEventListener('click', async () => {
    if (client) await client.auth.signOut();
    renderUser(null);
  });

  const redirectError = readRedirectError();
  if (!client) {
    renderUser(null);
    return;
  }

  client.auth.onAuthStateChange((_event, session) => renderUser(session?.user ?? null));

  // Waits for any ?code= from the provider redirect to be exchanged for a session.
  const { data, error } = await client.auth.getSession();
  renderUser(data?.session?.user ?? null);
  cleanUrl();
  if (redirectError || error) {
    openDialog();
    showError(`Sign-in didn’t finish: ${redirectError || error.message}`);
  }
}
