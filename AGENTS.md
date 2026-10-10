# Project guide

- This is the source and deployment repository for `uiui611/asset-manager`.
- Keep changes simple. UI and Rust API are built together by the multi-stage Dockerfile.
- Use Bun 1.4.2, Rust 1.98.1, and the committed lockfiles. Generate schemas before frontend checks.
- Format with `bun run format` (Oxfmt defaults). `check:ci` checks Oxfmt formatting and Biome lint without a second formatter.
- Check UI with `bun run check:ci`, `bun run test`, `bun run build`, and `bun run test:e2e`; check Rust with `cargo test --manifest-path backend/Cargo.toml --locked`.
- `main` intentionally publishes the mutable GHCR `main` tag. The optional OIDC webhook requests a Deployment update after publication without waiting for rollout.
- `deploy/asset-manager.yaml` is the canonical manifest. Verify context and explicit namespace before Kubernetes operations; retain existing DB, S3 bucket, credentials, and storage.
- Bootstrap scripts are only for a new environment. Never rerun them against the existing deployment as part of an image update.
- Never commit environment files, credentials, private keys, kubeconfig, generated build outputs, or Secret values.
