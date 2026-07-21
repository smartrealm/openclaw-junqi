export class GitHubApiBaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitHubApiBaseError';
    this.code = 'INVALID_API_BASE';
  }
}

const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_USER_AGENT = 'junqi-release-transaction/1';

export function githubApiHeaders(token) {
  if (typeof token !== 'string'
    || token.length === 0
    || token.trim() !== token
    || /[\u0000-\u001f\u007f]/.test(token)) {
    throw new TypeError('GitHub token must be a non-empty single-line string');
  }
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': GITHUB_USER_AGENT,
    'x-github-api-version': GITHUB_API_VERSION,
  };
}

export function normalizeGitHubApiBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new GitHubApiBaseError('GITHUB_API_URL must be an absolute URL');
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname
    || parsed.pathname.includes('\\')) {
    throw new GitHubApiBaseError(
      'GITHUB_API_URL must be a credential-free HTTPS API base without query parameters or fragments',
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}
