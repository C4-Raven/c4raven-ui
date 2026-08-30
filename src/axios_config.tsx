import axios from 'axios';

export default axios.create({
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
