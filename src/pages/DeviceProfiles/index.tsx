import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Anchor,
    Badge,
    Button,
    Group,
    Modal,
    Paper,
    SimpleGrid,
    Skeleton,
    Stack,
    Text,
    ThemeIcon,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAdjustments,
    IconCirclePlus,
    IconDeviceMobileCog,
    IconEye,
    IconPackage,
    IconPlugConnected,
    IconPuzzle,
    IconQrcode,
    IconTrash,
    IconUsers,
    IconX,
} from '@tabler/icons-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import { downloadFile, EmptyState, extractError, Section } from '../ServerRequests/shared';
import ProfileCard from './ProfileCard';
import ProfileEditor from './ProfileEditor';
import PreviewPanel from './PreviewPanel';
import { findSetting } from './settingsCatalog';
import {
    blankProfile,
    ON_CONNECT_KEY,
    settingLabel,
    starterTemplates,
    toInput,
    type Extras,
    type ExtraItem,
    type Profile,
    type ProfileInput,
} from './types';

function HowItWorks() {
    const { t } = useTranslation();
    const onConnectLabel = findSetting(ON_CONNECT_KEY)?.label ?? t('Apply server profile updates on connect');
    const items = [
        {
            icon: <IconAdjustments size={18} />,
            title: t('What'),
            body: t('A profile is a named set of ATAK settings, like team colour, map units or server options, that the server pushes to devices so you don\'t have to set each phone up by hand.'),
        },
        {
            icon: <IconUsers size={18} />,
            title: t('Who'),
            body: t('Send a profile to everyone, or only to certain groups, users or devices. When profiles disagree, the most specific one wins.'),
        },
        {
            icon: <IconQrcode size={18} />,
            title: t('When'),
            body: t('Devices get a profile when they are first enrolled, and optionally every time ATAK connects. Connect-time updates rely on "{{setting}}", which the server switches on when a device enrolls.', { setting: onConnectLabel, interpolation: { escapeValue: false } }),
        },
    ];
    return (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
            {items.map((it) => (
                <Paper key={it.title} p="md" className="raven-surface raven-surface--tile">
                    <Group gap="sm" wrap="nowrap" align="flex-start">
                        <ThemeIcon variant="light" radius="xl" size="lg">{it.icon}</ThemeIcon>
                        <div>
                            <Text fw={600} size="sm">{it.title}</Text>
                            <Text size="sm" c="dimmed">{it.body}</Text>
                        </div>
                    </Group>
                </Paper>
            ))}
        </SimpleGrid>
    );
}

function ExtraList({ items, emptyText }: { items: ExtraItem[]; emptyText: string }) {
    const { t } = useTranslation();
    if (items.length === 0) { return <Text size="sm" c="dimmed">{emptyText}</Text>; }
    return (
        <Stack gap={6}>
            {items.map((it) => (
                <Group key={it.name} gap={6} wrap="wrap" justify="space-between">
                    <Text size="sm" style={{ wordBreak: 'break-word' }}>{it.name}</Text>
                    <Group gap={4}>
                        {it.install_on_enrollment && <Badge size="xs" variant="light" color="indigo" tt="none">{t('On enrollment')}</Badge>}
                        {it.install_on_connection && <Badge size="xs" variant="light" color="orange" tt="none">{t('Every connection')}</Badge>}
                    </Group>
                </Group>
            ))}
        </Stack>
    );
}

