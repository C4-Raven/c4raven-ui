/** Every Federation Hub call the main page makes. Mutations are applied on the hub by the server. */
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { downloadFile } from '../ServerRequests/shared';
import type {
    ActivePolicy,
    CaInspect,
    CheckItem,
    DeleteResult,
    Direction,
    Handoff,
    Overview,
    Partner,
    PartnerKind,
    PatchPartnerInput,
    Reachability,
    ReconnectResult,
    RepairResult,
} from './types';

const partnerUrl = (id: string) => `${apiRoutes.fedhubPartners}/${encodeURIComponent(id)}`;
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

/** Always 200, even when the hub is down (then hub.reachable is false). */
export async function getOverview(): Promise<Overview> {
    const r = await axios.get(apiRoutes.fedhubOverview);
    return r.data as Overview;
}

export async function getActivePolicy(): Promise<ActivePolicy | null> {
    const r = await axios.get(apiRoutes.fedhubPolicy);
    return r.data && typeof r.data === 'object' ? (r.data as ActivePolicy) : null;
}

/** 201 with the bare Partner. */
export async function createPartner(form: FormData): Promise<Partner> {
    const r = await axios.post(apiRoutes.fedhubPartners, form, MULTIPART);
    return r.data as Partner;
}

/** 200 with the bare Partner (its id changes when an outgoing-only partner is renamed). */
export async function patchPartner(id: string, body: PatchPartnerInput): Promise<Partner> {
    const r = await axios.patch(partnerUrl(id), body);
    return r.data as Partner;
}

export async function deletePartner(id: string, keepCa: boolean): Promise<DeleteResult> {
    const r = await axios.delete(partnerUrl(id), { params: keepCa ? { keep_ca: 1 } : {} });
    return r.data as DeleteResult;
}

/** The route returns a bare list. */
export async function checkPartner(id: string): Promise<CheckItem[]> {
    const r = await axios.get(`${partnerUrl(id)}/check`);
    return Array.isArray(r.data) ? (r.data as CheckItem[]) : [];
}

export async function reconnectPartner(id: string): Promise<ReconnectResult> {
    const r = await axios.post(`${partnerUrl(id)}/reconnect`);
    return r.data as ReconnectResult;
}

export async function repairHub(): Promise<RepairResult> {
    const r = await axios.post(apiRoutes.fedhubRepair);
    return r.data as RepairResult;
}

/** Makes a stored policy the active one (the hub's activateFederationPolicy). */
export async function activateFederation(name: string): Promise<void> {
    await axios.post(`${apiRoutes.fedhubFederations}/${encodeURIComponent(name)}/activate`);
}

/** Our CA, address and the other admin's steps; `kind` limits steps to that kind. */
export async function getHandoff(kind?: PartnerKind): Promise<Handoff> {
    const r = await axios.get(apiRoutes.fedhubHandoff, { params: kind ? { kind } : {} });
    return r.data as Handoff;
}

/**
 * Parses a CA without uploading it. Sent as POST: browsers can't attach a
 * multipart body to a GET.
 */
export async function inspectCa(file: File): Promise<CaInspect> {
    const form = new FormData();
    form.append('file', file);
    const r = await axios.post(apiRoutes.fedhubCaInspect, form, MULTIPART);
    return r.data as CaInspect;
}

export async function testReachability(host: string, port: number): Promise<Reachability> {
    const r = await axios.post(apiRoutes.fedhubReachability, { host, port });
    return r.data as Reachability;
}

export async function knownGroups(nodeId: string): Promise<string[]> {
    const r = await axios.get(`${apiRoutes.fedhubKnownGroups}/${encodeURIComponent(nodeId)}`);
    return Array.isArray(r.data) ? r.data.map(String) : [];
}

export function downloadOwnCa() {
    return downloadFile(apiRoutes.fedhubSelfCa, {}, 'federation-hub-ca.pem');
}

export interface HandoffOptions {
    kind?: PartnerKind | null;
    /** OUR choice; the steps then tell the other admin the opposite. */
    direction?: Direction;
    /** An existing partner: its real kind and direction win. */
    partnerId?: string;
}

/** The instructions file. With no options it is neutral and says the admins must agree who connects. */
export function downloadHandoff(opts: HandoffOptions = {}) {
    const params: Record<string, string> = { format: 'txt' };
    if (opts.kind) { params.kind = opts.kind; }
    if (opts.direction) { params.direction = opts.direction; }
    if (opts.partnerId) { params.partner_id = opts.partnerId; }
    return downloadFile(apiRoutes.fedhubHandoff, params, 'federation-instructions.txt');
}
