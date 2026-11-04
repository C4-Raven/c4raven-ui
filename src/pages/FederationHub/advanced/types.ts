// Shapes returned by the Federation Hub (proxied by Raven). Field names match
// the hub's JSON exactly; see fedhub-inventory-native.md section 1.

export interface HubConnection {
    connectionId: string;
    localConnectionType?: string;
    remoteConnectionType?: string;
    remoteServerId?: string;
    federationProtocolVersion?: number;
    groupIdentities?: string[];
    remoteAddress?: string;
}

export interface ChannelInfo {
    sourceId?: string;
    targetId?: string;
    sourceCert?: string;
    targetCert?: string;
    target?: string;
    messagesWritten?: number;
    messagesRead?: number;
    totalMessages?: number;
    bytesWritten?: number;
    bytesRead?: number;
}

export interface BrokerMetrics {
    totalMessagesDropped?: number;
    totalWrites?: number;
    totalReads?: number;
    totalBytesWritten?: number;
    totalBytesRead?: number;
    channelInfos?: ChannelInfo[];
}

export interface BrokerGlobalMetrics {
    heapAllocated?: number;
    heapUtilized?: number;
    cpuUtilized?: number;
    cpuCores?: number;
    numConnectedClients?: number;
    writesPerSecond?: number;
    readsPerSecond?: number;
    bytesWrittenPerSecond?: number;
    bytesReadPerSecond?: number;
}

export interface MetricsResponse {
    broker?: BrokerMetrics;
    global?: BrokerGlobalMetrics;
}

export interface CaGroup {
    alias: string;
    nickname: string;
    uid: string;
    issuer: string;
    subject: string;
    hubGroup: boolean;
}

export type FilterType = 'allGroups' | 'allowed' | 'disallowed' | 'allowedAndDisallowed';

export interface RuleFilter {
    groupsFilterType: FilterType;
    allowedGroups: string[];
    disallowedGroups: string[];
}

export interface PolicyRule {
    id: string;
    name: string;
    source: string;
    destination: string;
    filter: RuleFilter;
}

export type EntityType = 'FederationGroup' | 'FederationOutgoing' | 'FederationTokenGroup' | string;

export interface PolicyEntity {
    id: string;
    type: EntityType;
    displayName?: string;
    name?: string;
    description?: string;
    config?: Record<string, any>;
}

export interface GroupSet {
    id: string;
    name: string;
    groups: string[];
}

export interface PolicyCore {
    entities: PolicyEntity[];
    rules: PolicyRule[];
    groupSets: GroupSet[];
    [key: string]: unknown;
}

export interface GraphView {
    nodes?: unknown;
    settings?: { zoom?: number; canvas_x?: number; canvas_y?: number };
}

export interface PolicyPluginRouting {
    pluginName?: string;
    sendTo?: string[];
    dontSend?: string[];
    receiveFrom?: string[];
    dontReceive?: string[];
    sendByDefault?: boolean;
    receiveByDefault?: boolean;
    disabled?: boolean;
}

export interface Federation {
    name: string;
    version?: string;
    type?: string | null;
    description?: string | null;
    creationDate?: string;
    modifiedDate?: string;
    policy?: Partial<PolicyCore> | null;
    plugins?: PolicyPluginRouting[];
    views?: { graph?: GraphView };
    [key: string]: unknown;
}

export interface RegisteredPlugin {
    name?: string;
    startCommand?: string;
    version?: string;
    description?: string;
    author?: string;
    type?: string;
    startTime?: string;
    startTimeMillis?: number;
    [key: string]: unknown;
}

export interface TokenEntry {
    token: string;
    expiration: number;
}