export default function DeviceProfiles() {
    const { t } = useTranslation();
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [extras, setExtras] = useState<Extras | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<Profile | null>(null);
    const [initial, setInitial] = useState<ProfileInput>(blankProfile);
    const [toDelete, setToDelete] = useState<Profile | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);

    const templates = useMemo(() => starterTemplates(), []);

    const showError = useCallback(async (title: string, err: unknown) => {
        notifications.show({ title, message: await extractError(err), icon: <IconX size={16} />, color: 'red' });
    }, []);

    const load = useCallback(() => {
        return axios.get(apiRoutes.deviceProfileSets)
            .then((r) => setProfiles(Array.isArray(r.data) ? r.data : (r.data?.profiles ?? [])))
            .catch((err) => showError(t('Failed to get device profiles'), err))
            .finally(() => setLoading(false));
    }, [showError, t]);

    useEffect(() => {
        load();
        axios.get(apiRoutes.deviceProfilesExtras)
            .then((r) => setExtras({ data_packages: r.data?.data_packages ?? [], plugins: r.data?.plugins ?? [] }))
            .catch(() => setExtras({ data_packages: [], plugins: [] }));
    }, [load]);

    function openNew(start?: ProfileInput) {
        setEditing(null);
        setInitial(start ?? blankProfile());
        setEditorOpen(true);
    }

    function openEdit(p: Profile) {
        setEditing(p);
        setInitial(toInput(p));
        setEditorOpen(true);
    }

    function applyTemplate(id: string) {
        const tpl = templates.find((x) => x.id === id);
        if (!tpl) { return; }
        openNew({ ...blankProfile(), name: t(tpl.name), description: t(tpl.description), settings: tpl.settings });
    }

    async function toggle(p: Profile, enabled: boolean) {
        setBusyId(p.id);
        setProfiles((list) => list.map((x) => (x.id === p.id ? { ...x, enabled } : x)));
        try {
            const r = await axios.put(`${apiRoutes.deviceProfileSets}/${p.id}`, { ...toInput(p), enabled });
            if (r.data?.profile) {
                setProfiles((list) => list.map((x) => (x.id === p.id ? r.data.profile : x)));
            }
        } catch (err) {
            setProfiles((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: !enabled } : x)));
            showError(t('Failed to update profile'), err);
        } finally {
            setBusyId(null);
        }
    }

    async function duplicate(p: Profile) {
        setBusyId(p.id);
        try {
            const r = await axios.post(`${apiRoutes.deviceProfileSets}/${p.id}/duplicate`);
            notifications.show({ color: 'green', title: t('Profile duplicated'), message: r.data?.profile?.name });
            await load();
            if (r.data?.profile) { openEdit(r.data.profile); }
        } catch (err) {
            showError(t('Failed to duplicate profile'), err);
        } finally {
            setBusyId(null);
        }
    }

    async function exportPref(p: Profile) {
        try {
            await downloadFile(`${apiRoutes.deviceProfileSets}/${p.id}/export`, {}, `${p.name}.pref`);
        } catch (err) {
            showError(t('Failed to export profile'), err);
        }
    }

    async function confirmDelete() {
        if (!toDelete) { return; }
        setDeleting(true);
        try {
            await axios.delete(`${apiRoutes.deviceProfileSets}/${toDelete.id}`);
            setProfiles((list) => list.filter((x) => x.id !== toDelete.id));
            notifications.show({ color: 'green', title: t('Profile deleted'), message: toDelete.name });
            setToDelete(null);
        } catch (err) {
            showError(t('Failed to delete profile'), err);
        } finally {
            setDeleting(false);
        }
    }

    const hasExtras = extras && (extras.data_packages.length > 0 || extras.plugins.length > 0);

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
                <div>
                    <Title order={2}>{t('Device Profiles')}</Title>
                    <Text size="sm" c="dimmed">
                        {t('Push ATAK settings to phones and tablets automatically')}
                    </Text>
                </div>
                {profiles.length > 0 && (
                    <Button className="raven-cta" radius="xl" leftSection={<IconCirclePlus size={16} />} onClick={() => openNew()}>
                        {t('New profile')}
                    </Button>
                )}
            </Group>

            <HowItWorks />

            {loading ? (
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    <Skeleton height={220} radius="lg" />
                    <Skeleton height={220} radius="lg" />
                </SimpleGrid>
            ) : profiles.length === 0 ? (
                <Paper className="raven-surface" radius="lg" p="lg">
                    <EmptyState
                        icon={<IconDeviceMobileCog size={26} />}
                        color="blue"
                        title={t('No device profiles yet')}
                        description={t('Create a profile to set up every device the same way, without touching each phone. Start from scratch or use a starter below.')}
                        action={(
                            <Button mt="sm" className="raven-cta" radius="xl" leftSection={<IconCirclePlus size={16} />} onClick={() => openNew()}>
                                {t('Create your first profile')}
                            </Button>
                        )}
                    />
                    {templates.length > 0 && (
                        <Stack gap="sm" mt="xs">
                            <Text size="sm" fw={600} ta="center">{t('Or start from a template')}</Text>
                            <SimpleGrid cols={{ base: 1, sm: Math.min(templates.length, 3) }} spacing="sm">
                                {templates.map((tpl) => (
                                    <Paper key={tpl.id} p="md" className="raven-surface raven-surface--tile" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Text fw={600}>{t(tpl.name)}</Text>
                                        <Text size="sm" c="dimmed">{t(tpl.description)}</Text>
                                        <Text size="xs" c="dimmed">{tpl.settings.map((s) => settingLabel(s.key)).join(', ')}</Text>
                                        <Button
                                            mt="auto"
                                            variant="light"
                                            radius="xl"
                                            size="xs"
                                            onClick={() => applyTemplate(tpl.id)}
                                        >
                                            {t('Use this template')}
                                        </Button>
                                    </Paper>
                                ))}
                            </SimpleGrid>
                        </Stack>
                    )}
                </Paper>
            ) : (
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    {profiles.map((p) => (
                        <ProfileCard
                            key={p.id}
                            profile={p}
                            busy={busyId === p.id}
                            onEdit={() => openEdit(p)}
                            onDuplicate={() => duplicate(p)}
                            onExport={() => exportPref(p)}
                            onDelete={() => setToDelete(p)}
                            onToggle={(enabled) => toggle(p, enabled)}
                        />
                    ))}
                </SimpleGrid>
            )}

            <Section
                title={t('Also sent to devices')}
                description={t('Data packages and plugins are set up on their own pages, but devices receive them alongside these profiles.')}
            >
                {extras === null ? (
                    <Skeleton height={60} />
                ) : (
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Paper p="md" className="raven-surface raven-surface--tile">
                            <Group justify="space-between" mb="xs" wrap="nowrap">
                                <Group gap={8} wrap="nowrap">
                                    <IconPackage size={18} />
                                    <Text fw={600} size="sm">{t('Data packages')}</Text>
                                </Group>
                                <Anchor component={Link} to="/data_packages" size="sm">{t('Manage')}</Anchor>
                            </Group>
                            <ExtraList items={extras.data_packages} emptyText={t('No data packages are sent automatically.')} />
                        </Paper>
                        <Paper p="md" className="raven-surface raven-surface--tile">
                            <Group justify="space-between" mb="xs" wrap="nowrap">
                                <Group gap={8} wrap="nowrap">
                                    <IconPuzzle size={18} />
                                    <Text fw={600} size="sm">{t('Plugins')}</Text>
                                </Group>
                                <Anchor component={Link} to="/plugin_updates" size="sm">{t('Manage')}</Anchor>
                            </Group>
                            <ExtraList items={extras.plugins} emptyText={t('No plugins are sent automatically.')} />
                        </Paper>
                    </SimpleGrid>
                )}
                {extras !== null && !hasExtras && (
                    <Group gap={6} mt="sm" wrap="nowrap">
                        <IconPlugConnected size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
                        <Text size="xs" c="dimmed">
                            {t('Mark a data package or plugin to install on enrollment or connection and it will show up here.')}
                        </Text>
                    </Group>
                )}
            </Section>

            <Section
                title={(
                    <Group gap={8} component="span">
                        <IconEye size={18} />
                        <span>{t('Preview what a device gets')}</span>
                    </Group>
                )}
                description={t('Pick a user or device to see exactly which settings it would receive, and which profile each one comes from.')}
            >
                <PreviewPanel />
            </Section>

            <ProfileEditor
                opened={editorOpen}
                onClose={() => setEditorOpen(false)}
                profile={editing}
                initial={initial}
                onSaved={() => {
                    setEditorOpen(false);
                    load();
                }}
            />

            <Modal
                opened={toDelete !== null}
                onClose={() => setToDelete(null)}
                title={<Text fw={700}>{t('Delete this profile?')}</Text>}
                centered
            >
                <Text size="sm">
                    {t('"{{name}}" will stop being sent to devices. Settings already applied on devices stay as they are.', { name: toDelete?.name ?? '', interpolation: { escapeValue: false } })}
                </Text>
                <Group justify="flex-end" mt="lg" gap="sm">
                    <Button variant="default" radius="xl" onClick={() => setToDelete(null)}>{t('Cancel')}</Button>
                    <Button color="red" radius="xl" leftSection={<IconTrash size={16} />} loading={deleting} onClick={confirmDelete}>
                        {t('Delete profile')}
                    </Button>
                </Group>
            </Modal>
        </Stack>
    );
}
