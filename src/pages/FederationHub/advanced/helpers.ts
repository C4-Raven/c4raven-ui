// Pure helpers for the Advanced section. No React, no network: everything
// here is unit-tested in helpers.test.ts.
import type {
    CaGroup,
    Federation,
    FilterType,
    GroupSet,
    HubConnection,
    PolicyCore,
    PolicyEntity,
    PolicyRule,
    RuleFilter,
} from './types';

export type IdFactory = () => string;
export const randomId: IdFactory = () => crypto.randomUUID();

export const ALL_GROUPS: RuleFilter = { groupsFilterType: 'allGroups', allowedGroups: [], disallowedGroups: [] };

/* ------------------------------------------------------------------ policy */

/** Hub policies come back with missing or `{}`-ified arrays; always hand out real arrays. */
export function normalizePolicy(policy: unknown): PolicyCore {
    const p = (policy && typeof policy === 'object' ? policy : {}) as Record<string, unknown>;
    return {
        ...p,
        entities: Array.isArray(p.entities) ? (p.entities as PolicyEntity[]) : [],
        rules: Array.isArray(p.rules) ? (p.rules as PolicyRule[]) : [],
        groupSets: Array.isArray(p.groupSets) ? (p.groupSets as GroupSet[]) : [],
    };
}

/** JSON.stringify with sorted object keys, so key order never counts as a change. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            return Object.keys(v).sort().reduce<Record<string, unknown>>((acc, k) => {
                acc[k] = (v as Record<string, unknown>)[k];
                return acc;
            }, {});
        }
        return v;
    });
}

/** True when the draft differs from what the hub has stored. */
export function isPolicyDirty(saved: unknown, draft: unknown): boolean {
    return stableStringify(normalizePolicy(saved)) !== stableStringify(normalizePolicy(draft));
}

/** Parse the raw-JSON editor text. Returns null on invalid JSON or a non-object. */
export function parsePolicyJson(text: string): PolicyCore | null {
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
        return normalizePolicy(parsed);
    } catch {
        return null;
    }
}

export interface RemovalResult {
    policy: PolicyCore;
    removedEntities: PolicyEntity[];
    removedRules: PolicyRule[];
}

/** Remove entities by id and every rule that touches them (no orphaned edges). */
export function removeEntities(policy: PolicyCore, ids: Iterable<string>): RemovalResult {
    const drop = new Set(ids);
    const removedEntities = policy.entities.filter((e) => drop.has(e.id));
    const removedRules = policy.rules.filter((r) => drop.has(r.source) || drop.has(r.destination));
    return {
        policy: {
            ...policy,
            entities: policy.entities.filter((e) => !drop.has(e.id)),
            rules: policy.rules.filter((r) => !drop.has(r.source) && !drop.has(r.destination)),
        },
        removedEntities,
        removedRules,
    };
}

/** Remove every node whose `name` is the given CA uid (what the native UI does before deleteGroupCa, G11). */
export function removeEntitiesForCa(policy: PolicyCore, caUid: string): RemovalResult {
    return removeEntities(policy, policy.entities.filter((e) => e.name === caUid).map((e) => e.id));
}

export function makeRule(source: string, destination: string, name: string, newId: IdFactory = randomId, filter: RuleFilter = ALL_GROUPS): PolicyRule {
    return { id: newId(), name, source, destination, filter: { ...filter, allowedGroups: [...filter.allowedGroups], disallowedGroups: [...filter.disallowedGroups] } };
}

export function entityLabel(entity: PolicyEntity | undefined, fallback = ''): string {
    if (!entity) { return fallback; }
    return entity.displayName || entity.name || entity.id;
}

export function makeCaGroupEntity(ca: CaGroup, newId: IdFactory = randomId): PolicyEntity {
    return {
        id: newId(),
        type: 'FederationGroup',
        name: ca.uid,
        displayName: ca.nickname || shortFingerprint(ca.alias),
        description: '',
        config: { interconnected: false, allowTokenAuth: false, tokenAuthDuration: -1, enabled: true },
    };
}

export function hasRule(policy: PolicyCore, source: string, destination: string): boolean {
    return policy.rules.some((r) => r.source === source && r.destination === destination);
}

/**
 * Add a trusted CA to a policy so it isn't orphaned: a FederationGroup node
 * (reused if one already names this CA) plus allGroups rules both ways with
 * the hub's own-CA node (added too if missing). Idempotent.
 */
