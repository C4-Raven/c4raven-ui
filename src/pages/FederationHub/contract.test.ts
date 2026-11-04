/**
 * Contract test: real responses from the server's partner routes (captured
 * from the server's test app + fake hub by the contract dump script into
 * __fixtures__/) go through the UI's helpers. If the server adds a code or
 * changes a shape, this fails instead of the page showing "undefined" or a
 * humanised code.
 */
import { describe, expect, it } from 'vitest';
import caInspectExisting from './__fixtures__/ca_inspect_existing.json';
import caInspectNew from './__fixtures__/ca_inspect_new.json';
import caInspectOwn from './__fixtures__/ca_inspect_own.json';
import checkBothDialUnlinked from './__fixtures__/check_both_dial_unlinked.json';
import checkErrors from './__fixtures__/check_errors.json';
import checkTheyDial from './__fixtures__/check_they_dial.json';
import checkUnlinked from './__fixtures__/check_unlinked_outgoing.json';
import checkWeDial from './__fixtures__/check_we_dial.json';
import createTheyDial from './__fixtures__/create_they_dial.json';
import createWeDial from './__fixtures__/create_we_dial.json';
import deleted from './__fixtures__/delete.json';
import deletedWarning from './__fixtures__/delete_warning.json';
import errorActivateOwnCaMissing from './__fixtures__/error_activate_own_ca_missing.json';
import errorAddressNotAllowed from './__fixtures__/error_address_not_allowed.json';
import errorBusy from './__fixtures__/error_busy.json';
import errorCaInUse from './__fixtures__/error_ca_in_use.json';
import errorCaExists from './__fixtures__/error_ca_exists.json';
import errorInvalidCa from './__fixtures__/error_invalid_ca.json';
import errorNoActivePolicy from './__fixtures__/error_no_active_policy.json';
import errorOutgoingExists from './__fixtures__/error_outgoing_exists.json';
import errorOwnCa from './__fixtures__/error_own_ca.json';
import errorOwnCaMissingFromPolicy from './__fixtures__/error_own_ca_missing_from_policy.json';
import errorRollbackFailed from './__fixtures__/error_rollback_failed.json';
import errorTheyAlreadyDial from './__fixtures__/error_they_already_dial.json';
import handoff from './__fixtures__/handoff.json';
import handoffPartner from './__fixtures__/handoff_partner.json';
import handoffTak from './__fixtures__/handoff_tak_server.json';
import handoffWeDial from './__fixtures__/handoff_we_dial.json';
import knownGroups from './__fixtures__/known_groups.json';
import overviewBothDial from './__fixtures__/overview_both_dial.json';
import overviewHubDown from './__fixtures__/overview_hub_down.json';
import overviewLive from './__fixtures__/overview_live.json';
import overviewNoPolicy from './__fixtures__/overview_no_policy.json';
import overviewOwnCaMissing from './__fixtures__/overview_own_ca_missing.json';
import overviewProblems from './__fixtures__/overview_problems.json';
import reconnect from './__fixtures__/reconnect.json';
import repairChanged from './__fixtures__/repair_changed.json';
import repairNoActivePolicy from './__fixtures__/repair_no_active_policy.json';
import repairUnchanged from './__fixtures__/repair_unchanged.json';
import serverCodes from './__fixtures__/server_codes.json';
import { caInUseNodes, errorCode } from './advanced/api';
import {
    caWarnings,
    CHECK_ORDER,
    checksSummary,
    checkView,
    directionLabel,
    handoffSteps,
    hubDown,
    errorText,
    isKnownError,
    isKnownProblem,
    isUnlinkedOutgoing,
    kindLabel,
    ourAddressOf,
    partnerErrorView,
    problemColor,
    problemText,
    shareSentence,
    shareSummary,
    statusView,
    unlinkedOutgoingHint,
    validateWizard,
    type T,
} from './helpers';
import {
    OVERVIEW_PROBLEMS,
    PARTNER_PROBLEMS,
    type CaInspect,
    type CheckItem,
    type DeleteResult,
    type Handoff,
    type Overview,
    type Partner,
    type PartnerErrorBody,
    type PartnerKind,
    type ReconnectResult,
    type RepairResult,
} from './types';

const t: T = (key, opts) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));

