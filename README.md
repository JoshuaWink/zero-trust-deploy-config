# 🔐 Zero-Trust Deploy Config

A **zero-trust** deployment configuration router — define your environment variables per platform, validate them against platform-specific contracts, and export deployment-ready config files. All from your browser.

**🔗 Live Demo:** [joshuawink.github.io/zero-trust-deploy-config](https://joshuawink.github.io/zero-trust-deploy-config/)

## How It Works

1. **Browse Platforms** — see 23 supported deployment targets across 6 categories
2. **Create Profiles** — choose a platform, add env vars with secret references (never actual values)
3. **Validate** — run profiles against platform contracts to catch issues before deployment
4. **Export** — generate deployment-ready config in 17 formats
5. **Browse Recipes** — pick a multi-platform stack and generate all linked profiles at once
6. **Submit Contracts** — missing a platform? Submit a new contract via GitHub PR

## Zero-Trust Principles

- **No secrets stored or transmitted.** Profiles contain *pointers* to your secret manager, never actual values.
- **Client-side validation.** All validation runs in-browser — no server, no API calls.
- **Profiles in localStorage.** Your data stays on your machine.
- **Contracts are static JSON.** Served from GitHub Pages — auditable, versionable, community-reviewable.

## Platform Contracts (23)

| Platform | Category |
|----------|----------|
| Docker | container |
| Docker Compose | container |
| GitHub Actions | ci-cd |
| CircleCI | ci-cd |
| GitLab CI/CD | ci-cd |
| AWS ECS | cloud |
| AWS Lambda | cloud |
| AWS App Runner | cloud |
| Google Cloud Run | cloud |
| Terraform / OpenTofu | cloud |
| Azure App Service | cloud |
| Azure Functions | serverless |
| GCP Cloud Functions | serverless |
| Vercel | paas |
| Heroku | paas |
| Fly.io | paas |
| Railway | paas |
| Render | paas |
| Netlify | paas |
| DigitalOcean App Platform | paas |
| Kubernetes | orchestration |
| HashiCorp Nomad | orchestration |
| Cloudflare Workers | edge |

## Export Formats (17)

| Format | Use Case |
|--------|----------|
| `.env` file | Universal |
| Docker Compose YAML | Container orchestration |
| GitHub Actions YAML | CI/CD secrets |
| CircleCI YAML | CircleCI environments |
| GitLab CI YAML | GitLab CI/CD variables |
| K8s ConfigMap YAML | Non-sensitive Kubernetes config |
| K8s Secret YAML | Sensitive Kubernetes secrets |
| ECS Task Definition JSON | AWS ECS container config |
| Lambda Environment JSON | AWS Lambda env vars |
| Heroku JSON | Heroku config vars |
| Fly.io TOML | Fly.io [env] block |
| Railway JSON | Railway variable export |
| Render YAML | render.yaml envVars |
| Netlify TOML | netlify.toml context blocks |
| Terraform .tfvars | Terraform variable files |
| Cloudflare Wrangler TOML | Workers [vars] config |
| Nomad HCL | Nomad job env stanza |

## Demo Profiles (7)

Load demos from the app to try:

| Demo | Platform | Notes |
|------|----------|-------|
| SaaS API — Production | Kubernetes | 8 vars, Vault + K8s secrets |
| Startup Frontend — Vercel | Vercel | 5 vars, Vercel secrets |
| Data Pipeline — ECS | AWS ECS | 6 vars, SSM + Secrets Manager |
| ⚠️ Broken Deploy | GitHub Actions | 5 intentional errors |
| Heroku API — PaaS | Heroku | 6 vars, Heroku + Doppler |
| Edge Worker — Cloudflare | Cloudflare Workers | 4 vars, CF secrets |
| Cloud Run API — GCP | Google Cloud Run | 6 vars, Secret Manager |

## Deployment Recipes (8)

Recipes are **multi-platform deployment stacks** — composable blueprints that chain platform contracts into complete pipelines.

| Recipe | Steps | Complexity | Flow |
|--------|-------|------------|------|
| Full-Stack Kubernetes | 4 | Advanced | GitHub Actions → Docker → K8s → Terraform |
| Serverless AWS | 3 | Intermediate | GitHub Actions → Lambda → Terraform |
| JAMstack on Vercel | 1 | Starter | GitHub → Vercel |
| Heroku PaaS Stack | 2 | Starter | GitHub Actions → Heroku |
| Edge-First Cloudflare | 2 | Intermediate | GitHub Actions → Cloudflare Workers |
| AWS ECS Fargate Pipeline | 4 | Intermediate | GitHub Actions → Docker → ECS → Terraform |
| GCP Cloud-Native | 3 | Intermediate | GitHub Actions → Cloud Run → Terraform |
| GitLab CI + Docker Compose | 2 | Starter | GitLab CI → Docker Compose |

Each recipe shows the full pipeline flow, per-step env vars with suggested secret backends, and a **"Generate All Profiles"** button that creates linked profiles for every step in one click.

## Deployment Recipes (8)

Recipes are **multi-platform deployment stacks** — composable blueprints that chain platform contracts into complete pipelines.

| Recipe | Steps | Complexity | Flow |
|--------|-------|------------|------|
| Full-Stack Kubernetes | 4 | Advanced | GitHub Actions → Docker → K8s → Terraform |
| Serverless AWS | 3 | Intermediate | GitHub Actions → Lambda → Terraform |
| JAMstack on Vercel | 1 | Starter | GitHub → Vercel |
| Heroku PaaS Stack | 2 | Starter | GitHub Actions → Heroku |
| Edge-First Cloudflare | 2 | Intermediate | GitHub Actions → Cloudflare Workers |
| AWS ECS Fargate Pipeline | 4 | Intermediate | GitHub Actions → Docker → ECS → Terraform |
| GCP Cloud-Native | 3 | Intermediate | GitHub Actions → Cloud Run → Terraform |
| GitLab CI + Docker Compose | 2 | Starter | GitLab CI → Docker Compose |

Each recipe shows the full pipeline flow, per-step env vars with suggested secret backends, and a **"Generate All Profiles"** button that creates linked profiles for every step in one click.

## Community Contracts

Want to add a platform? Submit a PR with a new contract JSON in `contracts/`. See `contracts/_schema.json` for the required format.

## Built With

This is a [codeupipe](https://github.com/orchestrate-solutions/codeupipe) prototype — the Python validation pipeline uses CUP Filters and Pipelines. The static site mirrors that logic in client-side JavaScript.

---

*All validation runs client-side. No secrets are stored or transmitted.*
