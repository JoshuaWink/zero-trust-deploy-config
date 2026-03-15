/**
 * ztdc-github-oauth — Cloudflare Worker (Full API Gateway)
 *
 * Routes:
 *   POST /               — Legacy GitHub OAuth (backward compat)
 *   POST /auth/github    — GitHub OAuth code exchange
 *   POST /auth/token     — Get session token from OAuth identity
 *   POST /api/v1/validate — Validate profile against contract
 *   POST /api/v1/export   — Export profile in any format
 *   GET  /api/v1/profiles — List profiles (auth required)
 *   POST /api/v1/profiles — Create profile (auth required)
 *   GET  /api/v1/profiles/:id — Get profile (auth required)
 *   PUT  /api/v1/profiles/:id — Update profile (auth required)
 *   DELETE /api/v1/profiles/:id — Delete profile (auth required)
 *   GET  /health          — Health check
 */

const GH_PAGES_BASE = "https://joshuawink.github.io/zero-trust-deploy-config";

// ═══════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://joshuawink.github.io";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

    const err = (msg, status = 400, details = null) =>
      json({ error: msg, ...(details ? { details } : {}) }, status);

    try {
      // Auth
      if (path === "/" && method === "POST") return handleGitHubAuth(request, env, json, err);
      if (path === "/auth/github" && method === "POST") return handleGitHubAuth(request, env, json, err);
      if (path === "/auth/token" && method === "POST") return handleTokenIssue(request, env, json, err);

      // Validate & Export
      if (path === "/api/v1/validate" && method === "POST") return handleValidate(request, env, json, err);
      if (path === "/api/v1/export" && method === "POST") return handleExport(request, env, json, err);

      // Profiles CRUD
      if (path === "/api/v1/profiles" && method === "GET") return handleListProfiles(request, env, json, err);
      if (path === "/api/v1/profiles" && method === "POST") return handleCreateProfile(request, env, json, err);
      const profileMatch = path.match(/^\/api\/v1\/profiles\/([^/]+)$/);
      if (profileMatch && method === "GET") return handleGetProfile(request, env, json, err, profileMatch[1]);
      if (profileMatch && method === "PUT") return handleUpdateProfile(request, env, json, err, profileMatch[1]);
      if (profileMatch && method === "DELETE") return handleDeleteProfile(request, env, json, err, profileMatch[1]);

      // Contracts (convenience proxy to GH Pages static JSON)
      if (path === "/api/v1/contracts" && method === "GET") return proxyGHPages("/contracts/index.json", json, err);
      const contractMatch = path.match(/^\/api\/v1\/contracts\/([^/]+)$/);
      if (contractMatch && method === "GET") return proxyGHPages("/contracts/" + contractMatch[1] + ".json", json, err);

      // Recipes (community — proxy to GH Pages)
      if (path === "/api/v1/recipes" && method === "GET") return proxyGHPages("/recipes/index.json", json, err);
      if (path === "/api/v1/recipes/validate" && method === "POST") return handleValidateRecipe(request, env, json, err);
      if (path === "/api/v1/recipes/fork" && method === "POST") return handleForkRecipe(request, env, json, err);
      if (path === "/api/v1/recipes/generate-profiles" && method === "POST") return handleGenerateProfiles(request, env, json, err);

      // Custom Recipes CRUD (KV)
      if (path === "/api/v1/recipes/custom" && method === "GET") return handleListCustomRecipes(request, env, json, err);
      if (path === "/api/v1/recipes/custom" && method === "POST") return handleCreateCustomRecipe(request, env, json, err);
      const customRecipeMatch = path.match(/^\/api\/v1\/recipes\/custom\/([^/]+)$/);
      if (customRecipeMatch && method === "GET") return handleGetCustomRecipe(request, env, json, err, customRecipeMatch[1]);
      if (customRecipeMatch && method === "PUT") return handleUpdateCustomRecipe(request, env, json, err, customRecipeMatch[1]);
      if (customRecipeMatch && method === "DELETE") return handleDeleteCustomRecipe(request, env, json, err, customRecipeMatch[1]);

      // Community recipe detail (proxy)
      const recipeMatch = path.match(/^\/api\/v1\/recipes\/([^/]+)$/);
      if (recipeMatch && method === "GET") return proxyGHPages("/recipes/" + recipeMatch[1] + ".json", json, err);

      // Demos
      if (path === "/api/v1/demos" && method === "GET") return handleGetDemos(json);

      // Export formats list
      if (path === "/api/v1/export/formats" && method === "GET") return json({ formats: EXPORT_FORMATS });

      // Health
      if (path === "/health") return json({ status: "ok", version: "0.4.0", endpoints: ["/auth/github", "/auth/token", "/api/v1/contracts", "/api/v1/recipes", "/api/v1/recipes/custom", "/api/v1/recipes/validate", "/api/v1/recipes/fork", "/api/v1/recipes/generate-profiles", "/api/v1/validate", "/api/v1/export", "/api/v1/export/formats", "/api/v1/profiles", "/api/v1/demos"] });

      return err("Not found — see https://joshuawink.github.io/zero-trust-deploy-config/agents.txt", 404);

    } catch (e) {
      return err("Internal error: " + e.message, 500);
    }
  },
};

