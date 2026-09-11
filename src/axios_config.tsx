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
