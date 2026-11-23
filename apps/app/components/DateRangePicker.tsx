import { StyleSheet, View } from 'react-native';
import DateTimePicker, { type DateType } from 'react-native-ui-datepicker';
import { theme } from './theme';

type Range = { from: string | null; to: string | null };
type Props = { value: Range; minDate: string; maxDays: number; onChange: (range: Range) => void };

// Calendar dates in and out, as YYYY-MM-DD (invariant 9): never a timestamp.
export function DateRangePicker({ value, minDate, maxDays, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <DateTimePicker
        mode="range"
        startDate={value.from ?? undefined}
        endDate={value.to ?? undefined}
        minDate={minDate}
        max={maxDays - 1} // the package compares the difference; both ends count here
        onChange={({ startDate, endDate }) =>
          onChange({ from: toIso(startDate), to: toIso(endDate) })
        }
        styles={{
          day_label: styles.text,
          weekday_label: styles.muted,
          month_selector_label: styles.heading,
          year_selector_label: styles.heading,
          button_prev_image: styles.arrow,
          button_next_image: styles.arrow,
          disabled_label: styles.disabled,
          range_fill: styles.fill,
          range_middle_label: styles.text,
          range_start: styles.end,
          range_end: styles.end,
          range_start_label: styles.endLabel,
          range_end_label: styles.endLabel,
        }}
      />
    </View>
  );
}

function toIso(date: DateType): string | null {
  if (!date) return null;
  const d = new Date(typeof date === 'object' ? date.valueOf() : date);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

const styles = StyleSheet.create({
  wrap: { maxWidth: 360, width: '100%' },
  text: { color: theme.color.text },
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  heading: { color: theme.color.text, fontSize: theme.font.body, fontWeight: '600' },
  arrow: { tintColor: theme.color.text },
  disabled: { color: theme.color.border },
  fill: { backgroundColor: theme.color.surface },
  end: { backgroundColor: theme.color.primary, borderRadius: theme.radius.sm },
  endLabel: { color: theme.color.onPrimary },
});
