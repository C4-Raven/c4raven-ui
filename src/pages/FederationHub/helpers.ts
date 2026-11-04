/**
 * Pure helpers for the Federation Hub page (no React, no network) so they can
 * be unit tested. Anything user-facing goes through the `t` passed in; the
 * English text is the i18n key.
 */
import type {
    CaInspect,
    CheckItem,
    CheckLevel,
    Direction,
    Handoff,
    Overview,
    Partner,
    PartnerErrorBody,
    PartnerKind,
    PartnerStatus,
    ShareFilter,
    ShareType,
} from './types';

export type T = (key: string, options?: Record<string, unknown>) => string;

const HOSTNAME_LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9A-Fa-f:.]+$/;

/**
 * A bare host name or IP, exactly as written in the other server's
 * certificate. Returns an error message, or undefined when it is fine.
 */
export function validateHost(raw: string, t: T): string | undefined {
    const host = raw.trim();
    if (!host) { return t('Enter the other server\'s address'); }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) {
        return t('Leave out http:// or https://. Enter just the name or IP, e.g. fed.example.org');
    }
    if (/\s/.test(host)) { return t('The address cannot contain spaces'); }
    if (host.includes('/')) { return t('Enter just the server name or IP, without a path'); }
    if (host.includes(':')) {
        const bare = host.replace(/^\[|\]$/g, '');
        // "name:9102" is a host with a port typed into the wrong box.
        if (/^[^:]+:\d+$/.test(host)) { return t('Put the port number in the Port box, not in the address'); }
        if (IPV6.test(bare) && bare.split(':').length >= 3) { return undefined; }
        return t('This doesn\'t look like a valid server name or IP address');
    }
    if (/^[\d.]+$/.test(host)) {
        return IPV4.test(host) ? undefined : t('This doesn\'t look like a valid IP address');
    }
    const name = host.endsWith('.') ? host.slice(0, -1) : host;
    if (name.length > 253 || !name.split('.').every((label) => HOSTNAME_LABEL.test(label))) {
        return t('This doesn\'t look like a valid server name or IP address');
    }
    return undefined;
}

export function validatePort(port: number | string | null | undefined, t: T): string | undefined {
    if (port === '' || port === null || port === undefined) { return t('Enter a port number'); }
    const n = typeof port === 'number' ? port : Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) { return t('The port must be a whole number from 1 to 65535'); }
    return undefined;
}

/** Display names must be present, short, and unique among partners (ignoring case). */
export function validateName(raw: string, existing: string[], t: T): string | undefined {
    const name = raw.trim();
    if (!name) { return t('Give this partner a name you will recognise, e.g. "Raven North"'); }
    if (name.length > 64) { return t('Keep the name under 64 characters'); }
    const lower = name.toLowerCase();
    if (existing.some((n) => n.trim().toLowerCase() === lower)) {
        return t('Another partner already has this name');
    }
    return undefined;
}

export interface StatusView {
    color: string;
    label: string;
    /** Animate the dot (only for a live link). */
    pulse: boolean;
    description: string;
}

export function statusView(status: PartnerStatus, t: T): StatusView {
    switch (status) {
        case 'connected':
            return { color: 'green', label: t('Connected'), pulse: true, description: t('The link is up and the hub can exchange data with this partner.') };
        case 'waiting':
            return { color: 'yellow', label: t('Waiting'), pulse: false, description: t('Set up on this hub, but no connection yet. The other side may still need to finish their part.') };
        case 'disabled':
            return { color: 'gray', label: t('Turned off'), pulse: false, description: t('Paused. Nothing is exchanged until you turn it back on.') };
        case 'error':
        default:
            return { color: 'red', label: t('Needs attention'), pulse: false, description: t('Something is stopping this link. Run "Check connection" to see what.') };
    }
}

export interface ShareSummary {
    label: string;
    color: string;
    detail: string;
}

