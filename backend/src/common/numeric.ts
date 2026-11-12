export const numeric = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : parseFloat(v)),
};