// ═══════════════════════════════════════════════════════════
// AUTH: GitHub OAuth code exchange
// ═══════════════════════════════════════════════════════════

async function handleGitHubAuth(request, env, json, err) {
  const body = await request.json().catch(() => null);
  if (!body || !body.code) return err("Missing 'code' parameter");

  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code: body.code,
    }),
  });

  const tokenData = await tokenResp.json();
  if (tokenData.error) return err(tokenData.error_description || tokenData.error);

  const accessToken = tokenData.access_token;
  if (!accessToken) return err("No access_token in GitHub response", 502);

  const userResp = await fetch("https://api.github.com/user", {
    headers: {
      "Authorization": "Bearer " + accessToken,
      "Accept": "application/vnd.github+json",
      "User-Agent": "ztdc-api/0.3.0",
    },
  });

  if (!userResp.ok) return err("GitHub /user returned " + userResp.status, 502);
  const user = await userResp.json();

  return json({
    user_id: user.id,
    login: user.login,
    name: user.name || user.login,
    avatar_url: user.avatar_url,
  });
}

// ═══════════════════════════════════════════════════════════
// AUTH: Issue / verify session tokens (HMAC JWT)
// ═══════════════════════════════════════════════════════════

async function handleTokenIssue(request, env, json, err) {
  const body = await request.json().catch(() => null);
  if (!body || !body.provider || !body.user_id) return err("Missing provider or user_id");

  const payload = {
    sub: String(body.user_id),
    provider: body.provider,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  };

  const token = await signToken(payload, env.TOKEN_SECRET || "dev-secret");
  return json({ token, expires_in: 86400 });
}

function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(header + "." + body));
  const sigB64 = b64url(String.fromCharCode(...new Uint8Array(sig)));
  return header + "." + body + "." + sigB64;
}

