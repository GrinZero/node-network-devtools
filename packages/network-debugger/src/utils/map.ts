export function headersToObject<T extends Headers>(map: T) {
  const obj: Record<string, string> = {};
  map.forEach((value, key) => {
    obj[key] = value;
  });

  return obj;
}
