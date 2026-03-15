/**
 * ztdc-github-oauth — Cloudflare Worker
 * 
 * Proxies the GitHub OAuth code → token exchange.
 * Keeps client_secret server-side (set via `wrangler secret put GITHUB_CLIENT_SECRET`).
 * 
 * Flow:
 *   1. SPA opens popup → github.com/login/oauth/authorize?client_id=...&redirect_uri=callback.html
 *   2. User authorizes → callback.html gets ?code=xxx → postMessage to parent
 *   3. Parent POSTs { code } to this worker
 *   4. Worker adds client_secret, exchanges code for access_token
 *   5. Worker calls api.github.com/user to get stable user ID
 *   6. Returns { user_id, login, name, avatar_url } to SPA (token is NEVER sent to browser)
 * 
 * Security:
 *   - client_secret never leaves the worker
 *   - access_token never leaves the worker — only the numeric user ID is returned
 *   - CORS locked to ALLOWED_ORIGIN
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://joshuawink.github.io";

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Only POST allowed
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Origin check
    if (origin !== allowedOrigin) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { code } = await request.json();
      if (!code) {
        return new Response(JSON.stringify({ error: "Missing 'code' parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 1: Exchange code for access_token (server-side — no CORS issue)
      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: code,
        }),
      });

      const tokenData = await tokenResp.json();

      if (tokenData.error) {
        return new Response(JSON.stringify({
          error: tokenData.error,
          error_description: tokenData.error_description || "Token exchange failed",
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "No access_token in GitHub response" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Step 2: Fetch user info (server-side — token never sent to browser)
      const userResp = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github+json",
          "User-Agent": "ztdc-github-oauth/1.0",
        },
      });

      if (!userResp.ok) {
        return new Response(JSON.stringify({ error: `GitHub /user returned ${userResp.status}` }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const user = await userResp.json();

      // Return ONLY identity info — no token, no secret
      return new Response(JSON.stringify({
        user_id: user.id,
        login: user.login,
        name: user.name || user.login,
        avatar_url: user.avatar_url,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: "Internal error", detail: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
