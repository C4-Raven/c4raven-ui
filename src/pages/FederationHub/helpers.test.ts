import { describe, expect, it } from 'vitest';
import {
    buildCreateForm,
    caWarnings,
    checksSummary,
    cleanFilter,
    commonName,
    describeChanges,
    filterWarnings,
    outgoingClash,
    problemText,
    shareSummary,
    shortFingerprint,
    statusView,
    suggestedName,
    validateFilter,
    validateHost,
    validateName,
    validatePort,
    stepHasError,
    validateWizard,
    wizardStepOf,
    type WizardDraft,
} from './helpers';
import { EVERYTHING, defaultPort, type CaInspect, type Partner } from './types';

/** Fake i18next t(): returns the key with {{vars}} filled in. */
const t = (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ''));

const SHA = 'ab12cd9a00112233445566778899aabbccddeeff00112233445566773e017bc2';

function partner(over: Partial<Partner> = {}): Partner {
    return {
        id: 'p1',
        name: 'Raven North',
        kind: 'raven_hub',
        direction: 'we_dial',
        ca: { uid: 'CN=x-abc', sha256: SHA, subject: 'CN=x', nickname: 'Raven North', expires: null },
        outgoing: { name: 'Raven North_1', host: 'north.example.org', port: 9102, enabled: true },
        interconnected: false,
        share: { ...EVERYTHING },
        receive: { ...EVERYTHING },
        enabled: true,
        status: 'connected',
        connections: [],
        traffic: { msgs_out: 0, msgs_in: 0, bytes_out: 0, bytes_in: 0 },
        problems: [],
        ...over,
    };
}

function ca(over: Partial<CaInspect> = {}): CaInspect {
    return {
        subject: 'CN=County-CA,O=County',
        issuer: 'CN=County-CA,O=County',
        sha256: SHA,
        uid: `CN=County-CA,O=County-${  SHA}`,
        not_after: '2030-01-01T00:00:00Z',
        is_ca: true,
        already_trusted: false,
        existing_partner_id: null,
        ...over,
    };
}

function draft(over: Partial<WizardDraft> = {}): WizardDraft {
    return {
        kind: 'raven_hub',
        caFile: new File(['x'], 'ca.pem'),
        ca: ca(),
        name: 'County',
        direction: 'we_dial',
        host: 'county.example.org',
        port: 9102,
        share: { ...EVERYTHING },
        receive: { ...EVERYTHING },
        interconnected: false,
        ...over,
    };
}

describe('validateHost', () => {
    it.each(['fed.example.org', 'tak', '192.168.10.20', 'fe80::1', '[2001:db8::1]', 'a-b.c-d.net', 'host.example.org.'])('accepts %s', (h) => {
        expect(validateHost(h, t)).toBeUndefined();
    });
    it.each([
        ['', 'Enter the other server'],
        ['https://fed.example.org', 'Leave out http://'],
        ['fed example.org', 'spaces'],
        ['fed.example.org/api', 'without a path'],
        ['fed.example.org:9102', 'Port box'],
        ['300.1.1.1', 'valid IP'],
        ['-bad.example.org', 'valid server name'],
        ['under_score.org', 'valid server name'],
    ])('rejects %s', (h, msg) => {
        expect(validateHost(h, t)).toContain(msg);
    });
});

describe('validatePort', () => {
    it('accepts 1..65535', () => {
        expect(validatePort(1, t)).toBeUndefined();
        expect(validatePort(9102, t)).toBeUndefined();
        expect(validatePort('65535', t)).toBeUndefined();
    });
    it('rejects empty, zero, too big and fractions', () => {
        expect(validatePort('', t)).toBeDefined();
        expect(validatePort(0, t)).toBeDefined();
        expect(validatePort(65536, t)).toBeDefined();
        expect(validatePort(91.5, t)).toBeDefined();
    });
});

describe('validateName', () => {
    it('requires a name', () => expect(validateName('  ', [], t)).toBeDefined());
    it('rejects long names', () => expect(validateName('x'.repeat(65), [], t)).toBeDefined());
    it('rejects duplicates ignoring case and spaces', () => {
        expect(validateName(' raven north ', ['Raven North'], t)).toContain('already');
    });
    it('accepts a unique name', () => expect(validateName('Raven South', ['Raven North'], t)).toBeUndefined());
});

