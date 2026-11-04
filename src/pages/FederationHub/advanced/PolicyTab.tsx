import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Divider,
    Group,
    JsonInput,
    Menu,
    Modal,
    Paper,
    Stack,
    Switch,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { IconAlertTriangle, IconArrowBackUp, IconChevronDown, IconCloudUpload, IconDeviceFloppy, IconDownload, IconFilePlus, IconPlayerPlay, IconTrash } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import FederationPolicyDiagram, { type DiagramRule } from '../../../components/FederationPolicyDiagram';
import { formatDateTime } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { activatePolicy, errorCode, fetchActivePolicy, saveText, savePolicy } from './api';
import { blankFederation, buildSaveBody, filterWarnings, isPolicyDirty, normalizePolicy, orphanRules, ownCaGroup, ownNodeActive, parsePolicyJson, pluginRoutingValid, restoreOwnNode, stableStringify, withGroupSets } from './helpers';
import { ActiveBadge, ConfirmModal, notifyFail, notifyOk, useHubData } from './shared';
import type { Federation, GraphView, PolicyCore, PolicyPluginRouting } from './types';
import NodesSection from './policy/NodesSection';
import RulesSection from './policy/RulesSection';
import GroupSetsSection from './policy/GroupSetsSection';
import PluginRoutingSection from './policy/PluginRoutingSection';

type PendingSwitch = { kind: 'open'; fed: Federation } | { kind: 'new' } | null;

