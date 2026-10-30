package applications

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCatalogAvailability(t *testing.T) {
	for _, test := range []struct {
		name         string
		studioBody   string
		studioStatus int
		gatewayBody  string
		wantStudio   string
		wantGateway  string
	}{
		{"ready", `{"code":0,"data":{"ready":true}}`, 200, `{"success":true}`, "available", "available"},
		{"degraded studio", `{"code":503,"data":{"ready":false}}`, 503, `{"success":true}`, "unavailable", "available"},
		{"false readiness", `{"code":0,"data":{"ready":false}}`, 200, `{"success":false}`, "unavailable", "unavailable"},
		{"html fallback", `<html>login</html>`, 200, `{}`, "unavailable", "unavailable"},
		{"redirect", "", 302, `{"success":true}`, "unavailable", "available"},
	} {
		t.Run(test.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/gateway" {
					_, _ = w.Write([]byte(test.gatewayBody))
					return
				}
				w.Header().Set("Location", "/gateway")
				w.WriteHeader(test.studioStatus)
				_, _ = w.Write([]byte(test.studioBody))
			}))
			defer upstream.Close()
			handler, err := NewHandler(Config{
				StudioURL: "http://localhost:3101", StudioHealth: upstream.URL + "/studio",
				GatewayURL: "http://localhost:3000", GatewayHealth: upstream.URL + "/gateway",
			})
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest("GET", "/api/platform/v1/applications", nil))
			var catalog Catalog
			if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
				t.Fatal(err)
			}
			if response.Code != 200 || len(catalog.Applications) != 3 {
				t.Fatalf("unexpected catalog: %d %s", response.Code, response.Body.String())
			}
			if catalog.Applications[0].State != test.wantStudio || catalog.Applications[2].State != test.wantGateway {
				t.Fatalf("unexpected availability: %+v", catalog.Applications)
			}
			if catalog.Applications[1].State != "planned" || catalog.Applications[1].URL != "" {
				t.Fatal("unimplemented Sites must not have a launch URL")
			}
			if strings.Contains(response.Body.String(), upstream.URL) {
				t.Fatal("internal probe URL leaked to browser")
			}
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("availability must not be cached")
			}
			post := httptest.NewRecorder()
			handler.ServeHTTP(post, httptest.NewRequest("POST", "/api/platform/v1/applications", nil))
			if post.Code != 405 {
				t.Fatalf("catalog must be read-only, got %d", post.Code)
			}
		})
	}
}

func TestRejectCredentialOrInvalidURLs(t *testing.T) {
	for _, value := range []string{"", "javascript:alert(1)", "https://user:secret@example.com", "https://example.com?key=secret", "https://example.com#secret", "/relative"} {
		_, err := NewHandler(Config{StudioURL: value, StudioHealth: "http://localhost/health", GatewayURL: "http://localhost:3000", GatewayHealth: "http://localhost/status"})
		if err == nil {
			t.Fatalf("accepted unsafe launch URL %q", value)
		}
		if strings.Contains(err.Error(), "secret") {
			t.Fatal("configuration error disclosed credentials")
		}
	}
}