export function addCaToPolicy(policy: PolicyCore, ca: CaGroup, ownCa: CaGroup | null, newId: IdFactory = randomId): PolicyCore {
    let next: PolicyCore = { ...policy, entities: [...policy.entities], rules: [...policy.rules] };
    const ensureNode = (c: CaGroup): PolicyEntity => {
        const existing = next.entities.find((e) => e.type === 'FederationGroup' && e.name === c.uid);
        if (existing) { return existing; }
        const created = makeCaGroupEntity(c, newId);
        next = { ...next, entities: [...next.entities, created] };
        return created;
    };
    const partner = ensureNode(ca);
    if (!ownCa || ownCa.uid === ca.uid) { return next; }
    const own = ensureNode(ownCa);
    const pairs: [PolicyEntity, PolicyEntity][] = [[own, partner], [partner, own]];
    pairs.forEach(([src, dst]) => {
        if (!hasRule(next, src.id, dst.id)) {
            next = { ...next, rules: [...next.rules, makeRule(src.id, dst.id, `${entityLabel(src)} -> ${entityLabel(dst)}`, newId)] };
        }
    });
    return next;
}

export function ownCaGroup(caGroups: CaGroup[]): CaGroup | null {
    return caGroups.find((c) => c.hubGroup) ?? null;
}

export function policyHasCa(policy: PolicyCore, caUid: string): boolean {
    return policy.entities.some((e) => e.type === 'FederationGroup' && e.name === caUid);
}

/** Rules whose source or destination node no longer exists. */
export function orphanRules(policy: PolicyCore): PolicyRule[] {
    const ids = new Set(policy.entities.map((e) => e.id));
    return policy.rules.filter((r) => !ids.has(r.source) || !ids.has(r.destination));
}

/**
 * Nodes that carry Raven traffic: the own-CA node (Raven's bridge lives in it)
 * and any node the partner flow tagged as a Raven hub.
 */
export function ravenNodeIds(policy: PolicyCore, ownCaUid: string | null): Set<string> {
    return new Set(policy.entities
        .filter((e) => (ownCaUid && e.name === ownCaUid) || e.config?.ravenKind === 'raven_hub')
        .map((e) => e.id));
}

/**
 * G12: Raven's bridge never advertises FederateGroups, so any rule leaving a
 * Raven node with a group filter other than allGroups silently drops traffic.
 */
export function filterWarnings(policy: PolicyCore, ownCaUid: string | null): PolicyRule[] {
    const raven = ravenNodeIds(policy, ownCaUid);
    return policy.rules.filter((r) => raven.has(r.source) && (r.filter?.groupsFilterType ?? 'allGroups') !== 'allGroups');
}

export function needsGroups(type: FilterType): { allowed: boolean; disallowed: boolean } {
    return {
        allowed: type === 'allowed' || type === 'allowedAndDisallowed',
        disallowed: type === 'disallowed' || type === 'allowedAndDisallowed',
    };
}

/** Split a filter's group list into group-set ids and plain group names. */
export function splitGroups(groups: string[], groupSets: GroupSet[]): { setIds: string[]; plain: string[] } {
    const setIdSet = new Set(groupSets.map((s) => s.id));
    return {
        setIds: groups.filter((g) => setIdSet.has(g)),
        plain: groups.filter((g) => !setIdSet.has(g)),
    };
}

/** Readable label for a filter value: group-set id -> set name, CA uid -> nickname. */
export function groupLabel(value: string, groupSets: GroupSet[], caGroups: CaGroup[]): string {
    const set = groupSets.find((s) => s.id === value);
    if (set) { return `${set.name} (set)`; }
    const ca = caGroups.find((c) => c.uid === value);
    if (ca) { return ca.nickname || shortFingerprint(ca.alias); }
    return value;
}

/** Remove a group set and strip its id from every rule filter that used it. */
export function removeGroupSet(policy: PolicyCore, setId: string): PolicyCore {
    return {
        ...policy,
        groupSets: policy.groupSets.filter((s) => s.id !== setId),
        rules: policy.rules.map((r) => (r.filter ? {
            ...r,
            filter: {
                ...r.filter,
                allowedGroups: (r.filter.allowedGroups ?? []).filter((g) => g !== setId),
                disallowedGroups: (r.filter.disallowedGroups ?? []).filter((g) => g !== setId),
            },
        } : r)),
    };
}

/** Body for /saveFederationPolicy: the WHOLE stored model (views/plugins kept) with the new core policy. */
export function buildSaveBody(federation: Federation, policy: PolicyCore): Federation {
    return { ...federation, version: federation.version || 'v3', policy };
}

export function blankFederation(name: string, ownCa: CaGroup | null, newId: IdFactory = randomId): Federation {
    const entities = ownCa ? [makeCaGroupEntity(ownCa, newId)] : [];
    return {
        name,
        version: 'v3',
        type: null,
        description: '',
        policy: { entities, rules: [], groupSets: [] },
        plugins: [],
        views: { graph: { nodes: [], settings: { zoom: 1, canvas_x: 0, canvas_y: 0 } } },
    };
}

