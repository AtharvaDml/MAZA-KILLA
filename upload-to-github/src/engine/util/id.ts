const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
export function uid(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHA[bytes[i] % 36];
  return s;
}
