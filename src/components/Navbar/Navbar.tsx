import React, {ReactElement, useEffect, useState} from 'react';
import {
    IconAlertTriangle,
    IconPackage,
    IconBroadcast,
    IconDeviceMobile,
    IconDashboard,
    IconPuzzle,
    IconUsers,
    IconMap,
    IconCalendarDue,
    IconMovie,
    IconSettings,
    IconPlugConnected,
    IconPlug,
    IconUsersGroup, IconLink,
    IconChevronRight,
    IconChevronDown,
    IconFlag,
    IconAffiliate,
} from '@tabler/icons-react';
import {
    NavLink,
    ScrollArea,
    Menu,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link, useLocation } from 'react-router';
import classes from './Navbar.module.css';
import axios from '../../axios_config';
import { apiRoutes } from '../../apiRoutes';
import {t} from "i18next";

const navbarLinks = [
    { link: '/dashboard', label: t('Dashboard'), icon: IconDashboard },
    { link: '/map', label: t('Map'), icon: IconMap },
    { link: '/euds', label: t('EUDs'), icon: IconDeviceMobile },
    { link: '/alerts', label: t('Alerts'), icon: IconAlertTriangle },
    { link: '/data_packages', label: t('Data Packages'), icon: IconPackage },
    { link: '/video_streams', label: t('Video Streams'), icon: IconBroadcast },
    { link: '/video_recordings', label: t('Video Recordings'), icon: IconMovie },
    { link: '/missions', label: t('Missions'), icon: IconFlag },
];

const adminLinks = [
    { link: '/users', label: t('Users'), icon: IconUsers },
    { link: '/groups', label: t('Groups'), icon: IconUsersGroup },
    { link: '/jobs', label: t('Scheduled Jobs'), icon: IconCalendarDue },
    { link: '/plugin_updates', label: t('Plugin Updates'), icon: IconPuzzle },
    { link: '/device_profiles', label: t('Device Profiles'), icon: IconDeviceMobile },
    { link: '/server_plugin_manager', label: t('Server Plugin Manager'), icon: IconPlugConnected },
    { link: '/link_account', 'label': t('Link TAK.gov Account'), icon: IconLink},
    { link: '/federation_hub', label: t('Federation Hub'), icon: IconAffiliate },
];

export default function Navbar() {
    const administrator = localStorage.getItem('administrator') === 'true';
    const location = useLocation();
    // Below the AppShell's navbar breakpoint the sidebar is a full-width
    // mobile drawer, so a flyout to the right has nowhere to go and renders
    // off-screen — drop the submenu down instead.
    const isMobile = useMediaQuery('(max-width: 48em)');
    const submenuPosition = isMobile ? 'bottom-start' : 'right-start';
    const SubmenuChevron = isMobile ? IconChevronDown : IconChevronRight;
    const [plugins, setPlugins] = useState([]);
    const [pluginNavLinks, setPluginNavLinks] = useState<ReactElement[]>([]);

    useEffect(() => {
        get_plugins();
    }, []);

    useEffect(() => {
        generatePluginLinks();
    }, [plugins]);

    const generatePluginLinks = () => {
        if (plugins !== null) {
            const links = plugins.map((plugin: any) => (
                <Menu.Item
                    component={Link}
                    key={plugin.distro}
                    to={`/plugin?name=${plugin.distro}`}
                    leftSection={<IconPlugConnected size={16} stroke={1.5}/>}
                >
                    {plugin.name}
                </Menu.Item>
            ))
            setPluginNavLinks(links)
        }
    }

    const links = navbarLinks.map((item) => (
        <NavLink
          className={classes.link}
          component={Link}
          key={item.label}
          active={location.pathname === item.link}
          to={item.link}
          label={item.label}
          leftSection={<item.icon className={classes.linkIcon} stroke={1.5} />}
          mt="md"
        />
    ));

    const adminActive = adminLinks.some((item) => item.link === location.pathname);

    const get_plugins = () => {
        axios.get(apiRoutes.plugins).then(r => {
            if (r.status === 200) {
                setPlugins(r.data.plugins)
            }
        })
    }

    return (
        <ScrollArea type="never">
            <div>
                {links}
            </div>
            {administrator &&
                <div className={classes.footer}>
                    <Menu shadow="md" width={240} position={submenuPosition} offset={4} withinPortal>
                        <Menu.Target>
                            <NavLink
                              className={classes.link}
                              active={adminActive || undefined}
                              label={t("Admin")}
                              leftSection={<IconSettings className={classes.linkIcon} stroke={1.5} />}
                              rightSection={<SubmenuChevron size={14} />}
                              mt="md"
                            />
                        </Menu.Target>
                        <Menu.Dropdown>
                            {adminLinks.map((item) => (
                                <Menu.Item
                                  component={Link}
                                  key={item.label}
                                  to={item.link}
                                  leftSection={<item.icon size={16} stroke={1.5} />}
                                >
                                    {item.label}
                                </Menu.Item>
                            ))}
                        </Menu.Dropdown>
                    </Menu>

                    {pluginNavLinks.length > 0 &&
                        <Menu shadow="md" width={240} position={submenuPosition} offset={4} withinPortal>
                            <Menu.Target>
                                <NavLink
                                  className={classes.link}
                                  label={t("Plugins")}
                                  leftSection={<IconPlug className={classes.linkIcon} stroke={1.5} />}
                                  rightSection={<SubmenuChevron size={14} />}
                                  mt="md"
                                />
                            </Menu.Target>
                            <Menu.Dropdown>
                                {pluginNavLinks}
                            </Menu.Dropdown>
                        </Menu>
                    }
                </div>
            }
        </ScrollArea>
    );
}
