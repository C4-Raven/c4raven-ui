/**
 * Shapes returned by the Federation Hub partner API (/api/fedhub/overview,
 * /api/fedhub/partners, ...). The server orchestrates every change (save AND
 * activate on the hub); the UI only ever sends the partner-level fields below.
 */

/** Federation Hub's own GroupsFilterType enum values, exactly. */
export type FilterType = 'allGroups' | 'allowed' | 'disallowed' | 'allowedAndDisallowed';

/**
 * What the server reports for one direction. 'none' means the active policy has
 * NO rule for that direction, so the hub blocks it entirely. It is read-only:
 * the server never accepts 'none' back; choosing Everything (allGroups) fixes it.
 */
export type ShareType = FilterType | 'none';

export interface ShareFilter {
    type: ShareType;
    allowed: string[];
    disallowed: string[];
}

export type PartnerKind = 'raven_hub' | 'tak_server' | 'other';
export type Direction = 'we_dial' | 'they_dial';
export type PartnerStatus = 'connected' | 'waiting' | 'disabled' | 'error';

export interface PartnerCa {
    uid: string;
    sha256: string | null;
    subject: string;
    nickname: string | null;
    expires: string | null;
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
    /** null for an outgoing connection that isn't linked to a trusted CA (e.g. made in the native console). */
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

/** Overview-level problem codes (GET /api/fedhub/overview `problems`). */
export const OVERVIEW_PROBLEMS = [
    'hub_unreachable', 'hub_error', 'own_ca_unknown', 'no_active_policy', 'own_ca_missing', 'bridge_not_connected',
] as const;

/** Per-partner problem codes (Partner.problems). */
export const PARTNER_PROBLEMS = [
    'ca_not_trusted', 'no_rule_out', 'no_rule_in', 'filter_not_all_groups', 'both_sides_dial', 'ca_expired', 'ca_expiring',
] as const;

/**
 * GET /api/fedhub/overview. Always 200: when the hub is down `hub.reachable`
 * is false, `problems` holds hub_unreachable / hub_error, `error` says why and
 * the own-CA fields are null.
 */
export interface Overview {
    hub: {
        reachable: boolean;
        active_policy: string | null;
        broker_id: string | null;
        v2_port: number;
        host: string | null;
    };
    own: {
        uid: string | null;
        sha256: string | null;
        subject: string | null;
        nickname: string | null;
        connected: boolean;
    };
    bridge: {
        enabled: boolean;
        service_state: string;
    };
    partners: Partner[];
    unattributed_connections: HubConnectionInfo[];
    problems: string[];
    error?: string;
}

/** ok and skipped both have ok=true; skipped means "not applicable here". */
export type CheckLevel = 'ok' | 'warning' | 'error' | 'skipped';

/** One item of GET /partners/<id>/check (the route returns a bare list). */
export interface CheckItem {
    code: string;
    ok: boolean;
    level: CheckLevel;
    title: string;
    detail?: string;
    fix?: string;
}

/** POST /api/fedhub/ca_inspect (multipart `file`). */
export interface CaInspect {
    subject: string;
    issuer: string;
    sha256: string;
    /** Colon hex of sha256, as TAK Server prints it. */
    fingerprint?: string;
    uid: string;
    not_after: string | null;
    days_left?: number | null;
    is_ca: boolean;
    already_trusted: boolean;
    /** The hub's nickname for it, when already trusted. */
    nickname?: string | null;
    /** This is the hub's OWN CA: never a partner. */
    is_own?: boolean;
    existing_partner_id: string | null;
}

/** GET /api/fedhub/handoff (JSON; `?format=txt` is the download). */
export interface Handoff {
    ca_pem: string;
    sha256: string;
    fingerprint: string;
    subject: string;
    nickname: string | null;
    not_after: string | null;
    host: string | null;
    port: number;
    /** OUR direction the steps were written for (from `direction` or the partner); null = neutral. */
    direction?: Direction | null;
    /** Only the requested kind with `?kind=`, else all three. */
    steps: Partial<Record<PartnerKind, string[]>>;
}

/** DELETE /partners/<id>. */
export interface DeleteResult {
    success: boolean;
    id: string;
    ca_removed: boolean;
    /** Removed, but something (usually the CA) was kept: show it. */
    warning?: string;
}

/** POST /partners/<id>/reconnect. */
export interface ReconnectResult {
    success: boolean;
    disconnected: number;
}

/** POST /api/fedhub/repair. */
export interface RepairResult {
    success: boolean;
    changed: boolean;
    policy?: string;
}

/** Error body of every partner route (4xx/5xx). */
export interface PartnerErrorBody {
    success: false;
    error: string;
    code: string;
    existing_partner_id?: string | null;
    /** no_active_policy (409): stored policies the admin can activate. */
    stored_policies?: string[];
    /** address_not_allowed: what the host resolved to. */
    addresses?: string[];
    rollback_failed?: boolean;
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
    kind?: PartnerKind;
    direction?: Direction;
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

/*
 * There is deliberately NO default direction: with a default, two Ravens that
 * both keep it end up both dialling (G6). The admin must pick one, after
 * agreeing with the other admin.
 */
