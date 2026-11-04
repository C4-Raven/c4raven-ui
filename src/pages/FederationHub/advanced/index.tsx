/*
 * Advanced section of the Federation Hub page.
 *
 * Its job: keep EVERY function of the old FederationHub.tsx page and of the
 * native hub console reachable (fixed and clearer), so nothing is lost by the
 * simplified partner-card page. Checklist, from fedhub-inventory-current.md
 * (old function -> where it lives now):
 *
 * 1.1 Page load / polling / errors
 *   [x] loadAll (connections, metrics, plugins, CA groups, federations)  -> shared.tsx HubDataProvider.reload (+ active policy)
 *   [x] 10 s poll of connections + metrics                               -> HubDataProvider (errors now shown, not swallowed)
 *   [x] showError toast (only first failure, axios text)                 -> shared.tsx notifyFail / api.ts errorText (hub raw text) + HubErrorAlert (all failures)
 * 1.2 Header bar
 *   [x] Refresh                                                          -> Advanced header Refresh button
 *   [x] Open Native Admin Panel (hard-coded fed.c4raven.net)             -> Admin access tab, URL from GET /native_url
 *   [x] Get Admin Certificate                                            -> Admin access tab
 *   [x] Restart Broker (confirm, fixed 3 s reload)                       -> Broker tab: confirm (G9 note) + polls /overview until reachable
 * 1.3 Status tab
 *   [x] Tiles: connected clients, CPU, heap, messages dropped            -> Metrics tab (-1 shown as "Not reported", G21)
 *   [x] Fetched-but-hidden metrics (totals, bytes, rates, cores, heap
 *       allocated, channelInfos)                                         -> Metrics tab: all tiles + Channels table
 *   [x] Active connections table (+ remoteConnectionType, was hidden)    -> Connections tab (CA uid -> nickname, bridge marked)
 *   [x] Disconnect (no confirm)                                          -> Connections tab, WITH confirm
 *   [x] Per-connection counts footnote                                   -> Connections tab footnote
 *   [x] Registered plugins (raw JSON rows)                               -> Plugins tab as a table (+ read-only policy plugin routing)
 * 1.4 CA Groups tab
 *   [x] Explainer                                                        -> Certificates tab header text
 *   [x] Download our CA                                                  -> Certificates tab
 *   [x] Add CA modal (file + nickname)                                   -> Certificates tab; size/unique-nickname checks (G22) and
 *                                                                          "Also add to the active policy" (node + allGroups both ways
 *                                                                          with own CA, save+activate) so it isn't orphaned (#6)
 *   [x] CA table nickname/subject/hub group (alias/uid/issuer hidden)    -> Certificates tab: + sha256 (G7), uid copy, issuer,
 *                                                                          "In active policy"/"Not in policy" badges, empty state
 *   [x] Inline rename on blur, no revert                                 -> explicit Save/Undo per row (Enter saves), reverts on failure
 *   [x] Remove CA modal                                                  -> confirm with blip warning; removes its policy nodes/rules and
 *                                                                          re-activates FIRST, then deleteGroupCa (G11, api.deleteCaSafely);
 *                                                                          typed confirm for the hub's own CA
 * 1.5 Federations tab                                                    -> Policy editor tab
 *   [x] Federations table, row click opens                               -> + Active badge, unsaved-changes confirm on switch (#2)
 *   [x] (no create/delete before)                                        -> New policy; Delete policy (typed confirm when active, G10)
 *   [x] Outgoing table/create/edit/delete                                -> policy/NodesSection (all node types) + policy/OutgoingModal;
 *                                                                          Status = live connection state, not config.enabled (#10);
 *                                                                          delete confirms and removes touching rules (#7); host
 *                                                                          validation; G6 duplicate-dial warning
 *   [x] Outgoing token as plain TextInput                                -> PasswordInput (masked, reveal)
 *   [x] Group sets create/edit/delete (no confirm)                       -> policy/GroupSetsSection, delete confirm (also strips the set
 *                                                                          from rule filters); "Apply group sets only" ->
 *                                                                          POST /connections/groups (updateConnectionGroupSets)
 *   [x] Connection map diagram (drag/zoom persist, rule drawing)         -> PolicyTab, same FederationPolicyDiagram, keyed per policy (#5),
 *                                                                          local views kept fresh (#4)
 *   [x] Rule add/edit/delete (diagram only, no confirm, no group sets)   -> policy/RulesSection: table + modal, delete confirm, editable
 *                                                                          source/destination, group sets selectable (#8), suggestions
 *                                                                          from /known_groups/<node>, G12 warning for Raven sources
 *   [x] Raw policy JSON                                                  -> PolicyTab "Raw policy JSON" (hidden by default; tokens warning)
 *   [x] Save Policy (never activated)                                    -> "Save only" + "Save & apply" (POST /policy?activate=1) +
 *                                                                          "Apply saved version"; dirty badge, Discard, beforeunload,
 *                                                                          "changed on hub" notice, own-CA-missing warning (G1)
 *   [x] (unused before) export                                           -> Export saved version as JSON / YAML
 * 1.6 Admin certificate 2FA flow                                         -> Admin access tab; password masked + copy; password-fetch error
 *                                                                          shown (not an empty field); 403 on download restarts the flow
 * 1.7 Restart broker                                                     -> Broker tab (see 1.2)
 * 1.8 Diagram controls (zoom, reset, drag, two-click rules, rule list)   -> unchanged component inside Policy editor
 * Native-only functions
 *   [x] getBrokerConfig (was unused)                                     -> Broker tab, read-only, secrets shown as "hidden", G2 warning
 *   [x] generateJwtToken / token groups                                  -> Tokens tab (masked, reveal/copy, revoke) + token-group node
 *   [x] CA group interconnected / allowTokenAuth / enabled               -> NodesSection edit modal (G13)
 *   [x] getKnownGroupsForGraphNode                                       -> rule modal suggestions
 * Not covered here (by design): updateBrokerConfig (G4: unsafe round-trip,
 * host-level edit instead) and policy/core + policy/plugins partial saves
 * (Save & apply sends the whole model, which covers both).
 */
