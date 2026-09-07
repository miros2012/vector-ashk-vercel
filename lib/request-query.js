function asQueryObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) result[key] = item.map(entry => String(entry ?? ''));
    else if (item !== undefined) result[key] = String(item ?? '');
  }
  return result;
}

function ownDataQuery(req) {
  if (!req || typeof req !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(req, 'query');
  if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
  return asQueryObject(descriptor.value);
}

function queryFromUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new URL(raw, 'http://localhost');
  const query = {};
  for (const [key, value] of parsed.searchParams) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = value;
      continue;
    }
    query[key] = Array.isArray(query[key])
      ? [...query[key], value]
      : [query[key], value];
  }
  return query;
}

export function parseRequestQuery(req) {
  const fromUrl = queryFromUrl(req?.url ?? req?.originalUrl);
  if (fromUrl) return fromUrl;
  return ownDataQuery(req) || {};
}

export function firstRequestQueryValue(req, name) {
  const value = parseRequestQuery(req)[name];
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}
