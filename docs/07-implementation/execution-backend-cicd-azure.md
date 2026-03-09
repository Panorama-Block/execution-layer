# Execution Backend CI/CD to Azure Container Apps

This setup mirrors the `panorama-block-backend` deployment model:

1. GitHub Actions builds Docker image from `backend/`
2. Image is pushed to GHCR
3. Azure Container App is updated to the new image

## Files

- Workflow: `.github/workflows/deploy-execution-service.yml`
- Azure template: `infra/container-apps/execution-service.yaml`
- Docker ignore: `backend/.dockerignore`

## GitHub configuration

Add repository secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `GHCR_USERNAME`
- `GHCR_PASSWORD`

Notes:

- `GHCR_PASSWORD` should be a PAT with `read:packages` and `write:packages`.
- Workflow triggers on pushes to `main` that touch `backend/**` or deployment files.

## Azure configuration

## 1) Create Container Apps environment (if not existing)

```bash
az containerapp env create \
  --name <aca-env-name> \
  --resource-group Core-Deploy \
  --location brazilsouth
```

## 2) Create the Container App (first time)

Set env vars and create from YAML:

```bash
export ACA_ENV_ID="<container-app-env-resource-id>"
export GHCR_NAMESPACE="<github-owner-lowercase>"
export IMAGE_TAG="bootstrap"
export GHCR_USERNAME="<github-username>"
export GHCR_PASSWORD="<github-pat>"

export BASE_RPC_URL="https://mainnet.base.org"
export EXECUTOR_ADDRESS="0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC"
export AERODROME_ADAPTER_ADDRESS="0x187e499afB2DE75836800ad19147e0cFcd2Dc715"
export DCA_VAULT_ADDRESS="0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1"

az containerapp create \
  --resource-group Core-Deploy \
  --yaml infra/container-apps/execution-service.yaml
```

After first create, CI/CD uses `az containerapp update --image ...`.

## 3) Authorize GitHub OIDC principal for deployment

Grant the federated identity (`AZURE_CLIENT_ID`) permission on resource group `Core-Deploy`:

- Minimum role: `Contributor`

Also ensure the app can pull GHCR:

- Workflow runs `az containerapp registry set ...` each deploy.

## Verify deployment

- Trigger `Deploy Execution Service` workflow manually (`workflow_dispatch`) once.
- Check revision/image:

```bash
az containerapp show \
  --name execution-service \
  --resource-group Core-Deploy \
  --query properties.template.containers[0].image
```

- Check health endpoint from inside your network (ingress is internal by default):

`GET /health` should return status `ok`.

## Optional adjustments

- If you want public access, set `ingress.external: true` in YAML.
- If you use a different RG/app name, update `RG` and `CONTAINER_APP_NAME` in workflow.
