# Sign-in troubleshooting

## Troubleshooting

Every failed sign-in shows the same message, "Sign-in didn't work. Try again.", so start with the [logs](#sign-in-logs): the `oidc` line's `msg` names the cause, see [What the log says](#what-the-log-says). To tell an allow-list problem from a provider problem, set `NOTEFEED_OIDC_ALLOW` to `*` for a moment: if signing in then works, the allow-list was the cause.

| What you see | Likely cause |
|---|---|
| No **Sign in with** button on the login page | One of the four variables is unset or empty, or `NOTEFEED_OIDC_ALLOW` is empty. |
| A button is missing for one provider | One of that provider's four variables is missing, or its allow-list is empty. The other providers are not affected. |
| A named provider doesn't show at all | Its name isn't recognised: it has a lowercase letter or a hyphen. Use capital letters, digits and underscores, as in `NOTEFEED_OIDC_MY_IDP_ISSUER`. |
| The provider shows a redirect or `redirect_uri` error before you return | The registered redirect URI differs from `<PUBLIC_URL>/api/oidc/callback`: scheme, host, port, path or a trailing slash. Behind a proxy, `PUBLIC_URL` is not set. |
| Back on notefeed with "Sign-in didn't work" | The issuer differs from the discovery document's `issuer` in more than one trailing slash: another scheme, host, port or path. |
| The same | The provider can't be reached from the notefeed container (DNS, a firewall, a certificate it doesn't trust), or its URLs are plain `http`. |
| The same | The person isn't on the allow-list, or the provider doesn't report their e-mail address as verified. |
| The same | The `id_token` has none of the sender claims, which by default are `name` and `email`. Check the scopes and the provider's claim settings, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |
| The same | The client secret is wrong, or the provider expects `client_secret_basic` instead of `client_secret_post`. |
| The same | The sign-in took longer than 10 minutes, or the browser blocks cookies. Try again. |
| The same, after many tries | Failed sign-ins count toward the [rate limit](../limits.md#rate-limits-and-caps). Wait a minute. |
| Signed out after a while, or after changing the password | Expected: a sign-in lasts 7 days, and a changed `NOTEFEED_PASSWORD` or `NOTEFEED_SECRET` signs everyone out. |
| A note has no sender | It was posted with the instance password or by a script, which never carries a sender. |

### What the log says

| `msg` | Cause | Fix |
|---|---|---|
| `unknown provider` | The sign-in named a provider that isn't configured (`provider` shows its id when it has a provider id's shape), or none while several are. | Use the buttons on the login page; check the provider's four variables. |
| `issuer is not an https URL` | `NOTEFEED_OIDC_ISSUER` is not a URL, or plain `http` on a host other than `localhost`. | Set the issuer to the `https` URL from the discovery document. |
| `discovery failed` with `status` | The discovery document answered with that HTTP status, or with something other than JSON (`"status":200` and `"error":"not a JSON object"`). | Open `<issuer>/.well-known/openid-configuration`; a 404 usually means a wrong issuer path. |
| `discovery failed` with `error` | The provider can't be reached from the notefeed container: `ENOTFOUND` (DNS), `ECONNREFUSED` (nothing listening), `CERT_HAS_EXPIRED` or another certificate error, `TimeoutError` (no answer within 10 seconds). | Fix DNS, the firewall or the certificate between notefeed and the provider. |
| `issuer does not match the discovery document` | The configured issuer (`issuer`) and the document's (`document`) differ in more than one trailing slash. | Copy the document's `issuer` into `NOTEFEED_OIDC_ISSUER`. |
| `discovery endpoint is not https` | The document's authorize or token endpoint, named by `endpoint`, is missing or plain `http`. | Serve the provider over `https`, or set its external URL so its endpoints use it. |
| `provider denied the sign-in` | The provider sent the person back with an error, such as `"error":"access_denied"` when they declined or aren't allowed in the provider. | Check the provider's own policies and logs for that person. |
| `state mismatch or missing sign-in cookie` | The sign-in cookie is missing, expired (after 10 minutes) or from another sign-in, or the browser blocks cookies. | Try again from the login page in one tab. |
| `no code in the callback` | The provider came back without an authorization code. | Check that the provider's client uses the authorization code flow. |
| `provider no longer configured` | The provider was removed or switched off while the sign-in was under way. | Try again; check that provider's variables. |
| `token request rejected` with `"error":"invalid_client"` | The client id or secret is wrong, or the provider expects `client_secret_basic`. | Copy the client id and secret again; switch the client to `client_secret_post`. |
| `token request rejected` with another `error` or `status` | `invalid_grant` usually means the redirect URI or the PKCE verifier didn't match, or the code was used already; a network `error` means the token endpoint can't be reached. | Check the redirect URI and that the provider supports PKCE `S256`. |
| `token response has no id_token` | The token endpoint answered without an `id_token`. | Make sure the client requests the `openid` scope and is an OpenID Connect client, not plain OAuth 2. |
| `id_token invalid` with `check` | The `id_token` failed one check: `iss` (another issuer), `aud` (another client id), `azp` (several audiences without this client as `azp`), `exp` (expired: check the server clocks), `nonce` (not the one sent), `malformed` (not a readable JWT). | Fix what the named check points to; for `iss`, the provider's issuer setting. |
| `person not on the allow-list` | The person's verified address matches no entry of that provider's allow-list. | Add the address or its `@domain` to the allow-list, if they should get in. |
| `address needs a verified email` | The allow-list matches by address, but the `id_token` has no `email`, or `email_verified` isn't `true`. | Have the provider include `email` and `email_verified` and verify the address, or use `*` with access restricted at the provider. |
| `no sender claim in the id_token` | None of the claims named by `claims` is a non-empty string in the `id_token`. | Add the `profile` and `email` scopes or claims at the provider, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |
| `no sender claim in the id_token` | None of the claims named by `claims` is a non-empty string in the `id_token`. | Add the `profile` and `email` scopes or claims at the provider, or set `NOTEFEED_OIDC_SENDER_CLAIM`. |

## Sign-in logs

notefeed logs one line for each failed sign-in, at level `warn` with `"component":"oidc"`: the `msg` is the step that failed, and fields add, where it helps, the provider (`provider`), the issuer (`issuer`, without any user, password or query part), the HTTP status (`status`) or a short error code (`error`). It never logs a secret, token, e-mail address or name, and never echoes text from the request: the `unknown provider` line carries the requested provider id only when it looks like one (lowercase letters, digits and underscores). A sign-in refused because of [too many failed attempts](../limits.md#rate-limits-and-caps) is not logged, since that check comes first. A sign-in that works logs `sign-in succeeded` at level `info` with the provider id only, never who signed in. For example:

```json
{"level":"warn","time":"2026-10-02T09:14:03.512Z","component":"oidc","provider":"default","status":401,"error":"invalid_client","msg":"token request rejected"}
```

Read them with `docker compose logs notefeed`, or your container runtime's equivalent, for example `docker compose logs notefeed | grep '"component":"oidc"'`. See [Logs](../logs.md#logs) for the format and the other lines.
