/**
 * Formats integer minor units without ever dividing into a float: the decimal string is built
 * from the integer and handed to Intl.NumberFormat, which formats it exactly.
 */
export function formatMinor(minor: number, currency: string) {
  const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const sign = minor < 0 ? '-' : '';
  const units = String(Math.abs(minor)).padStart(digits + 1, '0');
  const decimal =
    digits === 0 ? units : `${units.slice(0, -digits)}.${units.slice(-digits)}`;
  return formatter.format(`${sign}${decimal}` as unknown as number);
}