async function verifyToken(token, secret) {
  const parts = token.replace("Bearer ", "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBuf = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(header + "." + body));
  if (!valid) return null;
  const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return verifyToken(authHeader, env.TOKEN_SECRET || "dev-secret");
}

// ═══════════════════════════════════════════════════════════
// VALIDATE — check profile against platform contract
// ═══════════════════════════════════════════════════════════

async function handleValidate(request, env, json, err) {
  const body = await request.json().catch(() => null);
  if (!body || !body.platform) return err("Missing 'platform'");
  if (!body.vars || !Array.isArray(body.vars)) return err("Missing 'vars' array");

  const contractResp = await fetch(GH_PAGES_BASE + "/contracts/" + body.platform + ".json");
  if (!contractResp.ok) return err("Unknown platform '" + body.platform + "'", 404);
  const raw = await contractResp.json();

  const c = {
    required_vars: raw.required_vars || [],
    naming_pattern: (raw.naming || {}).pattern || "^[a-zA-Z_][a-zA-Z0-9_]*$",
    naming_description: (raw.naming || {}).description || "",
    forbidden_prefixes: (raw.naming || {}).forbidden_prefixes || [],
    key_max_length: (raw.limits || {}).key_max_length || null,
    max_vars: (raw.limits || {}).max_vars || null,
    max_total_size: (raw.limits || {}).max_total_size || null,
  };

  const issues = [];
  const rules = [];

  rules.push("required-vars");
  for (const req of c.required_vars) {
    if (!body.vars.some(v => v.key === req)) {
      issues.push({ rule: "required-vars", sev: "error", key: req, msg: "Required variable '" + req + "' is missing." });
    }
  }

  rules.push("naming-convention");
  let rx;
  try { rx = new RegExp(c.naming_pattern); } catch { rx = null; }
  for (const v of body.vars) {
    if (rx && !rx.test(v.key)) {
      issues.push({ rule: "naming", sev: "error", key: v.key, msg: "'" + v.key + "' violates naming rule: " + (c.naming_description || c.naming_pattern) });
    }
    for (const p of c.forbidden_prefixes) {
      if (v.key.startsWith(p)) {
        issues.push({ rule: "naming", sev: "error", key: v.key, msg: "'" + v.key + "' uses reserved prefix '" + p + "'." });
      }
    }
  }

  rules.push("duplicate-keys");
  const seen = {};
  for (const v of body.vars) {
    if (seen[v.key]) issues.push({ rule: "duplicates", sev: "error", key: v.key, msg: "Duplicate key '" + v.key + "'." });
    seen[v.key] = true;
  }

  rules.push("platform-limits");
  if (c.max_vars && body.vars.length > c.max_vars) {
    issues.push({ rule: "limits", sev: "error", key: "", msg: body.vars.length + " vars exceeds limit of " + c.max_vars + "." });
  }
  for (const v of body.vars) {
    if (c.key_max_length && v.key.length > c.key_max_length) {
      issues.push({ rule: "limits", sev: "error", key: v.key, msg: "Key length (" + v.key.length + ") exceeds max (" + c.key_max_length + ")." });
    }
  }

  const errs = issues.filter(i => i.sev === "error").length;
  const warns = issues.filter(i => i.sev === "warning").length;

  return json({
    valid: errs === 0,
    errors: errs,
    warnings: warns,
    issues,
    rules_checked: rules,
    platform: raw.name || body.platform,
  });
}

// ═══════════════════════════════════════════════════════════
// EXPORT — format profile for any platform
// ═══════════════════════════════════════════════════════════

async function handleExport(request, env, json, err) {
  const body = await request.json().catch(() => null);
  if (!body || !body.platform) return err("Missing 'platform'");
  if (!body.vars || !Array.isArray(body.vars)) return err("Missing 'vars' array");
  if (!body.format) return err("Missing 'format'");
  if (!body.name) return err("Missing 'name'");

  const profile = {
    id: (body.name || "profile").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    name: body.name,
    platform: body.platform,
    environment: body.environment || "production",
    vars: [...body.vars].sort((a, b) => (a.key || "").localeCompare(b.key || "")),
  };

  const fmts = {
    "env": fmtEnv, "env-file": fmtEnv,
    "docker-compose": fmtDC, "docker-compose-yaml": fmtDC,
    "github-actions": fmtGA, "github-actions-yaml": fmtGA,
    "k8s-configmap": fmtK8sCM, "k8s-configmap-yaml": fmtK8sCM,
    "k8s-secret": fmtK8sS, "k8s-secret-yaml": fmtK8sS,
    "ecs": fmtEcs, "ecs-task-def-json": fmtEcs,
    "lambda": fmtLambda, "lambda-env-json": fmtLambda,
    "heroku": fmtHeroku, "heroku-json": fmtHeroku,
    "fly-toml": fmtFly,
    "railway": fmtRailway, "railway-json": fmtRailway,
    "render": fmtRender, "render-yaml": fmtRender,
    "netlify": fmtNetlify, "netlify-toml": fmtNetlify,
    "terraform": fmtTF, "terraform-tfvars": fmtTF,
    "circleci": fmtCircle, "circleci-yaml": fmtCircle,
    "gitlab-ci": fmtGitlab, "gitlab-ci-yaml": fmtGitlab,
    "wrangler": fmtWrangler, "cloudflare-wrangler-toml": fmtWrangler,
    "nomad": fmtNomad, "nomad-hcl": fmtNomad,
  };

  const fn = fmts[body.format];
  if (!fn) {
    const available = [...new Set(Object.keys(fmts).filter(k => !k.includes("-") || k === "fly-toml" || k === "gitlab-ci"))];
    return err("Unknown format '" + body.format + "'. Available: " + available.join(", "));
  }

  const content = fn(profile);
  const exts = {
    env: ".env", "docker-compose": ".yaml", "github-actions": ".yaml",
    "k8s-configmap": ".yaml", "k8s-secret": ".yaml", ecs: ".json",
    lambda: ".json", heroku: ".json", "fly-toml": ".toml", railway: ".json",
    render: ".yaml", netlify: ".toml", terraform: ".tfvars",
    circleci: ".yaml", "gitlab-ci": ".yaml", wrangler: ".toml", nomad: ".hcl",
  };
  const ext = exts[body.format] || exts[body.format.split("-")[0]] || ".txt";

  return json({ format: body.format, content, filename: profile.id + ext });
}

function ref(v) {
  if (v.secret_ref) return "ref:" + v.secret_ref.backend + ":" + v.secret_ref.path + (v.secret_ref.version ? "@" + v.secret_ref.version : "");
  return v.value || "";
}

function fmtEnv(p) {
  return ["# Profile: " + p.name + " (" + p.platform + ")", "# Environment: " + p.environment, ""].concat(p.vars.map(v => v.key + "=" + ref(v))).join("\n") + "\n";
}
function fmtDC(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "services:", "  " + p.id + ":", "    environment:"].concat(p.vars.map(v => "      - " + v.key + "=${{ " + v.key + " }}")).concat(["", "    env_file:", "      - .env." + p.environment]).join("\n") + "\n";
}
function fmtGA(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "env:"].concat(p.vars.map(v => "  " + v.key + ": ${{ secrets." + v.key + " }}")).join("\n") + "\n";
}
function fmtK8sCM(p) {
  return ["apiVersion: v1", "kind: ConfigMap", "metadata:", "  name: " + p.id + "-config", "data:"].concat(p.vars.map(v => '  ' + v.key + ': "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtK8sS(p) {
  return ["apiVersion: v1", "kind: Secret", "metadata:", "  name: " + p.id + "-secrets", "type: Opaque", "stringData:"].concat(p.vars.map(v => '  ' + v.key + ': "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtEcs(p) {
  const env = [], sec = [];
  p.vars.forEach(v => {
    const b = v.secret_ref ? v.secret_ref.backend : "";
    if (["aws-ssm","aws-secrets-manager"].includes(b)) sec.push({name:v.key,valueFrom:v.secret_ref.path});
    else env.push({name:v.key,value:ref(v)});
  });
  return JSON.stringify({_comment:"Profile: "+p.id,environment:env,secrets:sec},null,2)+"\n";
}
function fmtLambda(p) {
  const v = {}; p.vars.forEach(x => v[x.key]=ref(x));
  return JSON.stringify({_comment:"Profile: "+p.id,Variables:v},null,2)+"\n";
}
function fmtHeroku(p) {
  const v = {}; p.vars.forEach(x => v[x.key]=ref(x));
  return JSON.stringify({_comment:"Profile: "+p.id,config:v},null,2)+"\n";
}
function fmtFly(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "", "[env]"].concat(p.vars.map(v => '  ' + v.key + ' = "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtRailway(p) {
  const v = {}; p.vars.forEach(x => v[x.key]=ref(x));
  return JSON.stringify({_comment:"Profile: "+p.id,variables:v},null,2)+"\n";
}
function fmtRender(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "", "envVars:"].concat(p.vars.flatMap(v => ["  - key: " + v.key, '    value: "' + ref(v) + '"'])).join("\n") + "\n";
}
function fmtNetlify(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "", "[context.production.environment]"].concat(p.vars.map(v => '  ' + v.key + ' = "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtTF(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, ""].concat(p.vars.map(v => v.key.replace(/^TF_VAR_/,"") + ' = "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtCircle(p) {
  return ["# Generated by ZTDC", "version: 2.1", "", "jobs:", "  deploy:", "    environment:"].concat(p.vars.map(v => "      " + v.key + ": ${{ " + v.key + " }}")).join("\n") + "\n";
}
function fmtGitlab(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "", "variables:"].concat(p.vars.map(v => '  ' + v.key + ': "$' + v.key + '"')).join("\n") + "\n";
}
function fmtWrangler(p) {
  return ["# Generated by ZTDC", "# Profile: " + p.name, "", "[vars]"].concat(p.vars.map(v => v.key + ' = "' + ref(v) + '"')).join("\n") + "\n";
}
function fmtNomad(p) {
  return ["# Generated by ZTDC", "", 'job "' + p.id + '" {', '  group "app" {', '    task "service" {', "      env {"].concat(p.vars.map(v => '        ' + v.key + ' = "' + ref(v) + '"')).concat(["      }","    }","  }","}"]).join("\n") + "\n";
}

// ═══════════════════════════════════════════════════════════
// PROFILES CRUD (KV-backed)
// ═══════════════════════════════════════════════════════════

async function handleListProfiles(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured — KV binding 'ZTDC_KV' missing", 503);
  const data = await kv.get("profiles:" + user.sub, "json");
  return json(data || {});
}

async function handleCreateProfile(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const body = await request.json().catch(() => null);
  if (!body || !body.name || !body.platform) return err("Missing name or platform");
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "profiles:" + user.sub;
  const profiles = (await kv.get(key, "json")) || {};
  const id = crypto.randomUUID();
  profiles[id] = { id, name: body.name, platform: body.platform, environment: body.environment || "production", vars: body.vars || [], created: new Date().toISOString(), updated: new Date().toISOString() };
  await kv.put(key, JSON.stringify(profiles));
  return json(profiles[id], 201);
}

async function handleGetProfile(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const profiles = (await kv.get("profiles:" + user.sub, "json")) || {};
  if (!profiles[id]) return err("Profile not found", 404);
  return json(profiles[id]);
}

async function handleUpdateProfile(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const body = await request.json().catch(() => null);
  if (!body) return err("Missing body");
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "profiles:" + user.sub;
  const profiles = (await kv.get(key, "json")) || {};
  if (!profiles[id]) return err("Profile not found", 404);
  profiles[id] = { ...profiles[id], ...body, id, updated: new Date().toISOString() };
  await kv.put(key, JSON.stringify(profiles));
  return json(profiles[id]);
}

async function handleDeleteProfile(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "profiles:" + user.sub;
  const profiles = (await kv.get(key, "json")) || {};
  if (!profiles[id]) return err("Profile not found", 404);
  delete profiles[id];
  await kv.put(key, JSON.stringify(profiles));
  return json({ deleted: true, id });
}


// ═══════════════════════════════════════════════════════════
// GH PAGES PROXY — convenience pass-through for static JSON
// ═══════════════════════════════════════════════════════════

async function proxyGHPages(path, json, err) {
  const resp = await fetch(GH_PAGES_BASE + path);
  if (!resp.ok) return err("Not found: " + path, 404);
  const data = await resp.json();
  return json(data);
}

// ═══════════════════════════════════════════════════════════
// EXPORT FORMATS LIST
// ═══════════════════════════════════════════════════════════

const EXPORT_FORMATS = [
  "env", "docker-compose", "github-actions", "k8s-configmap", "k8s-secret",
  "ecs", "lambda", "heroku", "fly-toml", "railway", "render", "netlify",
  "terraform", "circleci", "gitlab-ci", "wrangler", "nomad"
];

// ═══════════════════════════════════════════════════════════
// RECIPE VALIDATION
// ═══════════════════════════════════════════════════════════

const VALID_CATEGORIES = new Set(["fullstack", "api", "frontend", "data-pipeline", "edge", "microservices"]);
const VALID_COMPLEXITIES = new Set(["starter", "intermediate", "advanced"]);
const VALID_ROLES = new Set(["build", "ci", "deploy", "secrets", "routing", "monitoring", "storage", "iac", "cdn"]);

async function handleValidateRecipe(request, env, json, err) {
  const raw = await request.json().catch(() => null);
  if (!raw) return err("Invalid JSON body");

  const errors = [];
  const warnings = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return json({ valid: false, errors: ["Input must be a JSON object"], warnings: [] });
  }

  for (const f of ["id", "name", "description", "category", "steps"]) {
    if (!(f in raw)) errors.push("Missing required field: " + f);
  }

  const cid = raw.id || "";
  if (cid && !/^[a-z][a-z0-9-]*$/.test(cid)) {
    errors.push("Invalid id format: '" + cid + "' — must be lowercase kebab-case");
  }

  if (raw.category && !VALID_CATEGORIES.has(raw.category)) {
    errors.push("Invalid category: '" + raw.category + "'. Valid: " + [...VALID_CATEGORIES].join(", "));
  }

  if (raw.complexity && !VALID_COMPLEXITIES.has(raw.complexity)) {
    errors.push("Invalid complexity: '" + raw.complexity + "'. Valid: " + [...VALID_COMPLEXITIES].join(", "));
  }

  // Fetch known platforms for warnings
  let knownPlatforms = new Set();
  try {
    const idx = await fetch(GH_PAGES_BASE + "/contracts/index.json");
    if (idx.ok) { const d = await idx.json(); knownPlatforms = new Set(d.contracts || []); }
  } catch {}

  const steps = raw.steps;
  if (steps !== undefined) {
    if (!Array.isArray(steps)) {
      errors.push("'steps' must be an array");
      return json({ valid: errors.length === 0, errors, warnings });
    }
    if (steps.length === 0) errors.push("'steps' must not be empty");

    const stepIds = new Set();
    const allIds = new Set(steps.filter(s => s && s.id).map(s => s.id));

    steps.forEach((step, i) => {
      const p = "Step " + (i + 1);
      if (typeof step !== "object" || step === null) { errors.push(p + ": must be an object"); return; }

      for (const sf of ["id", "platform", "role"]) {
        if (!(sf in step)) errors.push(p + ": missing '" + sf + "'");
      }

      if (step.id && stepIds.has(step.id)) errors.push(p + ": duplicate step id '" + step.id + "'");
      if (step.id) stepIds.add(step.id);

      if (step.role && !VALID_ROLES.has(step.role)) {
        errors.push(p + ": invalid role '" + step.role + "'. Valid: " + [...VALID_ROLES].join(", "));
      }

      if (step.platform && knownPlatforms.size > 0 && !knownPlatforms.has(step.platform)) {
        warnings.push(p + ": platform '" + step.platform + "' is not in the contract catalog");
      }

      (step.depends_on || []).forEach(dep => {
        if (!allIds.has(dep)) errors.push(p + ": depends_on references '" + dep + "' which doesn't exist");
      });

      (step.shared_vars || []).forEach((sv, vi) => {
        if (typeof sv !== "object") return;
        if (!sv.key || !sv.key.trim()) errors.push(p + ", var " + (vi+1) + ": key must not be blank");
        if (!("description" in sv)) errors.push(p + ", var " + (vi+1) + ": missing 'description'");
      });
    });
  }

  return json({ valid: errors.length === 0, errors, warnings });
}

// ═══════════════════════════════════════════════════════════
// RECIPE FORK
// ═══════════════════════════════════════════════════════════

async function handleForkRecipe(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);

  const body = await request.json().catch(() => null);
  if (!body || !body.recipe_id) return err("Missing recipe_id");

  // Fetch the community recipe
  const resp = await fetch(GH_PAGES_BASE + "/recipes/" + body.recipe_id + ".json");
  if (!resp.ok) return err("Recipe '" + body.recipe_id + "' not found", 404);
  const src = await resp.json();

  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);

  const key = "recipes:" + user.sub;
  const customs = (await kv.get(key, "json")) || {};

  // Generate unique forked ID
  let fid = src.id + "-custom";
  let n = 1;
  while (customs[fid]) { fid = src.id + "-custom-" + (++n); }

  const forked = JSON.parse(JSON.stringify(src));
  forked.id = fid;
  forked.name = src.name + " (My Fork)";
  forked.forked_from = src.id;
  forked.created = new Date().toISOString();

  customs[fid] = forked;
  await kv.put(key, JSON.stringify(customs));

  return json(forked, 201);
}

// ═══════════════════════════════════════════════════════════
// GENERATE PROFILES FROM RECIPE
// ═══════════════════════════════════════════════════════════

async function handleGenerateProfiles(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);

  const body = await request.json().catch(() => null);
  if (!body || !body.recipe_id) return err("Missing recipe_id");

  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);

  // Try custom recipes first, then community
  const customKey = "recipes:" + user.sub;
  const customs = (await kv.get(customKey, "json")) || {};
  let recipe = customs[body.recipe_id];

  if (!recipe) {
    const resp = await fetch(GH_PAGES_BASE + "/recipes/" + body.recipe_id + ".json");
    if (!resp.ok) return err("Recipe '" + body.recipe_id + "' not found", 404);
    recipe = await resp.json();
  }

  // Fetch contract index for platform validation
  let contractIndex = [];
  try {
    const idx = await fetch(GH_PAGES_BASE + "/contracts/index.json");
    if (idx.ok) { const d = await idx.json(); contractIndex = d.contracts || []; }
  } catch {}
  const knownPlatforms = new Set(contractIndex);

  const profilesKey = "profiles:" + user.sub;
  const profiles = (await kv.get(profilesKey, "json")) || {};

  let created = 0;
  const skippedSteps = [];
  const generatedIds = [];

  for (const step of (recipe.steps || [])) {
    const pid = recipe.id + "-" + step.id;
    if (profiles[pid]) { continue; } // already exists

    if (!knownPlatforms.has(step.platform)) {
      skippedSteps.push({ platform: step.platform, step_id: step.id, label: step.label || step.id });
      continue;
    }

    // Fetch the contract to get default backends
    let contract = {};
    try {
      const cResp = await fetch(GH_PAGES_BASE + "/contracts/" + step.platform + ".json");
      if (cResp.ok) contract = await cResp.json();
    } catch {}

    const vars = (step.shared_vars || []).map(v => ({
      key: v.key,
      description: v.description || "",
      required: v.required || false,
      secret_ref: {
        backend: v.suggested_backend || (contract.secret_backends || [])[0] || "env-file",
        path: v.suggested_path || v.key.toLowerCase(),
        version: null
      }
    }));

    profiles[pid] = {
      id: pid,
      name: recipe.name + " \u2014 " + (step.label || step.id),
      platform: step.platform,
      environment: body.environment || "production",
      vars: vars,
      metadata: { recipe: recipe.id, step: step.id },
      created: new Date().toISOString(),
    };
    created++;
    generatedIds.push(pid);
  }

  await kv.put(profilesKey, JSON.stringify(profiles));

  return json({
    created,
    profile_ids: generatedIds,
    skipped_steps: skippedSteps,
    total_profiles: Object.keys(profiles).length,
  });
}

