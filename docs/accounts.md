# Accounts

Charts signs in to nothing. It has no provider, no integration, no MCP server and no credentials, so its manifest
declares no `accounts`, every method is `accounts: "none"`, and there is no `probe`. Status reports the empty account
list the contract defines for such a plugin.

Nothing to configure, nothing to sign in to, and no account selector on any call.
