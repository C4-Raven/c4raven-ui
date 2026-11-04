import React, { useCallback, useEffect, useState } from 'react';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Checkbox,
    FileInput,
    Group,
    Modal,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconCertificate, IconDeviceFloppy, IconDownload, IconPlus, IconTrash, IconArrowBackUp } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { downloadFile, EmptyState } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { deleteCaSafely, fetchStoredActive, savePolicy } from './api';
import { addCaToPolicy, formatFingerprint, normalizePolicy, ownCaGroup, policyHasCa, removeEntitiesForCa, shortFingerprint } from './helpers';
import { ConfirmModal, CopyValue, notifyFail, notifyOk, useHubData } from './shared';
import type { CaGroup, Federation } from './types';

const MAX_CA_BYTES = 1024 * 1024;

export default function CertificatesTab() {
    const { t } = useTranslation();
    const { caGroups, federations, reload } = useHubData();
    const [active, setActive] = useState<Federation | null>(null);
    const [nickDrafts, setNickDrafts] = useState<Record<string, string>>({});
    const [savingNick, setSavingNick] = useState<string | null>(null);

    const [addOpen, setAddOpen] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [nickname, setNickname] = useState('');
    const [addToPolicy, setAddToPolicy] = useState(true);
    const [adding, setAdding] = useState(false);

    const [toDelete, setToDelete] = useState<CaGroup | null>(null);
    const [deleting, setDeleting] = useState(false);

    const loadActive = useCallback(() => {
        fetchStoredActive().then(setActive).catch(() => setActive(null));
    }, []);
    useEffect(() => { loadActive(); }, [loadActive, federations]);

    const activePolicy = active ? normalizePolicy(active.policy) : null;
    const own = ownCaGroup(caGroups);

    async function downloadOwnCa() {
        try {
            await downloadFile(endpoints.selfCa, {}, 'federation-hub-ca.pem');
        } catch (err) {
            notifyFail(t('Failed to download CA'), err);
        }
    }

    function addError(): string | null {
        if (file && file.size > MAX_CA_BYTES) { return t('That file is over 1 MB. Upload the single CA certificate, not a bundle.'); }
        if (nickname.trim() && caGroups.some((c) => c.nickname?.trim().toLowerCase() === nickname.trim().toLowerCase())) {
            return t('Another CA already uses that nickname.');
        }
        return null;
    }

    async function addCa() {
        if (!file || addError()) { return; }
        setAdding(true);
        const before = new Set(caGroups.map((c) => c.uid));
        const form = new FormData();
        form.append('file', file);
        form.append('nickname', nickname.trim());
        try {
            await axios.post(endpoints.caGroups, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (err) {
            setAdding(false);
            notifyFail(t('Failed to add CA'), err);
            return;
        }
        let policyNote = '';
        if (addToPolicy) {
            try {
                const r = await axios.get<CaGroup[]>(endpoints.caGroups);
                const added = (r.data ?? []).find((c) => !before.has(c.uid));
                const current = await fetchStoredActive();
                if (!added) {
                    policyNote = t('The CA was already trusted, so the policy was not changed.');
                } else if (!current) {
                    policyNote = t('There is no active policy to add it to.');
                } else {
                    const next = addCaToPolicy(normalizePolicy(current.policy), added, ownCaGroup(r.data ?? []));
                    await savePolicy(current, next, true);
                    policyNote = t('Added to "{{name}}" with All-groups rules both ways, and applied.', { name: current.name, interpolation: { escapeValue: false } });
                }
            } catch (err) {
                notifyFail(t('CA added, but adding it to the active policy failed'), err);
            }
        }
        notifyOk(t('CA added'), policyNote);
        setAdding(false);
        setAddOpen(false);
        setFile(null);
        setNickname('');
        reload();
    }

    async function saveNickname(ca: CaGroup) {
        const next = (nickDrafts[ca.uid] ?? ca.nickname).trim();
        setSavingNick(ca.uid);
        try {
            await axios.patch(endpoints.caGroups, { ...ca, nickname: next });
            notifyOk(t('Nickname saved'));
            setNickDrafts((d) => { const { [ca.uid]: _drop, ...rest } = d; return rest; });
            reload();
        } catch (err) {
            notifyFail(t('Failed to rename CA'), err);
            setNickDrafts((d) => { const { [ca.uid]: _drop, ...rest } = d; return rest; });
        } finally {
            setSavingNick(null);
        }
    }

    async function confirmDelete() {
        if (!toDelete) { return; }
        setDeleting(true);
        try {
            const { nodes, rules } = await deleteCaSafely(toDelete);
            notifyOk(t('CA removed'), nodes || rules
                ? t('Also removed {{nodes}} policy node(s) and {{rules}} rule(s) from the active policy.', { nodes, rules })
                : '');
            setToDelete(null);
            reload();
            loadActive();
        } catch (err) {
            notifyFail(t('Failed to remove CA'), err);
        } finally {
            setDeleting(false);
        }
    }

    const deletePreview = toDelete && activePolicy ? removeEntitiesForCa(activePolicy, toDelete.uid) : null;

    return (
        <Stack gap="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
                <Text size="sm" c="dimmed" maw={680}>
                    {t('Both sides must trust each other\'s CA. Send our CA to the other admin, and add theirs here. A trusted CA only matters once it is a node in the active policy with rules.')}
                </Text>
                <Group gap="sm">
                    <Button variant="default" radius="xl" leftSection={<IconDownload size={16} />} onClick={downloadOwnCa}>{t('Download our CA')}</Button>
                    <Button radius="xl" leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>{t('Add CA')}</Button>
                </Group>
            </Group>

            {caGroups.length === 0 ? (
                <EmptyState icon={<IconCertificate size={26} />} title={t('No trusted CAs')} description={t('The hub doesn\'t trust any CA yet, not even its own. Re-run the Federation Hub installer.')} />
            ) : (
                <Table.ScrollContainer minWidth={1000}>
                    <Table striped withTableBorder verticalSpacing="sm">
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th miw={240}>{t('Nickname')}</Table.Th>
                                <Table.Th>{t('SHA-256 fingerprint')}</Table.Th>
                                <Table.Th>{t('Subject')}</Table.Th>
                                <Table.Th>{t('Issuer')}</Table.Th>
                                <Table.Th>{t('Status')}</Table.Th>
                                <Table.Th />
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {caGroups.map((ca) => {
                                const draft = nickDrafts[ca.uid] ?? ca.nickname ?? '';
                                const changed = draft.trim() !== (ca.nickname ?? '');
                                const inPolicy = activePolicy ? policyHasCa(activePolicy, ca.uid) : null;
                                return (
                                    <Table.Tr key={ca.uid}>
                                        <Table.Td>
                                            <Group gap={4} wrap="nowrap">
                                                <TextInput
                                                    size="xs"
                                                    value={draft}
                                                    onChange={(e) => { const v = e.currentTarget.value; setNickDrafts((d) => ({ ...d, [ca.uid]: v })); }}
                                                    onKeyDown={(e) => { if (e.key === 'Enter' && changed) { saveNickname(ca); } }}
                                                    style={{ flex: 1 }}
                                                    aria-label={t('Nickname')}
                                                />
                                                {changed && (
                                                    <>
                                                        <Tooltip label={t('Save nickname')}>
                                                            <ActionIcon variant="light" loading={savingNick === ca.uid} onClick={() => saveNickname(ca)} aria-label={t('Save nickname')}>
                                                                <IconDeviceFloppy size={16} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                        <Tooltip label={t('Undo')}>
                                                            <ActionIcon variant="subtle" color="gray" onClick={() => setNickDrafts((d) => { const { [ca.uid]: _drop, ...rest } = d; return rest; })} aria-label={t('Undo')}>
                                                                <IconArrowBackUp size={16} />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </>
                                                )}
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <Group gap={2} wrap="nowrap">
                                                <Tooltip label={formatFingerprint(ca.alias)} multiline maw={360}>
                                                    <Text size="xs" ff="monospace">{shortFingerprint(ca.alias)}</Text>
                                                </Tooltip>
                                                <CopyValue value={formatFingerprint(ca.alias)} label={t('Copy fingerprint')} />
                                                <CopyValue value={ca.uid} label={t('Copy CA group id (uid)')} />
                                            </Group>
                                        </Table.Td>
                                        <Table.Td><Text size="xs" style={{ wordBreak: 'break-word' }}>{ca.subject}</Text></Table.Td>
                                        <Table.Td><Text size="xs" style={{ wordBreak: 'break-word' }}>{ca.issuer}</Text></Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                {ca.hubGroup && <Badge color="blue" variant="light">{t('This hub')}</Badge>}
                                                {inPolicy === true && <Badge color="green" variant="light">{t('In active policy')}</Badge>}
                                                {inPolicy === false && (
                                                    <Tooltip label={t('Trusted, but nobody using this CA can connect until it is a node in the active policy.')} multiline maw={300}>
                                                        <Badge color="orange" variant="light">{t('Not in policy')}</Badge>
                                                    </Tooltip>
                                                )}
                                            </Group>
                                        </Table.Td>
                                        <Table.Td>
                                            <Tooltip label={t('Remove')}>
                                                <ActionIcon color="red" variant="subtle" onClick={() => setToDelete(ca)} aria-label={t('Remove')}>
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Table.Td>
                                    </Table.Tr>
                                );
                            })}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            )}

            <Modal opened={addOpen} onClose={() => setAddOpen(false)} title={<Text fw={700}>{t('Add a trusted CA')}</Text>} centered>
                <Stack gap="sm">
                    <FileInput
                        label={t('CA certificate file')}
                        description={t('The single CA certificate (PEM or DER) that issued the other server\'s certificate. Not a chain.')}
                        value={file}
                        onChange={setFile}
                        accept=".pem,.crt,.cer,.der"
                        clearable
                    />
                    <TextInput
                        label={t('Nickname')}
                        description={t('Every Raven hub CA has the same name, so give it one you\'ll recognise.')}
                        value={nickname}
                        onChange={(e) => setNickname(e.currentTarget.value)}
                    />
                    <Checkbox
                        checked={addToPolicy}
                        onChange={(e) => setAddToPolicy(e.currentTarget.checked)}
                        label={t('Also add it to the active policy')}
                        description={own
                            ? t('Adds a node for this CA with All-groups rules both ways to this hub\'s own CA ({{own}}), then applies the policy.', { own: own.nickname || shortFingerprint(own.alias), interpolation: { escapeValue: false } })
                            : t('Adds a node for this CA to the active policy and applies it.')}
                    />
                    {addError() && <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>{addError()}</Alert>}
                </Stack>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setAddOpen(false)}>{t('Cancel')}</Button>
                    <Button radius="xl" loading={adding} disabled={!file || !!addError()} onClick={addCa}>{t('Add CA')}</Button>
                </Group>
            </Modal>

            <ConfirmModal
                opened={toDelete !== null}
                onClose={() => setToDelete(null)}
                onConfirm={confirmDelete}
                loading={deleting}
                title={t('Remove this CA?')}
                confirmLabel={t('Remove CA')}
                requireText={toDelete?.hubGroup ? (toDelete.nickname || 'REMOVE') : undefined}
            >
                <Text size="sm">
                    {t('Servers whose certificates come from "{{name}}" lose federation access.', { name: toDelete?.nickname || shortFingerprint(toDelete?.alias), interpolation: { escapeValue: false } })}
                </Text>
                {deletePreview && (deletePreview.removedEntities.length > 0 || deletePreview.removedRules.length > 0) && (
                    <Text size="sm">
                        {t('First, {{nodes}} node(s) and {{rules}} rule(s) that use it are removed from the active policy "{{policy}}" and the policy is applied. Then the CA is removed.', {
                            nodes: deletePreview.removedEntities.length,
                            rules: deletePreview.removedRules.length,
                            policy: active?.name ?? '',
                            interpolation: { escapeValue: false },
                        })}
                    </Text>
                )}
                <Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
                    {t('Removing a CA restarts the hub\'s federation listener, so EVERY connection drops for a few seconds and reconnects.')}
                </Alert>
                {toDelete?.hubGroup && (
                    <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
                        {t('This is the hub\'s OWN CA. This Raven\'s bridge and every partner using our certificates will be refused.')}
                    </Alert>
                )}
            </ConfirmModal>
        </Stack>
    );
}
