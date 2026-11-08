const cents = (value: string): bigint => {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error('Invalid USD amount');
  return BigInt(value.replace('.', ''));
};
const usd = (value: bigint): string => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;

export function calculateTotals(amounts: string[], discount = '0.00') {
  const subtotal = amounts.reduce((sum, amount) => sum + cents(amount), 0n);
  const discountCents = cents(discount);
  if (subtotal <= 0n || discountCents < 0n || discountCents >= subtotal) throw new Error('Invalid bill total');
  const taxable = subtotal - discountCents;
  const tax = (taxable * 13n + 50n) / 100n;
  return { subtotal: usd(subtotal), discount: usd(discountCents), tax: usd(tax), total: usd(taxable + tax) };
}