/** "All groups" / "3 allowed" / "2 blocked" / "3 allowed, 1 blocked" / "Nothing". */
export function shareSummary(filter: ShareFilter | null | undefined, t: T): ShareSummary {
    const f = filter ?? { type: 'allGroups' as ShareType, allowed: [], disallowed: [] };
    const allowed = f.allowed?.length ?? 0;
    const blocked = f.disallowed?.length ?? 0;
    switch (f.type) {
        case 'none':
            return {
                label: t('Nothing'),
                color: 'red',
                detail: t('There is no rule for this direction, so the hub blocks all of it. Edit the partner and choose Everything to fix it.'),
            };
        case 'allowed':
            return {
                label: t('{{count}} allowed', { count: allowed }),
                color: allowed ? 'blue' : 'red',
                detail: allowed ? t('Only: {{groups}}', { groups: f.allowed.join(', ') }) : t('No groups allowed, so nothing flows'),
            };
        case 'disallowed':
            return {
                label: t('{{count}} blocked', { count: blocked }),
                color: 'orange',
                detail: blocked ? t('Everything except: {{groups}}', { groups: f.disallowed.join(', ') }) : t('Nothing blocked'),
            };
        case 'allowedAndDisallowed':
            return {
                label: t('{{allowed}} allowed, {{blocked}} blocked', { allowed, blocked }),
                color: allowed ? 'blue' : 'red',
                detail: t('Only {{allowedGroups}}, never {{blockedGroups}}', {
                    allowedGroups: f.allowed.join(', ') || '—',
                    blockedGroups: f.disallowed.join(', ') || '—',
                }),
            };
        case 'allGroups':
        default:
            return { label: t('All groups'), color: 'teal', detail: t('Every group is shared') };
    }
}

/** Plain-English sentence for the review step. */
export function shareSentence(filter: ShareFilter, t: T): string {
    switch (filter.type) {
        case 'allowed':
            return t('only these groups: {{groups}}', { groups: filter.allowed.join(', ') });
        case 'disallowed':
            return t('everything except these groups: {{groups}}', { groups: filter.disallowed.join(', ') });
        case 'allowedAndDisallowed':
            return t('only {{allowedGroups}}, and never {{blockedGroups}}', {
                allowedGroups: filter.allowed.join(', '),
                blockedGroups: filter.disallowed.join(', '),
            });
        case 'none':
            return t('nothing (no rule, so the hub blocks it)');
        default:
            return t('everything');
    }
}

/** A filter that names groups needs at least one group in each list it uses. */
export function validateFilter(filter: ShareFilter, t: T): string | undefined {
    // 'none' is only ever read from the server; an unchanged filter isn't sent back, so it isn't an error here.
    const needsAllowed = filter.type === 'allowed' || filter.type === 'allowedAndDisallowed';
    const needsBlocked = filter.type === 'disallowed' || filter.type === 'allowedAndDisallowed';
    if (needsAllowed && filter.allowed.length === 0) { return t('Add at least one allowed group, or choose Everything'); }
    if (needsBlocked && filter.disallowed.length === 0) { return t('Add at least one blocked group, or choose Everything'); }
    return undefined;
}

/**
 * G12: Raven's bridge never labels traffic with federation groups, so any
 * edge whose SOURCE is a Raven must be allGroups or nothing flows. Our share
 * (own -> partner) always starts at this Raven; the receive edge starts at
 * the partner, which matters when the partner is a Raven too.
 */
export function filterWarnings(kind: PartnerKind, share: ShareFilter, receive: ShareFilter): { share: boolean; receive: boolean } {
    // 'none' (no rule at all) gets its own, stronger message; it isn't a group filter.
    const grouped = (f: ShareFilter) => f.type !== 'allGroups' && f.type !== 'none';
    return {
        share: grouped(share),
        receive: kind === 'raven_hub' && grouped(receive),
    };
}

