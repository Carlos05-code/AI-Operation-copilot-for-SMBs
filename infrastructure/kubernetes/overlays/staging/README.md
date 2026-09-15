# Staging overlay

Single replica of everything, a `-staging` cert-manager issuer, and the `api`/migration image tag
pinned to `staging`.

## Before applying

1. Build and push the backend image tagged `staging` (`infrastructure/docker/Dockerfile.api`).
2. Create the real `api-secret` (never commit it — `../../base/backend/api-secret.example.yaml`
   documents every key it needs):

   ```
   kubectl create secret generic api-secret -n smb-copilot --from-env-file=.env.staging
   ```

3. `kubectl apply -k infrastructure/kubernetes/overlays/staging`
4. `kubectl apply -f infrastructure/kubernetes/base/backend/migrate-job.yaml -n smb-copilot`
   (already included by the `kustomize build`, but re-run it standalone after any release that adds
   a migration — the Job name is fixed, so `kubectl delete job api-migrate` first or the re-apply is
   a no-op).