export default function PolicyTab() {
    const { t } = useTranslation();
    const { federations, activeName, caGroups, connections, plugins: registeredPlugins, reload } = useHubData();
    const own = ownCaGroup(caGroups);

    const [base, setBase] = useState<Federation | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [saved, setSaved] = useState<PolicyCore>(normalizePolicy({}));
    const [draft, setDraftState] = useState<PolicyCore>(normalizePolicy({}));
    const [views, setViews] = useState<GraphView | undefined>(undefined);
    const [rawText, setRawText] = useState('{}');
    const [rawInvalid, setRawInvalid] = useState(false);
    const [showRaw, setShowRaw] = useState(false);
    const [diagramKey, setDiagramKey] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);

    const [pending, setPending] = useState<PendingSwitch>(null);
    const [newOpen, setNewOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const [confirmApply, setConfirmApply] = useState(false);
    const [confirmActivate, setConfirmActivate] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    /** The server refused to apply/activate: own CA node missing (own_ca_missing_from_policy). */
    const [ownRefused, setOwnRefused] = useState<'save' | 'activate' | null>(null);
    /** The stored version of the ACTIVE policy differs from what the hub enforces (e.g. after "Save only"). */
    const [savedNotApplied, setSavedNotApplied] = useState(false);
    const [description, setDescription] = useState('');
    const [plugins, setPlugins] = useState<PolicyPluginRouting[]>([]);
    const [renameOpen, setRenameOpen] = useState(false);
    const [renameTo, setRenameTo] = useState('');
    const [confirmForce, setConfirmForce] = useState(false);

    const modelDirty = !!base && (description !== (base.description ?? '') || stableStringify(plugins) !== stableStringify(base.plugins ?? []));
    const pluginsInvalid = !pluginRoutingValid(plugins);
    const dirty = !!base && (isNew || isPolicyDirty(saved, draft) || modelDirty);
    const isActive = !!base && !isNew && base.name === activeName;
    const remote = base ? federations.find((f) => f.name === base.name) : undefined;
    const changedOnHub = !!base && !isNew && !!remote && dirty && remote.modifiedDate !== base.modifiedDate;

    const setDraft = useCallback((p: PolicyCore) => {
        setDraftState(p);
        setRawText(JSON.stringify(p, null, 2));
        setRawInvalid(false);
    }, []);

    const load = useCallback((fed: Federation, fresh: boolean) => {
        const p = normalizePolicy(fed.policy);
        setBase(fed);
        setIsNew(fresh);
        setSaved(fresh ? normalizePolicy({}) : p);
        setDraft(p);
        setViews(fed.views?.graph);
        setDescription(fed.description ?? '');
        setPlugins(fed.plugins ?? []);
        setSavedNotApplied(false);
        setDiagramKey((k) => k + 1);
    }, [setDraft]);

    // Pick up hub changes (e.g. a CA added from the Certificates tab) when there's nothing unsaved.
    const dirtyRef = useRef(dirty);
    dirtyRef.current = dirty;
    useEffect(() => {
        if (!base || isNew || dirtyRef.current) { return; }
        const fresh = federations.find((f) => f.name === base.name);
        if (fresh && stableStringify(fresh) !== stableStringify(base)) {
            const p = normalizePolicy(fresh.policy);
            setBase(fresh);
            setSaved(p);
            setDraft(p);
            setViews(fresh.views?.graph);
            setDescription(fresh.description ?? '');
            setPlugins(fresh.plugins ?? []);
        }
    }, [federations, base, isNew, setDraft]);

    // Is the stored version of the active policy what the hub actually enforces?
    useEffect(() => {
        if (!base || isNew || base.name !== activeName) { setSavedNotApplied(false); return undefined; }
        let cancelled = false;
        fetchActivePolicy()
            .then((enforced) => {
                if (cancelled || !enforced) { return; }
                setSavedNotApplied(stableStringify(normalizePolicy(enforced.policy)) !== stableStringify(saved));
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [base, isNew, activeName, saved]);

    // Warn before leaving the page with unsaved policy edits.
    useEffect(() => {
        if (!dirty) { return undefined; }
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [dirty]);

    function requestOpen(fed: Federation) {
        if (base && fed.name === base.name && !isNew) { return; }
        if (dirty) { setPending({ kind: 'open', fed }); return; }
        load(fed, false);
    }
    function requestNew() {
        if (dirty) { setPending({ kind: 'new' }); return; }
        setNewName('');
        setNewOpen(true);
    }
    function proceedPending() {
        const p = pending;
        setPending(null);
        if (!p) { return; }
        if (p.kind === 'open') { load(p.fed, false); } else { setNewName(''); setNewOpen(true); }
    }

    function onRawChange(text: string) {
        setRawText(text);
        const parsed = parsePolicyJson(text);
        setRawInvalid(parsed === null);
        if (parsed) { setDraftState(parsed); }
    }

    /** The stored model to send: the latest layout (drags save separately and base.views can be stale) and description. */
    function currentFederation(fed: Federation): Federation {
        return { ...fed, description, plugins, views: views ? { ...(fed.views ?? {}), graph: views } : fed.views };
    }

    async function doSave(activate: boolean, policy: PolicyCore = draft, force = false) {
        if (!base || rawInvalid || pluginsInvalid) { return; }
        setBusy(activate ? 'apply' : 'save');
        try {
            await savePolicy(currentFederation(base), policy, activate, force);
            notifyOk(activate ? t('Policy saved and applied') : t('Policy saved'), activate ? t('The hub is now enforcing "{{name}}".', { name: base.name, interpolation: { escapeValue: false } }) : t('Saved but not applied. The hub keeps enforcing the active policy until you apply.'));
            const nextBase = { ...currentFederation(base), policy };
            setBase(nextBase);
            setSavedNotApplied(!activate && base.name === activeName);
            setSaved(policy);
            if (policy !== draft) { setDraft(policy); setDiagramKey((k) => k + 1); }
            setIsNew(false);
            setConfirmApply(false);
            setOwnRefused(null);
            setConfirmForce(false);
            await reload();
        } catch (err) {
            if (activate && errorCode(err) === 'own_ca_missing_from_policy') {
                setConfirmApply(false);
                setOwnRefused('save');
                return;
            }
            notifyFail(activate ? t('Failed to save and apply the policy') : t('Failed to save policy'), err);
        } finally {
            setBusy(null);
        }
    }

    function requestApply() {
        // Applying a different policy replaces the active one; a policy without our own CA locks out the bridge (G1).
        if ((activeName && base && base.name !== activeName) || (own && !ownNodeActive(draft, own.uid))) {
            setConfirmApply(true);
        } else {
            doSave(true);
        }
    }

    async function doActivate(force = false) {
        if (!base) { return; }
        setBusy('activate');
        try {
            await activatePolicy(base.name, force);
            notifyOk(t('Policy applied'), t('The hub is now enforcing "{{name}}".', { name: base.name, interpolation: { escapeValue: false } }));
            setConfirmActivate(false);
            setOwnRefused(null);
            setConfirmForce(false);
            setSavedNotApplied(false);
            await reload();
        } catch (err) {
            if (!force && errorCode(err) === 'own_ca_missing_from_policy') {
                setConfirmActivate(false);
                setOwnRefused('activate');
                return;
            }
            notifyFail(t('Failed to apply the policy'), err);
        } finally {
            setBusy(null);
        }
    }

    /**
     * Rename = save under the new name, activate it if the old one was active,
     * then delete the old one. The hub has no rename of its own.
     */
    async function doRename() {
        if (!base) { return; }
        const to = renameTo.trim();
        if (!to || to === base.name) { setRenameOpen(false); return; }
        if (federations.some((f) => f.name === to)) { return; }
        const from = base.name;
        const wasActive = from === activeName;
        setBusy('rename');
        let stage: 'save' | 'activate' | 'delete' = 'save';
        try {
            const renamed = { ...currentFederation(base), name: to };
            await savePolicy(renamed, saved, false);
            if (wasActive) {
                stage = 'activate';
                await activatePolicy(to);
            }
            stage = 'delete';
            await axios.delete(endpoints.deleteFederation(from));
            notifyOk(t('Policy renamed'), t('"{{from}}" is now "{{to}}".', { from, to, interpolation: { escapeValue: false } }));
            setRenameOpen(false);
            load({ ...renamed, policy: saved }, false);
            await reload();
        } catch (err) {
            const where = stage === 'save'
                ? t('Nothing was changed.')
                : stage === 'activate'
                    ? t('"{{to}}" was saved but isn\'t active; "{{from}}" is still active and was kept.', { from, to, interpolation: { escapeValue: false } })
                    : t('"{{to}}" was saved (and activated if needed), but the old "{{from}}" couldn\'t be deleted. Delete it by hand.', { from, to, interpolation: { escapeValue: false } });
            notifyFail(`${t('Rename failed')}. ${where}`, err);
            await reload();
        } finally {
            setBusy(null);
        }
    }

    async function doDelete() {
        if (!base) { return; }
        setBusy('delete');
        try {
            await axios.delete(endpoints.deleteFederation(base.name));
            notifyOk(t('Policy deleted'));
            setConfirmDelete(false);
            setBase(null);
            setIsNew(false);
            await reload();
        } catch (err) {
            notifyFail(t('Failed to delete the policy'), err);
        } finally {
            setBusy(null);
        }
    }

    async function doExport(format: 'json' | 'yaml') {
        if (!base) { return; }
        try {
            const r = await axios.get(endpoints.exportFederation(base.name), { params: { format }, responseType: 'text', transformResponse: (d) => d });
            const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
            saveText(text, `${base.name}.${format === 'yaml' ? 'yaml' : 'json'}`, format === 'yaml' ? 'text/yaml' : 'application/json');
        } catch (err) {
            notifyFail(t('Export failed'), err);
        }
    }

    function saveViews(graph: GraphView) {
        setViews(graph);
        if (!base || isNew) { return; }
        // Layout is saved straight away (it doesn't change routing); the policy itself waits for Save.
        axios.post(endpoints.policyView, { name: base.name, views: { graph } })
            .catch((err) => notifyFail(t('Failed to save layout'), err));
    }

    async function applyGroupSetsOnly() {
        if (!base || isNew) { return; }
        setBusy('groupsets');
        try {
            // Saved rules can still name a set the draft deleted: strip those references too.
            const next = withGroupSets(saved, draft.groupSets);
            await axios.post(endpoints.connectionGroupSets, buildSaveBody(base, next));
            setSaved(next);
            notifyOk(t('Group sets applied'));
            await reload();
        } catch (err) {
            notifyFail(t('Failed to apply group sets'), err);
        } finally {
            setBusy(null);
        }
    }

    const warnings = useMemo(() => filterWarnings(draft, own?.uid ?? null), [draft, own]);
    const orphans = useMemo(() => orphanRules(draft), [draft]);
    const ownMissing = !!own && !!base && !ownNodeActive(draft, own.uid);
    const tokensInPolicy = draft.entities.some((e) => (e.type === 'FederationTokenGroup' && Array.isArray(e.config?.tokens) && e.config.tokens.length > 0) || !!e.config?.token);

    return (
        <Stack gap="md">
            <Group justify="space-between" wrap="wrap">
                <Text size="sm" c="dimmed" maw={680}>
                    {t('A policy is the hub\'s routing graph. Several can be stored; exactly one is active. Edits here are a draft until you press "Save & apply".')}
                </Text>
                <Button size="xs" radius="xl" variant="light" leftSection={<IconFilePlus size={14} />} onClick={requestNew}>{t('New policy')}</Button>
            </Group>

            {!activeName && (
                <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                    {t('No policy is active, so the hub refuses every connection, including this Raven\'s bridge. Open a policy and apply it.')}
                </Alert>
            )}

            <Table.ScrollContainer minWidth={640}>
                <Table striped highlightOnHover withTableBorder>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>{t('Name')}</Table.Th>
                            <Table.Th>{t('Status')}</Table.Th>
                            <Table.Th>{t('Version')}</Table.Th>
                            <Table.Th>{t('Description')}</Table.Th>
                            <Table.Th>{t('Last modified')}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {federations.length === 0 && (
                            <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" size="sm">{t('No policies stored on the hub')}</Text></Table.Td></Table.Tr>
                        )}
                        {federations.map((f) => (
                            <Table.Tr
                                key={f.name}
                                onClick={() => requestOpen(f)}
                                style={{ cursor: 'pointer' }}
                                bg={base?.name === f.name && !isNew ? 'var(--mantine-color-blue-light)' : undefined}
                            >
                                <Table.Td><Text size="sm" fw={600}>{f.name}</Text></Table.Td>
                                <Table.Td><ActiveBadge active={f.name === activeName} /></Table.Td>
                                <Table.Td>{f.version ?? '—'}</Table.Td>
                                <Table.Td>{f.description || '—'}</Table.Td>
                                <Table.Td>{formatDateTime(f.modifiedDate ?? null)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </Table.ScrollContainer>

            {!base && <Text size="sm" c="dimmed" ta="center">{t('Click a policy to open it.')}</Text>}

            {base && (
                <Paper p="md" className="raven-surface" withBorder>
                    <Group justify="space-between" wrap="wrap" mb="sm" gap="sm">
                        <Group gap="xs">
                            <Title order={4}>{base.name}</Title>
                            {isNew ? <Badge color="blue" variant="light">{t('New, not on the hub yet')}</Badge> : <ActiveBadge active={isActive} />}
                            {dirty
                                ? <Badge color="yellow" variant="filled">{t('Unsaved changes')}</Badge>
                                : savedNotApplied
                                    ? <Badge color="orange" variant="filled">{t('Saved, not applied')}</Badge>
                                    : <Badge color="gray" variant="outline">{t('Saved')}</Badge>}
                        </Group>
                        <Group gap="xs">
                            <Button size="xs" radius="xl" variant="default" leftSection={<IconArrowBackUp size={14} />} disabled={!dirty || isNew} onClick={() => load(base, false)}>{t('Discard changes')}</Button>
                            <Button size="xs" radius="xl" variant="default" leftSection={<IconDeviceFloppy size={14} />} disabled={!dirty || rawInvalid || pluginsInvalid} loading={busy === 'save'} onClick={() => doSave(false)}>{t('Save only')}</Button>
                            <Button size="xs" radius="xl" className="raven-cta" leftSection={<IconCloudUpload size={14} />} disabled={rawInvalid || pluginsInvalid || (!dirty && isActive && !savedNotApplied)} loading={busy === 'apply'} onClick={requestApply}>{t('Save & apply')}</Button>
                            <Menu position="bottom-end" withinPortal>
                                <Menu.Target>
                                    <Button size="xs" radius="xl" variant="default" rightSection={<IconChevronDown size={14} />}>{t('More')}</Button>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Item leftSection={<IconPlayerPlay size={16} />} disabled={isNew || dirty || (isActive && !savedNotApplied)} onClick={() => setConfirmActivate(true)}>{t('Apply saved version (activate)')}</Menu.Item>
                                    <Menu.Item disabled={isNew || dirty} onClick={() => { setRenameTo(base.name); setRenameOpen(true); }}>{t('Rename…')}</Menu.Item>
                                    <Menu.Item leftSection={<IconDownload size={16} />} disabled={isNew} onClick={() => doExport('json')}>{t('Export saved version as JSON')}</Menu.Item>
                                    <Menu.Item leftSection={<IconDownload size={16} />} disabled={isNew} onClick={() => doExport('yaml')}>{t('Export saved version as YAML')}</Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Item color="red" leftSection={<IconTrash size={16} />} disabled={isNew} onClick={() => setConfirmDelete(true)}>{t('Delete policy')}</Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        </Group>
                    </Group>

                    <TextInput
                        label={t('Policy description')}
                        value={description}
                        onChange={(e) => setDescription(e.currentTarget.value)}
                        mb="sm"
                        maw={640}
                    />
                    <Stack gap="sm" mb="md">
                        {savedNotApplied && !dirty && (
                            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>{t('The saved version differs from what the hub is enforcing. "Apply saved version" or "Save & apply" makes the hub enforce it.')}</Alert>
                        )}
                        {!isActive && !isNew && (
                            <Alert color="blue" variant="light">{t('This policy is stored but not active. The hub is enforcing "{{name}}". "Save & apply" makes this one active instead.', { name: activeName ?? t('nothing'), interpolation: { escapeValue: false } })}</Alert>
                        )}
                        {changedOnHub && (
                            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>{t('This policy changed on the hub after you opened it. Saving overwrites those changes; discard to load the latest.')}</Alert>
                        )}
                        {ownMissing && (
                            <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{t('This hub\'s own CA isn\'t an enabled node in this policy (it is missing or turned off). If applied, this Raven\'s bridge is refused. Add it with "Add node", or turn it back on.')}</Alert>
                        )}
                        {orphans.length > 0 && (
                            <Alert color="orange" variant="light">
                                <Group justify="space-between" wrap="wrap" gap="xs">
                                    <Text size="sm">{t('{{count}} rule(s) point at nodes that no longer exist.', { count: orphans.length, interpolation: { escapeValue: false } })}</Text>
                                    <Button size="xs" radius="xl" variant="light" color="orange" onClick={() => { const ids = new Set(orphans.map((r) => r.id)); setDraft({ ...draft, rules: draft.rules.filter((r) => !ids.has(r.id)) }); }}>{t('Remove them from the draft')}</Button>
                                </Group>
                            </Alert>
                        )}
                        {warnings.length > 0 && (
                            <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>{t('{{count}} rule(s) from a Raven node use a group filter. Raven traffic only passes "All groups" rules. See Rules below.', { count: warnings.length, interpolation: { escapeValue: false } })}</Alert>
                        )}
                    </Stack>

                    <Stack gap="lg">
                        <NodesSection policy={draft} onChange={setDraft} caGroups={caGroups} connections={connections} policyActive={isActive && !dirty} ownCa={own} />
                        <Divider />
                        <RulesSection policy={draft} onChange={setDraft} caGroups={caGroups} ownCaUid={own?.uid ?? null} />
                        <Divider />
                        <GroupSetsSection
                            policy={draft}
                            onChange={setDraft}
                            caGroups={caGroups}
                            canApplyNow={!isNew}
                            groupSetsDirty={stableStringify(saved.groupSets) !== stableStringify(draft.groupSets)}
                            applying={busy === 'groupsets'}
                            onApplyNow={applyGroupSetsOnly}
                        />
                        <Divider />
                        <PluginRoutingSection plugins={plugins} onChange={setPlugins} registered={registeredPlugins} entities={draft.entities} />
                        <Divider />
                        <div>
                            <Text fw={600}>{t('Connection map')}</Text>
                            <Text size="sm" c="dimmed" mb="sm">{t('Drag nodes to arrange them (the layout saves straight away). Click two nodes to draw a rule; rule changes go into the draft.')}</Text>
                            <FederationPolicyDiagram
                                key={`${base.name}-${diagramKey}`}
                                entities={draft.entities}
                                rules={draft.rules as DiagramRule[]}
                                views={views}
                                knownGroups={[]}
                                connections={connections}
                                onRulesChange={(rules) => setDraft({ ...draft, rules })}
                                onViewsChange={saveViews}
                            />
                        </div>
                        <Divider />
                        <div>
                            <Group justify="space-between" wrap="wrap">
                                <Text fw={600}>{t('Raw policy JSON')}</Text>
                                <Switch label={t('Show')} checked={showRaw} onChange={(e) => setShowRaw(e.currentTarget.checked)} />
                            </Group>
                            {showRaw && (
                                <Stack gap="xs" mt="xs">
                                    {tokensInPolicy && <Alert color="orange" variant="light">{t('This JSON contains federation tokens in plain text.')}</Alert>}
                                    <JsonInput value={rawText} onChange={onRawChange} minRows={12} maxRows={40} autosize formatOnBlur validationError={t('Invalid JSON')} error={rawInvalid ? t('Invalid JSON. Fix it before saving.') : undefined} />
                                </Stack>
                            )}
                        </div>
                    </Stack>
                </Paper>
            )}

            <ConfirmModal opened={pending !== null} onClose={() => setPending(null)} onConfirm={proceedPending} title={t('Discard unsaved changes?')} confirmLabel={t('Discard changes')}>
                <Text size="sm">{t('"{{name}}" has changes that haven\'t been saved to the hub. They will be lost.', { name: base?.name ?? '', interpolation: { escapeValue: false } })}</Text>
            </ConfirmModal>

            <ConfirmModal opened={confirmApply} onClose={() => setConfirmApply(false)} onConfirm={() => doSave(true)} loading={busy === 'apply'} title={t('Apply this policy?')} confirmLabel={t('Save & apply')} color="blue">
                {activeName && base && base.name !== activeName && (
                    <Text size="sm">{t('"{{name}}" replaces "{{active}}" as the active policy. Connections allowed only by "{{active}}" will be dropped.', { name: base.name, active: activeName, interpolation: { escapeValue: false } })}</Text>
                )}
                {ownMissing && <Text size="sm" c="red">{t('This hub\'s own CA isn\'t in this policy, so this Raven\'s bridge will be refused.')}</Text>}
            </ConfirmModal>

            <ConfirmModal
                opened={ownRefused !== null}
                onClose={() => setOwnRefused(null)}
                onConfirm={() => {
                    if (!own) { setOwnRefused(null); return; }
                    // Activate refused: the saved version is what was refused, so fix that one.
                    doSave(true, restoreOwnNode(ownRefused === 'activate' ? saved : draft, own));
                }}
                loading={busy === 'apply' || busy === 'activate'}
                title={t('This would cut off this Raven')}
                confirmLabel={own ? t('Add it back and apply') : t('Close')}
                color="blue"
            >
                <Text size="sm">
                    {t('The hub refused to apply "{{name}}" because this server\'s own certificate node is missing from it (or turned off). Without that node the hub refuses this Raven\'s own bridge, so nothing from this server is federated any more.', { name: base?.name ?? '', interpolation: { escapeValue: false } })}
                </Text>
                {own
                    ? <Text size="sm">{t('"Add it back" puts the node "{{own}}" back with rules both ways to every other server in the policy, then applies it.', { own: own.nickname || own.uid, interpolation: { escapeValue: false } })}</Text>
                    : <Text size="sm" c="red">{t('The hub doesn\'t report its own certificate, so it can\'t be added back from here.')}</Text>}
                <Button variant="subtle" color="red" size="xs" radius="xl" onClick={() => { setConfirmForce(true); }}>
                    {t('Apply without it anyway…')}
                </Button>
            </ConfirmModal>

            <ConfirmModal
                opened={confirmForce}
                onClose={() => setConfirmForce(false)}
                onConfirm={() => {
                    const from = ownRefused;
                    setOwnRefused(null);
                    if (from === 'activate') { doActivate(true); } else { doSave(true, draft, true); }
                }}
                loading={busy === 'apply' || busy === 'activate'}
                title={t('Cut off this Raven\'s bridge?')}
                confirmLabel={t('Apply without our certificate')}
                requireText="CUT OFF"
            >
                <Text size="sm" c="red">{t('The hub will refuse this Raven\'s own bridge as soon as this is applied. Devices on this server stop being federated until a policy with our certificate is applied again.')}</Text>
            </ConfirmModal>

            <ConfirmModal
                opened={renameOpen}
                onClose={() => setRenameOpen(false)}
                onConfirm={doRename}
                loading={busy === 'rename'}
                title={t('Rename this policy?')}
                confirmLabel={t('Rename')}
                color="blue"
            >
                <TextInput
                    label={t('New name')}
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.currentTarget.value)}
                    error={renameTo.trim() && renameTo.trim() !== base?.name && federations.some((f) => f.name === renameTo.trim()) ? t('Another policy already has this name') : undefined}
                    data-autofocus
                />
                <Text size="sm">
                    {base?.name === activeName
                        ? t('The hub can\'t rename a policy. Raven saves a copy under the new name, makes the copy the active policy, then deletes "{{name}}". Partners stay connected; if a step fails you are told what was left.', { name: base?.name ?? '', interpolation: { escapeValue: false } })
                        : t('The hub can\'t rename a policy. Raven saves a copy under the new name, then deletes "{{name}}".', { name: base?.name ?? '', interpolation: { escapeValue: false } })}
                </Text>
            </ConfirmModal>

            <ConfirmModal opened={confirmActivate} onClose={() => setConfirmActivate(false)} onConfirm={() => doActivate()} loading={busy === 'activate'} title={t('Make this the active policy?')} confirmLabel={t('Apply')} color="blue">
                <Text size="sm">{t('The hub stops enforcing "{{active}}" and starts enforcing the saved version of "{{name}}".', { name: base?.name ?? '', active: activeName ?? t('nothing'), interpolation: { escapeValue: false } })}</Text>
            </ConfirmModal>

            <ConfirmModal
                opened={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={doDelete}
                loading={busy === 'delete'}
                title={isActive ? t('Delete the ACTIVE policy?') : t('Delete this policy?')}
                confirmLabel={t('Delete policy')}
                requireText={isActive ? base?.name : undefined}
            >
                {isActive ? (
                    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                        {t('This is the policy the hub is enforcing. Deleting it leaves the hub with NO policy, so every federation link stops and this Raven\'s bridge is refused until another policy is applied.')}
                    </Alert>
                ) : (
                    <Text size="sm">{t('The stored policy "{{name}}" is deleted from the hub. The active policy is not affected.', { name: base?.name ?? '', interpolation: { escapeValue: false } })}</Text>
                )}
            </ConfirmModal>

            <Modal opened={newOpen} onClose={() => setNewOpen(false)} title={<Text fw={700}>{t('New policy')}</Text>} centered>
                <Stack gap="sm">
                    <TextInput
                        label={t('Name')}
                        value={newName}
                        onChange={(e) => setNewName(e.currentTarget.value)}
                        error={federations.some((f) => f.name === newName.trim()) ? t('A policy with this name already exists') : undefined}
                        data-autofocus
                    />
                    <Text size="xs" c="dimmed">{t('Starts with this hub\'s own CA as its only node. Nothing is stored until you save.')}</Text>
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setNewOpen(false)}>{t('Cancel')}</Button>
                    <Button
                        radius="xl"
                        disabled={!/^[\w.-]+$/.test(newName.trim()) || federations.some((f) => f.name === newName.trim())}
                        onClick={() => { load(blankFederation(newName.trim(), own), true); setNewOpen(false); }}
                    >
                        {t('Create draft')}
                    </Button>
                </Group>
            </Modal>
        </Stack>
    );
}