// ═══════════════════════════════════════════════════════════
// CUSTOM RECIPES CRUD (KV-backed)
// ═══════════════════════════════════════════════════════════

async function handleListCustomRecipes(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const data = await kv.get("recipes:" + user.sub, "json");
  return json(data || {});
}

async function handleCreateCustomRecipe(request, env, json, err) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.name) return err("Missing id or name");
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "recipes:" + user.sub;
  const recipes = (await kv.get(key, "json")) || {};
  if (recipes[body.id]) return err("Recipe with id '" + body.id + "' already exists", 409);
  const recipe = { ...body, created: new Date().toISOString(), updated: new Date().toISOString() };
  recipes[body.id] = recipe;
  await kv.put(key, JSON.stringify(recipes));
  return json(recipe, 201);
}

async function handleGetCustomRecipe(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const recipes = (await kv.get("recipes:" + user.sub, "json")) || {};
  if (!recipes[id]) return err("Custom recipe not found", 404);
  return json(recipes[id]);
}

async function handleUpdateCustomRecipe(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const body = await request.json().catch(() => null);
  if (!body) return err("Missing body");
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "recipes:" + user.sub;
  const recipes = (await kv.get(key, "json")) || {};
  if (!recipes[id]) return err("Custom recipe not found", 404);
  recipes[id] = { ...recipes[id], ...body, id, updated: new Date().toISOString() };
  await kv.put(key, JSON.stringify(recipes));
  return json(recipes[id]);
}