function hexOf(sha256: string | null | undefined): string {
    return (sha256 || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/** Colon hex, the way TAK Server and openssl print fingerprints. */
export function formatFingerprint(sha256: string | null | undefined): string {
    return (hexOf(sha256).match(/.{1,2}/g) ?? []).join(':');
}

/** "FD:5C:14:9A…3E:01:7B:C2": enough to compare by eye, full value in the tooltip. */
export function shortFingerprint(sha256: string | null | undefined): string {
    const hex = hexOf(sha256);
    if (hex.length <= 16) { return formatFingerprint(hex); }
    const pairs = (s: string) => (s.match(/.{1,2}/g) ?? []).join(':');
    return `${pairs(hex.slice(0, 8))}…${pairs(hex.slice(-8))}`;
}

/** CN from an RFC 2253 / OpenSSL-style subject, if any. */
export function commonName(subject: string | null | undefined): string {
    if (!subject) { return ''; }
    const m = /(?:^|[,/]\s*)CN\s*=\s*([^,/]+)/i.exec(subject);
    return m ? m[1].trim() : '';
}

/** Every Raven hub CA uses this CN (G7), so it says nothing about which server it is. */
export const GENERIC_RAVEN_CN = 'C4Raven-FedHub-CA';

export function suggestedName(ca: CaInspect | null): string {
    const cn = commonName(ca?.subject);
    return cn && cn !== GENERIC_RAVEN_CN ? cn : '';
}

export const CA_MAX_BYTES = 1024 * 1024;
export const CA_EXPIRY_WARN_DAYS = 30;

export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
    if (!iso) { return null; }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) { return null; }
    return Math.floor((d.getTime() - now.getTime()) / 86_400_000);
}

export interface CaWarning { level: 'error' | 'warning' | 'info'; text: string }

/** What the wizard should say about an uploaded certificate. */
export function caWarnings(ca: CaInspect, partners: Pick<Partner, 'id' | 'name'>[], t: T, now: Date = new Date()): CaWarning[] {
    const out: CaWarning[] = [];
    if (ca.is_own) {
        out.push({
            level: 'error',
            text: t('This is our own certificate, the one this hub uses. Upload the other server\'s CA certificate instead.'),
        });
    } else if (ca.existing_partner_id) {
        const p = partners.find((x) => x.id === ca.existing_partner_id);
        out.push({
            level: 'error',
            text: t('This certificate already belongs to the partner "{{name}}". Edit that partner instead of adding it twice.', { name: p?.name ?? ca.existing_partner_id }),
        });
    } else if (ca.already_trusted) {
        out.push({ level: 'info', text: t('This hub already trusts this certificate. It will be reused, not uploaded again.') });
    }
    if (!ca.is_ca) {
        out.push({
            level: 'warning',
            text: t('This is not a certificate authority. Ask for the CA that issued their server certificate (often ca.pem), not the server certificate itself.'),
        });
    }
    const days = typeof ca.days_left === 'number' ? ca.days_left : daysUntil(ca.not_after, now);
    if (days !== null && days <= 0) {
        out.push({ level: 'error', text: t('This certificate has expired. Ask the other admin for a current one.') });
    } else if (days !== null && days <= CA_EXPIRY_WARN_DAYS) {
        out.push({ level: 'warning', text: t('This certificate expires in {{count}} days. The link stops working when it does.', { count: days }) });
    }
    return out;
}

export function sameHostPort(a: { host: string; port: number }, b: { host: string; port: number }): boolean {
    return a.host.trim().toLowerCase() === b.host.trim().toLowerCase() && Number(a.port) === Number(b.port);
}

/** The partner (if any) that already dials this host:port. */
export function outgoingClash(host: string, port: number, partners: Partner[], exceptId?: string): Partner | undefined {
    return partners.find((p) => p.id !== exceptId && p.outgoing && sameHostPort(p.outgoing, { host, port }));
}

export function directionLabel(p: Pick<Partner, 'direction' | 'outgoing'>, t: T): string {
    if (p.direction === 'we_dial' && p.outgoing) {
        return t('We dial {{address}}', { address: `${p.outgoing.host}:${p.outgoing.port}` });
    }
    return p.direction === 'we_dial' ? t('We dial them') : t('They dial us');
}

export function kindLabel(kind: PartnerKind, t: T): string {
    switch (kind) {
        case 'raven_hub': return t('Raven with its own hub');
        case 'tak_server': return t('TAK Server');
        default: return t('Other federation hub');
    }
}

