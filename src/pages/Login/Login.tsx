import {
    TextInput,
    PasswordInput,
    Checkbox,
    Anchor,
    Paper,
    Container,
    Group,
    Button,
    Image,
    Center,
    Stack,
    PaperProps,
    PinInput,
    Text,
    Title,
    rem,
    Box,
} from '@mantine/core';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { notifications } from '@mantine/notifications';
import { IconArrowLeft, IconCheck, IconX, IconUser, IconLock } from '@tabler/icons-react';
import { apiRoutes } from '../../apiRoutes';
import axios from '../../axios_config';
import Logo from '../../images/ots-logo.png';
import { QRCode } from 'react-qrcode-logo';

const OUTER_BACKGROUND = 'rgb(35, 37, 41)';

const CARD_BACKGROUND = `
    radial-gradient(ellipse 55% 50% at 15% 0%, rgba(255, 255, 255, 0.08), transparent 60%),
    radial-gradient(ellipse 65% 55% at 100% 25%, rgba(0, 0, 0, 0.25), transparent 60%),
    radial-gradient(ellipse 75% 60% at 25% 115%, rgba(0, 0, 0, 0.3), transparent 60%),
    #373a40
`;

const fieldStyles = {
    input: {
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderColor: 'rgba(255, 255, 255, 0.35)',
        color: '#fff',
        transition: 'border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out',
        '&::placeholder': {
            color: 'rgba(255, 255, 255, 0.55)',
            textTransform: 'uppercase' as const,
            fontSize: '0.8rem',
            letterSpacing: '0.5px',
        },
        '&:focus': {
            borderColor: 'var(--mantine-color-blue-5)',
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            boxShadow: '0 0 0 3px rgba(76, 110, 245, 0.25)',
        },
    },
    section: {
        color: 'rgba(255, 255, 255, 0.75)',
    },
};

const pinInputStyles = {
    input: {
        backgroundColor: 'transparent',
        borderColor: 'rgba(255, 255, 255, 0.35)',
        color: '#fff',
    },
};

