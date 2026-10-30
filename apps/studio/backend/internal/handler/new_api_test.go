package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestNewAPIWorkspaceSessionAndRetiredEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	revoked := false
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked || r.Header.Get("Authorization") != "Bearer live-session" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/ext/apps/studio/bootstrap" {
			_, _ = w.Write([]byte(`{"success":true,"data":{"user_id":42,"username":"creator"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"data":[{"id":"image-model","endpoints":["image-generation"]}]}`))
	}))
	defer gateway.Close()
	t.Setenv("CANVAS_NEW_API_URL", gateway.URL)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	defer svc.Close()
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), svc)
	request := func(method, path, token string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	if got := request("GET", "/api/auth/session", "", nil).Code; got != 401 {
		t.Fatalf("anonymous session: %d", got)
	}
	for _, path := range []string{"/api/auth/login", "/api/auth/register", "/api/wallet/checkin", "/api/model-catalog/quote", "/api/admin/channels"} {
		if got := request("POST", path, "", nil).Code; got != 404 {
			t.Fatalf("retired %s: %d", path, got)
		}
	}
	res := request("POST", "/api/auth/new-api-session", "live-session", nil)
	if res.Code != 200 || len(res.Result().Cookies()) != 1 {
		t.Fatalf("session bootstrap: %d %s", res.Code, res.Body)
	}
	cookie := res.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.Path != "/apps/studio/api" {
		t.Fatal("session cookie must remain scoped and HttpOnly")
	}
	for range 2 {
		res = request("GET", "/api/model-catalog", "", cookie)
		if res.Code != 200 {
			t.Fatalf("catalog: %d %s", res.Code, res.Body)
		}
	}
	var users, credits int64
	db.Model(&model.User{}).Count(&users)
	db.Model(&model.CreditAccount{}).Count(&credits)
	if users != 1 || credits != 0 {
		t.Fatalf("identity must be idempotent and not create credits: users=%d credits=%d", users, credits)
	}
	revoked = true
	if got := request("GET", "/api/model-catalog", "", cookie).Code; got != 401 {
		t.Fatalf("revoked cookie replay: %d", got)
	}
}
