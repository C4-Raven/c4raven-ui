import axios from '../../../axios_config';
import { extractError } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { buildSaveBody, removeEntitiesForCa, normalizePolicy, pollUntil } from './helpers';
import type { CaGroup, Federation, PolicyCore, TokenEntry } from './types';

/**
 * Human-readable error. The hub's own error bodies are proxied as raw text,
 * so a string body is the best message we have (better than axios's
 * "Request failed with status code 400").
 */
export async function errorText(err: any): Promise<string> {
    const data = err?.response?.data;
    if (typeof data === 'string' && data.trim()) {
        return data.trim().slice(0, 300);
    }
    return (await extractError(err)) ?? String(err);
}

/**
 * Save the whole policy model; `activate` makes the hub enforce it (POST /policy?activate=1).
 * The server refuses (400 own_ca_missing_from_policy) to activate a policy without this hub's
 * own CA node unless `forceWithoutOwnCa` (force_without_own_ca=1) is set after a typed confirm.
 */
export async function savePolicy(federation: Federation, policy: PolicyCore, activate: boolean, forceWithoutOwnCa = false): Promise<void> {
    const params = activate ? { activate: 1, ...(forceWithoutOwnCa ? { force_without_own_ca: 1 } : {}) } : undefined;
    await axios.post(endpoints.policy, buildSaveBody(federation, policy), { params });
}

/** The server's error code, if the body is one of its JSON errors. */
export function errorCode(err: any): string | null {
    const data = err?.response?.data;
    if (data && typeof data === 'object' && typeof data.code === 'string') { return data.code; }
    if (typeof data === 'string') {
        try { const j = JSON.parse(data); return typeof j?.code === 'string' ? j.code : null; } catch { return null; }
    }
    return null;
}

/** Make a stored policy active. The server refuses one without our own CA node unless `forceWithoutOwnCa`. */
export async function activatePolicy(name: string, forceWithoutOwnCa = false): Promise<void> {
    await axios.post(endpoints.activateFederation(name), undefined, { params: forceWithoutOwnCa ? { force_without_own_ca: 1 } : undefined });
}

/** The active policy, or null when the hub has none (it answers 4xx in that case). */
export async function fetchActivePolicy(): Promise<Federation | null> {
    try {
        const r = await axios.get<Federation>(endpoints.policy);
        return r.data && typeof r.data === 'object' && r.data.name ? r.data : null;
    } catch (err: any) {
        const status = err?.response?.status;
        if (status && status >= 400 && status < 500) { return null; }
        throw err;
    }
}

/** The stored copy of the active policy (has views/plugins; the in-memory one can lag, G20). */
export async function fetchStoredActive(): Promise<Federation | null> {
    const active = await fetchActivePolicy();
    if (!active) { return null; }
    try {
        const r = await axios.get<Federation>(endpoints.federation(active.name));
        return r.data?.name ? { ...r.data, policy: active.policy ?? r.data.policy } : active;
    } catch {
        return active;
    }
}

/**
 * Delete a trusted CA the safe way (G11): first drop its policy nodes and
 * their rules from the ACTIVE policy and re-activate, THEN remove it from the
 * truststore. Returns how many nodes/rules were taken out of the policy.
 */
export async function deleteCaSafely(ca: CaGroup): Promise<{ nodes: number; rules: number }> {
    if (ca.hubGroup) { throw new OwnCaDeleteRefused(); }
    const active = await fetchStoredActive();
    let nodes = 0;
    let rules = 0;
    if (active) {
        const result = removeEntitiesForCa(normalizePolicy(active.policy), ca.uid);
        nodes = result.removedEntities.length;
        rules = result.removedRules.length;
        if (nodes > 0 || rules > 0) {
            await savePolicy(active, result.policy, true);
        }
    }
    try {
        await axios.delete(endpoints.caGroup(ca.uid));
    } catch (err) {
        if (nodes > 0 || rules > 0) {
            // Half done: the policy no longer uses the CA, but the hub still trusts it.
            throw new CaDeleteHalfDone(nodes, rules, err);
        }
        throw err;
    }
    return { nodes, rules };
}

/** deleteCaSafely refuses this hub's own CA; the caller shows the (translated) reason. */
export class OwnCaDeleteRefused extends Error {
    constructor() {
        super('own CA');
    }
}

/** Thrown when the policy step of deleteCaSafely was applied but the CA delete itself failed. */
export class CaDeleteHalfDone extends Error {
    constructor(public nodes: number, public rules: number, public reason: unknown) {
        super('policy updated, CA not removed');
    }
}

/** The override: delete a CA the active policy still uses (?force=1), after a typed confirm. */
export async function forceDeleteCa(uid: string): Promise<void> {
    await axios.delete(endpoints.caGroup(uid), { params: { force: 1 } });
}

/** Node names on a 409 ca_in_use. */
export function caInUseNodes(err: any): string[] {
    const data = err?.response?.data;
    const nodes = data && typeof data === 'object' ? data.nodes : null;
    return Array.isArray(nodes) ? nodes.map(String) : [];
}

/** Wait for the hub to answer again after a broker restart. */
export async function waitForHub(isCancelled: () => boolean): Promise<boolean> {
    return pollUntil(async () => {
        try {
            const r = await axios.get(endpoints.overview, { timeout: 8000 });
            return r.data?.hub?.reachable === true;
        } catch (err: any) {
            // Older server without /overview: fall back to a plain hub call.
            if (err?.response?.status === 404) {
                await axios.get(endpoints.connections, { timeout: 8000 });
                return true;
            }
            return false;
        }
    }, { intervalMs: 3000, initialDelayMs: 4000, timeoutMs: 180000, isCancelled });
}

export async function generateToken(body: { clientFingerprint: string; clientGroup: string; expiration: number }): Promise<TokenEntry> {
    const r = await axios.post<TokenEntry>(endpoints.tokens, body);
    return r.data;
}

/** Save a text blob (export) through a temporary link. */
export function saveText(text: string, filename: string, type = 'text/plain') {
    const href = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}
