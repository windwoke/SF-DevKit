use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tempfile::TempDir;
use tokio::process::Command;

use crate::cli::runner::{find_binary, SuppressConsole};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateTools {
    pub openssl: bool,
    pub keytool: bool,
    pub storage_directory: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyMaterial {
    pub key_file: String,
    pub certificate_file: String,
    pub subject: String,
    pub expires_at: String,
    pub fingerprint_sha256: String,
}

pub fn openssl_binary() -> anyhow::Result<PathBuf> {
    find_binary(
        "openssl",
        &[
            "/opt/homebrew/opt/openssl/bin/openssl",
            "/usr/local/opt/openssl/bin/openssl",
            "/usr/bin/openssl",
        ],
    )
    .ok_or_else(|| anyhow::anyhow!("JWT_OPENSSL_MISSING"))
}

fn keytool_binary() -> anyhow::Result<PathBuf> {
    find_binary("keytool", &["/usr/bin/keytool"])
        .or_else(|| {
            std::env::var_os("JAVA_HOME")
                .map(PathBuf::from)
                .map(|dir| {
                    dir.join(if cfg!(windows) {
                        "bin/keytool.exe"
                    } else {
                        "bin/keytool"
                    })
                })
                .filter(|path| path.is_file())
        })
        .ok_or_else(|| anyhow::anyhow!("JWT_KEYTOOL_MISSING"))
}

/// Captured output may contain private keys. It never goes to logs, errors,
/// or IPC. Passwords are scoped to child environments, never command arguments.
async fn tool(
    binary: &Path,
    args: &[&str],
    secrets: &[(&str, &str)],
    failure: &'static str,
) -> anyhow::Result<Vec<u8>> {
    let mut command = Command::new(binary);
    command
        .suppress_console()
        .args(args)
        .env("PATH", crate::cli::environment::runtime_path())
        .envs(secrets.iter().copied())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = command.spawn().map_err(|_| anyhow::anyhow!(failure))?;
    let output = tokio::time::timeout(Duration::from_secs(45), child.wait_with_output())
        .await
        .map_err(|_| anyhow::anyhow!("JWT_CERT_TOOL_TIMEOUT"))?
        .map_err(|_| anyhow::anyhow!(failure))?;
    if !output.status.success() {
        anyhow::bail!(failure);
    }
    Ok(output.stdout)
}

pub async fn tools(storage: &Path) -> CertificateTools {
    let openssl = if let Ok(binary) = openssl_binary() {
        tool(&binary, &["version"], &[], "JWT_OPENSSL_MISSING")
            .await
            .is_ok()
    } else {
        false
    };
    let keytool = if let Ok(binary) = keytool_binary() {
        tool(&binary, &["-help"], &[], "JWT_KEYTOOL_MISSING")
            .await
            .is_ok()
    } else {
        false
    };
    CertificateTools {
        openssl,
        keytool,
        storage_directory: storage.to_string_lossy().into_owned(),
    }
}

fn output_directory(base: &Path) -> anyhow::Result<TempDir> {
    private_directory(base, "jwt-")
}

fn private_directory(base: &Path, prefix: &str) -> anyhow::Result<TempDir> {
    std::fs::create_dir_all(base).map_err(|_| anyhow::anyhow!("JWT_CERT_STORAGE_FAILED"))?;
    let directory = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(base)
        .map_err(|_| anyhow::anyhow!("JWT_CERT_STORAGE_FAILED"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
            .map_err(|_| anyhow::anyhow!("JWT_CERT_STORAGE_FAILED"))?;
    }
    Ok(directory)
}

fn text_path(path: &Path) -> anyhow::Result<&str> {
    path.to_str()
        .ok_or_else(|| anyhow::anyhow!("JWT_CERT_STORAGE_FAILED"))
}

fn protect_private_key(path: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|_| anyhow::anyhow!("JWT_CERT_STORAGE_FAILED"))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

pub async fn generate(base: &Path, common_name: &str, days: u32) -> anyhow::Result<KeyMaterial> {
    let common_name = common_name.trim();
    // Restrict the X.509 subject to one CN; never interpolate arbitrary DN syntax.
    if common_name.is_empty()
        || common_name.chars().count() > 64
        || common_name
            .chars()
            .any(|ch| ch.is_control() || "/\\=+".contains(ch))
        || !(1..=3650).contains(&days)
    {
        anyhow::bail!("JWT_CERT_INVALID_OPTIONS");
    }
    let binary = openssl_binary()?;
    let directory = output_directory(base)?;
    let key = directory.path().join("server.key");
    let certificate = directory.path().join("server.crt");
    tool(
        &binary,
        &["genrsa", "-out", text_path(&key)?, "2048"],
        &[],
        "JWT_CERT_GENERATE_FAILED",
    )
    .await?;
    protect_private_key(&key)?;
    tool(
        &binary,
        &[
            "req",
            "-new",
            "-x509",
            "-utf8",
            "-sha256",
            "-key",
            text_path(&key)?,
            "-out",
            text_path(&certificate)?,
            "-days",
            &days.to_string(),
            "-subj",
            &format!("/CN={common_name}"),
        ],
        &[],
        "JWT_CERT_GENERATE_FAILED",
    )
    .await?;
    let material = check_material(&binary, &key, &certificate).await?;
    let _ = directory.keep();
    Ok(material)
}

fn keystore_path(path: &str) -> anyhow::Result<PathBuf> {
    let path = Path::new(path);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ["crt", "cer", "pem", "der", "pub"].contains(&extension.as_str()) {
        anyhow::bail!("JWT_KEYSTORE_PUBLIC_ONLY");
    }
    if !["jks", "p12", "pfx"].contains(&extension.as_str()) {
        anyhow::bail!("JWT_KEYSTORE_INVALID");
    }
    let path = path
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("JWT_KEYSTORE_UNREADABLE"))?;
    let metadata =
        std::fs::metadata(&path).map_err(|_| anyhow::anyhow!("JWT_KEYSTORE_UNREADABLE"))?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        anyhow::bail!("JWT_KEYSTORE_INVALID");
    }
    Ok(path)
}

