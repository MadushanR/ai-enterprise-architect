# Compliance Mandates: Identity and Access Management (IAM)

> Enforced by the Security agent using BYOC criteria.
> Every architecture proposal is evaluated against all rules in this file.

---

## Rule: least-privilege-service-accounts
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: Every service must use a dedicated IAM service account with only the permissions required for its documented function; shared credentials between services are not permitted.
Example violation: A backend API and a background worker share the same IAM service account that has both read and write access to all storage buckets.

---

## Rule: mfa-for-privileged-access
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: All human access to production infrastructure, databases, and secret stores must require multi-factor authentication; API key-only access to production systems is not permitted for human operators.
Example violation: A database administrator accesses the production PostgreSQL instance using only a username and password without MFA.

---

## Rule: session-expiry-limit
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: All human session tokens must expire within 8 hours; service-to-service tokens must expire within 1 hour; no non-expiring tokens may be issued for any purpose.
Example violation: A deployment pipeline uses a non-expiring personal access token stored as a CI/CD environment variable to push container images.

---

## Rule: secret-rotation-policy
Enforced by: Security Agent (granite-guardian-3-8b)
Statement: All secrets (API keys, database passwords, TLS certificates) must be stored in a secrets manager (e.g., IBM Secrets Manager, HashiCorp Vault) and rotated at least every 90 days; hardcoded secrets in source code or container images are a blocking violation.
Example violation: A database connection string is hardcoded in a Kubernetes ConfigMap rather than referenced from a secrets manager.