/* --------------------------------------------------------------- outgoing */

export interface OutgoingForm {
    id: string;
    name: string;
    displayName: string;
    host: string;
    port: number;
    tls: boolean;
    enabled: boolean;
    useToken: boolean;
    tokenType: string;
    token: string;
}

export function blankOutgoing(newId: IdFactory = randomId): OutgoingForm {
    return { id: newId(), name: '', displayName: '', host: '', port: 9102, tls: true, enabled: true, useToken: false, tokenType: 'manual', token: '' };
}

export function outgoingFormFromEntity(e: PolicyEntity): OutgoingForm {
    const c = e.config ?? {};
    return {
        id: e.id,
        name: e.name ?? '',
        displayName: e.displayName || e.name || '',
        host: typeof c.host === 'string' ? c.host : '',
        port: typeof c.port === 'number' ? c.port : Number(c.port) || 9102,
        tls: c.tls !== false,
        enabled: c.enabled !== false,
        useToken: !!c.useToken,
        tokenType: typeof c.tokenType === 'string' && c.tokenType ? c.tokenType : 'manual',
        token: typeof c.token === 'string' ? c.token : '',
    };
}

/** Field -> error message key (English, passed through t()). Empty object = valid. */
export function validateOutgoing(f: OutgoingForm): Partial<Record<'displayName' | 'host' | 'port' | 'token', string>> {
    const errors: Partial<Record<'displayName' | 'host' | 'port' | 'token', string>> = {};
    if (!f.displayName.trim()) { errors.displayName = 'A name is required'; }
    const host = f.host.trim();
    if (!host) {
        errors.host = 'A host is required';
    } else if (/^[a-z]+:\/\//i.test(host)) {
        errors.host = 'Enter just the host name, without the https prefix';
    } else if (/\s|\//.test(host)) {
        errors.host = 'The host can\'t contain spaces or slashes';
    } else if (/^[^:[\]]+:\d+$/.test(host)) {
        errors.host = 'Put the port in the Port field, not in the host';
    }
    if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) { errors.port = 'Port must be between 1 and 65535'; }
    if (f.useToken && !f.token.trim()) { errors.token = 'Paste the token the other side gave you'; }
    return errors;
}

/**
 * Entity for a FederationOutgoing node. The hub names outgoings
 * "<displayName>_<uuid>"; keep an existing name so live connections and
 * metrics stay attributed after an edit.
 */
export function outgoingEntity(f: OutgoingForm): PolicyEntity {
    const displayName = f.displayName.trim();
    return {
        id: f.id,
        type: 'FederationOutgoing',
        displayName,
        name: f.name || `${displayName}_${f.id}`,
        description: '',
        config: {
            host: f.host.trim(),
            port: f.port,
            tls: f.tls,
            enabled: f.enabled,
            useToken: f.useToken,
            tokenType: f.useToken ? (f.tokenType || 'manual') : 'manual',
            token: f.useToken ? f.token.trim() : null,
            outgoing_uuid: null,
        },
    };
}

export function upsertEntity(policy: PolicyCore, entity: PolicyEntity): PolicyCore {
    const exists = policy.entities.some((e) => e.id === entity.id);
    return {
        ...policy,
        entities: exists ? policy.entities.map((e) => (e.id === entity.id ? entity : e)) : [...policy.entities, entity],
    };
}

export function makeTokenGroupEntity(name: string, newId: IdFactory = randomId): PolicyEntity {
    return {
        id: newId(),
        type: 'FederationTokenGroup',
        name: name.trim(),
        displayName: name.trim(),
        description: '',
        config: { expiration: -1, enabled: true, tokens: [] },
    };
}

/* ------------------------------------------------------------ connections */

export type LiveState = 'connected' | 'not_connected' | 'disabled' | 'not_active';

/** Does this live connection belong to the given policy node? */
export function connectionMatchesEntity(c: HubConnection, e: PolicyEntity): boolean {
    const name = e.name ?? '';
    if (!name) { return false; }
    if (c.remoteServerId === name) { return true; }
    if ((c.groupIdentities ?? []).includes(name)) { return true; }
    if (e.type === 'FederationOutgoing') {
        if (c.connectionId?.startsWith(name)) { return true; }
        const host = typeof e.config?.host === 'string' ? e.config.host : '';
        if (host && c.remoteAddress && (c.remoteAddress === host || c.remoteAddress.startsWith(`${host}:`))) { return true; }
    }
    return false;
}

