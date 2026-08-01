//! CORS layer.
use axum::http::{uri::Authority, HeaderValue, Method};
use tower_http::cors::{AllowOrigin, CorsLayer};

fn parse_origin(value: &str) -> Result<HeaderValue, String> {
    if value == "*" {
        return Err("wildcard '*' запрещён; перечислите точные origins".into());
    }
    if value.eq_ignore_ascii_case("null") {
        return Err("origin 'null' запрещён".into());
    }

    let authority_raw = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))
        .ok_or_else(|| format!("origin {value:?}: разрешены только http:// и https://"))?;
    if authority_raw.is_empty() {
        return Err(format!("origin {value:?}: отсутствует authority"));
    }
    if authority_raw.contains('*') {
        return Err(format!(
            "origin {value:?}: wildcard '*' запрещён; укажите точный host"
        ));
    }
    if authority_raw
        .bytes()
        .any(|byte| matches!(byte, b'/' | b'?' | b'#' | b'@'))
    {
        return Err(format!(
            "origin {value:?}: path, query, fragment и userinfo запрещены"
        ));
    }

    let authority: Authority = authority_raw
        .parse()
        .map_err(|error| format!("origin {value:?}: некорректный authority: {error}"))?;
    if authority.host().is_empty() {
        return Err(format!("origin {value:?}: отсутствует host"));
    }
    let has_explicit_port = if authority_raw.starts_with('[') {
        authority_raw
            .find(']')
            .is_some_and(|closing| !authority_raw[closing + 1..].is_empty())
    } else {
        authority_raw.contains(':')
    };
    if has_explicit_port && authority.port_u16().is_none() {
        return Err(format!("origin {value:?}: некорректный port"));
    }
    value
        .parse()
        .map_err(|error| format!("origin {value:?}: некорректный HTTP header: {error}"))
}

fn cors_layer_from(raw: &str) -> Result<CorsLayer, String> {
    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_origin)
        .collect::<Result<_, _>>()?;

    if origins.is_empty() {
        Ok(CorsLayer::new())
    } else {
        Ok(CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers([axum::http::header::CONTENT_TYPE])
            .allow_credentials(true))
    }
}

pub(crate) fn cors_layer() -> CorsLayer {
    let raw = std::env::var("FAM_CORS_ORIGINS").unwrap_or_default();
    cors_layer_from(&raw).unwrap_or_else(|error| panic!("некорректный FAM_CORS_ORIGINS: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{
            header::{
                ACCESS_CONTROL_ALLOW_CREDENTIALS, ACCESS_CONTROL_ALLOW_HEADERS,
                ACCESS_CONTROL_ALLOW_METHODS, ACCESS_CONTROL_ALLOW_ORIGIN,
                ACCESS_CONTROL_REQUEST_HEADERS, ACCESS_CONTROL_REQUEST_METHOD, ORIGIN,
            },
            Request, StatusCode,
        },
        routing::put,
        Router,
    };
    use tower::ServiceExt;

    fn probe(raw: &str) -> Router {
        Router::new()
            .route("/probe", put(|| async { StatusCode::NO_CONTENT }))
            .layer(cors_layer_from(raw).expect("valid CORS config"))
    }

    fn preflight(origin: &str) -> Request<Body> {
        Request::builder()
            .method(Method::OPTIONS)
            .uri("/probe")
            .header(ORIGIN, origin)
            .header(ACCESS_CONTROL_REQUEST_METHOD, Method::PUT.as_str())
            .header(ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn configured_origin_allows_put_json_preflight_with_credentials() {
        let response = probe(" http://allowed.test, ,https://second.test:8443 ")
            .oneshot(preflight("http://allowed.test"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(
            headers.get(ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(),
            "http://allowed.test"
        );
        assert!(headers[ACCESS_CONTROL_ALLOW_METHODS]
            .to_str()
            .unwrap()
            .split(',')
            .any(|method| method.trim() == Method::PUT.as_str()));
        assert!(headers[ACCESS_CONTROL_ALLOW_HEADERS]
            .to_str()
            .unwrap()
            .split(',')
            .any(|header| header.trim().eq_ignore_ascii_case("content-type")));
        assert_eq!(
            headers.get(ACCESS_CONTROL_ALLOW_CREDENTIALS).unwrap(),
            "true"
        );
    }

    #[tokio::test]
    async fn forbidden_origin_gets_no_allow_origin_header() {
        let response = probe("http://allowed.test")
            .oneshot(preflight("http://forbidden.test"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(!response.headers().contains_key(ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    #[tokio::test]
    async fn empty_config_keeps_same_origin_handler_without_cors_permission_headers() {
        let response = probe(" , , ")
            .oneshot(
                Request::builder()
                    .method(Method::PUT)
                    .uri("/probe")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(!response.headers().contains_key(ACCESS_CONTROL_ALLOW_ORIGIN));
        assert!(!response
            .headers()
            .contains_key(ACCESS_CONTROL_ALLOW_CREDENTIALS));
        assert!(!response
            .headers()
            .contains_key(ACCESS_CONTROL_ALLOW_METHODS));
        assert!(!response
            .headers()
            .contains_key(ACCESS_CONTROL_ALLOW_HEADERS));
    }

    #[test]
    fn invalid_origin_configs_fail_explicitly() {
        for raw in [
            "*",
            "null",
            "ftp://example.test",
            "example.test",
            "HTTP://example.test",
            "http://",
            "https://*.example.com",
            "http://exam*ple.test",
            "http://user@example.test",
            "http://example.test/",
            "http://example.test/path",
            "http://example.test?query",
            "http://example.test#fragment",
            "http://example test",
            "http://example.test:99999",
            "http://example.test\u{7f}",
        ] {
            assert!(cors_layer_from(raw).is_err(), "raw={raw:?}");
        }
    }
}
