import { createTheme } from '@mui/material/styles';

export function makeTheme(mode: 'light' | 'dark') {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#8DB4E2' : '#1E4A7A' },
      secondary: { main: dark ? '#E0B25C' : '#A8761E' },
      success: { main: dark ? '#5CC27A' : '#1B7F3B' },
      background: dark ? { default: '#12161C', paper: '#1A2029' } : { default: '#F3F5F8', paper: '#FFFFFF' },
    },
    typography: {
      fontFamily: '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          },
        },
      },
    },
  });
}
