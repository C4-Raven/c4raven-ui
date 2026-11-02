import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Group,
    Paper,
    Select,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInput,
    ThemeIcon,
    Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconAlertTriangle,
    IconCircleCheck,
    IconDownload,
    IconInfoCircle,
    IconRefresh,
    IconSearch,
    IconShieldCheck,
    IconShieldX,
    IconX,
} from '@tabler/icons-react';
import { DataTable } from 'mantine-datatable';
import { useTranslation } from 'react-i18next';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import {
    downloadFile,
    EmptyState,
    extractError,
    formatDateTime,
    formatRelative,
    humanize,
    Section,
} from './shared';

type Severity = 'high' | 'medium' | 'low' | 'info';

interface AuditSummary {
    web_logins: number;
    failed_logins: number;
    qr_enrollments: number;
    zip_enrollments: number;
    credential_enrollments: number;
    active_users: number;
    certificates_revoked: number;
    findings: number;
}

interface AuditFinding {
    severity: Severity;
    title: string;
    detail: string;
}

interface AuditUser {
    username: string;
    roles: string[];
    active: boolean;
    site_access: boolean;
    last_login_at: string | null;
    last_login_ip: string | null;
    current_login_at: string | null;
    current_login_ip: string | null;
    login_count: number | null;
    tfa_enabled: boolean;
    passkeys: number;
    certificates: number;
    devices: { uid: string; callsign: string | null; last_seen: string | null }[];
    enrollment_methods: string[];
}

interface AuditEvent {
    id: number | string;
    timestamp: string;
    category: string;
    action: string;
    username: string | null;
    actor: string | null;
    ip: string | null;
    user_agent: string | null;
    success: boolean | null;
    details: unknown;
    summary?: string | null;
}

interface AuditResponse {
    generated_at: string;
    days: number;
    summary: AuditSummary;
    findings: AuditFinding[];
    users: AuditUser[];
    events: AuditEvent[];
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
const SEVERITY_COLOR: Record<Severity, string> = { high: 'red', medium: 'orange', low: 'yellow', info: 'blue' };

const EVENTS_PER_PAGE = 50;

function enrollmentLabel(method: string, t: (k: string) => string): string {
    const m = method.toLowerCase();
    if (m.startsWith('qr')) { return t('QR code'); }
    if (m.startsWith('zip') || m.includes('package')) { return t('ZIP package'); }
    if (m.startsWith('cred') || m === 'password') { return t('Credentials'); }
    if (m === 'vpn_qr') { return t('VPN QR code'); }
    if (m === 'csr') { return t('Certificate request'); }
    return humanize(method);
}

function enrollmentColor(method: string): string {
    const m = method.toLowerCase();
    if (m.startsWith('qr')) { return 'violet'; }
    if (m.startsWith('zip') || m.includes('package')) { return 'cyan'; }
    if (m.startsWith('cred') || m === 'password') { return 'teal'; }
    return 'gray';
}

function actionLabel(action: string, t: (k: string) => string): string {
    const known: Record<string, string> = {
        web_login: t('Web login'),
        web_login_failed: t('Failed web login'),
        ldap_login: t('LDAP login'),
        ldap_login_failed: t('Failed LDAP login'),
        tfa_failed: t('Failed two-factor code'),
        tfa_change: t('Two-factor changed'),
        enroll_failed: t('Failed enrollment'),
        onboard_package_download: t('Enrolled by VPN QR code'),
        password_reset_by_admin: t('Password reset by admin'),
        login: t('Web login'),
        login_success: t('Web login'),
        login_failed: t('Failed login'),
        login_failure: t('Failed login'),
        logout: t('Logged out'),
        qr_enrollment: t('Enrolled by QR code'),
        enroll_qr: t('Enrolled by QR code'),
        zip_enrollment: t('Enrolled by ZIP package'),
        enroll_zip: t('Enrolled by ZIP package'),
        credential_enrollment: t('Enrolled with credentials'),
        enroll_credentials: t('Enrolled with credentials'),
        certificate_revoked: t('Certificate revoked'),
        revoke_certificate: t('Certificate revoked'),
        password_reset: t('Password reset'),
        password_change: t('Password changed'),
        tfa_enabled: t('Two-factor enabled'),
        tfa_disabled: t('Two-factor disabled'),
        group_created: t('Group created'),
        group_deleted: t('Group deleted'),
        group_policy_changed: t('Group policy changed'),
        member_added: t('Added to group'),
        member_removed: t('Removed from group'),
        member_access_changed: t('Group access changed'),
        membership_expired: t('Group membership expired'),
    };
    return known[action] ?? humanize(action);
}

function detailsText(details: unknown): string {
    if (details === null || details === undefined || details === '') { return ''; }
    if (typeof details === 'string') { return details; }
    if (typeof details === 'object') {
        return Object.entries(details as Record<string, unknown>)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' · ');
    }
    return String(details);
}