/** Every problem code the server sends, overview-level and per partner (see types.ts). */
const PROBLEM_TEXT: Record<string, string> = {
    // overview
    hub_unreachable: 'The Federation Hub is not answering. It may be stopped or still starting up, so nothing is federated right now.',
    hub_error: 'The Federation Hub answered with an error, so this page can\'t show its state.',
    own_ca_unknown: 'The Federation Hub doesn\'t report its own certificate. Its installation may be incomplete.',
    no_active_policy: 'The Federation Hub has no active policy, so it doesn\'t pass anything between servers. Activate a stored policy, or press Repair to create one if there is none.',
    own_ca_missing: 'This hub\'s own certificate is missing from the active policy, so the hub refuses this Raven\'s own bridge and nothing is federated.',
    bridge_not_connected: 'This Raven\'s own bridge is not connected to the hub, so local devices are not federated.',
    // partner
    ca_not_trusted: 'The hub no longer trusts this partner\'s certificate, so it refuses their connection.',
    no_rule_out: 'Nothing is sent to this partner: the active policy has no rule for it.',
    no_rule_in: 'Nothing is accepted from this partner: the active policy has no rule for it.',
    filter_not_all_groups: 'A group filter is set on traffic from a Raven. Raven doesn\'t label traffic with groups, so nothing passes the filter. Share Everything instead.',
    both_sides_dial: 'Both servers are dialling each other. The hub drops the duplicate, so the link keeps dropping. Turn off the connection on one side.',
    ca_expired: 'This partner\'s certificate has expired.',
    ca_expiring: 'This partner\'s certificate expires soon.',
};

/** Problems that stop traffic (red); the rest are warnings (yellow). */
const BLOCKING_PROBLEMS = new Set([
    'hub_unreachable', 'hub_error', 'own_ca_unknown', 'no_active_policy', 'own_ca_missing',
    'ca_not_trusted', 'no_rule_out', 'no_rule_in', 'both_sides_dial', 'ca_expired',
]);

export function isKnownProblem(code: string): boolean {
    return code in PROBLEM_TEXT;
}

export function problemColor(code: string): 'red' | 'yellow' {
    return BLOCKING_PROBLEMS.has(code) ? 'red' : 'yellow';
}

