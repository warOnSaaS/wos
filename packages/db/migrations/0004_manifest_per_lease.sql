-- 0004_manifest_per_lease.sql — contracts 3.1.0 (found at the Wave 1 integration gate). Owner: Lead Architect.
-- The context engine is deterministic: re-claiming the same task on the same snapshot produces a
-- byte-identical manifest. A manifest is unique per LEASE, not globally; the binding that matters
-- (agent run, changeset, review) is to the lease, and those rows are signed.
alter table wos.context_manifests drop constraint context_manifests_manifest_sha256_key;
alter table wos.context_manifests add constraint context_manifests_lease_manifest_key unique (lease_id, manifest_sha256);
create index context_manifests_sha on wos.context_manifests (manifest_sha256);
