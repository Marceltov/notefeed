# Passwords and access

## The password

Set `NOTEFEED_PASSWORD` to lock the instance: posting then needs `Authorization: Bearer <password>`, and every page except the login page, the read-only views, the privacy (`/privacy`) and imprint (`/imprint`) pages and the app icons, web manifest and share image needs a login. Read links keep working without it, so feed readers need no change. Generate a long random password:

```sh
openssl rand -hex 32
```

There is one password for the whole instance. Changing it logs out every browser and breaks every script until you update them. Wrong passwords, over the API or on the login page, are rate-limited like posts.

!!! note "Logins don't expire"
    The login cookie is derived from the password alone and stays valid for a year. Logging out only removes it from that browser: a copied cookie keeps working until the password changes. If you think a cookie leaked, change `NOTEFEED_PASSWORD`.

## Sign-in

Optional, and off unless all four `NOTEFEED_OIDC_*` variables are set: notefeed stays private by default and stores nothing about a person. With them set, people sign in through your OpenID Connect provider and their notes carry a sender. You can configure several providers at once, see [Several providers](sign-in/providers.md#several-providers). Setup, what is stored and how to hide it are on [Sign-in and sender](sign-in/index.md). Sign-in alone locks the instance to signed-in people, and changing the password signs everyone out.