describe('statusView', () => {
    it('maps every status to a badge', () => {
        expect(statusView('connected', t)).toMatchObject({ color: 'green', pulse: true, label: 'Connected' });
        expect(statusView('waiting', t)).toMatchObject({ color: 'yellow', pulse: false });
        expect(statusView('disabled', t)).toMatchObject({ color: 'gray', label: 'Turned off' });
        expect(statusView('error', t)).toMatchObject({ color: 'red' });
    });
    it('treats unknown statuses as needing attention', () => {
        expect(statusView('bogus' as never, t).color).toBe('red');
    });
});

describe('shareSummary', () => {
    it('summarises each filter type', () => {
        expect(shareSummary(EVERYTHING, t).label).toBe('All groups');
        expect(shareSummary({ type: 'allowed', allowed: ['A', 'B', 'C'], disallowed: [] }, t).label).toBe('3 allowed');
        expect(shareSummary({ type: 'disallowed', allowed: [], disallowed: ['X', 'Y'] }, t).label).toBe('2 blocked');
        expect(shareSummary({ type: 'allowedAndDisallowed', allowed: ['A'], disallowed: ['X'] }, t).label).toBe('1 allowed, 1 blocked');
    });
    it('flags an allow-list with nothing in it', () => {
        expect(shareSummary({ type: 'allowed', allowed: [], disallowed: [] }, t).color).toBe('red');
    });
    it('copes with a missing filter', () => {
        expect(shareSummary(undefined, t).label).toBe('All groups');
    });
});

describe('filters', () => {
    it('validateFilter needs groups for the lists it uses', () => {
        expect(validateFilter(EVERYTHING, t)).toBeUndefined();
        expect(validateFilter({ type: 'allowed', allowed: [], disallowed: [] }, t)).toBeDefined();
        expect(validateFilter({ type: 'allowedAndDisallowed', allowed: ['A'], disallowed: [] }, t)).toBeDefined();
    });
    it('cleanFilter drops unused lists and blanks', () => {
        expect(cleanFilter({ type: 'allowed', allowed: [' A ', ''], disallowed: ['X'] })).toEqual({ type: 'allowed', allowed: ['A'], disallowed: [] });
        expect(cleanFilter({ type: 'allGroups', allowed: ['A'], disallowed: ['X'] })).toEqual(EVERYTHING);
    });
    it('warns about group filters on Raven-sourced traffic (G12)', () => {
        const limited = { type: 'allowed' as const, allowed: ['A'], disallowed: [] };
        expect(filterWarnings('tak_server', limited, limited)).toEqual({ share: true, receive: false });
        expect(filterWarnings('raven_hub', EVERYTHING, limited)).toEqual({ share: false, receive: true });
        expect(filterWarnings('raven_hub', EVERYTHING, EVERYTHING)).toEqual({ share: false, receive: false });
    });
});

describe('fingerprints and names', () => {
    it('shortens sha256 to first and last 4 bytes', () => {
        expect(shortFingerprint(SHA)).toBe('AB:12:CD:9A…3E:01:7B:C2');
        expect(shortFingerprint(`AB:12:${  SHA.slice(4)}`)).toBe('AB:12:CD:9A…3E:01:7B:C2');
    });
    it('reads the CN and ignores the shared Raven CA name (G7)', () => {
        expect(commonName('CN=County-CA,O=County')).toBe('County-CA');
        expect(suggestedName(ca())).toBe('County-CA');
        expect(suggestedName(ca({ subject: 'CN=C4Raven-FedHub-CA,OU=C4Raven-FedHub,C=US' }))).toBe('');
    });
});

describe('caWarnings', () => {
    const now = new Date('2026-11-04T00:00:00Z');
    it('blocks a CA that already belongs to a partner', () => {
        const w = caWarnings(ca({ already_trusted: true, existing_partner_id: 'p1' }), [partner()], t, now);
        expect(w[0]).toMatchObject({ level: 'error' });
        expect(w[0].text).toContain('Raven North');
    });
    it('informs when the CA is trusted but unused', () => {
        expect(caWarnings(ca({ already_trusted: true }), [], t, now)[0].level).toBe('info');
    });
    it('warns about non-CA and soon-expiring certificates', () => {
        const w = caWarnings(ca({ is_ca: false, not_after: '2026-11-20T00:00:00Z' }), [], t, now);
        expect(w.map((x) => x.level)).toEqual(['warning', 'warning']);
    });
    it('blocks an expired certificate', () => {
        expect(caWarnings(ca({ not_after: '2026-01-01T00:00:00Z' }), [], t, now)[0].level).toBe('error');
    });
});

