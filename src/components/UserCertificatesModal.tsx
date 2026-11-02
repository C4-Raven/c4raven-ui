import { useEffect, useState } from 'react';
import {
    Alert,
    Badge,
    Button,
    Checkbox,
    Group,
    Modal,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Textarea,
    Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconCertificateOff, IconDeviceMobileCheck, IconX } from '@tabler/icons-react';
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
    // The device (eud_uid) may not enroll for a new certificate until an admin allows it
    enrollment_blocked?: boolean;
}

// What the confirm dialog is about: one cert, all of the user's certs, or a serial number
type RevokeTarget =
    | { kind: 'cert'; cert: IssuedCertificate }
    | { kind: 'all' }
    | { kind: 'serial'; serial: string };

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

// The certificates issued to one user, with a Revoke button per certificate,
// "Revoke all" and revoke by serial number. Revoking puts the cert on the CA's
// revocation list, disconnects any device streaming with it and blocks that
// device from enrolling again until an admin allows it; the account itself
// stays active so the user can enroll a replacement device. Optionally the
// user's password is reset too, so credentials saved on a lost device stop
// working.
export function UserCertificatesModal({ username, opened, onClose }: {
    username: string;
    opened: boolean;
    onClose: () => void;
}) {
    const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
    const [loading, setLoading] = useState(false);
    const [target, setTarget] = useState<RevokeTarget | undefined>(undefined);
    const [reason, setReason] = useState<string>('keyCompromise');
    const [note, setNote] = useState('');
    const [resetPassword, setResetPassword] = useState(false);
    // Set when the server said this serial is shared by several old certs (409)
    const [sharedSerial, setSharedSerial] = useState<string | null>(null);
    const [revoking, setRevoking] = useState(false);
    const [serialInput, setSerialInput] = useState('');
    const [allowTarget, setAllowTarget] = useState<IssuedCertificate | undefined>(undefined);
    const [allowing, setAllowing] = useState(false);

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
            setAllowTarget(undefined);
            setSerialInput('');
            load();
        }
    }, [opened, username]);

    function openConfirm(next: RevokeTarget) {
        setReason('keyCompromise');
        setNote('');
        setSharedSerial(null);
        // Revoking everything usually means the saved credentials are suspect too
        setResetPassword(next.kind === 'all');
        setTarget(next);
    }

    function revoke() {
        if (target === undefined) {
            return;
        }
        setRevoking(true);
        const body = {
            reason,
            note,
            reset_password: resetPassword,
            ...(sharedSerial ? { confirm_shared_serial: true } : {}),
        };
        const request = target.kind === 'all'
            ? axios.post(apiRoutes.revokeUserCertificates, { username, ...body })
            : target.kind === 'serial'
                ? axios.post(apiRoutes.revokeCertificateBySerial, { serial: target.serial, ...body })
                : axios.post(apiRoutes.revokeCertificate(target.cert.id), body);
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
                if (r.data.kick_sent === false) {
                    notifications.show({
                        title: t('Could not disconnect live sessions'),
                        message: t('The certificate is revoked, but a connected device may stay online until it reconnects.'),
                        color: 'yellow',
                    });
                } else if (r.data.sessions_disconnected?.length) {
                    notifications.show({
                        message: t('Disconnected {{count}} live device session(s)', { count: r.data.sessions_disconnected.length }),
                        color: 'green',
                    });
                }
                if (r.data.password_reset === true) {
                    notifications.show({
                        message: t('The password was reset. Issue a temporary password when the user needs to sign in again.'),
                        color: 'green',
                    });
                } else if (resetPassword && r.data.password_reset === false) {
                    notifications.show({
                        title: t('Password not reset'),
                        message: t('The password could not be reset here (for example, LDAP accounts). Reset it on the account itself.'),
                        color: 'yellow',
                    });
                }
                setTarget(undefined);
                setSharedSerial(null);
                if (target.kind === 'serial') {
                    setSerialInput('');
                }
                load();
            })
            .catch(err => {
                if (err.response?.status === 409 && err.response?.data?.shared_serial) {
                    // Keep the dialog open; the next click confirms revoking all of them
                    setSharedSerial(err.response.data.shared_serial);
                    return;
                }
                notifications.show({
                    title: t('Failed to revoke'),
                    message: err.response?.data?.error ?? String(err),
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setRevoking(false));
    }

    function allowEnrollment() {
        if (!allowTarget?.eud_uid) {
            return;
        }
        setAllowing(true);
        axios.post(apiRoutes.allowEnrollment, { eud_uid: allowTarget.eud_uid })
            .then(() => {
                notifications.show({
                    message: t('{{device}} can enroll again', { device: allowTarget.callsign || allowTarget.eud_uid }),
                    color: 'green',
                });
                setAllowTarget(undefined);
                load();
            })
            .catch(err => {
                notifications.show({
                    title: t('Failed to allow enrollment'),
                    message: err.response?.data?.error ?? String(err),
                    icon: <IconX />,
                    color: 'red',
                });
            })
            .finally(() => setAllowing(false));
    }

    const serialValid = /^(0x)?[0-9a-fA-F:]+$/.test(serialInput.trim());
    const deviceName = (cert?: IssuedCertificate) => cert?.callsign || cert?.eud_uid || username;

    const activeCount = certificates.filter(c => c.status !== 'revoked').length;

    return (
        <>
            <Modal size="xl" opened={opened && target === undefined && allowTarget === undefined} onClose={onClose} title={t('Certificates for {{username}}', { username })}>
                <Stack>
                    <Text size="sm" c="dimmed">
                        {t('Revoking a certificate disconnects the device using it, rejects that certificate from then on and blocks the device from enrolling for a new one until you allow it. The account stays active, so the user can enroll a new device; if their saved credentials may be compromised, also reset their password.')}
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
                                            {cert.status === 'revoked' && cert.enrollment_blocked && (
                                                <Tooltip label={t('This device is blocked from enrolling for a new certificate')}>
                                                    <Button
                                                        size="xs"
                                                        variant="light"
                                                        leftSection={<IconDeviceMobileCheck size={14} />}
                                                        onClick={() => setAllowTarget(cert)}
                                                    >
                                                        {t('Allow to enroll again')}
                                                    </Button>
                                                </Tooltip>
                                            )}
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
                                                        onClick={() => openConfirm({ kind: 'cert', cert })}
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
                    <Group align="flex-end" gap="xs">
                        <TextInput
                            style={{ flex: 1 }}
                            label={t('Revoke by serial number')}
                            description={t('For a certificate not listed here, e.g. one read off the device')}
                            placeholder="1A2B3C4D5E6F"
                            ff="monospace"
                            value={serialInput}
                            onChange={(e) => setSerialInput(e.currentTarget.value)}
                            error={serialInput.trim() && !serialValid ? t('Hexadecimal digits only') : undefined}
                        />
                        <Button
                            color="red"
                            variant="light"
                            disabled={!serialInput.trim() || !serialValid}
                            leftSection={<IconCertificateOff size={16} />}
                            onClick={() => openConfirm({ kind: 'serial', serial: serialInput.trim() })}
                        >
                            {t('Revoke')}
                        </Button>
                    </Group>
                    <Group justify="space-between">
                        <Button
                            color="red"
                            variant="outline"
                            disabled={activeCount === 0}
                            leftSection={<IconCertificateOff size={16} />}
                            onClick={() => openConfirm({ kind: 'all' })}
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
                title={target?.kind === 'all' ? t('Revoke all certificates?') : t('Revoke certificate?')}
            >
                <Stack>
                    <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                        {target?.kind === 'all'
                            ? t('Every certificate issued to {{username}} ({{count}} active) will be revoked, their devices disconnected and blocked from enrolling again. This can\'t be undone.', { username, count: activeCount })
                            : target?.kind === 'serial'
                                ? t('The certificate with serial {{serial}} will be revoked and any device using it disconnected. This can\'t be undone.', { serial: target.serial })
                                : t('The certificate {{serial}} ({{device}}) will be revoked, the device disconnected and blocked from enrolling again. This can\'t be undone.', {
                                    serial: target?.kind === 'cert' ? target.cert.serial_number ?? '' : '',
                                    device: deviceName(target?.kind === 'cert' ? target.cert : undefined),
                                })}
                    </Alert>
                    {sharedSerial && (
                        <Alert color="orange" icon={<IconAlertTriangle size={16} />} title={t('Shared serial number')}>
                            {t('Serial {{serial}} is an old, short serial number that several certificates share. Revoking it revokes all of them. Click Revoke again to revoke them all.', { serial: sharedSerial })}
                        </Alert>
                    )}
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
                    <Checkbox
                        label={t('Also reset the user\'s password')}
                        description={t('Sets a random password so credentials saved on the device stop working. The user then needs a temporary password from an admin to sign in.')}
                        checked={resetPassword}
                        onChange={(e) => setResetPassword(e.currentTarget.checked)}
                    />
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setTarget(undefined)}>{t('Cancel')}</Button>
                        <Button color="red" loading={revoking} onClick={revoke}>
                            {sharedSerial ? t('Revoke all of them') : t('Revoke')}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            <Modal
                opened={opened && allowTarget !== undefined}
                onClose={() => setAllowTarget(undefined)}
                title={t('Allow this device to enroll again?')}
            >
                <Stack>
                    <Text size="sm">
                        {t('{{device}} ({{uid}}) will be able to enroll for a new certificate with the user\'s credentials. Only do this once the device is back in trusted hands.', {
                            device: deviceName(allowTarget),
                            uid: allowTarget?.eud_uid ?? '',
                        })}
                    </Text>
                    <Group justify="flex-end">
                        <Button variant="default" onClick={() => setAllowTarget(undefined)}>{t('Cancel')}</Button>
                        <Button loading={allowing} onClick={allowEnrollment}>{t('Allow to enroll again')}</Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
