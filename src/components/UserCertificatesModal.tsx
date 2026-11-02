import { useEffect, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Group,
    Modal,
    Select,
    Stack,
    Table,
    Text,
    Textarea,
    Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconCertificateOff, IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { t } from 'i18next';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';

export interface IssuedCertificate {
    id: number;
    common_name: string;
    username: string | null;
    callsign: string | null;
    eud_uid: string | null;
    serial_number: string | null;
    expiration_date: string | null;
    revoked_at: string | null;
    revocation_reason: string | null;
    status: 'valid' | 'expired' | 'revoked';
}

// openssl / RFC 5280 reason names the server accepts (cert_revocation.REVOCATION_REASONS)
const REASON_LABELS: Record<string, string> = {
    keyCompromise: 'Device lost or stolen (key compromise)',
    superseded: 'Device replaced',
    affiliationChanged: 'User left the unit',
    cessationOfOperation: 'No longer needed',
    unspecified: 'Other',
};

const STATUS_COLORS: Record<string, string> = { valid: 'green', expired: 'gray', revoked: 'red' };

function formatDate(value: string | null) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// The certificates issued to one user, with a Revoke button per certificate
// and "Revoke all". Revoking puts the cert on the CA's revocation list and
// disconnects any device streaming with it; the account itself stays active
// so the user can enroll a replacement device.
export function UserCertificatesModal({ username, opened, onClose }: {
    username: string;
    opened: boolean;
    onClose: () => void;
}) {
    const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
    const [loading, setLoading] = useState(false);
    // null = revoke all of the user's certificates
    const [target, setTarget] = useState<IssuedCertificate | null | undefined>(undefined);
    const [reason, setReason] = useState<string>('keyCompromise');
    const [note, setNote] = useState('');
    const [revoking, setRevoking] = useState(false);

    function load() {
        setLoading(true);
        axios.get(apiRoutes.certificates, { params: { username } })
            .then(r => setCertificates(r.data.results ?? []))
            .catch(err => {
                notifications.show({
                    title: t('Failed to load certificates'),
                    message: err.response?.data?.error ?? String(err),
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        if (opened && username) {
            setCertificates([]);
            setTarget(undefined);
            load();
        }
    }, [opened, username]);

    function openConfirm(cert: IssuedCertificate | null) {
        setReason('keyCompromise');
        setNote('');
        setTarget(cert);
    }

    function revoke() {
        if (target === undefined) {
            return;
        }
        setRevoking(true);
        const request = target === null
            ? axios.post(apiRoutes.revokeUserCertificates, { username, reason, note })
            : axios.post(apiRoutes.revokeCertificate(target.id), { reason, note });
        request
            .then(r => {
                const revoked = r.data.revoked?.length ?? 0;
                const skipped = r.data.skipped?.length ?? 0;
                notifications.show({
                    message: skipped
                        ? `${t('Revoked {{count}} certificate(s)', { count: revoked })} ${t('{{skipped}} older certificate(s) could not be revoked (serial number unknown)', { skipped })}`
                        : t('Revoked {{count}} certificate(s)', { count: revoked }),
                    color: skipped ? 'yellow' : 'green',
                });
                if (r.data.sessions_disconnected === false) {
                    notifications.show({
                        title: t('Could not disconnect live sessions'),
                        message: t('The certificate is revoked, but a connected device may stay online until it reconnects.'),
                        color: 'yellow',
                    });
                }
                setTarget(undefined);
                load();
            })
            .catch(err => {
                notifications.show({
                    title: t('Failed to revoke'),
                    message: err.response?.data?.error ?? String(err),
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setRevoking(false));
    }

    const activeCount = certificates.filter(c => c.status !== 'revoked').length;

    return (
        <>
            <Modal size="xl" opened={opened && target === undefined} onClose={onClose} title={t('Certificates for {{username}}', { username })}>
                <Stack>
                    <Text size="sm" c="dimmed">
                        {t('Revoking a certificate disconnects the device using it and stops it from connecting again. The account stays active, so the user can enroll a new device.')}
                    </Text>
                    <Table.ScrollContainer minWidth={640}>
                        <Table striped highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>{t('Device')}</Table.Th>
                                    <Table.Th>{t('Serial')}</Table.Th>
                                    <Table.Th>{t('Expires')}</Table.Th>
                                    <Table.Th>{t('Status')}</Table.Th>
                                    <Table.Th />
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {certificates.length === 0 && (
                                    <Table.Tr>
                                        <Table.Td colSpan={5}>
                                            <Text size="sm" c="dimmed" ta="center">
                                                {loading ? t('Loading…') : t('No certificates have been issued to this user')}
                                            </Text>
                                        </Table.Td>
                                    </Table.Tr>
                                )}
                                {certificates.map(cert => (
                                    <Table.Tr key={cert.id}>
                                        <Table.Td>
                                            <Text size="sm">{cert.callsign || cert.eud_uid || t('Certificate package')}</Text>
                                            {cert.callsign && cert.eud_uid && <Text size="xs" c="dimmed">{cert.eud_uid}</Text>}
                                        </Table.Td>
                                        <Table.Td><Text ff="monospace" size="sm">{cert.serial_number ?? '—'}</Text></Table.Td>
                                        <Table.Td><Text size="sm">{formatDate(cert.expiration_date)}</Text></Table.Td>
                                        <Table.Td>
                                            {cert.status === 'revoked' ? (
                                                <Tooltip label={`${formatDate(cert.revoked_at)} — ${t(REASON_LABELS[cert.revocation_reason ?? ''] ?? cert.revocation_reason ?? '')}`}>
                                                    <Badge color={STATUS_COLORS.revoked} variant="light">{t('Revoked')}</Badge>
                                                </Tooltip>
                                            ) : (
                                                <Badge color={STATUS_COLORS[cert.status]} variant="light">
                                                    {cert.status === 'expired' ? t('Expired') : t('Valid')}
                                                </Badge>
                                            )}
                                        </Table.Td>
                                        <Table.Td ta="right">
                                            {cert.status !== 'revoked' && (
                                                <Tooltip
                                                    disabled={!!cert.serial_number}
                                                    label={t('Issued before serial numbers were recorded; it can only be revoked once it is identified')}
                                                >
                                                    <Button
                                                        size="xs"
                                                        color="red"
                                                        variant="light"
                                                        disabled={!cert.serial_number}
                                                        leftSection={<IconCertificateOff size={14} />}
                                                        onClick={() => openConfirm(cert)}
                                                    >
                                                        {t('Revoke')}
                                                    </Button>
                                                </Tooltip>
                                            )}
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    <Group justify="space-between">
                        <Button
                            color="red"
                            variant="outline"
                            disabled={activeCount === 0}
                            leftSection={<IconCertificateOff size={16} />}
                            onClick={() => openConfirm(null)}
                        >
                            {t('Revoke all certificates')}
                        </Button>
                        <Button variant="default" onClick={onClose}>{t('Close')}</Button>
                    </Group>
                </Stack>
            </Modal>
            <Modal
                opened={opened && target !== undefined}
                onClose={() => setTarget(undefined)}
                title={target === null ? t('Revoke all certificates?') : t('Revoke certificate?')}
            >
                <Stack>
                    <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                        {target === null
                            ? t('Every certificate issued to {{username}} ({{count}} active) will be revoked and their devices disconnected. This can\'t be undone.', { username, count: activeCount })
                            : t('The certificate {{serial}} ({{device}}) will be revoked and the device disconnected. This can\'t be undone.', {
                                serial: target?.serial_number ?? '',
                                device: target?.callsign || target?.eud_uid || username,
                            })}
                    </Alert>
                    <Select
                        label={t('Reason')}
                        data={Object.entries(REASON_LABELS).map(([value, label]) => ({ value, label: t(label) }))}
                        value={reason}
                        onChange={(value) => setReason(value ?? 'unspecified')}
                        allowDeselect={false}
                    />
                    <Textarea
                        label={t('Note (optional)')}
                        description={t('Recorded in the security audit log')}
                        maxLength={500}
                        autosize
                        minRows={2}
                        value={note}
                        onChange={(e) => setNote(e.currentTarget.value)}
                    />
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setTarget(undefined)}>{t('Cancel')}</Button>
                        <Button color="red" loading={revoking} onClick={revoke}>{t('Revoke')}</Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