pub async fn list_entries(path: &str, password: &str) -> anyhow::Result<Vec<String>> {
    let path = keystore_path(path)?;
    let binary = keytool_binary()?;
    let output = tool(
        &binary,
        &[
            "-J-Duser.language=en",
            "-J-Duser.country=US",
            "-list",
            "-rfc",
            "-keystore",
            text_path(&path)?,
            "-storepass:env",
            "SF_DEVKIT_STORE_PASSWORD",
        ],
        &[("SF_DEVKIT_STORE_PASSWORD", password)],
        "JWT_KEYSTORE_READ_FAILED",
    )
    .await?;
    let entries = private_key_aliases(&String::from_utf8_lossy(&output));
    if entries.is_empty() {
        anyhow::bail!("JWT_KEYSTORE_NO_PRIVATE_KEY");
    }
    Ok(entries)
}

fn private_key_aliases(output: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut alias = None;
    for line in output.lines().map(str::trim) {
        if let Some(name) = line.strip_prefix("Alias name: ") {
            alias = Some(name.to_owned());
        } else if line == "Entry type: PrivateKeyEntry" {
            if let Some(name) = alias.take() {
                entries.push(name);
            }
        }
    }
    entries
}

pub async fn import(
    base: &Path,
    path: &str,
    password: &str,
    alias: &str,
    key_password: Option<&str>,
) -> anyhow::Result<KeyMaterial> {
    let entries = list_entries(path, password).await?;
    if !entries.iter().any(|entry| entry == alias) {
        anyhow::bail!("JWT_KEYSTORE_ALIAS_INVALID");
    }
    let source = keystore_path(path)?;
    let openssl = openssl_binary()?;
    let keytool = keytool_binary()?;
    let directory = output_directory(base)?;
    let scratch = private_directory(&std::env::temp_dir(), "sf-devkit-key-")?;
    let pkcs12 = scratch.path().join("selected.p12");
    let random = tool(
        &openssl,
        &["rand", "-hex", "24"],
        &[],
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    let temporary_password =
        String::from_utf8(random).map_err(|_| anyhow::anyhow!("JWT_CERT_IMPORT_FAILED"))?;
    let temporary_password = temporary_password.trim();
    let secrets = [
        ("SF_DEVKIT_STORE_PASSWORD", password),
        (
            "SF_DEVKIT_KEY_PASSWORD",
            key_password
                .filter(|value| !value.is_empty())
                .unwrap_or(password),
        ),
        ("SF_DEVKIT_TEMP_PASSWORD", temporary_password),
    ];
    tool(
        &keytool,
        &[
            "-J-Duser.language=en",
            "-J-Duser.country=US",
            "-importkeystore",
            "-noprompt",
            "-srckeystore",
            text_path(&source)?,
            "-srcalias",
            alias,
            "-srcstorepass:env",
            "SF_DEVKIT_STORE_PASSWORD",
            "-srckeypass:env",
            "SF_DEVKIT_KEY_PASSWORD",
            "-destkeystore",
            text_path(&pkcs12)?,
            "-deststoretype",
            "PKCS12",
            "-deststorepass:env",
            "SF_DEVKIT_TEMP_PASSWORD",
            "-destkeypass:env",
            "SF_DEVKIT_TEMP_PASSWORD",
        ],
        &secrets,
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    let key = directory.path().join("server.key");
    let certificate = directory.path().join("server.crt");
    let raw_key = scratch.path().join("key.pem");
    let raw_certificate = scratch.path().join("certificate.pem");
    let pass = [("SF_DEVKIT_TEMP_PASSWORD", temporary_password)];
    tool(
        &openssl,
        &[
            "pkcs12",
            "-in",
            text_path(&pkcs12)?,
            "-passin",
            "env:SF_DEVKIT_TEMP_PASSWORD",
            "-nocerts",
            "-nodes",
            "-out",
            text_path(&raw_key)?,
        ],
        &pass,
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    // Normalize bag attributes away and require an RSA private key for JWT.
    tool(
        &openssl,
        &["rsa", "-in", text_path(&raw_key)?, "-out", text_path(&key)?],
        &[],
        "JWT_CERT_RSA_REQUIRED",
    )
    .await?;
    protect_private_key(&key)?;
    tool(
        &openssl,
        &[
            "pkcs12",
            "-in",
            text_path(&pkcs12)?,
            "-passin",
            "env:SF_DEVKIT_TEMP_PASSWORD",
            "-clcerts",
            "-nokeys",
            "-out",
            text_path(&raw_certificate)?,
        ],
        &pass,
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    tool(
        &openssl,
        &[
            "x509",
            "-in",
            text_path(&raw_certificate)?,
            "-out",
            text_path(&certificate)?,
        ],
        &[],
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    let material = check_material(&openssl, &key, &certificate).await?;
    let _ = directory.keep();
    Ok(material)
}

async fn check_material(
    binary: &Path,
    key: &Path,
    certificate: &Path,
) -> anyhow::Result<KeyMaterial> {
    tool(
        binary,
        &["rsa", "-in", text_path(key)?, "-check", "-noout"],
        &[],
        "JWT_CERT_RSA_REQUIRED",
    )
    .await?;
    tool(
        binary,
        &[
            "x509",
            "-in",
            text_path(certificate)?,
            "-checkend",
            "0",
            "-noout",
        ],
        &[],
        "JWT_CERT_EXPIRED",
    )
    .await?;
    let public_from_key = tool(
        binary,
        &["pkey", "-in", text_path(key)?, "-pubout"],
        &[],
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    let public_from_certificate = tool(
        binary,
        &["x509", "-in", text_path(certificate)?, "-pubkey", "-noout"],
        &[],
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    if public_from_key != public_from_certificate {
        anyhow::bail!("JWT_CERT_KEY_MISMATCH");
    }
    let info = tool(
        binary,
        &[
            "x509",
            "-in",
            text_path(certificate)?,
            "-noout",
            "-subject",
            "-enddate",
            "-fingerprint",
            "-sha256",
        ],
        &[],
        "JWT_CERT_IMPORT_FAILED",
    )
    .await?;
    let info = String::from_utf8_lossy(&info);
    Ok(KeyMaterial {
        key_file: key.to_string_lossy().into_owned(),
        certificate_file: certificate.to_string_lossy().into_owned(),
        subject: info
            .lines()
            .find_map(|line| line.strip_prefix("subject="))
            .unwrap_or_default()
            .trim()
            .to_owned(),
        expires_at: info
            .lines()
            .find_map(|line| line.strip_prefix("notAfter="))
            .unwrap_or_default()
            .trim()
            .to_owned(),
        fingerprint_sha256: info
            .lines()
            .find_map(|line| line.split_once("Fingerprint=").map(|(_, value)| value))
            .unwrap_or_default()
            .trim()
            .to_owned(),
    })
}

/// Validate and return a public X.509 certificate. A private-key file cannot
/// be exported through this command.
pub async fn public_certificate(path: &Path) -> anyhow::Result<Vec<u8>> {
    let binary = openssl_binary()?;
    tool(
        &binary,
        &["x509", "-in", text_path(path)?, "-outform", "PEM"],
        &[],
        "JWT_CERT_EXPORT_FAILED",
    )
    .await
}

pub fn save_public_certificate(path: &Path, contents: &[u8]) -> anyhow::Result<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["crt", "cer"].contains(&extension.as_str())
        || std::fs::read_to_string(path).is_ok_and(|existing| existing.contains("PRIVATE KEY"))
    {
        anyhow::bail!("JWT_CERT_EXPORT_PATH");
    }
    std::fs::write(path, contents).map_err(|_| anyhow::anyhow!("JWT_CERT_EXPORT_FAILED"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_private_entries_only_and_preserves_alias_names() {
        let output = "Alias name: first key\nEntry type: PrivateKeyEntry\nCertificate chain length: 1\nAlias name: trusted\nEntry type: trustedCertEntry\nAlias name: 第二个: key\nEntry type: PrivateKeyEntry\n";
        assert_eq!(private_key_aliases(output), ["first key", "第二个: key"]);
        assert!(private_key_aliases("Entry type: trustedCertEntry").is_empty());
    }

    #[test]
    fn explains_why_downloaded_public_certificates_cannot_be_imported() {
        for path in ["certificate.crt", "download.CER", "key.pem", "public.der"] {
            assert_eq!(
                keystore_path(path).unwrap_err().to_string(),
                "JWT_KEYSTORE_PUBLIC_ONLY"
            );
        }
        assert_eq!(
            keystore_path("file.txt").unwrap_err().to_string(),
            "JWT_KEYSTORE_INVALID"
        );
    }

    #[test]
    fn exporting_a_certificate_cannot_overwrite_a_private_key() {
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("private.crt");
        let private = "-----BEGIN PRIVATE KEY-----\nsecret-fixture\n-----END PRIVATE KEY-----";
        std::fs::write(&key, private).unwrap();
        assert_eq!(
            save_public_certificate(&key, b"public-certificate")
                .unwrap_err()
                .to_string(),
            "JWT_CERT_EXPORT_PATH"
        );
        assert_eq!(std::fs::read_to_string(&key).unwrap(), private);
        assert!(
            save_public_certificate(&dir.path().join("server.key"), b"public-certificate").is_err()
        );
        let cert = dir.path().join("public.crt");
        save_public_certificate(&cert, b"public-certificate").unwrap();
        assert_eq!(std::fs::read(&cert).unwrap(), b"public-certificate");
    }

    #[tokio::test]
    async fn rejects_invalid_subjects_before_creating_any_files() {
        let base = tempfile::tempdir().unwrap();
        for name in ["", "CN=bad", "foo/OU=Injected", "foo+bar", "line\nbreak"] {
            let result = generate(base.path(), name, 365).await;
            assert_eq!(
                result.err().unwrap().to_string(),
                "JWT_CERT_INVALID_OPTIONS"
            );
        }
        assert!(generate(base.path(), "good", 0).await.is_err());
        assert_eq!(std::fs::read_dir(base.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    #[ignore = "requires a working OpenSSL installation"]
    async fn generates_real_rsa_pair_and_exports_only_the_public_certificate() {
        let base = tempfile::tempdir().unwrap();
        let first = generate(base.path(), "SF-DevKit fixture", 365)
            .await
            .unwrap();
        let second = generate(base.path(), "Other", 365).await.unwrap();
        assert_ne!(first.key_file, second.key_file);
        assert!(first.subject.contains("SF-DevKit fixture"));
        assert!(!first.fingerprint_sha256.is_empty());
        let certificate = public_certificate(Path::new(&first.certificate_file))
            .await
            .unwrap();
        assert!(String::from_utf8(certificate)
            .unwrap()
            .contains("BEGIN CERTIFICATE"));
        assert!(public_certificate(Path::new(&first.key_file))
            .await
            .is_err());
        let mismatch = check_material(
            &openssl_binary().unwrap(),
            Path::new(&first.key_file),
            Path::new(&second.certificate_file),
        )
        .await;
        assert_eq!(mismatch.err().unwrap().to_string(), "JWT_CERT_KEY_MISMATCH");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&first.key_file)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(Path::new(&first.key_file).parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires OpenSSL and JDK keytool; exercises real JKS/P12 files"]
    async fn imports_real_jks_and_p12_selecting_the_right_private_entry() {
        let base = tempfile::tempdir().unwrap();
        let source = generate(base.path(), "Original certificate", 365)
            .await
            .unwrap();
        let openssl = openssl_binary().unwrap();
        let keytool = keytool_binary().unwrap();
        let pkcs12 = base.path().join("source.p12");
        let jks = base.path().join("source.jks");
        // Spaces and shell metacharacters verify that passwords never pass
        // through a shell or argv parsing.
        let password = "test $word 'with spaces'";
        let secrets = [("SF_DEVKIT_FIXTURE_PASS", password)];
        tool(
            &openssl,
            &[
                "pkcs12",
                "-export",
                "-name",
                "original",
                "-inkey",
                &source.key_file,
                "-in",
                &source.certificate_file,
                "-out",
                text_path(&pkcs12).unwrap(),
                "-passout",
                "env:SF_DEVKIT_FIXTURE_PASS",
            ],
            &secrets,
            "fixture",
        )
        .await
        .unwrap();
        let imported_p12 = import(
            base.path(),
            text_path(&pkcs12).unwrap(),
            password,
            "original",
            None,
        )
        .await
        .unwrap();
        assert_eq!(imported_p12.fingerprint_sha256, source.fingerprint_sha256);
        tool(
            &keytool,
            &[
                "-importkeystore",
                "-noprompt",
                "-srckeystore",
                text_path(&pkcs12).unwrap(),
                "-srcstorepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
                "-destkeystore",
                text_path(&jks).unwrap(),
                "-deststoretype",
                "JKS",
                "-deststorepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
            ],
            &secrets,
            "fixture",
        )
        .await
        .unwrap();
        let separate_password = "different-key-password";
        let separate_secrets = [
            ("SF_DEVKIT_FIXTURE_PASS", password),
            ("SF_DEVKIT_FIXTURE_KEY_PASS", separate_password),
        ];
        tool(
            &keytool,
            &[
                "-genkeypair",
                "-alias",
                "second certificate",
                "-keystore",
                text_path(&jks).unwrap(),
                "-storetype",
                "JKS",
                "-storepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
                "-keypass:env",
                "SF_DEVKIT_FIXTURE_KEY_PASS",
                "-keyalg",
                "RSA",
                "-keysize",
                "2048",
                "-dname",
                "CN=Second certificate",
                "-validity",
                "365",
            ],
            &separate_secrets,
            "fixture",
        )
        .await
        .unwrap();
        tool(
            &keytool,
            &[
                "-importcert",
                "-noprompt",
                "-alias",
                "public only",
                "-file",
                &source.certificate_file,
                "-keystore",
                text_path(&jks).unwrap(),
                "-storepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
            ],
            &secrets,
            "fixture",
        )
        .await
        .unwrap();
        let entries = list_entries(text_path(&jks).unwrap(), password)
            .await
            .unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.contains(&"second certificate".into()));
        assert!(!entries.contains(&"public only".into()));
        let imported = import(
            base.path(),
            text_path(&jks).unwrap(),
            password,
            "second certificate",
            Some(separate_password),
        )
        .await
        .unwrap();
        assert!(imported.subject.contains("Second certificate"));
        assert_ne!(imported.fingerprint_sha256, source.fingerprint_sha256);
        let before = std::fs::read_dir(base.path()).unwrap().count();
        let bad_key = import(
            base.path(),
            text_path(&jks).unwrap(),
            password,
            "second certificate",
            None,
        )
        .await;
        assert_eq!(bad_key.err().unwrap().to_string(), "JWT_CERT_IMPORT_FAILED");
        assert_eq!(
            std::fs::read_dir(base.path()).unwrap().count(),
            before,
            "failed extraction must remove output files"
        );
        let wrong_password = list_entries(text_path(&jks).unwrap(), "incorrect password").await;
        assert_eq!(
            wrong_password.err().unwrap().to_string(),
            "JWT_KEYSTORE_READ_FAILED"
        );
        assert!(import(
            base.path(),
            text_path(&jks).unwrap(),
            password,
            "public only",
            None
        )
        .await
        .is_err());
        let trust_only = base.path().join("trusted.jks");
        tool(
            &keytool,
            &[
                "-importcert",
                "-noprompt",
                "-alias",
                "public only",
                "-file",
                &source.certificate_file,
                "-keystore",
                text_path(&trust_only).unwrap(),
                "-storepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
            ],
            &secrets,
            "fixture",
        )
        .await
        .unwrap();
        assert_eq!(
            list_entries(text_path(&trust_only).unwrap(), password)
                .await
                .err()
                .unwrap()
                .to_string(),
            "JWT_KEYSTORE_NO_PRIVATE_KEY"
        );
    }

    #[tokio::test]
    #[ignore = "requires OpenSSL and JDK keytool"]
    async fn rejects_ec_and_expired_certificates_and_cleans_incomplete_output() {
        let base = tempfile::tempdir().unwrap();
        let keytool = keytool_binary().unwrap();
        let password = "fixture-password";
        let secrets = [("SF_DEVKIT_FIXTURE_PASS", password)];
        for (name, algorithm, expected) in [
            ("ec", "EC", "JWT_CERT_RSA_REQUIRED"),
            ("expired", "RSA", "JWT_CERT_EXPIRED"),
        ] {
            let store = base.path().join(format!("{name}.jks"));
            let mut args = vec![
                "-genkeypair",
                "-alias",
                name,
                "-keystore",
                text_path(&store).unwrap(),
                "-storetype",
                "JKS",
                "-storepass:env",
                "SF_DEVKIT_FIXTURE_PASS",
                "-keypass:env",
                "SF_DEVKIT_FIXTURE_PASS",
                "-keyalg",
                algorithm,
                "-dname",
                "CN=Fixture",
                "-validity",
                "1",
            ];
            if name == "expired" {
                args.extend(["-startdate", "2020/01/01 00:00:00"]);
            }
            tool(&keytool, &args, &secrets, "fixture").await.unwrap();
            let before = std::fs::read_dir(base.path()).unwrap().count();
            let result = import(
                base.path(),
                text_path(&store).unwrap(),
                password,
                name,
                None,
            )
            .await;
            assert_eq!(result.err().unwrap().to_string(), expected);
            assert_eq!(std::fs::read_dir(base.path()).unwrap().count(), before);
        }
    }
}
