package handler

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

const newAPICookie = "elink_studio_session"

func registerNewAPIWorkspace(api *gin.RouterGroup, svc *service.Service) {
	api.POST("/auth/new-api-session", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		token := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if token == c.GetHeader("Authorization") {
			token = ""
		}
		user, err := svc.NewAPIUser(c.Request.Context(), token)
		if err != nil {
			failService(c, err)
			return
		}
		secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
		http.SetCookie(c.Writer, &http.Cookie{Name: newAPICookie, Value: token, Path: "/apps/studio/api", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode})
		ok(c, gin.H{"user": user})
	})
	workspace := api.Group("")
	workspace.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		// These media URLs carry an expiring resource signature checked by the
		// delivery handler; upstream models do not have browser cookies.
		if strings.HasPrefix(c.Request.URL.Path, "/api/public/resources/") || strings.HasPrefix(c.Request.URL.Path, "/api/public/canvas-shares/") || c.Request.URL.Path == "/api/public/appearance" {
			c.Next()
			return
		}
		// Account/channel/payment administration belongs to new-api. Some
		// shared route registrars also declare admin endpoints; retire them here.
		if strings.HasPrefix(c.Request.URL.Path, "/api/admin/") {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		token, _ := c.Cookie(newAPICookie)
		user, err := svc.NewAPIUser(c.Request.Context(), token)
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Set("new-api-user", user)
		c.Next()
	})
	workspace.GET("/auth/session", func(c *gin.Context) {
		user, _ := c.Get("new-api-user")
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": user, "features": features, "runtimeLimits": limits})
	})
	RegisterAppearanceRoutes(workspace, svc)
	registerNotificationRoutes(workspace, svc)
	RegisterFeatureAvailabilityRoutes(workspace, svc)
	RegisterAnnouncementRoutes(workspace, svc)
	RegisterUserDataRoutes(workspace, svc)
	RegisterChunkedUploadRoutes(workspace, svc)
	RegisterTaskRoutes(workspace, svc)
	RegisterWorkbenchRoutes(workspace, svc)
	RegisterCreationRoutes(workspace, svc)
	RegisterSkillRoutes(workspace, svc)
	RegisterToolRoutes(workspace, svc)
	RegisterPluginRoutes(workspace, svc)
	RegisterLibraryRoutes(workspace, svc)
	RegisterCanvasShareRoutes(workspace, svc)
	RegisterProjectRoutes(workspace, svc)
	RegisterDiagnosticsRoutes(workspace, svc)
	RegisterAgentRoutes(workspace, svc)
	RegisterAgentMemoryRoutes(workspace, svc)
	RegisterModelCatalogRoutes(workspace, svc)
	for _, gateway := range []string{"new-api-text", "new-api-image", "new-api-video", "new-api-audio"} {
		for _, endpoint := range []struct{ method, path string }{{"POST", "/chat/completions"}, {"POST", "/responses"}, {"POST", "/images/generations"}, {"POST", "/images/edits"}, {"POST", "/audio/speech"}, {"POST", "/audio/transcriptions"}, {"POST", "/videos"}, {"GET", "/videos/:task_id"}, {"GET", "/videos/:task_id/content"}} {
			workspace.Handle(endpoint.method, "/"+gateway+endpoint.path, func(c *gin.Context) {
				target, err := url.Parse(os.Getenv("CANVAS_NEW_API_URL"))
				if err != nil {
					failService(c, err)
					return
				}
				token, _ := c.Cookie(newAPICookie)
				proxy := &httputil.ReverseProxy{Rewrite: func(r *httputil.ProxyRequest) {
					r.Out.URL.Path = "/api/ext/apps/studio/relay/v1" + strings.TrimPrefix(c.Request.URL.Path, "/api/"+gateway)
					r.Out.URL.RawPath = ""
					r.SetURL(target)
					r.Out.Header.Del("Cookie")
					r.Out.Header.Set("Authorization", "Bearer "+token)
				}}
				c.Header("X-Accel-Buffering", "no")
				proxy.ServeHTTP(c.Writer, c.Request)
			})
		}
	}
}

func newAPIContextUser(c *gin.Context) (*model.User, error) {
	value, exists := c.Get("new-api-user")
	user, ok := value.(*model.User)
	if !exists || !ok {
		return nil, service.Unauthorized("请先登录账号")
	}
	return user, nil
}
