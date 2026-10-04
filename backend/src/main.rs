use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, Query, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use deadpool_postgres::{Manager, Pool};
use object_store::{
    ObjectStore, aws::AmazonS3Builder, buffered::BufWriter, path::Path as ObjectPath,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{env, sync::Arc};
use tokio::io::AsyncWriteExt;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

#[derive(Clone)]
struct App {
    db: Pool,
    objects: Arc<dyn ObjectStore>,
    uploads: Arc<tokio::sync::Semaphore>,
}
#[derive(Debug)]
struct Error(StatusCode, String);
type Result<T> = std::result::Result<T, Error>;
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn internal(e: impl std::fmt::Display) -> Error {
    eprintln!("storage operation failed: {e}");
    Error(
        StatusCode::SERVICE_UNAVAILABLE,
        "保存先への接続に失敗しました。再試行してください。".into(),
    )
}
fn bad(s: &str) -> Error {
    Error(StatusCode::BAD_REQUEST, s.into())
}
fn conflict() -> Error {
    Error(
        StatusCode::CONFLICT,
        "別の操作で更新されています。一覧を更新してください。".into(),
    )
}
fn stamp() -> String {
    chrono::Utc::now().to_rfc3339()
}
fn id_check(id: &str) -> Result<()> {
    Uuid::parse_str(id).map_err(|_| bad("素材IDが不正です。"))?;
    Ok(())
}
fn expected(h: &HeaderMap) -> Result<i64> {
    h.get("if-match")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim_matches('"').parse().ok())
        .filter(|v| *v > 0)
        .ok_or(Error(
            StatusCode::PRECONDITION_REQUIRED,
            "更新にはバージョンが必要です。".into(),
        ))
}
fn file_type(name: &str) -> (&'static str, &'static str) {
    match name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "gif" => ("image", "image/gif"),
        "svg" => ("image", "image/svg+xml"),
        "bmp" => ("image", "image/bmp"),
        "avif" => ("image", "image/avif"),
        "ico" => ("image", "image/x-icon"),
        "wav" => ("audio", "audio/wav"),
        "mp3" => ("audio", "audio/mpeg"),
        "ogg" | "oga" => ("audio", "audio/ogg"),
        "flac" => ("audio", "audio/flac"),
        "m4a" | "aac" => ("audio", "audio/mp4"),
        "json" => ("json", "application/json"),
        _ => ("file", "application/octet-stream"),
    }
}
fn normalize(mut v: Value) -> Result<Value> {
    let name = v["name"]
        .as_str()
        .ok_or(bad("名前が必要です。"))?
        .trim()
        .to_owned();
    if name.is_empty() || name.len() > 255 || name.contains(['\r', '\n', '/', '\\']) {
        return Err(bad("素材名が不正です。"));
    }
    let (kind, mime) = file_type(&name);
    if kind == "file" {
        return Err(bad("対応していない拡張子です。"));
    }
    let mut tags: Vec<String> = v["tagIds"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    tags.retain(|t| !["image", "audio", "json"].contains(&t.as_str()));
    tags.push(kind.into());
    tags.sort();
    tags.dedup();
    if tags.len() > 50 || tags.iter().any(|t| t.len() > 100) {
        return Err(bad("タグが多すぎます。"));
    }
    let desc = v["description"].as_str().unwrap_or("").to_owned();
    if desc.len() > 16000 {
        return Err(bad("説明が長すぎます。"));
    }
    v = json!({"name":name,"type":kind,"mimeType":mime,"tagIds":tags,"description":desc});
    Ok(v)
}
async fn same_origin(req: Request, next: Next) -> Response {
    if !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    ) {
        if req
            .headers()
            .get("sec-fetch-site")
            .is_some_and(|s| s == "cross-site")
        {
            return StatusCode::FORBIDDEN.into_response();
        }
        if let Some(origin) = req.headers().get("origin").and_then(|s| s.to_str().ok()) {
            let allowed =
                env::var("PUBLIC_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:8080".into());
            if origin != allowed {
                return StatusCode::FORBIDDEN.into_response();
            }
        }
    }
    next.run(req).await
}
#[derive(Deserialize)]
struct Paging {
    #[serde(default)]
    after: String,
}
async fn list(State(a): State<App>, Query(q): Query<Paging>) -> Result<Json<Value>> {
    let db = a.db.get().await.map_err(internal)?;
    let rows = db
        .query(
            "SELECT id,metadata FROM assets WHERE NOT deleted AND id > $1 ORDER BY id LIMIT 501",
            &[&q.after],
        )
        .await
        .map_err(internal)?;
    let files: Vec<Value> = rows.iter().take(500).map(|r| r.get(1)).collect();
    let cursor = if rows.len() > 500 {
        Some(rows[499].get::<_, String>(0))
    } else {
        None
    };
    Ok(Json(json!({"files":files,"nextCursor":cursor})))
}
async fn metadata(State(a): State<App>, Path(id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(fetch(&a, &id).await?.0))
}
async fn fetch(a: &App, id: &str) -> Result<(Value, String, i64)> {
    id_check(id)?;
    let r =
        a.db.get()
            .await
            .map_err(internal)?
            .query_opt(
                "SELECT metadata,object_key,version FROM assets WHERE id=$1 AND NOT deleted",
                &[&id],
            )
            .await
            .map_err(internal)?
            .ok_or(Error(
                StatusCode::NOT_FOUND,
                "素材が見つかりません。".into(),
            ))?;
    Ok((r.get(0), r.get(1), r.get(2)))
}
async fn content(State(a): State<App>, Path(id): Path<String>) -> Result<Response> {
    let (m, key, v) = fetch(&a, &id).await?;
    let obj = a
        .objects
        .get(&ObjectPath::from(key))
        .await
        .map_err(internal)?;
    // Raw assets are isolated from the app even when someone bypasses the UI sanitizer.
    let response = Response::builder()
        .header(
            "Content-Type",
            m["mimeType"].as_str().unwrap_or("application/octet-stream"),
        )
        .header(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        )
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-cache")
        .header("ETag", format!("\"{v}\""))
        .body(Body::from_stream(obj.into_stream()))
        .map_err(internal)?;
    Ok(response)
}
async fn upload(
    State(a): State<App>,
    Path(id): Path<String>,
    headers: HeaderMap,
    mut form: Multipart,
) -> Result<Json<Value>> {
    id_check(&id)?;
    let _permit = a.uploads.acquire().await.map_err(internal)?;
    let mut field = form
        .next_field()
        .await
        .map_err(internal)?
        .ok_or(bad("メタデータが必要です。"))?;
    if field.name() != Some("metadata") {
        return Err(bad("metadataを先に送信してください。"));
    }
    let mut bytes = Vec::new();
    while let Some(c) = field.chunk().await.map_err(internal)? {
        if bytes.len() + c.len() > 32000 {
            return Err(bad("メタデータが大きすぎます。"));
        }
        bytes.extend_from_slice(&c);
    }
    drop(field);
    let mut m = normalize(serde_json::from_slice(&bytes).map_err(|_| bad("JSONが不正です。"))?)?;
    let version = headers
        .get("if-match")
        .map(|_| expected(&headers))
        .transpose()?;
    let previous = if let Some(v) = version {
        let old = fetch(&a, &id).await?;
        if old.2 != v {
            return Err(conflict());
        }
        Some(old)
    } else {
        None
    };
    let mut field = form
        .next_field()
        .await
        .map_err(internal)?
        .ok_or(bad("ファイルが必要です。"))?;
    if field.name() != Some("file") {
        return Err(bad("fileが必要です。"));
    }
    let key = Uuid::new_v4().to_string();
    let path = ObjectPath::from(key.clone());
    let mut writer = BufWriter::with_capacity(a.objects.clone(), path.clone(), 8 * 1024 * 1024)
        .with_max_concurrency(2);
    let mut hash = Sha256::new();
    let mut size = 0usize;
    let transfer: Result<()> = async {
        while let Some(chunk) = field.chunk().await.map_err(internal)? {
            size += chunk.len();
            if size > 1_000_000_000 {
                return Err(Error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "1 GBを超えています。".into(),
                ));
            }
            hash.update(&chunk);
            writer.put(chunk).await.map_err(internal)?;
        }
        Ok(())
    }
    .await;
    if let Err(e) = transfer {
        let _ = writer.abort().await;
        return Err(e);
    }
    drop(field);
    match form.next_field().await {
        Ok(None) => {}
        _ => {
            let _ = writer.abort().await;
            return Err(bad("ファイルは1件ずつ送信してください。"));
        }
    }
    writer.shutdown().await.map_err(internal)?;
    let digest = format!("{:x}", hash.finalize());
    let v = version.unwrap_or(0) + 1;
    m["assetId"] = json!(id);
    m["fileId"] = json!(id);
    m["version"] = json!(v.to_string());
    m["size"] = json!(size);
    m["sha256"] = json!(digest);
    m["modifiedTime"] = json!(stamp());
    let commit:Result<bool>=async {
  let db=a.db.get().await.map_err(internal)?;
  let count=if let Some(old)=version {
   db.execute("UPDATE assets SET metadata=$2,object_key=$3,version=version+1 WHERE id=$1 AND version=$4 AND NOT deleted",&[&id,&m,&key,&old]).await.map_err(internal)?
  }else{db.execute("INSERT INTO assets(id,metadata,object_key) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",&[&id,&m,&key]).await.map_err(internal)?}; Ok(count==1)
 }.await;
    match commit {
        Ok(true) => {
            if let Some((_, old, _)) = previous {
                if let Err(e) = a.objects.delete(&ObjectPath::from(old)).await {
                    eprintln!("obsolete object cleanup failed: {e}");
                }
            }
            Ok(Json(m))
        }
        other => {
            // A DB transport error may mean the commit succeeded. Retain the object
            // until its reference can be reconciled; deleting it here could lose data.
            if let Err(e) = other {
                return Err(e);
            }
            let _ = a.objects.delete(&path).await;
            if version.is_none() {
                let (old, _, _) = fetch(&a, &id).await?;
                if old["sha256"] == m["sha256"] && old["name"] == m["name"] {
                    return Ok(Json(old));
                }
            }
            Err(conflict())
        }
    }
}
async fn update(
    State(a): State<App>,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(patch): Json<Value>,
) -> Result<Json<Value>> {
    let (mut old, _, v) = fetch(&a, &id).await?;
    if expected(&h)? != v {
        return Err(conflict());
    }
    for k in ["name", "description", "tagIds"] {
        if let Some(value) = patch.get(k) {
            old[k] = value.clone();
        }
    }
    let normalized = normalize(old.clone())?;
    for k in ["name", "description", "tagIds", "type", "mimeType"] {
        old[k] = normalized[k].clone();
    }
    old["version"] = json!((v + 1).to_string());
    old["modifiedTime"] = json!(stamp());
    let count=a.db.get().await.map_err(internal)?.execute("UPDATE assets SET metadata=$2,version=version+1 WHERE id=$1 AND version=$3 AND NOT deleted",&[&id,&old,&v]).await.map_err(internal)?;
    if count != 1 {
        return Err(conflict());
    }
    Ok(Json(old))
}
async fn remove(State(a): State<App>, Path(id): Path<String>, h: HeaderMap) -> Result<StatusCode> {
    id_check(&id)?;
    let version = expected(&h)?;
    let db = a.db.get().await.map_err(internal)?;
    let row = db
        .query_opt(
            "UPDATE assets SET deleted=TRUE WHERE id=$1 AND version=$2 RETURNING object_key",
            &[&id, &version],
        )
        .await
        .map_err(internal)?;
    if let Some(row) = row {
        a.objects
            .delete(&ObjectPath::from(row.get::<_, String>(0)))
            .await
            .map_err(internal)?;
    } else if db
        .query_opt("SELECT id FROM assets WHERE id=$1", &[&id])
        .await
        .map_err(internal)?
        .is_some()
    {
        return Err(conflict());
    }
    Ok(StatusCode::NO_CONTENT)
}
async fn tags(State(a): State<App>) -> Result<Json<Value>> {
    let rows =
        a.db.get()
            .await
            .map_err(internal)?
            .query("SELECT id,name,color FROM tags ORDER BY name", &[])
            .await
            .map_err(internal)?;
    Ok(Json(json!(rows.iter().map(|r|json!({"tagId":r.get::<_,String>(0),"name":r.get::<_,String>(1),"color":r.get::<_,String>(2)})).collect::<Vec<_>>())))
}
#[derive(Deserialize)]
struct NewTag {
    name: String,
}
async fn add_tag(State(a): State<App>, Json(t): Json<NewTag>) -> Result<Json<Value>> {
    let name = t.name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(bad("タグ名は1〜100バイトで入力してください。"));
    }
    let id = Uuid::new_v4().to_string();
    let row=a.db.get().await.map_err(internal)?.query_one("INSERT INTO tags(id,name) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name,color",&[&id,&name]).await.map_err(internal)?;
    Ok(Json(
        json!({"tagId":row.get::<_,String>(0),"name":row.get::<_,String>(1),"color":row.get::<_,String>(2)}),
    ))
}
async fn ready(State(a): State<App>) -> Result<&'static str> {
    a.db.get()
        .await
        .map_err(internal)?
        .simple_query("SELECT 1")
        .await
        .map_err(internal)?;
    Ok("ok")
}
#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let cfg: tokio_postgres::Config = env::var("DATABASE_URL")?.parse()?;
    let db = Pool::builder(Manager::new(cfg, tokio_postgres::NoTls))
        .max_size(4)
        .build()?;
    if env::args().any(|s| s == "--migrate") {
        db.get()
            .await?
            .batch_execute(include_str!("../schema.sql"))
            .await?;
        return Ok(());
    }
    let objects = AmazonS3Builder::new()
        .with_bucket_name(env::var("S3_BUCKET")?)
        .with_region("us-east-1")
        .with_endpoint(env::var("S3_ENDPOINT")?)
        .with_allow_http(true)
        .with_access_key_id(env::var("S3_ACCESS_KEY")?)
        .with_secret_access_key(env::var("S3_SECRET_KEY")?)
        .build()?;
    let a = App {
        db,
        objects: Arc::new(objects),
        uploads: Arc::new(tokio::sync::Semaphore::new(2)),
    };
    let api = Router::new()
        .route("/assets", get(list))
        .route("/assets/{id}", get(metadata).patch(update).delete(remove))
        .route("/assets/{id}/content", get(content).put(upload))
        .route("/tags", get(tags).post(add_tag));
    let static_dir = env::var("STATIC_DIR").unwrap_or_else(|_| "../dist".into());
    let routes = Router::new()
        .route_service("/", ServeFile::new(format!("{static_dir}/index.html")))
        .route("/healthz", get(|| async { "ok" }))
        .route("/readyz", get(ready))
        .nest("/api", api)
        .fallback_service(ServeDir::new(
            env::var("STATIC_DIR").unwrap_or_else(|_| "../dist".into()),
        ))
        .layer(DefaultBodyLimit::max(1_000_100_000))
        .layer(middleware::from_fn(same_origin))
        .with_state(a);
    let base = env::var("APP_BASE_PATH").unwrap_or_default();
    let router = mount(&base, routes, &static_dir);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    axum::serve(listener, router)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
