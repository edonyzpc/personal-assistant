const REQUIRED_STEPS = ['Install dependencies', 'Lint', 'Build', 'Test', 'Audit bundle'];

function githubRepository(remote) {
  const match = remote.trim().match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/);
  if (!match) return null;
  const name = match[2].replace(/\.git$/, '');
  if (!name || name === '.' || name === '..') return null;
  return `${match[1]}/${name}`;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function matchesRunIdentity(run, repository, sourceCommit) {
  return positiveInteger(run?.id) && positiveInteger(run.run_attempt)
    && run.path === '.github/workflows/ci.yml'
    && run.head_sha === sourceCommit && run.head_branch === 'master' && run.event === 'push'
    && run.repository?.full_name?.toLowerCase() === repository.toLowerCase();
}

/**
 * Find completed full CI evidence for the exact live master commit.
 * capture is a synchronous, timeout-bounded command runner supplied by the caller.
 * This helper never writes state and treats unavailable evidence as a full-check fallback.
 */
export function findVerifiedMasterCi({ sourceCommit, capture }) {
  const unavailable = reason => ({ verified: false, reason });
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) return unavailable('Invalid source commit');

  let stage = 'origin lookup';
  try {
    const repository = githubRepository(capture('git', ['remote', 'get-url', 'origin']));
    if (!repository) return unavailable('Origin is not a supported github.com repository URL');

    stage = 'live master lookup';
    const master = capture('git', ['ls-remote', '--heads', 'origin', 'refs/heads/master']).trim();
    if (master !== `${sourceCommit}\trefs/heads/master`) return unavailable('Live origin/master does not match the source commit');

    const api = endpoint => JSON.parse(capture('gh', ['api', '--hostname', 'github.com', endpoint]));
    stage = 'latest master CI lookup';
    // Never filter by conclusion: an older green run cannot replace the latest failed/in-progress run.
    const response = api(`repos/${repository}/actions/workflows/ci.yml/runs?branch=master&event=push&head_sha=${sourceCommit}&per_page=1`);
    if (!positiveInteger(response?.total_count) || !Array.isArray(response.workflow_runs) || response.workflow_runs.length !== 1) {
      return unavailable('No unambiguous latest master CI run is available');
    }
    const run = response.workflow_runs[0];
    if (!matchesRunIdentity(run, repository, sourceCommit)) {
      return unavailable('Latest CI run identity does not match this repository and master source');
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      return unavailable('Latest master CI run has not completed successfully');
    }

    stage = 'CI attempt jobs lookup';
    const jobsResponse = api(`repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
    if (!positiveInteger(jobsResponse?.total_count) || jobsResponse.total_count > 100
      || !Array.isArray(jobsResponse.jobs) || jobsResponse.jobs.length !== jobsResponse.total_count) {
      return unavailable('CI attempt jobs are missing, truncated, or malformed');
    }
    const validationJobs = jobsResponse.jobs.filter(job => job?.name === 'validate');
    if (validationJobs.length !== 1) return unavailable('CI attempt has no unique validate job');
    const job = validationJobs[0];
    // GitHub's job schema may omit run_attempt; the endpoint above binds the attempt.
    if (job.run_id !== run.id || (job.run_attempt !== undefined && job.run_attempt !== run.run_attempt) || job.head_sha !== sourceCommit
      || job.status !== 'completed' || job.conclusion !== 'success' || !Array.isArray(job.steps)) {
      return unavailable('Validate job does not prove successful validation of the selected CI attempt');
    }
    for (const name of REQUIRED_STEPS) {
      const steps = job.steps.filter(step => step?.name === name);
      if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') {
        return unavailable(`Validate job did not successfully execute the required ${name} step`);
      }
    }
    stage = 'CI run stability lookup';
    const currentRun = api(`repos/${repository}/actions/runs/${run.id}`);
    if (!matchesRunIdentity(currentRun, repository, sourceCommit)
      || currentRun.id !== run.id || currentRun.run_attempt !== run.run_attempt
      || currentRun.status !== 'completed' || currentRun.conclusion !== 'success') {
      return unavailable('CI run changed while its validation evidence was being checked');
    }
    return { verified: true, runId: run.id, url: `https://github.com/${repository}/actions/runs/${run.id}`, sourceCommit };
  } catch {
    // Do not echo command errors: remote URLs or CLI diagnostics can contain credentials.
    return unavailable(`Could not verify ${stage}`);
  }
}