async function handleDeleteCustomRecipe(request, env, json, err, id) {
  const user = await requireAuth(request, env);
  if (!user) return err("Authentication required", 401);
  const kv = env.ZTDC_KV;
  if (!kv) return err("Storage not configured", 503);
  const key = "recipes:" + user.sub;
  const recipes = (await kv.get(key, "json")) || {};
  if (!recipes[id]) return err("Custom recipe not found", 404);
  delete recipes[id];
  await kv.put(key, JSON.stringify(recipes));
  return json({ deleted: true, id });
}

// ═══════════════════════════════════════════════════════════
// DEMO PROFILES
// ═══════════════════════════════════════════════════════════

const DEMOS = {
  "saas-api-prod": { id: "saas-api-prod", name: "SaaS API \u2014 Production", platform: "kubernetes", environment: "production", vars: [{ key: "DATABASE_URL", secret_ref: { backend: "hashicorp-vault", path: "secret/prod/postgres-url", version: null }, description: "Primary Postgres", required: true }, { key: "REDIS_URL", secret_ref: { backend: "hashicorp-vault", path: "secret/prod/redis-url", version: null }, description: "Redis cache", required: true }, { key: "JWT_SECRET", secret_ref: { backend: "hashicorp-vault", path: "secret/prod/jwt-key", version: null }, description: "JWT signing key", required: true }], metadata: { demo: true } },
  "startup-frontend": { id: "startup-frontend", name: "Startup Frontend \u2014 Vercel", platform: "vercel", environment: "production", vars: [{ key: "NEXT_PUBLIC_API_URL", secret_ref: { backend: "vercel-secrets", path: "api-url-prod", version: null }, description: "Public API endpoint", required: true }, { key: "DATABASE_URL", secret_ref: { backend: "vercel-secrets", path: "neon-db-prod", version: null }, description: "Neon Postgres", required: true }], metadata: { demo: true } },
  "broken-deploy": { id: "broken-deploy", name: "\u26a0\ufe0f Broken Deploy (Errors)", platform: "github-actions", environment: "staging", vars: [{ key: "GITHUB_INTERNAL_TOKEN", secret_ref: { backend: "github-secrets", path: "internal-token", version: null }, description: "Reserved prefix", required: true }, { key: "db url", secret_ref: { backend: "github-secrets", path: "db-url", version: null }, description: "Spaces in key", required: true }, { key: "API_KEY", secret_ref: { backend: "github-secrets", path: "duplicate", version: null }, description: "Duplicate", required: false }, { key: "API_KEY", secret_ref: { backend: "github-secrets", path: "dup2", version: null }, description: "Duplicate", required: false }], metadata: { demo: true } },
};

function handleGetDemos(json) {
  return json(DEMOS);
}