import React, { useState } from 'react';
import { ActionIcon, Badge, Button, Collapse, Group, Tabs, Tooltip } from '@mantine/core';
import {
    IconAdjustments,
    IconCertificate,
    IconChartBar,
    IconChevronDown,
    IconChevronUp,
    IconKey,
    IconPlugConnected,
    IconPuzzle,
    IconRefresh,
    IconRoute,
    IconServerBolt,
    IconShieldLock,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Section } from '../../ServerRequests/shared';
import { HubDataProvider, HubErrorAlert, useHubData } from './shared';
import ConnectionsTab from './ConnectionsTab';
import MetricsTab from './MetricsTab';
import CertificatesTab from './CertificatesTab';
import PolicyTab from './PolicyTab';
import TokensTab from './TokensTab';
import PluginsTab from './PluginsTab';
import BrokerTab from './BrokerTab';
import AdminAccessTab from './AdminAccessTab';

const TABS = ['connections', 'metrics', 'certificates', 'policy', 'tokens', 'plugins', 'broker', 'admin'] as const;
type TabValue = (typeof TABS)[number];

function RefreshButton() {
    const { t } = useTranslation();
    const { reload, loading } = useHubData();
    return (
        <Tooltip label={t('Refresh')}>
            <ActionIcon variant="default" radius="xl" loading={loading} onClick={() => reload()} aria-label={t('Refresh')}>
                <IconRefresh size={16} />
            </ActionIcon>
        </Tooltip>
    );
}

function AdvancedTabs() {
    const { t } = useTranslation();
    const { connections } = useHubData();
    const [tab, setTab] = useState<TabValue>('connections');
    // Mount each tab the first time it's opened, then keep it (the policy draft survives tab switches).
    const [visited, setVisited] = useState<Set<TabValue>>(() => new Set(['connections']));
    function change(v: string | null) {
        if (!v || !(TABS as readonly string[]).includes(v)) { return; }
        const value = v as TabValue;
        setTab(value);
        setVisited((prev) => (prev.has(value) ? prev : new Set(prev).add(value)));
    }
    return (
        <>
            <HubErrorAlert />
            <Tabs value={tab} onChange={change} variant="pills" radius="xl">
                <Tabs.List mb="lg">
                    <Tabs.Tab value="connections" leftSection={<IconPlugConnected size={16} />} rightSection={<Badge size="xs" variant="light" circle>{connections.length}</Badge>}>{t('Connections')}</Tabs.Tab>
                    <Tabs.Tab value="metrics" leftSection={<IconChartBar size={16} />}>{t('Metrics')}</Tabs.Tab>
                    <Tabs.Tab value="certificates" leftSection={<IconCertificate size={16} />}>{t('Certificates')}</Tabs.Tab>
                    <Tabs.Tab value="policy" leftSection={<IconRoute size={16} />}>{t('Policy editor')}</Tabs.Tab>
                    <Tabs.Tab value="tokens" leftSection={<IconKey size={16} />}>{t('Tokens')}</Tabs.Tab>
                    <Tabs.Tab value="plugins" leftSection={<IconPuzzle size={16} />}>{t('Plugins')}</Tabs.Tab>
                    <Tabs.Tab value="broker" leftSection={<IconServerBolt size={16} />}>{t('Broker')}</Tabs.Tab>
                    <Tabs.Tab value="admin" leftSection={<IconShieldLock size={16} />}>{t('Admin access')}</Tabs.Tab>
                </Tabs.List>
                {TABS.map((v) => (
                    <div key={v} style={{ display: tab === v ? undefined : 'none' }}>
                        {visited.has(v) && (
                            v === 'connections' ? <ConnectionsTab />
                                : v === 'metrics' ? <MetricsTab />
                                    : v === 'certificates' ? <CertificatesTab />
                                        : v === 'policy' ? <PolicyTab />
                                            : v === 'tokens' ? <TokensTab />
                                                : v === 'plugins' ? <PluginsTab />
                                                    : v === 'broker' ? <BrokerTab />
                                                        : <AdminAccessTab />
                        )}
                    </div>
                ))}
            </Tabs>
        </>
    );
}

export function AdvancedSection(): React.JSX.Element {
    const { t } = useTranslation();
    const [opened, setOpened] = useState(false);
    const [everOpened, setEverOpened] = useState(false);
    function toggle() {
        setOpened((o) => !o);
        setEverOpened(true);
    }
    return (
        <HubDataProvider active={opened}>
            <Section
                title={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><IconAdjustments size={18} />{t('Advanced')}</span>}
                description={t('Everything the Federation Hub can do, including raw connections, metrics, trusted CAs, the full policy editor, tokens, plugins, broker settings and admin access.')}
                actions={(
                    <Group gap="xs">
                        {opened && <RefreshButton />}
                        <Button variant="default" radius="xl" size="xs" onClick={toggle} rightSection={opened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />} aria-expanded={opened}>
                            {opened ? t('Hide') : t('Show')}
                        </Button>
                    </Group>
                )}
            >
                <Collapse expanded={opened}>
                    {everOpened && <AdvancedTabs />}
                </Collapse>
            </Section>
        </HubDataProvider>
    );
}

export default AdvancedSection;
