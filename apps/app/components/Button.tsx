import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { theme } from './theme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  busy?: boolean;
  disabled?: boolean;
};

export function Button({ title, onPress, variant = 'primary', busy, disabled }: Props) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        (pressed || disabled) && styles.dim,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? theme.color.onPrimary : theme.color.primary} />
      ) : (
        <Text style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: theme.color.primary },
  secondary: { borderWidth: 1, borderColor: theme.color.border },
  dim: { opacity: 0.6 },
  label: { fontSize: theme.font.body, fontWeight: '600' },
  primaryLabel: { color: theme.color.onPrimary },
  secondaryLabel: { color: theme.color.text },
});
