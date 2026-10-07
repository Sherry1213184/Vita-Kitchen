export const currencies = ['GBP', 'CNY', 'EUR'] as const;
export type Currency = typeof currencies[number];

// Store pence/cents as integers. Never round a floating-point currency input.
export function parseAmount(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return amount > 0 && amount <= 100_000_000 ? amount : null;
}

export function splitAmount(amount: number, users: string[]) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !users.length || new Set(users).size !== users.length) {
    throw new Error('Invalid equal split');
  }
  // Stable identity order, independent of checkbox order or changing nicknames.
  return [...users].sort().map((user, i) => ({ user,
    amount: Math.floor(amount / users.length) + (i < amount % users.length ? 1 : 0),
  }));
}

export function money(amount: number, currency: Currency) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(amount / 100);
}

export function expenseBalances(expenses: { amount: number; currency: Currency; payer: string; voided: number;
  shares: { user: string; amount: number; settled: number }[] }[], me: string) {
  return currencies.map(currency => {
    const active = expenses.filter(e => !e.voided && e.currency === currency);
    return { currency, total: active.reduce((n, e) => n + e.amount, 0),
      pay: active.reduce((n, e) => n + e.shares.filter(s => s.user === me && e.payer !== me && !s.settled).reduce((v, s) => v + s.amount, 0), 0),
      receive: active.filter(e => e.payer === me).reduce((n, e) => n + e.shares.filter(s => s.user !== me && !s.settled).reduce((v, s) => v + s.amount, 0), 0),
    };
  }).filter(b => b.total > 0 || b.currency === 'GBP');
}