export default function Login(props: PaperProps) {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [csrfToken, setCsrfToken] = useState('');
    const [type, setType] = useState('login');
    const [email, setEmail] = useState('');
    const [emailEnabled, setEmailEnabled] = useState(false);
    const [authCode, setAuthCode] = useState<string>();
    const [ldapEnabled, setLdapEnabled] = useState(false);
    const [qrValue, setQrValue] = useState('');
    const [qrKey, setQrKey] = useState('');
    const [turnstileEnabled, setTurnstileEnabled] = useState(false);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
    const [turnstileReady, setTurnstileReady] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState('');
    const turnstileRef = useRef<HTMLDivElement>(null);
    const turnstileWidgetId = useRef<string | null>(null);

    useEffect(() => {
        axios.get(apiRoutes.turnstile).then(r => {
            setTurnstileEnabled(!!r.data.enabled);
            setTurnstileSiteKey(r.data.site_key || '');
        }).catch(err => {
            console.log(err);
        });
    }, []);

    // Cloudflare's widget script is only loaded once Turnstile is confirmed
    // enabled server-side, so a Turnstile-disabled deployment never fetches
    // a third-party script.
    useEffect(() => {
        if (!turnstileEnabled) return;

        if ((window as any).turnstile) {
            setTurnstileReady(true);
            return;
        }

        const existing = document.getElementById('cf-turnstile-script');
        if (existing) {
            existing.addEventListener('load', () => setTurnstileReady(true));
            return;
        }

        const script = document.createElement('script');
        script.id = 'cf-turnstile-script';
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
        script.async = true;
        script.defer = true;
        script.onload = () => setTurnstileReady(true);
        document.body.appendChild(script);
    }, [turnstileEnabled]);

    useEffect(() => {
        const w = (window as any).turnstile;
        if (!turnstileReady || !turnstileEnabled || !turnstileSiteKey || type !== 'login' || !w || !turnstileRef.current) {
            return;
        }

        turnstileWidgetId.current = w.render(turnstileRef.current, {
            sitekey: turnstileSiteKey,
            theme: 'dark',
            callback: (token: string) => setTurnstileToken(token),
            'expired-callback': () => setTurnstileToken(''),
            'error-callback': () => setTurnstileToken(''),
        });

        return () => {
            if (turnstileWidgetId.current && w.remove) {
                w.remove(turnstileWidgetId.current);
            }
            turnstileWidgetId.current = null;
        };
    }, [turnstileReady, turnstileEnabled, turnstileSiteKey, type]);

    function resetTurnstile() {
        const w = (window as any).turnstile;
        if (w && turnstileWidgetId.current) {
            w.reset(turnstileWidgetId.current);
        }
        setTurnstileToken('');
    }

    function turnstileSatisfied() {
        if (!turnstileEnabled || turnstileToken) return true;
        notifications.show({
            title: 'Verification required',
            message: 'Please complete the human verification challenge',
            color: 'red',
            icon: <IconX />,
        });
        return false;
    }

    useEffect(() => {
        try {
            axios.get(
                apiRoutes.login,
                {
                    headers: { 'Content-Type': 'application/json' },
                },
            ).then(r => {
                setEmailEnabled(r.data.response.identity_attributes.includes('email'));
                setLdapEnabled(r.data.response.identity_attributes.includes('ldap'));
                localStorage.setItem('emailEnabled', r.data.response.identity_attributes.includes('email'));
                if (r.data.response.csrf_token !== '') {
                    axios.defaults.headers.common['X-XSRF-Token'] = r.data.response.csrf_token;
                }

                setCsrfToken(r.data.response.csrf_token);
            });
        } catch (err) {
            console.log(err);
        }
    }, []);

    const getUser = () => {
        axios.get(
            apiRoutes.me
        ).then(r => {
            if (r.status === 200) {
                const user = r.data;
                const { roles } = user;

                localStorage.setItem('email', user.email);
                localStorage.setItem('token', user.token)

                for (let i = 0; i < roles.length; i += 1) {
                    if (roles[i].name === 'administrator') {
                        localStorage.setItem('administrator', 'true');
                        break;
                    }
                }
            }
            navigate('/dashboard');
        });
    };

    function startTfSetup() {
        // First-time login for an account with two-factor required but not yet
        // configured: set up an authenticator method and show its QR code
        // right here, instead of leaving the user stuck with no next step.
        axios.post(
            apiRoutes.tfSetup,
            { setup: 'authenticator' }
        ).then(r => {
            if (r.status === 200) {
                const issuer: string = r.data.response.tf_authr_issuer;
                const authrUsername: string = r.data.response.tf_authr_username;
                const key: string = r.data.response.tf_authr_key;
                setQrKey(key);
                setQrValue(`otpauth://totp/${issuer}:${authrUsername}?secret=${key.replaceAll('-', '')}&issuer=${issuer}`);
                setType('authenticator');
            }
        }).catch(err => {
            notifications.show({
                title: 'Failed to start two-factor setup',
                message: err.response?.data?.response?.errors?.[0] ?? '',
                color: 'red',
                icon: <IconX />,
            });
        });
    }

    function handleLogin(e:any) {
        e.preventDefault();

        if (!turnstileSatisfied()) return;

        let loginUrl = apiRoutes.login;
        if (ldapEnabled)
            loginUrl = apiRoutes.ldapLogin;

        axios.post(
            loginUrl,
            JSON.stringify({ username, password, submit: 'Login', csrf_token: csrfToken, turnstile_token: turnstileToken })
        ).then(r => {
            if (r.status === 200) {
                localStorage.setItem('loggedIn', 'true');
                localStorage.setItem('username', username);
                if (Object.hasOwn(r.data.response, 'tf_required') && r.data.response.tf_required) {
                    if (r.data.response.tf_method === 'authenticator') {
                        setType('authenticator');
                    } else if (r.data.response.tf_method === 'email') {
                        setType('email');
                    } else {
                        startTfSetup();
                    }
                } else if (r.data.response.force_password_change) {
                    window.location.href = apiRoutes.changePassword;
                } else {getUser();}
            }
        }).catch(err => {
            resetTurnstile();
            notifications.show({
                title: 'Login Failed',
                message: err.response.data.response.errors[0],
                color: 'red',
                icon: <IconX />,
            });
        });
}

    function handleRegister(e:any) {
        e.preventDefault();
        axios.post(
            apiRoutes.register,
            { username, password, email }
        ).then(r => {
            if (r.status === 200) {
                notifications.show({
                    message: 'Registration Succeeded',
                    color: 'green',
                    icon: <IconCheck />,
                });
            }
        }).catch(err => {
            notifications.show({
                title: 'Registration Failed',
                message: err.response.data.response.errors[0],
                color: 'red',
                icon: <IconX />,
            });
        });
    }

    function handleAuthCode(e:any) {
        e.preventDefault();
        axios.post(
            apiRoutes.tfValidate,
            { code: authCode }
        ).then(r => {
            if (r.status === 200) {
                notifications.show({
                    message: 'Authentication Succeeded',
                    color: 'green',
                    icon: <IconCheck />,
                });
                if (r.data.response.force_password_change) {
                    window.location.href = apiRoutes.changePassword;
                } else {
                    getUser();
                }
            }
        }).catch(err => {
            console.log(err);
            notifications.show({
                title: 'Authentication Failed',
                message: err.response.data.response.errors[0],
                color: 'red',
                icon: <IconX />,
            });
        });
    }

    function handleReset(e:any) {
        e.preventDefault();
        axios.post(
            apiRoutes.resetPassword,
            { email }
        ).then(r => {
            if (r.status === 200) {
                notifications.show({
                    message: `Password reset instructions have been sent to ${email}`,
                    color: 'green',
                    icon: <IconCheck />,
                });
            }
        }).catch(err => {
            notifications.show({
                message: 'Failed to send password reset instructions',
                color: 'red',
                icon: <IconX />,
            });
        });
    }

    return (
        <Box style={{ background: OUTER_BACKGROUND, minHeight: '100vh' }}>
            <Center mih="100vh" py={40}>
                <Container size={480} w="100%">
                    {type === 'Reset Password' && (
                        <Stack align="center" mb="md">
                            <Title order={2} c="white">Forgot your password?</Title>
                            <Text c="white">Enter your email to get a reset link</Text>
                        </Stack>
                    )}

                    <Paper
                      radius="xl"
                      p="xl"
                      shadow="xl"
                      {...props}
                      style={{
                        background: CARD_BACKGROUND,
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        boxShadow: '0 32px 64px -24px rgba(0, 0, 0, 0.65), 0 12px 24px -12px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                      }}
                    >
                        <Center mb="lg">
                            <Image src={Logo} h={64} w="auto" fit="contain" style={{ maxWidth: '100%' }} />
                        </Center>

                        <Stack>
                            {(type === 'register' || type === 'Reset Password') && emailEnabled && (
                                <TextInput
                                  required
                                  placeholder="Email"
                                  value={email}
                                  onChange={(event) => setEmail(event.currentTarget.value)}
                                  radius="md"
                                  size="md"
                                  leftSection={<IconUser size={18} />}
                                  styles={fieldStyles}
                                />
                            )}

                            {(type === 'register' || type === 'login') && (
                                <>
                                    <TextInput
                                      required
                                      placeholder="Username"
                                      value={username}
                                      onChange={(event) => setUsername(event.currentTarget.value)}
                                      radius="md"
                                      size="md"
                                      leftSection={<IconUser size={18} />}
                                      styles={fieldStyles}
                                    />

                                    <PasswordInput
                                      required
                                      placeholder="Password"
                                      value={password}
                                      onChange={(event) => setPassword(event.currentTarget.value)}
                                      radius="md"
                                      size="md"
                                      leftSection={<IconLock size={18} />}
                                      styles={fieldStyles}
                                    />
                                </>
                        )}

                            {(type === 'authenticator' && qrValue === '') && (
                                    <Text ta="center" c="white">Please check your authenticator app for an auth code</Text>
                            )}
                            {(type === 'email') && (
                                <Text ta="center" c="white">Please check your email for an auth code</Text>
                            )}

                            {qrValue !== '' && (
                                <Stack align="center" pb="md">
                                    <Text ta="center" c="white">
                                        Two-factor authentication is required for this account. Scan
                                        this QR code with an authenticator app (or enter the key below
                                        manually), then enter the 6-digit code it shows.
                                    </Text>
                                    <Paper shadow="xl" radius="md" p="xl" withBorder w="min-content" bg="white">
                                        <Stack align="center">
                                            <QRCode value={qrValue} size={280} quietZone={10} eyeRadius={50} ecLevel="L" qrStyle="dots" />
                                            <Text ta="center" c="black">{qrKey}</Text>
                                        </Stack>
                                    </Paper>
                                </Stack>
                            )}

                            <div style={{ display: (type === 'email' || type === 'authenticator' ? 'block' : 'none') }}>
                                <Stack>
                                    <Center>
                                        <PinInput
                                          type="number"
                                          length={6}
                                          onChange={(e) => setAuthCode(e)}
                                          radius="md"
                                          styles={pinInputStyles}
                                        />
                                    </Center>
                                    <Button
                                      variant="white"
                                      className="raven-cta"
                                      fullWidth
                                      onClick={(e) => { handleAuthCode(e); }}
                                    >
                                        Submit
                                    </Button>
                                </Stack>
                            </div>

                        </Stack>

                        {type === 'login' &&
                            <Group justify="space-between" mt="lg">
                                <Checkbox label="Remember me" styles={{ label: { color: '#fff' } }} />
                            </Group>
                        }

                        {(type === 'login' || type === 'register' || type === 'Reset Password') && (
                            <Button
                              variant="white"
                              className="raven-cta"
                              fullWidth
                              radius="md"
                              size="md"
                              mt="xl"
                              fw={700}
                              c={OUTER_BACKGROUND}
                              style={{ letterSpacing: '0.5px' }}
                              onClick={(e) => {
                                if (type === 'login') {handleLogin(e);}
                                else if (type === 'register') {handleRegister(e);}
                                else if (type === 'Reset Password') {handleReset(e);}
                              }}
                            >
                                {type.toUpperCase()}
                            </Button>
                        )}

                        {type === 'login' && turnstileEnabled &&
                            <Center mt="lg">
                                <div ref={turnstileRef} />
                            </Center>
                        }

                        <Stack align="center" mt="md" gap={4}>
                            {type === 'login' &&
                                <Text size="xs" c="rgba(255, 255, 255, 0.5)" ta="center">
                                    Forgot your password? Email{' '}
                                    <Anchor href="mailto:support@c4raven.net" size="xs" c="rgba(255, 255, 255, 0.75)">
                                        support@c4raven.net
                                    </Anchor>{' '}
                                    for help.
                                </Text>
                            }
                            {type === 'login' && emailEnabled &&
                                <Anchor component="button" type="button" size="sm" c="rgba(255, 255, 255, 0.85)" onClick={() => setType('Reset Password')}>
                                    Forgot password?
                                </Anchor>
                            }
                            <Anchor
                              component="button"
                              type="button"
                              c="rgba(255, 255, 255, 0.6)"
                              onClick={() => {
                                if (type === 'login') {setType('register');}
                                else if (type === 'register') {setType('login');}
                                else if (type === 'Reset Password') {setType('login');}
                            }}
                              size="xs"
                            >
                                {type === 'register' && 'Already have an account? Login'}
                                {(type === 'login' && emailEnabled) && "Don't have an account? Register"}
                                {type === 'Reset Password' && <Center inline>
                                    <IconArrowLeft style={{ width: rem(12), height: rem(12) }} stroke={1.5} />
                                    <Box ml={5}>Back to the login page</Box>
                                                              </Center>}
                            </Anchor>
                        </Stack>
                    </Paper>
                </Container>
            </Center>
        </Box>
    );
}
