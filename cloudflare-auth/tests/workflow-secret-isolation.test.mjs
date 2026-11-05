import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(
  new URL("../../.github/workflows/cloudflare-auth-ci.yml", import.meta.url),
  "utf8"
);

const jobsIndex = workflow.indexOf("\njobs:\n");
const workflowScope = workflow.slice(0, jobsIndex);
const validateIndex = workflow.indexOf("\n  validate:\n", jobsIndex);
const remoteIndex = workflow.indexOf("\n  remote-worker-benchmark:\n", validateIndex);
const previewIndex = workflow.indexOf("\n  preview-smoke:\n", remoteIndex);

assert.notEqual(jobsIndex, -1, "workflow must define jobs");
assert.doesNotMatch(workflowScope, /CLOUDFLARE_API_TOKEN/,
  "workflow-level environment must never expose the Cloudflare token to pull-request jobs");
assert.notEqual(validateIndex, -1, "workflow must define the unprivileged validation job");
assert.notEqual(remoteIndex, -1, "workflow must define a separate remote benchmark job");
assert.notEqual(previewIndex, -1, "workflow must keep the preview smoke job separate");

const validateJob = workflow.slice(validateIndex, remoteIndex);
const remoteJob = workflow.slice(remoteIndex, previewIndex);
const laterJobs = workflow.slice(previewIndex);

assert.doesNotMatch(validateJob, /CLOUDFLARE_API_TOKEN/,
  "pull_request validation must never receive the Cloudflare token");
assert.match(remoteJob,
  /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
  "credentialed benchmark must be restricted to a manual run on main");
assert.match(remoteJob,
  /CLOUDFLARE_API_TOKEN:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/,
  "the token may only be injected into the guarded benchmark job");
assert.match(remoteJob,
  /node cloudflare-auth\/tests\/scrypt-worker-benchmark\.mjs/,
  "the guarded job must run the isolated benchmark");
assert.doesNotMatch(laterJobs, /CLOUDFLARE_API_TOKEN/,
  "other jobs must not receive the Cloudflare token");
