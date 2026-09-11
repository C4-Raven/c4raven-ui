import React from 'react';
import {
    Group,
    Button,
    Box,
    Image,
} from '@mantine/core';

import { useNavigate } from 'react-router';
import Logo from '../images/ots-logo.png';
import classes from './Header.module.css';
import axios from '../axios_config';
import { apiRoutes } from '../apiRoutes';

interface HeaderProps {
    logoHeight?: number;
}

export const Header = ({ logoHeight = 48 }: HeaderProps = {}) => {
    const loggedIn = localStorage.getItem('loggedIn') === 'true';

    const navigate = useNavigate();

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

    return (
        <Box pb={0} className="raven-mesh">
            <header className={classes.header}>
                <Group justify="space-between" h="100%">
                    <Image src={Logo} h={logoHeight} w="auto" fit="contain" style={{ maxWidth: '55%' }} />

                    <Group>
                        <Button
                          style={loggedIn ? { display: 'block' } : { display: 'none' }}
                          variant="default"
                          onClick={() => {
                            logout();
                        }}
                        >Log Out
                        </Button>
                    </Group>
                </Group>
            </header>
        </Box>
    );
};

export default Header;
