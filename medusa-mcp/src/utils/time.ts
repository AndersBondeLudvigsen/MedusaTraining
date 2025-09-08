export const inRangeUtc = (
  iso: string,
  fromIso: string,
  toIso: string
): boolean => {
  const t = Date.parse(iso);
  return t >= Date.parse(fromIso) && t < Date.parse(toIso);
};
