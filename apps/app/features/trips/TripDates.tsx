import { todayInToronto, tripDateError } from '@gear/shared';
import { StyleSheet, Text } from 'react-native';
import { DateRangePicker } from '../../components/DateRangePicker';
import { theme } from '../../components/theme';
import { addDays } from '../search/format';

export type Dates = { from: string | null; to: string | null };

// G4.6: the dates when both are set and fine, else null.
export function validDates(d: Dates): { start_date: string; end_date: string } | null {
  if (!d.from || !d.to || tripDateError(d.from, d.to)) return null;
  return { start_date: d.from, end_date: d.to };
}

export function TripDates({ value, onChange }: { value: Dates; onChange: (d: Dates) => void }) {
  return (
    <>
      <Text style={styles.muted}>Tap the first and the last day. For one day, tap it twice.</Text>
      <DateRangePicker value={value} minDate={addDays(todayInToronto(), 1)} onChange={onChange} />
      {value.from && value.to && !validDates(value) ? (
        <Text style={styles.error}>Choose dates from tomorrow on, 30 days at most.</Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  muted: { color: theme.color.muted, fontSize: theme.font.small },
  error: { color: theme.color.danger },
});
