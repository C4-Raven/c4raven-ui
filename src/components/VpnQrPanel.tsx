import React, { useEffect, useRef, useState } from 'react';
import {
    ActionIcon,
    Anchor,
    Autocomplete,
    Badge,
    Button,
    Center,
    ComboboxItem,
    CopyButton,
    Flex,
    Group,
    List,
    OptionsFilter,
    Paper,
    Stack,
    Text,
    Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import {
    IconCheck,
    IconCopy,
    IconDownload,
    IconRefresh,
    IconX,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { QRCode } from 'react-qrcode-logo';
import { formatISO, parseISO } from 'date-fns';
import { t } from 'i18next';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';

export interface ServerAddress {
    address: string;
    interface: string;
    kind: 'vpn' | 'lan' | 'public';
}

// The response also carries `domain`, which is deliberately not offered here:
// this QR is for devices that reach the server by IPv4 address only.
interface ServerAddresses {
    addresses: ServerAddress[];
}

export interface VpnQrResult {
    qr_string: string;
    url: string;
    host: string;
    username: string;
    expiration: number | null;
}

interface VpnQrPanelProps {
    // Admins generating for another user pass that user's name; omitted for
    // self-service, where the backend uses the logged-in user.
    username?: string;
    // Runs before each generate (e.g. the Users page saving the certificate
    // validity the enrollment will be signed with); resolving false aborts.
    beforeGenerate?: () => Promise<boolean>;
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

// The backend only accepts an IPv4 literal for `host`.
function isIpv4(host: string): boolean {
    return IPV4_RE.test(host);
}

// Show every address when the field holds an exact match (e.g. the
// pre-filled VPN default), so the LAN/public choices stay visible; otherwise
// filter by substring as usual.
const addressFilter: OptionsFilter = ({ options, search }) => {
    const items = options as ComboboxItem[];
    const query = search.trim().toLowerCase();
    if (query === '' || items.some((o) => o.value.toLowerCase() === query)) {
        return items;
    }
    return items.filter((o) => o.value.toLowerCase().includes(query));
};

function pickDefaultAddress(addresses: ServerAddress[]): string {
    const vpn = addresses.find((a) => a.kind === 'vpn');
    if (vpn) {
        return vpn.address;
    }
    const current = window.location.hostname;
    if (isIpv4(current)) {
        return current;
    }
    if (addresses.length > 0) {
        return addresses[0].address;
    }
    return '';
}

const KIND_COLORS: Record<ServerAddress['kind'], string> = {
    vpn: 'green',
    lan: 'blue',
    public: 'orange',
};

export function VpnQrPanel({ username, beforeGenerate }: VpnQrPanelProps) {
    const [addresses, setAddresses] = useState<ServerAddress[]>([]);
    const [host, setHost] = useState('');
    const [expiration, setExpiration] = useState<number | null>(null);
    const [result, setResult] = useState<VpnQrResult | null>(null);
    const [loading, setLoading] = useState(false);
    // Bumped on unmount and username change so a generate request that
    // resolves afterwards is ignored instead of showing the wrong user's QR.
    const requestId = useRef(0);

    useEffect(() => () => {
        requestId.current += 1;
    }, []);

    useEffect(() => {
        axios.get<ServerAddresses>(apiRoutes.serverAddresses).then((r) => {
            if (r.status === 200) {
                const list = r.data.addresses ?? [];
                setAddresses(list);
                setHost((current) => current || pickDefaultAddress(list));
            }
        }).catch((err) => {
            console.log(err);
            setHost((current) => current || pickDefaultAddress([]));
        });
    }, []);

    // A QR belongs to one user; don't carry it over when the admin opens the
    // panel for someone else.
    useEffect(() => {
        requestId.current += 1;
        setResult(null);
        setLoading(false);
    }, [username]);

    const trimmedHost = host.trim();
    const hostValid = isIpv4(trimmedHost);

    async function generate() {
        if (!hostValid) {
            return;
        }
        if (beforeGenerate && !(await beforeGenerate())) {
            return;
        }
        const body: { host: string; expiration?: number; username?: string } = {
            host: trimmedHost,
        };
        if (expiration !== null) {
            body.expiration = expiration;
        }
        if (username) {
            body.username = username;
        }
        requestId.current += 1;
        const id = requestId.current;
        setLoading(true);
        axios.post<VpnQrResult>(apiRoutes.vpnQrString, body).then((r) => {
            if (id !== requestId.current) {
                return;
            }
            setLoading(false);
            if (r.status === 200 && r.data.qr_string) {
                setResult(r.data);
            }
        }).catch((err) => {
            if (id !== requestId.current) {
                return;
            }
            setLoading(false);
            console.log(err);
            notifications.show({
                title: t('Failed to generate QR code'),
                message: err.response?.data?.error,
                icon: <IconX />,
                color: 'red',
            });
        });
    }

    const byAddress = new Map(addresses.map((a) => [a.address, a]));

    return (
        <Stack gap="sm">
            <Text size="sm" c="dimmed">
                {t('For devices that reach the server by IP address (such as over a VPN) without a domain name')}
            </Text>
            <Autocomplete
              label={t('Server address')}
              description={t('Pick the address the phone will use, or type one, such as a NAT or port-forward address')}
              error={trimmedHost !== '' && !hostValid ? t("Use the server's VPN or LAN IP address (IPv4)") : undefined}
              data={addresses.map((a) => a.address)}
              filter={addressFilter}
              value={host}
              onChange={setHost}
              clearable
              renderOption={({ option }) => {
                    const info = byAddress.get(option.value);
                    return (
                        <Group gap="xs" wrap="nowrap">
                            <Text size="sm">{option.value}</Text>
                            {info && (
                                <>
                                    <Badge size="xs" variant="light" color={KIND_COLORS[info.kind]}>
                                        {info.kind.toUpperCase()}
                                    </Badge>
                                    <Text size="xs" c="dimmed">{info.interface}</Text>
                                </>
                            )}
                        </Group>
                    );
                }}
            />
            <DateTimePicker
              onChange={(date) => {
                    if (date !== 'Invalid Date' && date !== null) {
                        setExpiration(Math.floor(parseISO(date).getTime() / 1000));
                    }
                }}
              minDate={new Date()}
              valueFormat="YYYY-MM-DD HH:mm:ss ZZ"
              value={expiration !== null ? formatISO(new Date(expiration * 1000)) : null}
              label={t('Expiration Date')}
              description={t('The link expires in 24 hours unless you set an expiration')}
              clearable
              firstDayOfWeek={0}
              clearButtonProps={{
                    onClick: () => {
                        setExpiration(null);
                    },
                }}
              timePickerProps={{
                    withDropdown: true,
                    popoverProps: { withinPortal: false },
                    format: '24h',
                }}
            />
            <Center>
                <Button
                  onClick={() => generate()}
                  disabled={!hostValid}
                  loading={loading}
                  leftSection={<IconRefresh size={14} />}
                >
                    {result ? t('Regenerate') : t('Generate')}
                </Button>
            </Center>

            {result && (
                <Flex direction="column" gap="sm" align="center">
                    <Paper p="md" shadow="xl" withBorder bg="white">
                        <QRCode size={300} value={result.qr_string} quietZone={10} eyeRadius={50} ecLevel="L" qrStyle="dots" />
                    </Paper>
                    <Text size="xs" c="dimmed">
                        {result.username} @ {result.host}
                    </Text>
                    <Text size="sm">
                        {t('Expires')}: {result.expiration
                            ? new Date(result.expiration * 1000).toLocaleString()
                            : t('in 24 hours')}
                    </Text>
                    <Group justify="center" gap="xs">
                        <Tooltip label={t("Tap here if you're reading this on the EUD you want to connect to C4 RAVEN")}>
                            <Button component="a" href={result.qr_string}>{t('Open in ATAK')}</Button>
                        </Tooltip>
                        <CopyButton value={result.qr_string}>
                            {({ copied, copy }) => (
                                <Tooltip label={copied ? t('Copied') : t('Copy')}>
                                    <ActionIcon variant="subtle" size="lg" onClick={copy} aria-label={t('Copy')}>
                                        {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                                    </ActionIcon>
                                </Tooltip>
                            )}
                        </CopyButton>
                    </Group>
                    <Anchor href={result.url} size="sm">
                        <Group gap={4} wrap="nowrap">
                            <IconDownload size={14} />
                            {t('Download connection package (iTAK / WinTAK)')}
                        </Group>
                    </Anchor>
                    <Text size="xs" c="dimmed" mt={-8}>
                        {t('Open this link from a device on the VPN')}
                    </Text>
                    <List size="sm" spacing={4} type="ordered" w="100%">
                        <List.Item>{t('Connect the phone to the VPN first')}</List.Item>
                        <List.Item>{t('Scan with ATAK {{version}} or later and confirm the import', { version: '5.1' })}</List.Item>
                        <List.Item>{t('ATAK asks once for a username and password, so enter the Raven login for this account')}</List.Item>
                        <List.Item>{t('ATAK then registers and connects automatically')}</List.Item>
                        <List.Item>{t('For iTAK, download the connection package and use Upload Server Package')}</List.Item>
                    </List>
                    <Text ta="center" fw={700}>
                        {t("This QR code contains a credential, so treat it like a password and don't share it with anyone")}
                    </Text>
                </Flex>
            )}
        </Stack>
    );
}

export default VpnQrPanel;
