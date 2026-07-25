# Compliance Mandates: Data Residency and Sovereignty

> Enforced by the Security agent using BYOC criteria.
> Every architecture proposal is evaluated against all rules in this file.

---

## Rule: pii-region-confinement
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: All personally identifiable information (PII) must be stored and processed exclusively within the data residency region declared in the system's Data Processing Agreement; architectures that replicate PII to a different region without explicit documented justification are a blocking violation.
Example violation: A GDPR-scoped system that declares EU data residency replicates its user table (containing email addresses) to a us-east-1 read replica for latency reasons without a lawful transfer mechanism.

---

## Rule: cross-border-transfer-logging
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: Any transfer of data containing PII or regulated fields across regional boundaries must be logged with a timestamp, source region, destination region, data classification, and lawful basis; architectures without an explicit cross-border transfer audit trail are non-compliant.
Example violation: A CDN configuration caches API responses containing user identifiers at edge nodes in multiple jurisdictions with no logging of which data was served from which region.

---

## Rule: data-classification-at-rest
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: All persistent data stores must declare a data classification level (public, internal, confidential, restricted); stores classified as confidential or restricted must use encryption at rest with customer-managed keys (CMK); provider-managed keys alone are insufficient for restricted data.
Example violation: A database storing payment card data uses IBM Cloud Databases for PostgreSQL with provider-managed encryption keys rather than customer-managed keys via IBM Key Protect.

---

## Rule: right-to-erasure-support
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: Any architecture storing PII must include a documented and technically feasible mechanism for per-subject data deletion (right to erasure); architectures that use append-only immutable logs as the sole store of PII without a compensation mechanism are non-compliant.
Example violation: User profile data is stored exclusively in an append-only Kafka topic with infinite retention, with no process to redact or delete individual user records upon erasure requests.
