import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { theme } from './theme';

type Props = TextInputProps & { label: string; error?: string };

export function TextField({ label, error, style, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.color.muted}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.space.xs },
  label: { fontSize: theme.font.small, color: theme.color.muted },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    fontSize: theme.font.body,
    color: theme.color.text,
  },
  inputError: { borderColor: theme.color.danger },
  error: { fontSize: theme.font.small, color: theme.color.danger },
});
