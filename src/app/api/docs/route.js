import { apiHandler } from "@/lib/api";
import { assertDocsEnabled } from "@/server/docs/access";

/**
 * Swagger UI over the generated document.
 *
 * The viewer is loaded from a CDN at a pinned version rather than vendored:
 * swagger-ui-dist is ~3MB of assets that would otherwise sit in the repo and in
 * every deployment, to serve a page only developers open.
 *
 * `withCredentials` is on so "Try it out" sends the session cookie — the same
 * credential the website uses — which makes the authenticated endpoints
 * exercisable from here without pasting a token. `persistAuthorization` keeps a
 * pasted bearer token across reloads.
 */
const SWAGGER_VERSION = "5.29.0";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>FoodZone API</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
      .swagger-ui .info { margin: 24px 0; }
    </style>
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-standalone-preset.js" crossorigin></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/api/docs/openapi.json",
        dom_id: "#swagger",
        deepLinking: true,
        docExpansion: "none",
        filter: true,
        persistAuthorization: true,
        withCredentials: true,
        tryItOutEnabled: true,
        defaultModelsExpandDepth: 0,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: "BaseLayout",
      });
    </script>
  </body>
</html>
`;

export const GET = apiHandler({}, async () => {
  assertDocsEnabled();

  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
});
