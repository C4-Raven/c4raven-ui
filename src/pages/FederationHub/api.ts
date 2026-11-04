/** Every Federation Hub call the main page makes. Mutations are applied on the hub by the server. */
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { downloadFile } from '../ServerRequests/shared';
import type {
    ActivePolicy,
    CaInspect,
    CheckItem,
    Overview,
    Partner,
    PatchPartnerInput,
    Reachability,
} from './types';

const partnerUrl = (id: string) => `${apiRoutes.fedhubPartners}/${encodeURIComponent(id)}`;
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

/** Some routes wrap the object ({partner: {...}}); accept both. */
function unwrap<T>(data: any, key: string): T {
    return (data && typeof data === 'object' && key in data ? data[key] : data) as T;
}

export async function getOverview(): Promise<Overview> {
    const r = await axios.get(apiRoutes.fedhubOverview);
    return r.data as Overview;
}

export async function getActivePolicy(): Promise<ActivePolicy | null> {
    const r = await axios.get(apiRoutes.fedhubPolicy);
    return r.data && typeof r.data === 'object' ? (r.data as ActivePolicy) : null;
}

export async function createPartner(form: FormData): Promise<Partner> {
    const r = await axios.post(apiRoutes.fedhubPartners, form, MULTIPART);
    return unwrap<Partner>(r.data, 'partner');
}

export async function patchPartner(id: string, body: PatchPartnerInput): Promise<Partner> {
    const r = await axios.patch(partnerUrl(id), body);
    return unwrap<Partner>(r.data, 'partner');
}

export async function deletePartner(id: string, keepCa: boolean): Promise<void> {
    await axios.delete(partnerUrl(id), { params: keepCa ? { keep_ca: 1 } : {} });
}

export async function checkPartner(id: string): Promise<CheckItem[]> {
    const r = await axios.get(`${partnerUrl(id)}/check`);
    const data = unwrap<CheckItem[]>(r.data, 'checks');
    return Array.isArray(data) ? data : [];
}

export async function reconnectPartner(id: string): Promise<void> {
    await axios.post(`${partnerUrl(id)}/reconnect`);
}

export async function repairHub(): Promise<void> {
    await axios.post(apiRoutes.fedhubRepair);
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
    const data = unwrap<unknown>(r.data, 'groups');
    return Array.isArray(data) ? data.map(String) : [];
}

export function downloadOwnCa() {
    return downloadFile(apiRoutes.fedhubSelfCa, {}, 'federation-hub-ca.pem');
}

export function downloadHandoff() {
    return downloadFile(apiRoutes.fedhubHandoff, { format: 'txt' }, 'federation-instructions.txt');
}
