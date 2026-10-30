package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/model"
)

func TestNewAPITaskAuthorizationAndSingleLedger(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	var revoked atomic.Bool
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoked.Load() || r.Header.Get("Authorization") != "Bearer session-for-42" {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/ext/apps/studio/bootstrap":
			_, _ = w.Write([]byte(`{"success":true,"data":{"user_id":42,"username":"creator"}}`))
		case "/api/ext/apps/studio/catalog":
			_, _ = w.Write([]byte(`{"success":true,"data":[{"id":"text-test","endpoints":["openai","openai-response"]},{"id":"dual-model","endpoints":["openai","image-generation"]},{"id":"voice-alias","endpoint_paths":["/v1/audio/speech"]}]}`))
		default:
			t.Errorf("unexpected gateway request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer gateway.Close()
	t.Setenv("CANVAS_NEW_API_URL", gateway.URL)
	user, err := s.NewAPIUser(context.Background(), "session-for-42")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.NewAPIModelCatalog(context.Background(), "session-for-42")
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Channels[0].Models) != 2 || len(catalog.Channels[1].Models) != 1 || len(catalog.Channels[3].Models) != 1 {
		t.Fatalf("capability catalogs must remain separate: %+v", catalog.Channels)
	}
	req := creationTextRequest()
	req.NewAPIAuthorization = "session-for-42"
	config := req.Input["config"].(map[string]any)
	config["baseUrl"], config["apiKey"], config["headers"] = "https://untrusted.invalid", "untrusted-key", map[string]any{"Authorization": "untrusted-key"}
	task, err := s.CreateTask(user.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.TaskForUser(user.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task.BillingOrderID != "" || strings.Contains(stored.InputJSON, "session-for-42") || strings.Contains(stored.InputJSON, "untrusted") || strings.Contains(task.InputJSON, "session-for-42") {
		t.Fatal("task must not retain client routing, plaintext authorization or a Studio charge")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if err := s.decryptTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	resolved := input["config"].(map[string]any)
	if resolved["baseUrl"] != gateway.URL+"/api/ext/apps/studio/relay/v1" || resolved["apiKey"] != "session-for-42" || resolved["channelId"] != nil {
		t.Fatal("worker routing must be fixed by the server")
	}
	var charges, wallets int64
	db.Model(&model.BillingOrder{}).Where("user_id = ?", user.ID).Count(&charges)
	db.Model(&model.CreditAccount{}).Where("user_id = ?", user.ID).Count(&wallets)
	if charges != 0 || wallets != 0 {
		t.Fatal("hosted tasks must not initialize or charge legacy credit accounts")
	}
	if token, err := s.newAPITaskAuthorization(user.ID, task.ID); err != nil || token != "session-for-42" {
		t.Fatalf("task authorization recovery: %v", err)
	}
	if _, err := s.newAPITaskAuthorization("new-api-43", task.ID); err == nil {
		t.Fatal("cross-user task authorization accepted")
	}
	if _, err := s.CreateTask("new-api-43", req); err == nil {
		t.Fatal("cross-user identity accepted")
	}
	missing := creationTextRequest()
	missing.NewAPIAuthorization = req.NewAPIAuthorization
	missing.Input["config"].(map[string]any)["model"] = "unavailable"
	if _, err := s.CreateTask(user.ID, missing); err == nil {
		t.Fatal("unknown model accepted")
	}
	revoked.Store(true)
	if _, err := s.newAPITaskAuthorization(user.ID, task.ID); err == nil {
		t.Fatal("revoked task authorization accepted")
	}
}
