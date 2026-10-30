package applications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

type Config struct {
	StudioURL     string
	StudioHealth  string
	GatewayURL    string
	GatewayHealth string
}

type Application struct {
	ID    string `json:"id"`
	State string `json:"state"`
	URL   string `json:"url,omitempty"`
}

type Catalog struct {
	Applications []Application `json:"applications"`
}

// Only operator-configured endpoints are probed; request parameters never select a destination.
func NewHandler(config Config) (http.Handler, error) {
	for name, value := range map[string]string{
		"StudioURL": config.StudioURL, "StudioHealth": config.StudioHealth,
		"GatewayURL": config.GatewayURL, "GatewayHealth": config.GatewayHealth,
	} {
		u, err := url.Parse(value)
		if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("%s must be an HTTP(S) URL without credentials, query or fragment", name)
		}
	}
	client := &http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("health redirects are not followed")
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/platform/v1/applications", func(w http.ResponseWriter, r *http.Request) {
		apps := []Application{
			{ID: "studio", State: "unavailable", URL: config.StudioURL},
			{ID: "sites", State: "planned"},
			{ID: "gateway", State: "unavailable", URL: config.GatewayURL},
		}
		var workers sync.WaitGroup
		for index, endpoint := range map[int]string{0: config.StudioHealth, 2: config.GatewayHealth} {
			workers.Go(func() {
				if healthy(r.Context(), client, endpoint, apps[index].ID) {
					apps[index].State = "available"
				}
			})
		}
		workers.Wait()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_ = json.NewEncoder(w).Encode(Catalog{Applications: apps})
	})
	// App availability is reported in the catalog and does not take down the console.
	mux.HandleFunc("GET /api/health/ready", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"status\":\"ready\"}\n"))
	})
	return mux, nil
}

func healthy(ctx context.Context, client *http.Client, endpoint, appID string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return false
	}
	res, err := client.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return false
	}
	var payload struct {
		Success *bool `json:"success"`
		Code    *int  `json:"code"`
		Data    struct {
			Ready bool `json:"ready"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&payload); err != nil {
		return false
	}
	if appID == "gateway" {
		return payload.Success != nil && *payload.Success
	}
	return payload.Code != nil && *payload.Code == 0 && payload.Data.Ready
}
