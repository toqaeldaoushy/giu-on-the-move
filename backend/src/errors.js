export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function toInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `${name} must be a whole number`);
  return n;
}

export function checkDate(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `${name} must look like 2026-10-08`);
  }
  return value;
}
