# JWT authorization: certificate setup

Open **Org Manager → Add org (or Reauthorize) → Authorization method → JWT**.

If you already have a `.key` / `.pem` private key, choose it directly. Otherwise choose one of the two workflows below. Both prepare files locally; neither changes Salesforce automatically.

## Account records and the default org

The org list keeps one record per username and shows the CLI's current authorization method. Select **Reauthorize** to switch between **JWT** and **Browser OAuth**. A successful sign-in updates the same record and preserves the default org and linked local project. Saved JWT settings can prefill reauthorization; browser OAuth Consumer Secrets are not saved.

When adding an org, **Set as default org** is selected by default. Clear it before selecting **Sign in** to keep the previous default org. Reauthorization does not change the default org.

Select **Check sign-in status** on an org card to verify that account without refreshing the whole list. The status displays **Checking…** while running. Confirmed invalid authorization replaces the action with **Reauthorize**. Network failures display **Unreachable** and allow another check without declaring authorization expired.

## Workflow 1: generate locally

Use this when you need a new certificate and matching private key.

### 1. Generate files

1. Select **Generate certificate and key**.
2. Choose a recognizable Common Name, validity period, and local storage folder.
3. Select **Generate files and continue**.

The tool generates an RSA 2048-bit private key and a self-signed X.509 certificate in a new folder, without overwriting previous results.

| File | Purpose | Next action |
|---|---|---|
| `server.crt`: public certificate | Salesforce verifies JWT signatures | Save a copy and upload it to the app |
| `server.key`: private key | The CLI signs requests and renews access | Keep it on this computer |

### 2. Configure the Salesforce app

1. Open **Setup → External Client App Manager**, create an app or edit its settings, and enable OAuth. If creation requires a callback URL, use `http://localhost:1717/OauthRedirect`; JWT sign-in does not use it.
2. Configure Salesforce CLI OAuth scopes: `api`, `web`, and `refresh_token / offline_access`.
3. Under **Flow Enablement**, select **Enable JWT Bearer Flow**, upload `server.crt`, and save.
4. Under **Policies → OAuth Policies**, set **Permitted Users** to **Admin approved users are pre-authorized**. Authorize the actual target user through a profile or permission set.
5. Under **Settings → OAuth Settings → Consumer Key and Secret**, copy the **Consumer Key**.

For an existing Connected App, enable **Use digital signatures**, upload the same public certificate, then configure administrator pre-authorization and user access.

### 3. Return to sign-in

Select **App configured, continue → Use this key and return**. The key path is filled in automatically. Enter the target Salesforce username, Consumer Key (Client ID), and login URL, then sign in.

## Workflow 2: import a Salesforce keystore

Use this when the certificate was created in **Certificate and Key Management** and you need its corresponding private key.

### 1. Export from Salesforce

1. Open **Setup → Certificate and Key Management** and locate the certificate.
2. Confirm **Exportable Private Key** was selected when it was created. If its private key cannot be exported, create a new certificate with this option enabled.
3. Return to the certificate list, select **Export to Keystore**, set an export password, and save the `.jks` file.

**Do not use the `.crt` / `.cer` file from Download Certificate.** It contains only the public certificate and cannot be converted into or used to recover a private key.

### 2. Extract the selected key locally

1. Select **Import Salesforce keystore**, read the export instructions, then select **Keystore exported, continue**.
2. Choose the `.jks` file, enter its export password, and select **Read certificate entries**. `.p12` / `.pfx` keystores are also supported.
3. Choose the **certificate entry name (keystore alias)**. Only entries containing a private key appear. This is not an org alias.
4. If the selected entry has a separate private key password, expand the optional section and enter it. Usually leave it empty to use the keystore password.
5. Choose a local output folder and select **Extract key and continue**.

The tool extracts only the selected entry, requires an RSA private key, checks certificate expiry, and verifies that the key matches the certificate. Passwords are used for this operation only and are not written to the database, logs, or command arguments.

### 3. Check app setup and sign in

The app must use the **same public certificate** as the selected entry. If it is already configured, leave it in place. Otherwise save a copy of the extracted public certificate and follow workflow 1, step 2.

Select **Use this key and return**, then confirm the username, Client ID, and login URL before signing in.

## Terms

