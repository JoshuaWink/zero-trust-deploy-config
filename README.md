# 🔐 Zero-Trust Deploy Config

A **zero-trust** deployment configuration router — define your environment variables per platform, validate them against platform-specific contracts, and export deployment-ready config files. All from your browser.

**🔗 Live Demo:** [joshuawink.github.io/zero-trust-deploy-config](https://joshuawink.github.io/zero-trust-deploy-config/)

## How It Works

1. **Browse Platforms** — see supported deployment targets (Docker, K8s, AWS, GitHub Actions, etc.)
2. **Create Profiles** — choose a platform, add env vars with secret references (never actual values)
3. **Validate** — run profiles against platform contracts to catch issues before deployment
4. **Export** — generate deployment-ready config (env-file, K8s YAML, GitHub Actions, ECS task def, etc.)
5. **Submit Contracts** — missing a platform? Submit a new contract via GitHub PR

## Zero-Trust Principles

- **No secrets stored or transmitted.** Profiles contain *pointers* to your secret manager, never actual values.
- **Client-side validation.** All validation runs in-browser — no server, no API calls.
- **Profiles in localStorage.** Your data stays on your machine.
- **Contracts are static JSON.** Served from GitHub Pages — auditable, versionable, community-reviewable.

## Platform Contracts

| Platform | Category |
|----------|----------|
| Docker | container |
| Docker Compose | container |
| GitHub Actions | ci-cd |
| AWS ECS | cloud |
| AWS Lambda | cloud |
| Kubernetes | orchestration |
| Azure App Service | cloud |
| Vercel | serverless |

## Export Formats

- `.env` file
- Docker Compose YAML
- GitHub Actions YAML
- K8s ConfigMap / Secret YAML
- ECS Task Definition JSON
- Lambda Environment JSON

## Community Contracts

Want to add a platform? Submit a PR with a new contract JSON in `contracts/`. See `contracts/_schema.json` for the required format.

## Built With

This is a [codeupipe](https://github.com/orchestrate-solutions/codeupipe) prototype — the Python validation pipeline uses CUP Filters and Pipelines. The static site mirrors that logic in client-side JavaScript.

---

*All validation runs client-side. No secrets are stored or transmitted.*