const overviews: Record<string, Overview> = {
    live: overviewLive as Overview,
    bothDial: overviewBothDial as Overview,
    hubDown: overviewHubDown as Overview,
    noPolicy: overviewNoPolicy as Overview,
    ownCaMissing: overviewOwnCaMissing as Overview,
    problems: overviewProblems as Overview,
};
const checks: Record<string, CheckItem[]> = {
    weDial: checkWeDial as CheckItem[],
    theyDial: checkTheyDial as CheckItem[],
    unlinked: checkUnlinked as CheckItem[],
    errors: checkErrors as CheckItem[],
    bothDialUnlinked: checkBothDialUnlinked as CheckItem[],
};
const created: Partner[] = [createTheyDial as Partner, createWeDial as Partner];
const allPartners: Partner[] = [...Object.values(overviews).flatMap((o) => o.partners), ...created];
const KINDS: PartnerKind[] = ['raven_hub', 'tak_server', 'other'];

/** Text the user sees must never contain these. */
function expectReadable(text: string) {
    expect(typeof text).toBe('string');
    expect(text.trim()).not.toBe('');
    expect(text).not.toMatch(/undefined|null|NaN|\[object/);
}

function expectKeys(obj: object, keys: string[]) {
    for (const k of keys) { expect(obj, `missing "${k}"`).toHaveProperty(k); }
}

describe('contract: overview', () => {
    it.each(Object.entries(overviews))('%s has every field the page reads', (_, o) => {
        expectKeys(o, ['hub', 'own', 'bridge', 'partners', 'unattributed_connections', 'problems']);
        expectKeys(o.hub, ['reachable', 'active_policy', 'broker_id', 'v2_port', 'host']);
        expectKeys(o.own, ['uid', 'sha256', 'subject', 'nickname', 'connected']);
        expectKeys(o.bridge, ['enabled', 'service_state']);
    });

    it('knows every overview problem code the server sends, in plain English', () => {
        const codes = new Set(Object.values(overviews).flatMap((o) => o.problems));
        expect(codes.size).toBeGreaterThan(0);
        for (const code of [...codes, ...OVERVIEW_PROBLEMS]) {
            expect(isKnownProblem(code), code).toBe(true);
            expectReadable(problemText(code, t));
            expect(problemText(code, t)).not.toMatch(/_/);
            expect(['red', 'yellow']).toContain(problemColor(code));
        }
    });

    it('treats a reachable:false overview as "hub is down"', () => {
        expect(hubDown(overviews.hubDown)).toBe(true);
        expect(overviews.hubDown.problems).toContain('hub_unreachable');
        expectReadable(overviews.hubDown.error ?? '');
        for (const [name, o] of Object.entries(overviews)) {
            if (name !== 'hubDown') { expect(hubDown(o), name).toBe(false); }
        }
    });

    it('always has an address partners can dial while the hub answers', () => {
        for (const o of Object.values(overviews)) { expectReadable(ourAddressOf(o.hub)); }
    });
});

describe('contract: partners', () => {
    it('has partners to test', () => {
        expect(allPartners.length).toBeGreaterThan(5);
    });

    it.each(allPartners.map((p) => [p.name, p] as const))('%s renders without unknowns', (_, p) => {
        expectKeys(p, ['id', 'name', 'kind', 'direction', 'ca', 'outgoing', 'interconnected', 'share', 'receive',
            'enabled', 'status', 'connections', 'traffic', 'problems']);
        expectReadable(p.name);
        expect(KINDS).toContain(p.kind);
        expectReadable(kindLabel(p.kind, t));
        expect(['we_dial', 'they_dial']).toContain(p.direction);
        expectReadable(directionLabel(p, t));
        expect(['connected', 'waiting', 'disabled', 'error']).toContain(p.status);
        const status = statusView(p.status, t);
        expectReadable(status.label);
        expectReadable(status.description);
        for (const f of [p.share, p.receive]) {
            expect(['allGroups', 'allowed', 'disallowed', 'allowedAndDisallowed', 'none']).toContain(f.type);
            const s = shareSummary(f, t);
            expectReadable(s.label);
            expectReadable(s.detail);
            expectReadable(s.color);
            expectReadable(shareSentence(f, t));
        }
        for (const code of p.problems) {
            expect(isKnownProblem(code), code).toBe(true);
            expect(PARTNER_PROBLEMS as readonly string[]).toContain(code);
            expectReadable(problemText(code, t));
        }
        expectKeys(p.traffic, ['msgs_out', 'msgs_in', 'bytes_out', 'bytes_in']);
        if (p.outgoing) { expectKeys(p.outgoing, ['name', 'host', 'port', 'enabled']); }
        if (p.ca) { expectKeys(p.ca, ['uid', 'sha256', 'subject', 'nickname', 'expires']); }
    });

    it('shows a missing rule as "Nothing" in red', () => {
        const p = overviews.ownCaMissing.partners[0];
        expect(p.share.type).toBe('none');
        expect(shareSummary(p.share, t)).toMatchObject({ label: 'Nothing', color: 'red' });
        expect(shareSummary(p.receive, t).label).toBe('Nothing');
    });

    it('flags the live hub\'s unlinked outgoing connection ("VPN Server") with a hint', () => {
        const unlinked = overviews.live.partners.filter(isUnlinkedOutgoing);
        expect(unlinked.map((p) => p.name)).toEqual(['VPN Server']);
        expectReadable(unlinkedOutgoingHint(t));
        expect(overviews.live.partners.filter((p) => p.ca).every((p) => !isUnlinkedOutgoing(p))).toBe(true);
    });

    it('create returns a bare partner of the kind and direction asked for', () => {
        expect(created.map((p) => [p.kind, p.direction])).toEqual([['tak_server', 'they_dial'], ['raven_hub', 'we_dial']]);
        expect(created[1].outgoing?.host).toBe('north.example.org');
    });
});

describe('contract: checks', () => {
    it.each(Object.entries(checks))('%s: every item has a level the panel can colour', (_, list) => {
        expect(Array.isArray(list)).toBe(true);
        expect(list.map((c) => c.code)).toEqual([...CHECK_ORDER]);
        for (const c of list) {
            expect(['ok', 'warning', 'error', 'skipped']).toContain(c.level);
            expect(c.ok).toBe(c.level === 'ok' || c.level === 'skipped');
            expectReadable(c.title);
            const v = checkView(c, t);
            expect(v.level).toBe(c.level);
            expectReadable(v.label);
            if (c.fix) { expectReadable(c.fix); }
        }
        const s = checksSummary(list);
        expect(s.total + s.skipped).toBe(list.length);
        expect(s.passed + s.warnings.length + s.failed.length).toBe(s.total);
    });

    it('marks network checks "not applicable" when they dial us', () => {
        const by = Object.fromEntries(checks.theyDial.map((c) => [c.code, c]));
        expect(checkView(by.dns, t)).toMatchObject({ color: 'gray', label: 'Not applicable', showFix: false });
        expect(checkView(by.tcp, t).color).toBe('gray');
    });

    it('turns both-dial and DNS failures red with a fix', () => {
        const by = Object.fromEntries(checks.errors.map((c) => [c.code, c]));
        for (const code of ['dial_direction', 'dns', 'tcp']) {
            expect(checkView(by[code], t).color, code).toBe('red');
        }
        expect(by.dial_direction.fix).toBeTruthy();
    });
});

describe('contract: wizard helpers', () => {
    const inspects = { fresh: caInspectNew as CaInspect, existing: caInspectExisting as CaInspect, own: caInspectOwn as CaInspect };

    it.each(Object.entries(inspects))('ca_inspect %s has the fields the wizard reads', (_, ca) => {
        expectKeys(ca, ['subject', 'issuer', 'sha256', 'fingerprint', 'uid', 'not_after', 'days_left', 'is_ca',
            'already_trusted', 'nickname', 'is_own', 'existing_partner_id']);
        for (const w of caWarnings(ca, overviews.live.partners, t)) { expectReadable(w.text); }
    });

    it('blocks our own CA and an already-connected CA, accepts a new one', () => {
        const live = overviews.live.partners;
        const own = caWarnings(inspects.own, live, t);
        expect(own[0]).toMatchObject({ level: 'error' });
        expect(own[0].text).toMatch(/our own certificate/);
        const existing = caWarnings(inspects.existing, live, t);
        expect(existing[0].level).toBe('error');
        expect(existing[0].text).toContain(live.find((p) => p.id === inspects.existing.existing_partner_id)!.name);
        expect(caWarnings(inspects.fresh, live, t).filter((w) => w.level === 'error')).toEqual([]);

        const draft = {
            kind: 'other' as const, caFile: null, ca: inspects.own, name: 'Mine', direction: 'they_dial' as const,
            host: '', port: 9102 as const, share: { type: 'allGroups' as const, allowed: [], disallowed: [] },
            receive: { type: 'allGroups' as const, allowed: [], disallowed: [] }, interconnected: false,
        };
        expect(validateWizard(draft, live, t).ca).toMatch(/our own certificate/);
    });

    it('handoff gives an address, our fingerprint and steps for every kind', () => {
        const h = handoff as Handoff;
        expectKeys(h, ['ca_pem', 'sha256', 'fingerprint', 'subject', 'nickname', 'not_after', 'host', 'port', 'steps']);
        expectReadable(ourAddressOf(h));
        expect(ourAddressOf(h)).toBe(`${h.host}:${h.port}`);
        for (const kind of KINDS) {
            const steps = handoffSteps(h, kind);
            expect(steps.length, kind).toBeGreaterThan(1);
            steps.forEach(expectReadable);
        }
        expect(Object.keys((handoffTak as Handoff).steps)).toEqual(['tak_server']);
        expect(handoffSteps(handoffTak as Handoff, 'tak_server').some((s) => s.includes('__ANON__'))).toBe(true);
    });

    it('known_groups is a bare list of names', () => {
        expect(knownGroups).toEqual(['__ANON__', 'Blue']);
    });
});

describe('contract: results and errors', () => {
    it('delete, reconnect and repair bodies have what the page reads', () => {
        expectKeys(deleted as DeleteResult, ['success', 'id', 'ca_removed']);
        expect((deleted as DeleteResult).ca_removed).toBe(true);
        expectReadable((deletedWarning as DeleteResult).warning ?? '');
        expect((reconnect as ReconnectResult).disconnected).toBe(1);
        expect((repairChanged as RepairResult).changed).toBe(true);
        expect((repairUnchanged as RepairResult).changed).toBe(false);
    });

    const partners = overviews.live.partners;
    const errors: [string, PartnerErrorBody][] = [
        ['ca_exists', errorCaExists as PartnerErrorBody],
        ['own_ca', errorOwnCa as PartnerErrorBody],
        ['outgoing_exists', errorOutgoingExists as PartnerErrorBody],
        ['they_already_dial', errorTheyAlreadyDial as PartnerErrorBody],
        ['busy', errorBusy as PartnerErrorBody],
        ['invalid_ca', errorInvalidCa as PartnerErrorBody],
        ['address_not_allowed', errorAddressNotAllowed as PartnerErrorBody],
        ['own_ca_missing_from_policy', errorOwnCaMissingFromPolicy as PartnerErrorBody],
    ];

    it.each(errors)('%s gets a friendly message', (code, body) => {
        expect(body).toMatchObject({ success: false, code });
        const v = partnerErrorView(body, partners, t, 'FALLBACK');
        expect(v.code).toBe(code);
        expectReadable(v.message);
        expect(v.message).not.toBe('FALLBACK');
        expect(v.halfChanged).toBe(false);
    });

    it('offers "Open existing partner" for the *_exists errors, naming it', () => {
        const ca = partnerErrorView(errorCaExists as PartnerErrorBody, partners, t);
        expect(ca.existingPartnerId).toBe((errorCaExists as PartnerErrorBody).existing_partner_id);
        expect(ca.message).toContain(partners.find((p) => p.id === ca.existingPartnerId)!.name);
        const out = partnerErrorView(errorOutgoingExists as PartnerErrorBody, partners, t);
        expect(out.existingPartnerId).toBe('VPN Server_7399fa0c-cbaa-40b6-9c3c-3184959715e5');
        expect(out.message).toContain('VPN Server');
        expect(partnerErrorView(errorBusy as PartnerErrorBody, partners, t).existingPartnerId).toBeNull();
    });

    it('no_active_policy (create and repair) offers the stored policies to activate', () => {
        for (const body of [errorNoActivePolicy, repairNoActivePolicy] as PartnerErrorBody[]) {
            const v = partnerErrorView(body, partners, t);
            expect(v.policies).toEqual(body.stored_policies);
            expect(v.policies.length).toBeGreaterThan(0);
            expect(v.message).toContain(`Activate one of: ${v.policies.join(', ')}`);
            expect(v.halfChanged).toBe(false);
        }
    });

    it('a 500 rollback_failed is flagged as half changed, with the server\'s explanation', () => {
        const v = partnerErrorView(errorRollbackFailed as PartnerErrorBody, partners, t);
        expect(v.halfChanged).toBe(true);
        expect(v.message).toBe((errorRollbackFailed as PartnerErrorBody).error);
    });

    it('the advanced editor recognises own_ca_missing_from_policy', () => {
        expect(errorCode({ response: { status: 400, data: errorOwnCaMissingFromPolicy } })).toBe('own_ca_missing_from_policy');
        expect(errorCode({ response: { status: 400, data: JSON.stringify(errorOwnCaMissingFromPolicy) } })).toBe('own_ca_missing_from_policy');
    });
});

describe('contract: both sides dial (live hub: "VPN" dials in, native "VPN Server" dials out)', () => {
    it('warns on both cards, and the outgoing one is the unlinked one to remove', () => {
        const ps = overviews.bothDial.partners;
        expect(ps.length).toBe(2);
        for (const p of ps) { expect(p.problems, p.name).toContain('both_sides_dial'); }
        const removable = ps.filter((p) => p.direction === 'we_dial');
        expect(removable.map((p) => p.name)).toEqual(['VPN Server']);
        expect(isUnlinkedOutgoing(removable[0])).toBe(true);
    });

    it('the unlinked outgoing\'s check shows the dial conflict in red', () => {
        const by = Object.fromEntries(checks.bothDialUnlinked.map((c) => [c.code, c]));
        expect(checkView(by.dial_direction, t).color).toBe('red');
        expectReadable(by.dial_direction.detail ?? '');
    });
});

describe('contract: no unmapped codes (scanned from the server source)', () => {
    it('maps every error code the partner routes can return', () => {
        expect(serverCodes.error_codes.length).toBeGreaterThan(20);
        const unmapped = serverCodes.error_codes.filter((c) => !isKnownError(c));
        expect(unmapped).toEqual([]);
        for (const code of serverCodes.error_codes) {
            const text = errorText(code, t);
            expectReadable(text);
            expect(text, code).not.toMatch(/_/);
            // With no server message at all, the user still never sees the raw code.
            const v = partnerErrorView({ success: false, code, error: '' }, [], t);
            expectReadable(v.message);
            expect(v.message).not.toContain(code);
        }
    });

    it('maps every problem code', () => {
        expect(serverCodes.problem_codes.filter((c) => !isKnownProblem(c))).toEqual([]);
    });

    it('knows every check code, in the order the server returns them', () => {
        expect([...serverCodes.check_codes].sort()).toEqual([...CHECK_ORDER].sort());
    });

    it('half-changed codes point the admin to Advanced', () => {
        for (const code of ['partially_applied', 'rollback_failed']) {
            expect(partnerErrorView({ success: false, code, error: '' }, [], t).halfChanged, code).toBe(true);
        }
    });
});

describe('contract: advanced section errors and the specific hand-off', () => {
    it('activating a stored policy without our CA is recognised for "Add it back"', () => {
        expect(errorCode({ response: { status: 400, data: errorActivateOwnCaMissing } })).toBe('own_ca_missing_from_policy');
    });

    it('ca_in_use lists the nodes that still use the CA', () => {
        const err = { response: { status: 409, data: errorCaInUse } };
        expect(errorCode(err)).toBe('ca_in_use');
        expect(caInUseNodes(err)).toEqual((errorCaInUse as { nodes: string[] }).nodes);
        expect(caInUseNodes(err).length).toBeGreaterThan(0);
        expect(isKnownError('ca_in_use')).toBe(true);
    });

    it('the neutral hand-off says to agree on ONE side; a specific one tells them what to pick', () => {
        expect(handoffSteps(handoff as Handoff, 'raven_hub').join(' ')).toMatch(/ONE side/);
        // We dial, so they must choose "They connect to us".
        expect(handoffSteps(handoffWeDial as Handoff, 'raven_hub').join(' ')).toContain('"They connect to us"');
        expect(handoffSteps(handoffWeDial as Handoff, 'raven_hub').join(' ')).not.toMatch(/ONE side/);
        expect(Object.values((handoffPartner as Handoff).steps).flat().length).toBeGreaterThan(1);
        expect((handoffWeDial as Handoff).direction).toBe('we_dial');
        // VPN Server is an outgoing partner: we dial it.
        expect((handoffPartner as Handoff).direction).toBe('we_dial');
        expect((handoff as Handoff).direction ?? null).toBeNull();
    });
});
