import React, { useEffect, useState } from 'react';
import {
    AppShell,
    Anchor,
    Avatar,
    Burger,
    Group,
    Image,
    Menu,
    rem,
    Modal,
    NumberInput,
    Flex,
    Button,
    Paper,
    Text,
    Tooltip,
    Center,
    UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
    IconCheck,
    IconLogout,
    IconAlertTriangle,
    IconUser,
    IconCertificate,
    IconQrcode,
    Icon2fa,
    IconHelp,
    IconMail,
    IconRefresh,
    IconCircleMinus,
    IconChevronDown,
    IconX,
} from '@tabler/icons-react';
import { Navigate, useNavigate, Link } from 'react-router';
import { notifications } from '@mantine/notifications';
import { QRCode } from 'react-qrcode-logo';
import { DateTimePicker } from '@mantine/dates';
import { formatISO, parseISO } from 'date-fns';
import Logo from './images/ots-logo.png';
import { AppContent } from './components/AppContent';
import axios from './axios_config';
import { apiRoutes } from './apiRoutes';
import Navbar from './components/Navbar/Navbar';
import { socket } from './socketio';
import {t} from "i18next";

interface ATAKQrCode {
    qr_string: string;
    sub: string;
    iat: number;
    iss: string;
    aud: string;
    max: number|string;
    nbf: number|null;
    exp: number|null;
    disabled: boolean;
    total_uses: number;
}

