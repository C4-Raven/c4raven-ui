import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Badge,
    Group,
    Paper,
    SegmentedControl,
    Select,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInput,
    ThemeIcon,
} from '@mantine/core';
import {
    IconAlertCircle,
    IconDeviceMobile,
    IconEye,
    IconPackage,
    IconPlug,
    IconSettingsOff,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { findSetting } from './settingsCatalog';
import { ON_CONNECT_KEY } from './types';

/** GET ?username=&eud_uid=&phase=enrollment|connection → PreviewResponse */
export const DEVICE_PROFILE_PREVIEW_URL = '/api/device-profiles/preview';
const USERS_URL = '/api/users/all';
const EUDS_URL = '/api/eud';

type Phase = 'enrollment' | 'connection';

interface PreviewSetting {
    key: string;
    value: string;
    value_class: string;
    profile_id: number | null;
    profile_name: string | null;
}

interface PreviewResponse {
    settings: PreviewSetting[];
    data_packages: { name: string }[];
    plugins: { name: string }[];
}

interface UserOption {
    username: string;
    euds?: { uid: string }[];
}

interface EudOption {
    uid: string;
    callsign: string | null;
}

function errorMessage(err: any): string | undefined {
    const data = err?.response?.data;
    return data?.error ?? data?.message ?? err?.message;
}

function displayValue(setting: PreviewSetting, sensitive: boolean, t: (k: string) => string): string {
    if (sensitive) { return '••••••'; }
    if (setting.value_class === 'class java.lang.Boolean') {
        return setting.value === 'true' ? t('On') : t('Off');
    }
    const def = findSetting(setting.key);
    const option = def?.options?.find((o) => o.value === setting.value);
    if (option) { return option.label; }
    if (setting.value === '' || setting.value === null || setting.value === undefined) { return '—'; }
    return def?.unit ? `${setting.value} ${def.unit}` : setting.value;
}

function NameList({ icon, title, items, empty }: {
    icon: React.ReactNode;
    title: string;
    items: { name: string }[];
    empty: string;
}) {
    return (
        <Paper p="md" className="raven-surface raven-surface--tile">
            <Group gap="xs" mb="xs">
                <ThemeIcon size="sm" variant="light" color="gray">{icon}</ThemeIcon>
                <Text fw={600} size="sm">{title}</Text>
                <Badge size="sm" variant="light" color="gray">{items.length}</Badge>
            </Group>
            {items.length ? (
                <Stack gap={4}>
                    {items.map((item) => (
                        <Text key={item.name} size="sm" style={{ wordBreak: 'break-all' }}>{item.name}</Text>
                    ))}
                </Stack>
            ) : (
                <Text size="sm" c="dimmed">{empty}</Text>
            )}
        </Paper>
    );
}

export default function PreviewPanel() {
    const { t } = useTranslation();
    const [users, setUsers] = useState<UserOption[]>([]);
    const [usersUnavailable, setUsersUnavailable] = useState(false);
    const [euds, setEuds] = useState<EudOption[]>([]);
    const [username, setUsername] = useState<string | null>(null);
    const [eudUid, setEudUid] = useState<string | null>(null);
    const [phase, setPhase] = useState<Phase>('enrollment');
    const [data, setData] = useState<PreviewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        axios.get<UserOption[]>(USERS_URL)
            .then((r) => setUsers(Array.isArray(r.data) ? r.data : []))
            // e.g. LDAP mode, where /api/users/all is refused: fall back to typing a username
            .catch(() => setUsersUnavailable(true));
        axios.get<EudOption[]>(EUDS_URL, { params: { all: true } })
            .then((r) => setEuds(Array.isArray(r.data) ? r.data : []))
            .catch(() => setEuds([]));
    }, []);

    const userOptions = useMemo(
        () => users.map((u) => ({ value: u.username, label: u.username })).sort((a, b) => a.label.localeCompare(b.label)),
        [users],
    );

    const deviceOptions = useMemo(() => {
        const owned = username ? users.find((u) => u.username === username)?.euds : undefined;
        const ownedUids = owned ? new Set(owned.map((e) => e.uid)) : null;
        return euds
            .filter((e) => !ownedUids || ownedUids.has(e.uid))
            .map((e) => ({ value: e.uid, label: e.callsign ? `${e.callsign} (${e.uid})` : e.uid }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [euds, users, username]);

    // Drop a device that doesn't belong to the newly chosen user
    useEffect(() => {
        if (eudUid && !deviceOptions.some((o) => o.value === eudUid)) { setEudUid(null); }
    }, [deviceOptions, eudUid]);

    const hasSubject = !!(username || eudUid);

    useEffect(() => {
        if (!hasSubject) {
            setData(null);
            setError(null);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        const params: Record<string, string> = { phase };
        if (username) { params.username = username; }
        if (eudUid) { params.eud_uid = eudUid; }
        axios.get<PreviewResponse>(DEVICE_PROFILE_PREVIEW_URL, { params })
            .then((r) => { if (!cancelled) { setData(r.data); } })
            .catch((err) => {
                if (!cancelled) {
                    setData(null);
                    setError(errorMessage(err) ?? t('Could not load the preview.'));
                }
            })
            .finally(() => { if (!cancelled) { setLoading(false); } });
        return () => { cancelled = true; };
    }, [username, eudUid, phase, hasSubject, t]);

    const settings = useMemo(() => [...(data?.settings ?? [])].sort((a, b) => {
        const la = findSetting(a.key)?.label ?? a.key;
        const lb = findSetting(b.key)?.label ?? b.key;
        return la.localeCompare(lb);
    }), [data]);

    return (
        <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                {usersUnavailable ? (
                    <TextInput
                        label={t('User')}
                        placeholder={t('Username')}
                        value={username ?? ''}
                        onChange={(e) => setUsername(e.currentTarget.value.trim() || null)}
                    />
                ) : (
                    <Select
                        label={t('User')}
                        placeholder={t('Pick a user')}
                        data={userOptions}
                        value={username}
                        onChange={setUsername}
                        searchable
                        clearable
                        nothingFoundMessage={t('No users found')}
                    />
                )}
                <Select
                    label={t('Device (optional)')}
                    placeholder={deviceOptions.length ? t('Any device') : t('No devices')}
                    data={deviceOptions}
                    value={eudUid}
                    onChange={setEudUid}
                    searchable
                    clearable
                    disabled={!deviceOptions.length}
                    nothingFoundMessage={t('No devices found')}
                />
                <Stack gap={4}>
                    <Text size="sm" fw={500}>{t('When')}</Text>
                    <SegmentedControl
                        fullWidth
                        value={phase}
                        onChange={(v) => setPhase(v as Phase)}
                        data={[
                            { value: 'enrollment', label: t('On enrollment') },
                            { value: 'connection', label: t('Every connection') },
                        ]}
                    />
                </Stack>
            </SimpleGrid>

            {phase === 'connection' && (
                <Text size="xs" c="dimmed">
                    {t('Devices only fetch these when "{{setting}}" ({{key}}) is on in ATAK. Devices enrolled through this server have it switched on automatically. A device only downloads a profile again after it has been changed.', { setting: findSetting(ON_CONNECT_KEY)?.label ?? ON_CONNECT_KEY, key: ON_CONNECT_KEY, interpolation: { escapeValue: false } })}
                </Text>
            )}

            {!hasSubject ? (
                <Paper p="xl" className="raven-surface">
                    <Stack align="center" gap="xs" ta="center">
                        <ThemeIcon size={52} radius="xl" variant="light" color="gray"><IconEye size={26} /></ThemeIcon>
                        <Text fw={600}>{t('Pick a user or a device')}</Text>
                        <Text size="sm" c="dimmed" maw={460}>
                            {t('See exactly which settings, data packages and plugins it would receive, and which profile each setting comes from.')}
                        </Text>
                    </Stack>
                </Paper>
            ) : error ? (
                <Alert color="red" icon={<IconAlertCircle size={18} />} title={t('Preview failed')}>{error}</Alert>
            ) : loading && !data ? (
                <Stack gap="xs">
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                    <Skeleton height={36} />
                </Stack>
            ) : data ? (
                <Stack gap="md" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 120ms' }}>
                    <Paper p="md" className="raven-surface">
                        <Group gap="xs" mb="sm">
                            <Text fw={600}>{t('Settings')}</Text>
                            <Badge variant="light">{settings.length}</Badge>
                        </Group>
                        {settings.length ? (
                            <Table.ScrollContainer minWidth={320}>
                                <Table verticalSpacing="xs" highlightOnHover>
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>{t('Setting')}</Table.Th>
                                            <Table.Th>{t('Value')}</Table.Th>
                                            <Table.Th>{t('From profile')}</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {settings.map((s) => {
                                            const def = findSetting(s.key);
                                            return (
                                                <Table.Tr key={s.key}>
                                                    <Table.Td>
                                                        <Text size="sm" fw={500} style={{ wordBreak: 'break-word' }}>{def?.label ?? s.key}</Text>
                                                        {def && <Text size="xs" c="dimmed" ff="monospace" style={{ wordBreak: 'break-all' }}>{s.key}</Text>}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text size="sm" style={{ wordBreak: 'break-all' }}>
                                                            {displayValue(s, !!def?.sensitive, t)}
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {s.profile_name ? (
                                                            <Badge variant="light" color="blue" maw={160} style={{ textTransform: 'none' }}>
                                                                {s.profile_name}
                                                            </Badge>
                                                        ) : (
                                                            <Text size="xs" c="dimmed">—</Text>
                                                        )}
                                                    </Table.Td>
                                                </Table.Tr>
                                            );
                                        })}
                                    </Table.Tbody>
                                </Table>
                            </Table.ScrollContainer>
                        ) : (
                            <Group gap="sm" py="md" justify="center">
                                <IconSettingsOff size={18} color="var(--mantine-color-dimmed)" />
                                <Text size="sm" c="dimmed">
                                    {phase === 'enrollment'
                                        ? t('No profile settings are sent on enrollment for this selection.')
                                        : t('No profile settings apply on connection for this selection.')}
                                </Text>
                            </Group>
                        )}
                    </Paper>

                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        <NameList
                            icon={<IconPackage size={14} />}
                            title={t('Data packages')}
                            items={data.data_packages ?? []}
                            empty={t('No data packages are sent at this point.')}
                        />
                        <NameList
                            icon={<IconPlug size={14} />}
                            title={t('Plugins')}
                            items={data.plugins ?? []}
                            empty={t('No plugins are sent at this point.')}
                        />
                    </SimpleGrid>

                    <Group gap={6}>
                        <IconDeviceMobile size={14} color="var(--mantine-color-dimmed)" />
                        <Text size="xs" c="dimmed">
                            {t('The server also adds its own connection details (update server, certificates) to every profile.')}
                        </Text>
                    </Group>
                </Stack>
            ) : null}
        </Stack>
    );
}
