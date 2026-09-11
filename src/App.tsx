import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter, Route, Routes } from 'react-router';
import React, { useEffect } from 'react';
import { theme } from './theme';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import '@mantine/dates/styles.css';
import 'mantine-datatable/styles.css';
import './global.css';
import './i18n';
import {I18nextProvider, useTranslation} from "react-i18next";
import { refreshCsrfToken } from './axios_config';

const Login = React.lazy(() => import('./pages/Login/Login.tsx').then());
const Error404 = React.lazy(() => import('./pages/Errors/Error404.tsx').then());
const DefaultLayout = React.lazy(() => import('./DefaultLayout.tsx').then());
const PasswordReset = React.lazy(() => import('./pages/PasswordReset.tsx').then());

export default function App() {
    const { t, i18n } = useTranslation();

    // Runs on every app load, whether or not the session was already authenticated
    // (Login.tsx only mounts on a fresh login, so it can't be the only place this happens).
    useEffect(() => {
        refreshCsrfToken().catch((err) => console.log(err));
    }, []);

  return (
    <I18nextProvider i18n={i18n}>
        <MantineProvider theme={theme} forceColorScheme="dark">
          <Notifications />
          <BrowserRouter>
              <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/404" element={<Error404 />} />
                  <Route path="/reset" element={<PasswordReset />} />
                  {/*<Route path="/register" name="Register Page" element={<Register />} />
                  <Route path="/500" name="Page 500" element={<Page500 />} />*/}
                  <Route path="*" element={<DefaultLayout />} />
              </Routes>
          </BrowserRouter>
        </MantineProvider>
    </I18nextProvider>
  );
}
