# Monitoring & Alerting

## Grafana Dashboards
- **Contact Sync Overview**: ingestion rate, normalization failures, Kafka lag.
- **DB Performance**: index hit ratios, row churn for `hashed_contacts`, lock wait times.
- **Suggestion Delivery**: API latency, suggestion acceptance funnel.

## Key Metrics
| Metric | Type | Source | Target |
| ------ | ---- | ------ | ------ |
| `contact_upload_duration_seconds` | Histogram | API | p95 < 100 ms |
| `contact_upload_rate_limited_total` | Counter | API | n/a |
| `contact_worker_upserts_total` | Counter | Worker | 3M/day |
| `contact_worker_upsert_errors_total` | Counter | Worker | Alert at >50/day |
| `contact_suggestions_served_total` | Counter | API | n/a |
| `hashed_contact_cleanup_rows` | Counter | Cleanup job | >300k/day |

## Alerts
- **Kafka Lag**: >5 min for 10 consecutive polls.
- **Index Miss**: `pg_stat_user_indexes.idx_hashed_contacts_hashed_phone.idx_scan` delta < 10/min.
- **Cleanup Stall**: job deletes <10k rows over 3 runs.
- **Suggestion Latency**: `GET /v1/contacts:suggestions` p95 > 150 ms for 5 min.
- **Error Rate**: API 5xx > 1% for 5 min.

## Logs
- Structured JSON logs with `requestId`, `batchId`, `userId`.
- Sensitive fields (phone/hash) redacted at logger layer.
- Retained for 30 days in centralized ELK stack with restricted access group.

## Runbooks
- See `docs/runbooks/PHONE_CONTACT_CLEANUP_RUNBOOK.md` and `docs/runbooks/PHONE_CONTACT_ABUSE_RESPONSE_RUNBOOK.md`.
