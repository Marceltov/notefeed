# OAuth

Clients that can't send a header, such as the Claude.ai and Claude Desktop connectors for [MCP](../integrations/mcp.md), log in through notefeed's own OAuth 2.1 login page with the instance password. It only exists on an instance with a password; on an open one these endpoints answer `404`.

- **`PUBLIC_URL` is the issuer.** Every OAuth URL is built from it, so set it, with `https://`, on an instance that connectors reach over the internet.
- **Nothing is stored.** Client ids, codes and tokens are signed with a key derived from the server secret and the password.
- **Lifetimes:** a code lasts 5 minutes and works once, an access token 1 hour, a refresh token 30 days and is replaced each time it's used. A client's registration doesn't expire.
- **Changing `NOTEFEED_PASSWORD` signs every client out:** all registrations, codes and tokens stop working, and each connector must log in again.
- **Restarts:** the record of used codes and refresh tokens is in memory. After a restart, a stolen code or refresh token could be used once more within its lifetime.
