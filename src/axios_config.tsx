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

export default instance;