| Term | Meaning |
|---|---|
| Private key: `.key` / `.pem` | Local signing file; do not upload it to Salesforce. The CLI needs it for renewal |
| Public certificate: `.crt` / `.cer` | Uploaded to the app to verify signatures; cannot recover a private key |
| Keystore: `.jks` / `.p12` / `.pfx` | Container that can hold multiple certificates and private keys |
| Keystore password | Set when exporting the keystore, not your Salesforce password |
| Entry alias | Name inside the keystore, not an org alias |
| Client ID / Consumer Key | The same app identifier; JWT does not need Consumer Secret |

## Troubleshooting: app scopes and user pre-authorization

If sign-in reports `refresh_token scope is required and the connected app should be installed and preauthorized`, check the app used for this login in order:

1. **OAuth scopes**: add **Perform requests at any time (refresh_token, offline_access)** in the app's OAuth settings, retain required scopes such as `api`, and save. Here `refresh_token` names a permission scope; you do not need to enter a refresh token value.
2. **App policy**: under **Policies → OAuth Policies → Permitted Users**, select **Admin approved users are pre-authorized**.
3. **User access**: grant this app to the signing-in user through a profile or permission set. Confirm the app is installed and enabled in the target org.
4. Save the configuration and retry JWT sign-in in the tool.

Salesforce CLI may try other login endpoints after the target org returns an error and combine their failures. A later `audience is invalid` message may not explain the original failure. Resolve the first response from the target org before troubleshooting fallback endpoints.

## Troubleshooting: network request failure

`fetch failed` means the CLI could not complete that login request. It does not establish whether the username, Client ID, certificate, or app pre-authorization is valid.

1. Confirm network access to the My Domain address and retry sign-in.
2. If using a proxy, check that `HTTP_PROXY` / `HTTPS_PROXY` in the tool's environment points to a working proxy. A browser may use different proxy settings from the CLI.
3. If your network inspects TLS connections, configure a trusted CA for the CLI with your administrator's guidance. Keep TLS certificate verification enabled. See [Salesforce CLI proxy and certificate configuration](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-install-cli-firewall.html).

Restored connectivity only establishes that the service is reachable. Retry sign-in to verify JWT authorization itself.

## Local requirements and storage

- Generation needs **OpenSSL**. Import needs **OpenSSL and JDK keytool**. Missing tools are explained in the relevant step. Recheck after installation; restart the app if needed to refresh PATH.
- The final private key is unencrypted so the CLI can use it. Choose a local folder that only you can access. On macOS / Linux, the output folder uses mode `700` and the private key uses `600`.
- The source keystore is not modified. Temporary conversion files are removed when processing finishes; incomplete output is cleaned up after failures.
- Keep the final key at its path. Do not share it, upload it to Salesforce, or commit it to Git. Prepare replacement files, update the app certificate, and reauthorize before the certificate expires.

## JWT sign-in for Salesforce on Alibaba Cloud

Both certificate preparation workflows apply. Select **Environment → Alibaba Cloud Salesforce** and **Authorization method → JWT**. Enter the username, Client ID, private key path, and this org’s My Domain login URL:

- Production example: `https://yourorg.my.sfcrmproducts.cn`
- Sandbox example: `https://yourorg--dev.sandbox.my.sfcrmproducts.cn`

Use the actual value from **Setup → My Domain**, not `login.salesforce.com`, `test.salesforce.com`, or a Lightning page URL. The tool passes this address to `sf org login jwt --instance-url`; the CLI performs authentication and manages credentials.

Enable JWT Bearer Flow (some UIs show **Use digital signatures**), upload the matching public certificate, and pre-authorize the target user. JWT needs no Consumer Secret or OAuth callback port. Alibaba Cloud’s official example also uses the org’s My Domain as the JWT audience and token endpoint base URL.

See [Alibaba Cloud’s JWT configuration example](https://help.aliyun.com/en/sfoa/user-guide/best-practices-for-calling-the-bailian-agent-in-salesforce-on-alibaba-cloud-org-obtaining-access-token-and-passing-it-to-the-bailian-agent-api). Live authentication for a particular org still needs its actual app, certificate, and user.

Official references: [private key and certificate](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-key-and-cert.html), [app setup](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-eca.html), [keystore export](https://help.salesforce.com/s/articleView?id=xcloud.security_keys_export_import_certs_with_a_keystore.htm&language=en_US&type=5).