fn mount(base: &str, routes: Router, static_dir: &str) -> Router {
    if base.is_empty() {
        routes
    } else {
        Router::new().nest(base, routes).route_service(
            &format!("{base}/"),
            ServeFile::new(format!("{static_dir}/index.html")),
        )
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn mounted_root_and_api_are_reachable() {
        use tower::ServiceExt;
        let path = std::env::temp_dir().join(Uuid::new_v4().to_string());
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("index.html"), "test").unwrap();
        let routes = Router::new().route("/api/tags", get(|| async { "[]" }));
        let router = mount("/asset-manager", routes, path.to_str().unwrap());
        for uri in ["/asset-manager/", "/asset-manager/api/tags"] {
            let response = router
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{uri}");
        }
        std::fs::remove_file(path.join("index.html")).unwrap();
        std::fs::remove_dir(path).unwrap();
    }
    #[test]
    fn extensions_and_tags() {
        let m = normalize(json!({"name":"A.PNG","tagIds":["editor-map","audio"]})).unwrap();
        assert_eq!(m["type"], "image");
        assert_eq!(m["tagIds"], json!(["editor-map", "image"]));
    }
    #[test]
    fn reject_paths() {
        assert!(normalize(json!({"name":"../x.png"})).is_err());
    }
    #[test]
    fn json_is_asset() {
        assert_eq!(
            normalize(json!({"name":"map.json","tagIds":["editor-map"]})).unwrap()["tagIds"],
            json!(["editor-map", "json"])
        );
    }
}
