import { ApiError } from '../../../shared/api-error.js';

export function matchesSchema(value: any, schema: any, depth = 0): boolean {
  if (depth > 10 || !schema || typeof schema !== 'object') return false;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'array')
    return (
      Array.isArray(value) &&
      value.length <= 1000 &&
      value.every((v) => matchesSchema(v, schema.items, depth + 1))
    );
  if (schema.type === 'object')
    return (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).every(
        (k) =>
          Object.hasOwn(schema.properties ?? {}, k) &&
          matchesSchema(value[k], schema.properties[k], depth + 1),
      )
    );
  return false;
}
export function validScreenData(definition: any, screen: string, data: any) {
  const fields = definition.screens.find((s: any) => s.id === screen)?.data ?? {};
  return Object.keys(data).every(
    (k) => Object.hasOwn(fields, k) && matchesSchema(data[k], fields[k]),
  );
}
export function validateEndpoint(definition: any, input: any) {
  if (
    definition?.data_api_version !== '3.0' ||
    !Array.isArray(definition.screens) ||
    Buffer.byteLength(JSON.stringify(input)) > 50000
  )
    throw new ApiError(
      400,
      'INVALID_DATA_ENDPOINT',
      'Flow JSON must declare data_api_version 3.0 and a bounded endpoint configuration',
    );
  const map = new Map<string, any>();
  for (const screen of input.screens) {
    if (map.has(screen.id) || screen.id === 'SUCCESS')
      throw new ApiError(
        400,
        'INVALID_DATA_ENDPOINT',
        'Configured screen identifiers must be unique',
      );
    map.set(screen.id, screen);
  }
  if (!map.has(input.initialScreen))
    throw new ApiError(400, 'INVALID_DATA_ENDPOINT', 'Initial screen is not configured');
  for (const screen of input.screens) {
    const actual = definition.screens.find((s: any) => s.id === screen.id);
    if (
      !actual ||
      Boolean(actual.terminal) !== screen.complete ||
      (screen.complete && screen.nextScreen) ||
      (!screen.complete && !screen.nextScreen)
    )
      throw new ApiError(
        400,
        'INVALID_DATA_ENDPOINT',
        'Configure each screen with an allowed next screen or terminal completion',
      );
    if (
      screen.nextScreen &&
      (!map.has(screen.nextScreen) ||
        !definition.routing_model?.[screen.id]?.includes(screen.nextScreen))
    )
      throw new ApiError(
        400,
        'INVALID_DATA_ENDPOINT',
        'Next screen is absent from the Flow routing model',
      );
    if (
      Object.keys(screen.bindings).length > 100 ||
      Object.keys(screen.bindings).some((k) =>
        ['flow_token', '__proto__', 'constructor', 'prototype'].includes(k),
      )
    )
      throw new ApiError(400, 'INVALID_DATA_ENDPOINT', 'Invalid field bindings');
    if (Object.keys(screen.data).some((k) => !Object.hasOwn(actual.data ?? {}, k)))
      throw new ApiError(
        400,
        'INVALID_DATA_ENDPOINT',
        'Screen data must match declared Flow fields',
      );
    if (!validScreenData(definition, screen.id, screen.data))
      throw new ApiError(
        400,
        'INVALID_DATA_ENDPOINT',
        'Configured screen values must match declared field types',
      );
  }
  return input;
}