describe('wizard', () => {
    it('defaults by kind', () => {
        expect(defaultPort('tak_server')).toBe(9001);
        expect(defaultPort('raven_hub')).toBe(9102);
    });
    it('has no default direction: a choice is required (G6)', () => {
        for (const kind of ['raven_hub', 'tak_server', 'other'] as const) {
            const errs = validateWizard(draft({ kind, direction: null }), [], t);
            expect(errs.direction, kind).toMatch(/Choose who connects/);
            expect(wizardStepOf(errs)).toBe('connect');
            expect(stepHasError('connect', errs)).toBe(true);
        }
        expect(describeChanges(draft({ direction: null }), { policy: 'Tak', ourAddress: 'hub:9102' }, t)).toContain('Who connects is not chosen yet.');
    });
    it('accepts a complete draft', () => {
        expect(validateWizard(draft(), [], t)).toEqual({});
    });
    it('jumps to the first bad step', () => {
        expect(wizardStepOf(validateWizard(draft({ kind: null }), [], t))).toBe('type');
        expect(wizardStepOf(validateWizard(draft({ caFile: null, ca: null }), [], t))).toBe('certs');
        expect(wizardStepOf(validateWizard(draft({ host: 'https://x' }), [], t))).toBe('connect');
        expect(wizardStepOf(validateWizard(draft({ share: { type: 'allowed', allowed: [], disallowed: [] } }), [], t))).toBe('share');
    });
    it('ignores host and port when they dial us', () => {
        expect(validateWizard(draft({ direction: 'they_dial', host: '', port: '' }), [], t)).toEqual({});
    });
    it('refuses a second outgoing to the same host:port', () => {
        const errs = validateWizard(draft({ host: 'NORTH.example.org' }), [partner()], t);
        expect(errs.host).toContain('Raven North');
        expect(outgoingClash('north.example.org', 9102, [partner()], 'p1')).toBeUndefined();
    });
    it('builds the multipart body', () => {
        const form = buildCreateForm(draft({ share: { type: 'allGroups', allowed: ['junk'], disallowed: [] } }));
        expect(form.get('name')).toBe('County');
        expect(form.get('kind')).toBe('raven_hub');
        expect(form.get('direction')).toBe('we_dial');
        expect(form.get('host')).toBe('county.example.org');
        expect(form.get('port')).toBe('9102');
        expect(form.get('interconnected')).toBe('false');
        expect(form.get('ca_file')).toBeInstanceOf(File);
        expect(JSON.parse(String(form.get('share')))).toEqual(EVERYTHING);
    });
    it('reuses an already-trusted CA by uid and leaves out host for they_dial', () => {
        const form = buildCreateForm(draft({ direction: 'they_dial', ca: ca({ already_trusted: true }) }));
        expect(form.get('ca_uid')).toBe(ca().uid);
        expect(form.get('ca_file')).toBeNull();
        expect(form.get('host')).toBeNull();
    });
    it('describes the change in plain English', () => {
        const lines = describeChanges(draft(), { policy: 'Tak', ourAddress: 'hub:9102' }, t);
        expect(lines.some((l) => l.includes('county.example.org:9102'))).toBe(true);
        expect(lines.some((l) => l.includes('"Tak"'))).toBe(true);
        expect(lines.some((l) => l.includes('everything'))).toBe(true);
    });
});

describe('misc', () => {
    it('summarises checks', () => {
        expect(checksSummary([{ code: 'dns', ok: true }, { code: 'connected', ok: false }])).toEqual({
            total: 2, passed: 1, warnings: [], failed: ['connected'], skipped: 0, connected: false,
        });
        expect(checksSummary([
            { code: 'dns', ok: true, level: 'skipped' },
            { code: 'traffic_flowing', ok: false, level: 'warning' },
            { code: 'connected', ok: true, level: 'ok' },
        ])).toEqual({ total: 2, passed: 1, warnings: ['traffic_flowing'], failed: [], skipped: 1, connected: true });
    });
    it('explains known problems and humanises unknown ones', () => {
        expect(problemText('own_ca_missing', t)).toContain('own certificate');
        expect(problemText('weird_new_code', t)).toBe('Weird new code');
    });
});
