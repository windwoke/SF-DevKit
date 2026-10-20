# JWT 授权：证书准备与操作指引

入口：**Org 管理 → 添加 Org（或重新授权）→ 授权方式 → JWT**。

已有 `.key` / `.pem` 私钥时，可以直接选择文件。没有私钥时，在登录窗口选择下面两条流程中的一条。它们只在本机准备文件，不会自动修改 Salesforce。

## 账号记录与默认 Org

Org 列表按用户名保留一条记录，并显示 CLI 当前使用的授权方式。点击 **重新授权**，可在 **JWT** 与 **浏览器 OAuth** 之间切换；登录成功后更新同一条记录，并保留默认 Org 和本地项目关联。JWT 配置可在重新授权时自动填入；浏览器授权所需的 Consumer Secret 不会保存。

添加 Org 时，**设为默认 Org** 默认勾选。不希望切换默认账号时，取消勾选后点击 **登录**；原默认 Org 保持不变。重新授权不会切换默认 Org。

在 Org 卡片的操作区点击 **检查登录状态**，可单独验证该账号，无需刷新整个列表。检查时显示 **检查中…**；确认授权失效后，该位置改为 **重新授权**。网络故障会显示 **无法连接**，可以继续检查，不会直接判定授权失效。

## 流程一：在本机生成

适用情况：还没有证书和私钥，希望为 SF DevKit 创建一对新文件。

### 1. 生成配套文件

1. 点击 **生成证书与私钥**。
2. 填写证书名称（Common Name），选择有效期和本机保存位置。
3. 点击 **生成文件，下一步**。

工具生成 RSA 2048 位私钥和自签名 X.509 证书，各次操作使用独立文件夹，不覆盖之前生成的文件。

| 文件 | 用途 | 下一步 |
|---|---|---|
| `server.crt` 公钥证书 | Salesforce 验证 JWT 签名 | 点击“另存公钥证书”，然后上传到应用 |
| `server.key` 私钥 | CLI 签署 JWT、续期访问 | 保留在本机，由工具使用 |

### 2. 配置 Salesforce 应用

1. 在 Salesforce 打开 **Setup → External Client App Manager**，新建应用或编辑应用设置，启用 OAuth。若创建页面要求回调 URL，可填写 `http://localhost:1717/OauthRedirect`；JWT 授权不使用此回调。
2. 按 Salesforce CLI 官方指引配置 OAuth 范围：`api`、`web`、`refresh_token / offline_access`。
3. 在 **Flow Enablement** 中启用 **Enable JWT Bearer Flow**，上传刚生成的 `server.crt` 并保存。
4. 在 **Policies → OAuth Policies** 中，将 **Permitted Users** 设置为 **Admin approved users are pre-authorized**。通过权限集或 Profile 授权实际登录的用户。
5. 在 **Settings → OAuth Settings → Consumer Key and Secret** 中复制 **Consumer Key**。

使用已有 Connected App 时，在其 OAuth 设置中启用 **Use digital signatures** 并上传相同的公钥证书，再配置管理员预授权和用户访问权限。

### 3. 回到工具登录

点击 **已完成应用配置，下一步 → 使用此私钥，返回登录**。工具会自动填入私钥路径。填写目标用户的 Salesforce 用户名、Consumer Key（即 Client ID）和登录地址，然后登录。

## 流程二：从 Salesforce 密钥库导入

适用情况：已经在 **Certificate and Key Management** 创建证书，希望使用其对应的私钥。

### 1. 在 Salesforce 导出密钥库

1. 打开 **Setup → Certificate and Key Management**，找到目标证书。
2. 确认证书创建时启用了 **Exportable Private Key**。如果私钥无法导出，需要重新创建可导出私钥的证书。
3. 返回证书列表，点击 **Export to Keystore**，设置导出密码并保存 `.jks` 文件。

**不要把 Download Certificate 得到的 `.crt` / `.cer` 文件当作密钥库。** 这些文件只含公钥证书，不含私钥，不能转换或恢复成私钥。

### 2. 在工具提取私钥

1. 点击 **从 Salesforce 密钥库导入**，阅读导出指引，然后点击 **已导出密钥库，下一步**。
2. 选择 `.jks` 文件，输入刚才设置的**密钥库导出密码**，点击 **读取证书条目**。也支持导入 `.p12` / `.pfx` 密钥库。
3. 选择要使用的**证书条目名称（密钥库别名）**。列表只显示含私钥的条目；此名称不是 Org 别名。
4. 如果这个条目另设了私钥密码，展开对应选项并填写。通常留空，使用密钥库密码即可。
5. 选择本机保存位置，点击 **提取私钥，下一步**。

工具只提取选中的条目，并校验 RSA 私钥、证书有效期和密钥是否匹配。密码只用于当前处理，不写入数据库、日志或命令行参数。

### 3. 核对应用配置并登录

确认应用中上传的是所选条目的**同一张公钥证书**。若已配置，无需替换；尚未配置时，可以使用“另存公钥证书”，按流程一第 2 步配置应用。