/** Plain-English text for a problem code (unknown codes are made readable). */
export function problemText(code: string, t: T): string {
    const known = PROBLEM_TEXT[code];
    if (known) { return t(known); }
    const spaced = code.replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The overview says the hub is down (reachable false), as opposed to the request failing. */
export function hubDown(overview: Pick<Overview, 'hub'> | null | undefined): boolean {
    return !!overview && !overview.hub?.reachable;
}

/** An outgoing connection not linked to any trusted CA (made in the native console, G-live "VPN Server"). */
export function isUnlinkedOutgoing(p: Pick<Partner, 'direction' | 'ca'>): boolean {
    return p.direction === 'we_dial' && !p.ca;
}

export function unlinkedOutgoingHint(t: T): string {
    return t('This outgoing connection isn\'t linked to a trusted certificate, so Raven can\'t tell which partner it belongs to. It was probably made in the hub\'s own console. If the other side also connects to you, remove one: only one side should connect.');
}

/** Check codes in the order the server returns them; used to show placeholders before the first result. */
export const CHECK_ORDER = [
    'ca_trusted', 'ca_in_policy', 'rules_out', 'rules_in', 'filter_compatible', 'dial_direction',
    'dns', 'tcp', 'connected', 'traffic_flowing', 'ca_expiry',
] as const;

/** Level of a check; older servers sent only `ok`. */
export function checkLevel(c: Pick<CheckItem, 'ok'> & { level?: CheckLevel | string }): CheckLevel {
    if (c.level === 'ok' || c.level === 'warning' || c.level === 'error' || c.level === 'skipped') { return c.level; }
    return c.ok ? 'ok' : 'error';
}

export interface CheckView {
    level: CheckLevel;
    color: 'green' | 'yellow' | 'red' | 'gray';
    label: string;
    /** Show the fix line (only for warnings and errors). */
    showFix: boolean;
}

export function checkView(c: Pick<CheckItem, 'ok'> & { level?: CheckLevel | string }, t: T): CheckView {
    switch (checkLevel(c)) {
        case 'ok': return { level: 'ok', color: 'green', label: t('Passed'), showFix: false };
        case 'warning': return { level: 'warning', color: 'yellow', label: t('Warning'), showFix: true };
        case 'skipped': return { level: 'skipped', color: 'gray', label: t('Not applicable'), showFix: false };
        default: return { level: 'error', color: 'red', label: t('Failed'), showFix: true };
    }
}

/** Skipped checks don't count towards the total. */
export function checksSummary(checks: (Pick<CheckItem, 'code' | 'ok'> & { level?: CheckLevel | string })[]): {
    total: number; passed: number; warnings: string[]; failed: string[]; skipped: number; connected: boolean;
} {
    const levels = checks.map((c) => ({ code: c.code, level: checkLevel(c) }));
    return {
        total: levels.filter((c) => c.level !== 'skipped').length,
        passed: levels.filter((c) => c.level === 'ok').length,
        warnings: levels.filter((c) => c.level === 'warning').map((c) => c.code),
        failed: levels.filter((c) => c.level === 'error').map((c) => c.code),
        skipped: levels.filter((c) => c.level === 'skipped').length,
        connected: levels.some((c) => c.code === 'connected' && c.level === 'ok'),
    };
}

/* --------------------------------------------------------- server errors */

export interface PartnerErrorView {
    code: string | null;
    message: string;
    /** For *_exists: the partner to open instead. */
    existingPartnerId: string | null;
    /** For no_active_policy: stored policies the admin can activate, then retry. */
    policies: string[];
    /** The hub may be left half changed: point the admin at Advanced. */
    halfChanged: boolean;
}

const HALF_CHANGED_CODES = new Set(['rollback_failed', 'partially_applied']);

/**
 * Plain-English text for every error code the partner routes can return
 * (the contract test checks this against the server source). For most codes
 * the server's own message is more specific (it names the field or the
 * hub's answer) and is shown instead; this text is the fallback.
 */
const ERROR_TEXT: Record<string, string> = {
    address_not_allowed: 'Raven doesn\'t test loopback, link-local, multicast or unspecified addresses. Use the other server\'s real address.',
    bad_certificate: 'That certificate is damaged or uses a format the hub can\'t read.',
    busy: 'Another change to the Federation Hub is in progress. Wait a moment and try again.',
    ca_exists: 'A partner with this certificate is already connected. Open it instead of adding it twice.',
    ca_in_use: 'The active policy still uses this certificate. Remove those nodes from the policy first, or remove it from Advanced, Certificates, which does that for you.',
    ca_not_added: 'The Federation Hub didn\'t keep the certificate. Nothing was changed.',
    ca_not_found: 'That certificate isn\'t trusted by the hub yet. Upload the file instead.',
    hub_error: 'The Federation Hub refused the request.',
    hub_timeout: 'The Federation Hub took too long to answer. Try again in a moment.',
    hub_unreachable: 'The Federation Hub is not answering. It may be stopped or still starting up.',
    invalid_ca: 'Choose the other server\'s CA certificate file.',
    invalid_direction: 'Choose who connects: we connect to them, or they connect to us.',
    invalid_expiration: 'The expiry must be a time in milliseconds, or -1 for never.',
    invalid_filter: 'The sharing setting isn\'t valid. Choose Everything, or list at least one group.',
    invalid_format: 'Choose JSON or YAML.',
    invalid_host: 'Enter just the other server\'s name or IP address.',
    invalid_kind: 'Choose what kind of server this is.',
    invalid_name: 'Give the partner a name of up to 100 characters.',
    invalid_policy: 'The policy is incomplete: it needs a name and a graph.',
    invalid_port: 'The port must be a whole number from 1 to 65535.',
    invalid_request: 'The request was incomplete. Reload the page and try again.',
    invalid_value: 'One of the settings has a value the server doesn\'t accept.',
    multiple_certs: 'The file holds more than one certificate. Upload only the CA certificate.',
    needs_ca: 'Upload the other server\'s CA certificate first.',
    no_active_policy: 'No federation policy is active on the hub.',
    not_applied: 'The Federation Hub accepted the change but isn\'t enforcing it.',
    not_dialing: 'This hub doesn\'t connect to that server, so there is nothing to change.',
    not_found: 'That partner isn\'t in the active policy any more. Reload the page.',
    nothing_to_change: 'Nothing was changed.',
    outgoing_exists: 'This hub already connects to that address.',
    own_ca: 'That is this hub\'s own certificate. Upload the other server\'s CA certificate instead.',
    own_ca_missing_from_policy: 'This policy leaves out this server\'s own certificate, so this Raven\'s own bridge would be cut off.',
    own_ca_unknown: 'The Federation Hub doesn\'t report its own certificate. Its installation may be incomplete.',
    partially_applied: 'The Federation Hub may already be enforcing part of this change. The policy and certificate were left in place.',
    rollback_failed: 'The Federation Hub may be half changed: the change failed and the previous policy couldn\'t be restored.',
    they_already_dial: 'That server is already connected to us, so we mustn\'t connect to it as well. Choose "They connect to us".',
};

export function isKnownError(code: string): boolean {
    return code in ERROR_TEXT;
}

/** Our own wording for an error code (unknown codes are made readable, never shown raw). */
export function errorText(code: string, t: T): string {
    const known = ERROR_TEXT[code];
    if (known) { return t(known); }
    const spaced = code.replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Stored policy names on a no_active_policy error (accepts the field names the server has used). */
export function storedPolicyNames(body: Record<string, unknown> | null | undefined): string[] {
    const raw = body?.stored_policies ?? body?.policies;
    if (!Array.isArray(raw)) { return []; }
    return raw
        .map((p) => (typeof p === 'string' ? p : (p && typeof p === 'object' && typeof (p as any).name === 'string' ? (p as any).name : '')))
        .filter(Boolean);
}

/**
 * Friendly text for an error body from the partner routes. Known codes get
 * our own wording (with the partner's name when we know it); anything else
 * shows the server's message, which is already plain English.
 */
export function partnerErrorView(
    body: Partial<PartnerErrorBody> | null | undefined,
    partners: Pick<Partner, 'id' | 'name'>[],
    t: T,
    fallback?: string,
): PartnerErrorView {
    const code = typeof body?.code === 'string' ? body.code : null;
    const existingPartnerId = body?.existing_partner_id ?? null;
    const name = partners.find((p) => p.id === existingPartnerId)?.name;
    const serverText = typeof body?.error === 'string' && body.error ? body.error : undefined;
    let message: string | undefined;
    switch (code) {
        case 'ca_exists':
            message = name
                ? t('This certificate already belongs to the partner "{{name}}". Open it instead of adding it twice.', { name })
                : t('A partner with this certificate is already connected. Open it instead of adding it twice.');
            break;
        case 'own_ca':
            message = t('That is this hub\'s own certificate. Upload the other server\'s CA certificate instead.');
            break;
        case 'outgoing_exists':
            message = name
                ? t('This hub already connects to that address for the partner "{{name}}". Open it, or use a different address.', { name })
                : t('This hub already connects to that address. Use a different address, or edit the existing connection.');
            break;
        case 'they_already_dial':
            message = t('That server is already connected to us, so we mustn\'t connect to it as well. Go back to "Who connects" and choose "They connect to us".');
            break;
        case 'busy':
            message = t('Another change to the Federation Hub is in progress. Wait a moment and try again.');
            break;
        case 'no_active_policy': {
            const names = storedPolicyNames(body as Record<string, unknown>);
            message = names.length
                ? t('No federation policy is active on the hub. Activate one of: {{names}}', { names: names.join(', ') })
                : t('No federation policy is active on the hub, and none is stored. Create one under Advanced, Policy.');
            break;
        }
        case 'own_ca_missing_from_policy':
            message = t('This policy leaves out this server\'s own certificate. Applying it would cut off this Raven\'s own bridge, so nothing from this server would be federated.');
            break;
        case 'partially_applied':
        case 'rollback_failed':
            // The server names what failed; keep it, and the alert adds the Advanced link.
            message = serverText ?? errorText(code, t);
            break;
        default:
            message = serverText ?? (code ? errorText(code, t) : undefined);
    }
    // rollback_failed / partially_applied (500): the server says the hub may be left half changed.
    // A rollback_failed *flag* on another code means a CA couldn't be removed again after a failed create.
    const halfChanged = HALF_CHANGED_CODES.has(code ?? '') || !!body?.rollback_failed;
    if (body?.rollback_failed && !HALF_CHANGED_CODES.has(code ?? '')) {
        message = `${message ?? fallback ?? ''} ${t('The hub couldn\'t be put back completely.')}`.trim();
    }
    return {
        code,
        message: message ?? fallback ?? t('The hub rejected the change'),
        existingPartnerId: code === 'ca_exists' || code === 'outgoing_exists' ? existingPartnerId : null,
        policies: code === 'no_active_policy' ? storedPolicyNames(body as Record<string, unknown>) : [],
        halfChanged,
    };
}

/** Pulls the JSON error body out of an axios error (it may be a Blob for downloads). */
export async function errorBody(err: any): Promise<Partial<PartnerErrorBody> | null> {
    const data = err?.response?.data;
    try {
        if (data instanceof Blob) { return JSON.parse(await data.text()); }
        if (typeof data === 'string') { return JSON.parse(data); }
    } catch {
        return null;
    }
    return data && typeof data === 'object' ? data : null;
}

/** errorBody + partnerErrorView for an axios error. */
export async function explainError(err: any, partners: Pick<Partner, 'id' | 'name'>[], t: T, fallback?: string): Promise<PartnerErrorView> {
    const body = await errorBody(err);
    const text = typeof err?.response?.data === 'string' && err.response.data.trim() ? err.response.data.trim().slice(0, 300) : err?.message;
    return partnerErrorView(body, partners, t, body?.error ?? text ?? fallback);
}

/* --------------------------------------------------------------- handoff */

/** What the other admin does for this kind of server, from GET /handoff. */
export function handoffSteps(handoff: Pick<Handoff, 'steps'> | null | undefined, kind: PartnerKind | null): string[] {
    if (!handoff?.steps) { return []; }
    return handoff.steps[kind ?? 'other'] ?? handoff.steps.other ?? [];
}

/** host:port partners dial, or '' when the server can't tell. */
export function ourAddressOf(src: { host: string | null; port?: number; v2_port?: number } | null | undefined): string {
    if (!src?.host) { return ''; }
    return `${src.host}:${src.port ?? src.v2_port ?? 9102}`;
}

export function formatCount(n: number | null | undefined): string {
    const v = Number(n) || 0;
    if (v < 1000) { return String(v); }
    if (v < 1_000_000) { return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`; }
    return `${(v / 1_000_000).toFixed(1)}M`;
}

export function formatBytes(n: number | null | undefined): string {
    const v = Number(n) || 0;
    if (v < 1024) { return `${v} B`; }
    const units = ['KiB', 'MiB', 'GiB', 'TiB'];
    let x = v / 1024;
    let i = 0;
    while (x >= 1024 && i < units.length - 1) { x /= 1024; i += 1; }
    return `${x.toFixed(x < 10 ? 1 : 0)} ${units[i]}`;
}

/* ------------------------------------------------------------------ wizard */

export type WizardStep = 'type' | 'certs' | 'connect' | 'share' | 'review';
export const WIZARD_STEPS: WizardStep[] = ['type', 'certs', 'connect', 'share', 'review'];

export interface WizardDraft {
    kind: PartnerKind | null;
    caFile: File | null;
    ca: CaInspect | null;
    caError?: string;
    name: string;
    direction: Direction;
    host: string;
    port: number | '';
    share: ShareFilter;
    receive: ShareFilter;
    interconnected: boolean;
}

export type WizardErrors = Partial<Record<'kind' | 'ca' | 'name' | 'host' | 'port' | 'share' | 'receive', string>>;

export function validateWizard(draft: WizardDraft, partners: Partner[], t: T, now: Date = new Date()): WizardErrors {
    const e: WizardErrors = {};
    if (!draft.kind) { e.kind = t('Pick what kind of server you are connecting to'); }
    if (!draft.caFile && !draft.ca) {
        e.ca = t('Upload the other server\'s CA certificate');
    } else if (draft.caError) {
        e.ca = draft.caError;
    } else if (draft.ca) {
        const blocking = caWarnings(draft.ca, partners, t, now).find((w) => w.level === 'error');
        if (blocking) { e.ca = blocking.text; }
    } else {
        e.ca = t('Wait for the certificate check to finish');
    }
    const nameErr = validateName(draft.name, partners.map((p) => p.name), t);
    if (nameErr) { e.name = nameErr; }
    if (draft.direction === 'we_dial') {
        const hostErr = validateHost(draft.host, t);
        const portErr = validatePort(draft.port, t);
        if (hostErr) { e.host = hostErr; }
        if (portErr) { e.port = portErr; }
        if (!hostErr && !portErr) {
            const clash = outgoingClash(draft.host, Number(draft.port), partners);
            if (clash) { e.host = t('The partner "{{name}}" already connects to this address', { name: clash.name }); }
        }
    }
    const shareErr = validateFilter(draft.share, t);
    const receiveErr = validateFilter(draft.receive, t);
    if (shareErr) { e.share = shareErr; }
    if (receiveErr) { e.receive = receiveErr; }
    return e;
}

export function wizardStepOf(errors: WizardErrors): WizardStep | null {
    if (errors.kind) { return 'type'; }
    if (errors.ca || errors.name) { return 'certs'; }
    if (errors.host || errors.port) { return 'connect'; }
    if (errors.share || errors.receive) { return 'share'; }
    return null;
}

export function stepHasError(step: WizardStep, errors: WizardErrors): boolean {
    switch (step) {
        case 'type': return !!errors.kind;
        case 'certs': return !!(errors.ca || errors.name);
        case 'connect': return !!(errors.host || errors.port);
        case 'share': return !!(errors.share || errors.receive);
        default: return false;
    }
}

/** Drop group lists the chosen filter type doesn't use, so the hub gets a clean rule. */
export function cleanFilter(f: ShareFilter): ShareFilter {
    const allowed = f.type === 'allowed' || f.type === 'allowedAndDisallowed' ? f.allowed.map((g) => g.trim()).filter(Boolean) : [];
    const disallowed = f.type === 'disallowed' || f.type === 'allowedAndDisallowed' ? f.disallowed.map((g) => g.trim()).filter(Boolean) : [];
    return { type: f.type, allowed, disallowed };
}

/** Multipart body for POST /api/fedhub/partners. */
export function buildCreateForm(draft: WizardDraft): FormData {
    const form = new FormData();
    form.append('name', draft.name.trim());
    form.append('kind', draft.kind ?? 'other');
    form.append('direction', draft.direction);
    if (draft.ca?.already_trusted && !draft.ca.existing_partner_id && !draft.ca.is_own && draft.ca.uid) {
        form.append('ca_uid', draft.ca.uid);
    } else if (draft.caFile) {
        form.append('ca_file', draft.caFile);
    }
    if (draft.direction === 'we_dial') {
        form.append('host', draft.host.trim());
        form.append('port', String(draft.port));
    }
    form.append('interconnected', draft.interconnected ? 'true' : 'false');
    form.append('share', JSON.stringify(cleanFilter(draft.share)));
    form.append('receive', JSON.stringify(cleanFilter(draft.receive)));
    return form;
}

/** Bullet list for the review step: exactly what will change on the hub. */
export function describeChanges(draft: WizardDraft, ctx: { policy: string | null; ourAddress: string }, t: T): string[] {
    const name = draft.name.trim() || t('the new partner');
    const lines: string[] = [];
    if (draft.ca?.already_trusted && !draft.ca.existing_partner_id) {
        lines.push(t('Reuse {{name}}\'s certificate, which this hub already trusts (fingerprint {{fp}}).', { name, fp: shortFingerprint(draft.ca.sha256) }));
    } else {
        lines.push(t('Trust {{name}}\'s certificate authority (fingerprint {{fp}}), so the hub accepts their server.', {
            name, fp: draft.ca ? shortFingerprint(draft.ca.sha256) : '—',
        }));
    }
    lines.push(t('Add {{name}} to the active policy "{{policy}}", linked both ways to this Raven.', { name, policy: ctx.policy ?? t('(none yet)') }));
    if (draft.direction === 'we_dial') {
        lines.push(t('This hub starts dialling {{address}} and keeps retrying every few seconds until they answer.', { address: `${draft.host.trim()}:${draft.port}` }));
    } else {
        lines.push(t('Nothing is dialled from here. The hub waits for {{name}} to connect to {{address}}.', { name, address: ctx.ourAddress }));
    }
    lines.push(t('Send them {{what}}.', { what: shareSentence(cleanFilter(draft.share), t) }));
    lines.push(t('Accept from them {{what}}.', { what: shareSentence(cleanFilter(draft.receive), t) }));
    if (draft.interconnected) {
        lines.push(t('Let servers that use {{name}}\'s certificate authority exchange data with each other.', { name }));
    }
    lines.push(t('Save and activate the policy straight away. Other partners stay connected.'));
    return lines;
}
