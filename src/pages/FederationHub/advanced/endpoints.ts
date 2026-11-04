// Every Raven route the Advanced section calls. Kept here (not in
// apiRoutes.tsx) so this folder can be built in parallel with the main page;
// the coordinator may later fold these into apiRoutes.
const BASE = '/api/fedhub';

export const endpoints = {
    overview: `${BASE}/overview`,
    nativeUrl: `${BASE}/native_url`,

    connections: `${BASE}/connections`,
    connection: (id: string) => `${BASE}/connections/${encodeURIComponent(id)}`,
    connectionGroupSets: `${BASE}/connections/groups`,

    metrics: `${BASE}/metrics`,
    plugins: `${BASE}/plugins`,
    brokerConfig: `${BASE}/config`,
    restartBroker: `${BASE}/broker/restart`,

    caGroups: `${BASE}/ca_groups`,
    caGroup: (uid: string) => `${BASE}/ca_groups/${encodeURIComponent(uid)}`,
    selfCa: `${BASE}/ca_self`,

    federations: `${BASE}/federations`,
    federation: (name: string) => `${BASE}/federations/${encodeURIComponent(name)}`,
    activateFederation: (name: string) => `${BASE}/federations/${encodeURIComponent(name)}/activate`,
    deleteFederation: (name: string) => `${BASE}/federations/${encodeURIComponent(name)}/policy`,
    exportFederation: (name: string) => `${BASE}/federations/${encodeURIComponent(name)}/export`,

    /** GET = active policy; POST = save (add `?activate=1` to save AND activate). */
    policy: `${BASE}/policy`,
    policyView: `${BASE}/policy/view`,

    knownGroups: (nodeId: string) => `${BASE}/known_groups/${encodeURIComponent(nodeId)}`,
    tokens: `${BASE}/tokens`,

    adminCert: `${BASE}/admin_cert`,
    adminCertPassword: `${BASE}/admin_cert/password`,
    adminCertVerify2fa: `${BASE}/admin_cert/verify_2fa`,
} as const;
