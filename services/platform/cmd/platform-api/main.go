package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"elink.local/platform/internal/applications"
)

func main() {
	if err := run(); err != nil {
		slog.Error("platform server failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	handler, err := applications.NewHandler(applications.Config{
		StudioURL:     env("STUDIO_PUBLIC_URL", "http://localhost:3101"),
		StudioHealth:  env("STUDIO_HEALTH_URL", "http://localhost:3101/api/health/ready"),
		GatewayURL:    env("NEW_API_PUBLIC_URL", "http://localhost:3000"),
		GatewayHealth: env("NEW_API_HEALTH_URL", "http://localhost:3000/api/status"),
	})
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr: env("PLATFORM_ADDR", "127.0.0.1:8085"), Handler: handler,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
		MaxHeaderBytes: 16 << 10,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	done := make(chan error, 1)
	go func() { done <- server.ListenAndServe() }()
	slog.Info("platform listening", "address", server.Addr)
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
