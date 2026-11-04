import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Center, Group, Modal, PasswordInput, PinInput, Stack, Text, Title } from '@mantine/core';
import { IconCertificate, IconDownload, IconExternalLink } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import axios from '../../../axios_config';
import { downloadFile } from '../../ServerRequests/shared';
import { endpoints } from './endpoints';
import { errorText } from './api';
import { CopyValue, notifyFail } from './shared';

export default function AdminAccessTab() {
    const { t } = useTranslation();
    const [nativeUrl, setNativeUrl] = useState<string | null>(null);
    const [urlError, setUrlError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [code, setCode] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(false);
    const [password, setPassword] = useState('');
    const [pwError, setPwError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        axios.get<{ url?: string }>(endpoints.nativeUrl)
            .then((r) => setNativeUrl(r.data?.url || null))
            .catch(async (err) => setUrlError(await errorText(err)));
    }, []);

    function openModal() {
        setCode('');
        setVerified(false);
        setPassword('');
        setPwError(null);
        setOpen(true);
    }

    async function verify() {
        setVerifying(true);
        try {
            await axios.post(endpoints.adminCertVerify2fa, { code });
        } catch (err) {
            setVerifying(false);
            notifyFail(t('Verification failed'), err);
            return;
        }
        try {
            const r = await axios.get<{ password?: string }>(endpoints.adminCertPassword);
            setPassword(r.data?.password ?? '');
            if (!r.data?.password) { setPwError(t('The server returned no import password.')); }
        } catch (err) {
            setPwError(await errorText(err));
        }
        setVerified(true);
        setVerifying(false);
    }

    async function download() {
        setDownloading(true);
        try {
            await downloadFile(endpoints.adminCert, {}, 'fedhub-admin.p12');
        } catch (err: any) {
            if (err?.response?.status === 403) {
                // The 2FA window expired: start over instead of looking verified.
                setVerified(false);
                setCode('');
                notifyFail(t('Your 2FA confirmation expired'), t('Enter a new code to download the certificate.'));
            } else {
                notifyFail(t('Failed to download certificate'), err);
            }
        } finally {
            setDownloading(false);
        }
    }

    return (
        <Stack gap="md">
            <Card className="raven-surface" p="md">
                <Title order={5} mb={4}>{t('Native Federation Hub console')}</Title>
                <Text size="sm" c="dimmed" mb="sm">{t('The hub\'s own admin interface. You log in to it with the admin certificate below, installed in your browser.')}</Text>
                {urlError && <Alert color="red" variant="light" mb="sm">{urlError}</Alert>}
                <Group gap="xs">
                    <Button component="a" href={nativeUrl ?? undefined} target="_blank" rel="noopener noreferrer" radius="xl" variant="default" disabled={!nativeUrl} leftSection={<IconExternalLink size={16} />}>
                        {t('Open native console')}
                    </Button>
                    {nativeUrl && <><Text size="sm" ff="monospace">{nativeUrl}</Text><CopyValue value={nativeUrl} /></>}
                </Group>
            </Card>

            <Card className="raven-surface" p="md">
                <Title order={5} mb={4}>{t('Admin certificate')}</Title>
                <Text size="sm" c="dimmed" mb="sm">{t('A .p12 client certificate for the native console. You confirm with an authenticator-app code first; the import password is shown after that.')}</Text>
                <Button radius="xl" leftSection={<IconCertificate size={16} />} onClick={openModal}>{t('Get admin certificate')}</Button>
            </Card>

            <Modal opened={open} onClose={() => setOpen(false)} title={<Text fw={700}>{t('Get admin certificate')}</Text>} centered>
                {!verified ? (
                    <Stack gap="md">
                        <Text size="sm" c="dimmed">{t('Enter the 6-digit code from your authenticator app. Only authenticator-app (TOTP) 2FA works here.')}</Text>
                        <Center><PinInput length={6} type="number" value={code} onChange={setCode} oneTimeCode /></Center>
                        <Group justify="flex-end" gap="sm">
                            <Button variant="default" radius="xl" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
                            <Button radius="xl" loading={verifying} disabled={code.length < 6} onClick={verify}>{t('Verify')}</Button>
                        </Group>
                    </Stack>
                ) : (
                    <Stack gap="md">
                        {pwError ? (
                            <Alert color="red" variant="light" title={t('Could not get the import password')}>{pwError}</Alert>
                        ) : (
                            <Group gap="xs" align="flex-end" wrap="nowrap">
                                <PasswordInput label={t('Import password (your browser or OS asks for it)')} value={password} readOnly style={{ flex: 1 }} />
                                <CopyValue value={password} />
                            </Group>
                        )}
                        <Text size="xs" c="dimmed">{t('Download within a few minutes; after that you need a new code.')}</Text>
                        <Group justify="flex-end" gap="sm">
                            <Button variant="default" radius="xl" onClick={() => setOpen(false)}>{t('Close')}</Button>
                            <Button radius="xl" leftSection={<IconDownload size={16} />} loading={downloading} onClick={download}>{t('Download certificate')}</Button>
                        </Group>
                    </Stack>
                )}
            </Modal>
        </Stack>
    );
}