点击 **使用此私钥，返回登录**，确认用户名、Client ID 和登录地址，然后授权。

## 术语速查

| 术语 | 含义 |
|---|---|
| 私钥 `.key` / `.pem` | 本机签名文件，不上传 Salesforce；CLI 后续续期仍会使用 |
| 公钥证书 `.crt` / `.cer` | 上传到 Salesforce 应用，验证签名；不能还原私钥 |
| 密钥库 `.jks` / `.p12` / `.pfx` | 可包含多个证书及私钥的容器，用于导入和提取 |
| 密钥库密码 | 导出密钥库时设置的密码，不是 Salesforce 登录密码 |
| 条目别名 | 密钥库内部的证书名称，不是 Org 别名 |
| Client ID / Consumer Key | 同一个应用标识；JWT 不需要 Consumer Secret |

## 排查：应用范围和用户预授权

如果提示 `refresh_token scope is required and the connected app should be installed and preauthorized`，请按顺序检查用于此次登录的应用：

1. **OAuth 范围**：在应用的 OAuth 设置中加入 **Perform requests at any time (refresh_token, offline_access)**，保留所需的 `api` 等范围并保存。这里的 `refresh_token` 是权限范围名称，不需要填写 Refresh Token 值。
2. **应用策略**：在 **Policies → OAuth Policies → Permitted Users** 选择 **Admin approved users are pre-authorized**。
3. **用户访问权限**：通过 Profile 或权限集为此次登录的用户授予该应用访问权限，并确认应用已在目标 Org 安装及启用。
4. 保存配置后回到工具，重新执行 JWT 登录。

Salesforce CLI 可能会在目标 Org 返回错误后，尝试其他登录端点并汇总多个错误。后续出现的 `audience is invalid` 不一定是此次登录的主要原因；应先处理目标 Org 首次返回的错误。

## 排查：网络请求失败

如果提示 `fetch failed`，表示 CLI 未能完成该次登录请求。此时不能据此判断用户名、Client ID、证书或应用预授权有误。

1. 确认网络和 My Domain 地址可访问，再重试登录。
2. 如果使用代理，检查运行工具的环境中 `HTTP_PROXY` / `HTTPS_PROXY` 是否指向可用代理。浏览器能打开页面不代表 CLI 使用相同的代理配置。
3. 如果网络有证书检查，按管理员指引为 CLI 配置可信 CA；不要关闭 TLS 证书校验。可参考 [Salesforce CLI 代理与证书配置](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-setup-install-cli-firewall.html)。

连接恢复仅说明请求可以到达服务；实际 JWT 授权结果仍需再次登录验证。

## 本机工具与文件保管

- 生成流程需要 **OpenSSL**；导入流程需要 **OpenSSL + JDK keytool**。工具会检测并在缺失时显示安装指引。安装后重新检测，必要时重启应用以刷新 PATH。
- 私钥保存为 CLI 可用的未加密文件。选择仅自己可访问的本机文件夹。macOS / Linux 下，输出目录权限为 `700`、私钥为 `600`。
- 原密钥库不会被修改。转换中间文件位于临时目录，处理结束后删除；失败时清理本次未完成的输出。
- 保留最终私钥文件，不要分享、上传到 Salesforce 或提交 Git。证书临近到期时重新准备文件、更新应用证书并重新授权。

## 阿里云 Salesforce 的 JWT 登录

两条证书准备流程同样适用。登录窗口选择 **环境 → 阿里云 Salesforce** 和 **授权方式 → JWT**，然后填写用户名、Client ID、私钥路径及该 Org 的 My Domain 登录地址：

- 生产示例：`https://yourorg.my.sfcrmproducts.cn`
- 沙盒示例：`https://yourorg--dev.sandbox.my.sfcrmproducts.cn`

地址以 **Setup → My Domain** 中显示的值为准，不要使用国际版的 `login.salesforce.com` / `test.salesforce.com` 或 Lightning 页面地址。工具将该地址通过 `sf org login jwt --instance-url` 传给 CLI，由 CLI 完成授权及凭据管理。

应用需要启用 JWT Bearer Flow（某些界面显示为 **Use digital signatures**），上传配套公钥证书，并为目标用户配置管理员预授权。JWT 不需要 Consumer Secret 或 OAuth 回调端口。阿里云官方示例也以 Org 的 My Domain 作为 JWT audience 和令牌端点的基础地址。

[阿里云官方 JWT 配置示例](https://help.aliyun.com/zh/sfoa/user-guide/best-practices-for-calling-the-bailian-agent-in-salesforce-on-alibaba-cloud-org-obtaining-access-token-and-passing-it-to-the-bailian-agent-api)。具体 Org 的授权结果仍需使用实际应用、证书和用户完成验证。

官方参考：[创建私钥和证书](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-key-and-cert.html)、[配置应用](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-eca.html)、[导出密钥库](https://help.salesforce.com/s/articleView?id=xcloud.security_keys_export_import_certs_with_a_keystore.htm&language=en_US&type=5)。
