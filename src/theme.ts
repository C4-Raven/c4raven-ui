import { createTheme, MantineColorsTuple, Button, ActionIcon, Paper, Card, Modal } from '@mantine/core';

const paleBlue: MantineColorsTuple = [
  '#eef3ff',
  '#dce4f5',
  '#b9c7e2',
  '#94a8d0',
  '#748dc1',
  '#5f7cb8',
  '#5474b4',
  '#44639f',
  '#39588f',
  '#2d4b81',
];

// Matches the login screen: dark.7 is the page background (rgb(35, 37, 41)),
// dark.8 is the card/header/sidebar surface (#373a40).
const dark: MantineColorsTuple = [
  '#C1C2C5',
  '#A6A7AB',
  '#909296',
  '#5C5F66',
  '#373A40',
  '#2C2E33',
  '#2f3136',
  '#232529',
  '#373a40',
  '#18191c',
];

export const theme = createTheme({
  defaultRadius: 'md',
  colors: {
    paleBlue,
    dark,
  },
  shadows: {
    xl: '0 20px 45px -12px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
  },
  components: {
    Button: Button.extend({
      defaultProps: {
        radius: 'xl',
      },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: {
        radius: 'xl',
      },
    }),
    Paper: Paper.extend({
      defaultProps: {
        radius: 'lg',
      },
    }),
    Card: Card.extend({
      defaultProps: {
        radius: 'lg',
      },
    }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'lg',
      },
    }),
  },
});
