# Sign-in providers

## Several providers

You can add as many providers as you like, for example one for your team and one for guests. Each provider is its own set of variables, with a name of your choosing in them: `NOTEFEED_OIDC_<NAME>_ISSUER` and so on. The single-provider setup above keeps working unchanged.

Nothing is predefined. `<NAME>` is any name you pick from capital letters, digits and underscores (`WORK`, `GUESTS`, `MY_IDP`), not a list of supported providers: notefeed finds your providers by looking for these variables. Authentik, Google and the others on this page are only examples of what you can connect.

| Variable | Meaning |
|---|---|
| `NOTEFEED_OIDC_<NAME>_ISSUER` | The provider's issuer URL. |
| `NOTEFEED_OIDC_<NAME>_CLIENT_ID` | The client id the provider gave notefeed. |
| `NOTEFEED_OIDC_<NAME>_CLIENT_SECRET` | The client secret the provider gave notefeed. |
| `NOTEFEED_OIDC_<NAME>_ALLOW` | Who may sign in through this provider, in the same form as `NOTEFEED_OIDC_ALLOW`. |
| `NOTEFEED_OIDC_<NAME>_SENDER_CLAIM` | Optional, default `name,email`, as `NOTEFEED_OIDC_SENDER_CLAIM`. |
| `NOTEFEED_OIDC_<NAME>_LABEL` | Optional. The text of the button: **Sign in with** plus this label. Without it the label is the provider's host. |

- A provider is active only when its issuer, client id, client secret and allow-list are all set. With one of them missing or the allow-list empty, that provider is left out and the others still work.
- The unprefixed variables (`NOTEFEED_OIDC_ISSUER` and the rest, with `NOTEFEED_OIDC_LABEL` for its label) are one more provider, called `default`. The name `DEFAULT` is therefore reserved and ignored.
- A name must be capital letters and digits, separated by single underscores. A name with a lowercase letter or a hyphen is not recognised.
- Every provider has its own allow-list and its own sender claim. Someone on one provider's list can't sign in through another provider unless that one lists them too.
- The login page shows one **Sign in with** button per provider: the default one first, then the others in alphabetical order of their names.
- All providers share one redirect URI, `<PUBLIC_URL>/api/oidc/callback`. Register that same URI at each provider.

This example has two providers, `WORK` and `GUESTS`. The names are only examples, pick your own:

```yaml
environment:
  PUBLIC_URL: https://notes.example.com
  NOTEFEED_SECRET: ${NOTEFEED_SECRET}
  NOTEFEED_OIDC_WORK_ISSUER: https://authentik.example.com/application/o/notefeed/
  NOTEFEED_OIDC_WORK_CLIENT_ID: ${NOTEFEED_OIDC_WORK_CLIENT_ID}
  NOTEFEED_OIDC_WORK_CLIENT_SECRET: ${NOTEFEED_OIDC_WORK_CLIENT_SECRET}
  NOTEFEED_OIDC_WORK_ALLOW: "@example.com"
  NOTEFEED_OIDC_WORK_LABEL: Example Corp
  NOTEFEED_OIDC_GUESTS_ISSUER: https://accounts.google.com
  NOTEFEED_OIDC_GUESTS_CLIENT_ID: ${NOTEFEED_OIDC_GUESTS_CLIENT_ID}
  NOTEFEED_OIDC_GUESTS_CLIENT_SECRET: ${NOTEFEED_OIDC_GUESTS_CLIENT_SECRET}
  NOTEFEED_OIDC_GUESTS_ALLOW: "guest@example.org"
  NOTEFEED_OIDC_GUESTS_SENDER_CLAIM: email
```

The login page then offers **Sign in with Example Corp** and **Sign in with accounts.google.com**.

## Other providers

This table lists examples only: notefeed has no built-in list, and any OpenID Connect provider works. These are the usual issuer URLs. Your provider's discovery document is the authority: open `<issuer>/.well-known/openid-configuration` and use its `issuer`.

| Provider | Issuer | Notes |
|---|---|---|
| Authentik | `https://authentik.example.com/application/o/<slug>/` | The document's issuer ends in a slash; setting it with or without one works. See the [example](setup.md#example-authentik). |
| Keycloak | `https://keycloak.example.com/realms/<realm>` | Older versions have `/auth` before `/realms`. Create an OpenID Connect client with **Client authentication** on and the standard flow enabled. |
| Authelia | `https://auth.example.com` | Set the client's `token_endpoint_auth_method` to `client_secret_post`; Authelia defaults to `client_secret_basic`. |
| Google | `https://accounts.google.com` | Create an OAuth client of type **Web application** and add the redirect URI. Use an address or domain allow-list, not `*`: `*` would let any Google account sign in. |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` | Register the redirect URI under the **Web** platform. Entra may leave `email` or `email_verified` out of the `id_token`; check yours. If it does, address and domain entries can't match, so restrict who may use the app in Entra and set `NOTEFEED_OIDC_ALLOW` to `*`, or use `preferred_username` as [`NOTEFEED_OIDC_SENDER_CLAIM`](setup.md#setup). |
