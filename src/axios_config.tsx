import axios from 'axios';
import { apiRoutes } from './apiRoutes';

const instance = axios.create({
  withCredentials: true,
  // Explicitly off: axios's built-in auto-read-XSRF-cookie behavior collides
  // with an unrelated same-named "XSRF-TOKEN" cookie set elsewhere on the
  // c4raven.net domain, overriding the correct token the app already fetches
  // and attaches itself via request interceptors.
  withXSRFToken: false,
  maxRedirects: 0,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

// Fetches a CSRF token and attaches it to every request via defaults.headers.common
// (axios applies that to all methods automatically, no interceptor needed). Must run
// once for every session regardless of whether the user submits the login form —
// a session that's already authenticated when the app loads (refresh, reopened
// tab, bookmark) never renders Login.tsx, so this can't only live there.
export function refreshCsrfToken(): Promise<string> {
    return instance.get(apiRoutes.login, { headers: { 'Content-Type': 'application/json' } })
        .then(r => {
            const token = r.data.response.csrf_token;
            if (token !== '') {
                instance.defaults.headers.common['X-XSRF-Token'] = token;
            }
            return token;
        });
}

// The token is fetched once at app load. If that fetch failed (e.g. the page
// loaded while the server was restarting and /api/login returned 502), every
// CSRF-protected request fails with "The CSRF token is missing." until a full
// reload -- so fetch it before the first write that needs it, and fetch a fresh
// one and retry once if the server rejects the token anyway.
const SAFE_METHODS = ['get', 'head', 'options'];
instance.interceptors.request.use(async (config) => {
    const method = (config.method ?? 'get').toLowerCase();
    if (!SAFE_METHODS.includes(method) && !instance.defaults.headers.common['X-XSRF-Token']
        && config.url !== apiRoutes.login) {
        try {
            const token = await refreshCsrfToken();
            if (token) {
                config.headers.set('X-XSRF-Token', token);
            }
        } catch {
            // Let the request go ahead and fail with the server's error.
        }
    }
    return config;
});
instance.interceptors.response.use((r) => r, async (error) => {
    const config = error?.config;
    const errors: unknown = error?.response?.data?.response?.errors;
    const csrfRejected = error?.response?.status === 400 && Array.isArray(errors)
        && errors.some((e) => typeof e === 'string' && e.includes('CSRF'));
    if (!csrfRejected || !config || config._csrfRetried) {
        return Promise.reject(error);
    }
    config._csrfRetried = true;
    const token = await refreshCsrfToken();
    config.headers.set('X-XSRF-Token', token);
    return instance.request(config);
});

// PrivateRoute only ever checks localStorage's "loggedIn" flag, set once at
// login and never re-verified -- if the server session later expires or is
// otherwise invalidated (cookie cleared, server restart, plain timeout)
// while that flag is still "true", every page keeps rendering as if
// authenticated, and every request it fires just 401s forever with nothing
// to send the user back to the login page. Catch that centrally instead of
// relying on each of the ~20 pages that call the API to handle it
// themselves. Registered on both axios instances used across the app (this
// wrapped one, and the plain default axios import several pages use
// directly) since interceptors don't cross between them.
function redirectToLoginOn401(error: any) {
    if (error?.response?.status === 401 && window.location.pathname !== '/login') {
        localStorage.removeItem('loggedIn');
        window.location.href = '/login';
    }
    return Promise.reject(error);
}
axios.interceptors.response.use((r) => r, redirectToLoginOn401);
instance.interceptors.response.use((r) => r, redirectToLoginOn401);

export default instance;