export function DefaultLayout() {
    const loggedIn = JSON.parse(String(localStorage.getItem('loggedIn'))) === true;
    if (!loggedIn) {
        return <Navigate to="/login" />;
    }

    const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
    const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);

    const navigate = useNavigate();

    const [socketConnected, setSocketConnected] = useState(false);

    const [showItakQr, setShowItakQr] = useState(false);
    const [itakQrString, setItakQrString] = useState('');
    const [showAtakQr, setShowAtakQr] = useState(false);
    const [atakQR, setAtakQR] = useState<ATAKQrCode>({
        qr_string: "",
        sub: "",
        iat: 0,
        iss: "",
        aud: "",
        max: "",
        nbf: null,
        exp: null,
        disabled: false,
        total_uses: 0
    });

    useEffect(() => {
        function onConnect() {
            setSocketConnected(true);
        }

        function onDisconnect() {
            setSocketConnected(false);
        }

        function onAlert(alert:any) {
            let message = `${alert.alert_type} from ${alert.callsign}`;
            let color = 'red';
            let icon = <IconAlertTriangle style={{ width: rem(20), height: rem(20) }} />;
            const alert_sound = new Audio('/alert.mp3');
            alert_sound.play();

            if (alert.cancel_time !== null) {
                message = `${alert.alert_type} from ${alert.callsign} canceled`;
                color = 'green';
                icon = <IconCheck style={{ width: rem(20), height: rem(20) }} />;
            }

            notifications.show({
                title: t('Alert'),
                message,
                color,
                icon,
            });
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('alert', onAlert);

        if (!socketConnected) {
            socket.connect();
        }

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('alert', onAlert);
        };
    }, []);

    const logout = () => {
        axios.post(
            apiRoutes.logout
        ).then(r => {
            if (r.status === 200) {
                localStorage.clear();
                navigate('/');
            }
        });
    };

    const itak_qr_string = () => {
        axios.get(apiRoutes.itakQrString).then(r => {
            if (r.status === 200) {
                setItakQrString(r.data);
                setShowItakQr(true);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                message: 'Failed to get QR code string',
                icon: <IconX />,
                color: 'red',
            });
        });
    };

    function getAtakQr() {
        axios.get<ATAKQrCode>(apiRoutes.atakQrString, {}).then(r => {
            if (r.status === 200) {
                setAtakQR(r.data)
                setShowAtakQr(true);
            }
        }).catch(err => {
            console.log(err);
            setShowAtakQr(true)
        })
    }

    function generateAtakQr() {
        axios.post<ATAKQrCode>(apiRoutes.atakQrString, atakQR).then(r => {
            if (r.status === 200) {
                setAtakQR(r.data);
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: 'Failed to generate QR code',
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            });
        })
    }

    function deleteAtakQr() {
        axios.delete(apiRoutes.atakQrString).then(r => {
            if (r.status === 200) {
                setAtakQR({
                    qr_string: "",
                    sub: "",
                    iat: 0,
                    iss: "",
                    aud: "",
                    max: "",
                    nbf: null,
                    exp: null,
                    disabled: false,
                    total_uses: 0
                });
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: 'Failed to delete QR code',
                message: err.response.data.error,
                icon: <IconX />,
                color: 'red',
            });
        })
    }

    return (
        <>
            <AppShell
              header={{ height: 72 }}
              navbar={{
                    width: 300,
                    breakpoint: 'sm',
                    collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
                }}
              padding="md"
            >
                <AppShell.Header pb={0} className="raven-mesh" style={{ borderBottom: '1px solid var(--mantine-color-dark-4)' }}>
                    <Group justify="space-between" pr={5} h="100%">
                        <Group h="100%" w={300} gap="xs">
                            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" pl={5} color="white" />
                            <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="sm" color="white" />
                            <Anchor href="https://c4raven.net" target="_blank" rel="noopener noreferrer" display="flex">
                                <Image src={Logo} h={39} w="auto" />
                            </Anchor>
                        </Group>
                        <Group>
                            <Menu shadow="md" width={220} trigger="click-hover" position="bottom-end">
                                <Menu.Target>
                                    <UnstyledButton className="raven-user-trigger">
                                        <Group gap={8} wrap="nowrap">
                                            <Avatar radius="xl" size={30} color="blue" variant="light">
                                                {(localStorage.getItem('username') || '?').slice(0, 2).toUpperCase()}
                                            </Avatar>
                                            <Text size="sm" fw={600} c="white" visibleFrom="xs">
                                                {localStorage.getItem('username')}
                                            </Text>
                                            <IconChevronDown size={14} style={{ opacity: 0.6 }} />
                                        </Group>
                                    </UnstyledButton>
                                </Menu.Target>

                                <Menu.Dropdown>
                                    <Menu.Label>C4 RAVEN</Menu.Label>
                                    <Menu.Item leftSection={<IconUser size={14} />} onClick={() => {navigate('/profile')}}>
                                        {t("Profile")}
                                    </Menu.Item>
                                    <Menu.Item leftSection={<Icon2fa size={14} />} component={Link} to="/tfa_setup">
                                        {t("Setup 2FA")}
                                    </Menu.Item>
                                    <Menu.Item leftSection={<IconCertificate size={14} />} onClick={() => window.open(apiRoutes.truststore, "_blank")}>
                                        {t("Download Truststore")}
                                    </Menu.Item>
                                    <Menu.Item leftSection={<IconQrcode size={14} />} onClick={() => getAtakQr()}>
                                        {t("ATAK QR Code")}
                                    </Menu.Item>
                                    <Menu.Item leftSection={<IconQrcode size={14} />} onClick={() => itak_qr_string()}>
                                        {t("iTAK QR Code")}
                                    </Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Label>{t("Support")}</Menu.Label>
                                    <Menu.Item leftSection={<IconMail size={14} />} component="a" href="mailto:support@c4raven.net">
                                        support@c4raven.net
                                    </Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Item
                                      disabled={localStorage.getItem('loggedIn') !== 'true'}
                                      leftSection={<IconLogout style={{ width: rem(14), height: rem(14) }} />}
                                      onClick={() => {
                                            logout();
                                        }}
                                    >
                                        {t("Log Out")}
                                    </Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        </Group>
                    </Group>
                </AppShell.Header>
                <AppShell.Navbar pl="md" pr="md" className="raven-mesh" style={{ borderRight: '1px solid var(--mantine-color-dark-4)' }}>
                    <Navbar />
                </AppShell.Navbar>
                <AppShell.Main bg="dark.7"><AppContent /></AppShell.Main>
            </AppShell>

            <Modal opened={showItakQr} onClose={() => setShowItakQr(false)} p="md" title={t("iTAK Connection Details")}>
                <Center>
                    <Paper p="md" shadow="xl" withBorder bg="white">
                        <QRCode size={350} value={itakQrString} quietZone={10} qrStyle="dots" ecLevel="H" eyeRadius={50} />
                    </Paper>
                </Center>
            </Modal>
            <Modal opened={showAtakQr} onClose={() => setShowAtakQr(false)} title={t("ATAK QR Code")}>
                <DateTimePicker onChange={(date) => {
                    if (date !== "Invalid Date" && date !== null) {
                        setAtakQR({...atakQR, exp: Math.floor(parseISO(date).getTime() / 1000)});
                    }}}
                    minDate={new Date()}
                    valueFormat="YYYY-MM-DD HH:mm:ss ZZ"
                    value={atakQR.exp !== null ? formatISO(new Date(atakQR.exp * 1000)) : null}
                    disabled={atakQR?.qr_string !== ""}
                    label={t("Expiration Date")}
                    clearable
                    firstDayOfWeek={0}
                    clearButtonProps={{
                        onClick: () => {
                            setAtakQR({...atakQR, exp: null})
                        }
                    }} timePickerProps={{
                        withDropdown: true,
                        popoverProps: { withinPortal: false },
                        format: '24h',
                    }} />
                <NumberInput hideControls min={1} value={atakQR.max} disabled={atakQR.qr_string !== ''} label={t("Max Uses")} onChange={(value) => {
                    const max = `${value}`
                    setAtakQR({...atakQR, max: parseInt(max, 10)})
                }} />

                <NumberInput display={Number(atakQR.max) > 0 && atakQR.qr_string !== '' ? "block" : "none"} min={0} value={atakQR.total_uses} disabled label={t("Total Uses")} onChange={(value) => {
                    const max = `${value}`
                    setAtakQR({...atakQR, max: parseInt(max, 10)})
                }} />

                <Center>
                    <Button mt="md" mr="md" mb="md" onClick={() => generateAtakQr()} disabled={atakQR.qr_string !== ''} leftSection={<IconRefresh size={14} />}>{t("Generate")}</Button>
                    <Button mt="md" mr="md" mb="md" onClick={() => deleteAtakQr()} disabled={atakQR.qr_string === ''} leftSection={<IconCircleMinus size={14} />}>{t("Delete")}</Button>
                </Center>
                <Flex direction="column" gap="md" align="center" display={atakQR.qr_string === '' ? "none" : "flex"}>
                    <Paper p="md" shadow="xl" withBorder bg="white">
                        <QRCode size={350} value={atakQR.qr_string} quietZone={10} eyeRadius={50} ecLevel="L" qrStyle="dots" />
                    </Paper>
                    <Tooltip label={t("Tap here if you're reading this on the EUD you want to connect to C4 RAVEN")}>
                        <Button component="a" href={atakQR.qr_string}>{t("Open ATAK")}</Button>
                    </Tooltip>
                    <Text ta="center" fw={700}>{t("Remember to treat this QR code like a password and don't share it with anyone.")}</Text>
                </Flex>
            </Modal>
        </>
    );
}

export default DefaultLayout;
