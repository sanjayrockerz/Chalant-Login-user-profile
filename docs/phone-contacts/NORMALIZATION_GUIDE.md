# Phone Number Normalization Guide

## Library
- Source: `packages/phone-normalization`
- Entry point: `normalizePhoneNumber(input: string, countryHint?: string): NormalizedPhone`
- Dependencies: libphonenumber-js (commonjs build)

## Workflow
1. **Input sanitization**: strip ASCII control characters, collapse whitespace, enforce printable range.
2. **Country hint resolution**: prefer explicit `countryHint` from mobile client; fall back to user profile country; final fallback is `US` (configurable).
3. **Validation**: reject numbers that do not pass libphonenumber's `isValidNumber` check or belong to premium/short-code ranges flagged in `blockedPrefixes` list.
4. **Normalization**: return E.164 string, national significant number, country code, and region metadata.

## Example
```ts
import { normalizePhoneNumber } from "@colleging/phone-normalization";

normalizePhoneNumber(" (415) 555-1234 ", "US");
// => {
//   e164: "+14155551234",
//   countryCode: "1",
//   region: "US",
//   nationalNumber: "4155551234"
// }
```

## Error Handling
- Throws `NormalizationError` with codes: `INVALID`, `BLOCKED_RANGE`, `UNSUPPORTED_REGION`, `EMPTY_INPUT`.
- API layer converts errors into HTTP 400 responses with telemetry tags for rate limiting.

## Testing
- Unit tests live in `packages/phone-normalization/__tests__/normalizePhoneNumber.test.ts`.
- Snapshot coverage ensures E.164 output remains stable when libphonenumber package updates.

## Operational Notes
- Keep libphonenumber up to date quarterly; run `npm run normalize:update-fixtures` to refresh blocked ranges.
- Monitor `phone_normalization_failures_total` metric; alert at >2% failure rate per 5-minute window.
