/**
 * Shapes returned by the Federation Hub partner API (/api/fedhub/overview,
 * /api/fedhub/partners, ...). The server orchestrates every change (save AND
 * activate on the hub); the UI only ever sends the partner-level fields below.
 */

/** Federation Hub's own GroupsFilterType enum values, exactly. */
export type FilterType = 'allGroups' | 'allowed' | 'disallowed' | 'allowedAndDisallowed';

export interface ShareFilter {
    type: FilterType;
    allowed: string[];
    disallowed: string[];
}

export type PartnerKind = 'raven_hub' | 'tak_server' | 'other';
export type Direction = 'we_dial' | 'they_dial';
export type PartnerStatus = 'connected' | 'waiting' | 'disabled' | 'error';

export interface PartnerCa {
    uid: string;
    sha256: string;
    subject: string;
    nickname: string;
    expires?: string;
}

export interface PartnerOutgoing {
    name: string;
    host: string;
    port: number;
    enabled: boolean;
}

/** tak.server.federation.hub.broker.HubConnectionInfo */
export interface HubConnectionInfo {
    connectionId: string;
    localConnectionType?: string;
    remoteConnectionType?: string;
    remoteServerId?: string;
    federationProtocolVersion?: number;
    groupIdentities?: string[];
    remoteAddress?: string;
}

export interface Traffic {
    msgs_out: number;
    msgs_in: number;
    bytes_out: number;
    bytes_in: number;
}

export interface Partner {
    id: string;
    name: string;
    kind: PartnerKind;
    direction: Direction;
    ca: PartnerCa | null;
    outgoing: PartnerOutgoing | null;
    interconnected: boolean;
    /** Outbound edge: what we send them (own CA -> partner). */
    share: ShareFilter;
    /** Inbound edge: what we accept from them (partner -> own CA). */
    receive: ShareFilter;
    enabled: boolean;
    status: PartnerStatus;
    connections: HubConnectionInfo[];
    traffic: Traffic;
    problems: string[];
}

export interface Overview {
    hub: {
        reachable: boolean;
        active_policy: string | null;
        broker_id?: string;
        v2_port: number;
        host: string;
    };
    own: {
        uid: string;
        sha256: string;
        subject: string;
        nickname: string;
        connected: boolean;
    };
    bridge: {
        enabled: boolean;
        service_state: string;
    };
    partners: Partner[];
    unattributed_connections: HubConnectionInfo[];
    problems: string[];
}

export interface CheckItem {
    code: string;
    ok: boolean;
    title: string;
    detail?: string;
    fix?: string;
}

export interface CaInspect {
    subject: string;
    issuer: string;
    sha256: string;
    uid: string;
    not_after: string | null;
    is_ca: boolean;
    already_trusted: boolean;
    existing_partner_id: string | null;
}

export interface Reachability {
    dns_ok: boolean;
    addresses: string[];
    tcp_ok: boolean;
    error?: string | null;
}

/** What POST /api/fedhub/partners takes (sent as multipart). */
export interface CreatePartnerInput {
    name: string;
    kind: PartnerKind;
    direction: Direction;
    caFile: File | null;
    /** Reuse a CA that is already trusted on the hub instead of uploading. */
    caUid?: string;
    host: string;
    port: number;
    interconnected: boolean;
    share: ShareFilter;
    receive: ShareFilter;
}

/** What PATCH /api/fedhub/partners/<id> takes (JSON, any subset). */
export interface PatchPartnerInput {
    name?: string;
    enabled?: boolean;
    host?: string;
    port?: number;
    interconnected?: boolean;
    share?: ShareFilter;
    receive?: ShareFilter;
}

/** Federation policy as returned by GET /api/fedhub/policy (getActivePolicy). */
export interface ActivePolicy {
    name?: string;
    modifiedDate?: string;
    policy?: {
        entities?: { id: string; type: string; displayName?: string; name?: string; config?: Record<string, any> }[];
        rules?: {
            id: string;
            name: string;
            source: string;
            destination: string;
            filter: { groupsFilterType: FilterType; allowedGroups: string[]; disallowedGroups: string[] };
        }[];
    };
    views?: { graph?: { nodes?: unknown; settings?: { zoom?: number; canvas_x?: number; canvas_y?: number } } };
}

export const EVERYTHING: ShareFilter = { type: 'allGroups', allowed: [], disallowed: [] };

/** Federation v2 port of a Raven / Federation Hub, and the TAK Server default. */
export const HUB_V2_PORT = 9102;
export const TAK_SERVER_FED_PORT = 9001;

export function defaultPort(kind: PartnerKind): number {
    return kind === 'tak_server' ? TAK_SERVER_FED_PORT : HUB_V2_PORT;
}

/** Most TAK Servers dial the hub (§4C); hubs are usually dialled by us. */
export function defaultDirection(kind: PartnerKind): Direction {
    return kind === 'tak_server' ? 'they_dial' : 'we_dial';
}
