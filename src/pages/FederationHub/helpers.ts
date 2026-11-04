/**
 * Pure helpers for the Federation Hub page (no React, no network) so they can
 * be unit tested. Anything user-facing goes through the `t` passed in; the
 * English text is the i18n key.
 */
import type { CaInspect, Direction, FilterType, Partner, PartnerKind, PartnerStatus, ShareFilter } from './types';

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

/** "All groups" / "3 allowed" / "2 blocked" / "3 allowed, 1 blocked". */
export function shareSummary(filter: ShareFilter | null | undefined, t: T): ShareSummary {
    const f = filter ?? { type: 'allGroups' as FilterType, allowed: [], disallowed: [] };
    const allowed = f.allowed?.length ?? 0;
    const blocked = f.disallowed?.length ?? 0;
    switch (f.type) {
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
        default:
            return t('everything');
    }
}

/** A filter that names groups needs at least one group in each list it uses. */
export function validateFilter(filter: ShareFilter, t: T): string | undefined {
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
    return {
        share: share.type !== 'allGroups',
        receive: kind === 'raven_hub' && receive.type !== 'allGroups',
    };
}

function hexOf(sha256: string): string {
    return (sha256 || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

/** Colon hex, the way TAK Server and openssl print fingerprints. */
export function formatFingerprint(sha256: string): string {
    return (hexOf(sha256).match(/.{1,2}/g) ?? []).join(':');
}

/** "FD:5C:14:9A…3E:01:7B:C2": enough to compare by eye, full value in the tooltip. */
export function shortFingerprint(sha256: string): string {
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
    if (ca.existing_partner_id) {
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
    const days = daysUntil(ca.not_after, now);
    if (days !== null && days < 0) {
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

const PROBLEM_TEXT: Record<string, string> = {
    own_ca_missing: 'This hub\'s own certificate is missing from the active policy, so the hub refuses this Raven\'s own bridge and nothing is federated.',
    both_sides_dial: 'Both servers are dialling each other. The hub drops the duplicate, so the link keeps dropping. Turn off the connection on one side.',
    dial_direction: 'Both servers are dialling each other. The hub drops the duplicate, so the link keeps dropping. Turn off the connection on one side.',
    ca_missing: 'This partner\'s certificate is no longer trusted by the hub.',
    ca_trusted: 'This partner\'s certificate is no longer trusted by the hub.',
    ca_in_policy: 'This partner is missing from the active policy.',
    ca_expiring: 'This partner\'s certificate expires soon.',
    ca_expiry: 'This partner\'s certificate expires soon.',
    ca_expired: 'This partner\'s certificate has expired.',
    filter_compatible: 'A group filter is set on traffic from a Raven. Raven doesn\'t label traffic with groups, so nothing passes the filter. Share Everything instead.',
    rules_out: 'Nothing is set up to be sent to this partner.',
    rules_in: 'Nothing is set up to be accepted from this partner.',
    hub_unreachable: 'The Federation Hub is not answering.',
    bridge_disconnected: 'This Raven\'s own bridge is not connected to the hub, so local devices are not federated.',
};

/** Plain-English text for a problem code (unknown codes are made readable). */
export function problemText(code: string, t: T): string {
    const known = PROBLEM_TEXT[code];
    if (known) { return t(known); }
    const spaced = code.replace(/[_-]+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Check codes in the order the server returns them; used to show placeholders before the first result. */
export const CHECK_ORDER = [
    'ca_trusted', 'ca_in_policy', 'rules_out', 'rules_in', 'filter_compatible', 'dial_direction',
    'dns', 'tcp', 'connected', 'traffic_flowing', 'ca_expiry',
] as const;

export function checksSummary(checks: { code: string; ok: boolean }[]): { total: number; passed: number; failed: string[]; connected: boolean } {
    return {
        total: checks.length,
        passed: checks.filter((c) => c.ok).length,
        failed: checks.filter((c) => !c.ok).map((c) => c.code),
        connected: checks.some((c) => c.code === 'connected' && c.ok),
    };
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
    if (draft.ca?.already_trusted && !draft.ca.existing_partner_id && draft.ca.uid) {
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