/** Live status for a node (not just config.enabled). `policyActive` false = these edits aren't enforced. */
export function entityLiveState(e: PolicyEntity, connections: HubConnection[], policyActive: boolean): LiveState {
    if (e.config?.enabled === false) { return 'disabled'; }
    if (!policyActive) { return 'not_active'; }
    return connections.some((c) => connectionMatchesEntity(c, e)) ? 'connected' : 'not_connected';
}

export function connectionDirection(c: HubConnection): 'outgoing' | 'incoming' {
    return /CLIENT$/i.test(c.localConnectionType ?? '') ? 'outgoing' : 'incoming';
}

export function isBridgeConnection(c: HubConnection, bridgeUid = 'raven-federate'): boolean {
    return c.connectionId === bridgeUid || c.connectionId.startsWith(`${bridgeUid}-`) || c.remoteServerId === bridgeUid;
}

/* ---------------------------------------------------------------- display */

/** The hub reports heap/CPU as -1 when it isn't measuring them (G21). */
export function metricValue(n: number | null | undefined): number | null {
    if (n === null || n === undefined || Number.isNaN(n) || n < 0) { return null; }
    return n;
}

export function formatPercent(fraction: number | null | undefined): string | null {
    const v = metricValue(fraction);
    return v === null ? null : `${(v * 100).toFixed(1)}%`;
}

export function formatBytes(n: number | null | undefined): string | null {
    const v = metricValue(n);
    if (v === null) { return null; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = v;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

export function formatCount(n: number | null | undefined, digits = 0): string | null {
    const v = metricValue(n);
    return v === null ? null : v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "fd5c14..." -> "FD:5C:14:..." */
export function formatFingerprint(hex: string | null | undefined): string {
    if (!hex) { return ''; }
    const clean = hex.replace(/[^0-9a-f]/gi, '').toUpperCase();
    return clean.match(/.{1,2}/g)?.join(':') ?? '';
}

export function shortFingerprint(hex: string | null | undefined, pairs = 6): string {
    const full = formatFingerprint(hex);
    if (!full) { return ''; }
    const parts = full.split(':');
    return parts.length > pairs ? `${parts.slice(0, pairs).join(':')}…` : full;
}

/** Keep the last 4 characters so two tokens can be told apart without revealing them. */
export function maskSecret(secret: string | null | undefined): string {
    if (!secret) { return ''; }
    return `${'•'.repeat(12)}${secret.length > 8 ? secret.slice(-4) : ''}`;
}

/** Broker config keys whose values must never be displayed. */
export function isSecretKey(key: string): boolean {
    return /password|secret|passphrase/i.test(key);
}

/* ----------------------------------------------------------------- tokens */

/** Fingerprint string the native UI sends to /generateJwtToken. */
export function tokenFingerprint(label: string, nowMs: number): string {
    return `${nowMs}_${label.trim().replace(/\s+/g, '_')}_token_fingerprint`;
}

export function tokenEntries(e: PolicyEntity): { token: string; expiration: number }[] {
    const tokens = e.config?.tokens;
    return Array.isArray(tokens) ? tokens.filter((x) => x && typeof x.token === 'string') : [];
}

export function withToken(e: PolicyEntity, token: { token: string; expiration: number }): PolicyEntity {
    return { ...e, config: { ...(e.config ?? {}), tokens: [...tokenEntries(e), token] } };
}

export function withoutToken(e: PolicyEntity, token: string): PolicyEntity {
    return { ...e, config: { ...(e.config ?? {}), tokens: tokenEntries(e).filter((x) => x.token !== token) } };
}

/* ---------------------------------------------------------------- polling */

/**
 * Call `check` every `intervalMs` until it resolves true or `timeoutMs`
 * passes. A throwing check counts as "not yet". Resolves to whether it
 * succeeded. `sleep` is injectable for tests.
 */
export async function pollUntil(
    check: () => Promise<boolean>,
    { intervalMs = 3000, timeoutMs = 120000, initialDelayMs = intervalMs, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), isCancelled = () => false }: {
        intervalMs?: number;
        timeoutMs?: number;
        initialDelayMs?: number;
        sleep?: (ms: number) => Promise<void>;
        isCancelled?: () => boolean;
    } = {},
): Promise<boolean> {
    let waited = 0;
    await sleep(initialDelayMs);
    waited += initialDelayMs;
    while (!isCancelled()) {
        try {
            if (await check()) { return true; }
        } catch {
            // hub still down; keep waiting
        }
        if (waited >= timeoutMs) { return false; }
        await sleep(intervalMs);
        waited += intervalMs;
    }
    return false;
}
