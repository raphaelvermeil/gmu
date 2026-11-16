// The one theme file. Components read from here; screens do not hard-code colours or sizes.
export const theme = {
  color: {
    background: '#ffffff',
    surface: '#f4f5f2',
    text: '#1c1f1a',
    muted: '#62685d',
    border: '#d5d8d0',
    primary: '#2f5d3a',
    onPrimary: '#ffffff',
    danger: '#b3261e',
  },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 10 },
  font: { body: 16, small: 14, title: 24 },
} as const;
