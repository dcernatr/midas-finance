type LedgerMovement = {
  date: string; type: string; description: string; categoryId: string | null;
  code: string | null; sourceName: string | null;
};
type LedgerCategory = { id: string; name: string };
export const DEFAULT_LEDGER_FILTERS = { period: "all", type: "all", search: "" } as const;

// The ledger is the complete history. Only an explicit filter may hide dates;
// dashboard calculations continue to use their own monthly subset.
export function filterLedger<T extends LedgerMovement>(transactions: T[], categories: LedgerCategory[],
  filters: { period: string; type: string; search: string } = DEFAULT_LEDGER_FILTERS): T[] {
  const names = new Map(categories.map(category => [category.id, category.name]));
  const search = filters.search.trim().toLocaleLowerCase("es");
  return transactions.filter(row => {
    if (filters.period !== "all" && row.date.slice(0, 7) !== filters.period) return false;
    if (filters.type !== "all" && row.type !== filters.type) return false;
    return [row.description, names.get(row.categoryId || ""), row.code, row.sourceName]
      .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(search);
  });
}

export function ledgerPeriods(transactions: Array<{ date: string }>, currentMonth: string) {
  return [...new Set([currentMonth, ...transactions.map(row => row.date.slice(0, 7))])]
    .filter(period => /^\d{4}-(0[1-9]|1[0-2])$/.test(period)).sort().reverse();
}
