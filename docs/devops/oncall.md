# On-Call & Incident Response

Guidelines for operators responding to production incidents.

## Severity

| Level | Definition | Example | Response SLA |
| ----- | ---------- | ------- | ------------ |
| SEV-1 | Total outage, data loss risk | API down, DB down | < 15 min response |
| SEV-2 | Major degraded | search down, workers stuck | < 1h |
| SEV-3 | Minor / long tail | dashboard latency | next business day |

## Run hours

- Primary channels: on-call pager (alerts), #incidents slack channel.
- Follow the [DEVOPS_SPEC](../specifications/DEVOPS_SPEC.md) runbook.

## Standard steps

1. Acknowledge the alert; declare SEV in the channel.
2. Save evidence: logs (Loki), traces (Tempo), dashboards screenshot.
3. Mitigate: if safe, roll back deploy or feature flag; else throttle.
4. Restore service; verify health endpoints green.
5. Post-incident review: timeline, impact, root cause, action items (see DR
   runbooks and DEVOPS_SPEC).

## Contacts

- On-call rotation configured in ops tooling; see `infrastructure/monitoring/alerts`.