function StatTile({ label, value, color }: { label: string; value: number | undefined; color?: string }) {
    return (
        <Paper p="md" className="raven-surface raven-surface--tile">
            <Text size="xl" fw={700} c={color && value ? color : undefined} lh={1.2}>
                {value ?? '—'}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>{label}</Text>
        </Paper>
    );
}

export default function SecurityAuditTab() {
    const { t } = useTranslation();
    const [days, setDays] = useState('30');
    const [category, setCategory] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch] = useDebouncedValue(search.trim(), 400);
    const [data, setData] = useState<AuditResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
    const [downloading, setDownloading] = useState<'txt' | 'csv' | null>(null);
    const [eventsPage, setEventsPage] = useState(1);
    const [knownCategories, setKnownCategories] = useState<string[]>([]);
    const requestId = useRef(0);

    const load = useCallback(() => {
        const id = ++requestId.current;
        setLoading(true);
        axios.get<AuditResponse>(apiRoutes.securityAudit, {
            params: { days, category: category ?? '', search: debouncedSearch, limit: 1000 },
        }).then((r) => {
            if (id !== requestId.current) { return; }
            setData(r.data);
            setError(null);
            setEventsPage(1);
            const cats = (r.data.events ?? []).map((e) => e.category).filter(Boolean);
            setKnownCategories((prev) => Array.from(new Set([...prev, ...cats])).sort());
        }).catch(async (err) => {
            if (id !== requestId.current) { return; }
            setError({
                message: (await extractError(err)) ?? t('Could not load the security audit'),
                notFound: err?.response?.status === 404,
            });
        }).finally(() => {
            if (id === requestId.current) { setLoading(false); }
        });
    }, [days, category, debouncedSearch, t]);

    useEffect(() => { load(); }, [load]);

    async function download(format: 'txt' | 'csv') {
        setDownloading(format);
        try {
            // The CSV is the event log with the current filters; the .txt is the whole report
            const params = format === 'csv'
                ? { days, format, category: category ?? '', search: debouncedSearch }
                : { days };
            await downloadFile(apiRoutes.securityAuditDownload, params, `security-audit.${format}`);
        } catch (err) {
            notifications.show({
                title: t('Download failed'),
                message: (await extractError(err)) ?? t('The audit report could not be downloaded'),
                color: 'red',
                icon: <IconX />,
            });
        } finally {
            setDownloading(null);
        }
    }

    const summary = data?.summary;
    const findings = useMemo(
        () => [...(data?.findings ?? [])].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)),
        [data],
    );
    const users = data?.users ?? [];
    const events = data?.events ?? [];
    const pagedEvents = events.slice((eventsPage - 1) * EVENTS_PER_PAGE, eventsPage * EVENTS_PER_PAGE);

    const periodOptions = [
        { value: '1', label: t('Last 24 hours') },
        { value: '7', label: t('Last 7 days') },
        { value: '30', label: t('Last 30 days') },
        { value: '90', label: t('Last 90 days') },
    ];

    if (error?.notFound) {
        return (
            <Section>
                <EmptyState
                    icon={<IconShieldX size={26} />}
                    color="orange"
                    title={t('Security audit is not available on this server')}
                    description={t('Update the C4 RAVEN server to a version that includes the security audit')}
                    action={<Button variant="light" mt="sm" leftSection={<IconRefresh size={16} />} onClick={load}>{t('Try again')}</Button>}
                />
            </Section>
        );
    }

    return (
        <Stack gap="lg">
            <Paper p="md" className="raven-surface">
                <Group justify="space-between" gap="sm" wrap="wrap">
                    <Group gap="sm" wrap="wrap">
                        <Select
                            aria-label={t('Period')}
                            data={periodOptions}
                            value={days}
                            onChange={(v) => v && setDays(v)}
                            allowDeselect={false}
                            w={170}
                        />
                        {data?.generated_at && (
                            <Text size="xs" c="dimmed">
                                {t('Generated {{when}}', { when: formatDateTime(data.generated_at, true) })}
                            </Text>
                        )}
                    </Group>
                    <Group gap="xs">
                        <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={load} loading={loading}>
                            {t('Refresh')}
                        </Button>
                        <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => download('csv')} loading={downloading === 'csv'}>
                            {t('Events .csv')}
                        </Button>
                        <Button leftSection={<IconDownload size={16} />} onClick={() => download('txt')} loading={downloading === 'txt'}>
                            {t('Download .txt')}
                        </Button>
                    </Group>
                </Group>
            </Paper>

            {error && (
                <Alert color="red" variant="light" icon={<IconAlertCircle />} title={t('Could not load the security audit')}>
                    {error.message}
                </Alert>
            )}

            {loading && !data ? (
                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                    {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} h={72} radius="md" />)}
                </SimpleGrid>
            ) : (
                <SimpleGrid cols={{ base: 2, sm: 4, xl: 8 }} spacing="sm">
                    <StatTile label={t('Web logins')} value={summary?.web_logins} />
                    <StatTile label={t('Failed logins')} value={summary?.failed_logins} color="red.5" />
                    <StatTile label={t('QR enrollments')} value={summary?.qr_enrollments} />
                    <StatTile label={t('ZIP enrollments')} value={summary?.zip_enrollments} />
                    <StatTile label={t('Credential enrollments')} value={summary?.credential_enrollments} />
                    <StatTile label={t('Active users')} value={summary?.active_users} />
                    <StatTile label={t('Certificates revoked')} value={summary?.certificates_revoked} />
                    <StatTile label={t('Findings')} value={summary?.findings} color="orange.5" />
                </SimpleGrid>
            )}

            <Section title={t('Findings')} description={t('Things worth a look, worst first')}>
                {findings.length === 0 ? (
                    loading ? <Skeleton h={60} radius="md" /> : (
                        <Group gap="sm" c="green.5">
                            <IconCircleCheck size={20} />
                            <Text size="sm">{t('No findings for this period')}</Text>
                        </Group>
                    )
                ) : (
                    <Stack gap="xs">
                        {findings.map((f, i) => (
                            <Paper key={`${f.title}-${i}`} p="sm" className="raven-surface raven-surface--tile">
                                <Group gap="sm" align="flex-start" wrap="nowrap">
                                    <ThemeIcon variant="light" color={SEVERITY_COLOR[f.severity] ?? 'gray'} radius="xl" size="md">
                                        {f.severity === 'info' ? <IconInfoCircle size={16} /> : <IconAlertTriangle size={16} />}
                                    </ThemeIcon>
                                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                                        <Group gap="xs" wrap="wrap">
                                            <Badge size="sm" variant="light" color={SEVERITY_COLOR[f.severity] ?? 'gray'}>
                                                {t(humanize(f.severity))}
                                            </Badge>
                                            <Text fw={600} size="sm">{f.title}</Text>
                                        </Group>
                                        {f.detail && <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{f.detail}</Text>}
                                    </Stack>
                                </Group>
                            </Paper>
                        ))}
                    </Stack>
                )}
            </Section>

            <Section title={t('Users')} description={t('Web sign-ins, two-factor status, devices and how each user enrolled')}>
                <Table.ScrollContainer minWidth={900}>
                    <DataTable
                        withTableBorder
                        borderRadius="md"
                        striped
                        highlightOnHover
                        verticalAlign="top"
                        records={users}
                        idAccessor="username"
                        fetching={loading && !!data}
                        minHeight={users.length === 0 ? 160 : undefined}
                        noRecordsText={t('No users')}
                        columns={[
                            {
                                accessor: 'username',
                                title: t('User'),
                                render: (u) => (
                                    <Stack gap={2}>
                                        <Group gap={6} wrap="nowrap">
                                            <Text size="sm" fw={600}>{u.username}</Text>
                                            {!u.active && <Badge size="xs" color="gray" variant="outline">{t('Disabled')}</Badge>}
                                        </Group>
                                        {u.roles?.length > 0 && (
                                            <Group gap={4}>
                                                {u.roles.map((r) => (
                                                    <Badge key={r} size="xs" variant="light" color={r === 'administrator' ? 'red' : 'gray'}>{humanize(r)}</Badge>
                                                ))}
                                            </Group>
                                        )}
                                    </Stack>
                                ),
                            },
                            {
                                accessor: 'last_login_at',
                                title: t('Last web login'),
                                render: (u) => {
                                    const at = u.current_login_at ?? u.last_login_at;
                                    const ip = u.current_login_ip ?? u.last_login_ip;
                                    if (!at) { return <Text size="sm" c="dimmed">{t('Never')}</Text>; }
                                    return (
                                        <Stack gap={0}>
                                            <Tooltip label={formatDateTime(at, true)}>
                                                <Text size="sm">{formatRelative(at)}</Text>
                                            </Tooltip>
                                            {ip && <Text size="xs" c="dimmed" ff="monospace">{ip}</Text>}
                                        </Stack>
                                    );
                                },
                            },
                            {
                                accessor: 'login_count',
                                title: t('Logins'),
                                textAlign: 'right',
                                render: (u) => <Text size="sm">{u.login_count ?? 0}</Text>,
                            },
                            {
                                accessor: 'tfa_enabled',
                                title: t('2FA'),
                                render: (u) => (
                                    <Group gap={4} wrap="nowrap">
                                        <Badge size="sm" variant="light" color={u.tfa_enabled ? 'green' : 'gray'}>
                                            {u.tfa_enabled ? t('Yes') : t('No')}
                                        </Badge>
                                        {u.passkeys > 0 && (
                                            <Tooltip label={t('Passkeys')}>
                                                <Badge size="sm" variant="outline" color="green">{u.passkeys}</Badge>
                                            </Tooltip>
                                        )}
                                    </Group>
                                ),
                            },
                            {
                                accessor: 'devices',
                                title: t('Devices'),
                                render: (u) => {
                                    const devices = u.devices ?? [];
                                    if (devices.length === 0) { return <Text size="sm" c="dimmed">{t('None')}</Text>; }
                                    const names = devices.map((d) => d.callsign || d.uid);
                                    const shown = names.slice(0, 3).join(', ');
                                    return (
                                        <Tooltip
                                            multiline
                                            maw={320}
                                            label={devices.map((d) => `${d.callsign || d.uid}${d.last_seen ? ` · ${formatRelative(d.last_seen)}` : ''}`).join('\n')}
                                            style={{ whiteSpace: 'pre-line' }}
                                        >
                                            <Stack gap={0}>
                                                <Text size="sm">{devices.length}</Text>
                                                <Text size="xs" c="dimmed" lineClamp={1}>
                                                    {shown}{names.length > 3 ? ` +${names.length - 3}` : ''}
                                                </Text>
                                            </Stack>
                                        </Tooltip>
                                    );
                                },
                            },
                            {
                                accessor: 'certificates',
                                title: t('Certificates'),
                                textAlign: 'right',
                                render: (u) => <Text size="sm">{u.certificates ?? 0}</Text>,
                            },
                            {
                                accessor: 'enrollment_methods',
                                title: t('Enrolled via'),
                                render: (u) => (u.enrollment_methods?.length ? (
                                    <Group gap={4}>
                                        {u.enrollment_methods.map((m) => (
                                            <Badge key={m} size="sm" variant="light" color={enrollmentColor(m)} tt="none">
                                                {enrollmentLabel(m, t)}
                                            </Badge>
                                        ))}
                                    </Group>
                                ) : <Text size="sm" c="dimmed">—</Text>),
                            },
                        ]}
                    />
                </Table.ScrollContainer>
            </Section>

            <Section
                title={t('Events')}
                description={t('Logins, enrollments and certificate changes, newest first')}
            >
                <Group gap="sm" mb="md" wrap="wrap">
                    <Select
                        aria-label={t('Category')}
                        placeholder={t('All categories')}
                        clearable
                        data={knownCategories.map((c) => ({ value: c, label: humanize(c) }))}
                        value={category}
                        onChange={setCategory}
                        w={200}
                    />
                    <TextInput
                        aria-label={t('Search')}
                        placeholder={t('Search user, IP or action')}
                        leftSection={<IconSearch size={16} />}
                        value={search}
                        onChange={(e) => setSearch(e.currentTarget.value)}
                        style={{ flex: '1 1 220px' }}
                        maw={360}
                    />
                    <Text size="xs" c="dimmed">{t('{{count}} events', { count: events.length })}</Text>
                </Group>
                <Table.ScrollContainer minWidth={900}>
                    <DataTable
                        withTableBorder
                        borderRadius="md"
                        highlightOnHover
                        verticalAlign="top"
                        records={pagedEvents}
                        idAccessor="id"
                        fetching={loading && !!data}
                        minHeight={events.length === 0 ? 180 : undefined}
                        noRecordsText={t('No events match these filters')}
                        rowBackgroundColor={(e) => (e.success === false
                            ? { light: 'rgba(250, 82, 82, 0.08)', dark: 'rgba(250, 82, 82, 0.12)' }
                            : undefined)}
                        totalRecords={events.length}
                        recordsPerPage={EVENTS_PER_PAGE}
                        page={eventsPage}
                        onPageChange={setEventsPage}
                        columns={[
                            {
                                accessor: 'timestamp',
                                title: t('Time'),
                                width: 190,
                                render: (e) => (
                                    <Tooltip label={formatRelative(e.timestamp)}>
                                        <Text size="sm" style={{ whiteSpace: 'nowrap' }}>{formatDateTime(e.timestamp, true)}</Text>
                                    </Tooltip>
                                ),
                            },
                            {
                                accessor: 'action',
                                title: t('Event'),
                                render: (e) => (
                                    <Stack gap={2}>
                                        <Group gap={6} wrap="nowrap">
                                            {e.success === false
                                                ? <IconShieldX size={14} color="var(--mantine-color-red-5)" />
                                                : <IconShieldCheck size={14} color="var(--mantine-color-green-5)" />}
                                            <Text size="sm" fw={500} c={e.success === false ? 'red.5' : undefined}>
                                                {actionLabel(e.action, t)}
                                            </Text>
                                        </Group>
                                        {e.category && <Badge size="xs" variant="light" color="gray" tt="none" w="fit-content">{humanize(e.category)}</Badge>}
                                    </Stack>
                                ),
                            },
                            {
                                accessor: 'username',
                                title: t('User'),
                                render: (e) => (
                                    <Stack gap={0}>
                                        <Text size="sm">{e.username || '—'}</Text>
                                        {e.actor && e.actor !== e.username && (
                                            <Text size="xs" c="dimmed">{t('by {{actor}}', { actor: e.actor })}</Text>
                                        )}
                                    </Stack>
                                ),
                            },
                            {
                                accessor: 'ip',
                                title: t('IP address'),
                                render: (e) => (
                                    <Tooltip label={e.user_agent ?? ''} disabled={!e.user_agent} multiline maw={360}>
                                        <Text size="sm" ff="monospace">{e.ip || '—'}</Text>
                                    </Tooltip>
                                ),
                            },
                            {
                                accessor: 'details',
                                title: t('Details'),
                                render: (e) => {
                                    const text = detailsText(e.details);
                                    return text
                                        ? <Text size="xs" c="dimmed" lineClamp={2} title={text} style={{ overflowWrap: 'anywhere' }}>{text}</Text>
                                        : <Text size="xs" c="dimmed">—</Text>;
                                },
                            },
                        ]}
                    />
                </Table.ScrollContainer>
            </Section>
        </Stack>
    );
}
